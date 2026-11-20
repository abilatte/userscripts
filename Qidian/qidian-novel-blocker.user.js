// ==UserScript==
// @name         起点小说屏蔽工具
// @name:en      Qidian Novel Blocker
// @namespace    abilatte
// @version      2.8
// @description  屏蔽起点「全部作品」页中不感兴趣的小说：按书籍 ID 精确屏蔽，支持图文/文字两种列表模式及内置无缝翻页、按分类批量屏蔽与自动规则，详情页一键屏蔽，管理面板支持搜索、排序、批量移除、导入导出与 GitHub 多设备同步。
// @description:en  Hide unwanted novels on Qidian's "All Works" page by book ID, supporting both cover and text list modes with seamless pagination, category batch blocking and auto rules, one-click detail page blocking, and a management panel with search, sorting, batch removal, import/export, and GitHub sync.
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
    list: COVER_LIST,
    item: `${COVER_LIST} > li`,
    link: ".book-mid-info h2 > a[data-bid]",
    category: "p.author a:not(.name):not(.go-sub-type)",
    subCategory: "a.go-sub-type",
    modeName: "图文模式"
  };
  var SELECTORS = {
    listLayouts: [
      // 图文模式，两列
      COVER_LAYOUT,
      // 文字模式
      {
        root: "#book-text",
        list: "#book-text .rank-table-list > tbody",
        item: "#book-text .rank-table-list > tbody > tr",
        link: "a.name[data-bid]",
        category: "a.type",
        subCategory: "a.go-sub-type",
        modeName: "文字模式"
      }
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

  // src/core/settings.mjs
  var COVER_PAGER_ENABLED_KEY = "qidian_cover_pager_enabled";
  var PAGER_SETTINGS_KEY = "qidian_pager_settings";
  var DEFAULT_PAGER_SETTINGS = {
    delayMs: 400,
    rateLimitRetrySec: 0,
    autoTargetPages: 0,
    autoStart: false
  };
  function clampInt(value, min, max, fallback) {
    if (value === "" || value === null || value === void 0 || typeof value === "boolean") return fallback;
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(num)));
  }
  function normalizePagerSettings(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
      delayMs: clampInt(src.delayMs, 0, 6e4, DEFAULT_PAGER_SETTINGS.delayMs),
      rateLimitRetrySec: clampInt(src.rateLimitRetrySec, 0, 600, DEFAULT_PAGER_SETTINGS.rateLimitRetrySec),
      autoTargetPages: clampInt(src.autoTargetPages, 0, 999, DEFAULT_PAGER_SETTINGS.autoTargetPages),
      autoStart: Boolean(src.autoStart)
    };
  }
  var Settings = {
    getCoverPagerEnabled: () => Boolean(GM_getValue(COVER_PAGER_ENABLED_KEY, true)),
    setCoverPagerEnabled: (enabled) => GM_setValue(COVER_PAGER_ENABLED_KEY, Boolean(enabled)),
    getPagerSettings: () => normalizePagerSettings(GM_getValue(PAGER_SETTINGS_KEY, null)),
    savePagerSettings: (patch) => {
      const next = normalizePagerSettings({ ...Settings.getPagerSettings(), ...patch });
      GM_setValue(PAGER_SETTINGS_KEY, next);
      return next;
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
    isMissing: (entry) => !entry.category || !entry.subCategory,
    canFill: (entry, incoming) => Boolean(entry && incoming && (!entry.category && incoming.category || !entry.subCategory && incoming.subCategory)),
    same: (a, b) => a.category === b.category && a.subCategory === b.subCategory,
    matches: (entry, rule) => entry.category === rule.category && (!rule.subCategory || entry.subCategory === rule.subCategory),
    label: ({ category, subCategory }) => subCategory ? `${category} / ${subCategory}` : category
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
  var serializeBlocklist = (map) => {
    const lines = Object.keys(map).sort().map((bid) => `  ${JSON.stringify(bid)}: ${JSON.stringify(normalizeEntry(map[bid]))}`);
    return lines.length ? `{
${lines.join(",\n")}
}
` : "{}\n";
  };

  // src/core/sync-state.mjs
  var emptySyncState = () => ({
    sha: null,
    etag: null,
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
  var STORAGE_INSTANCE_KEY = "abilatte:qidian-blocker:instance";
  var STORAGE_WAIT_TIMEOUT = 5e3;
  var SYNC_STATE_KEY = "qidian_sync_state";
  var createInstanceId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  function setLocalKey(key, value, zeroFallback = "") {
    if (value === null) {
      if (typeof localStorage.removeItem === "function") localStorage.removeItem(key);
      else localStorage.setItem(key, zeroFallback);
    } else {
      localStorage.setItem(key, value);
    }
  }
  function readAnchor() {
    let rawRevision;
    let rawInstance;
    try {
      rawRevision = localStorage.getItem(STORAGE_LOCK);
      rawInstance = localStorage.getItem(STORAGE_INSTANCE_KEY);
    } catch {
      throw new Error("无法读取本地版本锚点（localStorage 不可用），为避免跨标签页覆盖书单已取消写入");
    }
    if (!rawRevision) {
      return { revision: 0, instanceId: rawInstance || null, rawRevision: null, rawInstance };
    }
    if (/^\d+$/.test(rawRevision)) {
      return { revision: Number(rawRevision), instanceId: rawInstance || null, rawRevision, rawInstance };
    }
    try {
      const parsed = JSON.parse(rawRevision);
      if (parsed && typeof parsed === "object" && Number.isFinite(Number(parsed.revision))) {
        const instanceId = rawInstance || (typeof parsed.instanceId === "string" ? parsed.instanceId : null) || null;
        return { revision: Number(parsed.revision), instanceId, rawRevision, rawInstance };
      }
    } catch {
    }
    throw new Error("本地版本锚点格式无效，请在「管理屏蔽与设置 → 设置与同步」中重置版本锚点。");
  }
  function restoreAnchor(anchor) {
    try {
      setLocalKey(STORAGE_LOCK, anchor.rawRevision, "0");
      setLocalKey(STORAGE_INSTANCE_KEY, anchor.rawInstance, "");
    } catch {
    }
  }
  function writeAnchor(revision, instanceId, previousAnchor) {
    try {
      setLocalKey(STORAGE_LOCK, String(revision), "0");
      setLocalKey(STORAGE_INSTANCE_KEY, instanceId ?? null, "");
    } catch {
      restoreAnchor(previousAnchor);
      throw new Error("无法保存本地版本锚点（localStorage 不可用），为避免跨标签页覆盖书单已取消写入");
    }
  }
  function notifyAll(listeners, ...args) {
    for (const fn of listeners) {
      try {
        fn(...args);
      } catch (err) {
        console.error("QidianBlocker Listener Error:", err);
      }
    }
  }
  var Storage = {
    _data: null,
    _listeners: [],
    _snapshotListeners: [],
    _localChangeListeners: [],
    _categoryRuleListeners: [],
    _waiters: /* @__PURE__ */ new Set(),
    waitForUpdate: (ms) => new Promise((resolve) => {
      let timer = 0;
      const done = () => {
        clearTimeout(timer);
        Storage._waiters.delete(done);
        resolve();
      };
      Storage._waiters.add(done);
      timer = setTimeout(done, ms);
    }),
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
    getCategoryRules: () => Storage.getData().categoryRules ?? [],
    accept: (data, changes = null) => {
      const previous = Storage._data;
      if (previous && data.revision <= previous.revision) return;
      Storage._data = data;
      for (const wake of Array.from(Storage._waiters)) wake();
      notifyAll(Storage._snapshotListeners, data);
      if ((data.categoryRulesRevision ?? 0) !== (previous?.categoryRulesRevision ?? 0)) {
        notifyAll(Storage._categoryRuleListeners);
      }
      if (!previous || data.mapRevision !== previous.mapRevision) {
        notifyAll(Storage._listeners, data.map, previous?.map, changes);
      }
    },
    transact: async (edit) => {
      let result;
      await navigator.locks.request(STORAGE_LOCK, async () => {
        const anchor = readAnchor();
        const deadline = Date.now() + STORAGE_WAIT_TIMEOUT;
        let current = Storage.read();
        const isInstanceMismatch = () => Boolean(current.instanceId && anchor.instanceId && current.instanceId !== anchor.instanceId);
        while (current.revision < anchor.revision) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            if (current.revision === 0 || isInstanceMismatch()) {
              throw new Error("未能读取其他标签页刚保存的数据，请稍后重试。如果刚刚清空或重装了脚本数据，请在「管理屏蔽与设置 → 设置与同步」中重置版本锚点。");
            }
            throw new Error("未能读取其他标签页刚保存的数据，请稍后重试");
          }
          await Storage.waitForUpdate(Math.min(25, remaining));
          current = Storage.read();
        }
        if (isInstanceMismatch()) {
          throw new Error("检测到本地版本锚点与当前存储实例不一致，请刷新页面；如确认切换了脚本管理器或清空了数据，请在「管理屏蔽与设置 → 设置与同步」中重置版本锚点。");
        }
        Storage.accept(current);
        const next = { ...current };
        const meta = { changes: null };
        result = edit(next, meta);
        if (next.map === current.map && next.config === current.config && next.sync === current.sync && next.categoryRules === current.categoryRules) return;
        next.instanceId ??= createInstanceId();
        next.revision++;
        if (next.map !== current.map) next.mapRevision++;
        writeAnchor(next.revision, next.instanceId, anchor);
        try {
          GM_setValue(DATA_KEY, next);
        } catch (err) {
          restoreAnchor(anchor);
          throw err;
        }
        Storage.accept(next, meta.changes);
      });
      return result;
    },
    resetAnchor: () => navigator.locks.request(STORAGE_LOCK, async () => {
      const current = Storage.read();
      Storage.accept(current);
      try {
        setLocalKey(STORAGE_LOCK, current.revision > 0 ? String(current.revision) : null, "0");
        setLocalKey(STORAGE_INSTANCE_KEY, current.instanceId ?? null, "");
      } catch {
        throw new Error("无法重置本地版本锚点（localStorage 不可用）");
      }
      return current.revision;
    }),
    changeMap: async (edit) => {
      const { changed, result } = await Storage.transact((data, meta) => {
        const map = { ...data.map };
        const result2 = edit(map);
        const changes = diffBlocklist(data.map, map);
        const changed2 = hasPending(changes);
        if (changed2) {
          data.map = map;
          meta.changes = changes;
          if (data.config) data.sync = journalChanges(data.sync, changes);
        }
        return { changed: changed2 && !!data.config, result: result2 };
      });
      if (changed) notifyAll(Storage._localChangeListeners);
      return result;
    },
    onChange: (fn) => Storage._listeners.push(fn),
    onSnapshot: (fn) => Storage._snapshotListeners.push(fn),
    onLocalChange: (fn) => Storage._localChangeListeners.push(fn),
    onCategoryRulesChange: (fn) => Storage._categoryRuleListeners.push(fn),
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
    addMany: (entries) => Storage.changeMap((map) => {
      const time = Date.now();
      const added = [];
      for (const [bid, entry] of Object.entries(entries)) {
        if (!BID_PATTERN.test(bid) || !entry.title) throw new Error(`invalid book: ${bid}`);
        if (hasOwn(map, bid)) continue;
        map[bid] = { ...entry, time };
        added.push(bid);
      }
      return added;
    }),
    setCategoryRule: (selection, enabled) => Storage.transact((data) => {
      const rule = Category.build(selection.category?.trim(), selection.subCategory?.trim());
      if (!rule.category) throw new Error("请选择大类");
      const rules = data.categoryRules ?? [];
      const existing = rules.find((candidate) => Category.same(candidate, rule));
      if (Boolean(existing) === enabled) return false;
      data.categoryRules = enabled ? [...rules, rule] : rules.filter((candidate) => candidate !== existing);
      data.categoryRulesRevision = (data.categoryRulesRevision ?? 0) + 1;
      return true;
    }),
    // 只补缺失的分区字段，已有的不覆盖
    fillCategories: (updates) => {
      const currentMap = Storage.getMap();
      const entries = Object.entries(updates).filter(([bid, category]) => hasOwn(currentMap, bid) && Category.canFill(currentMap[bid], category));
      if (!entries.length) return;
      Storage.changeMap((map) => {
        entries.forEach(([bid, category]) => {
          if (hasOwn(map, bid) && Category.canFill(map[bid], category)) {
            map[bid] = { ...category, ...map[bid] };
          }
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
      const clean = base64.replace(/\s/g, "");
      if (typeof Uint8Array.fromBase64 === "function") {
        return new TextDecoder().decode(Uint8Array.fromBase64(clean));
      }
      const binary = atob(clean);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }
  };
  function parseJson(res) {
    try {
      return JSON.parse(res.responseText);
    } catch {
      throw new Error("GitHub 返回了无法解析的响应，请检查网络或代理");
    }
  }
  function readHeader(headers, name) {
    if (!headers || typeof headers !== "string") return null;
    const target = name.toLowerCase();
    for (const line of headers.split(/\r?\n/)) {
      const idx = line.indexOf(":");
      if (idx > 0 && line.slice(0, idx).trim().toLowerCase() === target) {
        return line.slice(idx + 1).trim() || null;
      }
    }
    return null;
  }
  function isMissingShaConflict(res) {
    if (!res.responseText) return true;
    try {
      const payload = JSON.parse(res.responseText);
      if (!payload || typeof payload !== "object") return true;
      return typeof payload.message !== "string" || /\bsha\b/i.test(payload.message);
    } catch {
      return true;
    }
  }
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
    serialize: serializeBlocklist,
    request: async (active, method, path, body, extraHeaders) => {
      const { pending } = await Sync.transact(active, () => ({
        // 锁内发起请求，锁外等待响应。请求期间仍可编辑书单或切换配置。
        pending: Sync.send(active, method, path, body, extraHeaders)
      }));
      return pending;
    },
    send: (active, method, path, body, extraHeaders) => {
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
            ...body ? { "Content-Type": "application/json" } : {},
            ...extraHeaders
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
        404: "仓库不存在，或令牌无权访问该仓库",
        422: "文件路径或提交参数无效（GitHub 返回 422）"
      };
      throw new Error(reasons[res.status] || `GitHub 返回了 ${res.status}`);
    },
    contentsPath: (config) => `/repos/${config.repo}/contents/${config.path.split("/").map(encodeURIComponent).join("/")}`,
    // 返回 { sha, etag, map }、{ notModified: true }；文件还不存在时返回 null
    fetchRemote: async (active, etag = null) => {
      const { config } = active;
      const path = etag ? Sync.contentsPath(config) : `${Sync.contentsPath(config)}?t=${Date.now()}`;
      const res = await Sync.request(active, "GET", path, void 0, etag ? { "If-None-Match": etag } : void 0);
      if (res.status === 304) return { notModified: true };
      if (res.status === 404) return null;
      Sync.assertOk(res);
      const meta = parseJson(res);
      if (Array.isArray(meta) || meta.type !== "file") throw new Error("同步路径指向的不是文件");
      let content = meta.content;
      if (meta.encoding !== "base64" || !content) {
        const blobRes = await Sync.request(active, "GET", `/repos/${config.repo}/git/blobs/${meta.sha}`);
        Sync.assertOk(blobRes);
        content = parseJson(blobRes).content;
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
      return { sha: meta.sha, etag: readHeader(res.responseHeaders, "etag"), map };
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
      if (res.status === 409 || res.status === 422 && !sha && isMissingShaConflict(res)) {
        return { conflict: true };
      }
      Sync.assertOk(res);
      return { sha: parseJson(res).content.sha };
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
          if (hasOwn(local, bid)) merged[bid] = { ...remote.map[bid], ...local[bid] };
        });
      }
      state.remove.forEach((bid) => delete merged[bid]);
      data.map = merged;
      data.sync = { ...state, ...diffBlocklist(remote.map, merged), sha: remote.sha };
    },
    // 本机的 uploaded 这份数据已与远端一致；请求期间又发生的本地改动留到下一次上传
    settle: async (active, uploaded, sha, etag = null) => {
      const pending = await Sync.transact(active, (data) => {
        const changes = diffBlocklist(uploaded, data.map);
        const now = Date.now();
        data.sync = { ...changes, sha, etag, lastCheckTime: now, lastSyncTime: now, lastError: "" };
        return hasPending(changes);
      });
      if (pending) Sync.schedule();
    },
    syncOnce: async (active, attempt = 0) => {
      const etag = await Sync.transact(active, (data) => attempt === 0 && data.sync.sha !== null && data.sync.etag ? data.sync.etag : null);
      const remote = await Sync.fetchRemote(active, etag);
      if (remote?.notModified) {
        const pushPlan = await Sync.transact(active, (data) => {
          if (!hasPending(data.sync)) {
            data.sync = { ...data.sync, lastCheckTime: Date.now(), lastError: "" };
            return null;
          }
          return { map: data.map, sha: data.sync.sha };
        });
        if (!pushPlan) return;
        const result2 = await Sync.pushRemote(
          active,
          Sync.serialize(pushPlan.map),
          Object.keys(pushPlan.map).length,
          pushPlan.sha
        );
        if (result2.conflict) {
          if (attempt >= SYNC_MAX_CONFLICT_RETRIES) {
            throw new Error("远端数据正在被其他设备修改，请稍后重试");
          }
          await Sync.syncOnce(active, attempt + 1);
          return;
        }
        await Sync.settle(active, pushPlan.map, result2.sha, null);
        return;
      }
      const local = await Sync.transact(active, (data) => {
        if (remote) Sync.mergeRemote(data, remote);
        return data.map;
      });
      if (remote && !hasPending(diffBlocklist(remote.map, local))) {
        await Sync.settle(active, local, remote.sha, remote.etag);
        return;
      }
      const text = Sync.serialize(local);
      const result = await Sync.pushRemote(active, text, Object.keys(local).length, remote ? remote.sha : null);
      if (result.conflict) {
        if (attempt >= SYNC_MAX_CONFLICT_RETRIES) {
          throw new Error("远端数据正在被其他设备修改，请稍后重试");
        }
        await Sync.syncOnce(active, attempt + 1);
        return;
      }
      await Sync.settle(active, local, result.sha, null);
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
      if (typeof el.showPopover === "function") {
        el.popover = "manual";
        document.body.appendChild(el);
        el.showPopover();
      } else {
        document.body.appendChild(el);
      }
      Toast.el = el;
      Toast.timer = setTimeout(Toast.hide, TOAST_DURATION);
    },
    hide: () => {
      clearTimeout(Toast.timer);
      if (Toast.el) {
        try {
          Toast.el.hidePopover?.();
        } catch {
        }
        Toast.el.remove();
      }
      Toast.el = null;
    }
  };

  // src/pages/list.mjs
  var HIDDEN_CLASS = "qd-hidden";
  var OWN_UI_SELECTOR = ".qd-modal-dialog, .qd-modal-overlay, .qd-category-dialog, .qd-toast, .qd-hidden-summary, .qd-list-pager";
  var readTitle = (link) => (link.getAttribute("title") || link.textContent).trim();
  var isOwnItemNode = (node) => node?.nodeType === Node.ELEMENT_NODE && (node.classList.contains("qd-block-btn") || node.classList.contains("qd-blocked-preview-label"));
  var isOwnUiNode = (node) => node?.nodeType === Node.ELEMENT_NODE && (node.matches(OWN_UI_SELECTOR) || Boolean(node.closest?.(OWN_UI_SELECTOR)));
  var ListPage = {
    itemSelector: SELECTORS.listLayouts.map((layout) => layout.item).join(", "),
    byItem: /* @__PURE__ */ new Map(),
    byBid: /* @__PURE__ */ new Map(),
    blocked: /* @__PURE__ */ new Set(),
    summary: null,
    reveal: false,
    pagerState: { available: false, autoPaging: false, waitingRetry: false },
    forget: (item) => {
      const record = ListPage.byItem.get(item);
      if (!record) return;
      ListPage.byItem.delete(item);
      const records = ListPage.byBid.get(record.bid);
      records.delete(record);
      if (!records.size) ListPage.byBid.delete(record.bid);
      ListPage.refreshBlocked(record.bid);
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
        current.category = Category.fromElements(item, layout);
        return current;
      }
      ListPage.forget(item);
      if (!BID_PATTERN.test(bid)) return null;
      item.querySelectorAll(".qd-block-btn, .qd-blocked-preview-label").forEach((el) => el.remove());
      const button = ListPage.createButton(bid, link, item, layout);
      link.before(button);
      const category = Category.fromElements(item, layout);
      const record = { bid, item, link, layout, category, button, label: null, blocked: false };
      ListPage.byItem.set(item, record);
      if (!ListPage.byBid.has(bid)) ListPage.byBid.set(bid, /* @__PURE__ */ new Set());
      ListPage.byBid.get(bid).add(record);
      return record;
    },
    update: (records, map) => {
      const rules = Storage.getCategoryRules();
      const updates = {};
      const changedIds = /* @__PURE__ */ new Set();
      for (const record of records) {
        const { item, bid, link, category } = record;
        const individuallyBlocked = hasOwn(map, bid);
        record.blocked = individuallyBlocked || rules.some((rule) => Category.matches(category, rule));
        changedIds.add(bid);
        ListPage.setVisibility(item, record.blocked);
        if (!record.blocked) continue;
        if (!record.label?.isConnected) {
          const label2 = document.createElement("span");
          label2.className = "qd-blocked-preview-label";
          link.before(label2);
          record.label = label2;
        }
        const label = individuallyBlocked ? "已屏蔽" : "按分类屏蔽";
        if (record.label.textContent !== label) record.label.textContent = label;
        if (individuallyBlocked && Category.canFill(map[bid], category)) {
          updates[bid] = { ...updates[bid], ...category };
        }
      }
      changedIds.forEach(ListPage.refreshBlocked);
      Storage.fillCategories(updates);
      ListPage.renderSummary();
    },
    refreshBlocked: (bid) => {
      const records = ListPage.byBid.get(bid);
      if (records && [...records].some((record) => record.blocked)) ListPage.blocked.add(bid);
      else ListPage.blocked.delete(bid);
    },
    applyNew: (items) => {
      const records = Array.from(items, ListPage.track).filter(Boolean);
      if (records.length) ListPage.update(records, Storage.getMap());
    },
    applyChanges: (map, previous, changes) => {
      const { upsert, remove } = changes ?? diffBlocklist(previous ?? {}, map);
      const records = [...upsert, ...remove].flatMap((bid) => [...ListPage.byBid.get(bid) ?? []]);
      if (records.length) ListPage.update(records, map);
    },
    applyRules: () => ListPage.update(ListPage.byItem.values(), Storage.getMap()),
    getBatchEntries: (selection) => {
      const entries = {};
      if (!selection.category) return entries;
      const map = Storage.getMap();
      for (const { bid, category, link } of ListPage.byItem.values()) {
        if (hasOwn(map, bid) || hasOwn(entries, bid) || !Category.matches(category, selection)) continue;
        const title = readTitle(link);
        if (title) entries[bid] = { title, ...category };
      }
      return entries;
    },
    mountSummary: (openCategoryPanel, onToggleAutoPage) => {
      const root = document.querySelector(SELECTORS.listLayouts.map((layout) => layout.root).join(", "));
      if (ListPage.summary?.root === root && ListPage.summary.toolbar.isConnected) return;
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
      const categories = document.createElement("button");
      categories.type = "button";
      categories.className = "qd-list-action";
      categories.textContent = "按分类屏蔽";
      categories.onclick = openCategoryPanel;
      const autoPage = document.createElement("button");
      autoPage.type = "button";
      autoPage.className = "qd-list-action";
      autoPage.hidden = true;
      autoPage.onclick = () => onToggleAutoPage?.();
      toolbar.append(status, toggle, categories, autoPage);
      document.body.append(toolbar);
      ListPage.summary = { root, toolbar, status, toggle, autoPage };
      ListPage.renderSummary();
    },
    setPagerState: (state) => {
      ListPage.pagerState = { ...ListPage.pagerState, ...state };
      ListPage.renderSummary();
    },
    setReveal: (reveal) => {
      ListPage.reveal = reveal;
      ListPage.blocked.forEach((bid) => {
        ListPage.byBid.get(bid).forEach(({ item, blocked }) => ListPage.setVisibility(item, blocked));
      });
      ListPage.renderSummary();
    },
    setVisibility: (item, blocked) => {
      item.classList.toggle(HIDDEN_CLASS, blocked && !ListPage.reveal);
      item.classList.toggle("qd-blocked-preview", blocked && ListPage.reveal);
    },
    renderSummary: () => {
      if (!ListPage.summary) return;
      const { status, toggle, autoPage } = ListPage.summary;
      const count = ListPage.blocked.size;
      toggle.hidden = count === 0 && !ListPage.reveal;
      const message = `${ListPage.reveal ? "临时显示" : "已隐藏"} ${count} 本
已加载 ${ListPage.byItem.size} 本`;
      if (status.textContent !== message) status.textContent = message;
      const action = ListPage.reveal ? "恢复隐藏" : "临时显示";
      if (toggle.textContent !== action) toggle.textContent = action;
      const { available, autoPaging, waitingRetry } = ListPage.pagerState;
      const active = Boolean(autoPaging || waitingRetry);
      autoPage.hidden = !available && !active;
      const autoLabel = active ? "停止翻页" : "自动翻页";
      if (autoPage.textContent !== autoLabel) autoPage.textContent = autoLabel;
      autoPage.classList.toggle("is-active", active);
    },
    // 解析时书目可能分段插入，观察新增子树和已有书目内的变化。
    watch: (onStructureChange, needsRefresh, onItemsChange) => {
      const { itemSelector } = ListPage;
      const structureSelector = [SELECTORS.pagination, ...SELECTORS.listLayouts.map((layout) => layout.root)].join(", ");
      const allOwnNodes = (list) => {
        for (const node of list) {
          if (node.nodeType !== Node.ELEMENT_NODE) return false;
          if (!isOwnItemNode(node) && !node.matches(OWN_UI_SELECTOR)) return false;
        }
        return true;
      };
      new MutationObserver((mutations) => {
        const items = /* @__PURE__ */ new Set();
        let structureChanged = ListPage.summary?.root.isConnected === false || ListPage.summary?.toolbar.isConnected === false || needsRefresh();
        for (const mutation of mutations) {
          const { type, target, addedNodes, removedNodes } = mutation;
          const targetEl = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
          if (isOwnUiNode(targetEl) || isOwnItemNode(targetEl)) continue;
          if (type === "childList" && allOwnNodes(addedNodes) && allOwnNodes(removedNodes)) continue;
          const parentItem = targetEl?.closest?.(itemSelector);
          if (parentItem) items.add(parentItem);
          for (const node of addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE || isOwnItemNode(node) || node.matches(OWN_UI_SELECTOR)) continue;
            if (node.matches(itemSelector)) items.add(node);
            node.querySelectorAll(itemSelector).forEach((item) => items.add(item));
            structureChanged ||= node.matches(structureSelector) || Boolean(node.querySelector(structureSelector));
          }
          if (ListPage.byItem.size > 0) {
            for (const node of removedNodes) {
              if (node.nodeType !== Node.ELEMENT_NODE || isOwnItemNode(node) || node.matches(OWN_UI_SELECTOR)) continue;
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
        }
        ListPage.applyNew(items);
        if (structureChanged) onStructureChange();
        else if (items.size) onItemsChange?.();
      }).observe(document, { childList: true, subtree: true, attributeFilter: ["data-bid"] });
    },
    // 书名和分区在点击时才读取：按钮可能在条目还没解析完整时就已创建
    createButton: (bid, link, item, layout) => {
      const btn = document.createElement("span");
      btn.className = "qd-block-btn";
      btn.textContent = "🚫";
      btn.title = "屏蔽此书";
      let busy = false;
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (busy) return;
        const title = readTitle(link);
        if (!title) {
          alert("未能读取书名，屏蔽失败。");
          return;
        }
        busy = true;
        try {
          await Storage.add(bid, title, Category.fromElements(item, layout));
          Toast.show(`已屏蔽《${title}》`, "撤销", () => Storage.remove([bid]).catch(Storage.reportError));
        } catch (err) {
          Storage.reportError(err);
        } finally {
          busy = false;
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
  var RATE_LIMIT_RETRY_LIMIT = 5;
  var RATE_LIMIT_STATUSES = /* @__PURE__ */ new Set([429, 404]);
  var resolveUrl = (raw, baseUrl) => {
    try {
      return new URL(raw, baseUrl).href;
    } catch {
      return raw;
    }
  };
  function clearTimers(view) {
    if (!view) return;
    clearTimeout(view.observeTimer);
    clearTimeout(view.autoTimer);
    clearTimeout(view.rateLimitTimer);
    clearTimeout(view.rateLimitCountdownTimer);
    view.observeTimer = 0;
    view.autoTimer = 0;
    view.rateLimitTimer = 0;
    view.rateLimitCountdownTimer = 0;
  }
  function syncStopButton(view) {
    if (!view?.stopBtn) return;
    const active = Boolean(view.autoPaging || view.rateLimitTimer);
    view.stopBtn.hidden = !active;
    view.stopBtn.textContent = view.autoPaging ? "停止翻页" : "取消重试";
  }
  function readRetryAfterSec(response) {
    const raw = response?.headers?.get?.("Retry-After")?.trim();
    if (!raw || !/^\d+$/.test(raw)) return 0;
    return Math.min(600, Number(raw));
  }
  var CoverPager = {
    view: null,
    _getSettings: () => DEFAULT_PAGER_SETTINGS,
    _stateListeners: [],
    configure: ({ getSettings } = {}) => {
      if (typeof getSettings === "function") CoverPager._getSettings = getSettings;
    },
    onStateChange: (fn) => CoverPager._stateListeners.push(fn),
    _emitState: () => {
      const state = CoverPager.getState();
      CoverPager._stateListeners.forEach((fn) => fn(state));
    },
    getState: () => ({
      available: Boolean(CoverPager.view?.page?.next),
      autoPaging: Boolean(CoverPager.view?.autoPaging),
      waitingRetry: Boolean(CoverPager.view?.rateLimitTimer)
    }),
    _readSettings: () => normalizePagerSettings(CoverPager._getSettings()),
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
    unmount: () => {
      const previous = CoverPager.view;
      if (!previous) return;
      previous.observer.disconnect();
      clearTimers(previous);
      previous.request?.abort();
      previous.scrollRetry?.abort();
      previous.footer.remove();
      CoverPager.view = null;
      CoverPager._emitState();
    },
    mount: () => {
      let layout = null;
      let list = null;
      for (const candidate of SELECTORS.listLayouts) {
        const el = document.querySelector(candidate.list);
        if (el) {
          layout = candidate;
          list = el;
          break;
        }
      }
      if (CoverPager.view?.list === list) return;
      CoverPager.unmount();
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
      const stopBtn = document.createElement("button");
      stopBtn.type = "button";
      stopBtn.className = "qd-list-action";
      stopBtn.textContent = "停止翻页";
      stopBtn.hidden = true;
      stopBtn.onclick = () => CoverPager.stopAuto(" · 已停止");
      const openPage = document.createElement("a");
      openPage.className = "qd-list-action";
      openPage.hidden = true;
      const topBtn = document.createElement("button");
      topBtn.type = "button";
      topBtn.className = "qd-list-action";
      topBtn.textContent = "回到顶部";
      topBtn.hidden = true;
      topBtn.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
      footer.append(status, retry, stopBtn, openPage, topBtn);
      list.closest(layout.root).after(footer);
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting) && retry.hidden) CoverPager.load(view);
      }, { rootMargin: `0px 0px ${PAGE_LOAD_MARGIN}px` });
      const view = {
        layout,
        list,
        footer,
        status,
        retry,
        stopBtn,
        openPage,
        topBtn,
        observer,
        page,
        request: null,
        scrollRetry: null,
        observeTimer: 0,
        autoPaging: false,
        autoTarget: 0,
        autoLoaded: 0,
        autoTimer: 0,
        retryCount: 0,
        rateLimitRetryCount: 0,
        rateLimitTimer: 0,
        rateLimitCountdownTimer: 0
      };
      CoverPager.view = view;
      retry.onclick = () => {
        view.rateLimitRetryCount = 0;
        CoverPager.load(view);
      };
      CoverPager.showProgress(view);
      observer.observe(footer);
      const settings = CoverPager._readSettings();
      if (settings.autoStart) CoverPager.startAuto(settings.autoTargetPages);
      else CoverPager._emitState();
    },
    startAuto: (targetPages) => {
      const view = CoverPager.view;
      if (!view || !view.list.isConnected || !view.page.next) return false;
      clearTimers(view);
      const raw = targetPages === void 0 ? CoverPager._readSettings().autoTargetPages : Number(targetPages);
      const target = Number.isFinite(raw) ? Math.max(0, Math.min(999, Math.trunc(raw))) : 0;
      view.autoPaging = true;
      view.autoTarget = target;
      view.autoLoaded = 0;
      view.rateLimitRetryCount = 0;
      syncStopButton(view);
      CoverPager._emitState();
      if (!view.request) CoverPager.load(view);
      return true;
    },
    stopAuto: (message = "") => {
      const view = CoverPager.view;
      if (!view) return;
      clearTimers(view);
      view.autoPaging = false;
      syncStopButton(view);
      if (!view.request) {
        if (view.page.next && view.retry.hidden) view.observer.observe(view.footer);
        if (message) CoverPager.showProgress(view, message);
      }
      CoverPager._emitState();
    },
    showProgress: (view, message = "") => {
      view.status.textContent = `已加载到第 ${view.page.number} 页${message}`;
      if (view.topBtn) view.topBtn.hidden = view.page.number <= 1;
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
        if (event.deltaY > 0 && !event.ctrlKey && !event.target?.closest?.(".qd-modal-dialog, .qd-category-dialog, .qd-modal-overlay")) {
          retry();
        }
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
    append: (list, items, baseUrl, layout = COVER_LAYOUT) => {
      const getBid = (item) => item.querySelector(layout.link)?.dataset.bid;
      const seen = /* @__PURE__ */ new Set();
      const fragment = document.createDocumentFragment();
      const cards = [];
      items.forEach((item) => {
        const bid = getBid(item);
        const existing = ListPage.byBid.get(bid);
        if (!bid || seen.has(bid) || existing && Array.from(existing).some(({ item: item2 }) => list.contains(item2))) return;
        seen.add(bid);
        const card = document.importNode(item, true);
        card.querySelectorAll("script").forEach((script) => script.remove());
        card.querySelectorAll("img").forEach((img) => {
          img.loading = "lazy";
        });
        card.querySelectorAll("a[href], img[src]").forEach((el) => {
          const attr = el.tagName === "A" ? "href" : "src";
          el.setAttribute(attr, resolveUrl(el.getAttribute(attr), baseUrl));
        });
        fragment.append(card);
        cards.push(card);
      });
      list.append(fragment);
      return cards;
    },
    load: async (view) => {
      if (CoverPager.view !== view || !view.list.isConnected || view.request || !view.page.next) return;
      const layout = view.layout ?? COVER_LAYOUT;
      clearTimers(view);
      view.scrollRetry?.abort();
      view.scrollRetry = null;
      const request = new AbortController();
      const timer = setTimeout(() => request.abort(), PAGE_LOAD_TIMEOUT);
      const url = view.page.next;
      view.request = request;
      view.observer.disconnect();
      view.retry.hidden = true;
      view.openPage.hidden = true;
      syncStopButton(view);
      CoverPager.showProgress(view, " · 正在加载下一页…");
      let httpStatus;
      let retryAfterSec = 0;
      try {
        const response = await fetch(url, {
          credentials: "same-origin",
          mode: "same-origin",
          redirect: "manual",
          signal: request.signal
        });
        httpStatus = response.status;
        if (RATE_LIMIT_STATUSES.has(httpStatus)) retryAfterSec = readRetryAfterSec(response);
        if (httpStatus !== 200) throw new Error(CoverPager.failureReason(httpStatus, false));
        const source = new DOMParser().parseFromString(await response.text(), "text/html");
        if (CoverPager.view !== view || !view.list.isConnected) return;
        const page = CoverPager.readPage(source, url);
        const items = Array.from(source.querySelectorAll(layout.item)).filter((item) => BID_PATTERN.test(item.querySelector(layout.link)?.dataset.bid ?? ""));
        if (page?.number !== view.page.number + 1 || !items.length) {
          const switched = !items.length && SELECTORS.listLayouts.find((other) => other !== layout && source.querySelector(other.root));
          throw new Error(switched ? `当前已切换为${switched.modeName}，请刷新页面或切回${layout.modeName}` : layout === COVER_LAYOUT ? "未找到下一页的图文书目" : "未找到下一页的书目");
        }
        const cards = CoverPager.append(view.list, items, url, layout);
        if (Array.isArray(cards) && cards.length > 0) ListPage.applyNew(cards);
        view.page = page;
        view.retryCount = 0;
        view.rateLimitRetryCount = 0;
        const { delayMs } = CoverPager._readSettings();
        if (view.autoPaging) {
          view.autoLoaded = (view.autoLoaded ?? 0) + 1;
          if (!page.next) {
            view.autoPaging = false;
            CoverPager.showProgress(view, " · 已到最后一页");
          } else if (view.autoTarget > 0 && view.autoLoaded >= view.autoTarget) {
            view.autoPaging = false;
            CoverPager.showProgress(view, ` · 自动翻页已完成（共翻 ${view.autoLoaded} 页）`);
            view.observeTimer = setTimeout(() => {
              view.observeTimer = 0;
              if (CoverPager.view === view && view.list.isConnected && !view.request && view.page.next && view.retry.hidden) {
                view.observer.observe(view.footer);
              }
            }, delayMs);
          } else {
            const progress = view.autoTarget > 0 ? `${view.autoLoaded}/${view.autoTarget} 页` : `已翻 ${view.autoLoaded} 页，至结尾`;
            CoverPager.showProgress(view, ` · 自动翻页中（${progress}）`);
            view.autoTimer = setTimeout(() => {
              view.autoTimer = 0;
              CoverPager.load(view);
            }, delayMs);
          }
        } else {
          CoverPager.showProgress(view, page.next ? "" : " · 已到最后一页");
          if (page.next) {
            view.observeTimer = setTimeout(() => {
              view.observeTimer = 0;
              if (CoverPager.view === view && view.list.isConnected && !view.request && view.page.next && view.retry.hidden) {
                view.observer.observe(view.footer);
              }
            }, delayMs);
          }
        }
        syncStopButton(view);
        CoverPager._emitState();
      } catch (err) {
        if (CoverPager.view !== view || !view.list.isConnected) return;
        console.warn("QidianBlocker Pagination Error:", err);
        const { rateLimitRetrySec } = CoverPager._readSettings();
        if (RATE_LIMIT_STATUSES.has(httpStatus) && rateLimitRetrySec > 0 && !request.signal.aborted) {
          if ((view.rateLimitRetryCount ?? 0) < RATE_LIMIT_RETRY_LIMIT) {
            view.rateLimitRetryCount = (view.rateLimitRetryCount ?? 0) + 1;
            const waitSec = Math.min(600, Math.max(rateLimitRetrySec, retryAfterSec));
            const retryAt = Date.now() + waitSec * 1e3;
            const attemptText = `（第 ${view.rateLimitRetryCount}/${RATE_LIMIT_RETRY_LIMIT} 次）`;
            CoverPager.showProgress(view, ` · 触发限流（HTTP ${httpStatus}），${waitSec} 秒后自动重试${attemptText}`);
            view.retry.hidden = false;
            view.openPage.href = url;
            view.openPage.textContent = `打开第 ${view.page.number + 1} 页`;
            view.openPage.hidden = false;
            view.rateLimitTimer = setTimeout(() => {
              view.rateLimitTimer = 0;
              clearTimeout(view.rateLimitCountdownTimer);
              view.rateLimitCountdownTimer = 0;
              CoverPager.load(view);
            }, waitSec * 1e3);
            const tickCountdown = () => {
              view.rateLimitCountdownTimer = 0;
              if (CoverPager.view !== view || !view.rateLimitTimer) return;
              const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1e3));
              CoverPager.showProgress(view, ` · 触发限流（HTTP ${httpStatus}），${remaining} 秒后自动重试${attemptText}`);
              if (remaining > 1) view.rateLimitCountdownTimer = setTimeout(tickCountdown, 1e3);
            };
            if (waitSec > 1) view.rateLimitCountdownTimer = setTimeout(tickCountdown, 1e3);
            syncStopButton(view);
            CoverPager._emitState();
            return;
          }
          view.autoPaging = false;
          CoverPager.showProgress(view, ` · 连续触发限流（HTTP ${httpStatus}），已停止自动重试`);
          view.retry.hidden = false;
          view.openPage.href = url;
          view.openPage.textContent = `打开第 ${view.page.number + 1} 页`;
          view.openPage.hidden = false;
          syncStopButton(view);
          CoverPager._emitState();
          return;
        }
        view.autoPaging = false;
        const mayRetry = httpStatus === void 0 || httpStatus === 408 || httpStatus >= 500 || request.signal.aborted;
        const waitForScroll = mayRetry && view.retryCount < PAGE_SCROLL_RETRY_LIMIT;
        const reason = httpStatus === 200 && !request.signal.aborted && err?.message ? err.message : CoverPager.failureReason(httpStatus, request.signal.aborted);
        CoverPager.showProgress(view, ` · 下一页加载失败（${reason}）${waitForScroll ? " · 继续向下滚动可重试" : ""}`);
        view.retry.hidden = false;
        view.openPage.href = url;
        view.openPage.textContent = `打开第 ${view.page.number + 1} 页`;
        view.openPage.hidden = false;
        syncStopButton(view);
        CoverPager._emitState();
        if (waitForScroll) CoverPager.waitForDownScroll(view);
      } finally {
        clearTimeout(timer);
        view.request = null;
      }
    }
  };

  // src/ui/category-panel.mjs
  var zhCollator = new Intl.Collator("zh");
  var sortNames = (names) => [...names].sort((a, b) => zhCollator.compare(a, b));
  function fillSelect(select, names, label) {
    const value = select.value;
    const nextOptions = [[label, ""], ...names.map((name) => [name, name])];
    const unchanged = select.options.length === nextOptions.length && nextOptions.every(([text, val], i) => select.options[i].text === text && select.options[i].value === val);
    if (!unchanged) {
      select.replaceChildren(...nextOptions.map(([text, val]) => new Option(text, val)));
    }
    select.value = names.includes(value) ? value : "";
  }
  var CategoryPanel = {
    els: null,
    mount: (container, { isListPage = false } = {}) => {
      container.innerHTML = `
            <div class="qd-category-content">
                <div class="qd-category-fields">
                    <label>大类 <select class="qd-select" data-el="category"></select></label>
                    <label>小类 <select class="qd-select" data-el="subCategory"></select></label>
                </div>
                <div class="qd-category-actions">
                    <button type="button" class="qd-btn qd-btn-danger" data-el="batch">屏蔽已加载的书</button>
                    <button type="button" class="qd-btn" data-el="addRule">添加自动屏蔽规则</button>
                </div>
                <p class="qd-category-note" data-el="batchHint" hidden>如需批量屏蔽当前页面已加载的书目，请在「全部作品」列表页打开此面板。</p>
                <p class="qd-category-feedback" data-el="status" role="status"></p>
                <h3>自动屏蔽规则</h3>
                <p class="qd-category-note">规则会隐藏之后遇到的同类书，保存在当前浏览器。</p>
                <ul class="qd-category-rules" data-el="rules"></ul>
            </div>
        `;
      const els = { container, isListPage, busy: false };
      container.querySelectorAll("[data-el]").forEach((el) => {
        els[el.dataset.el] = el;
      });
      els.batch.hidden = !isListPage;
      els.batchHint.hidden = isListPage;
      els.category.onchange = () => {
        els.subCategory.value = "";
        els.status.textContent = "";
        CategoryPanel.refresh();
      };
      els.subCategory.onchange = () => {
        els.status.textContent = "";
        CategoryPanel.refresh();
      };
      els.batch.onclick = CategoryPanel.blockLoaded;
      els.addRule.onclick = () => CategoryPanel.saveRule(CategoryPanel.selection(), true);
      CategoryPanel.els = els;
      CategoryPanel.refresh();
    },
    unmount: () => {
      CategoryPanel.els = null;
    },
    focus: () => {
      CategoryPanel.els?.category.focus();
    },
    selection: () => {
      const { category, subCategory } = CategoryPanel.els;
      return Category.build(category.value, subCategory.value);
    },
    change: async (action) => {
      const els = CategoryPanel.els;
      if (!els || els.busy) return;
      els.busy = true;
      CategoryPanel.refresh();
      try {
        els.status.textContent = await action();
      } catch (err) {
        console.error("QidianBlocker Category Error:", err);
        els.status.textContent = `操作失败：${err.message}`;
      } finally {
        els.busy = false;
        if (CategoryPanel.els === els) CategoryPanel.refresh();
      }
    },
    blockLoaded: () => {
      const selection = CategoryPanel.selection();
      const entries = ListPage.getBatchEntries(selection);
      const count = Object.keys(entries).length;
      if (!count || !confirm(`将「${Category.label(selection)}」中已加载的 ${count} 本书加入屏蔽列表？`)) return;
      return CategoryPanel.change(async () => {
        const added = await Storage.addMany(entries);
        return added.length ? `已屏蔽 ${added.length} 本书` : "这些书已在屏蔽列表中";
      });
    },
    saveRule: (rule, enabled) => CategoryPanel.change(async () => {
      const changed = await Storage.setCategoryRule(rule, enabled);
      if (enabled) return changed ? `已添加「${Category.label(rule)}」规则` : "规则已存在";
      return changed ? `已移除「${Category.label(rule)}」规则` : "规则已移除";
    }),
    refresh: () => {
      const els = CategoryPanel.els;
      if (!els) return;
      const rules = Storage.getCategoryRules();
      const categories = /* @__PURE__ */ new Map();
      const addCategory = ({ category, subCategory }) => {
        if (!category) return;
        if (!categories.has(category)) categories.set(category, /* @__PURE__ */ new Set());
        if (subCategory) categories.get(category).add(subCategory);
      };
      ListPage.byItem.forEach((record) => addCategory(record.category));
      rules.forEach(addCategory);
      Object.values(Storage.getMap()).forEach(addCategory);
      fillSelect(els.category, sortNames(categories.keys()), categories.size ? "选择大类" : "暂无可选大类");
      fillSelect(els.subCategory, sortNames(categories.get(els.category.value) ?? []), "整个大类");
      els.subCategory.disabled = !els.category.value;
      const selection = CategoryPanel.selection();
      const count = els.isListPage ? Object.keys(ListPage.getBatchEntries(selection)).length : 0;
      const coveredByCategory = Boolean(selection.subCategory) && rules.some((rule) => !rule.subCategory && rule.category === selection.category);
      const exactExists = rules.some((rule) => Category.same(rule, selection));
      els.batch.textContent = selection.category ? `屏蔽已加载的 ${count} 本` : "屏蔽已加载的书";
      els.batch.disabled = !count || els.busy;
      els.addRule.disabled = !selection.category || els.busy || exactExists || coveredByCategory;
      els.addRule.textContent = coveredByCategory ? "已被大类规则覆盖" : "添加自动屏蔽规则";
      els.rules.replaceChildren(...rules.map((rule) => {
        const item = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = Category.label(rule);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "qd-btn";
        remove.textContent = "移除规则";
        remove.setAttribute("aria-label", `移除 ${Category.label(rule)} 规则`);
        remove.disabled = els.busy;
        remove.onclick = () => CategoryPanel.saveRule(rule, false);
        item.append(label, remove);
        return item;
      }));
      if (!rules.length) {
        const empty = document.createElement("li");
        empty.textContent = "暂无规则";
        els.rules.append(empty);
      }
    }
  };

  // src/ui/transfer.mjs
  var Transfer = {
    exportFile: () => {
      const blob = new Blob([serializeBlocklist(Storage.getMap())], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const d = /* @__PURE__ */ new Date();
      const a = document.createElement("a");
      a.href = url;
      a.download = `qidian_blocklist_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1e3);
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
  var SEARCH_DEBOUNCE_MS = 120;
  var zhCollator2 = new Intl.Collator("zh");
  function fillCountSelect(select, counts, value, allLabel, unknownLabel) {
    const names = Array.from(counts.keys()).filter((name) => name !== UNKNOWN_CATEGORY).sort((a, b) => zhCollator2.compare(a, b));
    if (counts.has(UNKNOWN_CATEGORY)) names.push(UNKNOWN_CATEGORY);
    const nextOptions = [
      [allLabel, ""],
      ...names.map((name) => [`${name === UNKNOWN_CATEGORY ? unknownLabel : name} (${counts.get(name)})`, name])
    ];
    const unchanged = select.options.length === nextOptions.length && nextOptions.every(([text, val], i) => select.options[i].text === text && select.options[i].value === val);
    if (!unchanged) {
      select.replaceChildren(...nextOptions.map(([text, val]) => new Option(text, val)));
    }
    select.value = value;
  }
  var Panel = {
    state: {
      activeTab: "list",
      // list | categories | settings
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
    _options: {
      isListPage: false,
      getCoverPagerEnabled: () => true,
      setCoverPagerEnabled: () => {
      },
      getPagerSettings: () => DEFAULT_PAGER_SETTINGS,
      savePagerSettings: (patch) => normalizePagerSettings(patch),
      getPagerState: () => ({ available: false, autoPaging: false, waitingRetry: false }),
      toggleAutoPage: () => false
    },
    els: null,
    _searchTimer: 0,
    _matchedIds: [],
    configure: (options = {}) => {
      Object.assign(Panel._options, options);
    },
    open: ({ tab = "list" } = {}) => {
      if (Panel.els) {
        Panel.setTab(tab);
        return;
      }
      Object.assign(Panel.state, {
        activeTab: tab,
        searchText: "",
        categoryFilter: "",
        subCategoryFilter: "",
        currentPage: 1
      });
      Panel.state.selectedIds.clear();
      const dialog = document.createElement("dialog");
      dialog.className = "qd-modal-dialog";
      dialog.setAttribute("aria-labelledby", "qd-modal-title");
      dialog.innerHTML = `
            <div class="qd-modal">
                <div class="qd-modal-header">
                    <span class="qd-modal-title" id="qd-modal-title">🛡️ 起点小说屏蔽<span class="qd-modal-count" data-el="count"></span></span>
                    <div class="qd-header-btns">
                        <button type="button" class="qd-header-sync" data-el="headerSync"></button>
                        <button type="button" class="qd-btn qd-btn-close" data-el="close" title="关闭" aria-label="关闭">×</button>
                    </div>
                </div>
                <div class="qd-tabs" role="tablist">
                    <button type="button" role="tab" class="qd-tab" data-el="tabList" aria-selected="true">屏蔽列表</button>
                    <button type="button" role="tab" class="qd-tab" data-el="tabCategories" aria-selected="false">分类规则</button>
                    <button type="button" role="tab" class="qd-tab" data-el="tabSettings" aria-selected="false">设置与同步</button>
                </div>
                <div class="qd-tab-panel" data-el="panelList" role="tabpanel">
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
                        <div class="qd-batch-select">
                            <label><input type="checkbox" class="qd-chk" data-el="selectAll">全选当前页</label>
                            <button type="button" class="qd-list-action" data-el="selectAllMatched" hidden></button>
                        </div>
                        <button type="button" class="qd-btn qd-btn-danger" data-el="batchDel" disabled>批量移除</button>
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
                            <button type="button" class="qd-btn" data-el="prev">上一页</button>
                            <span class="qd-page-info" data-el="pageInfo"></span>
                            <button type="button" class="qd-btn" data-el="next">下一页</button>
                        </div>
                    </div>
                </div>
                <div class="qd-tab-panel qd-settings-body" data-el="panelCategories" role="tabpanel" hidden></div>
                <div class="qd-tab-panel qd-settings-body" data-el="panelSettings" role="tabpanel" hidden>
                    <section class="qd-settings-section">
                        <h3>页面功能</h3>
                        <label class="qd-setting-toggle">
                            <input type="checkbox" class="qd-chk" data-el="coverPagerToggle">
                            <span>开启「全部作品」页内置无缝翻页（支持图文与文字模式）</span>
                        </label>
                        <p class="qd-category-note">使用 Pagetual 等第三方翻页脚本时可关闭以避免重复加载；修改后立即生效。</p>
                        <div class="qd-setting-list">
                            <label class="qd-setting-row">
                                <span>翻页延迟</span>
                                <input type="number" class="qd-num-input" min="0" max="60000" step="100" data-el="pagerDelay">
                                <span class="qd-setting-hint">毫秒（每次翻页后的等待间隔）</span>
                            </label>
                            <label class="qd-setting-row">
                                <span>限流自动重试</span>
                                <input type="number" class="qd-num-input" min="0" max="600" step="1" data-el="pagerRateLimitRetry">
                                <span class="qd-setting-hint">秒（HTTP 429 / 404 后等待秒数，0 = 不自动重试）</span>
                            </label>
                            <label class="qd-setting-row">
                                <span>自动翻页目标</span>
                                <input type="number" class="qd-num-input" min="0" max="999" step="1" data-el="pagerAutoTarget">
                                <span class="qd-setting-hint">页（0 = 一直翻到结尾）</span>
                            </label>
                            <label class="qd-setting-toggle">
                                <input type="checkbox" class="qd-chk" data-el="pagerAutoStart">
                                <span>打开「全部作品」页时自动开始翻页</span>
                            </label>
                            <div class="qd-setting-row" data-el="pagerAutoActions" hidden>
                                <button type="button" class="qd-btn" data-el="pagerAutoBtn">立即开始自动翻页</button>
                            </div>
                        </div>
                    </section>
                    <section class="qd-settings-section">
                        <div class="qd-sync-head">
                            <h3>多设备同步（GitHub）</h3>
                            <button type="button" class="qd-btn" data-el="syncNow">立即同步</button>
                        </div>
                        <p class="qd-sync-status" data-el="syncStatus"></p>
                        <form class="qd-sync-form" data-el="syncForm">
                            <input type="text" class="qd-search-input" data-el="syncRepo" placeholder="仓库：用户名/仓库名" spellcheck="false">
                            <input type="text" class="qd-search-input" data-el="syncPath" placeholder="文件路径" spellcheck="false">
                            <input type="password" class="qd-search-input" data-el="syncToken" autocomplete="off">
                            <button type="submit" class="qd-btn" data-el="syncSave">保存并同步</button>
                            <button type="button" class="qd-btn qd-btn-danger" data-el="syncDisable">停用同步</button>
                        </form>
                        <p class="qd-category-note">在 GitHub 私有仓库使用 Fine-grained token（仅授权该仓库 Contents 读写权限）。令牌只保存在本地脚本管理器存储中。</p>
                    </section>
                    <section class="qd-settings-section">
                        <h3>数据备份与管理</h3>
                        <div class="qd-settings-actions">
                            <button type="button" class="qd-btn" data-el="import">导入备份</button>
                            <button type="button" class="qd-btn" data-el="export">导出备份</button>
                            <button type="button" class="qd-btn" data-el="resetAnchor">重置版本锚点</button>
                            <button type="button" class="qd-btn qd-btn-danger" data-el="clear">清空全部屏蔽记录</button>
                        </div>
                        <p class="qd-category-note">仅在清空或重装脚本数据后提示无法保存时使用；执行前请先刷新或关闭其他起点标签页。</p>
                    </section>
                </div>
            </div>
        `;
      const els = { dialog, filterKey: null, syncDirty: false };
      dialog.querySelectorAll("[data-el]").forEach((el) => {
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
        Panel.render();
        els.body.scrollTop = 0;
      };
      let composing = false;
      const scheduleSearch = () => {
        clearTimeout(Panel._searchTimer);
        Panel._searchTimer = setTimeout(() => {
          Panel._searchTimer = 0;
          if (Panel.els === els) resetView({ searchText: els.search.value });
        }, SEARCH_DEBOUNCE_MS);
      };
      els.search.addEventListener("compositionstart", () => {
        composing = true;
      });
      els.search.addEventListener("compositionend", () => {
        composing = false;
        scheduleSearch();
      });
      els.search.addEventListener("input", (e) => {
        if (!composing && !e.isComposing) scheduleSearch();
      });
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
      els.selectAllMatched.onclick = () => {
        Panel._matchedIds.forEach((bid) => Panel.state.selectedIds.add(bid));
        els.body.querySelectorAll(".qd-item-chk").forEach((cb) => {
          cb.checked = true;
        });
        Panel.syncSelection();
      };
      els.batchDel.onclick = () => {
        const ids = Array.from(Panel.state.selectedIds);
        if (ids.length && confirm(`确认要移除选中的 ${ids.length} 本书吗？`)) Storage.remove(ids).catch(Storage.reportError);
      };
      els.body.onchange = (e) => {
        const cb = e.target.closest(".qd-item-chk");
        if (!cb) return;
        if (cb.checked) Panel.state.selectedIds.add(cb.value);
        else Panel.state.selectedIds.delete(cb.value);
        Panel.syncSelection();
      };
      els.body.onclick = (e) => {
        const removeBtn = e.target.closest("[data-remove-bid]");
        if (!removeBtn) return;
        const bid = removeBtn.dataset.removeBid;
        const entry = Storage.getMap()[bid];
        if (!entry) return;
        Storage.remove([bid]).then(() => {
          Toast.show(`已移除《${entry.title}》`, "撤销", () => Storage.merge({ [bid]: entry }).catch(Storage.reportError));
        }).catch(Storage.reportError);
      };
      els.tabList.onclick = () => Panel.setTab("list");
      els.tabCategories.onclick = () => Panel.setTab("categories");
      els.tabSettings.onclick = () => Panel.setTab("settings");
      els.headerSync.onclick = () => Panel.setTab("settings");
      const updatePagerSetting = (patch) => {
        Panel._options.savePagerSettings(patch);
        Panel.refreshSettings();
      };
      els.coverPagerToggle.onchange = () => {
        Panel._options.setCoverPagerEnabled(els.coverPagerToggle.checked);
      };
      els.pagerDelay.onchange = () => updatePagerSetting({ delayMs: els.pagerDelay.value });
      els.pagerRateLimitRetry.onchange = () => updatePagerSetting({ rateLimitRetrySec: els.pagerRateLimitRetry.value });
      els.pagerAutoTarget.onchange = () => updatePagerSetting({ autoTargetPages: els.pagerAutoTarget.value });
      els.pagerAutoStart.onchange = () => updatePagerSetting({ autoStart: els.pagerAutoStart.checked });
      els.pagerAutoBtn.onclick = () => {
        const started = Panel._options.toggleAutoPage();
        Panel.refreshSettings();
        if (started) Panel.close();
      };
      const syncConfig = Sync.getConfig();
      els.syncRepo.value = syncConfig ? syncConfig.repo : "";
      els.syncPath.value = syncConfig ? syncConfig.path : SYNC_DEFAULT_PATH;
      els.syncRepo.oninput = () => {
        els.syncDirty = true;
      };
      els.syncPath.oninput = () => {
        els.syncDirty = true;
      };
      els.syncNow.onclick = () => Sync.run({ force: true });
      els.syncForm.onsubmit = (e) => {
        e.preventDefault();
        Panel.saveSync().catch(Storage.reportError);
      };
      els.syncDisable.onclick = () => {
        if (confirm("确认停用同步吗？\n本机和 GitHub 上的屏蔽列表都会保留，只是不再互相同步。")) {
          els.syncDirty = false;
          Sync.clearConfig().catch(Storage.reportError);
        }
      };
      els.import.onclick = Transfer.importFile;
      els.export.onclick = Transfer.exportFile;
      els.resetAnchor.onclick = () => {
        if (!confirm("确认重置本地版本锚点吗？\n请先确保已刷新或关闭其他已打开的起点标签页，以免覆盖未同步的更改。")) return;
        Storage.resetAnchor().then(() => {
          alert("本地版本锚点已重置，现在可以正常保存。");
        }).catch(Storage.reportError);
      };
      els.clear.onclick = () => {
        if (confirm("⚠️ 确认要清空所有屏蔽记录吗？\n此操作不可恢复，建议先导出备份。")) Storage.clear().catch(Storage.reportError);
      };
      els.close.onclick = Panel.close;
      dialog.addEventListener("click", (e) => {
        if (e.target === dialog) Panel.close();
      });
      dialog.addEventListener("close", () => {
        clearTimeout(Panel._searchTimer);
        Panel._searchTimer = 0;
        CategoryPanel.unmount();
        if (Panel.els === els) Panel.els = null;
        dialog.remove();
      }, { once: true });
      document.body.appendChild(dialog);
      Panel.els = els;
      CategoryPanel.mount(els.panelCategories, { isListPage: Panel._options.isListPage });
      Panel.render();
      dialog.showModal();
      Panel.setTab(tab);
    },
    close: () => {
      if (!Panel.els) return;
      Panel.els.dialog.close();
    },
    setTab: (tab) => {
      if (!Panel.els) return;
      const { els } = Panel;
      const valid = ["list", "categories", "settings"].includes(tab) ? tab : "list";
      Panel.state.activeTab = valid;
      const pairs = [
        ["list", els.tabList, els.panelList],
        ["categories", els.tabCategories, els.panelCategories],
        ["settings", els.tabSettings, els.panelSettings]
      ];
      for (const [name, btn, panel] of pairs) {
        const active = name === valid;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-selected", String(active));
        panel.hidden = !active;
      }
      if (valid === "list") els.search.focus();
      else if (valid === "categories") {
        CategoryPanel.refresh();
        CategoryPanel.focus();
      } else {
        Panel.refreshSettings();
        Panel.refreshSync();
        els.coverPagerToggle.focus();
      }
    },
    refresh: () => {
      if (!Panel.els) return;
      Panel.render();
    },
    refreshCategories: () => {
      if (!Panel.els) return;
      const count = Storage.getCategoryRules().length;
      Panel.els.tabCategories.textContent = count ? `分类规则 (${count})` : "分类规则";
      CategoryPanel.refresh();
    },
    refreshSettings: () => {
      if (!Panel.els) return;
      const { els } = Panel;
      const enabled = Boolean(Panel._options.getCoverPagerEnabled());
      const settings = normalizePagerSettings(Panel._options.getPagerSettings());
      const pagerState = Panel._options.getPagerState();
      const active = Boolean(pagerState.autoPaging || pagerState.waitingRetry);
      const activeEl = typeof document !== "undefined" ? document.activeElement : null;
      els.coverPagerToggle.checked = enabled;
      if (activeEl !== els.pagerDelay) els.pagerDelay.value = String(settings.delayMs);
      if (activeEl !== els.pagerRateLimitRetry) els.pagerRateLimitRetry.value = String(settings.rateLimitRetrySec);
      if (activeEl !== els.pagerAutoTarget) els.pagerAutoTarget.value = String(settings.autoTargetPages);
      els.pagerAutoStart.checked = settings.autoStart;
      els.pagerDelay.disabled = !enabled;
      els.pagerRateLimitRetry.disabled = !enabled;
      els.pagerAutoTarget.disabled = !enabled;
      els.pagerAutoStart.disabled = !enabled;
      els.pagerAutoActions.hidden = !Panel._options.isListPage;
      els.pagerAutoBtn.disabled = !enabled || !pagerState.available && !active;
      els.pagerAutoBtn.textContent = active ? "停止自动翻页" : "立即开始自动翻页";
      els.pagerAutoBtn.classList.toggle("qd-btn-danger", active);
    },
    refreshSync: () => {
      if (!Panel.els) return;
      const { els } = Panel;
      const config = Sync.getConfig();
      const configured = config !== null;
      const statusText = Sync.describe();
      const hasError = Boolean(configured && Storage.getData().sync.lastError);
      els.headerSync.textContent = statusText;
      els.headerSync.title = `${statusText}（点击前往同步设置）`;
      els.headerSync.classList.toggle("is-error", hasError);
      els.tabSettings.textContent = hasError ? "设置与同步 ⚠️" : "设置与同步";
      els.syncStatus.textContent = statusText;
      els.syncStatus.title = statusText;
      els.syncNow.disabled = !configured || Sync.isBusy();
      els.syncDisable.disabled = !configured;
      els.syncToken.placeholder = configured ? "GitHub 令牌（已保存，留空则不修改）" : "GitHub 令牌";
      if (!els.syncDirty) {
        els.syncRepo.value = config ? config.repo : "";
        els.syncPath.value = config ? config.path : SYNC_DEFAULT_PATH;
      }
    },
    // 令牌只保存在脚本管理器的存储里，不会回填到输入框
    saveSync: async () => {
      const { els } = Panel;
      const config = {
        repo: els.syncRepo.value.trim(),
        path: els.syncPath.value.trim().replace(/^\/+|\/+$/g, ""),
        token: els.syncToken.value.trim()
      };
      if (!SYNC_REPO_PATTERN.test(config.repo)) {
        alert("仓库格式应为「用户名/仓库名」。");
        return;
      }
      if (!config.path || config.path.split("/").some((seg) => !seg || seg === "." || seg === "..")) {
        alert("请填写有效的文件路径。");
        return;
      }
      await Sync.saveConfig(config);
      els.syncToken.value = "";
      els.syncDirty = false;
      Sync.run({ force: true });
    },
    getList: () => {
      const map = Storage.getMap();
      const { categoryFilter, subCategoryFilter, searchText, sortType } = Panel.state;
      const keyword = searchText.trim().toLowerCase();
      const list = [];
      for (const bid of Object.keys(map)) {
        const item = map[bid];
        if (categoryFilter && (item.category || UNKNOWN_CATEGORY) !== categoryFilter) continue;
        if (subCategoryFilter && (item.subCategory || UNKNOWN_CATEGORY) !== subCategoryFilter) continue;
        if (keyword && !bid.includes(keyword) && !item.title.toLowerCase().includes(keyword)) continue;
        list.push({ bid, ...item });
      }
      const sorters = {
        timeDesc: (a, b) => b.time - a.time,
        timeAsc: (a, b) => a.time - b.time,
        title: (a, b) => zhCollator2.compare(a.title, b.title)
      };
      return list.sort(sorters[sortType]);
    },
    // 选项从已屏蔽的记录动态生成；当前选中项已不存在时回到「全部」
    renderFilters: () => {
      const { els, state } = Panel;
      const mapRevision = Storage.getData().mapRevision ?? 0;
      const nextKey = `${mapRevision}:${state.categoryFilter}`;
      if (els.filterKey === nextKey) return;
      const countBy = (entries2, key) => {
        const counts = /* @__PURE__ */ new Map();
        entries2.forEach((entry) => {
          const name = entry[key] || UNKNOWN_CATEGORY;
          counts.set(name, (counts.get(name) || 0) + 1);
        });
        return counts;
      };
      const entries = Object.values(Storage.getMap());
      const categoryCounts = countBy(entries, "category");
      if (!categoryCounts.has(state.categoryFilter)) state.categoryFilter = "";
      const subEntries = entries.filter((entry) => (entry.category || UNKNOWN_CATEGORY) === state.categoryFilter);
      const subCategoryCounts = countBy(subEntries, "subCategory");
      if (!subCategoryCounts.has(state.subCategoryFilter)) state.subCategoryFilter = "";
      fillCountSelect(els.categoryFilter, categoryCounts, state.categoryFilter, "全部大分区", "未知分区");
      fillCountSelect(els.subCategoryFilter, subCategoryCounts, state.subCategoryFilter, "全部小分区", "未知小分区");
      els.subCategoryFilter.disabled = !state.categoryFilter;
      els.filterKey = `${mapRevision}:${state.categoryFilter}`;
    },
    render: () => {
      const { els, state } = Panel;
      const map = Storage.getMap();
      state.selectedIds.forEach((bid) => {
        if (!hasOwn(map, bid)) state.selectedIds.delete(bid);
      });
      Panel.renderFilters();
      const list = Panel.getList();
      Panel._matchedIds = list.map((item) => item.bid);
      const totalCount = Object.keys(map).length;
      const isFiltered = Boolean(state.searchText.trim() || state.categoryFilter || state.subCategoryFilter);
      const totalPages = Math.max(1, Math.ceil(list.length / state.pageSize));
      state.currentPage = Math.min(Math.max(state.currentPage, 1), totalPages);
      const start = (state.currentPage - 1) * state.pageSize;
      const pageList = list.slice(start, start + state.pageSize);
      els.count.textContent = isFiltered ? `(匹配 ${list.length} / 共 ${totalCount} 条)` : `(共 ${totalCount} 条)`;
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
      Panel.refreshCategories();
      Panel.refreshSettings();
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
      const info = document.createElement("div");
      info.className = "qd-item-info";
      const title = document.createElement("a");
      title.className = "qd-item-title";
      title.href = `https://www.qidian.com/book/${item.bid}/`;
      title.target = "_blank";
      title.rel = "noopener noreferrer";
      title.textContent = item.title;
      const meta = document.createElement("div");
      meta.className = "qd-item-meta";
      const categoryLabel = [item.category, item.subCategory].filter(Boolean).join(" · ") || "未知分区";
      meta.textContent = `${categoryLabel} | ID: ${item.bid} | ${formatDate(item.time)}`;
      info.append(title, meta);
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "qd-btn";
      removeBtn.dataset.removeBid = item.bid;
      removeBtn.textContent = "移除";
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
      const matchedCount = Panel._matchedIds.length;
      const allMatchedSelected = matchedCount > 0 && Panel._matchedIds.every((bid) => state.selectedIds.has(bid));
      els.selectAllMatched.hidden = !(matchedCount > boxes.length && !allMatchedSelected);
      if (!els.selectAllMatched.hidden) {
        els.selectAllMatched.textContent = `选择全部 ${matchedCount} 条匹配结果`;
      }
      const count = state.selectedIds.size;
      els.batchDel.disabled = count === 0;
      els.batchDel.textContent = count ? `批量移除 (${count})` : "批量移除";
    }
  };

  // src/app.mjs
  function init() {
    const isListPage = PageType.isList();
    const applyCoverPagerSetting = () => {
      if (!isListPage || document.readyState === "loading") return;
      if (Settings.getCoverPagerEnabled()) CoverPager.mount();
      else CoverPager.unmount();
    };
    const setCoverPagerEnabled = (enabled) => {
      Settings.setCoverPagerEnabled(enabled);
      applyCoverPagerSetting();
      Panel.refreshSettings();
    };
    const toggleAutoPage = () => {
      const state = CoverPager.getState();
      if (state.autoPaging || state.waitingRetry) {
        CoverPager.stopAuto(" · 已手动停止");
        return false;
      }
      if (!Settings.getCoverPagerEnabled()) return false;
      if (!CoverPager.view) CoverPager.mount();
      return CoverPager.startAuto(Settings.getPagerSettings().autoTargetPages);
    };
    CoverPager.configure({ getSettings: Settings.getPagerSettings });
    CoverPager.onStateChange((state) => {
      ListPage.setPagerState(state);
      Panel.refreshSettings();
    });
    Panel.configure({
      isListPage,
      getCoverPagerEnabled: Settings.getCoverPagerEnabled,
      setCoverPagerEnabled,
      getPagerSettings: Settings.getPagerSettings,
      savePagerSettings: Settings.savePagerSettings,
      getPagerState: CoverPager.getState,
      toggleAutoPage
    });
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
      ListPage.mountSummary(() => Panel.open({ tab: "categories" }), toggleAutoPage);
      ListPage.renderSummary();
      Panel.refreshCategories();
      applyCoverPagerSetting();
      ListPage.setPagerState(CoverPager.getState());
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
    Storage.onCategoryRulesChange(() => {
      if (isListPage) ListPage.applyRules();
      Panel.refreshCategories();
    });
    GM_addValueChangeListener(DATA_KEY, (name, oldValue, newValue, remote) => {
      if (remote && newValue) Storage.accept(newValue);
    });
    if (isListPage) {
      GM_addValueChangeListener(COVER_PAGER_ENABLED_KEY, (name, oldValue, newValue, remote) => {
        if (!remote) return;
        applyCoverPagerSetting();
        Panel.refreshSettings();
      });
      GM_addValueChangeListener(PAGER_SETTINGS_KEY, (name, oldValue, newValue, remote) => {
        if (remote) Panel.refreshSettings();
      });
    }
    GM_registerMenuCommand("管理屏蔽与设置", () => Panel.open());
    if (isListPage) ListPage.watch(refreshListControls, () => CoverPager.view?.list.isConnected === false, Panel.refreshCategories);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyInitialPage);
    else applyInitialPage();
    Sync.onChange(Panel.refreshSync);
    document.addEventListener("visibilitychange", () => Sync.run({ pushOnly: document.visibilityState === "hidden" }));
    Sync.run();
  }

  // src/ui/styles.css
  var styles_default = '.qd-hidden { display: none !important; }\n\n/* 原站为 float 两列布局，条目隐藏后会错位，改为 flex 换行 */\n#book-img-text .all-img-list { display: flex !important; flex-wrap: wrap; }\n#book-img-text .all-img-list > li { float: none !important; }\n/* 非书籍条目（如无缝翻页脚本插入的分页条）原本靠 clear: both 换行，flex 下改为独占一行。\n   用 :has 而不是脚本添加的 class 判断，条目在脚本处理前就能按两列排布 */\n#book-img-text .all-img-list > :not(:has(.book-mid-info)) { flex-basis: 100%; }\n\n/* 原站用上边框分隔各行，并靠 li:first-child 和 li:first-child + li 去掉首行的上边框。\n   隐藏条目或插入分页条后「首行」不再固定，改为每个条目统一用下边框分隔，同一行的条目始终等高 */\n#book-img-text .all-img-list > li:has(.book-mid-info) { border-top: none; padding-top: 0; border-bottom: 1px solid #e6e6e6; margin-bottom: 25px; }\n.qd-list-pager, .qd-hidden-summary { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 12px; color: #666; font-size: 13px; }\n.qd-list-pager { min-height: 36px; padding: 4px 0; }\n.qd-hidden-summary { position: fixed; top: clamp(220px, 28vh, 320px); right: 12px; z-index: 1000; flex-direction: column; align-items: stretch; flex-wrap: nowrap; gap: 4px; width: max-content; max-width: 112px; box-sizing: border-box; padding: 8px; border: 1px solid #e6e6e6; border-radius: 4px; background: #fff; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08); text-align: center; font-size: 12px; line-height: 1.4; }\n.qd-hidden-summary [role="status"] { white-space: pre-line; padding-bottom: 4px; border-bottom: 1px solid #f0f0f0; }\n.qd-list-action { padding: 2px 6px; border: 0; background: none; color: #0060a8; cursor: pointer; }\n.qd-hidden-summary .qd-list-action { padding: 3px 4px; border-radius: 3px; font-size: 12px; }\n.qd-hidden-summary .qd-list-action:hover { background: #f5f7fa; }\n.qd-hidden-summary .qd-list-action.is-active { color: #ed424b; font-weight: 600; }\n.qd-list-action[hidden], .qd-hidden-summary[hidden] { display: none; }\n.qd-blocked-preview .qd-block-btn { display: none; }\n.qd-blocked-preview-label { display: none; float: right; margin: 0 0 0 6px; color: #a13c35; font-size: 12px; }\n.qd-blocked-preview .qd-blocked-preview-label { display: inline; }\n\n/* 列表页屏蔽按钮：插在书名链接前并右浮动，文字模式的 a.name 是 block，放在后面会换行 */\n.qd-block-btn { float: right; margin: 2px 0 0 4px; cursor: pointer; font-size: 15px; line-height: 1; opacity: 0.5; transition: opacity 0.2s, transform 0.2s; user-select: none; }\n.qd-block-btn:hover { opacity: 1; transform: scale(1.2); }\n\n/* 详情页按钮（尺寸对齐站内 .blue-btn-detail） */\n.qd-detail-btn { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; margin-right: 12px; padding: 0; border: 1px solid #e0e0e0; border-radius: 4px; background: #fff; font-size: 20px; cursor: pointer; transition: all 0.2s; }\n.qd-detail-btn:hover { background: #f5f5f5; border-color: #ccc; }\n.qd-detail-btn.is-blocked { background: #fff0f0; border-color: #ed424b; }\n.qd-detail-btn.is-blocked:hover { background: #ed424b; }\n\n/* 管理面板 */\n.qd-modal-dialog { padding: 0; border: 0; background: transparent; max-width: none; max-height: none; overflow: visible; }\n.qd-modal-dialog::backdrop { background: rgba(0, 0, 0, 0.5); }\n.qd-modal { background: #fff; width: 720px; max-width: calc(100vw - 32px); max-height: 85vh; border-radius: 8px; display: flex; flex-direction: column; box-shadow: 0 5px 25px rgba(0, 0, 0, 0.2); font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 14px; color: #333; }\n.qd-modal-header { padding: 14px 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; gap: 12px; background: #f8f8f8; border-radius: 8px 8px 0 0; }\n.qd-modal-title { font-weight: bold; font-size: 16px; }\n.qd-modal-count { font-weight: normal; color: #666; font-size: 13px; margin-left: 5px; }\n.qd-header-btns { display: flex; align-items: center; gap: 8px; min-width: 0; }\n.qd-header-sync { max-width: 240px; padding: 2px 6px; border: 0; background: none; color: #666; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }\n.qd-header-sync:hover { color: #0060a8; text-decoration: underline; }\n.qd-header-sync.is-error { color: #a13c35; }\n.qd-tabs { display: flex; gap: 4px; padding: 0 20px; border-bottom: 1px solid #eee; background: #fafafa; }\n.qd-tab { padding: 9px 14px; border: 0; border-bottom: 2px solid transparent; background: none; color: #666; font-size: 13px; cursor: pointer; transition: color 0.15s, border-color 0.15s; }\n.qd-tab:hover { color: #333; }\n.qd-tab.is-active { color: #0060a8; font-weight: 600; border-bottom-color: #0060a8; }\n.qd-tab-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; }\n.qd-tab-panel[hidden] { display: none; }\n.qd-settings-body { overflow-y: auto; overscroll-behavior: contain; padding: 16px 20px; gap: 18px; }\n.qd-settings-section { padding-bottom: 16px; border-bottom: 1px solid #eee; }\n.qd-settings-section:last-child { padding-bottom: 0; border-bottom: 0; }\n.qd-settings-section h3 { margin: 0 0 8px; font-size: 14px; color: #222; }\n.qd-setting-toggle { display: inline-flex; align-items: center; cursor: pointer; }\n.qd-setting-list { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }\n.qd-setting-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; color: #333; }\n.qd-setting-row[hidden] { display: none; }\n.qd-num-input { width: 76px; padding: 4px 6px; border: 1px solid #ddd; border-radius: 4px; outline: none; font-size: 12px; }\n.qd-num-input:focus { border-color: #2a87d4; }\n.qd-num-input:disabled { background: #f5f5f5; color: #999; cursor: not-allowed; }\n.qd-setting-hint { font-size: 12px; color: #666; }\n.qd-sync-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }\n.qd-sync-head h3 { margin: 0; }\n.qd-sync-status { margin: 0 0 8px; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #666; }\n.qd-sync-form { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }\n.qd-sync-form[hidden] { display: none; }\n.qd-sync-form .qd-search-input { flex: 1 1 180px; }\n.qd-settings-actions { display: flex; flex-wrap: wrap; gap: 8px; }\n.qd-modal-toolbar { padding: 10px 20px; border-bottom: 1px solid #eee; display: flex; align-items: center; gap: 10px; }\n.qd-search-input { flex: 1; padding: 6px 10px; border: 1px solid #ddd; border-radius: 4px; outline: none; }\n.qd-search-input:focus { border-color: #2a87d4; }\n.qd-select { padding: 5px 8px; border: 1px solid #ddd; border-radius: 4px; outline: none; cursor: pointer; background: #fff; font-size: 12px; }\n.qd-batch-bar { padding: 8px 20px; background: #f0f7ff; border-bottom: 1px solid #e1eaf5; display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; }\n.qd-batch-select { display: flex; align-items: center; gap: 12px; }\n.qd-batch-bar label { cursor: pointer; display: flex; align-items: center; }\n.qd-modal-body { overflow-y: auto; flex: 1; min-height: 200px; overscroll-behavior: contain; }\n.qd-modal-footer { padding: 10px 20px; border-top: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; background: #fafafa; border-radius: 0 0 8px 8px; }\n.qd-pager { display: flex; align-items: center; gap: 10px; }\n.qd-page-info { font-size: 13px; color: #666; }\n.qd-block-item { padding: 10px 20px; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; }\n.qd-block-item:hover { background: #fafafa; }\n.qd-chk { margin: 0 12px 0 0; cursor: pointer; }\n.qd-item-info { flex: 1; display: flex; flex-direction: column; min-width: 0; }\n.qd-item-title { font-weight: 500; color: #333; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.qd-item-title:hover { color: #ed424b; }\n.qd-item-meta { font-size: 12px; color: #999; margin-top: 3px; }\n.qd-btn { padding: 5px 12px; border: 1px solid #ddd; background: #fff; cursor: pointer; border-radius: 4px; font-size: 12px; color: #333; transition: all 0.2s; }\n.qd-btn:hover:not(:disabled) { background: #f5f5f5; border-color: #ccc; }\n.qd-btn:disabled { opacity: 0.5; cursor: not-allowed; }\n.qd-btn-danger { color: #ed424b; border-color: #ffdbdb; background: #fff5f5; }\n.qd-btn-danger:hover:not(:disabled) { background: #ed424b; color: #fff; border-color: #ed424b; }\n.qd-btn-close { border: none; font-size: 18px; line-height: 1; padding: 2px 6px; margin-left: 4px; }\n.qd-empty-tip { text-align: center; color: #999; padding: 40px; }\n\n.qd-category-content { padding: 0; }\n.qd-category-fields, .qd-category-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 12px; }\n.qd-category-content h3 { margin: 14px 0 4px; font-size: 14px; }\n.qd-category-feedback { min-height: 1.5em; margin: 8px 0; }\n.qd-category-note { margin: 4px 0; font-size: 12px; color: #666; }\n.qd-category-rules { margin: 8px 0 0; padding: 0; list-style: none; }\n.qd-category-rules li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid #eee; }\n\n/* 提示条 */\n.qd-toast { position: fixed; inset: auto auto 40px 50%; left: 50%; bottom: 40px; transform: translateX(-50%); z-index: 99999; margin: 0; border: 0; display: flex; align-items: center; gap: 14px; max-width: calc(100vw - 32px); padding: 10px 16px; border-radius: 6px; background: rgba(0, 0, 0, 0.85); color: #fff; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 14px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25); }\n.qd-toast-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.qd-toast-action { flex-shrink: 0; padding: 0; border: none; background: none; color: #ffd666; font-size: 14px; cursor: pointer; }\n.qd-toast-action:hover { text-decoration: underline; }\n';

  // src/index.mjs
  GM_addStyle(styles_default);
  init();
})();
