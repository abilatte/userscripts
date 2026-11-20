    // ===== 6. 无限滚动与预览共享状态 =====
    const MAX_PREVIEW_STATES = 600;
    const states = new Map();
    let hoveredGallery = null;
    let hoverTimeout = null;
    let lastObservedUrl = location.href;
    let suppressRouteRefreshUntil = 0;
    let suppressedRouteUrl = '';

    function normalizeRouteUrl(url = location.href) {
        try {
            const parsed = new URL(url, location.origin);
            return `${parsed.pathname}${parsed.search}`;
        } catch (error) {
            return String(url || '');
        }
    }

    function suppressRouteRefresh(duration = 1500, routeUrl = location.href) {
        suppressRouteRefreshUntil = Date.now() + duration;
        suppressedRouteUrl = normalizeRouteUrl(routeUrl);
    }

    function isRouteRefreshSuppressed(url = location.href) {
        if (Date.now() >= suppressRouteRefreshUntil) return false;
        return normalizeRouteUrl(url) === suppressedRouteUrl;
    }

    function syncObservedUrl(url = location.href) {
        lastObservedUrl = url;
    }

    function recordInfiniteScrollDebug(key, value) {
        if (typeof Diagnostics === 'undefined') return;
        Diagnostics.recordInfiniteScrollDebug?.(key, value);
    }

    function getInfiniteScrollDebug() {
        if (typeof Diagnostics === 'undefined') return {};
        return Diagnostics.getInfiniteScrollDebug?.() || {};
    }

    function resetInfiniteScrollDebug() {
        if (typeof Diagnostics === 'undefined') return;
        Diagnostics.resetInfiniteScrollDebug?.();
    }

    const InfiniteScroll = {
        observer: null,
        sentinel: null,
        scrollHandler: null,
        userscriptPaginationUnsubscribe: null,
        nextUrl: '',
        status: 'idle',
        loading: false,
        pendingRequestUrl: '',
        pendingRequestToken: '',
        lastLoadedPageUrl: '',
        userScrolledSinceInit: false,
        inputIntentSinceInit: false,
        visibilityCheckTimers: [],
        nextUrlRecoveryTimers: [],
        paginationRecoveryAttempts: 0,
        lastAttemptAt: 0,
        currentListKey: '',
        basePageNumber: 0,
        originRouteUrl: '',
        loadedUrls: new Set(),
        wheelHandler: null,
        middleClickHandler: null,
        generation: 0,
        requestSerial: 0,
        // 连续失败达到上限后停止自动重试，改为点击哨兵手动重试。
        maxAutoRetries: 3,
        retryBaseDelayMs: 1200,
        consecutiveErrors: 0,
        retryNotBefore: 0,
        manualRetryRequired: false,
        // 语言筛选/黑名单把整页都隐藏时哨兵一直可见，连续空页达到上限后暂停自动加载。
        maxConsecutiveEmptyPages: 5,
        consecutiveEmptyPages: 0,
        pausedForEmptyPages: false,
        offscreenObserver: null,
        tagIdBySlugCache: new Map(),

        isListPage() {
            if (!Config.get('enableInfiniteScroll')) return false;
            if (/^\/g\/\d+/.test(location.pathname)) return false;
            return getGalleryNodes(document).length > 0;
        },

        getContentRoot() {
            return document.getElementById('content');
        },

        getListKey() {
            const url = new URL(location.href);
            url.searchParams.delete('page');
            return `${url.pathname}?${url.searchParams.toString()}`;
        },

        getCurrentRouteUrl() {
            return `${location.pathname}${location.search}`;
        },

        markActivationSource(source = '') {
            if (!source) return;
            recordInfiniteScrollDebug('lastActivationSource', source);
        },

        recordResetReason(reason = '') {
            if (!reason) return;
            recordInfiniteScrollDebug('lastResetReason', reason);
        },

        getTailPagination(root = document) {
            if (!root) return null;

            const directChildren = Array.from(root.children || []);
            for (let index = directChildren.length - 1; index >= 0; index--) {
                const node = directChildren[index];
                if (node?.matches?.(GALLERY_SELECTORS.pagination)) {
                    return node;
                }
            }

            const paginations = queryAll(root, GALLERY_SELECTORS.pagination);
            return paginations.length ? paginations[paginations.length - 1] : null;
        },

        getNextUrl(root = document) {
            const pagination = this.getTailPagination(root);
            const nextLink = pagination?.querySelector?.('a.next') || null;
            return nextLink?.href || '';
        },

        deriveImplicitNextUrl() {
            const isHome = location.pathname === '/' && !new URL(location.href).searchParams.has('page');
            if (!isHome) return '';
            return `${location.origin}/?page=2`;
        },

        deriveUserscriptNextUrl(pagination = null) {
            const pageInfo = pagination || NhentaiUserscriptBridge.getData()?.pagination || null;
            const currentPage = Number(pageInfo?.page || 0);
            const totalPages = Number(pageInfo?.numPages || 0);
            if (!Number.isFinite(currentPage) || !Number.isFinite(totalPages) || currentPage <= 0 || totalPages <= 0) {
                return '';
            }
            if (currentPage >= totalPages) return '';
            return NhentaiUserscriptBridge.buildPageUrl(currentPage + 1);
        },

        syncNextUrlFromDom(root = this.getContentRoot(), { preserveWhenMissing = false, source = 'dom' } = {}) {
            const domNextUrl = this.getNextUrl(root);
            const hasApiAppendedPages = this.hasAppendedPageNodes(root) && Boolean(this.lastLoadedPageUrl);
            const nextUrl = domNextUrl
                || (hasApiAppendedPages ? '' : (this.deriveUserscriptNextUrl() || this.deriveImplicitNextUrl()));
            recordInfiniteScrollDebug('lastNextUrlSyncSource', `${source}:${nextUrl ? 'hit' : 'miss'}${!nextUrl && preserveWhenMissing ? ':preserved' : ''}`);
            if (nextUrl || !preserveWhenMissing) {
                this.nextUrl = nextUrl;
            }
            return this.nextUrl;
        },

        syncNextUrlFromUserscriptPagination(pagination = null) {
            if (!this.isListPage()) return;
            if (this.hasAppendedPageNodes() && this.lastLoadedPageUrl) {
                const loadedPage = this.getPageNumberFromUrl(this.lastLoadedPageUrl);
                const bridgePage = Number(pagination?.page || 0);
                if (loadedPage > bridgePage) return;
            }
            const nextUrl = this.deriveUserscriptNextUrl(pagination);
            if (!nextUrl && this.hasNextPage()) return;
            this.nextUrl = nextUrl;
            if (!this.isLoadingState()) {
                this.syncStatusByNextUrl();
            } else {
                this.updateSentinelState();
            }
        },

        hasUserScrollActivation() {
            return this.loadedUrls.size > 0
                || this.userScrolledSinceInit
                || this.inputIntentSinceInit
                || window.scrollY > 8
        },

        clearScheduledVisibilityChecks() {
            this.visibilityCheckTimers.forEach(timer => clearTimeout(timer));
            this.visibilityCheckTimers = [];
        },

        clearScheduledNextUrlRecovery() {
            this.nextUrlRecoveryTimers.forEach(timer => clearTimeout(timer));
            this.nextUrlRecoveryTimers = [];
        },

        resetPaginationRecovery() {
            this.paginationRecoveryAttempts = 0;
        },

        scheduleVisibilityChecks() {
            this.clearScheduledVisibilityChecks();
            const delays = [120, 360, 900];
            this.visibilityCheckTimers = delays.map(delay => setTimeout(() => {
                this.checkSentinelVisibility(`visibility-${delay}`);
            }, delay));
        },

        recoverNextUrlFromDom() {
            if (this.isLoadingState() || !this.isListPage()) return false;
            const contentRoot = this.getContentRoot();
            if (!contentRoot) return false;
            const nextUrl = this.syncNextUrlFromDom(contentRoot, { preserveWhenMissing: false, source: 'recovery-window' });
            if (!nextUrl) return false;
            this.ensureSentinel(contentRoot);
            this.syncStatusByNextUrl();
            this.ensureFallbackListener();
            this.observe();
            return true;
        },

        scheduleNextUrlRecoveryChecks() {
            this.clearScheduledNextUrlRecovery();
            const delays = [120, 360, 900, 1600];
            const generation = this.generation;
            this.nextUrlRecoveryTimers = delays.map(delay => setTimeout(() => {
                if (generation !== this.generation) return;
                const recovered = this.recoverNextUrlFromDom();
                if (recovered) {
                    this.clearScheduledNextUrlRecovery();
                }
            }, delay));
        },

        hasNextPage() {
            return Boolean(this.nextUrl);
        },

        isLoadingState() {
            return this.status === 'loading';
        },

        nextGeneration() {
            this.generation += 1;
            this.requestSerial = 0;
            this.pendingRequestToken = '';
            return this.generation;
        },

        createRequestToken() {
            const token = `${this.generation}:${++this.requestSerial}`;
            this.pendingRequestToken = token;
            return token;
        },

        isRequestTokenActive(token) {
            return Boolean(token) && token === this.pendingRequestToken;
        },

        setStatus(status, { sentinelState = '' } = {}) {
            this.status = status;
            this.loading = status === 'loading';
            if (status !== 'loading') {
                this.pendingRequestUrl = '';
                this.pendingRequestToken = '';
            }
            this.updateSentinelState(sentinelState);
        },

        syncStatusByNextUrl({ sentinelState = '' } = {}) {
            this.setStatus(this.hasNextPage() ? 'idle' : 'done', { sentinelState });
        },

        getStats() {
            const isListPage = this.isListPage();
            const contentRoot = this.getContentRoot();
            const sentinelText = this.sentinel?.textContent?.replace(/\s+/g, ' ').trim() || '';
            return {
                isListPage,
                currentRouteUrl: this.getCurrentRouteUrl(),
                currentListKey: this.currentListKey || (isListPage ? this.getListKey() : ''),
                nextUrl: this.nextUrl || '',
                pendingRequestUrl: this.pendingRequestUrl || '',
                pendingRequestToken: this.pendingRequestToken || '',
                lastLoadedPageUrl: this.lastLoadedPageUrl || '',
                status: this.status,
                loading: this.loading,
                userScrolledSinceInit: this.userScrolledSinceInit,
                inputIntentSinceInit: this.inputIntentSinceInit,
                loadedUrlCount: this.loadedUrls.size,
                sentinelPresent: Boolean(this.sentinel && this.sentinel.isConnected),
                sentinelText,
                basePageNumber: this.basePageNumber,
                originRouteUrl: this.originRouteUrl || '',
                paginationRecoveryAttempts: this.paginationRecoveryAttempts,
                hasPaginationContext: Boolean(this.getTailPagination(contentRoot)),
                hasAppendedPageNodes: this.hasAppendedPageNodes(contentRoot),
                ...getInfiniteScrollDebug(),
                generation: this.generation
            };
        },

        getPageNumberFromUrl(url = location.href) {
            try {
                const parsedUrl = new URL(url, location.origin);
                const page = Number(parsedUrl.searchParams.get('page') || '1');
                return Number.isFinite(page) && page > 0 ? page : 1;
            } catch (error) {
                return 1;
            }
        },

        getPageMarkerText(pageNumber) {
            return getUIText('infinite_page_marker').replace('{page}', String(Number(pageNumber) || 1));
        },

        createPageMarker(pageNumber) {
            const marker = document.createElement('div');
            marker.className = 'nh-scroll-page-marker';
            marker.dataset.pageNumber = String(pageNumber);
            marker.textContent = this.getPageMarkerText(pageNumber);
            return marker;
        },

        markInfiniteAppended(node) {
            if (!node) return node;
            node.dataset.nhInfiniteAppended = '1';
            return node;
        },

        hasAppendedPageNodes(contentRoot = this.getContentRoot()) {
            return Boolean(queryOne(contentRoot, '[data-nh-infinite-appended="1"]'));
        },

        removeAppendedPageNodes(contentRoot = this.getContentRoot()) {
            if (!contentRoot) return;
            queryAll(contentRoot, '[data-nh-infinite-appended="1"]').forEach(node => node.remove());
        },

        removeExistingPagination(contentRoot) {
            queryAll(contentRoot, GALLERY_SELECTORS.pagination).forEach(pagination => pagination.remove());
            const sentinel = contentRoot.querySelector('#nh-infinite-sentinel');
            sentinel?.remove();
        },

        clearPageMarkers(contentRoot = this.getContentRoot()) {
            if (!contentRoot) return;
            queryAll(contentRoot, '.nh-scroll-page-marker').forEach(marker => marker.remove());
        },

        ensureInitialPageMarker(contentRoot) {
            const firstContainer = queryOne(contentRoot, GALLERY_SELECTORS.listContainer);
            if (!firstContainer) return;
            const pageNumber = this.getPageNumberFromUrl(location.href);
            const isImplicitHomePageOne = location.pathname === '/' && !new URL(location.href).searchParams.has('page') && pageNumber === 1;
            if (isImplicitHomePageOne) return;
            const existingMarker = firstContainer.previousElementSibling;
            if (existingMarker?.classList?.contains('nh-scroll-page-marker')) {
                existingMarker.dataset.pageNumber = String(pageNumber);
                existingMarker.textContent = this.getPageMarkerText(pageNumber);
                return;
            }
            firstContainer.before(this.createPageMarker(pageNumber));
        },

        ensureSentinel(contentRoot) {
            if (!this.sentinel || !this.sentinel.isConnected) {
                this.sentinel = document.createElement('div');
                this.sentinel.id = 'nh-infinite-sentinel';
                this.sentinel.addEventListener('click', () => this.handleSentinelClick());
            }
            contentRoot.appendChild(this.sentinel);
            this.updateSentinelState();
        },

        resetRetryState() {
            this.consecutiveErrors = 0;
            this.retryNotBefore = 0;
            this.manualRetryRequired = false;
        },

        resetEmptyPageState() {
            this.consecutiveEmptyPages = 0;
            this.pausedForEmptyPages = false;
        },

        // 哨兵处于“点击重试 / 点击继续”状态时由用户手动恢复加载。
        handleSentinelClick() {
            if (!this.manualRetryRequired && !this.pausedForEmptyPages && this.status !== 'error') return;
            if (this.isLoadingState() || !this.hasNextPage()) return;
            this.resetRetryState();
            this.resetEmptyPageState();
            this.lastAttemptAt = 0;
            this.markActivationSource('sentinel-click');
            this.syncStatusByNextUrl();
            this.loadNextPage({ manual: true });
        },

        updateSentinelState(state = '') {
            if (!this.sentinel) return;
            this.sentinel.classList.remove('is-loading', 'is-error', 'is-done', 'is-actionable');

            let key = 'infinite_ready';
            if (state === 'syncing') {
                key = 'infinite_sync';
            } else if (state === 'error' || this.status === 'error') {
                key = this.manualRetryRequired ? 'infinite_error_manual' : 'infinite_error';
                this.sentinel.classList.add('is-error');
                if (this.manualRetryRequired) this.sentinel.classList.add('is-actionable');
            } else if (state === 'loading' || this.isLoadingState()) {
                key = 'infinite_loading';
                this.sentinel.classList.add('is-loading');
            } else if (state === 'done' || this.status === 'done' || !this.hasNextPage()) {
                key = 'infinite_done';
                this.sentinel.classList.add('is-done');
            } else if (this.pausedForEmptyPages) {
                key = 'infinite_paused_empty';
                this.sentinel.classList.add('is-actionable');
            }

            this.sentinel.textContent = getUIText(key).replace('{count}', String(this.consecutiveEmptyPages));
        },

        // 离视口很远的已加载分页跳过渲染；进入视口附近前恢复，避免 paint containment 裁掉悬停浮层。
        observeOffscreenPage(container) {
            if (!container || typeof IntersectionObserver !== 'function') return;
            if (!window.CSS?.supports?.('content-visibility', 'auto')) return;
            if (!this.offscreenObserver) {
                this.offscreenObserver = new IntersectionObserver(entries => {
                    entries.forEach(entry => {
                        entry.target.classList.toggle('nh-offscreen-page', !entry.isIntersecting);
                    });
                }, { rootMargin: '1500px 0px' });
            }
            this.offscreenObserver.observe(container);
        },

        disconnectObserver() {
            if (this.observer) {
                this.observer.disconnect();
            }
        },

        setLoading(loading, state = '') {
            this.setStatus(loading ? 'loading' : 'idle', { sentinelState: state });
        },

        normalizeNewGalleryNodes(container) {
            queryAll(container, GALLERY_SELECTORS.gallery).forEach(gallery => {
                queryAll(gallery, 'img').forEach(img => {
                    const actualSrc = img.getAttribute('data-src') || img.dataset?.src || img.getAttribute('src');
                    if (actualSrc) img.setAttribute('src', actualSrc);
                });
            });
        },

        observe() {
            if (!this.sentinel || !this.hasNextPage()) return;
            if (!this.observer) {
                this.observer = new IntersectionObserver(entries => {
                    if (entries.some(entry => entry.isIntersecting) && this.hasUserScrollActivation()) {
                        this.markActivationSource('observer');
                        this.loadNextPage();
                    }
                }, { rootMargin: '300px 0px' });
            }
            this.disconnectObserver();
            this.observer.observe(this.sentinel);
            this.checkSentinelVisibility('observe-initial');
            this.scheduleVisibilityChecks();
        },

        ensureFallbackListener() {
            if (!this.scrollHandler) {
                this.scrollHandler = debounce(() => {
                    if (window.scrollY > 8) {
                        this.userScrolledSinceInit = true;
                        this.markActivationSource('scroll');
                    }
                    this.checkSentinelVisibility('scroll');
                }, 80);
                window.addEventListener('scroll', this.scrollHandler, { passive: true });
                window.addEventListener('resize', this.scrollHandler, { passive: true });
            }
            if (!this.wheelHandler) {
                this.wheelHandler = (event) => {
                    if (event.deltaY <= 0) return;
                    this.inputIntentSinceInit = true;
                    this.markActivationSource('wheel');
                    this.checkSentinelVisibility('wheel');
                };
                window.addEventListener('wheel', this.wheelHandler, { passive: true });
            }
            if (!this.middleClickHandler) {
                this.middleClickHandler = (event) => {
                    if (event.button !== 1) return;
                    this.inputIntentSinceInit = true;
                    this.markActivationSource('middle-click');
                    this.scheduleVisibilityChecks();
                    this.checkSentinelVisibility('middle-click');
                };
                window.addEventListener('mousedown', this.middleClickHandler, { passive: true });
            }
        },

        checkSentinelVisibility(source = 'manual-check') {
            if (!this.sentinel || !this.hasNextPage() || this.isLoadingState() || !this.hasUserScrollActivation()) return;
            const rect = this.sentinel.getBoundingClientRect();
            if (rect.top <= window.innerHeight + 520) {
                this.markActivationSource(source);
                this.loadNextPage();
            }
        },

        cleanup({ keepLoadedUrls = false } = {}) {
            const contentRoot = this.getContentRoot();
            this.nextGeneration();
            this.disconnectObserver();
            if (this.observer) {
                this.observer = null;
            }
            if (this.scrollHandler) {
                window.removeEventListener('scroll', this.scrollHandler);
                window.removeEventListener('resize', this.scrollHandler);
                this.scrollHandler = null;
            }
            if (this.wheelHandler) {
                window.removeEventListener('wheel', this.wheelHandler);
                this.wheelHandler = null;
            }
            if (this.middleClickHandler) {
                window.removeEventListener('mousedown', this.middleClickHandler);
                this.middleClickHandler = null;
            }
            if (this.userscriptPaginationUnsubscribe) {
                this.userscriptPaginationUnsubscribe();
                this.userscriptPaginationUnsubscribe = null;
            }
            if (this.sentinel?.isConnected) {
                this.sentinel.remove();
            }
            this.sentinel = null;
            if (this.offscreenObserver) {
                this.offscreenObserver.disconnect();
                this.offscreenObserver = null;
            }
            this.resetRetryState();
            this.resetEmptyPageState();
            if (contentRoot) {
                this.removeAppendedPageNodes(contentRoot);
                this.clearPageMarkers(contentRoot);
            }
            this.clearScheduledVisibilityChecks();
            this.clearScheduledNextUrlRecovery();
            this.status = 'idle';
            this.loading = false;
            this.pendingRequestUrl = '';
            this.pendingRequestToken = '';
            this.lastLoadedPageUrl = '';
            this.userScrolledSinceInit = false;
            this.inputIntentSinceInit = false;
            this.nextUrl = '';
            this.lastAttemptAt = 0;
            this.currentListKey = '';
            this.basePageNumber = 0;
            this.originRouteUrl = '';
            this.resetPaginationRecovery();
            resetInfiniteScrollDebug();
            if (!keepLoadedUrls) {
                this.loadedUrls.clear();
            }
        },

        parseNextPageDocument(htmlText) {
            const parsed = new DOMParser().parseFromString(htmlText, 'text/html');
            return {
                parsed,
                container: queryOne(parsed, GALLERY_SELECTORS.listContainer),
                pagination: queryOne(parsed, GALLERY_SELECTORS.pagination)
            };
        },

        async resolveApiTagId(namespace, slug) {
            const key = `${namespace}:${slug}`;
            if (this.tagIdBySlugCache.has(key)) return this.tagIdBySlugCache.get(key);
            const currentTag = NhentaiUserscriptBridge.getCurrentTag();
            if (
                currentTag
                && String(currentTag.type || '') === String(namespace)
                && String(currentTag.slug || '') === String(slug)
                && Number(currentTag.id) > 0
            ) {
                const tagId = Number(currentTag.id);
                this.tagIdBySlugCache.set(key, tagId);
                return tagId;
            }
            const payload = await requestNhentaiApiJson(`/api/v2/tags/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}`, {
                method: 'GET'
            });
            const tagId = Number(payload?.id || payload?.result?.id || payload?.data?.id || 0);
            if (tagId > 0) {
                this.tagIdBySlugCache.set(key, tagId);
                return tagId;
            }
            return 0;
        },

        buildGalleryListContainerFromEntries(entries, pathname = location.pathname) {
            const isSearchGrid = /^\/search\/?$/.test(pathname) || Boolean(queryOne(this.getContentRoot(), '.gallery-grid'));
            const container = document.createElement('div');
            container.className = isSearchGrid ? 'gallery-grid' : 'container index-container';

            entries.forEach(entry => {
                const id = String(entry?.id || '');
                if (!id) return;
                const tagIds = Array.isArray(entry.tag_ids)
                    ? entry.tag_ids.map(tid => Number(tid)).filter(tid => Number.isFinite(tid) && tid > 0)
                    : [];

                const gallery = document.createElement('div');
                gallery.className = 'gallery';
                if (tagIds.includes(Number(LANG_IDS.CHINESE))) gallery.classList.add('lang-cn');
                if (tagIds.includes(Number(LANG_IDS.ENGLISH))) gallery.classList.add('lang-gb');
                if (tagIds.includes(Number(LANG_IDS.JAPANESE))) gallery.classList.add('lang-jp');
                if (tagIds.length) gallery.dataset.nhTagIds = tagIds.join(' ');
                if (entry.blacklisted === true) gallery.dataset.nhBlacklisted = 'true';

                const cover = document.createElement('a');
                cover.className = 'cover';
                cover.href = `/g/${id}/`;
                const tw = Number(entry.thumbnail_width) || 0;
                const th = Number(entry.thumbnail_height) || 0;
                const paddingRatio = (tw > 0 && th > 0) ? ((th / tw) * 100).toFixed(2).replace(/\.00$/, '') : '140';
                cover.style.padding = `0 0 ${paddingRatio}%`;

                const title = String(entry.english_title || entry.japanese_title || '');
                const img = document.createElement('img');
                img.loading = 'lazy';
                img.className = 'lazyload';
                img.alt = title;
                const thumbPath = typeof entry.thumbnail === 'string' ? entry.thumbnail : (entry.thumbnail?.path || '');
                const thumbSrc = buildThumbCandidateUrls(thumbPath)[0] || '';
                if (thumbSrc) img.src = thumbSrc;

                const caption = document.createElement('div');
                caption.className = 'caption';
                caption.textContent = title;

                cover.appendChild(img);
                cover.appendChild(caption);
                gallery.appendChild(cover);
                container.appendChild(gallery);
            });

            return container;
        },

        async fetchNextPageViaApi(requestUrl) {
            const parsed = new URL(requestUrl, location.origin);
            const pathname = parsed.pathname;
            const page = this.getPageNumberFromUrl(requestUrl);
            const sort = parsed.searchParams.get('sort') || 'date';
            let endpoint = '';

            if (pathname === '/') {
                endpoint = `/api/v2/galleries?page=${page}`;
            } else if (/^\/search\/?$/.test(pathname)) {
                const query = parsed.searchParams.get('q') || '';
                endpoint = `/api/v2/search?query=${encodeURIComponent(query)}&sort=${encodeURIComponent(sort)}&page=${page}`;
            } else {
                const nsMatch = pathname.match(/^\/(tag|artist|group|parody|character|language|category)\/([^/]+)\/?$/);
                if (!nsMatch) return null;
                const tagId = await this.resolveApiTagId(nsMatch[1], decodeURIComponent(nsMatch[2]));
                if (!tagId) return null;
                endpoint = `/api/v2/galleries/tagged?tag_id=${tagId}&sort=${encodeURIComponent(sort)}&page=${page}`;
            }

            const payload = await requestNhentaiApiJson(endpoint, { method: 'GET' });
            const entries = Array.isArray(payload?.result)
                ? payload.result
                : (Array.isArray(payload?.galleries) ? payload.galleries : []);
            if (!entries.length) return null;

            rememberGalleryListEntries(entries);
            const container = this.buildGalleryListContainerFromEntries(entries, pathname);
            const numPages = Number(payload?.num_pages || 0);
            const nextPageUrl = (Number.isFinite(numPages) && numPages > page)
                ? NhentaiUserscriptBridge.buildPageUrl(page + 1, requestUrl)
                : '';

            return {
                container,
                pagination: null,
                nextPageUrl,
                entries
            };
        },

        appendLoadedPage(contentRoot, container, pagination, pageNumber, entries = null) {
            this.removeExistingPagination(contentRoot);
            const shouldWrapSearchGrid = container.matches?.('.gallery-grid');
            const pageMarker = this.markInfiniteAppended(this.createPageMarker(pageNumber));

            if (shouldWrapSearchGrid) {
                const wrapper = this.markInfiniteAppended(document.createElement('div'));
                wrapper.className = 'container';
                wrapper.appendChild(pageMarker);
                this.markInfiniteAppended(container);
                wrapper.appendChild(container);
                contentRoot.appendChild(wrapper);
            } else {
                contentRoot.appendChild(pageMarker);
                this.markInfiniteAppended(container);
                contentRoot.appendChild(container);
                if (pagination) {
                    this.markInfiniteAppended(pagination);
                    contentRoot.appendChild(pagination);
                    runUITranslation(pagination);
                }
            }
            this.ensureSentinel(contentRoot);
            refreshGalleryEnhancements(container, {
                translate: true,
                metaData: entries ? { galleries: entries } : undefined
            });
            this.observeOffscreenPage(container);
            this.trackEmptyPage(container);
        },

        trackEmptyPage(container) {
            const galleries = queryAll(container, GALLERY_SELECTORS.gallery);
            if (!galleries.length) return;
            // offsetParent 为 null 表示被语言筛选或黑名单隐藏（display: none）。
            const hasVisibleGallery = galleries.some(gallery => gallery.offsetParent !== null);
            if (hasVisibleGallery) {
                this.resetEmptyPageState();
                return;
            }
            this.consecutiveEmptyPages += 1;
            if (this.consecutiveEmptyPages >= this.maxConsecutiveEmptyPages) {
                this.pausedForEmptyPages = true;
            }
        },

        syncRouteAfterAppend(requestUrl) {
            suppressRouteRefresh(2200, requestUrl);
            // 保留站点原有 history state，避免后退时 URL 已变化但路由状态丢失。
            history.replaceState(history.state, '', requestUrl);
            syncObservedUrl(requestUrl);
        },

        finishLoadWithObserver() {
            this.syncStatusByNextUrl();
            this.clearScheduledNextUrlRecovery();
            if (this.hasNextPage()) {
                this.observe();
            } else {
                this.disconnectObserver();
            }
        },

        handleLoadError(error) {
            this.clearScheduledVisibilityChecks();
            this.clearScheduledNextUrlRecovery();
            this.consecutiveErrors += 1;
            console.error('[nHentai Pro] Infinite scroll failed:', error);

            if (this.consecutiveErrors >= this.maxAutoRetries) {
                // 断网或被限流时不再循环请求，等用户点击哨兵。
                this.manualRetryRequired = true;
                this.setStatus('error');
                this.disconnectObserver();
                return;
            }

            const retryDelay = this.retryBaseDelayMs * (2 ** (this.consecutiveErrors - 1));
            this.retryNotBefore = Date.now() + retryDelay;
            this.setStatus('error');
            if (this.observer && this.sentinel) {
                const generation = this.generation;
                this.disconnectObserver();
                setTimeout(() => {
                    if (generation !== this.generation) return;
                    if (this.sentinel?.isConnected && this.hasNextPage() && !this.isLoadingState()) {
                        this.syncStatusByNextUrl();
                        this.observe();
                    }
                }, retryDelay + 20);
            }
        },

        handleDuplicateNextUrl(contentRoot, requestUrl) {
            const syncedNextUrl = this.syncNextUrlFromDom(contentRoot, {
                preserveWhenMissing: false,
                source: 'duplicate-next-url'
            });

            if (syncedNextUrl && syncedNextUrl !== requestUrl && !this.loadedUrls.has(syncedNextUrl)) {
                this.syncStatusByNextUrl();
                this.observe();
                return;
            }

            if (syncedNextUrl === requestUrl) {
                this.nextUrl = '';
                this.setStatus('idle', { sentinelState: 'syncing' });
                this.disconnectObserver();
                this.scheduleNextUrlRecoveryChecks();
                return;
            }

            this.nextUrl = '';
            this.setStatus('done');
            this.disconnectObserver();
        },

        resetForList(contentRoot, listKey, nextUrl) {
            this.cleanup();
            this.currentListKey = listKey;
            this.basePageNumber = this.getPageNumberFromUrl(location.href);
            this.originRouteUrl = this.getCurrentRouteUrl();
            this.removeAppendedPageNodes(contentRoot);
            this.clearPageMarkers(contentRoot);
            this.nextUrl = nextUrl || '';
            this.syncNextUrlFromDom(contentRoot, { preserveWhenMissing: false, source: 'reset-for-list' });
            this.ensureInitialPageMarker(contentRoot);
        },

        buildInitContext(contentRoot = this.getContentRoot()) {
            const listKey = this.getListKey();
            const tailPagination = this.getTailPagination(contentRoot);
            const nextUrl = this.getNextUrl(contentRoot) || this.deriveUserscriptNextUrl() || this.deriveImplicitNextUrl();
            const currentRouteUrl = this.getCurrentRouteUrl();
            const hasAppendedNodes = this.hasAppendedPageNodes(contentRoot);
            const hasPaginationContext = Boolean(tailPagination || nextUrl);
            const normalizedLastLoadedPageUrl = this.lastLoadedPageUrl ? normalizeRouteUrl(this.lastLoadedPageUrl) : '';
            const normalizedOriginRouteUrl = this.originRouteUrl ? normalizeRouteUrl(this.originRouteUrl) : '';
            return {
                contentRoot,
                listKey,
                tailPagination,
                nextUrl,
                currentRouteUrl,
                hasAppendedNodes,
                hasPaginationContext,
                normalizedLastLoadedPageUrl,
                normalizedOriginRouteUrl
            };
        },

        sameContextSync(context) {
            this.recordResetReason('same_context_sync');
            this.syncNextUrlFromDom(context.contentRoot, { preserveWhenMissing: true, source: 'same-context-sync' });
            this.ensureFallbackListener();
            this.ensureSentinel(context.contentRoot);
            if (!this.isLoadingState()) {
                this.syncStatusByNextUrl();
            } else {
                this.updateSentinelState();
            }
            if (this.isLoadingState()) return;
            if (this.hasNextPage()) this.observe();
            else this.disconnectObserver();
        },

        sameContextReset(context, reason = 'same_context_reset') {
            this.recordResetReason(reason);
            this.resetForList(context.contentRoot, context.listKey, context.nextUrl);
            this.ensureFallbackListener();
            this.ensureSentinel(context.contentRoot);
            if (!this.hasNextPage()) {
                this.setStatus('idle', { sentinelState: 'syncing' });
                this.scheduleNextUrlRecoveryChecks();
                return;
            }
            this.syncStatusByNextUrl();
            this.observe();
        },

        newContextReset(context) {
            this.recordResetReason('new_context_reset');
            this.resetForList(context.contentRoot, context.listKey, context.nextUrl);
            this.ensureFallbackListener();
            this.ensureSentinel(context.contentRoot);
            if (!this.hasNextPage()) {
                this.setStatus('idle', { sentinelState: 'syncing' });
                this.scheduleNextUrlRecoveryChecks();
                return;
            }
            this.syncStatusByNextUrl();
            this.observe();
        },

        async loadNextPage({ manual = false } = {}) {
            if (this.isLoadingState() || !this.hasNextPage()) return;
            if (!manual && (this.manualRetryRequired || this.pausedForEmptyPages)) return;

            const now = Date.now();
            // 失败后的退避窗口内，滚动/可见性检查都不再触发请求。
            if (!manual && now < this.retryNotBefore) return;
            if (now - this.lastAttemptAt < 600) return;
            this.lastAttemptAt = now;

            const contentRoot = this.getContentRoot();
            if (!contentRoot) {
                this.cleanup();
                return;
            }

            const requestUrl = this.nextUrl;
            if (this.loadedUrls.has(requestUrl)) {
                this.handleDuplicateNextUrl(contentRoot, requestUrl);
                return;
            }

            const requestToken = this.createRequestToken();
            this.pendingRequestUrl = requestUrl;
            this.setStatus('loading');

            try {
                // 优先走 /api/v2/* 列表 JSON：规避 Cloudflare 对 fetch(HTML) 的 403 拦截，且自带页数与标签元数据。
                let apiResult = null;
                try {
                    apiResult = await this.fetchNextPageViaApi(requestUrl);
                } catch (apiError) {
                    apiResult = null;
                }
                if (!this.isRequestTokenActive(requestToken)) return;

                let container = null;
                let pagination = null;
                let entries = null;

                if (apiResult?.container) {
                    container = apiResult.container;
                    pagination = null;
                    entries = apiResult.entries;
                } else {
                    const res = await fetch(requestUrl, { credentials: 'same-origin' });
                    if (!this.isRequestTokenActive(requestToken)) return;
                    if (!res.ok) {
                        throw new Error(res.statusText || `HTTP ${res.status}`);
                    }

                    const htmlText = await res.text();
                    if (!this.isRequestTokenActive(requestToken)) return;
                    const parsedDoc = this.parseNextPageDocument(htmlText);
                    container = parsedDoc.container;
                    pagination = parsedDoc.pagination;
                }

                if (!container) {
                    throw new Error('Infinite scroll container not found');
                }

                const latestContentRoot = this.getContentRoot();
                if (!latestContentRoot || !this.isRequestTokenActive(requestToken)) {
                    return;
                }

                const pageNumber = this.getPageNumberFromUrl(requestUrl);
                this.loadedUrls.add(requestUrl);
                this.lastLoadedPageUrl = requestUrl;
                this.resetPaginationRecovery();
                this.resetRetryState();
                if (apiResult) {
                    this.nextUrl = apiResult.nextPageUrl || '';
                } else {
                    this.nextUrl = pagination?.querySelector('a.next')?.href || '';
                    this.normalizeNewGalleryNodes(container);
                }

                this.appendLoadedPage(latestContentRoot, container, pagination, pageNumber, entries);
                if (!this.isRequestTokenActive(requestToken)) return;
                if (!apiResult) {
                    this.syncNextUrlFromDom(latestContentRoot, { preserveWhenMissing: true });
                }
                this.syncRouteAfterAppend(requestUrl);
                this.finishLoadWithObserver();
            } catch (error) {
                if (!this.isRequestTokenActive(requestToken)) return;
                this.handleLoadError(error);
            }
        },

        init(force = false) {
            if (!this.isListPage()) {
                this.cleanup();
                return;
            }

            if (!this.userscriptPaginationUnsubscribe) {
                this.userscriptPaginationUnsubscribe = NhentaiUserscriptBridge.onPagination((pagination) => {
                    this.syncNextUrlFromUserscriptPagination(pagination);
                });
            }

            const contentRoot = this.getContentRoot();
            if (!contentRoot) {
                this.cleanup();
                return;
            }

            const context = this.buildInitContext(contentRoot);

            if (!context.hasPaginationContext && !context.nextUrl) {
                this.paginationRecoveryAttempts += 1;
                if (this.paginationRecoveryAttempts <= 4) {
                    this.ensureFallbackListener();
                    this.ensureSentinel(context.contentRoot);
                    this.setStatus('idle', { sentinelState: 'syncing' });
                    this.scheduleNextUrlRecoveryChecks();
                    this.recordResetReason('pagination_recovery_wait');
                    return;
                }
                this.cleanup();
                this.removeAppendedPageNodes(context.contentRoot);
                this.clearPageMarkers(context.contentRoot);
                this.recordResetReason('non_paginated_list');
                return;
            }

            this.resetPaginationRecovery();

            const shouldResetSameList = !force
                && this.currentListKey === context.listKey
                && context.hasAppendedNodes
                && context.normalizedLastLoadedPageUrl
                && context.currentRouteUrl !== context.normalizedLastLoadedPageUrl;

            if (!force && this.currentListKey === context.listKey && !shouldResetSameList) {
                this.sameContextSync(context);
                return;
            }

            if (!force && this.currentListKey === context.listKey && shouldResetSameList) {
                this.sameContextReset(context);
                return;
            }

            this.newContextReset(context);
        }
    };

