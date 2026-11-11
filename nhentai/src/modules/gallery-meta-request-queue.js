    // 请求队列统一接管画廊元数据请求，优先走 /api/v2/galleries/{id}，保留旧接口回退。
    const RequestQueue = {
        queue: [],
        queuedMap: new Map(),
        inFlight: new Map(),
        processing: false,
        lastRequestTime: 0,
        baseInterval: 300,
        minInterval: 300,
        maxInterval: 1500,
        requestTimeoutMs: 10000,
        requestWindowMs: 60 * 1000,
        maxRequestsPerWindow: 120,
        recentRequests: [],
        maxQueueSize: 240,
        abortCount: 0,
        lastAbortAt: 0,
        last429At: 0,
        lastErrorAt: 0,
        lastErrorType: '',
        last429WarnAt: 0,
        warn429IntervalMs: 15 * 1000,
        rateLimitedUntil: 0,
        lastRateLimitDelayMs: 0,
        maxHeaderBackoffMs: 10 * 60 * 1000,

        pruneRecentRequests(now = GalleryMetaTransport.now()) {
            const threshold = now - this.requestWindowMs;
            while (this.recentRequests.length && this.recentRequests[0] < threshold) {
                this.recentRequests.shift();
            }
        },

        trimQueue() {
            const droppedIds = GalleryMetaQueuePolicy.trimOverflow(this.queue, this.maxQueueSize);
            for (const id of droppedIds) {
                const pending = this.queuedMap.get(id);
                if (pending) {
                    pending.resolve(null);
                    this.queuedMap.delete(id);
                }
            }
        },

        async waitForWindowSlot() {
            this.pruneRecentRequests();
            if (this.recentRequests.length < this.maxRequestsPerWindow) return;
            const oldest = this.recentRequests[0];
            const waitMs = Math.max(0, this.requestWindowMs - (GalleryMetaTransport.now() - oldest)) + 10;
            await GalleryMetaTransport.sleep(waitMs);
        },

        enqueue(id) {
            const decision = GalleryMetaQueuePolicy.decideEnqueue(id, {
                cached: cache.get(id),
                pageCached: PageMetaResolver.getStoredMeta(PageMetaResolver.getActiveEntry(), id, false),
                inFlight: this.inFlight.get(id) || null,
                queued: this.queuedMap.get(id)?.promise || null
            });

            if (decision.action === 'cached') {
                return Promise.resolve(decision.value);
            }
            if (decision.action === 'page-cached') {
                cache.set(id, decision.value);
                return Promise.resolve(decision.value);
            }
            if (decision.action === 'share-inflight' || decision.action === 'share-queued') {
                return decision.promise;
            }

            let resolveFn;
            const promise = new Promise(resolve => {
                resolveFn = resolve;
            });

            this.queuedMap.set(id, { promise, resolve: resolveFn });
            this.queue.push({ id });
            this.trimQueue();
            this.process();
            return promise;
        },

        prioritize(id) {
            GalleryMetaQueuePolicy.prioritizeBatch(
                this.queue,
                id,
                GalleryMetaQueuePolicy.PRIORITY_BATCH_SIZE
            );
            this.process();
        },

        logRateLimitWarning(now = GalleryMetaTransport.now()) {
            if (now - this.last429WarnAt < this.warn429IntervalMs) return;
            this.last429WarnAt = now;
            console.warn('[nHentai Pro] Gallery meta requests are being rate-limited (HTTP 429), queue has slowed down.');
        },

        handleRateLimitedResponse(res, now = GalleryMetaTransport.now()) {
            RuntimeMetrics.fetch429++;
            RuntimeMetrics.recordFailure(now);
            this.last429At = now;
            const next = GalleryMetaQueuePolicy.applyRateLimitedBackoff({
                now,
                headers: res?.headers,
                minInterval: this.minInterval,
                maxInterval: this.maxInterval,
                rateLimitedUntil: this.rateLimitedUntil,
                maxHeaderBackoffMs: this.maxHeaderBackoffMs
            });
            this.minInterval = next.minInterval;
            this.rateLimitedUntil = next.rateLimitedUntil;
            this.lastRateLimitDelayMs = next.lastRateLimitDelayMs;
            this.logRateLimitWarning(now);
        },

        async fetchMeta(id) {
            const controller = GalleryMetaTransport.createAbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);
            try {
                const endpoints = [
                    API_ENDPOINTS.galleryV2(id),
                    API_ENDPOINTS.legacyGallery(id)
                ];
                let data = null;

                for (let index = 0; index < endpoints.length; index++) {
                    const endpoint = endpoints[index];
                    const res = await GalleryMetaTransport.fetch(endpoint, {
                        signal: controller.signal,
                        headers: buildNhentaiApiHeaders(endpoint)
                    });
                    if (res.status === 404 && index < endpoints.length - 1) {
                        continue;
                    }
                    if (res.status === 429) {
                        this.handleRateLimitedResponse(res, GalleryMetaTransport.now());
                        return null;
                    }
                    if (!res.ok) throw new Error(res.statusText || `HTTP ${res.status}`);
                    data = await res.json();
                    break;
                }

                if (this.minInterval > this.baseInterval) {
                    this.minInterval = Math.max(this.baseInterval, this.minInterval - 40);
                }

                const meta = normalizeGalleryMeta(data || {});
                cache.set(id, meta);
                PageMetaResolver.rememberResolvedMeta(id, meta);
                RuntimeMetrics.fetchOk++;
                return meta;
            } catch (e) {
                if (e?.name === 'AbortError') {
                    const now = GalleryMetaTransport.now();
                    RuntimeMetrics.fetchAbort++;
                    this.abortCount++;
                    this.lastAbortAt = now;
                    if (Config.get('showDevPanel')) {
                        console.debug(`[nHentai Pro] Meta fetch aborted for ${id}`);
                    }
                    return null;
                }
                RuntimeMetrics.fetchError++;
                RuntimeMetrics.recordFailure();
                this.lastErrorAt = GalleryMetaTransport.now();
                this.lastErrorType = e?.name || e?.message || 'UnknownError';
                this.minInterval = Math.min(this.maxInterval, this.minInterval + 80);
                console.error(`[nHentai Pro] Failed to fetch meta for ${id}:`, e);
                return null;
            } finally {
                clearTimeout(timeoutId);
            }
        },

        async process() {
            if (this.processing || this.queue.length === 0) return;
            this.processing = true;

            while (this.queue.length > 0) {
                let now = GalleryMetaTransport.now();
                if (this.rateLimitedUntil > now) {
                    await GalleryMetaTransport.sleep(this.rateLimitedUntil - now);
                    now = GalleryMetaTransport.now();
                }
                const timeSinceLast = now - this.lastRequestTime;

                if (timeSinceLast < this.minInterval) {
                    await GalleryMetaTransport.sleep(this.minInterval - timeSinceLast);
                }
                await this.waitForWindowSlot();

                const { id } = this.queue.shift();
                const queued = this.queuedMap.get(id);
                if (!queued) continue;
                this.queuedMap.delete(id);

                this.pruneRecentRequests();
                this.recentRequests.push(GalleryMetaTransport.now());
                const requestPromise = this.fetchMeta(id);
                this.inFlight.set(id, requestPromise);

                try {
                    const meta = await requestPromise;
                    queued.resolve(meta);
                } finally {
                    this.inFlight.delete(id);
                    this.lastRequestTime = GalleryMetaTransport.now();
                }
            }

            this.processing = false;
        },

        getStats() {
            return {
                queueLength: this.queue.length,
                inFlight: this.inFlight.size,
                minInterval: this.minInterval,
                recentRequestCount: this.recentRequests.length,
                maxRequestsPerWindow: this.maxRequestsPerWindow,
                cacheSize: cache.size,
                cacheHit: RuntimeMetrics.cacheHit,
                cacheMiss: RuntimeMetrics.cacheMiss,
                cacheHitRate: RuntimeMetrics.getCacheHitRate(),
                fetch429: RuntimeMetrics.fetch429,
                pageListFetch: RuntimeMetrics.pageListFetch,
                recentFailures: RuntimeMetrics.getRecentFailureCount(),
                fetchAbort: RuntimeMetrics.fetchAbort,
                abortCount: this.abortCount,
                lastAbortAt: this.lastAbortAt,
                last429At: this.last429At,
                rateLimitedUntil: this.rateLimitedUntil,
                lastRateLimitDelayMs: this.lastRateLimitDelayMs,
                lastErrorAt: this.lastErrorAt,
                lastErrorType: this.lastErrorType
            };
        }
    };

    function getCompleteMeta(id, { priority = 'normal' } = {}) {
        const cached = cache.get(id);
        if (cached) {
            RuntimeMetrics.cacheHit++;
            return Promise.resolve(cached);
        }

        return PageMetaResolver.resolve(id).then(meta => {
            if (meta) {
                RuntimeMetrics.cacheHit++;
                cache.set(id, meta);
                return meta;
            }
            RuntimeMetrics.cacheMiss++;
            const request = RequestQueue.enqueue(id);
            // 调用方入口处的 prioritize 只对已排队的 id 生效；新入队的交互请求在这里提到队首。
            if (priority === 'interactive') {
                RequestQueue.prioritize(id);
            }
            return request;
        });
    }
