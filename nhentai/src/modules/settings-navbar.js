    // ===== 5. 搜索、翻译、语言筛选、设置 UI =====
    const SettingsUIDict = {
        'zh': {
            "title": "nHentai Pro 设置 v__NH_VERSION__",
            "tab_browse": "浏览",
            "tab_translate": "翻译",
            "tab_search": "搜索与筛选",
            "tab_blacklist": "黑名单",
            "tab_data": "数据与调试",
            "grp_browse": "浏览体验",
            "lbl_btn": "在网页显示设置按钮",
            "desc_btn": "在左侧导航栏添加齿轮图标",
            "lbl_pg": "显示页数",
            "desc_pg": "在封面图右上角显示总页数",
            "lbl_hover": "启用悬停预览",
            "desc_hover": "鼠标悬停封面可滑动预览全书",
            "lbl_hover_popup": "桌面端弹窗预览模式",
            "desc_hover_popup": "开启后在桌面端使用独立放大弹窗预览，进度条移至弹窗下方，移动端仍保留旧模式",
            "grp_hover_popup": "弹窗预览设置",
            "lbl_hover_popup_scale": "图片显示比例",
            "desc_hover_popup_scale": "设置桌面端弹窗预览的整体显示比例（百分比）",
            "lbl_hover_popup_position": "弹窗位置",
            "desc_hover_popup_position": "设置弹窗优先显示在封面上方、左侧、右侧或自动选择",
            "opt_hover_popup_auto": "自动",
            "opt_hover_popup_top": "上方居中",
            "opt_hover_popup_right": "封面右侧",
            "opt_hover_popup_left": "封面左侧",
            "lbl_reading_mode": "启用卷轴阅读模式",
            "desc_reading_mode": "在详情页显示阅读入口，以覆盖层方式连续阅读整本漫画",
            "lbl_reading_mode_width": "阅读模式图片缩放",
            "desc_reading_mode_width": "设置卷轴阅读模式下图片显示缩放比例（%）",
            "lbl_reading_mode_gap": "阅读模式图片间距",
            "desc_reading_mode_gap": "设置卷轴阅读模式下相邻图片之间的垂直间距（像素）",
            "lbl_infinite": "启用无限滚动",
            "desc_infinite": "滚动到底部时自动加载下一页列表",
            "lbl_blacklist_hide": "彻底屏蔽黑名单",
            "desc_blacklist_hide": "将站点黑名单漫画直接隐藏，不再保留半透明占位",
            "grp_translate": "翻译设置",
            "lbl_trans": "启用全站汉化",
            "lbl_mode": "翻译显示模式",
            "opt_append": "原文优先 (原文+译文)",
            "opt_replace": "译文优先 (译文+原文)",
            "opt_clean": "仅显示译文",
            "opt_original": "仅显示原文",
            "lbl_time_mode": "上传时间显示",
            "opt_time_relative": "仅相对时间",
            "opt_time_absolute": "仅绝对时间",
            "opt_time_combined": "相对时间 + 绝对时间",
            "grp_search": "搜索增强",
            "grp_filter": "筛选",
            "lbl_drop": "导航栏筛选菜单",
            "desc_drop": "在右上角显示语言快速筛选器",
            "lbl_def_lang": "默认显示的语言 (留空则全显)",
            "btn_update": "强制更新汉化数据库",
            "lbl_sugg": "搜索自动联想",
            "desc_sugg": "输入时显示汉化标签建议",
            "lbl_sugg_mode": "联想兼容模式",
            "desc_sugg_mode": "控制 nHentai Pro 联想与官方搜索联想的协作方式",
            "opt_sugg_auto": "自动兼容",
            "opt_sugg_helper": "强制助手联想",
            "opt_sugg_off": "关闭助手联想",
            "grp_blacklist": "黑名单工具",
            "lbl_dev_panel": "开发者诊断面板",
            "desc_dev_panel": "显示请求、预取与无限滚动实时指标",
            "lbl_meta_cache": "本地缓存画廊信息",
            "desc_meta_cache": "把页数、标签等画廊信息缓存在浏览器本地 7 天，减少重复请求和限流；关闭时会清空已缓存的数据",
            "lbl_qt": "搜索栏快捷标签",
            "lbl_qt_sel": "选择要显示的快捷按钮:",
            "lbl_quick_blacklist": "详情页快捷屏蔽",
            "desc_quick_blacklist_ready": "已登录时，可在详情页标签后直接加入或取消黑名单",
            "desc_quick_blacklist_login_required": "未登录时不显示快捷屏蔽按钮，请先登录 nhentai 账号",
            "lbl_blacklist_filter_tools": "黑名单页类型筛选",
            "desc_blacklist_filter_tools": "在账号设置黑名单页显示独立的类型筛选条，并支持数量徽标",
            "quick_blacklist_add": "加入黑名单",
            "quick_blacklist_remove": "取消黑名单",
            "quick_blacklist_error": "快捷屏蔽操作失败，请稍后重试",
            "blacklist_filter_all": "全部",
            "blacklist_filter_tag": "标签",
            "blacklist_filter_artist": "作者",
            "blacklist_filter_character": "角色",
            "blacklist_filter_parody": "原作",
            "blacklist_filter_group": "社团",
            "blacklist_filter_language": "语言",
            "blacklist_filter_category": "分类",
            "blacklist_filter_empty": "当前筛选下没有黑名单标签",
            "grp_data": "数据与调试",
            "grp_api_key": "API Key",
            "lbl_api_key": "可选 API Key",
            "desc_api_key": "仅用于本脚本的 /api/v2/* 请求，不会写入 DOM、console 或 URL",
            "ph_api_key": "输入 API Key",
            "btn_api_key_save": "保存 API Key",
            "btn_api_key_clear": "清除",
            "btn_api_key_test": "测试",
            "api_key_saved": "API Key 已保存",
            "api_key_cleared": "API Key 已清除",
            "api_key_empty": "请先输入或保存 API Key",
            "api_key_testing": "测试中...",
            "api_key_test_success": "测试成功",
            "api_key_test_failure": "测试失败",
            "api_key_configured": "已配置",
            "api_key_not_configured": "未配置",
            "btn_cancel": "取消",
            "btn_save": "保存设置",
            "confirm_update": "确定要从 EhTagTranslation 重新下载汉化词库吗？将直接拉取社区维护的最新数据。",
            "qt_parodies": "原作",
            "qt_characters": "角色",
            "qt_tags": "标签",
            "qt_artists": "作者",
            "qt_groups": "社团",
            "qt_languages": "语言",
            "qt_pages": "页数",
            "btn_settings": "设置",
            "lbl_all_lang": "全部语言",
            "lang_cn": "中文",
            "lang_en": "英文",
            "lang_jp": "日文",
            "loading_index": "正在后台准备索引...",
            "preview_tags": "标签",
            "preview_loading": "加载中...",
            "preview_no_tags": "暂无标签",
            "preview_page_prefix": "页 ",
            "preview_group_artists": "作者",
            "preview_group_parodies": "原作",
            "preview_group_characters": "角色",
            "preview_group_tags": "标签",
            "reading_mode_enter": "卷轴阅读",
            "reading_mode_continue": "继续阅读",
            "reading_mode_retry": "加载失败，点击重试",
            "reading_mode_close": "退出阅读",
            "reading_mode_open_failed": "阅读模式加载失败，请稍后重试",
            "reading_mode_page_prefix": "第 ",
            "reading_mode_state_wait": "等待加载",
            "reading_mode_state_loading": "加载中",
            "reading_mode_state_loaded": "已加载",
            "reading_mode_state_error": "加载失败",
            "reading_mode_tool_scale_label": "缩放",
            "reading_mode_tool_gap_label": "间距",
            "reading_mode_tool_scale_tip": "可直接输入百分比，或按住 Ctrl 使用滚轮实时缩放",
            "reading_mode_tool_gap_tip": "可直接输入图片间距（像素）",
            "infinite_ready": "继续向下滚动以加载下一页",
            "infinite_sync": "正在同步分页状态...",
            "infinite_loading": "正在加载下一页...",
            "infinite_done": "已加载全部页面",
            "infinite_error": "下一页加载失败，继续下滑可重试",
            "infinite_error_manual": "下一页连续加载失败，点击此处重试",
            "infinite_paused_empty": "连续 {count} 页没有符合筛选的内容，点击此处继续加载",
            "infinite_page_marker": "第 {page} 页",
            "db_status_downloading": "正在下载汉化词库...",
            "db_status_checking": "正在检查词库更新...",
            "db_status_latest": "词库已是最新",
            "db_status_fallback": "主源失败，尝试备用词库...",
            "db_status_done": "更新完成!",
            "db_status_done_fallback": "更新完成（备用源）",
            "db_status_failed_local": "更新失败，继续使用本地词库",
            "db_status_failed": "更新失败"
        },
        'en': {
            "title": "nHentai Pro Settings v__NH_VERSION__",
            "tab_browse": "Browse",
            "tab_translate": "Translate",
            "tab_search": "Search",
            "tab_blacklist": "Blacklist",
            "tab_data": "Data",
            "grp_browse": "Browsing",
            "lbl_btn": "Show Settings Button",
            "desc_btn": "Add gear icon to nav bar",
            "lbl_pg": "Show Page Numbers",
            "desc_pg": "Show page count on cover",
            "lbl_hover": "Enable Hover Preview",
            "desc_hover": "Preview gallery on hover",
            "lbl_hover_popup": "Desktop Popup Preview",
            "desc_hover_popup": "Use a separate enlarged preview popup with the seek bar below on desktop, while mobile keeps the legacy mode",
            "grp_hover_popup": "Popup Preview Settings",
            "lbl_hover_popup_scale": "Image Scale",
            "desc_hover_popup_scale": "Set the overall desktop popup preview display scale in percent",
            "lbl_hover_popup_position": "Popup Position",
            "desc_hover_popup_position": "Prefer showing the popup above, left, right, or let it choose automatically",
            "opt_hover_popup_auto": "Auto",
            "opt_hover_popup_top": "Top Center",
            "opt_hover_popup_right": "Right Side",
            "opt_hover_popup_left": "Left Side",
            "lbl_reading_mode": "Enable Scroll Reader",
            "desc_reading_mode": "Show a reading entry on gallery detail pages and open a continuous scroll reader overlay",
            "lbl_reading_mode_width": "Reader Image Scale",
            "desc_reading_mode_width": "Set the image display scale in scroll reader mode (%)",
            "lbl_reading_mode_gap": "Reader Image Gap",
            "desc_reading_mode_gap": "Set the vertical gap between images in scroll reader mode (px)",
            "lbl_infinite": "Enable Infinite Scroll",
            "desc_infinite": "Automatically load the next list page at the bottom",
            "lbl_blacklist_hide": "Fully Hide Blacklisted",
            "desc_blacklist_hide": "Completely hide blacklisted galleries instead of leaving dimmed placeholders",
            "grp_translate": "Translation",
            "lbl_trans": "Enable Site Translation",
            "lbl_mode": "Display Mode",
            "opt_append": "Original Priority",
            "opt_replace": "Translated Priority",
            "opt_clean": "Translated Only",
            "opt_original": "Original Only",
            "lbl_time_mode": "Upload Time Display",
            "opt_time_relative": "Relative Only",
            "opt_time_absolute": "Absolute Only",
            "opt_time_combined": "Relative + Absolute",
            "grp_search": "Search",
            "grp_filter": "Filter",
            "lbl_drop": "Navbar Filter Menu",
            "desc_drop": "Show language filter in top-right",
            "lbl_def_lang": "Default Languages (Empty=All)",
            "btn_update": "Force Update DB",
            "lbl_sugg": "Search Suggestions",
            "desc_sugg": "Show translated tags while typing",
            "lbl_sugg_mode": "Suggestion Compatibility",
            "desc_sugg_mode": "Control how nHentai Pro suggestions work with the official search autocomplete",
            "opt_sugg_auto": "Auto Compatible",
            "opt_sugg_helper": "Force Helper Suggestions",
            "opt_sugg_off": "Disable Helper Suggestions",
            "grp_blacklist": "Blacklist Tools",
            "lbl_dev_panel": "Developer Diagnostics",
            "desc_dev_panel": "Show request, prefetch, and infinite scroll metrics",
            "lbl_meta_cache": "Cache gallery info locally",
            "desc_meta_cache": "Keep page counts, tags and other gallery info in this browser for 7 days to cut repeat requests and rate limits. Turning it off clears the cached data",
            "lbl_qt": "Search Bar Quick Tags",
            "lbl_qt_sel": "Visible Quick Tags:",
            "lbl_quick_blacklist": "Gallery Quick Blacklist",
            "desc_quick_blacklist_ready": "When signed in, you can add or remove blacklist tags directly from gallery detail tags",
            "desc_quick_blacklist_login_required": "Quick blacklist is hidden while signed out. Please sign in to use it",
            "lbl_blacklist_filter_tools": "Blacklist Type Filter",
            "desc_blacklist_filter_tools": "Show a standalone type filter with counts on the account blacklist page",
            "quick_blacklist_add": "Add to blacklist",
            "quick_blacklist_remove": "Remove from blacklist",
            "quick_blacklist_error": "Quick blacklist action failed. Please try again later",
            "blacklist_filter_all": "All",
            "blacklist_filter_tag": "Tag",
            "blacklist_filter_artist": "Artist",
            "blacklist_filter_character": "Character",
            "blacklist_filter_parody": "Parody",
            "blacklist_filter_group": "Group",
            "blacklist_filter_language": "Language",
            "blacklist_filter_category": "Category",
            "blacklist_filter_empty": "No blacklisted tags in this filter",
            "grp_data": "Data & Debug",
            "grp_api_key": "API Key",
            "lbl_api_key": "Optional API Key",
            "desc_api_key": "Only used for this script's /api/v2/* requests. It is not written to DOM, console, or URLs",
            "ph_api_key": "Enter API Key",
            "btn_api_key_save": "Save API Key",
            "btn_api_key_clear": "Clear",
            "btn_api_key_test": "Test",
            "api_key_saved": "API Key saved",
            "api_key_cleared": "API Key cleared",
            "api_key_empty": "Enter or save an API Key first",
            "api_key_testing": "Testing...",
            "api_key_test_success": "Test succeeded",
            "api_key_test_failure": "Test failed",
            "api_key_configured": "Configured",
            "api_key_not_configured": "Not configured",
            "btn_cancel": "Cancel",
            "btn_save": "Save Settings",
            "confirm_update": "Redownload translation database from EhTagTranslation?",
            "qt_parodies": "Parodies",
            "qt_characters": "Characters",
            "qt_tags": "Tags",
            "qt_artists": "Artists",
            "qt_groups": "Groups",
            "qt_languages": "Languages",
            "qt_pages": "Pages",
            "btn_settings": "Settings",
            "lbl_all_lang": "All Languages",
            "lang_cn": "Chinese",
            "lang_en": "English",
            "lang_jp": "Japanese",
            "loading_index": "Preparing index in background...",
            "preview_tags": "TAGS",
            "preview_loading": "Loading...",
            "preview_no_tags": "No tags",
            "preview_page_prefix": "Pg ",
            "preview_group_artists": "Artists",
            "preview_group_parodies": "Parodies",
            "preview_group_characters": "Characters",
            "preview_group_tags": "Tags",
            "reading_mode_enter": "Scroll Reader",
            "reading_mode_continue": "Continue",
            "reading_mode_retry": "Failed to load. Click to retry",
            "reading_mode_close": "Exit Reader",
            "reading_mode_open_failed": "Failed to open reading mode. Please try again later",
            "reading_mode_page_prefix": "Page ",
            "reading_mode_state_wait": "Waiting",
            "reading_mode_state_loading": "Loading",
            "reading_mode_state_loaded": "Loaded",
            "reading_mode_state_error": "Failed",
            "reading_mode_tool_scale_label": "Scale",
            "reading_mode_tool_gap_label": "Gap",
            "reading_mode_tool_scale_tip": "Type a percent, or hold Ctrl and use the wheel to scale live",
            "reading_mode_tool_gap_tip": "Type the image gap in pixels",
            "infinite_ready": "Scroll down to load the next page",
            "infinite_sync": "Syncing pagination state...",
            "infinite_loading": "Loading the next page...",
            "infinite_done": "All pages loaded",
            "infinite_error": "Failed to load the next page, scroll again to retry",
            "infinite_error_manual": "Loading failed repeatedly. Click here to retry",
            "infinite_paused_empty": "{count} pages in a row had nothing matching your filters. Click here to keep loading",
            "infinite_page_marker": "Page {page}",
            "db_status_downloading": "Downloading translation database...",
            "db_status_checking": "Checking for database updates...",
            "db_status_latest": "Database is up to date",
            "db_status_fallback": "Primary source failed, trying mirror...",
            "db_status_done": "Update complete!",
            "db_status_done_fallback": "Update complete (mirror)",
            "db_status_failed_local": "Update failed, using local database",
            "db_status_failed": "Update failed"
        }
    };

    function getSettingsLanguage() {
        return Config.get('settingsLanguage') === 'en' ? 'en' : 'zh';
    }

    function getUIText(key, lang = getSettingsLanguage()) {
        const dict = SettingsUIDict[lang] || SettingsUIDict.zh;
        return dict[key] || SettingsUIDict.en[key] || key;
    }

    function setupSettingsUI() {
        GM_registerMenuCommand("显示/隐藏网页设置按钮", () => {
            const current = Config.get('showPageSettingsButton');
            Config.set('showPageSettingsButton', !current);
            updatePageSettingsButton();
        });
        // 菜单回调会收到事件参数，不能直接当作 showSettingsModal 的选项传入。
        GM_registerMenuCommand("打开助手设置", () => showSettingsModal());
    }

    function updatePageSettingsButton() {
        const navLeft = document.querySelector('ul.menu.left');
        const existingBtn = document.getElementById('nh-web-settings-btn');
        const show = Config.get('showPageSettingsButton');

        if (show) {
            if (navLeft && !existingBtn) {
                const li = document.createElement('li');
                li.id = 'nh-web-settings-btn';
                li.className = 'desktop';
                li.innerHTML = `<a href="javascript:void(0)" class="link"><i class="fa fa-cog"></i>${getUIText('btn_settings')}</a>`;
                li.onclick = (e) => {
                    e.preventDefault();
                    showSettingsModal();
                };
                navLeft.insertBefore(li, navLeft.firstChild);
            }
        } else {
            if (existingBtn) {
                existingBtn.remove();
            }
        }
    }

    let langFilterOutsideClickBound = false;

    function setupLanguageFilterUI() {
        const navLeft = document.querySelector('ul.menu.left');
        if (!navLeft) return;

        Array.from(navLeft.children).forEach(child => {
            const text = child.textContent.trim().toLowerCase();
            const link = child.querySelector('a');
            const href = link ? link.href.toLowerCase() : '';

            const isAI = text.includes('ai jerk off') || text.includes('ai porn');
            const isTwitter = href.includes('twitter.com') || href.includes('x.com') || child.querySelector('.fa-twitter');

            if (isAI || isTwitter) {
                child.remove();
            }
        });

        if (!Config.get('showLangDropDown')) return;

        if (document.getElementById('nh-lang-filter')) return;

        const li = document.createElement('li');
        li.id = 'nh-lang-filter';
        li.className = 'desktop';
        li.style.display = 'flex';
        li.style.alignItems = 'center';
        li.style.order = '9999';
        li.style.marginLeft = 'auto';
        li.style.flexGrow = '1';
        li.style.justifyContent = 'flex-end';

        const wrapper = document.createElement('div');
        wrapper.className = 'nh-lang-container';

        const btn = document.createElement('div');
        btn.className = 'nh-lang-btn';
        btn.innerHTML = `<span id="nh-lang-label">${getUIText('lbl_all_lang')}</span><i class="fa fa-chevron-down nh-lang-arrow"></i>`;

        const menu = document.createElement('div');
        menu.className = 'nh-lang-menu';

        const options = [{
            val: LANG_IDS.CHINESE,
            label: getUIText('lang_cn')
        }, {
            val: LANG_IDS.ENGLISH,
            label: getUIText('lang_en')
        }, {
            val: LANG_IDS.JAPANESE,
            label: getUIText('lang_jp')
        }];

        let currentSelection = Config.get('langFilter');

        const renderMenu = () => {
            menu.innerHTML = '';
            options.forEach(opt => {
                const isSelected = currentSelection.includes(opt.val);
                const item = document.createElement('div');
                item.className = 'nh-lang-item' + (isSelected ? ' selected' : '');
                item.innerHTML = `<div class="nh-lang-checkbox"></div>${opt.label}`;

                item.onclick = (e) => {
                    e.stopPropagation();
                    handleSelection(opt.val);
                };
                menu.appendChild(item);
            });
        };

        const handleSelection = (val) => {
            const idx = currentSelection.indexOf(val);
            if (idx > -1) {
                currentSelection.splice(idx, 1);
            } else {
                currentSelection.push(val);
            }

            Config.set('langFilter', currentSelection);
            updateButtonText();
            renderMenu();
            runLanguageFilter(document, currentSelection);
        };

        const updateButtonText = () => {
            const labelEl = btn.querySelector('#nh-lang-label');
            if (currentSelection.length === 0 || currentSelection.length === 3) {
                labelEl.textContent = getUIText('lbl_all_lang');
            } else if (currentSelection.length === 1) {
                labelEl.textContent = LANG_LABELS[currentSelection[0]];
            } else if (currentSelection.length === 2) {
                const labels = currentSelection.map(id => LANG_LABELS[id]);
                labelEl.textContent = labels.join(', ');
            }
        };

        btn.onclick = (e) => {
            e.stopPropagation();
            menu.classList.toggle('show');
            btn.classList.toggle('active');
        };

        // 导航栏重建时筛选器会被重新创建，外部点击关闭只绑定一次，避免监听与旧节点累积。
        if (!langFilterOutsideClickBound) {
            langFilterOutsideClickBound = true;
            document.addEventListener('click', (e) => {
                const container = document.querySelector('#nh-lang-filter .nh-lang-container');
                if (!container || container.contains(e.target)) return;
                container.querySelector('.nh-lang-menu')?.classList.remove('show');
                container.querySelector('.nh-lang-btn')?.classList.remove('active');
            });
        }

        updateButtonText();
        renderMenu();

        wrapper.appendChild(btn);
        wrapper.appendChild(menu);
        li.appendChild(wrapper);

        navLeft.appendChild(li);
    }

