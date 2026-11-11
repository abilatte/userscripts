    const UserSettingsBlacklistFilter = {
        activeType: 'all',
        pendingLoad: null,
        pathTypeCache: new Map(),
        nameTypeCache: new Map(),

        getSection(context = document) {
            const root = context.matches?.('.acc-page') ? context : queryOne(context, '.acc-page');
            if (!root) return null;
            return queryAll(root, '.acc-body').find(section => {
                return queryOne(section, '.bl-search') && queryOne(section, '.tag-list');
            }) || null;
        },

        getFilterItems() {
            return [
                { key: 'all', label: getUIText('blacklist_filter_all') },
                { key: 'tag', label: getUIText('blacklist_filter_tag') },
                { key: 'artist', label: getUIText('blacklist_filter_artist') },
                { key: 'character', label: getUIText('blacklist_filter_character') },
                { key: 'parody', label: getUIText('blacklist_filter_parody') },
                { key: 'group', label: getUIText('blacklist_filter_group') },
                { key: 'language', label: getUIText('blacklist_filter_language') },
                { key: 'category', label: getUIText('blacklist_filter_category') }
            ];
        },

        normalizeType(type = '') {
            const value = String(type || '').trim().toLowerCase();
            const map = {
                all: 'all',
                tag: 'tag',
                tags: 'tag',
                artist: 'artist',
                artists: 'artist',
                character: 'character',
                characters: 'character',
                parody: 'parody',
                parodies: 'parody',
                group: 'group',
                groups: 'group',
                language: 'language',
                languages: 'language',
                category: 'category',
                categories: 'category',
                全部: 'all',
                标签: 'tag',
                作者: 'artist',
                角色: 'character',
                原作: 'parody',
                社团: 'group',
                语言: 'language',
                分类: 'category'
            };
            return map[value] || '';
        },

        normalizeNameKey(name = '') {
            return String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
        },

        detectTypeFromHref(href = '') {
            const normalized = normalizeTagUrlPath(href);
            if (normalized.includes('/artist/')) return 'artist';
            if (normalized.includes('/character/')) return 'character';
            if (normalized.includes('/parody/')) return 'parody';
            if (normalized.includes('/group/')) return 'group';
            if (normalized.includes('/language/')) return 'language';
            if (normalized.includes('/category/')) return 'category';
            if (normalized.includes('/tag/')) return 'tag';
            return '';
        },

        cacheEntry(tag) {
            const normalizedType = this.normalizeType(tag?.type);
            if (!normalizedType) return;
            const pathKey = normalizeTagUrlPath(tag?.url || '');
            if (pathKey) this.pathTypeCache.set(pathKey, normalizedType);
            const nameKey = this.normalizeNameKey(tag?.name || '');
            if (nameKey && !this.nameTypeCache.has(nameKey)) {
                this.nameTypeCache.set(nameKey, normalizedType);
            }
        },

        async loadBlacklistMeta() {
            if (!isUserLoggedIn()) return;
            if (this.pendingLoad) return this.pendingLoad;
            this.pendingLoad = requestNhentaiApiJson(API_ENDPOINTS.blacklist, { method: 'GET' })
                .then(data => {
                    const entries = Array.isArray(data)
                        ? data
                        : (Array.isArray(data?.result)
                            ? data.result
                            : (Array.isArray(data?.tags) ? data.tags : []));
                    entries.forEach(tag => this.cacheEntry(tag));
                })
                .catch(() => null)
                .finally(() => {
                    this.pendingLoad = null;
                });
            return this.pendingLoad;
        },

        resolveChipType(chip) {
            if (!chip) return '';
            if (chip.dataset.nhBlacklistType) return chip.dataset.nhBlacklistType;

            const link = queryOne(chip, 'a.tag-name');
            const hrefType = this.detectTypeFromHref(link?.getAttribute('href') || link?.href || '');
            if (hrefType) {
                chip.dataset.nhBlacklistType = hrefType;
                return hrefType;
            }

            const badge = queryOne(chip, '.tag-type-badge');
            const badgeType = this.normalizeType(badge?.textContent || '');
            if (badgeType) {
                chip.dataset.nhBlacklistType = badgeType;
                return badgeType;
            }

            const nameNode = queryOne(chip, '.tag-name, .tag-name-struck');
            const nameKey = this.normalizeNameKey(nameNode?.textContent || '');
            const cachedType = this.nameTypeCache.get(nameKey) || '';
            if (cachedType) {
                chip.dataset.nhBlacklistType = cachedType;
                return cachedType;
            }

            return '';
        },

        ensureFilterBar(section) {
            const searchBox = queryOne(section, '.bl-search');
            if (!searchBox) return null;

            let bar = queryOne(section, '.nh-blacklist-filter-bar');
            if (!bar) {
                bar = document.createElement('div');
                bar.className = 'nh-blacklist-filter-bar';
                searchBox.insertAdjacentElement('afterend', bar);
            }

            if (!bar.dataset.bound) {
                bar.addEventListener('click', event => {
                    const button = event.target.closest('.nh-blacklist-filter-btn');
                    if (!button) return;
                    this.activeType = button.dataset.filterType || 'all';
                    this.apply(section);
                });
                bar.dataset.bound = 'true';
            }

            bar.innerHTML = this.getFilterItems().map(item => {
                const activeClass = item.key === this.activeType ? ' is-active' : '';
                return `<button type="button" class="nh-blacklist-filter-btn${activeClass}" data-filter-type="${item.key}">${item.label}<span class="nh-blacklist-filter-count">0</span></button>`;
            }).join('');
            return bar;
        },

        ensureEmptyState(section) {
            let empty = queryOne(section, '.nh-blacklist-filter-empty');
            if (!empty) {
                empty = document.createElement('p');
                empty.className = 'nh-blacklist-filter-empty nh-helper-hidden';
                const tagList = queryOne(section, '.tag-list');
                if (tagList) {
                    tagList.insertAdjacentElement('afterend', empty);
                }
            }
            if (empty) {
                empty.textContent = getUIText('blacklist_filter_empty');
            }
            return empty;
        },

        apply(section = this.getSection(document)) {
            if (!section) return;
            if (!Config.get('enableUserSettingsBlacklistFilter')) {
                queryAll(section, '.tag-list .tag').forEach(chip => chip.classList.remove('nh-helper-hidden'));
                queryAll(section, '.nh-blacklist-filter-bar, .nh-blacklist-filter-empty').forEach(node => node.remove());
                return;
            }

            const bar = this.ensureFilterBar(section);
            const tagList = queryOne(section, '.tag-list');
            const empty = this.ensureEmptyState(section);
            if (!tagList || !empty || !bar) return;

            let visibleCount = 0;
            const typeCounts = {
                all: 0,
                tag: 0,
                artist: 0,
                character: 0,
                parody: 0,
                group: 0,
                language: 0,
                category: 0
            };
            queryAll(tagList, '.tag').forEach(chip => {
                const type = this.resolveChipType(chip);
                typeCounts.all += 1;
                if (type && typeCounts[type] !== undefined) {
                    typeCounts[type] += 1;
                }
                const shouldShow = this.activeType === 'all' || type === this.activeType;
                chip.classList.toggle('nh-helper-hidden', !shouldShow);
                if (shouldShow) visibleCount += 1;
            });

            queryAll(bar, '.nh-blacklist-filter-btn').forEach(button => {
                const type = button.dataset.filterType || 'all';
                const countNode = queryOne(button, '.nh-blacklist-filter-count');
                if (countNode) {
                    countNode.textContent = String(typeCounts[type] || 0);
                }
            });
            empty.classList.toggle('nh-helper-hidden', visibleCount > 0 || this.activeType === 'all');
        },

        async init(context = document) {
            if (!window.location.href.includes('/user/settings')) return;
            const section = this.getSection(context);
            if (!section) return;
            this.ensureFilterBar(section);
            await this.loadBlacklistMeta();
            this.apply(section);
        },

        teardown(context = document) {
            const section = this.getSection(context);
            if (!section) return;
            queryAll(section, '.tag-list .tag').forEach(chip => chip.classList.remove('nh-helper-hidden'));
            queryAll(section, '.nh-blacklist-filter-bar, .nh-blacklist-filter-empty').forEach(node => node.remove());
        }
    };
