    const PageMetaResolver = {
        activeSignature: '',
        activeEntry: null,
        inFlightSignature: '',
        inFlightPromise: null,
        tagIdCache: new Map(),
        failedSignature: '',
        failedAt: 0,
        cacheTtlMs: 20 * 1000,
        failureCooldownMs: 6 * 1000,

        isFresh(entry) {
            return Boolean(entry && (Date.now() - entry.fetchedAt) < this.cacheTtlMs);
        },

        getContext() {
            const pathname = location.pathname;
            const searchParams = new URLSearchParams(location.search);
            const page = Math.max(1, Number(searchParams.get('page') || '1'));
            const sort = searchParams.get('sort') || 'date';

            if (pathname === '/') {
                return {
                    type: 'home',
                    signature: `home:${page}:${sort}`,
                    page,
                    sort
                };
            }

            if (/^\/search\/?$/.test(pathname)) {
                const query = searchParams.get('q') || '';
                return {
                    type: 'search',
                    signature: `search:${query}:${page}:${sort}`,
                    page,
                    sort,
                    query
                };
            }

            const namespaceMatch = pathname.match(/^\/(tag|artist|group|parody|character|language|category)\/([^/]+)\/?$/);
            if (namespaceMatch) {
                return {
                    type: 'namespace',
                    signature: `namespace:${namespaceMatch[1]}:${namespaceMatch[2]}:${page}:${sort}`,
                    namespace: namespaceMatch[1],
                    slug: namespaceMatch[2],
                    page,
                    sort
                };
            }

            if (
                pathname === '/user/favorites'
                || /^\/favorites\/?$/.test(pathname)
                || /^\/users\/[^/]+\/favorites\/?$/.test(pathname)
            ) {
                return {
                    type: 'favorites',
                    signature: `favorites:${pathname}:${page}`,
                    page
                };
            }

            if (/^\/users\/[^/]+\/?$/.test(pathname)) {
                return {
                    type: 'profile',
                    signature: `profile:${pathname}:${page}`,
                    page
                };
            }

            return null;
        },

        unwrapList(payload) {
            if (Array.isArray(payload)) return payload;
            if (Array.isArray(payload?.result)) return payload.result;
            if (Array.isArray(payload?.items)) return payload.items;
            if (Array.isArray(payload?.galleries)) return payload.galleries;
            if (Array.isArray(payload?.data)) return payload.data;
            return [];
        },

        unwrapObject(payload) {
            if (!payload || typeof payload !== 'object') return null;
            if (payload.id) return payload;
            if (payload.result && typeof payload.result === 'object') return payload.result;
            if (payload.data && typeof payload.data === 'object') return payload.data;
            return null;
        },

        hasAllTargets(entry, targetIds = []) {
            if (!entry?.byId || !Array.isArray(targetIds) || targetIds.length === 0) return true;
            return targetIds.every(id => entry.byId.has(String(id)));
        },

        getStoredMeta(entry, id, allowPartial = false) {
            if (!entry?.byId || !id) return null;
            const record = entry.byId.get(String(id));
            if (!record) return null;
            if (!allowPartial && !record.complete) return null;
            return record.meta || null;
        },

        hasRecentFailure(signature) {
            if (!signature || this.failedSignature !== signature) return false;
            return this.failedAt > 0 && (Date.now() - this.failedAt) < this.failureCooldownMs;
        },

        rememberFailure(signature) {
            this.failedSignature = signature;
            this.failedAt = Date.now();
        },

        getActiveEntry(signature = this.getContext()?.signature) {
            if (!signature || this.activeSignature !== signature) return null;
            return this.activeEntry;
        },

        getUserscriptMeta(id, { allowPartial = false } = {}) {
            const currentGalleryMeta = NhentaiUserscriptBridge.getCurrentGalleryMeta(id);
            if (currentGalleryMeta && (allowPartial || isCompleteMeta(currentGalleryMeta))) {
                return currentGalleryMeta;
            }
            return null;
        },

        seedFromUserscriptContext(context = this.getContext(), data = NhentaiUserscriptBridge.getData()) {
            if (!context) return null;
            const entries = NhentaiUserscriptBridge.getCurrentListEntries(context, data);
            if (!entries.length) return null;
            return this.storeEntries(context.signature, entries);
        },

        async fetchJson(endpoint) {
            return requestNhentaiApiJson(endpoint, { method: 'GET' });
        },

        async resolveNamespaceTagId(context) {
            const key = `${context.namespace}:${context.slug}`;
            if (this.tagIdCache.has(key)) return this.tagIdCache.get(key);
            const userscriptTagId = NhentaiUserscriptBridge.getCurrentTagId(context);
            if (userscriptTagId > 0) {
                this.tagIdCache.set(key, userscriptTagId);
                return userscriptTagId;
            }
            const payload = await this.fetchJson(`/api/v2/tags/${context.namespace}/${context.slug}`);
            const tagInfo = this.unwrapObject(payload);
            const tagId = Number(tagInfo?.id || 0);
            if (tagId > 0) {
                this.tagIdCache.set(key, tagId);
                return tagId;
            }
            return 0;
        },

        async fetchPageEntries(context) {
            if (!context) return [];
            if (context.type === 'home') {
                return this.unwrapList(await this.fetchJson(`/api/v2/galleries?page=${context.page}`));
            }
            if (context.type === 'search') {
                const query = encodeURIComponent(context.query || '');
                const sort = encodeURIComponent(context.sort || 'date');
                return this.unwrapList(await this.fetchJson(`/api/v2/search?query=${query}&sort=${sort}&page=${context.page}`));
            }
            if (context.type === 'namespace') {
                const tagId = await this.resolveNamespaceTagId(context);
                if (!tagId) return [];
                const sort = encodeURIComponent(context.sort || 'date');
                return this.unwrapList(await this.fetchJson(`/api/v2/galleries/tagged?tag_id=${tagId}&sort=${sort}&page=${context.page}`));
            }
            return [];
        },

        normalizeStoredMeta(entry) {
            const normalized = normalizeGalleryMeta(entry || {});
            return {
                meta: normalized,
                complete: isCompleteMeta(normalized)
            };
        },

        storeEntries(signature, entries) {
            const byId = new Map();
            entries.forEach(entry => {
                const id = String(entry?.id || '');
                if (!id) return;
                const stored = this.normalizeStoredMeta(entry);
                byId.set(id, stored);
                if (stored.complete) {
                    cache.set(id, stored.meta);
                }
            });
            const stored = { signature, fetchedAt: Date.now(), byId };
            this.activeSignature = signature;
            this.activeEntry = stored;
            return stored;
        },

        async ensureContextEntries(targetIds = []) {
            const context = this.getContext();
            if (!context) return null;
            if (this.hasRecentFailure(context.signature)) return null;

            const cachedEntry = this.getActiveEntry(context.signature);
            if (this.isFresh(cachedEntry) && this.hasAllTargets(cachedEntry, targetIds)) return cachedEntry;

            const seededEntry = this.seedFromUserscriptContext(context);
            if (seededEntry && this.hasAllTargets(seededEntry, targetIds)) {
                return seededEntry;
            }
            // 当前页列表已就绪时缺失的 id 不属于这一页（如无限滚动后地址栏已切到下一页），重复请求同一页也拿不到。
            if (seededEntry) return seededEntry;
            if (this.isFresh(cachedEntry)) return cachedEntry;
            if (this.inFlightPromise && this.inFlightSignature === context.signature) return this.inFlightPromise;

            RuntimeMetrics.pageListFetch++;
            const requestPromise = this.fetchPageEntries(context)
                .then(entries => this.storeEntries(context.signature, entries))
                .catch(error => {
                    this.rememberFailure(context.signature);
                    if (Config.get('showDevPanel')) {
                        console.debug('[nHentai Pro] Page meta fetch failed:', context.signature, error);
                    }
                    return null;
                })
                .finally(() => {
                    if (this.inFlightSignature === context.signature) {
                        this.inFlightSignature = '';
                        this.inFlightPromise = null;
                    }
                });

            this.inFlightSignature = context.signature;
            this.inFlightPromise = requestPromise;
            return requestPromise;
        },

        async resolve(id, { allowPartial = false } = {}) {
            const targetId = String(id || '');
            if (!targetId) return null;
            const userscriptMeta = this.getUserscriptMeta(targetId, { allowPartial });
            if (userscriptMeta) {
                cache.set(targetId, userscriptMeta);
                return userscriptMeta;
            }
            const context = this.getContext();
            if (!context) return null;

            const cachedEntry = this.getActiveEntry(context.signature);
            if (this.isFresh(cachedEntry) && cachedEntry.byId.has(targetId)) {
                return this.getStoredMeta(cachedEntry, targetId, allowPartial);
            }

            const entry = await this.ensureContextEntries([targetId]);
            return this.getStoredMeta(entry, targetId, allowPartial);
        },

        prewarm(galleryIds = []) {
            const missingIds = galleryIds
                .map(id => String(id || ''))
                .filter(id => id && !cache.has(id));
            if (!missingIds.length) return;
            return this.ensureContextEntries(missingIds);
        },

        rememberResolvedMeta(id, meta) {
            const context = this.getContext();
            if (!context || !meta || !id) return;
            const entry = this.getActiveEntry(context.signature);
            if (!entry?.byId) return;
            entry.byId.set(String(id), {
                meta,
                complete: true
            });
            entry.fetchedAt = Date.now();
        },

        rememberUserscriptCurrentGallery(data = NhentaiUserscriptBridge.getData()) {
            const gallery = data?.gallery;
            if (!gallery?.id) return null;
            const normalized = normalizeGalleryMeta(gallery);
            if (!isCompleteMeta(normalized)) return null;
            const id = String(gallery.id);
            cache.set(id, normalized);
            this.rememberResolvedMeta(id, normalized);
            return normalized;
        }
    };
