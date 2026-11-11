    let searchUiGlobalListenersBound = false;
    let searchUiActiveForm = null;
    let searchUiActiveInput = null;
    let searchUiActiveQuickTags = null;
    let searchUiActiveSuggestionHost = null;

    function clearSearchSuggestionBox() {
        document.querySelectorAll('.nh-helper-suggestion-box').forEach(box => box.remove());
        document.querySelectorAll('.nh-helper-cn-suggestion-active').forEach(el => el.classList.remove('nh-helper-cn-suggestion-active'));
    }

    function getSearchSuggestionMode() {
        const mode = Config.get('searchSuggestionMode');
        return ['auto', 'helper', 'off'].includes(mode) ? mode : 'auto';
    }

    function getOfficialSearchAutocomplete(form) {
        if (!form) return null;
        return Array.from(form.children).find(el =>
            el.getAttribute?.('role') === 'listbox' &&
            !el.classList.contains('nh-helper-suggestion-box')
        ) || null;
    }

    function isOfficialSearchAutocompleteVisible(form) {
        const box = getOfficialSearchAutocomplete(form);
        if (!box) return false;
        const style = window.getComputedStyle(box);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = box.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function hasCjkText(text = '') {
        return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(text));
    }

    function resolveHelperSuggestions(form, suggestions) {
        if (!Config.get('enableSuggestions') || getSearchSuggestionMode() === 'off') {
            return { items: [], suppressOfficial: false };
        }
        if (getSearchSuggestionMode() === 'helper') {
            return { items: suggestions, suppressOfficial: suggestions.length > 0 };
        }
        if (!isOfficialSearchAutocompleteVisible(form)) {
            return { items: suggestions, suppressOfficial: false };
        }
        const cnSuggestions = suggestions.filter(item =>
            item.isCnInput === true &&
            hasCjkText(item.originalMatch)
        );
        return {
            items: cnSuggestions,
            suppressOfficial: cnSuggestions.length > 0
        };
    }

    function shouldShowSuggestionLoading(form) {
        if (!Config.get('enableSuggestions') || getSearchSuggestionMode() === 'off') return false;
        if (getSearchSuggestionMode() === 'helper') return true;
        return !isOfficialSearchAutocompleteVisible(form);
    }

    function setupSearchUI() {
        const form = document.querySelector('form[action="/search/"]');
        if (!form) return;
        form.style.position = 'relative';
        const input = form.querySelector('input[name="q"]');
        if (!input) return;
        searchUiActiveForm = form;
        searchUiActiveInput = input;
        let lastSuggestions = [];
        let activeSearchToken = 0;
        let loadingCheckInterval = null;
        let loadingBox = null;

        if (!searchUiGlobalListenersBound) {
            searchUiGlobalListenersBound = true;
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Shift') document.body.classList.add('nh-shift-pressed');
            });
            document.addEventListener('keyup', (e) => {
                if (e.key === 'Shift') document.body.classList.remove('nh-shift-pressed');
            });
            document.addEventListener('click', (e) => {
                const activeForm = searchUiActiveForm;
                const activeQuickTags = searchUiActiveQuickTags;
                const activeSuggestionHost = searchUiActiveSuggestionHost;
                if (activeForm?.contains?.(e.target)) {
                    return;
                }
                if (activeQuickTags?.contains?.(e.target)) {
                    return;
                }
                if (activeSuggestionHost?.contains?.(e.target)) {
                    return;
                }
                if (!activeForm || !activeForm.contains(e.target)) {
                    clearSearchSuggestionBox();
                    const quickTags = activeQuickTags || document.getElementById('nh-helper-quick-tags');
                    if (quickTags) quickTags.style.display = 'none';
                }
            });
        }

        const createQuickTags = () => {
            if (!Config.get('enableQuickTags')) return null;
            const existing = document.getElementById('nh-helper-quick-tags');
            if (existing) {
                if (existing.parentElement !== form) {
                    existing.remove();
                } else {
                    return existing;
                }
            }
            const container = document.createElement('div');
            container.id = 'nh-helper-quick-tags';
            const qtSettings = Config.get('quickTagsSettings');
            const uiLang = getSettingsLanguage();
            const tags = [{
                ns: 'parodies',
                label: getUIText('qt_parodies', uiLang)
            }, {
                ns: 'characters',
                label: getUIText('qt_characters', uiLang)
            }, {
                ns: 'tags',
                label: getUIText('qt_tags', uiLang)
            }, {
                ns: 'artists',
                label: getUIText('qt_artists', uiLang)
            }, {
                ns: 'groups',
                label: getUIText('qt_groups', uiLang)
            }, {
                ns: 'languages',
                label: getUIText('qt_languages', uiLang),
                suffix: ':"chinese"'
            }, {
                ns: 'pages',
                label: getUIText('qt_pages', uiLang),
                suffix: ':'
            }];
            tags.filter(t => qtSettings[t.ns] !== false).forEach(t => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'nh-helper-tag-btn';
                btn.textContent = t.label;
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const val = input.value.trim();
                    let suffix = t.suffix || ':""';
                    let prefix = e.shiftKey ? '-' : '';
                    if (t.ns === 'pages') prefix = '';
                    const append = prefix + t.ns + suffix;
                    input.value = val ? val + ' ' + append : append;
                    input.focus();
                    const pad = suffix.endsWith('""') ? 1 : 0;
                    input.setSelectionRange(input.value.length - pad, input.value.length - pad);
                };
                container.appendChild(btn);
            });
            form.appendChild(container);
            return container;
        };
        const qtContainer = createQuickTags();
        searchUiActiveQuickTags = qtContainer;
        searchUiActiveSuggestionHost = input.parentNode;
        if (input.dataset.nhSearchEnhanced === '1') return;
        input.dataset.nhSearchEnhanced = '1';
        form.addEventListener('submit', (e) => {
            if (!DB.indexReady) return;
            const raw = input.value;
            const tokens = [];
            let match;
            TOKEN_REGEX.lastIndex = 0;
            while ((match = TOKEN_REGEX.exec(raw)) !== null) tokens.push(match[0]);
            if (!tokens.length) return;
            const processed = tokens.map(token => {
                const clean = token.replace(/^"|"$/g, '');
                const isExcluded = token.startsWith('-');
                const lookupTerm = isExcluded ? clean.substring(1) : clean;
                const lookupKey = lookupTerm.toLowerCase();
                let item = DB.cnToItem[lookupKey];
                if (!item && lookupTerm.includes(':')) {
                    const parts = lookupTerm.split(':');
                    const namespacedKey = parts.length > 1 ? parts[1].replace(/"/g, '').toLowerCase() : '';
                    if (namespacedKey && DB.cnToItem[namespacedKey]) item = DB.cnToItem[namespacedKey];
                }
                if (item) {
                    const pluralNs = NS_PLURAL_MAP[item.namespace] || item.namespace;
                    const prefix = isExcluded ? '-' : '';
                    return `${prefix}${pluralNs}:"${item.value}"`;
                }
                return token;
            });
            const merged = [];
            for (let i = 0; i < processed.length; i++) {
                const curr = processed[i];
                const next = processed[i + 1];
                if (curr.endsWith(':') && next) {
                    merged.push(curr + next);
                    i++;
                } else {
                    merged.push(curr);
                }
            }
            input.value = merged.join(' ');
        });
        const handleInput = debounce(async () => {
            if (!DB.indexReady || !Config.get('enableSuggestions') || getSearchSuggestionMode() === 'off') {
                clearSearchSuggestionBox();
                lastSuggestions = [];
                return;
            }
            form.classList.remove('nh-helper-cn-suggestion-active');
            const searchToken = ++activeSearchToken;
            const query = input.value;
            const suggestions = await DB.search(query);
            if (searchToken !== activeSearchToken || input.value !== query) return;
            const helperState = resolveHelperSuggestions(form, suggestions);
            lastSuggestions = helperState.items;
            clearSearchSuggestionBox();
            if (!lastSuggestions.length) return;
            form.classList.toggle('nh-helper-cn-suggestion-active', helperState.suppressOfficial);
            const box = document.createElement('div');
            box.className = 'nh-helper-suggestion-box';
            // 默认不预选：Enter 直接搜索，方向键选中后 Enter 才填入。
            lastSuggestions.forEach(item => {
                const div = document.createElement('div');
                div.className = 'nh-helper-suggestion-item';
                div.innerHTML = item.display;
                div.onmousedown = (e) => e.preventDefault();
                div.onclick = (e) => applySuggestion(item, e);
                box.appendChild(div);
            });
            input.parentNode.style.position = 'relative';
            input.parentNode.appendChild(box);
            searchUiActiveSuggestionHost = input.parentNode;
        }, 200);

        function applySuggestion(suggestionItem, event) {
            const raw = input.value;
            const matchStr = suggestionItem.originalMatch;
            const lastIndex = raw.lastIndexOf(matchStr);
            let finalValue = suggestionItem.finalValue;
            if (event && event.shiftKey && !finalValue.startsWith('-')) finalValue = '-' + finalValue;
            if (lastIndex !== -1) input.value = raw.substring(0, lastIndex) + finalValue + ' ';
            else input.value = raw + (raw.endsWith(' ') ? '' : ' ') + finalValue + ' ';
            clearSearchSuggestionBox();
            input.focus();
        }
        input.addEventListener('input', handleInput);
        const clearLoadingWatcher = () => {
            if (loadingCheckInterval) {
                clearInterval(loadingCheckInterval);
                loadingCheckInterval = null;
            }
            if (loadingBox && loadingBox.isConnected) {
                loadingBox.remove();
            }
            loadingBox = null;
        };
        input.addEventListener('focus', () => {
            searchUiActiveForm = form;
            searchUiActiveInput = input;
            searchUiActiveQuickTags = qtContainer;
            searchUiActiveSuggestionHost = input.parentNode;
            if (!Config.get('enableSuggestions') || getSearchSuggestionMode() === 'off') {
                clearSearchSuggestionBox();
                lastSuggestions = [];
                if (qtContainer) qtContainer.style.display = 'flex';
                return;
            }
            if (!DB.indexReady) {
                if (shouldShowSuggestionLoading(form) && (!loadingBox || !loadingBox.isConnected)) {
                    loadingBox = document.createElement('div');
                    loadingBox.className = 'nh-helper-suggestion-box';
                    loadingBox.innerHTML = `<div class="nh-helper-loading">${getUIText('loading_index')}</div>`;
                    input.parentNode.appendChild(loadingBox);
                }
                if (!loadingCheckInterval) {
                    loadingCheckInterval = setInterval(() => {
                        if (DB.indexReady) {
                            clearLoadingWatcher();
                            if (document.activeElement === input) {
                                handleInput();
                            }
                        }
                    }, 500);
                }
            } else handleInput();
            if (qtContainer) qtContainer.style.display = 'flex';
        });
        input.addEventListener('blur', () => {
            if (document.activeElement !== input) {
                clearLoadingWatcher();
            }
        });
        input.addEventListener('keydown', (e) => {
            // 输入法组字中的 Enter/方向键属于输入法，不能当作选择联想项。
            if (e.isComposing || e.keyCode === 229) return;
            const box = document.querySelector('.nh-helper-suggestion-box');
            if (e.key === 'Escape') {
                if (box) clearSearchSuggestionBox();
                if (qtContainer) qtContainer.style.display = 'none';
                return;
            }
            if (!box) return;
            const items = box.querySelectorAll('.nh-helper-suggestion-item');
            if (!items.length) return;
            let activeIdx = Array.from(items).findIndex(el => el.classList.contains('active'));
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (activeIdx > -1) items[activeIdx].classList.remove('active');
                if (e.key === 'ArrowDown') {
                    activeIdx = (activeIdx + 1) % items.length;
                } else {
                    activeIdx = activeIdx <= 0 ? items.length - 1 : activeIdx - 1;
                }
                items[activeIdx].classList.add('active');
                items[activeIdx].scrollIntoView({
                    block: 'nearest'
                });
            } else if (e.key === 'Enter') {
                // 未用方向键选中时交给表单直接提交搜索。
                if (activeIdx > -1 && lastSuggestions[activeIdx]) {
                    e.preventDefault();
                    applySuggestion(lastSuggestions[activeIdx], {
                        shiftKey: e.shiftKey
                    });
                } else {
                    clearSearchSuggestionBox();
                }
            } else if (e.key === 'Tab') {
                // Tab 填入选中项；未选中时填入第一项。
                const targetIdx = activeIdx > -1 ? activeIdx : 0;
                if (lastSuggestions[targetIdx]) {
                    e.preventDefault();
                    applySuggestion(lastSuggestions[targetIdx], {
                        shiftKey: e.shiftKey
                    });
                }
            }
        });
    }

