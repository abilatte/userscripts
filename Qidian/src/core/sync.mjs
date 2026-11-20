import { diffBlocklist, hasOwn, normalizeBlocklist, serializeBlocklist } from "./blocklist.mjs";
import { formatDate } from "./date.mjs";
import { Storage } from "./storage.mjs";
import { emptySyncState, hasPending } from "./sync-state.mjs";

const SYNC_LOCK = "abilatte:qidian-blocker:sync";
const SYNC_API = "https://api.github.com";
export const SYNC_DEFAULT_PATH = "qidian/blocklist.json";
export const SYNC_REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const SYNC_PUSH_DELAY = 30 * 1000; // 本地改动后延迟上传，连续操作合并为一次提交
const SYNC_PULL_INTERVAL = 2 * 60 * 1000; // 没有本地改动时检查远端的最小间隔
const SYNC_TIMEOUT = 30 * 1000;
const SYNC_MAX_CONFLICT_RETRIES = 2;

// 屏蔽列表以 JSON 文件的形式存在用户自己的 GitHub 仓库里，多台设备通过它同步。
// - GitHub 更新文件时要求带上文件当前的 sha，远端已被其他设备改动就会拒绝，据此发现冲突
// - 本机记录「上次同步之后的改动」（新增/修改、移除），发现远端有新内容时在远端数据上重放这些改动，
//   因此另一台设备取消屏蔽的书不会因为本机的旧数据而恢复
const Base64 = {
    encode: (text) => {
        const bytes = new TextEncoder().encode(text);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
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

export const Sync = {
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
        // 换了同步位置后，旧的 sha 和改动记录不再适用，下次按首次同步处理
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
                method: method,
                url: SYNC_API + path,
                headers: {
                    "Accept": "application/vnd.github+json",
                    "Authorization": `Bearer ${active.config.token}`,
                    "X-GitHub-Api-Version": "2022-11-28",
                    ...(body ? { "Content-Type": "application/json" } : {}),
                    ...extraHeaders
                },
                data: body ? JSON.stringify(body) : undefined,
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
        // GitHub 的响应带 max-age=60，有 ETag 时用条件请求校验，否则加时间戳绕过缓存
        const path = etag ? Sync.contentsPath(config) : `${Sync.contentsPath(config)}?t=${Date.now()}`;
        const res = await Sync.request(active, "GET", path, undefined, etag ? { "If-None-Match": etag } : undefined);
        if (res.status === 304) return { notModified: true };
        if (res.status === 404) return null;
        Sync.assertOk(res);
        const meta = parseJson(res);
        if (Array.isArray(meta) || meta.type !== "file") throw new Error("同步路径指向的不是文件");

        let content = meta.content;
        if (meta.encoding !== "base64" || !content) {
            // 超过 1MB 的文件不随元数据返回内容
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
        // 导入允许跳过坏记录，同步必须保留整个远端文件；旧版字符串记录仍然有效。
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
                return (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) &&
                    Number.isFinite(Number(value)) && Number(value) >= 0;
            }
            return ["title", "category", "subCategory"].includes(key) && typeof value === "string";
        });
    },
    // 返回 { sha }；远端在读取之后又被改动时返回 { conflict: true }
    pushRemote: async (active, text, count, sha) => {
        const res = await Sync.request(active, "PUT", Sync.contentsPath(active.config), {
            message: `sync: ${count} books`,
            content: Base64.encode(text),
            ...(sha ? { sha: sha } : {})
        });
        // 409：sha 与远端不符；422 且未传 sha 且提示缺 sha：文件已存在（读取时还不存在）
        if (res.status === 409 || (res.status === 422 && !sha && isMissingShaConflict(res))) {
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
            // 首次同步：两边的记录都保留，同一本书合并字段
            Object.keys(local).forEach((bid) => { merged[bid] = { ...remote.map[bid], ...local[bid] }; });
        } else {
            state.upsert.forEach((bid) => {
                if (hasOwn(local, bid)) merged[bid] = { ...remote.map[bid], ...local[bid] };
            });
        }
        state.remove.forEach((bid) => delete merged[bid]);
        // 首次合并带入的本地记录也要进入待上传记录，冲突重试才能继续保留它们。
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
        const etag = await Sync.transact(active, (data) => (
            attempt === 0 && data.sync.sha !== null && data.sync.etag ? data.sync.etag : null
        ));
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

            const result = await Sync.pushRemote(
                active,
                Sync.serialize(pushPlan.map),
                Object.keys(pushPlan.map).length,
                pushPlan.sha
            );
            if (result.conflict) {
                if (attempt >= SYNC_MAX_CONFLICT_RETRIES) {
                    throw new Error("远端数据正在被其他设备修改，请稍后重试");
                }
                await Sync.syncOnce(active, attempt + 1);
                return;
            }
            await Sync.settle(active, pushPlan.map, result.sha, null);
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
