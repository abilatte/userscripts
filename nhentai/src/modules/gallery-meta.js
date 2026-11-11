    // GalleryMeta 是画廊元数据能力的唯一外部 interface。
    // Resolver、RequestQueue、PrefetchManager 与缓存均属于内部 implementation。
    const GalleryMeta = {
        get(id, { priority = 'normal' } = {}) {
            const targetId = String(id || '').trim();
            if (!/^\d+$/.test(targetId)) return Promise.resolve(null);

            if (priority === 'interactive') {
                RequestQueue.prioritize(targetId);
            }
            return getCompleteMeta(targetId, { priority });
        },

        refresh(context = document, data = NhentaiUserscriptBridge.getData()) {
            const pageContext = PageMetaResolver.getContext();
            PageMetaResolver.seedFromUserscriptContext(pageContext, data);
            PageMetaResolver.rememberUserscriptCurrentGallery(data);
            PrefetchManager.init();
            runPageNumberDisplay(context);
            PrefetchManager.scheduleScan(60);
        },

        snapshot() {
            return Object.freeze({
                queue: Object.freeze({ ...RequestQueue.getStats() }),
                prefetch: Object.freeze({ ...PrefetchManager.getStats() })
            });
        }
    };
