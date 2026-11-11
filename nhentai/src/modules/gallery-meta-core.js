    const RuntimeMetrics = {
        cacheHit: 0,
        cacheMiss: 0,
        storeHit: 0,
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

    // 完整画廊元数据的持久层：新标签页、整页刷新后复用，减少详情 API 请求与 429。
    // 使用独立数据库：给词库库（nh_helper_db）升版本会被其它标签页的旧连接阻塞。
    const GalleryMetaStore = {
        dbName: 'nh_helper_meta',
        storeName: 'gallery_meta',
        ttlMs: 7 * 24 * 60 * 60 * 1000,
        maxEntries: 1500,
        pruneDelayMs: 8000,
        dbPromise: null,
        unavailable: false,
        pruneScheduled: false,

        isEnabled() {
            return !this.unavailable && Config.get('enableMetaPersistentCache') !== false;
        },

        // 持久缓存是可选加速层：打不开（隐私模式、配额、被禁用）时记录一次并停用，请求照常走网络。
        markUnavailable(error) {
            if (this.unavailable) return;
            this.unavailable = true;
            console.warn('[nHentai Pro] 画廊元数据持久缓存不可用，本次会话改为仅用内存缓存:', error);
        },

        open() {
            if (this.dbPromise) return this.dbPromise;
            this.dbPromise = new Promise(resolve => {
                let request;
                try {
                    request = indexedDB.open(this.dbName, 1);
                } catch (error) {
                    this.markUnavailable(error);
                    resolve(null);
                    return;
                }
                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains(this.storeName)) {
                        const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                        store.createIndex('savedAt', 'savedAt');
                    }
                };
                request.onsuccess = () => {
                    const db = request.result;
                    // 其它标签页删除/升级数据库时主动让出连接，避免阻塞对方。
                    db.onversionchange = () => {
                        db.close();
                        this.dbPromise = null;
                    };
                    resolve(db);
                };
                request.onerror = () => {
                    this.markUnavailable(request.error);
                    resolve(null);
                };
                request.onblocked = () => {
                    this.markUnavailable(new Error('indexedDB open blocked'));
                    resolve(null);
                };
            });
            return this.dbPromise;
        },

        async get(id) {
            if (!this.isEnabled()) return null;
            const db = await this.open();
            if (!db) return null;
            return new Promise(resolve => {
                try {
                    const request = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(String(id));
                    request.onsuccess = () => {
                        const record = request.result;
                        const fresh = record && (Date.now() - Number(record.savedAt || 0)) < this.ttlMs;
                        resolve(fresh && isCompleteMeta(record.meta) ? record.meta : null);
                    };
                    request.onerror = () => resolve(null);
                } catch (error) {
                    this.markUnavailable(error);
                    resolve(null);
                }
            });
        },

        async put(id, meta) {
            if (!this.isEnabled() || !isCompleteMeta(meta)) return;
            const db = await this.open();
            if (!db) return;
            try {
                db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).put({
                    id: String(id),
                    savedAt: Date.now(),
                    meta
                });
                this.schedulePrune();
            } catch (error) {
                this.markUnavailable(error);
            }
        },

        // 每次会话清理一次：先删过期，再按写入时间删到上限以内。
        schedulePrune() {
            if (this.pruneScheduled) return;
            this.pruneScheduled = true;
            setTimeout(() => void this.prune(), this.pruneDelayMs);
        },

        async prune() {
            if (!this.isEnabled()) return;
            const db = await this.open();
            if (!db) return;
            try {
                const store = db.transaction(this.storeName, 'readwrite').objectStore(this.storeName);
                const index = store.index('savedAt');
                index.openCursor(IDBKeyRange.upperBound(Date.now() - this.ttlMs)).onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (!cursor) return;
                    cursor.delete();
                    cursor.continue();
                };
                const countRequest = store.count();
                countRequest.onsuccess = () => {
                    let overflow = countRequest.result - this.maxEntries;
                    if (overflow <= 0) return;
                    index.openCursor().onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (!cursor || overflow <= 0) return;
                        cursor.delete();
                        overflow -= 1;
                        cursor.continue();
                    };
                };
            } catch (error) {
                this.markUnavailable(error);
            }
        },

        // 关闭持久缓存时删除整个数据库，不留下浏览记录相关的数据。
        async clear() {
            const db = this.dbPromise ? await this.dbPromise : null;
            db?.close();
            this.dbPromise = null;
            return new Promise(resolve => {
                try {
                    const request = indexedDB.deleteDatabase(this.dbName);
                    request.onsuccess = () => resolve(true);
                    request.onerror = () => resolve(false);
                    request.onblocked = () => resolve(false);
                } catch (error) {
                    resolve(false);
                }
            });
        }
    };
