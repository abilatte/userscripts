// ==UserScript==
// @name         起点小说屏蔽工具
// @name:en      Qidian Novel Blocker
// @namespace    abilatte
// @version      2.7
// @description  屏蔽起点「全部作品」页中不感兴趣的小说：按书籍 ID 精准屏蔽，支持图文/文字两种列表模式，详情页一键屏蔽，管理面板支持搜索、排序、批量移除与导入导出。
// @description:en  Hide unwanted novels on Qidian's "All Works" page by book ID, in both image and text list modes, with a one-click button on detail pages and a management panel supporting search, sorting, batch removal, and import/export.
// @author       abilatte
// @match        https://www.qidian.com/all*
// @match        https://www.qidian.com/book/*
// @noframes
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @license      AGPL-3.0-or-later
// @homepageURL  https://github.com/abilatte/userscripts
// @updateURL    https://raw.githubusercontent.com/abilatte/userscripts/main/Qidian/qidian-novel-blocker.user.js
// @downloadURL  https://raw.githubusercontent.com/abilatte/userscripts/main/Qidian/qidian-novel-blocker.user.js
// ==/UserScript==

// 此文件由 npm run build 生成，请修改 src 下的源码。
"use strict";
(() => {
  // src/config.mjs
  var COVER_LIST = "#book-img-text .all-img-list";
  var COVER_LAYOUT = {
    root: "#book-img-text",
    item: `${COVER_LIST} > li`,
    link: ".book-mid-info h2 > a[data-bid]",
    category: "p.author a:not(.name):not(.go-sub-type)",
    subCategory: "a.go-sub-type"
  };
  var SELECTORS = {
    listLayouts: [
      // 图文模式，两列
      COVER_LAYOUT,
      // 文字模式
      { root: "#book-text", item: "#book-text .rank-table-list > tbody > tr", link: "a.name[data-bid]", category: "a.type", subCategory: "a.go-sub-type" }
    ],
    pagination: "#page-container",
    nextPage: ".lbf-pagination-next:not(.lbf-pagination-disabled)[href]",
    detailBtnGroup: ".normal-btn",
    detailTitle: "#bookName",
    detailCategory: { category: ".book-attribute a:not([href*='subCateId'])", subCategory: ".book-attribute a[href*='subCateId']" }
  };
  var PageType = {
    isList: (pathname = location.pathname) => /^\/all(\/|$)/.test(pathname),
    detailBid: () => {
      const match = location.pathname.match(/^\/book\/(\d+)/);
      return match ? match[1] : null;
    }
  };

  // src/core/blocklist.mjs
  var BID_PATTERN = /^\d+$/;
  var hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  var Category = {
    build: (category, subCategory) => ({
      ...category ? { category } : {},
      ...subCategory ? { subCategory } : {}
    }),
    // 文字模式的分区名带有「」装饰
    fromElements: (root, selectors) => {
      const readName = (selector) => {
        const el = root.querySelector(selector);
        return el ? el.textContent.replace(/[「」\s]/g, "") : "";
      };
      return Category.build(readName(selectors.category), readName(selectors.subCategory));
    },
    isMissing: (entry) => !entry.category || !entry.subCategory
  };
  var normalizeEntry = (value) => {
    if (typeof value === "string") {
      const title2 = value.trim();
      return title2 ? { title: title2, time: 0 } : null;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const title = typeof value.title === "string" ? value.title.trim() : "";
    if (!title) return null;
    const time = Number(value.time);
    const readName = (name) => typeof name === "string" ? name.trim() : "";
    return {
      title,
      time: Number.isFinite(time) && time > 0 ? time : 0,
      ...Category.build(readName(value.category), readName(value.subCategory))
    };
  };
  var normalizeBlocklist = (rawMap) => {
    const map = {};
    let skipped = 0;
    if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) return { map, skipped };
    Object.keys(rawMap).forEach((bid) => {
      const entry = BID_PATTERN.test(bid) ? normalizeEntry(rawMap[bid]) : null;
      if (entry) map[bid] = entry;
      else skipped++;
    });
    return { map, skipped };
  };
  var diffBlocklist = (oldMap, newMap) => {
    const same = (a, b) => a === b || a.title === b.title && a.time === b.time && a.category === b.category && a.subCategory === b.subCategory;
    return {
      upsert: Object.keys(newMap).filter((bid) => !hasOwn(oldMap, bid) || !same(oldMap[bid], newMap[bid])),
      remove: Object.keys(oldMap).filter((bid) => !hasOwn(newMap, bid))
    };
  };

  // src/core/sync-state.mjs
  var emptySyncState = () => ({
    sha: null,
    upsert: [],
    remove: [],
    lastSyncTime: 0,
    lastCheckTime: 0,
    lastError: ""
  });
  var hasPending = (state) => state.upsert.length > 0 || state.remove.length > 0;
  var journalChanges = (state, changes) => {
    const upsert = new Set(state.upsert);
    const remove = new Set(state.remove);
    changes.upsert.forEach((bid) => {
      upsert.add(bid);
      remove.delete(bid);
    });
    changes.remove.forEach((bid) => {
      remove.add(bid);
      upsert.delete(bid);
    });
    return { ...state, upsert: Array.from(upsert), remove: Array.from(remove) };
  };

  // src/core/storage.mjs
  var STORAGE_KEY = "qidian_blocked_map_v5";
  var DATA_KEY = "qidian_sync_config";
  var STORAGE_LOCK = "abilatte:qidian-blocker:storage";
  var STORAGE_WAIT_TIMEOUT = 5e3;
  var SYNC_STATE_KEY = "qidian_sync_state";
  var Storage = {
    _data: null,
    _listeners: [],
    _snapshotListeners: [],
    _localChangeListeners: [],
    read: () => {
      const saved = GM_getValue(DATA_KEY, null);
      const cached = Storage._data;
      if (cached?.revision > 0 && !(saved?.revision > cached.revision)) return cached;
      if (saved?.revision > 0) return saved;
      return {
        revision: 0,
        mapRevision: 0,
        configRevision: 0,
        map: normalizeBlocklist(GM_getValue(STORAGE_KEY, {})).map,
        config: saved?.repo && saved.path && saved.token ? saved : null,
        sync: { ...emptySyncState(), ...GM_getValue(SYNC_STATE_KEY, {}) }
      };
    },
    getData: () => Storage._data ??= Storage.read(),
    getMap: () => Storage.getData().map,
    accept: (data) => {
      const previous = Storage._data;
      if (previous && data.revision <= previous.revision) return;
      Storage._data = data;
      Storage._snapshotListeners.forEach((fn) => fn(data));
      if (!previous || data.mapRevision !== previous.mapRevision) {
        Storage._listeners.forEach((fn) => fn(data.map, previous?.map));
      }
    },
    transact: async (edit) => {
      let result;
      await navigator.locks.request(STORAGE_LOCK, async () => {
        const revision = Number(localStorage.getItem(STORAGE_LOCK));
        const deadline = Date.now() + STORAGE_WAIT_TIMEOUT;
        let current = Storage.read();
        while (current.revision < revision) {
          if (Date.now() >= deadline) throw new Error("未能读取其他标签页刚保存的数据，请稍后重试");
          await new Promise((resolve) => setTimeout(resolve, 25));
          current = Storage.read();
        }
        Storage.accept(current);
        const next = { ...current };
        result = edit(next);
        if (next.map === current.map && next.config === current.config && next.sync === current.sync) return;
        next.revision++;
        if (next.map !== current.map) next.mapRevision++;
        localStorage.setItem(STORAGE_LOCK, String(next.revision));
        try {
          GM_setValue(DATA_KEY, next);
        } catch (err) {
          localStorage.setItem(STORAGE_LOCK, String(current.revision));
          throw err;
        }
        Storage.accept(next);
      });
      return result;
    },
    changeMap: async (edit) => {
      const { changed, result } = await Storage.transact((data) => {
        const map = { ...data.map };
        const result2 = edit(map);
        const changes = diffBlocklist(data.map, map);
        const changed2 = hasPending(changes);
        if (changed2) {
          data.map = map;
          if (data.config) data.sync = journalChanges(data.sync, changes);
        }
        return { changed: changed2 && !!data.config, result: result2 };
      });
      if (changed) Storage._localChangeListeners.forEach((fn) => fn());
      return result;
    },
    onChange: (fn) => Storage._listeners.push(fn),
    onSnapshot: (fn) => Storage._snapshotListeners.push(fn),
    onLocalChange: (fn) => Storage._localChangeListeners.push(fn),
    reportError: (err) => {
      console.error("QidianBlocker Storage Error:", err);
      alert(`屏蔽列表操作失败：${err.message}`);
    },
    has: (bid) => hasOwn(Storage.getMap(), bid),
    add: (bid, title, category) => {
      if (!BID_PATTERN.test(bid) || !title) throw new Error(`invalid book: ${bid} ${title}`);
      return Storage.changeMap((map) => {
        map[bid] = { title, time: Date.now(), ...category };
      });
    },
    // 只补缺失的分区字段，已有的不覆盖
    fillCategories: (updates) => {
      const entries = Object.entries(updates).filter(([, category]) => category.category || category.subCategory);
      if (!entries.length) return;
      Storage.changeMap((map) => {
        entries.forEach(([bid, category]) => {
          if (hasOwn(map, bid)) map[bid] = { ...category, ...map[bid] };
        });
      }).catch((err) => console.error("QidianBlocker Category Error:", err));
    },
    remove: (bids) => Storage.changeMap((map) => {
      bids.forEach((bid) => delete map[bid]);
    }),
    clear: () => Storage.changeMap((map) => {
      Object.keys(map).forEach((bid) => delete map[bid]);
    }),
    toggle: (bid, readEntry) => Storage.changeMap((map) => {
      if (hasOwn(map, bid)) delete map[bid];
      else map[bid] = readEntry();
    }),
    // 合并导入数据，同 ID 以导入数据为准；导入数据没有的分区字段保留现有值
    merge: (incoming) => Storage.changeMap((map) => {
      const bids = Object.keys(incoming);
      const overwritten = bids.filter((bid) => hasOwn(map, bid)).length;
      bids.forEach((bid) => {
        map[bid] = { ...map[bid], ...incoming[bid] };
      });
      return { added: bids.length - overwritten, overwritten };
    })
  };

  // src/core/date.mjs
  var pad = (n) => String(n).padStart(2, "0");
  function formatDate(timestamp) {
    if (!timestamp) return "历史记录";
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // src/core/sync.mjs
  var SYNC_LOCK = "abilatte:qidian-blocker:sync";
  var SYNC_API = "https://api.github.com";
  var SYNC_DEFAULT_PATH = "qidian/blocklist.json";
  var SYNC_REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
  var SYNC_PUSH_DELAY = 30 * 1e3;
  var SYNC_PULL_INTERVAL = 2 * 60 * 1e3;
  var SYNC_TIMEOUT = 30 * 1e3;
  var SYNC_MAX_CONFLICT_RETRIES = 2;
  var Base64 = {
    encode: (text) => {
      const bytes = new TextEncoder().encode(text);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 32768) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
      }
      return btoa(binary);
    },
    decode: (base64) => {
      const binary = atob(base64.replace(/\s/g, ""));
      return new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)));
    }
  };
  var Sync = {
    _active: null,
    _timer: 0,
    _listeners: [],
    getConfig: () => Storage.getData().config,
    saveConfig: (config) => Storage.transact((data) => {
      const current = data.config;
      const token = config.token || current?.token;
      if (!token) throw new Error("请填写 GitHub 令牌");
      data.config = { ...config, token };
      data.configRevision++;
      if (!current || current.repo !== config.repo || current.path !== config.path) data.sync = emptySyncState();
    }),
    clearConfig: () => Storage.transact((data) => {
      if (!data.config) return;
      data.config = null;
      data.configRevision++;
      data.sync = emptySyncState();
    }),
    onDataChange: (data) => {
      const active = Sync._active;
      if (active && data.configRevision !== active.configRevision) active.controller.abort();
      Sync._emit();
    },
    // 在重新读取配置的锁内校验，避免其他标签页的配置通知尚未送达。
    transact: (active, edit) => Storage.transact((data) => {
      if (data.configRevision !== active.configRevision) active.controller.abort();
      active.controller.signal.throwIfAborted();
      return edit(data);
    }),
    onChange: (fn) => Sync._listeners.push(fn),
    _emit: () => Sync._listeners.forEach((fn) => fn()),
    isBusy: () => Sync._active !== null,
    describe: () => {
      if (!Sync.getConfig()) return "☁️ 同步未启用";
      if (Sync.isBusy()) return "☁️ 正在同步…";
      const state = Storage.getData().sync;
      if (state.lastError) return `⚠️ 同步失败：${state.lastError}`;
      if (hasPending(state)) return "☁️ 有改动等待上传";
      return state.lastSyncTime ? `☁️ 已同步 · ${formatDate(state.lastSyncTime)}` : "☁️ 尚未同步";
    },
    schedule: () => {
      clearTimeout(Sync._timer);
      Sync._timer = setTimeout(() => Sync.run(), SYNC_PUSH_DELAY);
    },
    // 每本书一行、按 ID 排序、字段顺序固定：同样的数据总是得到同样的文本，便于比较，也便于在 GitHub 上看每次提交的差异
    serialize: (map) => {
      const lines = Object.keys(map).sort().map((bid) => `  ${JSON.stringify(bid)}: ${JSON.stringify(normalizeEntry(map[bid]))}`);
      return lines.length ? `{
${lines.join(",\n")}
}
` : "{}\n";
    },
    request: async (active, method, path, body) => {
      const { pending } = await Sync.transact(active, () => ({
        // 锁内发起请求，锁外等待响应。请求期间仍可编辑书单或切换配置。
        pending: Sync.send(active, method, path, body)
      }));
      return pending;
    },
    send: (active, method, path, body) => {
      const signal = active.controller.signal;
      let abort;
      const pending = new Promise((resolve, reject) => {
        const request = GM_xmlhttpRequest({
          method,
          url: SYNC_API + path,
          headers: {
            "Accept": "application/vnd.github+json",
            "Authorization": `Bearer ${active.config.token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            ...body ? { "Content-Type": "application/json" } : {}
          },
          data: body ? JSON.stringify(body) : void 0,
          timeout: SYNC_TIMEOUT,
          anonymous: true,
          nocache: true,
          onload: resolve,
          onerror: () => reject(new Error("无法连接 GitHub，请检查网络或代理")),
          onabort: () => reject(new Error("请求被中断")),
          ontimeout: () => reject(new Error("连接 GitHub 超时"))
        });
        abort = () => {
          reject(signal.reason);
          request.abort();
        };
        signal.addEventListener("abort", abort, { once: true });
      });
      return pending.finally(() => signal.removeEventListener("abort", abort));
    },
    assertOk: (res) => {
      if (res.status >= 200 && res.status < 300) return;
      const reasons = {
        401: "令牌无效或已过期",
        403: "令牌权限不足，或触发了 GitHub 的访问频率限制",
        404: "仓库不存在，或令牌无权访问该仓库"
      };
      throw new Error(reasons[res.status] || `GitHub 返回了 ${res.status}`);
    },
    contentsPath: (config) => `/repos/${config.repo}/contents/${config.path.split("/").map(encodeURIComponent).join("/")}`,
    // 返回 { sha, map }；文件还不存在时返回 null
    fetchRemote: async (active) => {
      const { config } = active;
      const res = await Sync.request(active, "GET", `${Sync.contentsPath(config)}?t=${Date.now()}`);
      if (res.status === 404) return null;
      Sync.assertOk(res);
      const meta = JSON.parse(res.responseText);
      if (Array.isArray(meta) || meta.type !== "file") throw new Error("同步路径指向的不是文件");
      let content = meta.content;
      if (meta.encoding !== "base64" || !content) {
        const blobRes = await Sync.request(active, "GET", `/repos/${config.repo}/git/blobs/${meta.sha}`);
        Sync.assertOk(blobRes);
        content = JSON.parse(blobRes.responseText).content;
      }
      let raw;
      try {
        raw = JSON.parse(Base64.decode(content));
      } catch (err) {
        raw = null;
      }
      const invalid = () => new Error(`远端文件 ${config.repo}/${config.path} 不是有效的屏蔽列表，已停止同步`);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
      if (Object.values(raw).some((entry) => !Sync.isRemoteEntry(entry))) throw invalid();
      const { map, skipped } = normalizeBlocklist(raw);
      if (skipped) throw invalid();
      return { sha: meta.sha, map };
    },
    isRemoteEntry: (entry) => {
      if (typeof entry === "string") return true;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      return Object.entries(entry).every(([key, value]) => {
        if (key === "time") {
          return (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value)) && Number(value) >= 0;
        }
        return ["title", "category", "subCategory"].includes(key) && typeof value === "string";
      });
    },
    // 返回 { sha }；远端在读取之后又被改动时返回 { conflict: true }
    pushRemote: async (active, text, count, sha) => {
      const res = await Sync.request(active, "PUT", Sync.contentsPath(active.config), {
        message: `sync: ${count} books`,
        content: Base64.encode(text),
        ...sha ? { sha } : {}
      });
      if (res.status === 409 || res.status === 422) return { conflict: true };
      Sync.assertOk(res);
      return { sha: JSON.parse(res.responseText).content.sha };
    },
    // 把远端的新内容合并进本机
    mergeRemote: (data, remote) => {
      const state = data.sync;
      if (remote.sha === state.sha) return;
      const local = data.map;
      const merged = { ...remote.map };
      if (state.sha === null) {
        Object.keys(local).forEach((bid) => {
          merged[bid] = { ...remote.map[bid], ...local[bid] };
        });
      } else {
        state.upsert.forEach((bid) => {
          if (hasOwn(local, bid)) merged[bid] = local[bid];
        });
      }
      state.remove.forEach((bid) => delete merged[bid]);
      data.map = merged;
      data.sync = { ...state, ...diffBlocklist(remote.map, merged), sha: remote.sha };
    },
    // 本机的 uploaded 这份数据已与远端一致；请求期间又发生的本地改动留到下一次上传
    settle: async (active, uploaded, sha) => {
      const pending = await Sync.transact(active, (data) => {
        const changes = diffBlocklist(uploaded, data.map);
        const now = Date.now();
        data.sync = { ...changes, sha, lastCheckTime: now, lastSyncTime: now, lastError: "" };
        return hasPending(changes);
      });
      if (pending) Sync.schedule();
    },
    syncOnce: async (active, attempt = 0) => {
      const remote = await Sync.fetchRemote(active);
      const local = await Sync.transact(active, (data) => {
        if (remote) Sync.mergeRemote(data, remote);
        return data.map;
      });
      const text = Sync.serialize(local);
      if (remote && text === Sync.serialize(remote.map)) {
        await Sync.settle(active, local, remote.sha);
        return;
      }
      const result = await Sync.pushRemote(active, text, Object.keys(local).length, remote ? remote.sha : null);
      if (result.conflict) {
        if (attempt >= SYNC_MAX_CONFLICT_RETRIES) {
          throw new Error("远端数据正在被其他设备修改，请稍后重试");
        }
        await Sync.syncOnce(active, attempt + 1);
        return;
      }
      await Sync.settle(active, local, result.sha);
    },
    // force：忽略检查间隔；pushOnly：只在有改动等待上传时才同步。
    // 同步失败不影响屏蔽功能，错误显示在管理面板里。
    // 同设备的标签页依次同步，跨设备写入仍由 GitHub SHA 处理冲突。
    run: async ({ force = false, pushOnly = false } = {}) => {
      try {
        await navigator.locks.request(SYNC_LOCK, async () => {
          const active = await Storage.transact(({ config, configRevision, sync }) => {
            if (!config) return null;
            const pending = hasPending(sync);
            const checkedRecently = Date.now() - sync.lastCheckTime < SYNC_PULL_INTERVAL;
            if (pushOnly && !pending) return null;
            if (!force && !pending && sync.sha !== null && checkedRecently) return null;
            return { config, configRevision, controller: new AbortController() };
          });
          if (!active) return;
          Sync._active = active;
          clearTimeout(Sync._timer);
          Sync._emit();
          try {
            await Sync.syncOnce(active);
          } catch (err) {
            if (active.controller.signal.aborted) return;
            await Sync.transact(active, (data) => {
              data.sync = { ...data.sync, lastCheckTime: Date.now(), lastError: err.message };
            });
            console.error("QidianBlocker Sync Error:", err);
          } finally {
            Sync._active = null;
            Sync._emit();
          }
        });
      } catch (err) {
        if (err.name !== "AbortError") console.error("QidianBlocker Sync Error:", err);
      }
    }
  };

  // src/pages/detail.mjs
  var DetailPage = {
    apply: (bid) => {
      let btn = document.getElementById("qd-detail-btn");
      if (!btn) {
        const group = document.querySelector(SELECTORS.detailBtnGroup);
        if (!group) {
          console.warn("QidianBlocker: 未找到详情页按钮区域", SELECTORS.detailBtnGroup);
          return;
        }
        btn = document.createElement("button");
        btn.id = "qd-detail-btn";
        btn.type = "button";
        btn.className = "qd-detail-btn";
        btn.addEventListener("click", () => DetailPage.toggle(bid).catch(Storage.reportError));
        group.appendChild(btn);
      }
      const blocked = Storage.has(bid);
      btn.textContent = blocked ? "🚫" : "🛡️";
      btn.title = blocked ? "已屏蔽，点击取消" : "屏蔽此书";
      btn.classList.toggle("is-blocked", blocked);
      if (blocked && Category.isMissing(Storage.getMap()[bid])) {
        Storage.fillCategories({ [bid]: Category.fromElements(document, SELECTORS.detailCategory) });
      }
    },
    toggle: (bid) => Storage.toggle(bid, () => {
      const titleEl = document.querySelector(SELECTORS.detailTitle);
      const title = titleEl ? titleEl.textContent.trim() : "";
      if (!title) throw new Error("未能读取书名");
      return { title, time: Date.now(), ...Category.fromElements(document, SELECTORS.detailCategory) };
    })
  };

  // src/ui/toast.mjs
  var TOAST_DURATION = 6e3;
  var Toast = {
    el: null,
    timer: 0,
    show: (message, actionLabel, onAction) => {
      Toast.hide();
      const el = document.createElement("div");
      el.className = "qd-toast";
      const text = document.createElement("span");
      text.className = "qd-toast-text";
      text.textContent = message;
      const action = document.createElement("button");
      action.type = "button";
      action.className = "qd-toast-action";
      action.textContent = actionLabel;
      action.onclick = () => {
        Toast.hide();
        onAction();
      };
      el.append(text, action);
      document.body.appendChild(el);
      Toast.el = el;
      Toast.timer = setTimeout(Toast.hide, TOAST_DURATION);
    },
    hide: () => {
      clearTimeout(Toast.timer);
      if (Toast.el) Toast.el.remove();
      Toast.el = null;
    }
  };

  // src/pages/list.mjs
  var HIDDEN_CLASS = "qd-hidden";
  var ListPage = {
    itemSelector: SELECTORS.listLayouts.map((layout) => layout.item).join(", "),
    byItem: /* @__PURE__ */ new Map(),
    byBid: /* @__PURE__ */ new Map(),
    blocked: /* @__PURE__ */ new Set(),
    summary: null,
    reveal: false,
    forget: (item) => {
      const record = ListPage.byItem.get(item);
      if (!record) return;
      ListPage.byItem.delete(item);
      const records = ListPage.byBid.get(record.bid);
      records.delete(record);
      if (!records.size) {
        ListPage.byBid.delete(record.bid);
        ListPage.blocked.delete(record.bid);
      }
      ListPage.setVisibility(item, false);
      record.button.remove();
      record.label?.remove();
    },
    track: (item) => {
      const layout = SELECTORS.listLayouts.find((candidate) => item.matches(candidate.item));
      const link = layout && item.querySelector(layout.link);
      const bid = link?.dataset.bid ?? "";
      const current = ListPage.byItem.get(item);
      if (current && current.layout === layout && current.link === link && current.bid === bid && current.button.parentElement === link.parentElement) {
        return current;
      }
      ListPage.forget(item);
      if (!BID_PATTERN.test(bid)) return null;
      item.querySelectorAll(".qd-block-btn, .qd-blocked-preview-label").forEach((el) => el.remove());
      const button = ListPage.createButton(bid, link, item, layout);
      link.before(button);
      const record = { bid, item, link, layout, button, label: null };
      ListPage.byItem.set(item, record);
      if (!ListPage.byBid.has(bid)) ListPage.byBid.set(bid, /* @__PURE__ */ new Set());
      ListPage.byBid.get(bid).add(record);
      return record;
    },
    update: (records, map) => {
      const updates = {};
      records.forEach((record) => {
        const { item, bid, link, layout } = record;
        const blocked = hasOwn(map, bid);
        ListPage.setVisibility(item, blocked);
        if (!blocked) {
          ListPage.blocked.delete(bid);
          return;
        }
        ListPage.blocked.add(bid);
        if (!record.label?.isConnected) {
          const label = document.createElement("span");
          label.className = "qd-blocked-preview-label";
          label.textContent = "已屏蔽";
          link.before(label);
          record.label = label;
        }
        if (Category.isMissing(map[bid])) {
          updates[bid] = { ...updates[bid], ...Category.fromElements(item, layout) };
        }
      });
      Storage.fillCategories(updates);
      ListPage.renderSummary();
    },
    applyNew: (items) => {
      const records = Array.from(items, ListPage.track).filter(Boolean);
      if (records.length) ListPage.update(records, Storage.getMap());
    },
    applyChanges: (map, previous) => {
      const { upsert, remove } = diffBlocklist(previous ?? {}, map);
      const records = [...upsert, ...remove].flatMap((bid) => [...ListPage.byBid.get(bid) ?? []]);
      if (records.length) ListPage.update(records, map);
    },
    mountSummary: () => {
      const root = document.querySelector(SELECTORS.listLayouts.map((layout) => layout.root).join(", "));
      if (ListPage.summary?.root === root) return;
      ListPage.summary?.toolbar.remove();
      ListPage.summary = null;
      if (!root) return;
      const toolbar = document.createElement("div");
      toolbar.className = "qd-hidden-summary";
      const status = document.createElement("span");
      status.setAttribute("role", "status");
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "qd-list-action";
      toggle.onclick = () => ListPage.setReveal(!ListPage.reveal);
      toolbar.append(status, toggle);
      document.body.append(toolbar);
      ListPage.summary = { root, toolbar, status, toggle };
      ListPage.renderSummary();
    },
    setReveal: (reveal) => {
      ListPage.reveal = reveal;
      ListPage.blocked.forEach((bid) => {
        ListPage.byBid.get(bid).forEach(({ item }) => ListPage.setVisibility(item, true));
      });
      ListPage.renderSummary();
    },
    setVisibility: (item, blocked) => {
      item.classList.toggle(HIDDEN_CLASS, blocked && !ListPage.reveal);
      item.classList.toggle("qd-blocked-preview", blocked && ListPage.reveal);
    },
    renderSummary: () => {
      if (!ListPage.summary) return;
      const { toolbar, status, toggle } = ListPage.summary;
      const count = ListPage.blocked.size;
      toolbar.hidden = count === 0 && !ListPage.reveal;
      const message = `${ListPage.reveal ? "临时显示已屏蔽作品" : "已隐藏"} ${count} 本`;
      if (status.textContent !== message) status.textContent = message;
      const action = ListPage.reveal ? "恢复隐藏" : "临时显示";
      if (toggle.textContent !== action) toggle.textContent = action;
    },
    // 解析时书目可能分段插入，观察新增子树和已有书目内的变化。
    watch: (onStructureChange, needsRefresh) => {
      const { itemSelector } = ListPage;
      const structureSelector = [SELECTORS.pagination, ...SELECTORS.listLayouts.map((layout) => layout.root)].join(", ");
      new MutationObserver((mutations) => {
        const items = /* @__PURE__ */ new Set();
        let structureChanged = ListPage.summary?.root.isConnected === false || needsRefresh();
        for (const { target, addedNodes, removedNodes } of mutations) {
          const parentItem = target.closest?.(itemSelector);
          if (parentItem) items.add(parentItem);
          for (const node of addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.matches(itemSelector)) items.add(node);
            node.querySelectorAll(itemSelector).forEach((item) => items.add(item));
            structureChanged ||= node.matches(structureSelector) || !!node.querySelector(structureSelector);
          }
          for (const node of removedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            const forgetIfDetached = (item) => {
              if (ListPage.byItem.has(item) && (!item.isConnected || !item.matches(itemSelector))) {
                ListPage.forget(item);
                structureChanged = true;
              }
            };
            forgetIfDetached(node);
            node.querySelectorAll("li, tr").forEach(forgetIfDetached);
          }
        }
        ListPage.applyNew(items);
        if (structureChanged || items.size) onStructureChange();
      }).observe(document, { childList: true, subtree: true, attributeFilter: ["data-bid"] });
    },
    // 书名和分区在点击时才读取：按钮可能在条目还没解析完整时就已创建
    createButton: (bid, link, item, layout) => {
      const btn = document.createElement("span");
      btn.className = "qd-block-btn";
      btn.textContent = "🚫";
      btn.title = "屏蔽此书";
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const title = (link.getAttribute("title") || link.textContent).trim();
        if (!title) {
          alert("未能读取书名，屏蔽失败。");
          return;
        }
        try {
          await Storage.add(bid, title, Category.fromElements(item, layout));
          Toast.show(`已屏蔽《${title}》`, "撤销", () => Storage.remove([bid]).catch(Storage.reportError));
        } catch (err) {
          Storage.reportError(err);
        }
      });
      return btn;
    }
  };

  // src/pages/pagination.mjs
  var PAGE_LOAD_TIMEOUT = 15 * 1e3;
  var PAGE_LOAD_MARGIN = 320;
  var PAGE_SCROLL_RETRY_DELAY = 1500;
  var PAGE_SCROLL_RETRY_LIMIT = 2;
  var CoverPager = {
    view: null,
    readPage: (root, url) => {
      const pager = root.querySelector(SELECTORS.pagination);
      const number = Number(pager?.dataset.page);
      if (!Number.isInteger(number) || number < 1) return null;
      const href = pager.querySelector(SELECTORS.nextPage)?.getAttribute("href");
      if (!href) return { number, next: null };
      const next = new URL(href, url);
      next.hash = "";
      if (next.origin !== location.origin || !PageType.isList(next.pathname) || next.href === url) {
        throw new Error("起点返回了无效的下一页地址");
      }
      return { number, next: next.href };
    },
    mount: () => {
      const list = document.querySelector(COVER_LIST);
      if (CoverPager.view?.list === list) return;
      const previous = CoverPager.view;
      if (previous) {
        previous.observer.disconnect();
        previous.request?.abort();
        previous.scrollRetry?.abort();
        previous.footer.remove();
        CoverPager.view = null;
      }
      if (!list) return;
      let page;
      try {
        page = CoverPager.readPage(document, location.href);
      } catch (err) {
        console.warn("QidianBlocker Pagination Error:", err);
        return;
      }
      if (!page?.next) return;
      const footer = document.createElement("div");
      footer.className = "qd-list-pager";
      const status = document.createElement("span");
      status.setAttribute("role", "status");
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "qd-list-action";
      retry.textContent = "重试";
      retry.hidden = true;
      const openPage = document.createElement("a");
      openPage.className = "qd-list-action";
      openPage.hidden = true;
      footer.append(status, retry, openPage);
      list.closest(COVER_LAYOUT.root).after(footer);
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting) && retry.hidden) CoverPager.load(view);
      }, { rootMargin: `0px 0px ${PAGE_LOAD_MARGIN}px` });
      const view = { list, footer, status, retry, openPage, observer, page, request: null, scrollRetry: null, retryCount: 0 };
      CoverPager.view = view;
      retry.onclick = () => CoverPager.load(view);
      CoverPager.showProgress(view);
      observer.observe(footer);
    },
    showProgress: (view, message = "") => {
      view.status.textContent = `已加载到第 ${view.page.number} 页${message}`;
    },
    waitForDownScroll: (view) => {
      const controller = new AbortController();
      view.scrollRetry = controller;
      const readyAt = Date.now() + PAGE_SCROLL_RETRY_DELAY;
      let lastY = window.scrollY;
      const retry = () => {
        if (view.request || CoverPager.view !== view || !view.list.isConnected || Date.now() < readyAt) return;
        const { top, bottom } = view.footer.getBoundingClientRect();
        if (bottom < 0 || top > window.innerHeight + PAGE_LOAD_MARGIN) return;
        view.retryCount++;
        CoverPager.load(view);
      };
      const options = { passive: true, signal: controller.signal };
      window.addEventListener("wheel", (event) => {
        if (event.deltaY > 0 && !event.ctrlKey) retry();
      }, options);
      window.addEventListener("scroll", () => {
        const y = window.scrollY;
        const down = y > lastY;
        lastY = y;
        if (down) retry();
      }, options);
    },
    failureReason: (status, timedOut) => {
      if (timedOut) return "请求超时";
      if (status === 0) return "起点要求跳转";
      if (status === 200) return "未找到下一页的图文书目";
      if (status === 202) return "起点未返回完整页面（HTTP 202）";
      if (status === 429) return "请求过于频繁（HTTP 429）";
      return status ? `HTTP ${status}` : "网络请求失败";
    },
    append: (list, items, baseUrl) => {
      const getBid = (item) => item.querySelector(COVER_LAYOUT.link)?.dataset.bid;
      const seen = /* @__PURE__ */ new Set();
      const fragment = document.createDocumentFragment();
      items.forEach((item) => {
        const bid = getBid(item);
        const existing = ListPage.byBid.get(bid);
        if (seen.has(bid) || existing && Array.from(existing).some(({ item: item2 }) => list.contains(item2))) return;
        seen.add(bid);
        const card = document.importNode(item, true);
        card.querySelectorAll("script").forEach((script) => script.remove());
        card.querySelectorAll("a[href], img[src]").forEach((el) => {
          const attr = el.tagName === "A" ? "href" : "src";
          el.setAttribute(attr, new URL(el.getAttribute(attr), baseUrl).href);
        });
        fragment.append(card);
      });
      list.append(fragment);
    },
    load: async (view) => {
      if (CoverPager.view !== view || !view.list.isConnected || view.request || !view.page.next) return;
      view.scrollRetry?.abort();
      view.scrollRetry = null;
      const request = new AbortController();
      const timer = setTimeout(() => request.abort(), PAGE_LOAD_TIMEOUT);
      const url = view.page.next;
      view.request = request;
      view.observer.disconnect();
      view.retry.hidden = true;
      view.openPage.hidden = true;
      CoverPager.showProgress(view, " · 正在加载下一页…");
      let httpStatus;
      try {
        const response = await fetch(url, {
          credentials: "same-origin",
          mode: "same-origin",
          redirect: "manual",
          signal: request.signal
        });
        httpStatus = response.status;
        if (httpStatus !== 200) throw new Error(CoverPager.failureReason(httpStatus, false));
        const source = new DOMParser().parseFromString(await response.text(), "text/html");
        if (CoverPager.view !== view || !view.list.isConnected) return;
        const page = CoverPager.readPage(source, url);
        const items = Array.from(source.querySelectorAll(COVER_LAYOUT.item)).filter((item) => BID_PATTERN.test(item.querySelector(COVER_LAYOUT.link)?.dataset.bid ?? ""));
        if (page?.number !== view.page.number + 1 || !items.length) {
          throw new Error("未找到下一页的图文书目");
        }
        CoverPager.append(view.list, items, url);
        view.page = page;
        view.retryCount = 0;
        CoverPager.showProgress(view, page.next ? "" : " · 已到最后一页");
        if (page.next) view.observer.observe(view.footer);
      } catch (err) {
        if (CoverPager.view !== view || !view.list.isConnected) return;
        console.warn("QidianBlocker Pagination Error:", err);
        const mayRetry = httpStatus === void 0 || httpStatus === 408 || httpStatus >= 500 || request.signal.aborted;
        const waitForScroll = mayRetry && view.retryCount < PAGE_SCROLL_RETRY_LIMIT;
        const reason = CoverPager.failureReason(httpStatus, request.signal.aborted);
        CoverPager.showProgress(view, ` · 下一页加载失败（${reason}）${waitForScroll ? " · 继续向下滚动可重试" : ""}`);
        view.retry.hidden = false;
        view.openPage.href = url;
        view.openPage.textContent = `打开第 ${view.page.number + 1} 页`;
        view.openPage.hidden = false;
        if (waitForScroll) CoverPager.waitForDownScroll(view);
      } finally {
        clearTimeout(timer);
        view.request = null;
      }
    }
  };

  // src/ui/transfer.mjs
  var Transfer = {
    exportFile: () => {
      const blob = new Blob([JSON.stringify(Storage.getMap(), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const d = /* @__PURE__ */ new Date();
      const a = document.createElement("a");
      a.href = url;
      a.download = `qidian_blocklist_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    importFile: () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.onchange = () => {
        const file = input.files[0];
        if (file) file.text().then(Transfer.importText, (err) => {
          console.error("QidianBlocker Import Error:", err);
          alert("文件读取失败，请重新选择文件。");
        }).catch(Storage.reportError);
      };
      input.click();
    },
    importText: async (text) => {
      let raw;
      try {
        raw = JSON.parse(text);
      } catch (err) {
        console.error("QidianBlocker Import Error:", err);
        alert("导入失败：文件不是有效的 JSON。");
        return;
      }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        alert("导入失败：数据格式应为 { 书籍ID: { title, time } }。");
        return;
      }
      const { map, skipped } = normalizeBlocklist(raw);
      if (Object.keys(map).length === 0) {
        alert(`未发现有效记录，已跳过 ${skipped} 条。`);
        return;
      }
      const { added, overwritten } = await Storage.merge(map);
      alert(`导入完成：新增 ${added} 条，覆盖 ${overwritten} 条，跳过 ${skipped} 条无效记录。`);
    }
  };

  // src/ui/panel.mjs
  var UNKNOWN_CATEGORY = "__unknown__";
  var Panel = {
    state: {
      searchText: "",
      sortType: "timeDesc",
      // timeDesc | timeAsc | title
      categoryFilter: "",
      // "" 表示全部，UNKNOWN_CATEGORY 表示未知分区
      subCategoryFilter: "",
      selectedIds: /* @__PURE__ */ new Set(),
      currentPage: 1,
      pageSize: 50
    },
    els: null,
    open: () => {
      if (Panel.els) return;
      Object.assign(Panel.state, { searchText: "", categoryFilter: "", subCategoryFilter: "", currentPage: 1 });
      Panel.state.selectedIds.clear();
      const overlay = document.createElement("div");
      overlay.className = "qd-modal-overlay";
      overlay.innerHTML = `
            <div class="qd-modal">
                <div class="qd-modal-header">
                    <span class="qd-modal-title">🛡️ 屏蔽管理<span class="qd-modal-count" data-el="count"></span></span>
                    <div class="qd-header-btns">
                        <button class="qd-btn" data-el="import">导入</button>
                        <button class="qd-btn" data-el="export">导出</button>
                        <button class="qd-btn qd-btn-danger" data-el="clear">全部移除</button>
                        <button class="qd-btn qd-btn-close" data-el="close" title="关闭">×</button>
                    </div>
                </div>
                <div class="qd-sync-bar">
                    <div class="qd-sync-row">
                        <span class="qd-sync-status" data-el="syncStatus"></span>
                        <button class="qd-btn" data-el="syncNow">立即同步</button>
                        <button class="qd-btn" data-el="syncSettings">同步设置</button>
                    </div>
                    <div class="qd-sync-form" data-el="syncForm" hidden>
                        <input type="text" class="qd-search-input" data-el="syncRepo" placeholder="仓库：用户名/仓库名" spellcheck="false">
                        <input type="text" class="qd-search-input" data-el="syncPath" placeholder="文件路径" spellcheck="false">
                        <input type="password" class="qd-search-input" data-el="syncToken" autocomplete="off">
                        <button class="qd-btn" data-el="syncSave">保存并同步</button>
                        <button class="qd-btn qd-btn-danger" data-el="syncDisable">停用同步</button>
                    </div>
                </div>
                <div class="qd-modal-toolbar">
                    <input type="text" class="qd-search-input" data-el="search" placeholder="搜索书名或ID...">
                    <select class="qd-select" data-el="categoryFilter" title="大分区"></select>
                    <select class="qd-select" data-el="subCategoryFilter" title="小分区"></select>
                    <select class="qd-select" data-el="sort">
                        <option value="timeDesc">时间倒序</option>
                        <option value="timeAsc">时间正序</option>
                        <option value="title">书名排序</option>
                    </select>
                </div>
                <div class="qd-batch-bar">
                    <label><input type="checkbox" class="qd-chk" data-el="selectAll">全选当前页</label>
                    <button class="qd-btn qd-btn-danger" data-el="batchDel" disabled>批量移除</button>
                </div>
                <div class="qd-modal-body" data-el="body"></div>
                <div class="qd-modal-footer">
                    <select class="qd-select" data-el="pageSize">
                        <option value="20">20 条/页</option>
                        <option value="50">50 条/页</option>
                        <option value="100">100 条/页</option>
                        <option value="200">200 条/页</option>
                    </select>
                    <div class="qd-pager">
                        <button class="qd-btn" data-el="prev">上一页</button>
                        <span class="qd-page-info" data-el="pageInfo"></span>
                        <button class="qd-btn" data-el="next">下一页</button>
                    </div>
                </div>
            </div>
        `;
      const els = { overlay };
      overlay.querySelectorAll("[data-el]").forEach((el) => {
        els[el.dataset.el] = el;
      });
      els.sort.value = Panel.state.sortType;
      els.pageSize.value = String(Panel.state.pageSize);
      const resetView = (patch) => {
        Object.assign(Panel.state, patch, { currentPage: 1 });
        Panel.state.selectedIds.clear();
        Panel.render();
        els.body.scrollTop = 0;
      };
      const gotoPage = (delta) => {
        Panel.state.currentPage += delta;
        Panel.state.selectedIds.clear();
        Panel.render();
        els.body.scrollTop = 0;
      };
      els.search.oninput = () => resetView({ searchText: els.search.value });
      els.categoryFilter.onchange = () => resetView({ categoryFilter: els.categoryFilter.value, subCategoryFilter: "" });
      els.subCategoryFilter.onchange = () => resetView({ subCategoryFilter: els.subCategoryFilter.value });
      els.sort.onchange = () => resetView({ sortType: els.sort.value });
      els.pageSize.onchange = () => resetView({ pageSize: Number(els.pageSize.value) });
      els.prev.onclick = () => gotoPage(-1);
      els.next.onclick = () => gotoPage(1);
      els.selectAll.onchange = () => {
        els.body.querySelectorAll(".qd-item-chk").forEach((cb) => {
          cb.checked = els.selectAll.checked;
          if (cb.checked) Panel.state.selectedIds.add(cb.value);
          else Panel.state.selectedIds.delete(cb.value);
        });
        Panel.syncSelection();
      };
      els.batchDel.onclick = () => {
        const ids = Array.from(Panel.state.selectedIds);
        if (ids.length && confirm(`确认要移除选中的 ${ids.length} 本书吗？`)) Storage.remove(ids).catch(Storage.reportError);
      };
      const syncConfig = Sync.getConfig();
      els.syncRepo.value = syncConfig ? syncConfig.repo : "";
      els.syncPath.value = syncConfig ? syncConfig.path : SYNC_DEFAULT_PATH;
      els.syncSettings.onclick = () => {
        els.syncForm.hidden = !els.syncForm.hidden;
      };
      els.syncNow.onclick = () => Sync.run({ force: true });
      els.syncSave.onclick = () => Panel.saveSync().catch(Storage.reportError);
      els.syncDisable.onclick = () => {
        if (confirm("确认停用同步吗？\n本机和 GitHub 上的屏蔽列表都会保留，只是不再互相同步。")) Sync.clearConfig().catch(Storage.reportError);
      };
      els.import.onclick = Transfer.importFile;
      els.export.onclick = Transfer.exportFile;
      els.clear.onclick = () => {
        if (confirm("⚠️ 确认要清空所有屏蔽记录吗？\n此操作不可恢复，建议先导出备份。")) Storage.clear().catch(Storage.reportError);
      };
      els.close.onclick = Panel.close;
      overlay.onclick = (e) => {
        if (e.target === overlay) Panel.close();
      };
      document.addEventListener("keydown", Panel.onKeydown);
      document.body.appendChild(overlay);
      Panel.els = els;
      Panel.render();
      els.search.focus();
    },
    close: () => {
      if (!Panel.els) return;
      document.removeEventListener("keydown", Panel.onKeydown);
      Panel.els.overlay.remove();
      Panel.els = null;
    },
    onKeydown: (e) => {
      if (e.key === "Escape") Panel.close();
    },
    refresh: () => {
      if (Panel.els) Panel.render();
    },
    refreshSync: () => {
      if (!Panel.els) return;
      const { els } = Panel;
      const configured = Sync.getConfig() !== null;
      els.syncStatus.textContent = Sync.describe();
      els.syncStatus.title = els.syncStatus.textContent;
      els.syncNow.disabled = !configured || Sync.isBusy();
      els.syncDisable.disabled = !configured;
      els.syncToken.placeholder = configured ? "GitHub 令牌（已保存，留空则不修改）" : "GitHub 令牌";
    },
    // 令牌只保存在脚本管理器的存储里，不会回填到输入框
    saveSync: async () => {
      const { els } = Panel;
      const config = {
        repo: els.syncRepo.value.trim(),
        path: els.syncPath.value.trim().replace(/^\/+/, ""),
        token: els.syncToken.value.trim()
      };
      if (!SYNC_REPO_PATTERN.test(config.repo)) {
        alert("仓库格式应为「用户名/仓库名」。");
        return;
      }
      if (!config.path) {
        alert("请填写文件路径。");
        return;
      }
      await Sync.saveConfig(config);
      els.syncToken.value = "";
      els.syncForm.hidden = true;
      Sync.run({ force: true });
    },
    getList: () => {
      const map = Storage.getMap();
      const { categoryFilter, subCategoryFilter } = Panel.state;
      const keyword = Panel.state.searchText.trim().toLowerCase();
      const list = Object.keys(map).map((bid) => ({ bid, ...map[bid] })).filter((item) => !categoryFilter || (item.category || UNKNOWN_CATEGORY) === categoryFilter).filter((item) => !subCategoryFilter || (item.subCategory || UNKNOWN_CATEGORY) === subCategoryFilter).filter((item) => !keyword || item.bid.includes(keyword) || item.title.toLowerCase().includes(keyword));
      const sorters = {
        timeDesc: (a, b) => b.time - a.time,
        timeAsc: (a, b) => a.time - b.time,
        title: (a, b) => a.title.localeCompare(b.title, "zh")
      };
      return list.sort(sorters[Panel.state.sortType]);
    },
    // 选项从已屏蔽的记录动态生成；当前选中项已不存在时回到「全部」
    renderFilters: () => {
      const { els, state } = Panel;
      const countBy = (entries2, key) => {
        const counts = /* @__PURE__ */ new Map();
        entries2.forEach((entry) => {
          const name = entry[key] || UNKNOWN_CATEGORY;
          counts.set(name, (counts.get(name) || 0) + 1);
        });
        return counts;
      };
      const fillSelect = (select, counts, value, allLabel, unknownLabel) => {
        const names = Array.from(counts.keys()).filter((name) => name !== UNKNOWN_CATEGORY).sort((a, b) => a.localeCompare(b, "zh"));
        if (counts.has(UNKNOWN_CATEGORY)) names.push(UNKNOWN_CATEGORY);
        select.replaceChildren(
          new Option(allLabel, ""),
          ...names.map((name) => new Option(`${name === UNKNOWN_CATEGORY ? unknownLabel : name} (${counts.get(name)})`, name))
        );
        select.value = value;
      };
      const entries = Object.values(Storage.getMap());
      const categoryCounts = countBy(entries, "category");
      if (!categoryCounts.has(state.categoryFilter)) state.categoryFilter = "";
      const subEntries = entries.filter((entry) => (entry.category || UNKNOWN_CATEGORY) === state.categoryFilter);
      const subCategoryCounts = countBy(subEntries, "subCategory");
      if (!subCategoryCounts.has(state.subCategoryFilter)) state.subCategoryFilter = "";
      fillSelect(els.categoryFilter, categoryCounts, state.categoryFilter, "全部大分区", "未知分区");
      fillSelect(els.subCategoryFilter, subCategoryCounts, state.subCategoryFilter, "全部小分区", "未知小分区");
      els.subCategoryFilter.disabled = !state.categoryFilter;
    },
    render: () => {
      const { els, state } = Panel;
      const map = Storage.getMap();
      state.selectedIds.forEach((bid) => {
        if (!hasOwn(map, bid)) state.selectedIds.delete(bid);
      });
      Panel.renderFilters();
      const list = Panel.getList();
      const totalPages = Math.max(1, Math.ceil(list.length / state.pageSize));
      state.currentPage = Math.min(Math.max(state.currentPage, 1), totalPages);
      const start = (state.currentPage - 1) * state.pageSize;
      const pageList = list.slice(start, start + state.pageSize);
      els.count.textContent = `(${Object.keys(map).length} 条)`;
      const scrollTop = els.body.scrollTop;
      els.body.replaceChildren();
      if (pageList.length === 0) {
        const tip = document.createElement("div");
        tip.className = "qd-empty-tip";
        tip.textContent = "未找到相关记录";
        els.body.appendChild(tip);
      } else {
        els.body.append(...pageList.map(Panel.createRow));
      }
      els.body.scrollTop = scrollTop;
      els.prev.disabled = state.currentPage === 1;
      els.next.disabled = state.currentPage === totalPages;
      els.pageInfo.textContent = `${state.currentPage} / ${totalPages}`;
      Panel.syncSelection();
      Panel.refreshSync();
    },
    createRow: (item) => {
      const row = document.createElement("div");
      row.className = "qd-block-item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "qd-chk qd-item-chk";
      checkbox.value = item.bid;
      checkbox.checked = Panel.state.selectedIds.has(item.bid);
      checkbox.onchange = () => {
        if (checkbox.checked) Panel.state.selectedIds.add(item.bid);
        else Panel.state.selectedIds.delete(item.bid);
        Panel.syncSelection();
      };
      const info = document.createElement("div");
      info.className = "qd-item-info";
      const title = document.createElement("a");
      title.className = "qd-item-title";
      title.href = `https://www.qidian.com/book/${item.bid}/`;
      title.target = "_blank";
      title.textContent = item.title;
      const meta = document.createElement("div");
      meta.className = "qd-item-meta";
      const categoryLabel = [item.category, item.subCategory].filter(Boolean).join(" · ") || "未知分区";
      meta.textContent = `${categoryLabel} | ID: ${item.bid} | ${formatDate(item.time)}`;
      info.append(title, meta);
      const removeBtn = document.createElement("button");
      removeBtn.className = "qd-btn";
      removeBtn.textContent = "移除";
      removeBtn.onclick = () => {
        if (confirm(`确认移除《${item.title}》吗？`)) Storage.remove([item.bid]).catch(Storage.reportError);
      };
      row.append(checkbox, info, removeBtn);
      return row;
    },
    syncSelection: () => {
      const { els, state } = Panel;
      const boxes = Array.from(els.body.querySelectorAll(".qd-item-chk"));
      const checked = boxes.filter((cb) => cb.checked).length;
      els.selectAll.disabled = boxes.length === 0;
      els.selectAll.checked = boxes.length > 0 && checked === boxes.length;
      els.selectAll.indeterminate = checked > 0 && checked < boxes.length;
      const count = state.selectedIds.size;
      els.batchDel.disabled = count === 0;
      els.batchDel.textContent = count ? `批量移除 (${count})` : "批量移除";
    }
  };

  // src/app.mjs
  var COVER_PAGER_ENABLED_KEY = "qidian_cover_pager_enabled";
  function init() {
    const isListPage = PageType.isList();
    const coverPagerEnabled = isListPage && GM_getValue(COVER_PAGER_ENABLED_KEY, true);
    const detailBid = PageType.detailBid();
    const applyDetail = () => {
      if (!detailBid || document.readyState === "loading") return;
      try {
        DetailPage.apply(detailBid);
      } catch (err) {
        console.error("QidianBlocker Error:", err);
      }
    };
    const refreshListControls = () => {
      if (document.readyState === "loading") return;
      ListPage.mountSummary();
      ListPage.renderSummary();
      if (coverPagerEnabled) CoverPager.mount();
    };
    const applyInitialPage = () => {
      if (isListPage) {
        ListPage.applyNew(document.querySelectorAll(ListPage.itemSelector));
        refreshListControls();
      } else {
        applyDetail();
      }
    };
    Storage.onSnapshot(Sync.onDataChange);
    Storage.onLocalChange(Sync.schedule);
    Storage.onChange(isListPage ? ListPage.applyChanges : applyDetail);
    Storage.onChange(Panel.refresh);
    GM_addValueChangeListener(DATA_KEY, (name, oldValue, newValue, remote) => {
      if (remote && newValue) Storage.accept(newValue);
    });
    GM_registerMenuCommand("⚙️ 管理屏蔽列表", Panel.open);
    if (isListPage) {
      GM_registerMenuCommand(`${coverPagerEnabled ? "关闭" : "开启"}内置无缝翻页`, () => {
        GM_setValue(COVER_PAGER_ENABLED_KEY, !coverPagerEnabled);
        location.reload();
      });
    }
    if (isListPage) ListPage.watch(refreshListControls, () => CoverPager.view?.list.isConnected === false);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyInitialPage);
    else applyInitialPage();
    Sync.onChange(Panel.refreshSync);
    document.addEventListener("visibilitychange", () => Sync.run({ pushOnly: document.visibilityState === "hidden" }));
    Sync.run();
  }

  // src/ui/styles.css
  var styles_default = '.qd-hidden { display: none !important; }\n\n/* 原站为 float 两列布局，条目隐藏后会错位，改为 flex 换行 */\n#book-img-text .all-img-list { display: flex !important; flex-wrap: wrap; }\n#book-img-text .all-img-list > li { float: none !important; }\n/* 非书籍条目（如无缝翻页脚本插入的分页条）原本靠 clear: both 换行，flex 下改为独占一行。\n   用 :has 而不是脚本添加的 class 判断，条目在脚本处理前就能按两列排布 */\n#book-img-text .all-img-list > :not(:has(.book-mid-info)) { flex-basis: 100%; }\n\n/* 原站用上边框分隔各行，并靠 li:first-child 和 li:first-child + li 去掉首行的上边框。\n   隐藏条目或插入分页条后「首行」不再固定，改为每个条目统一用下边框分隔，同一行的条目始终等高 */\n#book-img-text .all-img-list > li:has(.book-mid-info) { border-top: none; padding-top: 0; border-bottom: 1px solid #e6e6e6; margin-bottom: 25px; }\n.qd-list-pager, .qd-hidden-summary { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 12px; color: #666; font-size: 13px; }\n.qd-list-pager { min-height: 36px; padding: 4px 0; }\n.qd-hidden-summary { position: fixed; top: clamp(64px, 18vh, 180px); right: 16px; z-index: 4; max-width: calc(100vw - 32px); box-sizing: border-box; padding: 4px 10px; border: 1px solid #e6e6e6; border-radius: 4px; background: #fff; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08); }\n.qd-list-action { padding: 2px 6px; border: 0; background: none; color: #0060a8; cursor: pointer; }\n.qd-list-action[hidden], .qd-hidden-summary[hidden] { display: none; }\n.qd-blocked-preview .qd-block-btn { display: none; }\n.qd-blocked-preview-label { display: none; float: right; margin: 0 0 0 6px; color: #a13c35; font-size: 12px; }\n.qd-blocked-preview .qd-blocked-preview-label { display: inline; }\n\n/* 列表页屏蔽按钮：插在书名链接前并右浮动，文字模式的 a.name 是 block，放在后面会换行 */\n.qd-block-btn { float: right; margin: 2px 0 0 4px; cursor: pointer; font-size: 15px; line-height: 1; opacity: 0.5; transition: opacity 0.2s, transform 0.2s; user-select: none; }\n.qd-block-btn:hover { opacity: 1; transform: scale(1.2); }\n\n/* 详情页按钮（尺寸对齐站内 .blue-btn-detail） */\n.qd-detail-btn { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; margin-right: 12px; padding: 0; border: 1px solid #e0e0e0; border-radius: 4px; background: #fff; font-size: 20px; cursor: pointer; transition: all 0.2s; }\n.qd-detail-btn:hover { background: #f5f5f5; border-color: #ccc; }\n.qd-detail-btn.is-blocked { background: #fff0f0; border-color: #ed424b; }\n.qd-detail-btn.is-blocked:hover { background: #ed424b; }\n\n/* 管理面板 */\n.qd-modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 99999; display: flex; justify-content: center; align-items: center; }\n.qd-modal { background: #fff; width: 720px; max-width: calc(100vw - 32px); max-height: 85vh; border-radius: 8px; display: flex; flex-direction: column; box-shadow: 0 5px 25px rgba(0, 0, 0, 0.2); font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 14px; color: #333; }\n.qd-modal-header { padding: 15px 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; background: #f8f8f8; border-radius: 8px 8px 0 0; }\n.qd-modal-title { font-weight: bold; font-size: 16px; }\n.qd-modal-count { font-weight: normal; color: #666; font-size: 13px; margin-left: 5px; }\n.qd-header-btns { display: flex; align-items: center; gap: 8px; }\n.qd-sync-bar { padding: 8px 20px; border-bottom: 1px solid #eee; font-size: 13px; }\n.qd-sync-row { display: flex; align-items: center; gap: 8px; }\n.qd-sync-status { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #666; }\n.qd-sync-form { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }\n.qd-sync-form[hidden] { display: none; }\n.qd-sync-form .qd-search-input { flex: 1 1 180px; }\n.qd-modal-toolbar { padding: 10px 20px; border-bottom: 1px solid #eee; display: flex; align-items: center; gap: 10px; }\n.qd-search-input { flex: 1; padding: 6px 10px; border: 1px solid #ddd; border-radius: 4px; outline: none; }\n.qd-search-input:focus { border-color: #2a87d4; }\n.qd-select { padding: 5px 8px; border: 1px solid #ddd; border-radius: 4px; outline: none; cursor: pointer; background: #fff; font-size: 12px; }\n.qd-batch-bar { padding: 8px 20px; background: #f0f7ff; border-bottom: 1px solid #e1eaf5; display: flex; align-items: center; justify-content: space-between; font-size: 13px; }\n.qd-batch-bar label { cursor: pointer; display: flex; align-items: center; }\n.qd-modal-body { overflow-y: auto; flex: 1; min-height: 200px; }\n.qd-modal-footer { padding: 10px 20px; border-top: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; background: #fafafa; border-radius: 0 0 8px 8px; }\n.qd-pager { display: flex; align-items: center; gap: 10px; }\n.qd-page-info { font-size: 13px; color: #666; }\n.qd-block-item { padding: 10px 20px; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; }\n.qd-block-item:hover { background: #fafafa; }\n.qd-chk { margin: 0 12px 0 0; cursor: pointer; }\n.qd-item-info { flex: 1; display: flex; flex-direction: column; min-width: 0; }\n.qd-item-title { font-weight: 500; color: #333; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.qd-item-title:hover { color: #ed424b; }\n.qd-item-meta { font-size: 12px; color: #999; margin-top: 3px; }\n.qd-btn { padding: 5px 12px; border: 1px solid #ddd; background: #fff; cursor: pointer; border-radius: 4px; font-size: 12px; color: #333; transition: all 0.2s; }\n.qd-btn:hover:not(:disabled) { background: #f5f5f5; border-color: #ccc; }\n.qd-btn:disabled { opacity: 0.5; cursor: not-allowed; }\n.qd-btn-danger { color: #ed424b; border-color: #ffdbdb; background: #fff5f5; }\n.qd-btn-danger:hover:not(:disabled) { background: #ed424b; color: #fff; border-color: #ed424b; }\n.qd-btn-close { border: none; font-size: 18px; line-height: 1; padding: 2px 6px; margin-left: 4px; }\n.qd-empty-tip { text-align: center; color: #999; padding: 40px; }\n\n/* 提示条 */\n.qd-toast { position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%); z-index: 99999; display: flex; align-items: center; gap: 14px; max-width: calc(100vw - 32px); padding: 10px 16px; border-radius: 6px; background: rgba(0, 0, 0, 0.85); color: #fff; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 14px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25); }\n.qd-toast-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.qd-toast-action { flex-shrink: 0; padding: 0; border: none; background: none; color: #ffd666; font-size: 14px; cursor: pointer; }\n.qd-toast-action:hover { text-decoration: underline; }\n';

  // src/index.mjs
  GM_addStyle(styles_default);
  init();
})();
