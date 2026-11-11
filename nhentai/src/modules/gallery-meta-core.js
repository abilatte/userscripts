    const RuntimeMetrics = {
        cacheHit: 0,
        cacheMiss: 0,
        fetchOk: 0,
        fetch429: 0,
        fetchAbort: 0,
        fetchError: 0,
        prefetchScheduled: 0,
        prefetchSkipped: 0,
        pageListFetch: 0,
        failureTimestamps: [],
        recordFailure(now = Date.now()) {
            this.failureTimestamps.push(now);
            this.pruneFailures(now);
        },
        pruneFailures(now = Date.now()) {
            const threshold = now - 60 * 1000;
            while (this.failureTimestamps.length && this.failureTimestamps[0] < threshold) {
                this.failureTimestamps.shift();
            }
        },
        getRecentFailureCount() {
            this.pruneFailures();
            return this.failureTimestamps.length;
        },
        getCacheHitRate() {
            const total = this.cacheHit + this.cacheMiss;
            return total > 0 ? (this.cacheHit / total) : 0;
        }
    };

    // 完整画廊元数据缓存只由 GalleryMeta implementation 管理。
    const cache = new LRUCache(500);

    function isCompleteMeta(meta) {
        return Boolean(
            meta
            && meta.mediaId
            && Number(meta.total || 0) > 0
            && Array.isArray(meta.pages)
            && meta.pages.length > 0
            && meta.pages.every(page => page?.path)
        );
    }
