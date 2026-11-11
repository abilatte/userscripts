    const READING_MODE_PROGRESS_KEY = 'nh_reading_mode_progress_v1';

    const ReadingModeStorage = {
        readAll() {
            try {
                const raw = GM_getValue(READING_MODE_PROGRESS_KEY, '{}');
                const parsed = JSON.parse(raw);
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (error) {
                return {};
            }
        },

        writeAll(data) {
            try {
                GM_setValue(READING_MODE_PROGRESS_KEY, JSON.stringify(data));
            } catch (error) {}
        },

        get(galleryId) {
            if (!galleryId) return null;
            const all = this.readAll();
            const record = all[galleryId];
            if (!record || typeof record !== 'object') return null;
            const page = Number(record.page);
            if (!Number.isFinite(page) || page < 1) return null;
            return {
                page,
                total: Number(record.total) || 0,
                updatedAt: Number(record.updatedAt) || 0
            };
        },

        set(galleryId, record) {
            if (!galleryId) return;
            const all = this.readAll();
            all[galleryId] = {
                page: Number(record.page) || 1,
                total: Number(record.total) || 0,
                updatedAt: Date.now()
            };

            const trimmed = Object.fromEntries(
                Object.entries(all)
                    .sort((a, b) => (Number(b[1]?.updatedAt) || 0) - (Number(a[1]?.updatedAt) || 0))
                    .slice(0, 200)
            );
            this.writeAll(trimmed);
        }
    };

    const ReadingMode = {
        overlay: null,
        scrollContainer: null,
        pagesRoot: null,
        pageStatus: null,
        titleNode: null,
        scrollbarRoot: null,
        scrollbarTrack: null,
        scrollbarThumb: null,
        scrollbarPopper: null,
        toolRoot: null,
        toolScaleInputNode: null,
        toolGapInputNode: null,
        toolAutoHideTimer: null,
        lastReaderScrollAt: 0,
        lazyObserver: null,
        pageObserver: null,
        keydownHandler: null,
        scrollbarPointerId: null,
        isDraggingScrollbar: false,
        currentGalleryId: '',
        currentGalleryMeta: null,
        currentPage: 1,
        totalPages: 0,
        isOpening: false,
        saveTimer: null,
        scrollbarItems: new Map(),

        isEnabled() {
            return Config.get('enableReadingMode') !== false;
        },

        isOpen() {
            return !!this.overlay && document.body.contains(this.overlay);
        },

        getImageScalePercent() {
            return Math.max(40, Math.min(160, Number(Config.get('readingModeImageScalePercent')) || 100));
        },

        getImageMaxWidth() {
            return Math.max(480, Math.min(2200, Math.round(READING_MODE_BASE_WIDTH * (this.getImageScalePercent() / 100))));
        },

        getImageGap() {
            // 0 是合法间距，不能用 `|| 10` 兜底。
            const gap = Number(Config.get('readingModeImageGap'));
            return Math.max(0, Math.min(80, Number.isFinite(gap) ? gap : 10));
        },

        getDetailTitle() {
            const titleNode = queryOne(document, '#info h1.title');
            if (!titleNode) return document.title.replace(/\s*»\s*nhentai\s*$/i, '').trim();
            return titleNode.textContent.replace(/\s+/g, ' ').trim();
        },

        getEntryButtonText() {
            const saved = ReadingModeStorage.get(getCurrentGalleryIdFromLocation());
            // 与 restoreProgress 一致：读到第 2 页及以后才算有进度。
            if (!saved || saved.page <= 1) return getUIText('reading_mode_enter');
            const total = saved.total ? `/${saved.total}` : '';
            return `${getUIText('reading_mode_continue')} ${saved.page}${total}`;
        },

        updateEntryButtonText() {
            const text = queryOne(document.getElementById('nh-reading-mode-btn'), '.text');
            if (text) text.textContent = this.getEntryButtonText();
        },

        getStatusText() {
            return `${getUIText('reading_mode_page_prefix')}${this.currentPage} / ${this.totalPages}`;
        },

        getScrollbarPopperText(pageNumber = this.currentPage) {
            const normalizedPage = Math.max(1, Math.min(this.totalPages || 1, Number(pageNumber) || 1));
            return `${normalizedPage} / ${this.totalPages || 1}`;
        },

        getLoadStateText(state) {
            if (state === 'loading') return getUIText('reading_mode_state_loading');
            if (state === 'loaded') return getUIText('reading_mode_state_loaded');
            if (state === 'error') return getUIText('reading_mode_state_error');
            return getUIText('reading_mode_state_wait');
        },

        clearSaveTimer() {
            if (this.saveTimer) {
                clearTimeout(this.saveTimer);
                this.saveTimer = null;
            }
        },

        scheduleSaveProgress() {
            this.clearSaveTimer();
            this.saveTimer = setTimeout(() => {
                this.persistProgress();
            }, 120);
        },

        persistProgress() {
            if (!this.currentGalleryId || !this.totalPages) return;
            ReadingModeStorage.set(this.currentGalleryId, {
                page: this.currentPage,
                total: this.totalPages
            });
        },

        updateStatus() {
            if (this.pageStatus) {
                this.pageStatus.textContent = this.getStatusText();
            }
            this.updateScrollbarPopper(this.currentPage);
        },

        updateScrollbarPopper(pageNumber = this.currentPage) {
            if (!this.scrollbarPopper) return;
            this.scrollbarPopper.textContent = this.getScrollbarPopperText(pageNumber);
        },

        positionScrollbarPopper(midpoint) {
            if (!this.scrollbarPopper || !this.scrollbarTrack) return;
            const trackHeight = this.scrollbarTrack.clientHeight;
            if (!trackHeight) return;
            const bubbleHeight = this.scrollbarPopper.offsetHeight || 28;
            const clampedTop = Math.max(0, Math.min(trackHeight - bubbleHeight, midpoint - (bubbleHeight / 2)));
            this.scrollbarPopper.style.setProperty('--nh-reading-scrollbar-popper-y', `${clampedTop}px`);
        },

        updateToolValues() {
            if (this.toolScaleInputNode) {
                this.toolScaleInputNode.value = `${this.getImageScalePercent()}`;
            }
            if (this.toolGapInputNode) {
                this.toolGapInputNode.value = `${this.getImageGap()}`;
            }
        },

        clearToolAutoHideTimer() {
            if (this.toolAutoHideTimer) {
                clearTimeout(this.toolAutoHideTimer);
                this.toolAutoHideTimer = null;
            }
        },

        setToolsVisible(isVisible) {
            if (!this.toolRoot || !this.overlay) return;
            this.overlay.classList.toggle('is-tools-visible', isVisible);
            this.toolRoot.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
            queryAll(this.toolRoot, 'input, button, select, textarea').forEach(control => {
                control.tabIndex = isVisible ? 0 : -1;
            });
        },

        scheduleToolsAutoHide(delay = 2600) {
            this.clearToolAutoHideTimer();
            if (!this.isOpen()) return;
            this.toolAutoHideTimer = setTimeout(() => {
                this.hideTools();
            }, delay);
        },

        showTools(delay = 2600) {
            this.setToolsVisible(true);
            this.scheduleToolsAutoHide(delay);
        },

        hideTools(options = {}) {
            const force = options.force === true;
            if (this.toolRoot?.contains(document.activeElement)) {
                if (!force) {
                    this.scheduleToolsAutoHide();
                    return;
                }
                document.activeElement?.blur?.();
            }
            this.clearToolAutoHideTimer();
            this.setToolsVisible(false);
        },

        applyOverlayPreferences() {
            if (!this.overlay) return;
            this.overlay.style.setProperty('--nh-reading-max-width', `${this.getImageMaxWidth()}px`);
            this.overlay.style.setProperty('--nh-reading-gap', `${this.getImageGap()}px`);
            this.updateToolValues();
            requestAnimationFrame(() => {
                this.updateScrollbarThumb();
            });
        },

        setImageScalePercent(value) {
            const nextValue = Math.max(40, Math.min(160, Number(value) || 100));
            Config.set('readingModeImageScalePercent', nextValue);
            this.applyOverlayPreferences();
        },

        setImageGap(value) {
            const nextValue = Math.max(0, Math.min(80, Number(value) || 0));
            Config.set('readingModeImageGap', nextValue);
            this.applyOverlayPreferences();
        },

        handleToolInput(event) {
            event?.stopPropagation?.();
            const input = event?.target;
            if (!input?.matches) return;
            if (input.matches('.nh-reading-tool-scale-input')) {
                const value = Number(input.value);
                if (Number.isFinite(value)) {
                    this.setImageScalePercent(value);
                }
            } else if (input.matches('.nh-reading-tool-gap-input')) {
                const value = Number(input.value);
                if (Number.isFinite(value)) {
                    this.setImageGap(value);
                }
            }
            this.showTools();
        },

        handleReaderWheel(event) {
            if (!event?.ctrlKey || !this.scrollContainer) return;
            event.preventDefault();
            const delta = Math.abs(Number(event.deltaY) || 0) >= 50 ? 5 : 2;
            const direction = Number(event.deltaY) < 0 ? 1 : -1;
            const nextScale = this.getImageScalePercent() + (direction * delta);
            const scrollerRect = this.scrollContainer.getBoundingClientRect();
            const anchorOffset = Math.max(0, Math.min(this.scrollContainer.clientHeight, event.clientY - scrollerRect.top));
            const beforeScrollTop = this.scrollContainer.scrollTop;
            const beforeScrollHeight = Math.max(1, this.scrollContainer.scrollHeight);
            const anchorRatio = (beforeScrollTop + anchorOffset) / beforeScrollHeight;

            this.setImageScalePercent(nextScale);
            this.showTools();

            requestAnimationFrame(() => {
                if (!this.scrollContainer) return;
                const afterScrollHeight = Math.max(1, this.scrollContainer.scrollHeight);
                this.scrollContainer.scrollTop = Math.max(0, (anchorRatio * afterScrollHeight) - anchorOffset);
                this.updateScrollbarThumb();
            });
        },

        handleReaderPointerUp(event) {
            if (!this.scrollContainer) return;
            if (event?.pointerType === 'mouse' && event.button !== 0) return;
            if (Date.now() - this.lastReaderScrollAt < 180) return;
            this.showTools();
        },

        handleReaderScroll() {
            this.lastReaderScrollAt = Date.now();
            this.updateScrollbarThumb();
            this.hideTools({ force: true });
        },

        handleToolPanelActivity(event) {
            event?.stopPropagation?.();
            this.showTools();
        },

        handleToolPanelFocusOut() {
            this.scheduleToolsAutoHide(1200);
        },

        ensureEntryButton() {
            const existing = document.getElementById('nh-reading-mode-btn');
            if (!isGalleryDetailRoute() || !this.isEnabled()) {
                existing?.remove();
                if (!isGalleryDetailRoute()) this.close();
                return;
            }

            const buttonGroup = queryOne(document, '#bigcontainer .buttons.btn-group');
            if (!buttonGroup) return;

            let button = existing;
            if (!button) {
                button = document.createElement('button');
                button.type = 'button';
                button.id = 'nh-reading-mode-btn';
                button.className = 'btn btn-secondary nh-reading-mode-entry';
                button.innerHTML = `<i class="fa fa-book"></i> <span class="text">${this.getEntryButtonText()}</span>`;
                button.addEventListener('click', () => {
                    this.open();
                });
                buttonGroup.appendChild(button);
            } else {
                this.updateEntryButtonText();
            }
        },

        mountGalleryDetail() {
            Styles.ensureFeatureStyles('readingMode');
            this.ensureEntryButton();
        },

        unmountGalleryDetail() {
            document.getElementById('nh-reading-mode-btn')?.remove();
            this.close();
        },

        buildServerImageUrl(path, serverIndex = 0) {
            return buildImageCandidateUrls(path)[serverIndex] || '';
        },

        updateScrollbarItem(pageNumber, loadState) {
            const item = this.scrollbarItems.get(Number(pageNumber));
            if (!item) return;
            item.dataset.state = loadState;
            item.title = `${getUIText('reading_mode_page_prefix')}${pageNumber} · ${this.getLoadStateText(loadState)}`;
        },

        updateActiveScrollbarItem(pageNumber) {
            this.scrollbarItems.forEach((item, key) => {
                item.classList.toggle('is-active', key === Number(pageNumber));
            });
        },

        updateScrollbarThumb() {
            if (!this.scrollbarTrack || !this.scrollbarThumb || !this.scrollContainer) return;
            const trackHeight = this.scrollbarTrack.clientHeight;
            if (!trackHeight) return;

            const scrollHeight = Math.max(0, this.scrollContainer.scrollHeight);
            const clientHeight = Math.max(0, this.scrollContainer.clientHeight);
            const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
            const ratio = maxScrollTop > 0 ? (this.scrollContainer.scrollTop / maxScrollTop) : 0;
            const visibleRatio = scrollHeight > 0 ? Math.min(1, clientHeight / scrollHeight) : 1;
            const thumbHeight = maxScrollTop > 0
                ? Math.max(18, Math.min(trackHeight, trackHeight * visibleRatio))
                : trackHeight;
            const maxOffset = Math.max(0, trackHeight - thumbHeight);
            const offset = maxOffset * ratio;

            this.scrollbarThumb.style.height = `${thumbHeight}px`;
            this.scrollbarThumb.style.transform = `translateY(${offset}px)`;
            this.positionScrollbarPopper(offset + (thumbHeight / 2));
        },

        getScrollbarRatioFromClientY(clientY) {
            if (!this.scrollbarTrack) return 0;
            const rect = this.scrollbarTrack.getBoundingClientRect();
            if (!rect.height) return 0;
            return Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
        },

        scrollToPage(pageNumber, behavior = 'auto') {
            const normalized = Math.max(1, Math.min(this.totalPages, Number(pageNumber) || 1));
            const target = queryOne(this.pagesRoot, `.nh-reading-page[data-page-number="${normalized}"]`);
            if (!target) return;
            this.currentPage = normalized;
            this.updateStatus();
            this.updateActiveScrollbarItem(normalized);
            this.primeNearbyImages(normalized - 1);
            this.scheduleSaveProgress();
            target.scrollIntoView({ block: 'start', behavior });
        },

        scrollToRatio(ratio) {
            if (!this.scrollContainer) return;
            const normalized = Math.max(0, Math.min(1, Number(ratio) || 0));
            const maxScrollTop = Math.max(0, this.scrollContainer.scrollHeight - this.scrollContainer.clientHeight);
            this.scrollContainer.scrollTop = normalized * maxScrollTop;
            this.updateScrollbarThumb();

            const approximatePage = Math.max(1, Math.min(this.totalPages, Math.round(normalized * Math.max(0, this.totalPages - 1)) + 1));
            this.updateActiveScrollbarItem(approximatePage);
            this.updateScrollbarPopper(approximatePage);
            this.primeNearbyImages(Math.max(0, approximatePage - 1));
        },

        beginScrollbarDrag(pointerId) {
            this.scrollbarPointerId = pointerId;
            this.isDraggingScrollbar = true;
            this.scrollbarRoot?.classList.add('is-dragging');
        },

        endScrollbarDrag(pointerId = null) {
            if (pointerId != null && this.scrollbarPointerId !== pointerId) return;
            this.scrollbarPointerId = null;
            this.isDraggingScrollbar = false;
            this.scrollbarRoot?.classList.remove('is-dragging');
        },

        handleScrollbarPointerDown(event) {
            if (!this.scrollbarTrack || event.button !== 0) return;
            event.preventDefault();
            this.beginScrollbarDrag(event.pointerId);
            try {
                this.scrollbarTrack.setPointerCapture(event.pointerId);
            } catch (error) {}
            this.scrollToRatio(this.getScrollbarRatioFromClientY(event.clientY));
        },

        handleScrollbarPointerMove(event) {
            if (!this.isDraggingScrollbar || this.scrollbarPointerId !== event.pointerId) return;
            event.preventDefault();
            this.scrollToRatio(this.getScrollbarRatioFromClientY(event.clientY));
        },

        handleScrollbarPointerUp(event) {
            if (this.scrollbarPointerId !== event.pointerId) return;
            event.preventDefault();
            this.endScrollbarDrag(event.pointerId);
        },

        handleScrollbarPointerCancel(event) {
            if (this.scrollbarPointerId !== event.pointerId) return;
            this.endScrollbarDrag(event.pointerId);
        },

        setFigureLoadState(figure, loadState) {
            if (!figure) return;
            figure.dataset.loadState = loadState;
            figure.classList.toggle('is-loading', loadState === 'loading');
            figure.classList.toggle('is-loaded', loadState === 'loaded');
            figure.classList.toggle('is-error', loadState === 'error');
            this.updateScrollbarItem(figure.dataset.pageNumber, loadState);
        },

        handleImageLoad(event) {
            const img = event.currentTarget;
            const figure = img.closest('.nh-reading-page');
            img.dataset.loadState = 'loaded';
            img.dataset.loaded = 'true';
            this.setFigureLoadState(figure, 'loaded');
        },

        handleImageError(event) {
            const img = event.currentTarget;
            const figure = img.closest('.nh-reading-page');
            const path = img.dataset.path || '';
            const nextIndex = Number(img.dataset.serverIndex || 0) + 1;

            if (path && nextIndex < buildImageCandidateUrls(path).length) {
                img.dataset.serverIndex = String(nextIndex);
                img.src = this.buildServerImageUrl(path, nextIndex);
                this.setFigureLoadState(figure, 'loading');
                return;
            }

            img.dataset.loadState = 'error';
            img.dataset.loaded = 'error';
            this.setFigureLoadState(figure, 'error');
        },

        // 所有图片服务器都失败后，点击该页从第一个服务器重新加载。
        retryFigure(figure) {
            if (figure?.dataset.loadState !== 'error') return;
            const img = queryOne(figure, 'img');
            if (!img) return;
            img.dataset.serverIndex = '0';
            // 先清空 src，确保同一地址会重新发起请求。
            img.removeAttribute('src');
            this.loadImage(img);
        },

        loadImage(img) {
            if (!img) return;
            const state = img.dataset.loadState || 'wait';
            if (state === 'loaded' || state === 'loading') return;

            const path = img.dataset.path || '';
            const fallbackSrc = img.dataset.src || '';
            const source = path ? this.buildServerImageUrl(path, Number(img.dataset.serverIndex || 0)) : fallbackSrc;
            if (!source) return;

            img.dataset.loadState = 'loading';
            img.dataset.loaded = 'loading';
            this.setFigureLoadState(img.closest('.nh-reading-page'), 'loading');
            img.src = source;
        },

        primeNearbyImages(pageIndex) {
            if (!this.pagesRoot) return;
            const figures = queryAll(this.pagesRoot, '.nh-reading-page');
            for (let offset = 0; offset <= 3; offset++) {
                const figure = figures[pageIndex + offset];
                const img = queryOne(figure, 'img[data-src], img[data-path]');
                if (img) this.loadImage(img);
            }
        },

        setupLazyObserver() {
            this.lazyObserver?.disconnect();
            if (!this.scrollContainer) return;

            this.lazyObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    const img = entry.target;
                    this.loadImage(img);
                    this.lazyObserver?.unobserve(img);
                });
            }, {
                root: this.scrollContainer,
                rootMargin: '1200px 0px',
                threshold: 0.01
            });

            queryAll(this.pagesRoot, 'img[data-path], img[data-src]').forEach(img => {
                this.lazyObserver.observe(img);
            });
        },

        updateCurrentPageByFigure(figure) {
            const nextPage = Number(figure?.dataset?.pageNumber || 1);
            if (!Number.isFinite(nextPage) || nextPage < 1 || nextPage > this.totalPages) return;
            if (this.currentPage === nextPage) return;
            this.currentPage = nextPage;
            this.updateStatus();
            this.updateActiveScrollbarItem(nextPage);
            this.scheduleSaveProgress();
            this.primeNearbyImages(nextPage - 1);
        },

        setupPageObserver() {
            this.pageObserver?.disconnect();
            if (!this.scrollContainer) return;

            this.pageObserver = new IntersectionObserver((entries) => {
                const visible = entries
                    .filter(entry => entry.isIntersecting)
                    .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
                if (!visible.length) return;
                this.updateCurrentPageByFigure(visible[0].target);
            }, {
                root: this.scrollContainer,
                threshold: [0.25, 0.5, 0.75]
            });

            queryAll(this.pagesRoot, '.nh-reading-page').forEach(figure => {
                this.pageObserver.observe(figure);
            });
        },

        restoreProgress() {
            const saved = ReadingModeStorage.get(this.currentGalleryId);
            if (!saved || saved.page <= 1 || saved.page > this.totalPages) {
                this.currentPage = 1;
                this.updateStatus();
                this.updateActiveScrollbarItem(1);
                this.primeNearbyImages(0);
                this.updateScrollbarThumb();
                return;
            }

            this.currentPage = saved.page;
            this.updateStatus();
            this.updateActiveScrollbarItem(saved.page);
            this.primeNearbyImages(Math.max(0, saved.page - 1));

            const target = queryOne(this.pagesRoot, `.nh-reading-page[data-page-number="${saved.page}"]`);
            if (target) {
                requestAnimationFrame(() => {
                    target.scrollIntoView({ block: 'start' });
                    this.updateScrollbarThumb();
                });
            }
        },

        teardownObservers() {
            this.lazyObserver?.disconnect();
            this.pageObserver?.disconnect();
            this.lazyObserver = null;
            this.pageObserver = null;
        },

        handleKeydown(event) {
            if (!ReadingMode.isOpen() || !ReadingMode.scrollContainer) return;

            if (event.key === 'Escape') {
                event.preventDefault();
                ReadingMode.close();
                return;
            }

            // 工具栏输入框里的方向键、Home/End 用于编辑数值，不能拿来滚动阅读器。
            if (isEditableKeyTarget(event.target)) return;

            const step = Math.round(ReadingMode.scrollContainer.clientHeight * 0.9);
            const isSpace = event.key === ' ';
            if ((isSpace && !event.shiftKey) || event.key === 'PageDown' || event.key === 'ArrowDown') {
                event.preventDefault();
                ReadingMode.hideTools({ force: true });
                ReadingMode.scrollContainer.scrollBy({ top: step, behavior: 'smooth' });
                return;
            }

            if ((isSpace && event.shiftKey) || event.key === 'PageUp' || event.key === 'ArrowUp') {
                event.preventDefault();
                ReadingMode.hideTools({ force: true });
                ReadingMode.scrollContainer.scrollBy({ top: -step, behavior: 'smooth' });
                return;
            }

            if (event.key === 'Home') {
                event.preventDefault();
                ReadingMode.hideTools({ force: true });
                ReadingMode.scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }

            if (event.key === 'End') {
                event.preventDefault();
                ReadingMode.hideTools({ force: true });
                ReadingMode.scrollContainer.scrollTo({ top: ReadingMode.scrollContainer.scrollHeight, behavior: 'smooth' });
            }
        },

        bindKeydown() {
            this.keydownHandler = this.handleKeydown.bind(this);
            document.addEventListener('keydown', this.keydownHandler, true);
        },

        unbindKeydown() {
            if (!this.keydownHandler) return;
            document.removeEventListener('keydown', this.keydownHandler, true);
            this.keydownHandler = null;
        },

        buildPageFigure(pageData, index) {
            const figure = document.createElement('figure');
            figure.className = 'nh-reading-page';
            figure.dataset.pageNumber = String(index + 1);
            figure.dataset.loadState = 'wait';
            figure.dataset.retryText = getUIText('reading_mode_retry');
            figure.addEventListener('click', () => this.retryFigure(figure));

            const img = document.createElement('img');
            img.alt = `Page ${index + 1}`;
            img.loading = 'lazy';
            img.decoding = 'async';
            img.referrerPolicy = 'no-referrer';
            img.dataset.pageNumber = String(index + 1);
            img.dataset.serverIndex = '0';
            img.dataset.loadState = 'wait';

            const primaryPath = String(pageData?.path || '').trim();
            if (primaryPath) {
                img.dataset.path = primaryPath;
            } else {
                const fallbackSrc = resolvePreviewImageUrl(this.currentGalleryMeta, pageData);
                if (fallbackSrc) img.dataset.src = fallbackSrc;
            }

            if (pageData.width && pageData.height) {
                img.style.aspectRatio = `${pageData.width}/${pageData.height}`;
            }

            img.addEventListener('load', (event) => this.handleImageLoad(event));
            img.addEventListener('error', (event) => this.handleImageError(event));

            figure.appendChild(img);
            return figure;
        },

        createScrollbarItem(pageNumber) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'nh-reading-scrollbar-item';
            item.dataset.pageNumber = String(pageNumber);
            item.dataset.state = 'wait';
            item.title = `${getUIText('reading_mode_page_prefix')}${pageNumber} · ${this.getLoadStateText('wait')}`;
            item.addEventListener('click', () => {
                const target = queryOne(this.pagesRoot, `.nh-reading-page[data-page-number="${pageNumber}"]`);
                if (target) {
                    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
                }
            });
            this.scrollbarItems.set(pageNumber, item);
            return item;
        },

        buildOverlay(meta) {
            const overlay = document.createElement('div');
            overlay.id = 'nh-reading-overlay';
            overlay.innerHTML = `
                <div class="nh-reading-shell">
                    <div class="nh-reading-topbar">
                        <div class="nh-reading-meta">
                            <div class="nh-reading-title"></div>
                            <div class="nh-reading-status"></div>
                        </div>
                        <div class="nh-reading-actions">
                            <button type="button" class="nh-reading-close">${getUIText('reading_mode_close')}</button>
                        </div>
                    </div>
                    <div class="nh-reading-main">
                        <div class="nh-reading-tools" title="${getUIText('reading_mode_tool_scale_tip')}">
                            <label class="nh-reading-tool-field" title="${getUIText('reading_mode_tool_scale_tip')}">
                                <span class="nh-reading-tool-caption">${getUIText('reading_mode_tool_scale_label')}</span>
                                <div class="nh-reading-tool-input-wrap">
                                    <input type="number" class="nh-reading-tool-input nh-reading-tool-scale-input" min="40" max="160" step="1">
                                    <span class="nh-reading-tool-unit">%</span>
                                </div>
                            </label>
                            <label class="nh-reading-tool-field" title="${getUIText('reading_mode_tool_gap_tip')}">
                                <span class="nh-reading-tool-caption">${getUIText('reading_mode_tool_gap_label')}</span>
                                <div class="nh-reading-tool-input-wrap">
                                    <input type="number" class="nh-reading-tool-input nh-reading-tool-gap-input" min="0" max="80" step="1">
                                    <span class="nh-reading-tool-unit">px</span>
                                </div>
                            </label>
                        </div>
                        <div class="nh-reading-scroller">
                            <div class="nh-reading-pages"></div>
                        </div>
                        <div class="nh-reading-scrollbar">
                            <div class="nh-reading-scrollbar-popper"></div>
                            <div class="nh-reading-scrollbar-track">
                                <div class="nh-reading-scrollbar-thumb"></div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            this.overlay = overlay;
            this.scrollContainer = queryOne(overlay, '.nh-reading-scroller');
            this.pagesRoot = queryOne(overlay, '.nh-reading-pages');
            this.pageStatus = queryOne(overlay, '.nh-reading-status');
            this.titleNode = queryOne(overlay, '.nh-reading-title');
            this.scrollbarRoot = queryOne(overlay, '.nh-reading-scrollbar');
            this.scrollbarTrack = queryOne(overlay, '.nh-reading-scrollbar-track');
            this.scrollbarThumb = queryOne(overlay, '.nh-reading-scrollbar-thumb');
            this.scrollbarPopper = queryOne(overlay, '.nh-reading-scrollbar-popper');
            this.toolRoot = queryOne(overlay, '.nh-reading-tools');
            this.toolScaleInputNode = queryOne(overlay, '.nh-reading-tool-scale-input');
            this.toolGapInputNode = queryOne(overlay, '.nh-reading-tool-gap-input');
            this.scrollbarItems = new Map();

            this.setToolsVisible(false);
            this.applyOverlayPreferences();
            this.titleNode.textContent = meta.title || this.getDetailTitle() || document.title;
            this.pageStatus.textContent = '';
            this.updateScrollbarPopper(1);

            this.toolRoot?.addEventListener('pointerdown', (event) => this.handleToolPanelActivity(event));
            this.toolRoot?.addEventListener('click', (event) => this.handleToolPanelActivity(event));
            this.toolRoot?.addEventListener('focusin', (event) => this.handleToolPanelActivity(event));
            this.toolRoot?.addEventListener('focusout', () => this.handleToolPanelFocusOut());
            this.toolRoot?.addEventListener('change', (event) => this.handleToolInput(event));
            this.toolRoot?.addEventListener('keydown', (event) => {
                this.handleToolPanelActivity(event);
                if (event.key !== 'Enter') return;
                const input = event.target;
                if (input?.blur) input.blur();
            });
            this.scrollbarTrack?.addEventListener('pointerdown', (event) => this.handleScrollbarPointerDown(event));
            this.scrollbarTrack?.addEventListener('pointermove', (event) => this.handleScrollbarPointerMove(event));
            this.scrollbarTrack?.addEventListener('pointerup', (event) => this.handleScrollbarPointerUp(event));
            this.scrollbarTrack?.addEventListener('pointercancel', (event) => this.handleScrollbarPointerCancel(event));
            this.scrollContainer?.addEventListener('scroll', () => this.handleReaderScroll(), { passive: true });
            this.scrollContainer?.addEventListener('pointerup', (event) => this.handleReaderPointerUp(event));
            this.scrollContainer?.addEventListener('wheel', (event) => this.handleReaderWheel(event), { passive: false });

            queryOne(overlay, '.nh-reading-close')?.addEventListener('click', () => {
                this.close();
            });

            meta.pages.forEach((pageData, index) => {
                this.pagesRoot.appendChild(this.buildPageFigure(pageData, index));
                this.scrollbarTrack?.appendChild(this.createScrollbarItem(index + 1));
            });

            document.body.appendChild(overlay);
            document.documentElement.classList.add('nh-reading-open');
            document.body.classList.add('nh-reading-open');
            this.updateScrollbarThumb();
        },

        async open() {
            if (this.isOpening || this.isOpen()) return;
            if (!isGalleryDetailRoute() || !this.isEnabled()) return;
            Styles.ensureFeatureStyles('readingMode');

            const galleryId = getCurrentGalleryIdFromLocation();
            if (!galleryId) return;

            this.isOpening = true;
            const entryButton = document.getElementById('nh-reading-mode-btn');
            entryButton?.classList.add('is-loading');

            try {
                await CDN.ensure();
                const meta = await GalleryMeta.get(galleryId);
                if (!meta?.pages?.length) {
                    showToast(getUIText('reading_mode_open_failed'), { type: 'error' });
                    return;
                }

                this.currentGalleryId = galleryId;
                this.currentGalleryMeta = meta;
                this.totalPages = meta.total || meta.pages.length;
                this.currentPage = 1;

                this.buildOverlay(meta);
                this.updateStatus();
                this.updateActiveScrollbarItem(1);
                this.setupLazyObserver();
                this.setupPageObserver();
                this.bindKeydown();
                this.restoreProgress();
            } catch (error) {
                console.error('[nHentai Pro] Failed to open reading mode:', error);
                showToast(getUIText('reading_mode_open_failed'), { type: 'error' });
            } finally {
                this.isOpening = false;
                entryButton?.classList.remove('is-loading');
            }
        },

        close() {
            if (!this.isOpen()) return;
            this.persistProgress();
            this.clearSaveTimer();
            this.clearToolAutoHideTimer();
            this.teardownObservers();
            this.unbindKeydown();
            this.overlay?.remove();

            this.overlay = null;
            this.scrollContainer = null;
            this.pagesRoot = null;
            this.pageStatus = null;
            this.titleNode = null;
            this.scrollbarRoot = null;
            this.scrollbarTrack = null;
            this.scrollbarThumb = null;
            this.scrollbarPopper = null;
            this.toolRoot = null;
            this.toolScaleInputNode = null;
            this.toolGapInputNode = null;
            this.lastReaderScrollAt = 0;
            this.currentGalleryMeta = null;
            this.scrollbarItems = new Map();
            this.scrollbarPointerId = null;
            this.isDraggingScrollbar = false;

            document.documentElement.classList.remove('nh-reading-open');
            document.body.classList.remove('nh-reading-open');
            this.updateEntryButtonText();
        },

        refresh() {
            Styles.ensureFeatureStyles('readingMode');
            const routeGalleryId = getCurrentGalleryIdFromLocation();
            if (this.isOpen() && this.currentGalleryId && routeGalleryId !== this.currentGalleryId) {
                this.close();
            }
            this.ensureEntryButton();
            if (!isGalleryDetailRoute()) {
                this.close();
            } else if (this.isOpen()) {
                this.applyOverlayPreferences();
            }
        }
    };
