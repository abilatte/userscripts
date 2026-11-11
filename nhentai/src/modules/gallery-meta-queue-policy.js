    // 队列纯策略：无 DOM / 无 fetch，可在 Node 中直接特征测试。
    const GalleryMetaQueuePolicy = {
        PRIORITY_BATCH_SIZE: 9,

        parseRetryAfterMs(value, now) {
            if (!value) return 0;
            const normalized = String(value).trim();
            const seconds = Number(normalized);
            if (Number.isFinite(seconds) && seconds >= 0) {
                return seconds * 1000;
            }
            const resetAt = Date.parse(normalized);
            return Number.isFinite(resetAt) ? Math.max(0, resetAt - now) : 0;
        },

        parseRateLimitResetMs(value, now) {
            if (!value) return 0;
            const normalized = String(value).trim();
            const numeric = Number(normalized);
            if (Number.isFinite(numeric) && numeric >= 0) {
                if (numeric > 1e12) return Math.max(0, numeric - now);
                if (numeric > 1e9) return Math.max(0, numeric * 1000 - now);
                return numeric * 1000;
            }
            const resetAt = Date.parse(normalized);
            return Number.isFinite(resetAt) ? Math.max(0, resetAt - now) : 0;
        },

        clampHeaderBackoffMs(delayMs, maxHeaderBackoffMs) {
            if (!Number.isFinite(delayMs) || delayMs <= 0) return 0;
            return Math.min(maxHeaderBackoffMs, Math.ceil(delayMs));
        },

        getHeaderValue(headers, names = []) {
            if (!headers?.get) return '';
            for (const name of names) {
                const value = headers.get(name);
                if (value) return value;
            }
            return '';
        },

        getRateLimitBackoffMs(headers, now, maxHeaderBackoffMs) {
            const retryAfter = this.getHeaderValue(headers, ['Retry-After']);
            const retryAfterMs = this.clampHeaderBackoffMs(
                this.parseRetryAfterMs(retryAfter, now),
                maxHeaderBackoffMs
            );
            if (retryAfterMs > 0) return retryAfterMs;

            const resetValue = this.getHeaderValue(headers, [
                'RateLimit-Reset',
                'X-RateLimit-Reset',
                'X-Rate-Limit-Reset'
            ]);
            return this.clampHeaderBackoffMs(
                this.parseRateLimitResetMs(resetValue, now),
                maxHeaderBackoffMs
            );
        },

        // 返回入队决策；调用方负责真正写入 queue / 触发 process。
        decideEnqueue(id, {
            cached = null,
            pageCached = null,
            inFlight = null,
            queued = null
        } = {}) {
            if (cached) return { action: 'cached', value: cached };
            if (pageCached) return { action: 'page-cached', value: pageCached };
            if (inFlight) return { action: 'share-inflight', promise: inFlight };
            if (queued) return { action: 'share-queued', promise: queued };
            return { action: 'enqueue' };
        },

        // 丢弃最旧任务；返回被 drop 的 id 列表，供调用方 resolve(null)。
        trimOverflow(queue, maxQueueSize) {
            const overflow = queue.length - maxQueueSize;
            if (overflow <= 0) return [];
            const dropped = [];
            for (let i = 0; i < overflow; i++) {
                const task = queue.shift();
                if (!task) break;
                dropped.push(task.id);
            }
            return dropped;
        },

        // 批量前移：命中项及其后 BATCH_SIZE-1 项整体提到队首。
        prioritizeBatch(queue, id, batchSize = this.PRIORITY_BATCH_SIZE) {
            const idx = queue.findIndex(task => task.id === id);
            if (idx <= 0) return false;
            const priorityBatch = queue.splice(idx, batchSize);
            queue.unshift(...priorityBatch);
            return true;
        },

        applyRateLimitedBackoff({
            now,
            headers,
            minInterval,
            maxInterval,
            rateLimitedUntil,
            maxHeaderBackoffMs
        }) {
            const backoffMs = this.getRateLimitBackoffMs(headers, now, maxHeaderBackoffMs);
            if (backoffMs > 0) {
                return {
                    minInterval,
                    rateLimitedUntil: Math.max(rateLimitedUntil || 0, now + backoffMs),
                    lastRateLimitDelayMs: backoffMs,
                    usedHeaderBackoff: true
                };
            }
            return {
                minInterval: Math.min(maxInterval, minInterval + 200),
                rateLimitedUntil: rateLimitedUntil || 0,
                lastRateLimitDelayMs: 0,
                usedHeaderBackoff: false
            };
        }
    };
