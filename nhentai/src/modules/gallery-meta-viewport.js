    const pageObserver = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const gallery = entry.target;
                obs.unobserve(gallery);
                loadPageCount(gallery);
            }
        });
    }, { rootMargin: '200px' });

    function cleanupLegacyPageBadges(gallery) {
        if (!gallery) return;
        const cover = gallery.querySelector('.cover');
        if (!cover) return;

        queryAll(gallery, '.nh-page-number').forEach(badge => {
            if (badge.parentElement !== cover) {
                badge.remove();
            }
        });
    }

    async function loadPageCount(gallery) {
        const cover = gallery.querySelector('.cover');
        cleanupLegacyPageBadges(gallery);
        if (!cover || cover.querySelector('.nh-page-number') || cover.dataset.pageProcessed) return;

        cover.dataset.pageProcessed = "true";
        const href = cover.getAttribute('href');
        if (!href) return;
        const match = href.match(/\/g\/(\d+)\//);
        if (!match) return;

        const id = match[1];

        // Priority feature: Move to front of queue on hover
        const priorityHandler = () => {
            if (RequestQueue) RequestQueue.prioritize(id);
        };
        gallery.addEventListener('mouseenter', priorityHandler);

        let meta = null;
        try {
            meta = await PageMetaResolver.resolve(id, { allowPartial: true });
            // 不在当前列表上下文里的画廊（如详情页“相似推荐”）回退到详情请求；与预取共享同一排队请求，不会重复发起。
            if (!meta) meta = await GalleryMeta.get(id);
        } finally {
            // Cleanup listener after load (or failure)
            gallery.removeEventListener('mouseenter', priorityHandler);
        }

        if (meta && meta.total) {
            if (!cover.querySelector('.nh-page-number')) {
                const badge = document.createElement('div');
                badge.className = 'nh-page-number';
                badge.textContent = meta.total + 'P';
                if (getComputedStyle(cover).position === 'static') {
                    cover.style.position = 'relative';
                }
                cover.appendChild(badge);
            }
        }
    }

    function runPageNumberDisplay(context = document) {
        if (!Config.get('showPageNumbers')) return;

        const galleries = getGalleryNodes(context);
        galleries.forEach(gallery => {
            cleanupLegacyPageBadges(gallery);
            const cover = gallery.querySelector('.cover');
            if (cover && !cover.dataset.pageProcessed) {
                pageObserver.observe(gallery);
            }
        });
    }

    // 预取只关注视口附近的画廊，避免无限滚动时把队列灌满。
    const PrefetchManager = {
        before: 2,
        after: 8,
        batchSize: 4,
        maxPending: 12,
        pauseQueueThreshold: 80,
        pending: new Set(),
        activeGalleries: new Set(),
        observedGallerySet: new Set(),
        observedGalleries: [],
        initialized: false,
        scanTimer: null,
        resizeHandler: null,
        scanning: false,
        observer: null,

        init() {
            if (this.initialized) return;
            this.initialized = true;
            this.observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        this.activeGalleries.add(entry.target);
                    } else {
                        this.activeGalleries.delete(entry.target);
                    }
                });
                this.scheduleScan(40);
            }, {
                rootMargin: '320px 0px 900px 0px',
                threshold: 0
            });
            this.resizeHandler = debounce(() => this.scheduleScan(80), 120);
            window.addEventListener('resize', this.resizeHandler, { passive: true });
            this.scheduleScan(30);
        },

        teardown() {
            if (this.resizeHandler) {
                window.removeEventListener('resize', this.resizeHandler);
                this.resizeHandler = null;
            }
            if (this.scanTimer) {
                clearTimeout(this.scanTimer);
                this.scanTimer = null;
            }
            if (this.observer) {
                this.observer.disconnect();
                this.observer = null;
            }
            this.pending.clear();
            this.activeGalleries.clear();
            this.observedGallerySet.clear();
            this.observedGalleries = [];
            this.initialized = false;
        },

        scheduleScan(delay = 80) {
            if (this.scanTimer) return;
            this.scanTimer = setTimeout(() => {
                this.scanTimer = null;
                this.syncObservedGalleries();
                void this.dispatchPrefetch();
            }, delay);
        },

        getGalleryId(gallery) {
            if (!gallery) return null;
            const link = gallery.querySelector(GALLERY_SELECTORS.coverLink);
            if (!link || !link.href) return null;
            const match = link.href.match(/\/g\/(\d+)\//);
            return match ? match[1] : null;
        },

        getEligibleGalleries() {
            return getGalleryNodes(document).filter(gallery => {
                if (!gallery || gallery.classList.contains(GALLERY_STATE_CLASSES.hidden)) return false;
                return !!gallery.querySelector(GALLERY_SELECTORS.coverLink);
            });
        },

        syncObservedGalleries() {
            if (!this.observer) return;
            const galleries = this.getEligibleGalleries();
            const nextSet = new Set(galleries);

            this.observedGallerySet.forEach(gallery => {
                if (nextSet.has(gallery)) return;
                this.observer.unobserve(gallery);
                this.activeGalleries.delete(gallery);
            });

            galleries.forEach(gallery => {
                if (this.observedGallerySet.has(gallery)) return;
                this.observer.observe(gallery);
            });

            this.observedGallerySet = nextSet;
            this.observedGalleries = galleries;
        },

        getAnchorIndex(galleries) {
            if (!galleries.length) return -1;
            const firstActiveIndex = galleries.findIndex(gallery => this.activeGalleries.has(gallery));
            return firstActiveIndex;
        },

        async dispatchPrefetch() {
            if (this.scanning) return;
            this.scanning = true;

            try {
                if (document.hidden) return;
                if (!Config.get('enableHoverPreview') && !Config.get('showPageNumbers')) return;
                if (RequestQueue.queue.length >= this.pauseQueueThreshold) return;
                const allowDetailPrefetch = Config.get('enableHoverPreview');

                const galleries = this.observedGalleries.filter(gallery => {
                    return gallery
                        && document.contains(gallery)
                        && !gallery.classList.contains(GALLERY_STATE_CLASSES.hidden)
                        && gallery.querySelector(GALLERY_SELECTORS.coverLink);
                });
                if (!galleries.length) return;

                const anchor = this.getAnchorIndex(galleries);
                if (anchor < 0) return;

                const start = Math.max(0, anchor - this.before);
                const end = Math.min(galleries.length - 1, anchor + this.after);
                const capacity = Math.min(this.batchSize, Math.max(0, this.maxPending - this.pending.size));
                if (capacity <= 0) return;
                await PageMetaResolver.prewarm(galleries.slice(start, end + 1).map(gallery => this.getGalleryId(gallery)));

                let dispatched = 0;
                for (let i = start; i <= end; i++) {
                    if (dispatched >= capacity) break;
                    const id = this.getGalleryId(galleries[i]);
                    if (!id) continue;

                    const pageMeta = PageMetaResolver.getStoredMeta(PageMetaResolver.getActiveEntry(), id, true);
                    if (pageMeta) {
                        if (isCompleteMeta(pageMeta)) {
                            cache.set(id, pageMeta);
                        }
                        RuntimeMetrics.prefetchSkipped++;
                        continue;
                    }

                    if (cache.has(id) || this.pending.has(id) || RequestQueue.inFlight.has(id) || RequestQueue.queuedMap.has(id)) {
                        RuntimeMetrics.prefetchSkipped++;
                        continue;
                    }

                    if (!allowDetailPrefetch) {
                        RuntimeMetrics.prefetchSkipped++;
                        continue;
                    }

                    this.pending.add(id);
                    RuntimeMetrics.prefetchScheduled++;
                    dispatched++;
                    RequestQueue.enqueue(id).finally(() => {
                        this.pending.delete(id);
                    });
                }
            } finally {
                this.scanning = false;
            }
        },

        getStats() {
            return {
                pending: this.pending.size,
                prefetchScheduled: RuntimeMetrics.prefetchScheduled,
                prefetchSkipped: RuntimeMetrics.prefetchSkipped
            };
        }
    };
