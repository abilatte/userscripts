    const PREVIEW_INITIAL_PRELOAD_COUNT = 3;
    // 后台只预载当前页之后的有限窗口，避免悬停一次就下载整本原图。
    const PREVIEW_BACKGROUND_PRELOAD_COUNT = 8;
    const PREVIEW_BACKGROUND_PRELOAD_DELAY = 120;
    const PREVIEW_POPUP_SESSION_LOCK_MS = 180;
    const PREVIEW_POPUP_SESSION_TOLERANCE = 24;
    let previewPopupHideTimer = null;
    const previewPopupState = {
        root: null,
        media: null,
        image: null,
        tagTrigger: null,
        tagPopup: null,
        seek: null,
        tip: null,
        barFill: null,
        activeGallery: null,
        isDragging: false,
        seekRaf: 0,
        pendingSeekPage: null,
        lockUntil: 0,
        lockOwner: null,
        pendingGallery: null,
        pointerX: null,
        pointerY: null,
        sessionSerial: 0,
        frozenLeft: null,
        frozenTop: null
    };

    function buildTagList(tags) {
        const groups = { artist: [], parody: [], character: [], tag: [] };
        const fmt = (n) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n;
        const mode = Config.get('translationMode');

        tags.forEach(t => {
            const count = t.count || 0;
            const enName = t.name;
            let cnName = null;
            if (DB.data[t.type] && DB.data[t.type][enName]) cnName = DB.data[t.type][enName];
            else if (DB.data.tag && DB.data.tag[enName]) cnName = DB.data.tag[enName];

            const safeEn = escapeHtml(enName);
            const safeCn = escapeHtml(cnName);
            let displayName = safeEn;
            if (cnName) {
                if (mode === 'clean') displayName = safeCn;
                else if (mode === 'original') displayName = safeEn;
                else if (mode === 'replace') displayName = `${safeCn} <span class="nh-original-tag nh-inline-subtag">${safeEn}</span>`;
                else displayName = `${safeEn} <span class="nh-translated-tag nh-inline-subtag">${safeCn}</span>`;
            }

            const html = `<span class="tag-pill" title="${safeEn} (${escapeHtml(fmt(count))})">${displayName}</span>`;
            if (groups[t.type]) groups[t.type].push(html);
            else if (t.type === 'group') groups.artist.push(`<span class="tag-pill">[${displayName}]</span>`);
        });

        const uiLang = getSettingsLanguage();
        let html = '';
        const addGroup = (title, list) => {
            if (list.length) html += `<div class="tag-category">${title}</div>${list.join('')}`;
        };
        addGroup(getUIText('preview_group_artists', uiLang), groups.artist);
        addGroup(getUIText('preview_group_parodies', uiLang), groups.parody);
        addGroup(getUIText('preview_group_characters', uiLang), groups.character);
        addGroup(getUIText('preview_group_tags', uiLang), groups.tag);
        return html || `<div class="nh-empty-state">${getUIText('preview_no_tags', uiLang)}</div>`;
    }

    function getPreviewState(id) {
        const state = states.get(id) || {
            curr: 1,
            req: 0,
            meta: null,
            tagsHtml: '',
            preloaded: new Set(),
            preloadTimer: null,
            popupFrameRatio: null,
            popupFrameWidth: null,
            popupFrameHeight: null
        };
        if (!state.preloaded) state.preloaded = new Set();
        if (states.has(id)) states.delete(id);
        states.set(id, state);
        if (states.size > MAX_PREVIEW_STATES) {
            const oldestKey = states.keys().next().value;
            const oldestState = states.get(oldestKey);
            if (oldestState?.preloadTimer) clearTimeout(oldestState.preloadTimer);
            states.delete(oldestKey);
        }
        return state;
    }

    function resolvePopupFrameRatio(meta, state) {
        if (Number.isFinite(state?.popupFrameRatio) && state.popupFrameRatio > 0) {
            return state.popupFrameRatio;
        }
        const pages = Array.isArray(meta?.pages) ? meta.pages : [];
        if (!pages.length) {
            if (state) state.popupFrameRatio = 0.72;
            return 0.72;
        }

        const sampleOrder = [3, 4, 2, 5, 1, 6];
        const ratios = [];
        sampleOrder.forEach((pageNumber) => {
            const pageData = pages[pageNumber - 1];
            const width = Number(pageData?.width);
            const height = Number(pageData?.height);
            if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
                ratios.push(width / height);
            }
        });

        if (!ratios.length) {
            if (state) state.popupFrameRatio = 0.72;
            return 0.72;
        }

        ratios.sort((a, b) => a - b);
        const medianRatio = ratios[Math.floor(ratios.length / 2)];
        const normalizedRatio = Math.max(0.55, Math.min(1.85, medianRatio));
        if (state) state.popupFrameRatio = normalizedRatio;
        return normalizedRatio;
    }

    function resolvePopupFrameDimensions(meta, state) {
        if (
            Number.isFinite(state?.popupFrameWidth) && state.popupFrameWidth > 0
            && Number.isFinite(state?.popupFrameHeight) && state.popupFrameHeight > 0
        ) {
            return {
                width: state.popupFrameWidth,
                height: state.popupFrameHeight
            };
        }

        const pages = Array.isArray(meta?.pages) ? meta.pages : [];
        const primaryOrder = [3, 4];
        const fallbackOrder = [2, 5, 1, 6];
        const samples = [];

        const pushSample = (pageNumber) => {
            const pageData = pages[pageNumber - 1];
            const width = Number(pageData?.width);
            const height = Number(pageData?.height);
            if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
            samples.push({ width, height });
            return true;
        };

        primaryOrder.forEach(pushSample);
        if (samples.length === 0) {
            fallbackOrder.some(pushSample);
        } else if (samples.length === 1) {
            fallbackOrder.some(pushSample);
        }

        if (!samples.length) {
            const fallbackRatio = resolvePopupFrameRatio(meta, state);
            const fallbackWidth = 900;
            const fallbackHeight = Math.round(fallbackWidth / fallbackRatio);
            if (state) {
                state.popupFrameWidth = fallbackWidth;
                state.popupFrameHeight = fallbackHeight;
            }
            return { width: fallbackWidth, height: fallbackHeight };
        }

        const avgWidth = Math.round(samples.reduce((sum, sample) => sum + sample.width, 0) / samples.length);
        const avgHeight = Math.round(samples.reduce((sum, sample) => sum + sample.height, 0) / samples.length);
        if (state) {
            state.popupFrameWidth = avgWidth;
            state.popupFrameHeight = avgHeight;
            state.popupFrameRatio = avgWidth / avgHeight;
        }
        return { width: avgWidth, height: avgHeight };
    }

    function applyPopupFrameSize(root, state, meta = null) {
        if (!root) return;
        const config = getPopupPreviewConfig();
        const frame = resolvePopupFrameDimensions(meta, state);
        const maxMediaWidth = Math.max(260, Math.round(window.innerWidth * (config.width / 100)) - 20);
        const maxMediaHeight = Math.max(280, Math.min(window.innerHeight - 56, Math.round(window.innerHeight * (config.maxHeightVh / 100))));
        const scaleFactor = Math.min(maxMediaWidth / frame.width, maxMediaHeight / frame.height);
        const mediaWidth = Math.max(220, Math.round(frame.width * scaleFactor));
        const mediaHeight = Math.max(220, Math.round(frame.height * scaleFactor));
        const popupWidth = Math.max(240, Math.min(window.innerWidth - 24, mediaWidth + 20));

        root.style.setProperty('--nh-preview-popup-media-height', `${mediaHeight}px`);
        root.style.setProperty('--nh-preview-popup-media-width', `${mediaWidth}px`);
        root.style.width = `${popupWidth}px`;
    }

    function beginPopupPreviewSession(gallery) {
        previewPopupState.sessionSerial += 1;
        previewPopupState.activeGallery = gallery || null;
        return previewPopupState.sessionSerial;
    }

    function isPopupPreviewSessionCurrent(gallery, sessionSerial) {
        return Boolean(
            previewPopupState.root
            && previewPopupState.activeGallery === gallery
            && previewPopupState.sessionSerial === sessionSerial
        );
    }

    function getGalleryCoverPlaceholderSrc(gallery) {
        const coverImage = gallery?.querySelector?.(GALLERY_SELECTORS.coverImage);
        if (!coverImage) return '';
        const dataSrc = coverImage.getAttribute('data-src') || coverImage.dataset?.src || '';
        const src = coverImage.getAttribute('src') || '';
        return dataSrc || src || '';
    }

    // 缩略图与封面同域；内联预览会替换封面 src，因此首次取到后缓存在节点上。
    function getGalleryThumbOrigin(gallery) {
        if (!gallery) return '';
        if (gallery.dataset.nhThumbOrigin) return gallery.dataset.nhThumbOrigin;
        try {
            const parsed = new URL(getGalleryCoverPlaceholderSrc(gallery), location.href);
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
            gallery.dataset.nhThumbOrigin = parsed.origin;
            return parsed.origin;
        } catch (error) {
            return '';
        }
    }

    // 内联预览尺寸接近封面：缩略图像素足够覆盖显示尺寸（含设备像素比）时优先缩略图，否则用原图。
    function buildInlineThumbnailUrl(gallery, img, pageData) {
        const origin = getGalleryThumbOrigin(gallery);
        const thumbPath = String(pageData?.thumbnail || '');
        const thumbWidth = Number(pageData?.thumbnailWidth) || 0;
        const neededWidth = (img?.clientWidth || 0) * (window.devicePixelRatio || 1);
        if (!thumbPath || !thumbWidth || !neededWidth || neededWidth > thumbWidth * 1.15) return '';
        if (/^https?:\/\//.test(thumbPath)) return thumbPath;
        return origin ? `${origin}/${thumbPath.replace(/^\/+/, '')}` : '';
    }

    function renderPreviewLoadingState(root, gallery = null) {
        if (!root) return;
        root.classList.add('is-visible');

        const popupImage = root.querySelector('.nh-preview-image');
        if (popupImage) {
            popupImage.style.aspectRatio = '';
            const placeholderSrc = getGalleryCoverPlaceholderSrc(gallery);
            if (placeholderSrc) {
                popupImage.classList.remove('is-empty');
                popupImage.src = placeholderSrc;
            } else {
                popupImage.removeAttribute('src');
                popupImage.classList.add('is-empty');
            }
        }

        const popup = root.querySelector('.tag-popup');
        if (popup) {
            popup.innerHTML = `<div class="nh-tag-popup-state">${getUIText('preview_loading', getSettingsLanguage())}</div>`;
            popup.classList.remove('is-loaded');
        }

        const barFill = root.querySelector('.seek-fill');
        if (barFill) {
            barFill.style.width = '0%';
        }

        const tip = root.querySelector('.seek-tooltip');
        if (tip) {
            tip.textContent = `${getUIText('preview_page_prefix', getSettingsLanguage())}1`;
        }
    }

    function clearHoverTimeout() {
        if (hoverTimeout) {
            clearTimeout(hoverTimeout);
            hoverTimeout = null;
        }
    }

    function clearPreviewPopupHideTimer() {
        if (previewPopupHideTimer) {
            clearTimeout(previewPopupHideTimer);
            previewPopupHideTimer = null;
        }
    }

    function rememberPreviewPointer(event) {
        if (!event) return;
        if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
        previewPopupState.pointerX = event.clientX;
        previewPopupState.pointerY = event.clientY;
    }

    function clearPreviewPopupSessionLock() {
        previewPopupState.lockUntil = 0;
        previewPopupState.lockOwner = null;
        previewPopupState.pendingGallery = null;
    }

    function lockPreviewPopupSession(gallery = previewPopupState.activeGallery, event = null, duration = PREVIEW_POPUP_SESSION_LOCK_MS) {
        rememberPreviewPointer(event);
        if (!gallery) return;
        previewPopupState.lockOwner = gallery;
        previewPopupState.lockUntil = Date.now() + Math.max(0, duration);
    }

    function isPointInsideElement(element, x = previewPopupState.pointerX, y = previewPopupState.pointerY, padding = 0) {
        if (!element || !document.body.contains(element)) return false;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        const rect = element.getBoundingClientRect();
        return x >= rect.left - padding
            && x <= rect.right + padding
            && y >= rect.top - padding
            && y <= rect.bottom + padding;
    }

    function isPopupPreviewSessionLocked(now = Date.now()) {
        return Boolean(previewPopupState.lockOwner && previewPopupState.lockUntil > now);
    }

    function isPointInsidePopupSession(x = previewPopupState.pointerX, y = previewPopupState.pointerY, gallery = previewPopupState.activeGallery) {
        const popup = previewPopupState.root;
        if (!gallery || !popup || !popup.classList.contains('is-visible')) return false;
        if (!document.body.contains(gallery)) return false;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        const galleryRect = gallery.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();
        const padding = PREVIEW_POPUP_SESSION_TOLERANCE;
        const left = Math.min(galleryRect.left, popupRect.left) - padding;
        const right = Math.max(galleryRect.right, popupRect.right) + padding;
        const top = Math.min(galleryRect.top, popupRect.top) - padding;
        const bottom = Math.max(galleryRect.bottom, popupRect.bottom) + padding;
        return x >= left && x <= right && y >= top && y <= bottom;
    }

    function getGalleryAtPreviewPointer() {
        if (!document.elementFromPoint) return null;
        if (!Number.isFinite(previewPopupState.pointerX) || !Number.isFinite(previewPopupState.pointerY)) return null;
        const element = document.elementFromPoint(previewPopupState.pointerX, previewPopupState.pointerY);
        const gallery = element?.closest?.('.gallery');
        if (!gallery?.dataset?.gid || gallery.dataset.init !== '1') return null;
        return gallery;
    }

    function isPopupPreviewModeEnabled() {
        if (!Config.get('enablePopupHoverPreview')) return false;
        if (window.innerWidth <= 900) return false;
        return window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;
    }

    function clampPreviewPage(nextPage, totalPages) {
        if (nextPage < 1) return 1;
        if (nextPage > totalPages) return totalPages;
        return nextPage;
    }

    function buildPreviewImageCandidateUrls(meta, pageData, usePopupMode = false) {
        const candidates = [];
        const pushCandidate = (url) => {
            if (!url || candidates.includes(url)) return;
            candidates.push(url);
        };

        if (pageData?.path) {
            buildImageCandidateUrls(pageData.path).forEach(pushCandidate);
        }

        if ((!pageData?.path || candidates.length === 0) && meta?.mediaId && pageData?.number) {
            const ext = EXT_MAP[pageData.t] || 'jpg';
            const path = `galleries/${meta.mediaId}/${pageData.number}.${ext}`;
            buildImageCandidateUrls(path).forEach(pushCandidate);
        }

        return candidates;
    }

    function getPopupPreviewConfig() {
        const scale = Math.max(60, Math.min(160, Number(Config.get('popupHoverPreviewImageScalePercent')) || 100));
        return {
            scale,
            width: Math.max(24, Math.min(80, 34 * (scale / 100))),
            maxHeightVh: Math.max(40, Math.min(90, 70 * (scale / 100))),
            position: ['auto', 'top', 'right', 'left'].includes(Config.get('popupHoverPreviewPosition'))
                ? Config.get('popupHoverPreviewPosition')
                : 'auto'
        };
    }

    function resolvePreferredPreviewImageUrl(meta, pageData, usePopupMode = false) {
        return buildPreviewImageCandidateUrls(meta, pageData, usePopupMode)[0] || '';
    }

    function ensurePreviewTagsLoaded(root, meta, state) {
        const popup = root?.querySelector?.('.tag-popup');
        if (!popup) return;
        if (!state.tagsHtml) {
            state.tagsHtml = buildTagList(meta.tags || []);
        }
        popup.innerHTML = state.tagsHtml;
        popup.classList.add('is-loaded');
    }

    function updatePreviewProgress(gallery, root, currentPage, totalPages, usePopupMode) {
        if (!usePopupMode && currentPage !== 1) {
            gallery.classList.add(GALLERY_STATE_CLASSES.previewing);
        }
        const barFill = root?.querySelector?.('.seek-fill');
        if (barFill) {
            barFill.style.width = `${(currentPage / totalPages) * 100}%`;
        }
    }

    function applyPreviewImage(img, pageData, sources, state, reqId, gallery = null, popupSessionSerial = 0, usePopupMode = false) {
        const candidateSources = Array.isArray(sources) ? sources.filter(Boolean) : [sources].filter(Boolean);
        if (!candidateSources.length) return;

        let sourceIndex = 0;
        const tryLoad = () => {
            if (sourceIndex >= candidateSources.length) return;
            const loader = new Image();
            const currentSrc = candidateSources[sourceIndex++];
            loader.onload = () => {
                if (state.req !== reqId) return;
                if (usePopupMode && !isPopupPreviewSessionCurrent(gallery, popupSessionSerial)) return;
                if (!usePopupMode && pageData.width && pageData.height) {
                    img.style.aspectRatio = `${pageData.width}/${pageData.height}`;
                } else if (usePopupMode) {
                    img.style.aspectRatio = '';
                }
                img.classList.remove('is-empty');
                img.src = currentSrc;
            };
            loader.onerror = () => {
                if (state.req !== reqId) return;
                if (usePopupMode && !isPopupPreviewSessionCurrent(gallery, popupSessionSerial)) return;
                tryLoad();
            };
            loader.src = currentSrc;
        };

        tryLoad();
    }

    function stopPreviewPreload(gallery) {
        const state = states.get(gallery?.dataset?.gid);
        if (state?.preloadTimer) {
            clearTimeout(state.preloadTimer);
            state.preloadTimer = null;
        }
    }

    function preloadPreviewImages(meta, state) {
        if (!meta?.pages?.length) return;
        if (state.preloadTimer) {
            clearTimeout(state.preloadTimer);
            state.preloadTimer = null;
        }

        const queue = [];
        const pushPage = (pageNumber) => {
            const pageData = meta.pages[pageNumber - 1];
            if (!pageData) return;
            const sources = buildPreviewImageCandidateUrls(meta, pageData, true);
            const src = sources[0] || '';
            if (!src || state.preloaded.has(src)) return;
            queue.push(src);
        };

        const preloadEnd = Math.min(meta.total, state.curr + PREVIEW_INITIAL_PRELOAD_COUNT + PREVIEW_BACKGROUND_PRELOAD_COUNT - 1);
        for (let page = state.curr; page <= preloadEnd; page += 1) {
            pushPage(page);
        }

        const preloadSrc = (src) => {
            if (!src || state.preloaded.has(src)) return;
            const img = new Image();
            img.src = src;
            state.preloaded.add(src);
        };

        queue.splice(0, PREVIEW_INITIAL_PRELOAD_COUNT).forEach(preloadSrc);

        const runBackground = () => {
            const nextSrc = queue.shift();
            if (!nextSrc) {
                state.preloadTimer = null;
                return;
            }
            preloadSrc(nextSrc);
            state.preloadTimer = setTimeout(runBackground, PREVIEW_BACKGROUND_PRELOAD_DELAY);
        };

        if (queue.length) {
            state.preloadTimer = setTimeout(runBackground, PREVIEW_BACKGROUND_PRELOAD_DELAY);
        }
    }

    function positionPreviewPopup(gallery) {
        const popup = previewPopupState.root;
        const media = previewPopupState.media;
        if (!popup || !gallery || !document.body.contains(gallery)) return;
        const config = getPopupPreviewConfig();
        const rect = gallery.getBoundingClientRect();
        popup.style.left = '0px';
        popup.style.top = '0px';
        popup.classList.add('is-visible');
        const popupRect = media?.getBoundingClientRect?.() || popup.getBoundingClientRect();
        const gap = 6;
        const centeredLeft = rect.left + (rect.width - popupRect.width) / 2;
        const rightLeft = rect.right + gap;
        const leftSideLeft = rect.left - popupRect.width - gap;
        const centeredTop = rect.top + (rect.height - popupRect.height) / 2;
        const canShowAbove = rect.top >= popupRect.height + gap;
        const canShowBelow = rect.bottom + popupRect.height + gap <= window.innerHeight;
        let left = centeredLeft;
        let top = canShowAbove ? (rect.top - popupRect.height - gap) : Math.min(window.innerHeight - popupRect.height - gap, rect.bottom + gap);

        if (config.position === 'right') {
            left = rightLeft;
            top = centeredTop;
        } else if (config.position === 'left') {
            left = leftSideLeft;
            top = centeredTop;
        } else if (config.position === 'top') {
            left = centeredLeft;
            top = canShowAbove ? (rect.top - popupRect.height - gap) : Math.min(window.innerHeight - popupRect.height - gap, rect.bottom + gap);
        } else {
            if (canShowAbove) {
                left = centeredLeft;
                top = rect.top - popupRect.height - gap;
            } else if (rightLeft + popupRect.width <= window.innerWidth - gap) {
                left = rightLeft;
                top = centeredTop;
            } else if (leftSideLeft >= gap) {
                left = leftSideLeft;
                top = centeredTop;
            } else if (canShowBelow) {
                left = centeredLeft;
                top = rect.bottom + gap;
            }
        }

        left = Math.max(gap, Math.min(window.innerWidth - popupRect.width - gap, left));
        top = Math.max(gap, Math.min(window.innerHeight - popupRect.height - gap, top));
        popup.style.left = `${Math.round(left)}px`;
        popup.style.top = `${Math.round(top)}px`;
        previewPopupState.frozenLeft = Math.round(left);
        previewPopupState.frozenTop = Math.round(top);
    }

    function syncPreviewPopupSettings(root = previewPopupState.root) {
        if (!root) return;
        const config = getPopupPreviewConfig();
        root.style.setProperty('--nh-preview-popup-width', `${config.width}vw`);
        root.style.setProperty('--nh-preview-popup-max-height', `${config.maxHeightVh}vh`);
    }

    function createPreviewSeekController({
        seek,
        tip,
        getContext,
        getPagePrefix,
        requestPreview,
        onDragStateChange
    }) {
        let isDragging = false;
        let seekRaf = 0;
        let pendingSeekPage = null;

        const stop = () => {
            isDragging = false;
            pendingSeekPage = null;
            if (seekRaf) {
                cancelAnimationFrame(seekRaf);
                seekRaf = 0;
            }
            onDragStateChange?.(false);
        };

        const resolvePage = (event) => {
            const context = getContext?.();
            const id = context?.id;
            const meta = id ? getPreviewState(id).meta : null;
            if (!meta || !seek || !tip) return null;
            const rect = seek.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            const page = Math.ceil(pct * meta.total) || 1;
            tip.style.left = `${event.clientX - rect.left}px`;
            tip.textContent = `${getPagePrefix()}${page}`;
            return { context, page };
        };

        const queuePreview = (page) => {
            pendingSeekPage = page;
            if (seekRaf) return;
            seekRaf = requestAnimationFrame(() => {
                seekRaf = 0;
                if (!isDragging || pendingSeekPage == null) return;
                const context = getContext?.();
                if (!context) return;
                requestPreview(context, pendingSeekPage);
            });
        };

        const runUpdate = (eventRef) => {
            const resolved = resolvePage(eventRef);
            if (!resolved) return;
            requestPreview(resolved.context, resolved.page);
        };

        return {
            stop,
            start(event) {
                event.preventDefault();
                event.stopPropagation();
                isDragging = true;
                onDragStateChange?.(true);
                const context = getContext?.();
                const id = context?.id;
                if (!id) return;
                if (getPreviewState(id).meta) {
                    runUpdate(event);
                } else {
                    GalleryMeta.get(id, { priority: 'interactive' }).then(meta => {
                        if (!meta) return;
                        getPreviewState(id).meta = meta;
                        runUpdate(event);
                    });
                }
            },
            move(event) {
                const resolved = resolvePage(event);
                if (isDragging && resolved?.page) {
                    queuePreview(resolved.page);
                }
            },
            click(event) {
                event.preventDefault();
                event.stopPropagation();
            },
            pointerUp(event) {
                event.preventDefault();
                event.stopPropagation();
                stop();
            },
            pointerLeave() {
                stop();
            }
        };
    }

    function stopPopupSeekDragging() {
        previewPopupState.seekController?.stop?.();
    }

    function activatePopupPreviewGallery(gallery, resetToFirstPage = true) {
        const id = gallery?.dataset?.gid;
        if (!id) return;
        const state = getPreviewState(id);
        const popup = ensurePreviewPopup();
        const isSameVisibleSession = popup.activeGallery === gallery && popup.root?.classList.contains('is-visible');
        if (popup.activeGallery && popup.activeGallery !== gallery) {
            stopPreviewPreload(popup.activeGallery);
        }
        hoveredGallery = gallery;
        clearHoverTimeout();
        clearPreviewPopupHideTimer();
        clearPreviewPopupSessionLock();
        beginPopupPreviewSession(gallery);
        applyPopupFrameSize(popup.root, state);
        positionPreviewPopup(gallery);
        if (isSameVisibleSession && !resetToFirstPage) {
            return;
        }
        renderPreviewLoadingState(popup.root, gallery);
        if (resetToFirstPage) {
            state.curr = 1;
        }
        updatePreview(gallery, 1, true);
    }

    function tryTakeOverPopupPreviewFromPointer() {
        const currentGallery = previewPopupState.activeGallery;
        let nextGallery = previewPopupState.pendingGallery;
        if (nextGallery === currentGallery || !isPointInsideElement(nextGallery)) {
            nextGallery = getGalleryAtPreviewPointer();
        }
        previewPopupState.pendingGallery = null;
        if (!nextGallery || nextGallery === currentGallery) return false;
        activatePopupPreviewGallery(nextGallery, true);
        return true;
    }

    function hidePreviewPopup(force = false) {
        const popup = previewPopupState.root;
        if (!popup) return;
        const gallery = previewPopupState.activeGallery;
        if (!force) {
            if (popup.matches(':hover') || gallery?.matches?.(':hover')) return;
            if (isPopupPreviewSessionLocked() && isPointInsidePopupSession(undefined, undefined, gallery)) return;
        }
        popup.classList.remove('is-visible', 'is-dragging');
        stopPopupSeekDragging();
        stopPreviewPreload(gallery);
        previewPopupState.activeGallery = null;
        clearPreviewPopupSessionLock();
        hoveredGallery = null;
    }

    function scheduleHidePreviewPopup(delay = 120) {
        clearPreviewPopupHideTimer();
        previewPopupHideTimer = setTimeout(() => {
            previewPopupHideTimer = null;
            const gallery = previewPopupState.activeGallery;
            const popup = previewPopupState.root;
            if (!popup || !gallery) {
                hidePreviewPopup(true);
                return;
            }
            if (popup.matches(':hover') || gallery.matches(':hover')) {
                return;
            }
            if (isPopupPreviewSessionLocked() && isPointInsidePopupSession(undefined, undefined, gallery)) {
                const remaining = Math.max(24, previewPopupState.lockUntil - Date.now());
                scheduleHidePreviewPopup(remaining);
                return;
            }
            if (tryTakeOverPopupPreviewFromPointer()) {
                return;
            }
            hidePreviewPopup(true);
        }, Math.max(24, delay));
    }

    function ensurePreviewPopup() {
        if (previewPopupState.root) return previewPopupState;
        Styles.ensureFeatureStyles('preview');
        const uiLang = getSettingsLanguage();
        const root = document.createElement('div');
        root.className = 'nh-preview-popup';
        root.innerHTML = `
            <div class="nh-preview-media">
                <img class="nh-preview-image" alt="">
                <button type="button" class="nh-preview-hotzone nh-preview-hotzone-left" aria-label="Previous preview page"></button>
                <button type="button" class="nh-preview-hotzone nh-preview-hotzone-right" aria-label="Next preview page"></button>
                <div class="tag-trigger">${getUIText('preview_tags', uiLang)}</div>
                <div class="tag-popup"><div class="nh-tag-popup-state">${getUIText('preview_loading', uiLang)}</div></div>
            </div>
            <div class="seek-container">
                <div class="seek-bg"><div class="seek-fill"></div></div>
                <div class="seek-tooltip">${getUIText('preview_page_prefix', uiLang)}1</div>
            </div>
        `;
        document.body.appendChild(root);

        previewPopupState.root = root;
        previewPopupState.media = root.querySelector('.nh-preview-media');
        previewPopupState.image = root.querySelector('.nh-preview-image');
        previewPopupState.tagTrigger = root.querySelector('.tag-trigger');
        previewPopupState.tagPopup = root.querySelector('.tag-popup');
        previewPopupState.seek = root.querySelector('.seek-container');
        previewPopupState.tip = root.querySelector('.seek-tooltip');
        previewPopupState.barFill = root.querySelector('.seek-fill');
        previewPopupState.seekController = createPreviewSeekController({
            seek: previewPopupState.seek,
            tip: previewPopupState.tip,
            getContext: () => {
                const gallery = previewPopupState.activeGallery;
                return gallery ? { gallery, id: gallery.dataset.gid } : null;
            },
            getPagePrefix: () => getUIText('preview_page_prefix', getSettingsLanguage()),
            requestPreview: ({ gallery }, page) => updatePreview(gallery, page, true),
            onDragStateChange: (dragging) => {
                previewPopupState.isDragging = dragging;
                previewPopupState.root?.classList.toggle('is-dragging', dragging);
            }
        });
        syncPreviewPopupSettings(root);
        document.addEventListener('mousemove', rememberPreviewPointer, true);

        root.addEventListener('mouseenter', () => {
            clearPreviewPopupHideTimer();
            clearPreviewPopupSessionLock();
            if (previewPopupState.activeGallery) {
                hoveredGallery = previewPopupState.activeGallery;
            }
        });
        root.addEventListener('mouseleave', (event) => {
            rememberPreviewPointer(event);
            const gallery = previewPopupState.activeGallery;
            if (gallery && event.relatedTarget && gallery.contains(event.relatedTarget)) return;
            hoveredGallery = gallery;
            lockPreviewPopupSession(gallery, event);
            scheduleHidePreviewPopup();
        });
        root.querySelector('.nh-preview-hotzone-left').addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (previewPopupState.activeGallery) updatePreview(previewPopupState.activeGallery, -1);
        });
        root.querySelector('.nh-preview-hotzone-right').addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (previewPopupState.activeGallery) updatePreview(previewPopupState.activeGallery, 1);
        });
        previewPopupState.tagTrigger.addEventListener('mouseenter', () => {
            clearHoverTimeout();
            clearPreviewPopupHideTimer();
            if (!previewPopupState.activeGallery) return;
            const id = previewPopupState.activeGallery.dataset.gid;
            updatePreview(previewPopupState.activeGallery, getPreviewState(id).curr, true);
        });
        previewPopupState.seek.addEventListener('mousedown', (event) => {
            previewPopupState.seekController.start(event);
        });
        previewPopupState.seek.addEventListener('mousemove', (event) => {
            previewPopupState.seekController.move(event);
        });
        previewPopupState.seek.addEventListener('mouseup', (event) => {
            previewPopupState.seekController.pointerUp(event);
        });
        previewPopupState.seek.addEventListener('mouseleave', () => {
            previewPopupState.seekController.pointerLeave();
        });
        previewPopupState.seek.addEventListener('click', (event) => {
            previewPopupState.seekController.click(event);
        });

        const syncPopupPosition = () => {
            if (!previewPopupState.root?.classList.contains('is-visible') || !previewPopupState.activeGallery) return;
            positionPreviewPopup(previewPopupState.activeGallery);
        };
        window.addEventListener('scroll', syncPopupPosition, true);
        window.addEventListener('resize', syncPopupPosition);
        return previewPopupState;
    }

    function updatePreview(gallery, val, isJump = false) {
        const id = gallery?.dataset?.gid;
        if (!id) return Promise.resolve(null);
        const state = getPreviewState(id);
        const usePopupMode = isPopupPreviewModeEnabled();
        const popup = usePopupMode ? ensurePreviewPopup() : null;
        const root = usePopupMode ? popup.root : gallery;
        const img = usePopupMode ? popup.image : gallery.querySelector(GALLERY_SELECTORS.coverImage);
        const popupSessionSerial = usePopupMode ? previewPopupState.sessionSerial : 0;
        if (!img) return Promise.resolve(null);

        if (usePopupMode) {
            clearPreviewPopupHideTimer();
            syncPreviewPopupSettings(popup.root);
            applyPopupFrameSize(popup.root, state);
            const shouldReposition = popup.activeGallery !== gallery
                || !popup.root.classList.contains('is-visible')
                || !popup.root.matches(':hover');
            if (shouldReposition) {
                positionPreviewPopup(gallery);
            } else if (Number.isFinite(previewPopupState.frozenLeft) && Number.isFinite(previewPopupState.frozenTop)) {
                popup.root.style.left = `${previewPopupState.frozenLeft}px`;
                popup.root.style.top = `${previewPopupState.frozenTop}px`;
            }
        }

        return GalleryMeta.get(id, { priority: 'interactive' }).then(meta => {
            if (usePopupMode && !isPopupPreviewSessionCurrent(gallery, popupSessionSerial)) return null;
            if (!meta) return null;
            state.meta = meta;
            if (usePopupMode) {
                applyPopupFrameSize(popup.root, state, meta);
                if (!popup.root.matches(':hover')) {
                    positionPreviewPopup(gallery);
                }
            }
            let next = isJump ? val : state.curr + val;
            next = clampPreviewPage(next, meta.total);
            ensurePreviewTagsLoaded(root, meta, state);
            if (next === state.curr && !isJump && val !== 0) return meta;
            state.curr = next;
            const reqId = ++state.req;
            updatePreviewProgress(gallery, root, state.curr, meta.total, usePopupMode);
            const pageData = meta.pages[state.curr - 1];
            if (!pageData) return meta;
            const sources = buildPreviewImageCandidateUrls(meta, pageData, usePopupMode);
            if (!usePopupMode) {
                const thumbUrl = buildInlineThumbnailUrl(gallery, img, pageData);
                if (thumbUrl) sources.unshift(thumbUrl);
            }
            if (!sources.length) return meta;
            applyPreviewImage(img, pageData, sources, state, reqId, gallery, popupSessionSerial, usePopupMode);
            if (usePopupMode) {
                preloadPreviewImages(meta, state);
            }
            return meta;
        });
    }

    function initPreviewUI(gallery) {
        if (!Config.get('enableHoverPreview')) return;
        if (gallery.dataset.init) return;
        Styles.ensureFeatureStyles('preview');
        const link = gallery.querySelector(GALLERY_SELECTORS.coverLink);
        if (!link) return;
        const id = link.href.match(/\/g\/(\d+)\//)?.[1];
        if (!id) return;

        const usePopupMode = isPopupPreviewModeEnabled();
        gallery.dataset.gid = id;
        gallery.dataset.init = '1';
        let stopInlineSeekDragging = () => {};

        if (!usePopupMode) {
            const uiLang = getSettingsLanguage();
            const pagePrefix = getUIText('preview_page_prefix', uiLang);
            const ui = document.createElement('div');
            ui.className = 'inline-preview-ui';
            ui.innerHTML = `
                <div class="tag-trigger">${getUIText('preview_tags', uiLang)}</div>
                <div class="tag-popup"><div class="nh-tag-popup-state">${getUIText('preview_loading', uiLang)}</div></div>
                <div class="hotzone hotzone-left"></div>
                <div class="hotzone hotzone-right"></div>
                <div class="seek-container"><div class="seek-bg"><div class="seek-fill"></div></div><div class="seek-tooltip">${pagePrefix}1</div></div>
            `;
            ui.addEventListener('dragstart', (event) => {
                event.preventDefault();
                return false;
            });
            // Ctrl/⌘/Shift+点击是在新标签或新窗口打开，交还给封面链接处理。
            const isOpenLinkClick = (event) => event.ctrlKey || event.metaKey || event.shiftKey;
            ui.querySelector('.hotzone-left').onclick = (event) => {
                if (isOpenLinkClick(event)) return;
                event.preventDefault();
                event.stopPropagation();
                updatePreview(gallery, -1);
            };
            ui.querySelector('.hotzone-right').onclick = (event) => {
                if (isOpenLinkClick(event)) return;
                event.preventDefault();
                event.stopPropagation();
                updatePreview(gallery, 1);
            };

            const tagTrigger = ui.querySelector('.tag-trigger');
            tagTrigger.onmouseenter = () => {
                clearHoverTimeout();
                updatePreview(gallery, 0);
            };

            const seek = ui.querySelector('.seek-container');
            const tip = ui.querySelector('.seek-tooltip');
            const inlineSeekController = createPreviewSeekController({
                seek,
                tip,
                getContext: () => ({ gallery, id }),
                getPagePrefix: () => pagePrefix,
                requestPreview: ({ gallery: currentGallery }, page) => updatePreview(currentGallery, page, true)
            });
            stopInlineSeekDragging = inlineSeekController.stop;

            seek.onmousedown = (event) => inlineSeekController.start(event);
            seek.onmousemove = (event) => inlineSeekController.move(event);
            seek.onmouseup = (event) => inlineSeekController.pointerUp(event);
            seek.onmouseleave = () => inlineSeekController.pointerLeave();
            seek.onclick = (event) => inlineSeekController.click(event);

            link.style.position = 'relative';
            link.appendChild(ui);
        } else {
            ensurePreviewPopup();
        }

        gallery.addEventListener('mouseenter', (event) => {
            rememberPreviewPointer(event);
            hoveredGallery = gallery;
            clearHoverTimeout();
            clearPreviewPopupHideTimer();
            if (usePopupMode) {
                const popup = ensurePreviewPopup();
                const sameSessionGallery = popup.activeGallery === gallery && popup.root?.classList.contains('is-visible');
                activatePopupPreviewGallery(gallery, !sameSessionGallery);
                return;
            }
            if (!getPreviewState(id).meta) {
                hoverTimeout = setTimeout(() => { updatePreview(gallery, 0); }, 300);
            } else {
                updatePreview(gallery, 0);
            }
        });

        gallery.addEventListener('mouseleave', (event) => {
            clearHoverTimeout();
            if (usePopupMode) {
                rememberPreviewPointer(event);
                const popupRoot = ensurePreviewPopup().root;
                if (popupRoot && event.relatedTarget && popupRoot.contains(event.relatedTarget)) {
                    return;
                }
                hoveredGallery = gallery;
                lockPreviewPopupSession(gallery, event);
                scheduleHidePreviewPopup();
                return;
            }
            hoveredGallery = null;
            stopInlineSeekDragging();
        });
    }

