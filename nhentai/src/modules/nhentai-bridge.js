    // ===== 3.3 官方 userscript bridge 与原始事件兜底 =====
    const NhentaiUserscriptBridge = {
        updateUnsubscribe: null,
        paginationUnsubscribe: null,
        rawEventName: 'nhentai:update',
        readyTimeoutMs: 1500,
        getApi() {
            return window.nhentai_userscript_v1 || null;
        },
        getData() {
            const api = this.getApi();
            const apiData = api?.get?.();
            return apiData || window.nhentai_data_v1 || null;
        },
        waitForRawData(timeoutMs = this.readyTimeoutMs) {
            const currentData = this.getData();
            if (currentData) return Promise.resolve(currentData);

            return new Promise(resolve => {
                let timeoutId = null;
                const finish = () => {
                    window.removeEventListener(this.rawEventName, handleUpdate);
                    if (timeoutId) clearTimeout(timeoutId);
                    resolve(this.getData());
                };
                const handleUpdate = () => finish();
                timeoutId = setTimeout(finish, timeoutMs);
                window.addEventListener(this.rawEventName, handleUpdate, { once: true });
            });
        },
        async ready() {
            const api = this.getApi();
            if (api?.ready) {
                try {
                    const data = await Promise.race([
                        api.ready(),
                        this.waitForRawData()
                    ]);
                    if (data) return data;
                } catch (error) {}
            }
            return await this.waitForRawData();
        },
        getPaginationPage(data = this.getData()) {
            const page = Number(data?.pagination?.page || data?.search?.page || 1);
            return Number.isFinite(page) && page > 0 ? page : 1;
        },
        getCurrentPageName(data = this.getData()) {
            return typeof data?.page === 'string' ? data.page : '';
        },
        isPageName(pageName, candidates = []) {
            return candidates.includes(String(pageName || ''));
        },
        getCurrentTag(data = this.getData()) {
            return data?.tag || null;
        },
        matchesListContext(context, data = this.getData()) {
            if (!context || !data) return false;
            const pageName = this.getCurrentPageName(data);
            const currentPage = this.getPaginationPage(data);
            if (currentPage !== Number(context.page || 1)) return false;

            if (context.type === 'home') {
                return this.isPageName(pageName, ['homepage']);
            }
            if (context.type === 'search') {
                return this.isPageName(pageName, ['search'])
                    && String(data.search?.query || '') === String(context.query || '');
            }
            if (context.type === 'namespace') {
                const tag = this.getCurrentTag(data);
                return this.isPageName(pageName, ['tagDetail'])
                    && String(tag?.type || '') === String(context.namespace || '')
                    && String(tag?.slug || '') === String(context.slug || '');
            }
            if (context.type === 'favorites') {
                return this.isPageName(pageName, ['favorites', 'userFavorites']);
            }
            if (context.type === 'profile') {
                return this.isPageName(pageName, ['profile', 'userProfile']);
            }
            return false;
        },
        getCurrentListEntries(context, data = this.getData()) {
            if (!this.matchesListContext(context, data)) return [];
            return Array.isArray(data?.galleries) ? data.galleries : [];
        },
        getCurrentGallery(data = this.getData()) {
            return data?.gallery || null;
        },
        getCurrentGalleryMeta(id) {
            const data = this.getData();
            const gallery = this.getCurrentGallery(data);
            if (!gallery) return null;
            if (String(gallery.id || '') !== String(id || '')) return null;
            return normalizeGalleryMeta(gallery);
        },
        getCurrentTagId(context, data = this.getData()) {
            if (!this.matchesListContext(context, data)) return 0;
            const tagId = Number(this.getCurrentTag(data)?.id || 0);
            return Number.isFinite(tagId) && tagId > 0 ? tagId : 0;
        },
        onRawUpdate(callback) {
            if (typeof callback !== 'function') return () => {};
            const dispatch = () => {
                const data = this.getData();
                if (data) callback(data);
            };
            window.addEventListener(this.rawEventName, dispatch);
            dispatch();
            return () => {
                window.removeEventListener(this.rawEventName, dispatch);
            };
        },
        onUpdate(callback) {
            const api = this.getApi();
            if (!api?.onUpdate || typeof callback !== 'function') return this.onRawUpdate(callback);
            return api.onUpdate((data) => {
                callback(data || this.getData());
            });
        },
        onPagination(callback) {
            if (typeof callback !== 'function') return () => {};
            const api = this.getApi();
            if (!api?.onPagination) {
                return this.onUpdate((data) => {
                    const pagination = data?.pagination || null;
                    if (pagination) callback(pagination);
                });
            }
            return api.onPagination((pagination) => {
                callback(pagination || this.getData()?.pagination || null);
            });
        },
        onGallery(callback) {
            if (typeof callback !== 'function') return () => {};
            const api = this.getApi();
            if (!api?.onGallery) {
                return this.onUpdate((data) => {
                    const gallery = data?.gallery || null;
                    if (gallery) callback(gallery, data);
                });
            }
            return api.onGallery((gallery) => {
                const data = this.getData();
                callback(gallery || data?.gallery || null, data);
            });
        },
        onGalleries(callback) {
            if (typeof callback !== 'function') return () => {};
            const api = this.getApi();
            if (!api?.onGalleries) {
                return this.onUpdate((data) => {
                    if (Array.isArray(data?.galleries)) callback(data.galleries, data);
                });
            }
            return api.onGalleries((galleries) => {
                const data = this.getData();
                callback(Array.isArray(galleries) ? galleries : (Array.isArray(data?.galleries) ? data.galleries : []), data);
            });
        },
        whilePage(predicate, setup) {
            const api = this.getApi();
            if (api?.whilePage && typeof setup === 'function') {
                return api.whilePage(predicate, setup) || (() => {});
            }
            if (typeof setup !== 'function') return () => {};

            const matches = typeof predicate === 'function'
                ? predicate
                : (data) => data?.page === predicate;
            let cleanup = null;

            const teardown = () => {
                if (!cleanup) return;
                try {
                    cleanup();
                } catch (error) {
                    console.error('[nHentai Pro] userscript page cleanup failed:', error);
                }
                cleanup = null;
            };

            const dispatch = (data = this.getData()) => {
                const shouldMount = Boolean(data && matches(data));
                if (shouldMount && !cleanup) {
                    try {
                        cleanup = setup(data) || null;
                    } catch (error) {
                        console.error('[nHentai Pro] userscript page setup failed:', error);
                        cleanup = null;
                    }
                } else if (!shouldMount && cleanup) {
                    teardown();
                }
            };

            const unsubscribe = this.onUpdate(dispatch);
            return () => {
                unsubscribe();
                teardown();
            };
        },
        buildPageUrl(pageNumber, baseUrl = location.href) {
            const parsed = new URL(baseUrl, location.origin);
            const nextPage = Number(pageNumber || 1);
            if (!Number.isFinite(nextPage) || nextPage <= 1) {
                parsed.searchParams.delete('page');
            } else {
                parsed.searchParams.set('page', String(nextPage));
            }
            return `${parsed.origin}${parsed.pathname}${parsed.search}`;
        },
        getImageUrl(path = '', attempt = 0) {
            if (!path) return '';
            const api = this.getApi();
            const url = api?.cdn?.image?.(path, attempt);
            return typeof url === 'string' ? url : '';
        },
        syncCdnFromPageData() {
            const data = this.getData();
            const servers = data?.cdn?.image_servers;
            if (Array.isArray(servers) && servers.length) {
                CDN.imageServers = servers;
                return true;
            }
            return false;
        }
    };
