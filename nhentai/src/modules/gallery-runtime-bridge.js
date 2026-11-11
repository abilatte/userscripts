    function getGalleryNodes(context = document) {
        const unique = new Set();
        const collect = (node) => {
            if (!node) return;
            if (node.classList && node.classList.contains('gallery')) {
                unique.add(node);
            }
            if (node.querySelectorAll) {
                node.querySelectorAll(GALLERY_SELECTORS.gallery).forEach(gallery => unique.add(gallery));
            }
        };

        if (Array.isArray(context) || context instanceof Set) {
            Array.from(context).forEach(collect);
        } else {
            collect(context);
        }

        return Array.from(unique);
    }

    const SiteBlacklist = {
        tagSet: new Set(),
        syncTimer: null,
        syncAttempts: 0,
        maxSyncAttempts: 12,
        hasSyncedOnce: false,
        hookedOptions: null,
        patchedArray: null,

        getApp() {
            return window._n_app ?? window.n ?? null;
        },

        applyCurrentBlacklistState() {
            this.apply(document);
            refreshDetailQuickBlacklistButtons(document);
        },

        replaceTagSet(nextSet) {
            let changed = nextSet.size !== this.tagSet.size;
            if (!changed) {
                for (const tagId of nextSet) {
                    if (!this.tagSet.has(tagId)) {
                        changed = true;
                        break;
                    }
                }
            }

            const firstSync = !this.hasSyncedOnce;
            this.hasSyncedOnce = true;
            this.tagSet = nextSet;
            // 不在这里回写页面：来源是页面时回写会触发 blacklisted_tags setter → syncFromPage → 无限递归。
            return changed || firstSync;
        },

        syncFromPage() {
            const app = this.getApp();
            const rawList = app?.options?.blacklisted_tags;
            if (!Array.isArray(rawList)) {
                return false;
            }

            const nextSet = new Set(
                rawList
                    .map(tagId => Number(tagId))
                    .filter(tagId => Number.isFinite(tagId) && tagId > 0)
            );
            return this.replaceTagSet(nextSet);
        },

        async syncFromApi() {
            try {
                const data = await requestNhentaiApiJson(API_ENDPOINTS.blacklistIds, {
                    method: 'GET'
                });
                const rawList = Array.isArray(data)
                    ? data
                    : (Array.isArray(data?.ids)
                        ? data.ids
                        : (Array.isArray(data?.result) ? data.result : null));
                if (!Array.isArray(rawList)) {
                    return false;
                }
                const nextSet = new Set(
                    rawList
                        .map(tagId => Number(tagId))
                        .filter(tagId => Number.isFinite(tagId) && tagId > 0)
                );
                const changed = this.replaceTagSet(nextSet);
                // API 是页面之外的来源，需要同步回页面；随后的 setter → syncFromPage 读到同一集合，不会再回写。
                syncBlacklistAppOptions(nextSet);
                return changed;
            } catch (error) {
                return false;
            }
        },

        applyDiff(added = [], removed = []) {
            const nextSet = new Set(this.tagSet);
            added.forEach(tagId => {
                const normalized = Number(tagId);
                if (Number.isFinite(normalized) && normalized > 0) {
                    nextSet.add(normalized);
                }
            });
            removed.forEach(tagId => {
                const normalized = Number(tagId);
                if (Number.isFinite(normalized) && normalized > 0) {
                    nextSet.delete(normalized);
                }
            });
            this.hasSyncedOnce = true;
            this.tagSet = nextSet;
            syncBlacklistAppOptions(nextSet);
        },

        patchBlacklistArray(arrayRef) {
            if (!Array.isArray(arrayRef) || this.patchedArray === arrayRef) return;
            const methods = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'];
            methods.forEach(methodName => {
                const original = arrayRef[methodName];
                if (typeof original !== 'function' || original.__nhPatched) return;
                const wrapped = (...args) => {
                    const result = original.apply(arrayRef, args);
                    const changed = this.syncFromPage();
                    if (changed) this.applyCurrentBlacklistState();
                    return result;
                };
                wrapped.__nhPatched = true;
                arrayRef[methodName] = wrapped;
            });
            this.patchedArray = arrayRef;
        },

        hookAppOptions() {
            const app = this.getApp();
            const options = app?.options;
            if (!options || this.hookedOptions === options) {
                this.patchBlacklistArray(options?.blacklisted_tags);
                return;
            }

            const descriptor = Object.getOwnPropertyDescriptor(options, 'blacklisted_tags');
            if (descriptor && descriptor.configurable === false) {
                this.hookedOptions = options;
                this.patchBlacklistArray(options.blacklisted_tags);
                return;
            }

            let currentValue = options.blacklisted_tags;
            Object.defineProperty(options, 'blacklisted_tags', {
                configurable: true,
                enumerable: true,
                get: () => currentValue,
                set: (nextValue) => {
                    currentValue = nextValue;
                    this.patchBlacklistArray(currentValue);
                    const changed = this.syncFromPage();
                    if (changed) this.applyCurrentBlacklistState();
                }
            });
            this.hookedOptions = options;
            this.patchBlacklistArray(currentValue);
        },

        parseGalleryTags(gallery) {
            const rawTags = gallery?.dataset?.tags || gallery?.getAttribute?.('data-tags') || '';
            const rawMetaTags = gallery?.dataset?.nhTagIds || '';
            const source = `${rawTags} ${rawMetaTags}`.trim();
            if (!source) return [];
            return source
                .split(/\s+/)
                .map(tagId => Number(tagId))
                .filter(tagId => Number.isFinite(tagId) && tagId > 0);
        },

        isBlacklistedGallery(gallery) {
            if (!Config.get('enableFullBlacklistHide')) return false;
            if (gallery?.dataset?.nhBlacklisted === 'true') return true;
            if (!this.tagSet.size) return false;
            const tags = this.parseGalleryTags(gallery);
            return tags.some(tagId => this.tagSet.has(tagId));
        },

        applyToGallery(gallery) {
            if (!gallery) return;
            syncGalleryNodeMetaState(gallery);
            gallery.classList.remove(GALLERY_STATE_CLASSES.blacklisted);
            if (this.isBlacklistedGallery(gallery)) {
                gallery.classList.add(GALLERY_STATE_CLASSES.blacklisted);
            }
        },

        apply(context = document) {
            const galleries = getGalleryNodes(context);
            if (!galleries.length) return;
            galleries.forEach(gallery => this.applyToGallery(gallery));
        },

        scheduleSync(delay = 300) {
            if (this.syncTimer) return;
            this.syncTimer = setTimeout(async () => {
                this.syncTimer = null;
                this.syncAttempts += 1;
                this.hookAppOptions();
                let synced = this.syncFromPage();
                if (!synced && isUserLoggedIn()) {
                    synced = await this.syncFromApi();
                }
                if (synced) {
                    this.applyCurrentBlacklistState();
                }

                if (!this.hasSyncedOnce && this.syncAttempts < this.maxSyncAttempts) {
                    this.scheduleSync(Math.min(1800, delay + 200));
                }
            }, delay);
        },

        init() {
            this.syncAttempts = 0;
            this.hasSyncedOnce = false;
            this.hookedOptions = null;
            this.patchedArray = null;
            this.hookAppOptions();
            this.scheduleSync(120);
        }
    };

    function applyGalleryVisibility(galleries, langIds = Config.get('langFilter')) {
        if (!galleries.length) return;
        const showAllLangs = langIds.length === 0 || langIds.length === 3;

        galleries.forEach(gallery => {
            gallery.classList.remove(GALLERY_STATE_CLASSES.hidden);
            SiteBlacklist.applyToGallery(gallery);

            if (!showAllLangs && !resolveGalleryLanguageMatch(gallery, langIds)) {
                gallery.classList.add(GALLERY_STATE_CLASSES.hidden);
            }
        });
    }

    function runLanguageFilter(context = document, langIds = Config.get('langFilter')) {
        const galleries = getGalleryNodes(context);
        if (galleries.length === 0) return;
        applyGalleryVisibility(galleries, langIds);
    }

    function refreshGalleryEnhancements(
        context = document,
        { translate = false, metaData = NhentaiUserscriptBridge.getData() } = {}
    ) {
        GalleryMeta.refresh(context, metaData);
        const galleries = getGalleryNodes(context);
        if (!galleries.length) {
            if (translate) runContentTranslation(context);
            return;
        }
        applyGalleryVisibility(galleries);
        galleries.forEach(initPreviewUI);
        if (translate) runContentTranslation(context);
    }

    function resetSingleGalleryEnhancementState(gallery) {
        if (!gallery) return;

        if (hoveredGallery === gallery) {
            hoveredGallery = null;
        }
        if (typeof resetPreviewPopupSession === 'function') {
            resetPreviewPopupSession(true);
        } else if (typeof hidePreviewPopup === 'function') {
            hidePreviewPopup(true);
        }
        gallery.classList.remove(
            GALLERY_STATE_CLASSES.hidden,
            GALLERY_STATE_CLASSES.blacklisted,
            GALLERY_STATE_CLASSES.previewing
        );
        delete gallery.dataset.init;
        delete gallery.dataset.gid;
        delete gallery.dataset.tagsLoaded;
        delete gallery.dataset.nhTagIds;
        delete gallery.dataset.nhBlacklisted;

        const cover = gallery.querySelector(GALLERY_SELECTORS.coverLink);
        if (cover) {
            delete cover.dataset.pageProcessed;
            queryAll(cover, '.nh-page-number, .inline-preview-ui').forEach(node => node.remove());
        }
        queryAll(gallery, '.nh-page-number').forEach(node => {
            if (node.parentElement !== cover) node.remove();
        });
    }

    function resetGalleryEnhancementState(context = document) {
        const galleries = getGalleryNodes(context);
        if (!galleries.length) return;

        hoveredGallery = null;
        if (hoverTimeout) {
            clearTimeout(hoverTimeout);
            hoverTimeout = null;
        }
        states.clear();

        galleries.forEach(gallery => {
            resetSingleGalleryEnhancementState(gallery);
        });
    }

    const OBSERVED_GALLERY_CLASS_IGNORES = new Set([
        'downloaded',
        'uncensored'
    ]);

    function normalizeObservedGalleryClassName(className = '') {
        return String(className)
            .split(/\s+/)
            .filter(token => (
                token
                && token !== GALLERY_STATE_CLASSES.previewing
                && !token.startsWith('nh-')
                && !token.startsWith('nhentai-helper-')
                && !OBSERVED_GALLERY_CLASS_IGNORES.has(token)
            ))
            .sort()
            .join(' ');
    }

    let routeRefreshGeneration = 0;
    let routeRefreshTimers = [];
    let userscriptRouteUnsubscribe = null;
    let routeWatcherIntervalId = 0;

    function clearScheduledRouteRefresh() {
        routeRefreshTimers.forEach(timer => clearTimeout(timer));
        routeRefreshTimers = [];
    }

    function runRouteRefreshPass(generation, { resetGalleryState = false } = {}) {
        if (generation !== routeRefreshGeneration) return;
        if (typeof resetPreviewPopupSession === 'function') {
            resetPreviewPopupSession(true);
        } else if (typeof hidePreviewPopup === 'function') {
            hidePreviewPopup(true);
        }
        if (resetGalleryState) {
            resetGalleryEnhancementState(document);
        }
        resetTagTranslationState(document);
        refreshNavbarUI();
        runUITranslation(document);
        refreshGalleryEnhancements(document, { translate: true });
        InfiniteScroll.init();
        ReadingMode.refresh();
    }

    function scheduleRouteRefresh({ source = 'fallback' } = {}) {
        routeRefreshGeneration += 1;
        const generation = routeRefreshGeneration;
        clearScheduledRouteRefresh();

        const passes = source === 'userscript'
            ? [
                { delay: 0, resetGalleryState: true },
                { delay: 220, resetGalleryState: false }
            ]
            : [
                { delay: 0, resetGalleryState: true },
                { delay: 300, resetGalleryState: false },
                { delay: 1200, resetGalleryState: false }
            ];

        routeRefreshTimers = passes.map(pass => setTimeout(() => {
            runRouteRefreshPass(generation, pass);
        }, pass.delay));
    }

    function syncRouteRefreshFromUserscript(data = NhentaiUserscriptBridge.getData()) {
        const pageName = NhentaiUserscriptBridge.getCurrentPageName(data);
        if (!pageName) return;
        if (isRouteRefreshSuppressed()) return;
        const nextUrl = location.href;
        if (nextUrl === lastObservedUrl) return;
        syncObservedUrl(nextUrl);
        scheduleRouteRefresh({ source: 'userscript' });
    }

    function handlePotentialRouteChange() {
        if (location.href === lastObservedUrl) return;
        if (isRouteRefreshSuppressed()) {
            syncObservedUrl(location.href);
            return;
        }
        syncObservedUrl(location.href);
        scheduleRouteRefresh();
    }

    function initRouteWatcher() {
        const wrapHistoryMethod = (methodName) => {
            const original = history[methodName];
            if (typeof original !== 'function' || original.__nhWrapped) return;

            const wrapped = function(...args) {
                const result = original.apply(this, args);
                handlePotentialRouteChange();
                return result;
            };
            wrapped.__nhWrapped = true;
            history[methodName] = wrapped;
        };

        wrapHistoryMethod('pushState');
        wrapHistoryMethod('replaceState');
        window.addEventListener('popstate', handlePotentialRouteChange);
        if (!routeWatcherIntervalId) {
            const hasUserscriptUpdate = Boolean(NhentaiUserscriptBridge.getApi()?.onUpdate);
            routeWatcherIntervalId = setInterval(handlePotentialRouteChange, hasUserscriptUpdate ? 1200 : 400);
        }
        if (!userscriptRouteUnsubscribe) {
            userscriptRouteUnsubscribe = NhentaiUserscriptBridge.onUpdate((data) => {
                syncRouteRefreshFromUserscript(data);
            });
        }
    }


