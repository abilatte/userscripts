import { BID_PATTERN, diffBlocklist, hasOwn, normalizeBlocklist } from "./blocklist.mjs";
import { emptySyncState, hasPending, journalChanges } from "./sync-state.mjs";

const STORAGE_KEY = "qidian_blocked_map_v5";
export const DATA_KEY = "qidian_sync_config"; // 原地迁移，避免在旧存储键里留下另一份令牌
export const STORAGE_LOCK = "abilatte:qidian-blocker:storage";
const STORAGE_WAIT_TIMEOUT = 5000;
const SYNC_STATE_KEY = "qidian_sync_state";

export const Storage = {
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
            // GM_getValue 读的是标签页缓存。锁内还要等它收到上一笔提交。
            // 起点的 localStorage 只保存版本号，数据和令牌都留在 GM 存储里。
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
            const result = edit(map);
            const changes = diffBlocklist(data.map, map);
            const changed = hasPending(changes);
            if (changed) {
                data.map = map;
                if (data.config) data.sync = journalChanges(data.sync, changes);
            }
            return { changed: changed && !!data.config, result };
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
            map[bid] = { title: title, time: Date.now(), ...category };
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
        bids.forEach((bid) => { map[bid] = { ...map[bid], ...incoming[bid] }; });
        return { added: bids.length - overwritten, overwritten };
    })
};
