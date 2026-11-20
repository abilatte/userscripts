import { BID_PATTERN, Category, diffBlocklist, hasOwn, normalizeBlocklist } from "./blocklist.mjs";
import { emptySyncState, hasPending, journalChanges } from "./sync-state.mjs";

const STORAGE_KEY = "qidian_blocked_map_v5";
export const DATA_KEY = "qidian_sync_config"; // 原地迁移，避免在旧存储键里留下另一份令牌
export const STORAGE_LOCK = "abilatte:qidian-blocker:storage";
export const STORAGE_INSTANCE_KEY = "abilatte:qidian-blocker:instance";
const STORAGE_WAIT_TIMEOUT = 5000;
const SYNC_STATE_KEY = "qidian_sync_state";
const EMPTY_ANCHOR = { revision: 0, instanceId: null, rawRevision: null, rawInstance: null };

const createInstanceId = () => globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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
        // 损坏的锚点在下方统一抛出格式错误
    }
    throw new Error("本地版本锚点格式无效，请在「管理屏蔽与设置 → 设置与同步」中重置版本锚点。");
}

function restoreAnchor(anchor) {
    try {
        setLocalKey(STORAGE_LOCK, anchor.rawRevision, "0");
        setLocalKey(STORAGE_INSTANCE_KEY, anchor.rawInstance, "");
    } catch {
        // 尽力恢复，避免掩盖原始错误
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

export const Storage = {
    _data: null,
    _listeners: [],
    _snapshotListeners: [],
    _localChangeListeners: [],
    _categoryRuleListeners: [],
    _waiters: new Set(),

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
            // GM_getValue 读的是标签页缓存。锁内还要等它收到上一笔提交。
            // STORAGE_LOCK 保持纯数字版本号兼容旧标签页，实例 ID 单独保存在 STORAGE_INSTANCE_KEY；数据和令牌留在 GM 存储里。
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
            if (next.map === current.map && next.config === current.config && next.sync === current.sync &&
                next.categoryRules === current.categoryRules) return;
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
            const result = edit(map);
            const changes = diffBlocklist(data.map, map);
            const changed = hasPending(changes);
            if (changed) {
                data.map = map;
                meta.changes = changes;
                if (data.config) data.sync = journalChanges(data.sync, changes);
            }
            return { changed: changed && !!data.config, result };
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
            map[bid] = { title: title, time: Date.now(), ...category };
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
        const entries = Object.entries(updates).filter(([bid, category]) =>
            hasOwn(currentMap, bid) && Category.canFill(currentMap[bid], category));
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
        bids.forEach((bid) => { map[bid] = { ...map[bid], ...incoming[bid] }; });
        return { added: bids.length - overwritten, overwritten };
    })
};
