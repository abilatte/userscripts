    // 数组按集合比较（语言筛选的顺序可能不同），对象按键比较，其余按值比较。
    function isSettingValueEqual(a, b) {
        if (Array.isArray(a) || Array.isArray(b)) {
            const normalize = (value) => (Array.isArray(value) ? value.map(String).sort().join('|') : '');
            return normalize(a) === normalize(b);
        }
        if (a && b && typeof a === 'object' && typeof b === 'object') {
            const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
            return Array.from(keys).every(key => a[key] === b[key]);
        }
        return a === b;
    }

    function hasSettingsChanges(patch) {
        return Object.keys(patch).some(key => !isSettingValueEqual(Config.get(key), patch[key]));
    }

    // draft：切换界面语言时带上尚未保存的表单值；activeTab：重建后停留的标签页。
    function showSettingsModal({ draft = null, activeTab = 'browse', apiKeyDraft = '' } = {}) {
        if (document.getElementById('nh-settings-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'nh-settings-overlay';
        const pick = (key) => (draft && key in draft ? draft[key] : Config.get(key));

        const config = {
            mode: pick('translationMode'),
            timeMode: pick('uploadTimeDisplayMode'),
            qt: pick('quickTagsSettings'),
            langFilter: pick('langFilter'),
            trans: pick('enableTranslation'),
            sugg: pick('enableSuggestions'),
            searchSuggestionMode: pick('searchSuggestionMode'),
            qtEnabled: pick('enableQuickTags'),
            pageBtn: pick('showPageSettingsButton'),
            langDrop: pick('showLangDropDown'),
            pageNum: pick('showPageNumbers'),
            hover: pick('enableHoverPreview'),
            popupHover: pick('enablePopupHoverPreview'),
            popupHoverScale: pick('popupHoverPreviewImageScalePercent'),
            popupHoverPosition: pick('popupHoverPreviewPosition'),
            readingMode: pick('enableReadingMode'),
            readingModeWidth: pick('readingModeImageScalePercent'),
            readingModeGap: pick('readingModeImageGap'),
            infinite: pick('enableInfiniteScroll'),
            blacklistHide: pick('enableFullBlacklistHide'),
            quickBlacklist: pick('enableDetailQuickBlacklist'),
            blacklistFilterTools: pick('enableUserSettingsBlacklistFilter'),
            devPanel: pick('showDevPanel'),
            apiKeyConfigured: Boolean(String(Config.get('apiKey') || '').trim()),
            apiKeyTestStatus: Config.get('apiKeyTestStatus')
        };

        let lang = Config.get('settingsLanguage') || 'zh';
        const t = (k) => SettingsUIDict[lang][k] || k;
        const formatApiKeyTestStatus = (status) => {
            if (status === 'success') return t('api_key_test_success');
            if (status === 'failure') return t('api_key_test_failure');
            return '—';
        };

        const qtKeys = [
            { k: 'parodies', l: t('qt_parodies') }, { k: 'characters', l: t('qt_characters') }, { k: 'tags', l: t('qt_tags') },
            { k: 'artists', l: t('qt_artists') }, { k: 'groups', l: t('qt_groups') }, { k: 'languages', l: t('qt_languages') }, { k: 'pages', l: t('qt_pages') }
        ];

        let qtHtml = '<div class="nh-setting-sub-group nh-setting-sub-group-3">';
        qtKeys.forEach(item => {
            qtHtml += `<label class="nh-setting-sub-item"><input type="checkbox" data-qt-key="${item.k}" ${config.qt[item.k] !== false ? 'checked' : ''}> ${item.l}</label>`;
        });
        qtHtml += '</div>';

        overlay.innerHTML = `
        <div id="nh-settings-modal" role="dialog" aria-modal="true" aria-labelledby="nh-settings-title">
            <div class="nh-modal-header">
                <div class="nh-modal-header-main">
                    <span class="nh-modal-eyebrow">nHentai Pro</span>
                    <h3 id="nh-settings-title">${t('title')}</h3>
                </div>
                <div class="nh-modal-tools">
                    <button type="button" id="nh-lang-switch" class="nh-btn nh-btn-secondary nh-lang-switch-btn">${lang === 'zh' ? 'English' : '中文'}</button>
                    <span class="version">v2.8.2.17</span>
                </div>
            </div>

            <div class="nh-tabs" role="tablist">
                <button type="button" class="nh-tab-btn active" data-tab="browse" role="tab" aria-selected="true">${t('tab_browse')}</button>
                <button type="button" class="nh-tab-btn" data-tab="translate" role="tab" aria-selected="false">${t('tab_translate')}</button>
                <button type="button" class="nh-tab-btn" data-tab="search" role="tab" aria-selected="false">${t('tab_search')}</button>
                <button type="button" class="nh-tab-btn" data-tab="blacklist" role="tab" aria-selected="false">${t('tab_blacklist')}</button>
                <button type="button" class="nh-tab-btn" data-tab="data" role="tab" aria-selected="false">${t('tab_data')}</button>
            </div>

            <div class="nh-modal-body">
                <!-- Tab: Browse -->
                <div id="tab-browse" class="nh-tab-content active" role="tabpanel">
                    <div class="nh-setting-group-title">${t('grp_browse')}</div>
                    <div class="nh-setting-item">
                        <div class="nh-setting-content">
                            <span class="nh-setting-label">${t('lbl_btn')}</span>
                            <div class="nh-info-text">${t('desc_btn')}</div>
                        </div>
                        <label class="nh-switch"><input type="checkbox" id="cfg-page-btn" ${config.pageBtn ? 'checked' : ''}><span class="nh-slider"></span></label>
                    </div>
                    <div class="nh-setting-item">
                        <div class="nh-setting-content">
                            <span class="nh-setting-label">${t('lbl_pg')}</span>
                            <div class="nh-info-text">${t('desc_pg')}</div>
                        </div>
                        <label class="nh-switch"><input type="checkbox" id="cfg-page-numbers" ${config.pageNum ? 'checked' : ''}><span class="nh-slider"></span></label>
                    </div>
                    <div class="nh-setting-item">
                        <div class="nh-setting-content">
                            <span class="nh-setting-label">${t('lbl_hover')}</span>
                            <div class="nh-info-text">${t('desc_hover')}</div>
                        </div>
                        <label class="nh-switch"><input type="checkbox" id="cfg-hover-preview" ${config.hover ? 'checked' : ''}><span class="nh-slider"></span></label>
                    </div>
                    <div class="nh-setting-item">
                        <div class="nh-setting-content">
                            <span class="nh-setting-label">${t('lbl_hover_popup')}</span>
                            <div class="nh-info-text">${t('desc_hover_popup')}</div>
                        </div>
                        <label class="nh-switch"><input type="checkbox" id="cfg-hover-popup-preview" ${config.popupHover ? 'checked' : ''}><span class="nh-slider"></span></label>
                    </div>
                    <div id="cfg-hover-popup-settings" class="nh-preview-popup-settings${config.popupHover ? '' : ' is-hidden'}">
                        <div class="nh-quicktags-label">${t('grp_hover_popup')}</div>
                        <div class="nh-setting-item nh-setting-item-compact">
                            <div class="nh-setting-content">
                                <span class="nh-setting-label">${t('lbl_hover_popup_scale')}</span>
                                <div class="nh-info-text">${t('desc_hover_popup_scale')}</div>
                            </div>
                            <div class="nh-setting-control">
                                <input type="number" id="cfg-hover-popup-scale" class="nh-number-input" min="60" max="160" step="5" value="${config.popupHoverScale}">
                                <span class="nh-setting-unit">%</span>
                            </div>
                        </div>
                        <div class="nh-setting-item nh-setting-item-compact">
                            <div class="nh-setting-content">
                                <span class="nh-setting-label">${t('lbl_hover_popup_position')}</span>
                                <div class="nh-info-text">${t('desc_hover_popup_position')}</div>
                            </div>
                            <div class="nh-setting-control nh-setting-control-select">
                                <select id="cfg-hover-popup-position" class="nh-select">
                                    <option value="auto" ${config.popupHoverPosition === 'auto' ? 'selected' : ''}>${t('opt_hover_popup_auto')}</option>
                                    <option value="top" ${config.popupHoverPosition === 'top' ? 'selected' : ''}>${t('opt_hover_popup_top')}</option>
                                    <option value="right" ${config.popupHoverPosition === 'right' ? 'selected' : ''}>${t('opt_hover_popup_right')}</option>
                                    <option value="left" ${config.popupHoverPosition === 'left' ? 'selected' : ''}>${t('opt_hover_popup_left')}</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div class="nh-setting-item">
                        <div class="nh-setting-content">
                            <span class="nh-setting-label">${t('lbl_reading_mode')}</span>
                            <div class="nh-info-text">${t('desc_reading_mode')}</div>
                        </div>
                        <label class="nh-switch"><input type="checkbox" id="cfg-reading-mode" ${config.readingMode ? 'checked' : ''}><span class="nh-slider"></span></label>
                    </div>
                    <div class="nh-setting-item">
                        <div class="nh-setting-content">
                            <span class="nh-setting-label">${t('lbl_reading_mode_width')}</span>
                            <div class="nh-info-text">${t('desc_reading_mode_width')}</div>
                        </div>
                        <div class="nh-setting-control">
                            <input type="number" id="cfg-reading-mode-width" class="nh-number-input" min="40" max="160" step="1" value="${config.readingModeWidth}">
                            <span class="nh-setting-unit">%</span>
                        </div>
                    </div>
                    <div class="nh-setting-item">
                        <div class="nh-setting-content">
                            <span class="nh-setting-label">${t('lbl_reading_mode_gap')}</span>
                            <div class="nh-info-text">${t('desc_reading_mode_gap')}</div>
                        </div>
                        <div class="nh-setting-control">
                            <input type="number" id="cfg-reading-mode-gap" class="nh-number-input" min="0" max="80" step="2" value="${config.readingModeGap}">
                            <span class="nh-setting-unit">px</span>
                        </div>
                    </div>
                    <div class="nh-setting-item">
                        <div class="nh-setting-content">
                            <span class="nh-setting-label">${t('lbl_infinite')}</span>
                            <div class="nh-info-text">${t('desc_infinite')}</div>
                        </div>
                        <label class="nh-switch"><input type="checkbox" id="cfg-infinite-scroll" ${config.infinite ? 'checked' : ''}><span class="nh-slider"></span></label>
                    </div>
                </div>

                <!-- Tab: Translate -->
                <div id="tab-translate" class="nh-tab-content">
                    <div class="nh-setting-group-title">${t('grp_translate')}</div>
                    <div class="nh-setting-item">
                        <span class="nh-setting-label">${t('lbl_trans')}</span>
                        <label class="nh-switch"><input type="checkbox" id="cfg-trans" ${config.trans ? 'checked' : ''}><span class="nh-slider"></span></label>
                    </div>
                    <div class="nh-setting-item">
                        <div class="nh-setting-content">
                            <span class="nh-setting-label">${t('lbl_mode')}</span>
                        </div>
                        <div class="nh-setting-control nh-setting-control-select">
                            <select id="cfg-trans-mode" class="nh-select">
                                <option value="append" ${config.mode === 'append' ? 'selected' : ''}>${t('opt_append')}</option>
                                <option value="replace" ${config.mode === 'replace' ? 'selected' : ''}>${t('opt_replace')}</option>
                                <option value="clean" ${config.mode === 'clean' ? 'selected' : ''}>${t('opt_clean')}</option>
                                <option value="original" ${config.mode === 'original' ? 'selected' : ''}>${t('opt_original')}</option>
                            </select>
                        </div>
                    </div>
                    <div class="nh-setting-item">
                        <div class="nh-setting-content">
                            <span class="nh-setting-label">${t('lbl_time_mode')}</span>
                        </div>
                        <div class="nh-setting-control nh-setting-control-select">
                            <select id="cfg-upload-time-mode" class="nh-select">
                                <option value="relative" ${config.timeMode === 'relative' ? 'selected' : ''}>${t('opt_time_relative')}</option>
                                <option value="absolute" ${config.timeMode === 'absolute' ? 'selected' : ''}>${t('opt_time_absolute')}</option>
                                <option value="combined" ${config.timeMode === 'combined' ? 'selected' : ''}>${t('opt_time_combined')}</option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- Tab: Search -->
                <div id="tab-search" class="nh-tab-content">
                    <div class="nh-setting-group-title">${t('grp_search')}</div>
                    <div class="nh-setting-item">
                        <div class="nh-setting-content">
                            <span class="nh-setting-label">${t('lbl_sugg')}</span>
                            <div class="nh-info-text">${t('desc_sugg')}</div>
                        </div>
                        <label class="nh-switch"><input type="checkbox" id="cfg-suggestions" ${config.sugg ? 'checked' : ''}><span class="nh-slider"></span></label>
                    </div>
                    <div class="nh-setting-item">
                        <div class="nh-setting-content">
                            <span class="nh-setting-label">${t('lbl_sugg_mode')}</span>
                            <div class="nh-info-text">${t('desc_sugg_mode')}</div>
                        </div>
                        <div class="nh-setting-control nh-setting-control-select">
                            <select id="cfg-suggestion-mode" class="nh-select">
                                <option value="auto" ${config.searchSuggestionMode === 'auto' ? 'selected' : ''}>${t('opt_sugg_auto')}</option>
                                <option value="helper" ${config.searchSuggestionMode === 'helper' ? 'selected' : ''}>${t('opt_sugg_helper')}</option>
                                <option value="off" ${config.searchSuggestionMode === 'off' ? 'selected' : ''}>${t('opt_sugg_off')}</option>
                            </select>
                        </div>
                    </div>
                    <div class="nh-setting-item">
                        <span class="nh-setting-label">${t('lbl_qt')}</span>
                        <label class="nh-switch"><input type="checkbox" id="cfg-quicktags" ${config.qtEnabled ? 'checked' : ''}><span class="nh-slider"></span></label>
                    </div>
                    <div id="cfg-quicktags-list" class="nh-quicktags-list${config.qtEnabled ? '' : ' is-hidden'}">
                        <div class="nh-quicktags-label">${t('lbl_qt_sel')}</div>
                        ${qtHtml}
                    </div>

                    <div class="nh-setting-group-title">${t('grp_filter')}</div>
                    <div class="nh-setting-item">
                        <div class="nh-setting-content">
                            <span class="nh-setting-label">${t('lbl_drop')}</span>
                            <div class="nh-info-text">${t('desc_drop')}</div>
                        </div>
                        <label class="nh-switch"><input type="checkbox" id="cfg-show-lang-dropdown" ${config.langDrop ? 'checked' : ''}><span class="nh-slider"></span></label>
                    </div>
                    <div class="nh-setting-item"><span class="nh-setting-label">${t('lbl_def_lang')}</span></div>
                    <div class="nh-setting-sub-group">
                        <label class="nh-setting-sub-item"><input type="checkbox" id="lf-cn" ${config.langFilter.includes('29963') ? 'checked' : ''}> CN</label>
                        <label class="nh-setting-sub-item"><input type="checkbox" id="lf-en" ${config.langFilter.includes('12227') ? 'checked' : ''}> EN</label>
                        <label class="nh-setting-sub-item"><input type="checkbox" id="lf-jp" ${config.langFilter.includes('6346') ? 'checked' : ''}> JP</label>
                    </div>
                </div>

                <!-- Tab: Blacklist -->
                <div id="tab-blacklist" class="nh-tab-content">
                    <div class="nh-setting-group-title">${t('grp_blacklist')}</div>
                    <div class="nh-setting-item">
                        <div class="nh-setting-content">
                            <span class="nh-setting-label">${t('lbl_blacklist_hide')}</span>
                            <div class="nh-info-text">${t('desc_blacklist_hide')}</div>
                        </div>
                        <label class="nh-switch"><input type="checkbox" id="cfg-blacklist-hide" ${config.blacklistHide ? 'checked' : ''}><span class="nh-slider"></span></label>
                    </div>
                    <div class="nh-setting-item">
                        <div class="nh-setting-content">
                            <span class="nh-setting-label">${t('lbl_quick_blacklist')}</span>
                            <div class="nh-info-text">${isUserLoggedIn() ? t('desc_quick_blacklist_ready') : t('desc_quick_blacklist_login_required')}</div>
                        </div>
                        <label class="nh-switch"><input type="checkbox" id="cfg-detail-quick-blacklist" ${config.quickBlacklist ? 'checked' : ''}><span class="nh-slider"></span></label>
                    </div>
                    <div class="nh-setting-item">
                        <div class="nh-setting-content">
                            <span class="nh-setting-label">${t('lbl_blacklist_filter_tools')}</span>
                            <div class="nh-info-text">${t('desc_blacklist_filter_tools')}</div>
                        </div>
                        <label class="nh-switch"><input type="checkbox" id="cfg-blacklist-filter-tools" ${config.blacklistFilterTools ? 'checked' : ''}><span class="nh-slider"></span></label>
                    </div>
                </div>

                <!-- Tab: Data -->
                <div id="tab-data" class="nh-tab-content">
                    <div class="nh-setting-group-title">${t('grp_data')}</div>
                    <div class="nh-setting-item">
                        <div class="nh-setting-content">
                            <span class="nh-setting-label">${t('lbl_dev_panel')}</span>
                            <div class="nh-info-text">${t('desc_dev_panel')}</div>
                        </div>
                        <label class="nh-switch"><input type="checkbox" id="cfg-dev-panel" ${config.devPanel ? 'checked' : ''}><span class="nh-slider"></span></label>
                    </div>
                    <div class="nh-force-update-wrap">
                        <button class="nh-btn nh-btn-secondary nh-btn-block" id="nh-force-update"><i class="fa fa-refresh"></i> ${t('btn_update')}</button>
                    </div>
                    <div class="nh-setting-group-title">${t('grp_api_key')}</div>
                    <div class="nh-api-key-card">
                        <div class="nh-setting-content nh-api-key-content">
                            <span class="nh-setting-label">${t('lbl_api_key')}</span>
                            <div class="nh-info-text">${t('desc_api_key')}</div>
                        </div>
                        <input type="password" id="cfg-api-key" class="nh-password-input" autocomplete="off" spellcheck="false" placeholder="${t('ph_api_key')}">
                        <div class="nh-api-key-status">
                            <span>${t('lbl_api_key')}: <strong id="cfg-api-key-state">${config.apiKeyConfigured ? t('api_key_configured') : t('api_key_not_configured')}</strong></span>
                            <span>${t('btn_api_key_test')}: <strong id="cfg-api-key-test-state">${formatApiKeyTestStatus(config.apiKeyTestStatus)}</strong></span>
                        </div>
                        <div class="nh-api-key-actions">
                            <button class="nh-btn nh-btn-primary" id="nh-api-key-save" type="button">${t('btn_api_key_save')}</button>
                            <button class="nh-btn nh-btn-secondary" id="nh-api-key-test" type="button">${t('btn_api_key_test')}</button>
                            <button class="nh-btn nh-btn-secondary" id="nh-api-key-clear" type="button">${t('btn_api_key_clear')}</button>
                        </div>
                        <div id="nh-api-key-message" class="nh-api-key-message" aria-live="polite"></div>
                    </div>
                </div>
            </div>

            <div class="nh-settings-actions">
                <button class="nh-btn nh-btn-secondary" id="nh-settings-cancel">${t('btn_cancel')}</button>
                <button class="nh-btn nh-btn-primary" id="nh-settings-save">${t('btn_save')}</button>
            </div>
        </div>`;

        document.body.appendChild(overlay);

        const handleModalKeydown = (event) => {
            if (event.key !== 'Escape' || event.isComposing) return;
            event.preventDefault();
            closeModal();
        };
        const closeModal = () => {
            document.removeEventListener('keydown', handleModalKeydown);
            overlay.remove();
        };
        document.addEventListener('keydown', handleModalKeydown);

        // Tab Switching Logic
        const tabs = overlay.querySelectorAll('.nh-tab-btn');
        const contents = overlay.querySelectorAll('.nh-tab-content');
        const activateTab = (name) => {
            const target = Array.from(tabs).find(tab => tab.dataset.tab === name);
            if (!target) return;
            tabs.forEach(btn => {
                btn.classList.remove('active');
                btn.setAttribute('aria-selected', 'false');
            });
            contents.forEach(c => c.classList.remove('active'));

            target.classList.add('active');
            target.setAttribute('aria-selected', 'true');
            document.getElementById(`tab-${name}`).classList.add('active');
        };

        tabs.forEach(tab => {
            tab.onclick = () => activateTab(tab.dataset.tab);
        });
        activateTab(activeTab);

        // Quick Tags Toggle Logic
        const qtSwitch = document.getElementById('cfg-quicktags');
        const qtList = document.getElementById('cfg-quicktags-list');
        const popupPreviewSwitch = document.getElementById('cfg-hover-popup-preview');
        const popupPreviewSettings = document.getElementById('cfg-hover-popup-settings');
        qtSwitch.addEventListener('change', () => {
            qtList.classList.toggle('is-hidden', !qtSwitch.checked);
        });
        popupPreviewSwitch.addEventListener('change', () => {
            popupPreviewSettings.classList.toggle('is-hidden', !popupPreviewSwitch.checked);
        });

        // 读取表单当前值并按设置项规则规整；保存与切换语言共用。
        const readSettingsForm = () => {
            const newQt = {};
            overlay.querySelectorAll('input[data-qt-key]').forEach(inp => newQt[inp.dataset.qtKey] = inp.checked);

            const rawReadingGap = document.getElementById('cfg-reading-mode-gap').value.trim();
            const readingGap = rawReadingGap === '' ? NaN : Number(rawReadingGap);

            const newFilters = [];
            if(document.getElementById('lf-cn').checked) newFilters.push('29963');
            if(document.getElementById('lf-en').checked) newFilters.push('12227');
            if(document.getElementById('lf-jp').checked) newFilters.push('6346');

            return {
                enableTranslation: document.getElementById('cfg-trans').checked,
                translationMode: document.getElementById('cfg-trans-mode').value,
                uploadTimeDisplayMode: document.getElementById('cfg-upload-time-mode').value,
                enableSuggestions: document.getElementById('cfg-suggestions').checked,
                searchSuggestionMode: document.getElementById('cfg-suggestion-mode').value,
                enableQuickTags: qtSwitch.checked,
                showPageSettingsButton: document.getElementById('cfg-page-btn').checked,
                showLangDropDown: document.getElementById('cfg-show-lang-dropdown').checked,
                showPageNumbers: document.getElementById('cfg-page-numbers').checked,
                enableHoverPreview: document.getElementById('cfg-hover-preview').checked,
                enablePopupHoverPreview: popupPreviewSwitch.checked,
                popupHoverPreviewImageScalePercent: Math.max(60, Math.min(160, Number(document.getElementById('cfg-hover-popup-scale').value) || 100)),
                popupHoverPreviewPosition: document.getElementById('cfg-hover-popup-position').value,
                enableReadingMode: document.getElementById('cfg-reading-mode').checked,
                readingModeImageScalePercent: Math.max(40, Math.min(160, Number(document.getElementById('cfg-reading-mode-width').value) || 100)),
                readingModeImageGap: Math.max(0, Math.min(80, Number.isFinite(readingGap) ? readingGap : 10)),
                enableInfiniteScroll: document.getElementById('cfg-infinite-scroll').checked,
                enableFullBlacklistHide: document.getElementById('cfg-blacklist-hide').checked,
                enableDetailQuickBlacklist: document.getElementById('cfg-detail-quick-blacklist').checked,
                enableUserSettingsBlacklistFilter: document.getElementById('cfg-blacklist-filter-tools').checked,
                showDevPanel: document.getElementById('cfg-dev-panel').checked,
                quickTagsSettings: newQt,
                langFilter: newFilters
            };
        };

        // Actions
        document.getElementById('nh-force-update').onclick = () => {
            if(confirm(t('confirm_update'))) {
                closeModal();
                DB.update(true);
            }
        };

        const apiKeyInput = document.getElementById('cfg-api-key');
        const apiKeyState = document.getElementById('cfg-api-key-state');
        const apiKeyTestState = document.getElementById('cfg-api-key-test-state');
        const apiKeyMessage = document.getElementById('nh-api-key-message');
        const apiKeyTestButton = document.getElementById('nh-api-key-test');
        // 未保存的 API Key 输入通过 .value 回填，不拼进 HTML。
        apiKeyInput.value = apiKeyDraft;
        const setApiKeyMessage = (message, state = '') => {
            apiKeyMessage.textContent = message || '';
            apiKeyMessage.dataset.state = state;
        };

        document.getElementById('nh-api-key-save').onclick = () => {
            const nextApiKey = apiKeyInput.value.trim();
            if (!nextApiKey) {
                setApiKeyMessage(t('api_key_empty'), 'failure');
                return;
            }
            Config.setMany({
                apiKey: nextApiKey,
                apiKeyTestStatus: '',
                apiKeyTestedAt: 0
            });
            apiKeyInput.value = '';
            apiKeyState.textContent = t('api_key_configured');
            apiKeyTestState.textContent = '—';
            setApiKeyMessage(t('api_key_saved'), 'success');
        };

        document.getElementById('nh-api-key-clear').onclick = () => {
            Config.setMany({
                apiKey: '',
                apiKeyTestStatus: '',
                apiKeyTestedAt: 0
            });
            apiKeyInput.value = '';
            apiKeyState.textContent = t('api_key_not_configured');
            apiKeyTestState.textContent = '—';
            setApiKeyMessage(t('api_key_cleared'), 'success');
        };

        apiKeyTestButton.onclick = async () => {
            const testKey = apiKeyInput.value.trim() || String(Config.get('apiKey') || '').trim();
            if (!testKey) {
                setApiKeyMessage(t('api_key_empty'), 'failure');
                return;
            }
            apiKeyTestButton.disabled = true;
            apiKeyTestButton.textContent = t('api_key_testing');
            setApiKeyMessage(t('api_key_testing'));
            try {
                const result = await testConfiguredApiKey(testKey);
                const nextStatus = result.ok ? 'success' : 'failure';
                Config.setMany({
                    apiKeyTestStatus: nextStatus,
                    apiKeyTestedAt: Date.now()
                });
                apiKeyTestState.textContent = formatApiKeyTestStatus(nextStatus);
                setApiKeyMessage(formatApiKeyTestStatus(nextStatus), nextStatus);
            } catch (error) {
                Config.setMany({
                    apiKeyTestStatus: 'failure',
                    apiKeyTestedAt: Date.now()
                });
                apiKeyTestState.textContent = t('api_key_test_failure');
                setApiKeyMessage(t('api_key_test_failure'), 'failure');
            } finally {
                apiKeyTestButton.disabled = false;
                apiKeyTestButton.textContent = t('btn_api_key_test');
            }
        };

        // 切换界面语言时带上未保存的表单值和当前标签页，重建后不丢改动。
        document.getElementById('nh-lang-switch').onclick = () => {
            const nextOptions = {
                draft: readSettingsForm(),
                activeTab: overlay.querySelector('.nh-tab-btn.active')?.dataset.tab || 'browse',
                apiKeyDraft: apiKeyInput.value
            };
            Config.set('settingsLanguage', lang === 'zh' ? 'en' : 'zh');
            closeModal();
            showSettingsModal(nextOptions);
        };

        document.getElementById('nh-settings-cancel').onclick = () => closeModal();
        overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

        document.getElementById('nh-settings-save').onclick = () => {
            const patch = readSettingsForm();
            closeModal();
            // 没有改动时不刷新页面，保留无限滚动已加载的内容和滚动位置。
            if (!hasSettingsChanges(patch)) return;
            Config.setMany(patch);
            location.reload();
        };
    }



