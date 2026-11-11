    const Diagnostics = {
        panel: null,
        timer: null,
        intervalMs: 2000,
        infiniteScrollDebug: {
            lastActivationSource: '',
            lastResetReason: '',
            lastNextUrlSyncSource: ''
        },

        recordInfiniteScrollDebug(key, value) {
            if (!key) return;
            this.infiniteScrollDebug[key] = value || '';
        },

        getInfiniteScrollDebug() {
            return { ...this.infiniteScrollDebug };
        },

        resetInfiniteScrollDebug() {
            this.infiniteScrollDebug = {
                lastActivationSource: '',
                lastResetReason: '',
                lastNextUrlSyncSource: ''
            };
        },

        formatValue(value) {
            if (typeof value === 'boolean') return value ? '是' : '否';
            if (value === null || typeof value === 'undefined' || value === '') return '—';
            return String(value);
        },

        formatUrlLike(value) {
            if (!value) return '—';
            try {
                const parsed = new URL(value, location.origin);
                return `${parsed.pathname}${parsed.search}`;
            } catch (error) {
                return String(value);
            }
        },

        formatTime(value) {
            if (!value) return '—';
            try {
                return new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
            } catch (error) {
                return '—';
            }
        },

        getApiKeyStatusRows() {
            const configured = Boolean(String(Config.get('apiKey') || '').trim());
            const testStatus = Config.get('apiKeyTestStatus');
            const testLabel = testStatus === 'success'
                ? '测试成功'
                : (testStatus === 'failure' ? '测试失败' : '—');
            return [
                ['API Key', configured ? '已配置' : '未配置'],
                ['最近测试', testLabel],
                ['测试时间', this.formatTime(Config.get('apiKeyTestedAt'))]
            ];
        },

        renderGroupSections(sections = []) {
            return sections.map(section => `
                <div class="gsh">${section.title}</div>
                <div class="gsb">
                    ${section.rows.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('')}
                </div>
            `).join('');
        },

        ensurePanel() {
            if (this.panel && this.panel.isConnected) return;
            this.panel = document.createElement('div');
            this.panel.id = 'nh-dev-panel';
            document.body.appendChild(this.panel);
        },

        render() {
            this.ensurePanel();
            const metaSnapshot = GalleryMeta.snapshot();
            const queueStats = metaSnapshot.queue;
            const prefetchStats = metaSnapshot.prefetch;
            const infiniteStats = InfiniteScroll.getStats();
            const groups = [
                {
                    title: '请求队列',
                    sections: [
                        {
                            title: '基础指标',
                            rows: [
                                ['队列长度', queueStats.queueLength],
                                ['进行中请求', queueStats.inFlight],
                                ['限速间隔(ms)', queueStats.minInterval],
                                ['窗口请求数', `${queueStats.recentRequestCount}/${queueStats.maxRequestsPerWindow}`],
                                ['缓存大小', queueStats.cacheSize],
                                ['缓存命中率', `${(queueStats.cacheHitRate * 100).toFixed(1)}%`],
                                ['429 次数', queueStats.fetch429],
                                ['列表 API 请求', queueStats.pageListFetch],
                                ['最近失败(1m)', queueStats.recentFailures]
                            ]
                        },
                        {
                            title: '最近事件',
                            rows: [
                                ['Abort 次数', queueStats.fetchAbort],
                                ['最近 Abort', this.formatTime(queueStats.lastAbortAt)],
                                ['最近 429', this.formatTime(queueStats.last429At)],
                                ['最近错误类型', this.formatValue(queueStats.lastErrorType)],
                                ['最近错误时间', this.formatTime(queueStats.lastErrorAt)]
                            ]
                        },
                        {
                            title: 'API Key',
                            rows: this.getApiKeyStatusRows()
                        }
                    ]
                },
                {
                    title: '预取',
                    sections: [
                        {
                            title: '预取状态',
                            rows: [
                                ['预取排队数', prefetchStats.pending],
                                ['预取已调度', prefetchStats.prefetchScheduled],
                                ['预取已跳过', prefetchStats.prefetchSkipped]
                            ]
                        }
                    ]
                },
                {
                    title: '无限滚动',
                    sections: [
                        {
                            title: '基础状态',
                            rows: [
                                ['是否列表页', this.formatValue(infiniteStats.isListPage)],
                                ['当前路由', this.formatUrlLike(infiniteStats.currentRouteUrl)],
                                ['当前 listKey', this.formatValue(infiniteStats.currentListKey)],
                                ['当前 nextUrl', this.formatUrlLike(infiniteStats.nextUrl)],
                                ['pendingRequestUrl', this.formatUrlLike(infiniteStats.pendingRequestUrl)],
                                ['lastLoadedPageUrl', this.formatUrlLike(infiniteStats.lastLoadedPageUrl)],
                                ['loading', this.formatValue(infiniteStats.loading)],
                                ['userScrolledSinceInit', this.formatValue(infiniteStats.userScrolledSinceInit)],
                                ['inputIntentSinceInit', this.formatValue(infiniteStats.inputIntentSinceInit)],
                                ['loadedUrls', infiniteStats.loadedUrlCount],
                                ['sentinel 存在', this.formatValue(infiniteStats.sentinelPresent)],
                                ['sentinel 文案', this.formatValue(infiniteStats.sentinelText)]
                            ]
                        },
                        {
                            title: '最近决策',
                            rows: [
                                ['basePageNumber', this.formatValue(infiniteStats.basePageNumber)],
                                ['originRouteUrl', this.formatUrlLike(infiniteStats.originRouteUrl)],
                                ['paginationRecoveryAttempts', this.formatValue(infiniteStats.paginationRecoveryAttempts)],
                                ['hasPaginationContext', this.formatValue(infiniteStats.hasPaginationContext)],
                                ['hasAppendedPageNodes', this.formatValue(infiniteStats.hasAppendedPageNodes)],
                                ['lastActivationSource', this.formatValue(infiniteStats.lastActivationSource)],
                                ['lastResetReason', this.formatValue(infiniteStats.lastResetReason)],
                                ['lastNextUrlSyncSource', this.formatValue(infiniteStats.lastNextUrlSyncSource)]
                            ]
                        }
                    ]
                }
            ];

            this.panel.innerHTML = `
                <div class="hd">nH Pro Dev</div>
                <div class="groups">
                    ${groups.map(group => `
                        <div class="group">
                            <div class="gh">${group.title}</div>
                            ${this.renderGroupSections(group.sections)}
                        </div>
                    `).join('')}
                </div>
            `;
        },

        start() {
            if (this.timer) return;
            Styles.ensureFeatureStyles('diagnostics');
            this.render();
            this.timer = setInterval(() => this.render(), this.intervalMs);
        },

        stop() {
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
            if (this.panel && this.panel.isConnected) {
                this.panel.remove();
            }
            this.panel = null;
        },

        sync() {
            if (Config.get('showDevPanel')) this.start();
            else this.stop();
        }
    };
