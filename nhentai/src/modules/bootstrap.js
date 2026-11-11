    // ===== 7. 启动流程与动态观察器 =====
    function getTopLevelObservedNodes(liveNodes) {
        return liveNodes.filter((node, index) => {
            if (!node || !document.contains(node)) return false;
            return !liveNodes.some((candidate, candidateIndex) => {
                return candidateIndex !== index
                    && candidate instanceof Node
                    && candidate.contains?.(node);
            });
        });
    }

    // 汉化与增强都只处理 context 的后代；新增的是叶子节点（单个标签、时间、标题）时改用父节点作上下文。
    function getObservedNodeContext(node) {
        if (!node?.matches?.('.tag, .tagchip, .name, .count, a, span, time, h1, h2')) return node;
        return node.parentElement || node;
    }

    // 一次批量里新增节点过多时，逐个增量处理反而比整页刷新慢。
    const MAX_INCREMENTAL_OBSERVED_NODES = 40;

    function processObservedNodes(liveNodes, { fullRefresh = false } = {}) {
        if (!liveNodes.length) return;

        if (fullRefresh) {
            runUITranslation(document);
            refreshGalleryEnhancements(document, { translate: true });
            ReadingMode.refresh();
            return;
        }

        const topLevelNodes = getTopLevelObservedNodes(liveNodes.map(getObservedNodeContext));
        topLevelNodes.forEach(node => {
            runUITranslation(node);
            runContentTranslation(node);
        });

        refreshGalleryEnhancements(topLevelNodes);
        ReadingMode.refresh();
    }

    // 动态内容更新频繁时，先收集节点再批量处理，避免每次 DOM 变化都全量重跑。
    function createContentObserver() {
        let observerTimeout;
        let pendingNodes = new Set();
        let needsFullRefresh = false;

        const isGalleryRelatedNode = (node) => {
            if (!node || node.nodeType !== 1) return false;
            if (node.closest?.('#info-container') || node.querySelector?.('#info-container')) return true;
            if (node.closest?.('#tags, #tag-container') || node.querySelector?.('#tags, #tag-container')) return true;
            if (node.matches?.('.tag, .sort, h1')) return true;
            if (node.querySelector?.('.tag, .sort, h1')) return true;
            if (node.matches?.(GALLERY_SELECTORS.dynamicRoot)) return true;
            return !!node.querySelector?.(GALLERY_SELECTORS.dynamicRoot);
        };

        return new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                if (mutation.type === 'attributes') {
                    const target = mutation.target;
                    const isGalleryClassMutation = mutation.attributeName === 'class' && target.classList?.contains('gallery');
                    const isCoverHrefMutation = mutation.attributeName === 'href' && target.matches?.(GALLERY_SELECTORS.coverLink);
                    const isIndexTagHrefMutation = mutation.attributeName === 'href' && target.matches?.('a.tag, a.tagchip');

                    if (!isGalleryClassMutation && !isCoverHrefMutation && !isIndexTagHrefMutation) {
                        return;
                    }

                    if (
                        isGalleryClassMutation
                        && normalizeObservedGalleryClassName(mutation.oldValue) === normalizeObservedGalleryClassName(target.className)
                    ) {
                        return;
                    }
                    const gallery = target.closest?.(GALLERY_SELECTORS.gallery);
                    if (gallery) {
                        resetSingleGalleryEnhancementState(gallery);
                        pendingNodes.add(gallery);
                        needsFullRefresh = true;
                        return;
                    }

                    if (isIndexTagHrefMutation) {
                        pendingNodes.add(target.closest?.('#tags, #tag-container') || target);
                        needsFullRefresh = true;
                    }
                    return;
                }

                if (mutation.addedNodes.length > 0) mutation.addedNodes.forEach(node => {
                    // 无限滚动追加的节点已在 appendLoadedPage 中增强过，避免每追加一页都触发整页全量刷新。
                    if (node.dataset?.nhInfiniteAppended === '1') return;
                    // 新增节点只处理自身子树；属性变化（节点被站点复用）才需要整页重跑。
                    if (node.nodeType === 1 && isGalleryRelatedNode(node)) {
                        pendingNodes.add(node);
                    }
                });
            });

            clearTimeout(observerTimeout);
            observerTimeout = setTimeout(() => {
                const liveNodes = Array.from(pendingNodes).filter(node => document.contains(node));
                pendingNodes.clear();
                processObservedNodes(liveNodes, {
                    fullRefresh: needsFullRefresh || liveNodes.length > MAX_INCREMENTAL_OBSERVED_NODES
                });
                needsFullRefresh = false;
            }, 100);
        });
    }

    function initCoreUI() {
        Styles.inject();
        SiteBlacklist.init();
        Diagnostics.sync();
        setupSettingsUI();
        updatePageSettingsButton();
        setupLanguageFilterUI();
        runLanguageFilter();
        runUITranslation();
        ReadingMode.refresh();
    }

    async function initSearchAndTranslation() {
        // 保持原有策略：先完成词库初始化，再启用搜索联想与内容翻译。
        await DB.init();
        setupSearchUI();
        runContentTranslation();
    }

    function initPageMetaFeatures() {
        CDN.ensure();
        GalleryMeta.refresh(document);
        queryAll(document, GALLERY_SELECTORS.uninitializedGallery).forEach(initPreviewUI);
        InfiniteScroll.init();
    }

    function refreshNavbarUI() {
        const nav = document.querySelector('nav');
        if (!nav) return;
        updatePageSettingsButton();
        setupLanguageFilterUI();
        setupSearchUI();
        runUITranslation(nav);
    }

    function isNavbarRelatedNode(node) {
        if (!node || node.nodeType !== 1) return false;
        if (node.matches?.('nav, .collapse, ul.menu.left, ul.menu.right')) return true;
        return !!node.querySelector?.('nav, .collapse, ul.menu.left, ul.menu.right');
    }

    function createNavbarObserver() {
        let navObserverTimer = null;
        let lastNavFingerprint = '';

        const scheduleNavbarRefresh = () => {
            clearTimeout(navObserverTimer);
            navObserverTimer = setTimeout(() => {
                const nav = document.querySelector('nav');
                const menuLeft = nav?.querySelector('ul.menu.left');
                if (!nav || !menuLeft) return;

                const fingerprint = [
                    menuLeft.childElementCount,
                    Boolean(document.getElementById('nh-web-settings-btn')),
                    Boolean(document.getElementById('nh-lang-filter')),
                    menuLeft.textContent.replace(/\s+/g, ' ').trim()
                ].join('|');

                if (fingerprint === lastNavFingerprint) return;
                lastNavFingerprint = fingerprint;
                refreshNavbarUI();
            }, 80);
        };

        scheduleNavbarRefresh();

        return new MutationObserver((mutations) => {
            const shouldRefresh = mutations.some(mutation => {
                return Array.from(mutation.addedNodes).some(isNavbarRelatedNode)
                    || Array.from(mutation.removedNodes).some(isNavbarRelatedNode);
            });

            if (shouldRefresh) {
                scheduleNavbarRefresh();
            }
        });
    }

    function initDynamicObservers() {
        const observer = createContentObserver();
        const navObserver = createNavbarObserver();
        const contentRoot = document.body || document.documentElement;
        if (contentRoot) {
            observer.observe(contentRoot, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'href'],
                attributeOldValue: true
            });
        }
        navObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        return { observer, navObserver };
    }

    function handlePreviewKeyNavigation(e) {
        // 输入框里的方向键用于移动光标，组合键留给浏览器/站点。
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (isEditableKeyTarget(e.target)) return;
        if (hoveredGallery && !document.fullscreenElement) {
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                updatePreview(hoveredGallery, 1);
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                updatePreview(hoveredGallery, -1);
            }
        }
    }

    function bindGlobalInteractions() {
        document.addEventListener('keydown', handlePreviewKeyNavigation);
    }

    function isUserscriptPageName(data, candidates = []) {
        return NhentaiUserscriptBridge.isPageName(
            NhentaiUserscriptBridge.getCurrentPageName(data),
            candidates
        );
    }

    function isUserscriptListPage(data = NhentaiUserscriptBridge.getData()) {
        return isUserscriptPageName(data, [
            'homepage',
            'search',
            'tagDetail',
            'favorites',
            'userFavorites',
            'profile',
            'userProfile'
        ]);
    }

    function isUserscriptDetailPage(data = NhentaiUserscriptBridge.getData()) {
        return isUserscriptPageName(data, ['galleryDetail', 'gallery']);
    }

    const scheduleUserscriptListRefresh = debounce((data = NhentaiUserscriptBridge.getData()) => {
        if (!isUserscriptListPage(data)) return;
        runUITranslation(document);
        refreshGalleryEnhancements(document, {
            translate: true,
            metaData: data
        });
    }, 80);

    const scheduleUserscriptDetailRefresh = debounce((data = NhentaiUserscriptBridge.getData()) => {
        if (!isUserscriptDetailPage(data)) return;
        resetTagTranslationState(document);
        runUITranslation(document);
        refreshGalleryEnhancements(document, {
            translate: true,
            metaData: data
        });
        void refreshDetailQuickBlacklistButtons(document);
        ReadingMode.refresh();
    }, 80);

    const PageScopedMounts = {
        galleryDetailUnsubscribe: null,
        galleryDataUnsubscribe: null,
        settingsUnsubscribe: null,
        favoritesUnsubscribe: null,
        profileUnsubscribe: null,
        galleriesUnsubscribe: null,
        started: false,

        async init() {
            if (this.started) return;
            this.started = true;
            await NhentaiUserscriptBridge.ready();
            this.galleryDetailUnsubscribe = NhentaiUserscriptBridge.whilePage('galleryDetail', () => {
                ReadingMode.mountGalleryDetail();
                refreshDetailQuickBlacklistButtons(document);
                scheduleUserscriptDetailRefresh();
                return () => {
                    clearDetailQuickBlacklistButtons(document);
                    ReadingMode.unmountGalleryDetail();
                };
            }) || null;

            this.settingsUnsubscribe = NhentaiUserscriptBridge.whilePage('settings', () => {
                UserSettingsBlacklistFilter.init(document);
                return () => {
                    UserSettingsBlacklistFilter.teardown(document);
                };
            }) || null;

            this.favoritesUnsubscribe = NhentaiUserscriptBridge.whilePage('favorites', () => {
                scheduleUserscriptListRefresh();
                return () => {};
            }) || null;

            this.profileUnsubscribe = NhentaiUserscriptBridge.whilePage('profile', () => {
                scheduleUserscriptListRefresh();
                return () => {};
            }) || null;

            this.galleryDataUnsubscribe = NhentaiUserscriptBridge.onGallery((gallery, data) => {
                if (!gallery || !isUserscriptDetailPage(data)) return;
                scheduleUserscriptDetailRefresh(data);
            }) || null;

            this.galleriesUnsubscribe = NhentaiUserscriptBridge.onGalleries((galleries, data) => {
                if (!isUserscriptListPage(data) || !Array.isArray(galleries) || galleries.length === 0) return;
                scheduleUserscriptListRefresh(data);
            }) || null;
        }
    };

    const Bootstrap = {
        runSyncPhase() {
            initCoreUI();
            initPageMetaFeatures();
            initRouteWatcher();
            initDynamicObservers();
            bindGlobalInteractions();
            void PageScopedMounts.init();
        },

        async runAsyncPhase() {
            await initSearchAndTranslation();
            scheduleRouteRefresh();
        },

        async start() {
            console.log('[nHentai Pro] 正在启动...');
            this.runSyncPhase();
            await this.runAsyncPhase();
        }
    };

    async function main() {
        await Bootstrap.start();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
    else main();
})();
