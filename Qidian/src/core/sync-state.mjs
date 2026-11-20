// sha 是待上传改动所基于的远端版本，null 表示尚未建立基线。
export const emptySyncState = () => ({
    sha: null,
    etag: null,
    upsert: [],
    remove: [],
    lastSyncTime: 0,
    lastCheckTime: 0,
    lastError: ""
});

export const hasPending = (state) => state.upsert.length > 0 || state.remove.length > 0;

export const journalChanges = (state, changes) => {
    const upsert = new Set(state.upsert);
    const remove = new Set(state.remove);
    changes.upsert.forEach((bid) => { upsert.add(bid); remove.delete(bid); });
    changes.remove.forEach((bid) => { remove.add(bid); upsert.delete(bid); });
    return { ...state, upsert: Array.from(upsert), remove: Array.from(remove) };
};
