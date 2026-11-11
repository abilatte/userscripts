// ==UserScript==
// @name nhentai Pro
// @name:en nhentai Pro
// @namespace https://github.com/abilatte
// @homepageURL https://github.com/abilatte/userscripts
// @version 2.8.2.18
// @description 中文搜索标签、全站标签汉化、封面悬停预览、卷轴阅读、无限滚动与语言筛选
// @description:en Chinese tag search, site-wide tag translation, cover hover preview, scroll reader, infinite scroll and language filter.
// @author abilatte
// @match https://nhentai.net/*
// @icon https://nhentai.net/favicon.png
// @require https://nhentai.net/userscript/v1.js
// @connect raw.githubusercontent.com
// @grant GM_addStyle
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_deleteValue
// @grant GM_xmlhttpRequest
// @grant GM_registerMenuCommand
// @license GPL-3.0-only
// @run-at document-end
// @downloadURL https://raw.githubusercontent.com/abilatte/userscripts/main/nhentai/nhentai-pro.user.js
// @updateURL https://raw.githubusercontent.com/abilatte/userscripts/main/nhentai/nhentai-pro.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ===== 1. 脚本头与全局常量 =====
    // 词库主源：EhTagTranslation 官方发布的单文件 db.text.json（纯文本），sha 文件用于判断是否有更新；
    // 运行时解析为 nhentai 命名空间。旧 abilatte/nhentaiTags 仅作主源失败时的兜底镜像。
    const EHTAG_RELEASE_BASE = 'https://raw.githubusercontent.com/EhTagTranslation/DatabaseReleases/master';
    const EHTAG_RELEASE_DB_URL = `${EHTAG_RELEASE_BASE}/db.text.json`;
    const EHTAG_RELEASE_SHA_URL = `${EHTAG_RELEASE_BASE}/sha`;
    const LEGACY_TAG_REPO_BASE = 'https://raw.githubusercontent.com/abilatte/nhentaiTags/main';
    // 升版本：强制重拉词库，应用 gender 冲突合并策略。
    const DB_VERSION = 7;
    // nhentai 的 tag 无 male/female 命名空间；EhTag 同名英文条冲突时按优先级取一。
    // female 优先于 male，避免 mesugaki 等被「雄*」覆盖成错误译名。
    const EHTAG_TAG_FILE_PRIORITY = {
        female: 100,
        mixed: 80,
        other: 70,
        location: 60,
        male: 40
    };
    // release 中的 EhTag 命名空间 → nhentai 命名空间；未列出的（rows、reclass、cosplayer 等）忽略。
    const EHTAG_RELEASE_NAMESPACES = {
        artist: { ns: 'artist' },
        group: { ns: 'group' },
        character: { ns: 'character' },
        parody: { ns: 'parody' },
        language: { ns: 'language' },
        male: { ns: 'tag', priority: EHTAG_TAG_FILE_PRIORITY.male },
        location: { ns: 'tag', priority: EHTAG_TAG_FILE_PRIORITY.location },
        other: { ns: 'tag', priority: EHTAG_TAG_FILE_PRIORITY.other },
        mixed: { ns: 'tag', priority: EHTAG_TAG_FILE_PRIORITY.mixed },
        female: { ns: 'tag', priority: EHTAG_TAG_FILE_PRIORITY.female }
    };
    const LEGACY_TAG_DB_SOURCES = [
        { ns: 'artist', urls: [`${LEGACY_TAG_REPO_BASE}/Artists_all.md`] },
        { ns: 'group', urls: [`${LEGACY_TAG_REPO_BASE}/Groups_all.md`] },
        { ns: 'character', urls: [`${LEGACY_TAG_REPO_BASE}/Characters_all.md`] },
        { ns: 'parody', urls: [`${LEGACY_TAG_REPO_BASE}/Parodies_all.md`] },
        { ns: 'language', urls: [`${LEGACY_TAG_REPO_BASE}/Languages_all.md`] },
        { ns: 'tag', urls: [`${LEGACY_TAG_REPO_BASE}/Tags_all.md`] }
    ];

    const NS_PLURAL_MAP = {
        'tag': 'tags',
        'artist': 'artists',
        'group': 'groups',
        'parody': 'parodies',
        'character': 'characters',
        'language': 'languages'
    };

    const LANG_IDS = {
        ALL: '0',
        CHINESE: '29963',
        ENGLISH: '12227',
        JAPANESE: '6346'
    };

    const LANG_LABELS = {
        '29963': 'CN',
        '12227': 'EN',
        '6346': 'JP'
    };

    const API_ENDPOINTS = {
        galleryV2: (id) => `/api/v2/galleries/${id}`,
        legacyGallery: (id) => `/api/gallery/${id}`,
        cdnConfig: '/api/v2/cdn',
        blacklist: '/api/v2/blacklist',
        blacklistIds: '/api/v2/blacklist/ids'
    };

    const LANG_CLASS_MAP = {
        [LANG_IDS.CHINESE]: ['lang-cn'],
        [LANG_IDS.ENGLISH]: ['lang-gb', 'lang-en'],
        [LANG_IDS.JAPANESE]: ['lang-jp']
    };

    const GALLERY_SELECTORS = {
        gallery: '.gallery',
        coverLink: 'a.cover',
        coverImage: 'a.cover img',
        listContainer: '.index-container, #favcontainer, .gallery-grid',
        pagination: '.pagination, section.pagination',
        dynamicRoot: '.gallery, a.cover, .index-container, #content',
        uninitializedGallery: '.gallery:not([data-init])'
    };

    const GALLERY_STATE_CLASSES = {
        hidden: 'nh-helper-hidden',
        blacklisted: 'nh-site-blacklisted',
        previewing: 'is-previewing'
    };

    const TOKEN_REGEX = /(-?)([a-zA-Z0-9_]+):("[^"]*"|[^"\s]+)|("[^"]*"|[^"\s]+)/g;
    const EXT_MAP = { 'j': 'jpg', 'p': 'png', 'g': 'gif', 'w': 'webp' };

    // ===== 2. 配置与文案字典 =====
    const READING_MODE_LAYOUT_PRESET_V2_KEY = 'nh_reading_mode_layout_preset_v2';
    const READING_MODE_BASE_WIDTH = 1360;

    const DEFAULT_CONFIG = {
        enableTranslation: true,
        enableSuggestions: true,
        searchSuggestionMode: 'auto',
        enableQuickTags: true,
        showPageSettingsButton: true,
        showLangDropDown: true,
        showPageNumbers: true,
        enableHoverPreview: true,
        enablePopupHoverPreview: false,
        popupHoverPreviewImageScalePercent: 100,
        popupHoverPreviewPosition: 'auto',
        enableReadingMode: true,
        readingModeImageScalePercent: 100,
        readingModeImageGap: 10,
        enableInfiniteScroll: true,
        enableFullBlacklistHide: true,
        enableDetailQuickBlacklist: true,
        enableUserSettingsBlacklistFilter: true,
        showDevPanel: false,
        disableAutoDbUpdate: true,
        apiKey: '',
        apiKeyTestStatus: '',
        apiKeyTestedAt: 0,
        translationMode: 'append',
        uploadTimeDisplayMode: 'combined',
        langFilter: [],
        updateInterval: 7 * 24 * 60 * 60 * 1000,
        settingsLanguage: 'zh',
        quickTagsSettings: {
            'parodies': true,
            'characters': true,
            'tags': true,
            'artists': true,
            'groups': true,
            'languages': true,
            'pages': true
        }
    };

    const Config = {
        settings: {},
        load() {
            const stored = GM_getValue('user_settings', '{}');
            let parsed = {};
            try {
                parsed = JSON.parse(stored);
            } catch (e) {}
            const parsedReadingModeWidth = Number(parsed.readingModeImageMaxWidth);
            const parsedReadingModeScale = Number(parsed.readingModeImageScalePercent);
            const parsedReadingModeGap = Number(parsed.readingModeImageGap);
            const shouldAutoTuneReadingModeLayout =
                !GM_getValue(READING_MODE_LAYOUT_PRESET_V2_KEY, false) &&
                (!Number.isFinite(parsedReadingModeWidth) || parsedReadingModeWidth === 1120) &&
                (!Number.isFinite(parsedReadingModeGap) || parsedReadingModeGap === 18);
            this.settings = {
                ...DEFAULT_CONFIG,
                ...parsed
            };
            this.settings.quickTagsSettings = {
                ...DEFAULT_CONFIG.quickTagsSettings,
                ...(parsed.quickTagsSettings || {})
            };
            if (!['append', 'replace', 'clean', 'original'].includes(this.settings.translationMode)) {
                this.settings.translationMode = DEFAULT_CONFIG.translationMode;
            }
            if (!['relative', 'absolute', 'combined'].includes(this.settings.uploadTimeDisplayMode)) {
                this.settings.uploadTimeDisplayMode = DEFAULT_CONFIG.uploadTimeDisplayMode;
            }
            if (!['auto', 'helper', 'off'].includes(this.settings.searchSuggestionMode)) {
                this.settings.searchSuggestionMode = DEFAULT_CONFIG.searchSuggestionMode;
            }

            if (typeof this.settings.langFilter === 'string') {
                this.settings.langFilter = [this.settings.langFilter];
            }
            if (!Array.isArray(this.settings.langFilter)) {
                this.settings.langFilter = [];
            }
            if (this.settings.langFilter.includes('0')) {
                this.settings.langFilter = [];
            }
            if (typeof this.settings.apiKey !== 'string') {
                this.settings.apiKey = '';
            }
            this.settings.apiKey = this.settings.apiKey.trim();
            if (!['success', 'failure'].includes(this.settings.apiKeyTestStatus)) {
                this.settings.apiKeyTestStatus = '';
            }
            if (!Number.isFinite(Number(this.settings.apiKeyTestedAt))) {
                this.settings.apiKeyTestedAt = 0;
            }

            if (!Number.isFinite(Number(this.settings.popupHoverPreviewImageScalePercent))) {
                const popupWidthRaw = Number(parsed.popupHoverPreviewWidth);
                if (Number.isFinite(popupWidthRaw) && popupWidthRaw > 0) {
                    if (popupWidthRaw > 100) {
                        const viewportWidth = Math.max(window.innerWidth || 0, 1024);
                        this.settings.popupHoverPreviewImageScalePercent = Math.round((popupWidthRaw / viewportWidth) / 0.34 * 100);
                    } else {
                        this.settings.popupHoverPreviewImageScalePercent = Math.round((popupWidthRaw / 34) * 100);
                    }
                } else {
                    this.settings.popupHoverPreviewImageScalePercent = 100;
                }
            }
            this.settings.popupHoverPreviewImageScalePercent = Math.max(60, Math.min(160, Number(this.settings.popupHoverPreviewImageScalePercent) || 100));
            if (!['auto', 'top', 'right', 'left'].includes(this.settings.popupHoverPreviewPosition)) {
                this.settings.popupHoverPreviewPosition = 'auto';
            }
            if (!Number.isFinite(Number(this.settings.readingModeImageScalePercent))) {
                const derivedScale = Number.isFinite(parsedReadingModeScale)
                    ? parsedReadingModeScale
                    : (Number.isFinite(parsedReadingModeWidth)
                        ? Math.round((parsedReadingModeWidth / READING_MODE_BASE_WIDTH) * 100)
                        : 100);
                this.settings.readingModeImageScalePercent = Math.max(40, Math.min(160, derivedScale || 100));
            }
            if (!Number.isFinite(Number(this.settings.readingModeImageGap))) {
                this.settings.readingModeImageGap = 10;
            }
            if (shouldAutoTuneReadingModeLayout) {
                this.settings.readingModeImageScalePercent = 100;
                this.settings.readingModeImageGap = 10;
                GM_setValue(READING_MODE_LAYOUT_PRESET_V2_KEY, true);
                this.save();
            }
        },
        save() {
            GM_setValue('user_settings', JSON.stringify(this.settings));
        },
        get(key) {
            return this.settings[key];
        },
        set(key, val) {
            this.settings[key] = val;
            this.save();
        },
        setMany(patch) {
            Object.assign(this.settings, patch);
            this.save();
        }
    };
    Config.load();

    const Dict = {
        Nav: {
            "Login": "登录",
            "Register": "注册",
            "Log out": "注销",
            "Log Out": "注销",
            "Profile": "个人资料",
            "Settings": "设置",
            "Favorites": "收藏",
            "New Uploads": "最新上传",
            "Popular Now": "当前热门",
            "Uploaded": "上传时间",
            "Popular": "热门"
        },
        Meta: {
            "Title": "标题",
            "Artists": "作者",
            "Artist": "作者",
            "Tags": "标签",
            "Tag": "标签",
            "tags": "标签",
            "Languages": "语言",
            "Language": "语言",
            "Pages": "页数",
            "Groups": "社团",
            "Group": "社团",
            "Categories": "分类",
            "Parodies": "原作",
            "Parody": "原作",
            "Characters": "角色",
            "Character": "角色",
            "Uploaded": "上传时间",
            "Info": "介绍信息",
            "Blacklist": "黑名单",
            "Joined": "注册时间",
            "Username": "用户名",
            "Email": "邮箱",
            "Avatar": "头像",
            "avatar": "头像",
            "About": "关于",
            "Theme": "主题"
        },
        Action: {
            "Favorite": "收藏",
            "Unfavorite": "取消收藏",
            "Download": "下载",
            "Remove": "移除",
            "Confirm": "确认",
            "Save": "保存",
            "Delete Account": "删除账号",
            "Submit": "提交",
            "Cancel": "取消",
            "Sort by": "排序方式",
            "Reset": "重置",
            "Apply": "应用",
            "Show All": "显示全部",
            "Show More": "显示更多",
        "Post New Comment": "发布新评论"
        ,"No comments yet. Be the first to comment!": "还没有评论，来成为第一个评论的人吧！"
        },
        General: {
            "today": "今天",
            "week": "本周",
            "month": "本月",
            "all time": "全部时间",
            "Recent": "最新的",
            "Newest First": "最新优先",
            "Tags": "标签",
            "Artists": "作者",
            "Characters": "角色",
            "Parodies": "原作",
            "Groups": "社团",
            "A-Z": "A-Z",
            "Old Password": "旧密码",
            "New Password": "新密码",
            "Forgot password?": "忘记密码？",
            "Random": "随机",
            "Doujinshi": "同人志",
            "Manga": "漫画",
            "Artist CG": "画师CG",
            "Game CG": "游戏CG",
            "Western": "西方",
            "Non-H": "一般向",
            "Image Set": "图集",
            "Cosplay": "Cosplay",
            "Asian Porn": "亚洲色情",
            "Misc": "杂项",
            "Popular": "热门",
            "Popular:": "热门：",
            "Tag": "标签",
            "Artist": "作者",
            "Character": "角色",
            "Parody": "原作",
            "Group": "社团",
            "Language": "语言",
            "Category": "分类",
            "Black": "黑色",
            "Blue": "蓝色",
            "Light": "浅色"
        },
        SiteUI: {
            "Username": "用户名",
            "Email": "邮箱",
            "Avatar": "头像",
            "About": "介绍",
            "Favorite Tags": "喜欢的标签",
            "Theme": "主题",
            "Old Password": "旧密码",
            "New Password": "新密码",
            "Save Settings": "保存设置",
            "Delete Account": "删除账号",
            "Light": "浅色",
            "Dark": "黑色",
            "Blue": "蓝色",
        "Username (or Email)": "用户名 (或邮箱)",
        "Username or Email": "用户名或邮箱",
        "Password": "密码",
        "Confirm Password": "确认密码",
        "Login": "登录",
        "Register": "注册",
        "Reset it": "立即重置",
        "Don't have an account?": "还没有账户？",
        "Already have an account?": "已有账号？",
        "Forgot your password?": "忘记密码了？",
        "Abandon all hope, ye who enter here": "进入此地者，请抛弃一切希望",
        "Remember me": "记住我",
            "Lost password?": "忘记密码？",
            "Download Torrent": "下载种子",
            "Show all": "显示全部",
            "More like this": "相似推荐",
            "Are you sure you want to log out?": "真的要注销吗？",
            "No, take me back": "不，回到之前的页面",
            "No, take me back.": "不，回到之前的页面。",
            "Recent Favorites": "最近收藏",
            "Recent Comments": "最近评论",
            "View Profile": "查看资料",
            "Profile & Security": "资料与安全",
            "Change Avatar": "更换头像",
            "Change Password": "修改密码",
        "Remove avatar": "移除头像",
        "Delete my account": "删除我的账户",
        "You're about to delete your account. This cannot be undone.": "你即将删除你的账户。此操作无法撤销。",
        "Enter your password": "输入你的密码",
        "Enter your username to confirm": "输入你的用户名以确认",
        "Take me away": "带我离开这里",
            "Save": "保存",
            "Danger Zone": "危险区域",
            "Blacklist Tags": "黑名单标签",
        "API Keys": "API 密钥",
        "Key Name": "密钥名称",
        "Sessions": "会话",
            "Search tags to add...": "搜索要添加的标签...",
            "e.g. nakadashi": "例如：nakadashi",
            "e.g. My Script": "例如：我的脚本",
            "Optional — tell us about your project": "选填：介绍一下你的项目",
            "We're curious — what are you building?": "我们很好奇：你在构建什么？",
            "Create Key": "创建密钥",
            "API Documentation": "API 文档",
            "No API keys yet.": "还没有 API 密钥。",
            "Revoke": "撤销",
            "Revoke All Sessions": "撤销全部会话",
            "Current": "当前",
            "Signed in": "登录于",
            "Expires": "过期于"
        },
        // 仅用于 <label> 内文本：同一英文在表单标签与按钮中含义不同（密码表单的 "Confirm" vs 确认按钮）。
        Label: {
            "Confirm": "确认密码"
        }
    };

    const uiTranslations = {
        ...Dict.Nav,
        ...Dict.Meta,
        ...Dict.Action,
        ...Dict.General,
        ...Dict.SiteUI
    };

    function getUITranslation(text, element = null) {
        if (element?.closest?.('label') && Dict.Label[text]) return Dict.Label[text];
        return uiTranslations[text];
    }

    const mapTagHeaders = {
        'Parodies': 'parody',
        '原作': 'parody',
        'Characters': 'character',
        '角色': 'character',
        'Tags': 'tag',
        '标签': 'tag',
        'Artists': 'artist',
        '作者': 'artist',
        '艺术家': 'artist',
        'Groups': 'group',
        '社团': 'group',
        'Languages': 'language',
        '语言': 'language',
        'Categories': 'tag',
        '分类': 'tag',
        'Pages': 'pages',
        '页数': 'pages'
    };

    const mapMenu = {
        'Random': '随机',
        'Tags': '标签',
        'Artists': '作者',
        'Characters': '角色',
        'Parodies': '原作',
        'Groups': '社团',
        'Info': '关于',
        'Favorites': '收藏',
        'Log out': '注销'
    };

    const specialTagValueTranslations = {
        'translated': '已翻译',
        'chinese': '中文',
        'english': '英文',
        'japanese': '日文',
        'doujinshi': '同人志',
        'manga': '漫画',
        'artist cg': '画师CG',
        'game cg': '游戏CG',
        'western': '西方',
        'non-h': '一般向',
        'image set': '图集',
        'cosplay': 'Cosplay',
        'asian porn': '亚洲色情',
        'misc': '杂项'
    };

    // ===== 3.1 LRU 缓存 =====
    // LRU 缓存实现，限制最大条目数防止内存膨胀
    class LRUCache {
        constructor(maxSize = 500) {
            this.maxSize = maxSize;
            this.cache = new Map();
        }
        has(key) {
            return this.cache.has(key);
        }
        get(key) {
            if (!this.cache.has(key)) return undefined;
            // 访问时移到末尾（最近使用）
            const value = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, value);
            return value;
        }
        set(key, value) {
            if (this.cache.has(key)) {
                this.cache.delete(key);
            } else if (this.cache.size >= this.maxSize) {
                // 删除最旧的条目（Map 迭代器第一个）
                const oldestKey = this.cache.keys().next().value;
                this.cache.delete(oldestKey);
            }
            this.cache.set(key, value);
        }
        get size() {
            return this.cache.size;
        }
    }

    // ===== 3.2 DOM 与运行时通用工具 =====
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // 拼进 innerHTML 的外部数据（词库、API、页面属性）统一转义。
    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[ch]);
    }

    // 快捷键不能劫持输入框里的按键（光标移动、数值步进等）。
    function isEditableKeyTarget(target) {
        return Boolean(target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
    }

    // 页面内轻提示：替代 alert()，不阻塞操作，到时自动消失。
    function showToast(message, { type = 'info', duration = 3200 } = {}) {
        if (!message || !document.body) return null;
        let root = document.getElementById('nh-toast-root');
        if (!root) {
            root = document.createElement('div');
            root.id = 'nh-toast-root';
            root.setAttribute('role', 'status');
            root.setAttribute('aria-live', 'polite');
            document.body.appendChild(root);
        }
        const toast = document.createElement('div');
        toast.className = `nh-toast nh-toast-${type}`;
        toast.textContent = message;
        root.appendChild(toast);
        setTimeout(() => toast.remove(), Math.max(1000, duration));
        return toast;
    }

    function queryAll(context, selector) {
        return context && context.querySelectorAll ? Array.from(context.querySelectorAll(selector)) : [];
    }

    function queryOne(context, selector) {
        return context && context.querySelector ? context.querySelector(selector) : null;
    }

    function isUserLoggedIn() {
        const app = window._n_app ?? window.n ?? null;
        if (Array.isArray(app?.options?.blacklisted_tags)) return true;
        return !queryOne(document, '.menu-sign-in a[href="/login/"]');
    }

    // ===== 3.3 官方 userscript bridge 与原始事件兜底 =====
    const NhentaiUserscriptBridge = {
        updateUnsubscribe: null,
        paginationUnsubscribe: null,
        rawEventName: 'nhentai:update',
        readyTimeoutMs: 1500,
        getApi() {
            return window.nhentai_userscript_v1 || null;
        },
        getData() {
            const api = this.getApi();
            const apiData = api?.get?.();
            return apiData || window.nhentai_data_v1 || null;
        },
        waitForRawData(timeoutMs = this.readyTimeoutMs) {
            const currentData = this.getData();
            if (currentData) return Promise.resolve(currentData);

            return new Promise(resolve => {
                let timeoutId = null;
                const finish = () => {
                    window.removeEventListener(this.rawEventName, handleUpdate);
                    if (timeoutId) clearTimeout(timeoutId);
                    resolve(this.getData());
                };
                const handleUpdate = () => finish();
                timeoutId = setTimeout(finish, timeoutMs);
                window.addEventListener(this.rawEventName, handleUpdate, { once: true });
            });
        },
        async ready() {
            const api = this.getApi();
            if (api?.ready) {
                try {
                    const data = await Promise.race([
                        api.ready(),
                        this.waitForRawData()
                    ]);
                    if (data) return data;
                } catch (error) {}
            }
            return await this.waitForRawData();
        },
        getPaginationPage(data = this.getData()) {
            const page = Number(data?.pagination?.page || data?.search?.page || 1);
            return Number.isFinite(page) && page > 0 ? page : 1;
        },
        getCurrentPageName(data = this.getData()) {
            return typeof data?.page === 'string' ? data.page : '';
        },
        isPageName(pageName, candidates = []) {
            return candidates.includes(String(pageName || ''));
        },
        getCurrentTag(data = this.getData()) {
            return data?.tag || null;
        },
        matchesListContext(context, data = this.getData()) {
            if (!context || !data) return false;
            const pageName = this.getCurrentPageName(data);
            const currentPage = this.getPaginationPage(data);
            if (currentPage !== Number(context.page || 1)) return false;

            if (context.type === 'home') {
                return this.isPageName(pageName, ['homepage']);
            }
            if (context.type === 'search') {
                return this.isPageName(pageName, ['search'])
                    && String(data.search?.query || '') === String(context.query || '');
            }
            if (context.type === 'namespace') {
                const tag = this.getCurrentTag(data);
                return this.isPageName(pageName, ['tagDetail'])
                    && String(tag?.type || '') === String(context.namespace || '')
                    && String(tag?.slug || '') === String(context.slug || '');
            }
            if (context.type === 'favorites') {
                return this.isPageName(pageName, ['favorites', 'userFavorites']);
            }
            if (context.type === 'profile') {
                return this.isPageName(pageName, ['profile', 'userProfile']);
            }
            return false;
        },
        getCurrentListEntries(context, data = this.getData()) {
            if (!this.matchesListContext(context, data)) return [];
            return Array.isArray(data?.galleries) ? data.galleries : [];
        },
        getCurrentGallery(data = this.getData()) {
            return data?.gallery || null;
        },
        getCurrentGalleryMeta(id) {
            const data = this.getData();
            const gallery = this.getCurrentGallery(data);
            if (!gallery) return null;
            if (String(gallery.id || '') !== String(id || '')) return null;
            return normalizeGalleryMeta(gallery);
        },
        getCurrentTagId(context, data = this.getData()) {
            if (!this.matchesListContext(context, data)) return 0;
            const tagId = Number(this.getCurrentTag(data)?.id || 0);
            return Number.isFinite(tagId) && tagId > 0 ? tagId : 0;
        },
        onRawUpdate(callback) {
            if (typeof callback !== 'function') return () => {};
            const dispatch = () => {
                const data = this.getData();
                if (data) callback(data);
            };
            window.addEventListener(this.rawEventName, dispatch);
            dispatch();
            return () => {
                window.removeEventListener(this.rawEventName, dispatch);
            };
        },
        onUpdate(callback) {
            const api = this.getApi();
            if (!api?.onUpdate || typeof callback !== 'function') return this.onRawUpdate(callback);
            return api.onUpdate((data) => {
                callback(data || this.getData());
            });
        },
        onPagination(callback) {
            if (typeof callback !== 'function') return () => {};
            const api = this.getApi();
            if (!api?.onPagination) {
                return this.onUpdate((data) => {
                    const pagination = data?.pagination || null;
                    if (pagination) callback(pagination);
                });
            }
            return api.onPagination((pagination) => {
                callback(pagination || this.getData()?.pagination || null);
            });
        },
        onGallery(callback) {
            if (typeof callback !== 'function') return () => {};
            const api = this.getApi();
            if (!api?.onGallery) {
                return this.onUpdate((data) => {
                    const gallery = data?.gallery || null;
                    if (gallery) callback(gallery, data);
                });
            }
            return api.onGallery((gallery) => {
                const data = this.getData();
                callback(gallery || data?.gallery || null, data);
            });
        },
        onGalleries(callback) {
            if (typeof callback !== 'function') return () => {};
            const api = this.getApi();
            if (!api?.onGalleries) {
                return this.onUpdate((data) => {
                    if (Array.isArray(data?.galleries)) callback(data.galleries, data);
                });
            }
            return api.onGalleries((galleries) => {
                const data = this.getData();
                callback(Array.isArray(galleries) ? galleries : (Array.isArray(data?.galleries) ? data.galleries : []), data);
            });
        },
        whilePage(predicate, setup) {
            const api = this.getApi();
            if (api?.whilePage && typeof setup === 'function') {
                return api.whilePage(predicate, setup) || (() => {});
            }
            if (typeof setup !== 'function') return () => {};

            const matches = typeof predicate === 'function'
                ? predicate
                : (data) => data?.page === predicate;
            let cleanup = null;

            const teardown = () => {
                if (!cleanup) return;
                try {
                    cleanup();
                } catch (error) {
                    console.error('[nHentai Pro] userscript page cleanup failed:', error);
                }
                cleanup = null;
            };

            const dispatch = (data = this.getData()) => {
                const shouldMount = Boolean(data && matches(data));
                if (shouldMount && !cleanup) {
                    try {
                        cleanup = setup(data) || null;
                    } catch (error) {
                        console.error('[nHentai Pro] userscript page setup failed:', error);
                        cleanup = null;
                    }
                } else if (!shouldMount && cleanup) {
                    teardown();
                }
            };

            const unsubscribe = this.onUpdate(dispatch);
            return () => {
                unsubscribe();
                teardown();
            };
        },
        buildPageUrl(pageNumber, baseUrl = location.href) {
            const parsed = new URL(baseUrl, location.origin);
            const nextPage = Number(pageNumber || 1);
            if (!Number.isFinite(nextPage) || nextPage <= 1) {
                parsed.searchParams.delete('page');
            } else {
                parsed.searchParams.set('page', String(nextPage));
            }
            return `${parsed.origin}${parsed.pathname}${parsed.search}`;
        },
        getImageUrl(path = '', attempt = 0) {
            if (!path) return '';
            const api = this.getApi();
            const url = api?.cdn?.image?.(path, attempt);
            return typeof url === 'string' ? url : '';
        },
        syncCdnFromPageData() {
            const data = this.getData();
            const servers = data?.cdn?.image_servers;
            if (Array.isArray(servers) && servers.length) {
                CDN.imageServers = servers;
                return true;
            }
            return false;
        }
    };

    // ===== 3.4 CDN 与图片候选地址 =====
    const CDN = {
        imageServers: ['https://i1.nhentai.net'],
        loadPromise: null,
        ensure() {
            if (this.loadPromise) return this.loadPromise;
            if (NhentaiUserscriptBridge.syncCdnFromPageData()) {
                this.loadPromise = Promise.resolve(this.imageServers);
                return this.loadPromise;
            }
            this.loadPromise = fetch(API_ENDPOINTS.cdnConfig, {
                headers: buildNhentaiApiHeaders(API_ENDPOINTS.cdnConfig)
            })
                .then(res => {
                    if (!res.ok) throw new Error(res.statusText || `HTTP ${res.status}`);
                    return res.json();
                })
                .then(data => {
                    if (Array.isArray(data.image_servers) && data.image_servers.length) {
                        this.imageServers = data.image_servers;
                    }
                    return this.imageServers;
                })
                .catch(err => {
                    console.warn('[nHentai Pro] Failed to load CDN config, fallback to default image server:', err);
                    return this.imageServers;
                });
            return this.loadPromise;
        },
        buildImageUrl(path = '') {
            if (!path) return '';
            const base = (this.imageServers[0] || 'https://i1.nhentai.net').replace(/\/+$/, '');
            const normalizedPath = String(path).replace(/^\/+/, '');
            return `${base}/${normalizedPath}`;
        }
    };

    const PREFERRED_IMAGE_SERVERS = [
        'https://i.nhentai.net',
        'https://i1.nhentai.net',
        'https://i2.nhentai.net',
        'https://i3.nhentai.net',
        'https://i4.nhentai.net'
    ];

    function buildImageUrlFromServer(server, path = '') {
        if (!server || !path) return '';
        return `${String(server).replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
    }

    function buildPreferredImageUrls(path = '') {
        if (!path) return [];
        return PREFERRED_IMAGE_SERVERS.map(server => buildImageUrlFromServer(server, path));
    }

    function buildOfficialImageUrls(path = '') {
        if (!path) return [];
        const urls = [];
        const pushUrl = (url) => {
            if (!url || urls.includes(url)) return;
            urls.push(url);
        };

        for (let attempt = 0; attempt < 3; attempt += 1) {
            pushUrl(NhentaiUserscriptBridge.getImageUrl(path, attempt));
        }

        CDN.imageServers.forEach(server => {
            pushUrl(buildImageUrlFromServer(server, path));
        });

        pushUrl(CDN.buildImageUrl(path));
        return urls;
    }

    function buildImageCandidateUrls(path = '') {
        if (!path) return [];
        const urls = [];
        const pushUrl = (url) => {
            if (!url || urls.includes(url)) return;
            urls.push(url);
        };

        buildPreferredImageUrls(path).forEach(pushUrl);
        buildOfficialImageUrls(path).forEach(pushUrl);
        return urls;
    }

    // ===== 3.5 画廊元数据归一化与列表辅助 =====
    function normalizeGalleryTagIds(data) {
        const rawTagIds = Array.isArray(data?.tag_ids) ? data.tag_ids : [];
        const fallbackTagIds = Array.isArray(data?.tags)
            ? data.tags.map(tag => tag?.id || tag?.tag_id)
            : [];
        const source = rawTagIds.length ? rawTagIds : fallbackTagIds;
        return Array.from(new Set(
            source
                .map(tagId => Number(tagId))
                .filter(tagId => Number.isFinite(tagId) && tagId > 0)
        ));
    }

    function normalizeGalleryMeta(data) {
        const mediaId = data.media_id || null;
        const rawPages = Array.isArray(data.pages)
            ? data.pages
            : (Array.isArray(data.images?.pages) ? data.images.pages : []);
        const pages = rawPages.map((page, index) => {
            if (page && typeof page.path === 'string') {
                return {
                    number: Number(page.number) || (index + 1),
                    path: page.path,
                    width: Number(page.width) || 0,
                    height: Number(page.height) || 0,
                    thumbnail: page.thumbnail || '',
                    thumbnailWidth: Number(page.thumbnail_width) || 0,
                    thumbnailHeight: Number(page.thumbnail_height) || 0
                };
            }

            const ext = EXT_MAP[page?.t] || 'jpg';
            return {
                number: index + 1,
                path: mediaId ? `galleries/${mediaId}/${index + 1}.${ext}` : '',
                width: Number(page?.w || page?.width) || 0,
                height: Number(page?.h || page?.height) || 0,
                thumbnail: mediaId ? `galleries/${mediaId}/${index + 1}t.${ext}` : '',
                thumbnailWidth: Number(page?.tw || page?.thumbnail_width) || 0,
                thumbnailHeight: Number(page?.th || page?.thumbnail_height) || 0
            };
        }).filter(Boolean);

        const tagIds = normalizeGalleryTagIds(data);
        return {
            galleryId: data.id || null,
            mediaId,
            pages,
            total: Number(data.num_pages || data.total_pages) || pages.length,
            tag_ids: tagIds,
            tagIds,
            blacklisted: data.blacklisted === true,
            tags: Array.isArray(data.tags) ? data.tags : [],
            title: data.title?.english || data.title?.japanese || data.title?.pretty || data.english_title || data.japanese_title || ''
        };
    }

    function getGalleryNodeId(gallery) {
        if (!gallery) return '';
        const cover = gallery.querySelector?.(GALLERY_SELECTORS.coverLink);
        const href = cover?.getAttribute?.('href') || cover?.href || '';
        const match = String(href || '').match(/\/g\/(\d+)\//);
        return match ? match[1] : '';
    }

    function getGalleryNodeListMeta(gallery) {
        const id = getGalleryNodeId(gallery);
        if (!id) return null;
        const data = NhentaiUserscriptBridge.getData();
        const entries = Array.isArray(data?.galleries) ? data.galleries : [];
        const entry = entries.find(item => String(item?.id || '') === id);
        return entry ? normalizeGalleryMeta(entry) : null;
    }

    function syncGalleryNodeMetaState(gallery) {
        const meta = getGalleryNodeListMeta(gallery);
        if (!gallery || !meta) return null;

        if (Array.isArray(meta.tag_ids) && meta.tag_ids.length) {
            gallery.dataset.nhTagIds = meta.tag_ids.join(' ');
        } else {
            delete gallery.dataset.nhTagIds;
        }
        if (meta.blacklisted === true) {
            gallery.dataset.nhBlacklisted = 'true';
        } else if (gallery.dataset.nhBlacklisted === 'true') {
            delete gallery.dataset.nhBlacklisted;
        }
        return meta;
    }

    function resolveGalleryLanguageMatch(gallery, langIds = []) {
        if (!gallery) return true;

        const legacyTags = (gallery.getAttribute('data-tags') || '').split(/\s+/).filter(Boolean);
        const metaTags = (gallery.dataset?.nhTagIds || '').split(/\s+/).filter(Boolean);
        const tagIds = Array.from(new Set([...legacyTags, ...metaTags]));
        return langIds.some(id => {
            if (tagIds.includes(id)) return true;
            const classNames = LANG_CLASS_MAP[id] || [];
            return classNames.some(className => gallery.classList.contains(className));
        });
    }

    function resolvePreviewImageUrl(meta, pageData) {
        if (pageData?.path) {
            return buildImageCandidateUrls(pageData.path)[0] || '';
        }
        if (!meta?.mediaId || !pageData?.number) return '';
        const ext = EXT_MAP[pageData.t] || 'jpg';
        const path = `galleries/${meta.mediaId}/${pageData.number}.${ext}`;
        return buildImageCandidateUrls(path)[0] || '';
    }

    // ===== 3.6 标签命名空间辅助与样式注入 =====
    function detectTagNamespaceFromText(text = '') {
        const normalizedText = String(text).toLowerCase();
        if (normalizedText.includes('parodies') || normalizedText.includes('原作')) return 'parody';
        if (normalizedText.includes('characters') || normalizedText.includes('角色')) return 'character';
        if (normalizedText.includes('artists') || normalizedText.includes('作者')) return 'artist';
        if (normalizedText.includes('groups') || normalizedText.includes('社团')) return 'group';
        if (normalizedText.includes('languages') || normalizedText.includes('语言')) return 'language';
        return 'tag';
    }

    function detectTagNamespaceFromHref(href = '', fallbackNs = null) {
        if (fallbackNs && !href.includes('/g/')) return fallbackNs;
        if (href.includes('/artist/') || href.includes('/artists/')) return 'artist';
        if (href.includes('/character/') || href.includes('/characters/')) return 'character';
        if (href.includes('/parody/') || href.includes('/parodies/')) return 'parody';
        if (href.includes('/group/') || href.includes('/groups/')) return 'group';
        if (href.includes('/language/') || href.includes('/languages/')) return 'language';
        if (href.includes('/category/') || href.includes('/categories/')) return 'tag';
        if (href.includes('/tag/') || href.includes('/tags/')) return 'tag';
        return fallbackNs || 'tag';
    }

    const Styles = {
        base: `
        :root {
            --nh-color-bg: #1f1f1f;
            --nh-color-bg-elevated: #252525;
            --nh-color-bg-muted: #2b2b2b;
            --nh-color-bg-strong: #222;
            --nh-color-bg-hover: #2f2f2f;
            --nh-color-border: #333;
            --nh-color-border-strong: #3e3e3e;
            --nh-color-text: #f1f1f1;
            --nh-color-text-soft: #ccc;
            --nh-color-text-muted: #aaa;
            --nh-color-text-subtle: #888;
            --nh-color-accent: #ed2553;
            --nh-color-accent-hover: #c01c42;
            --nh-color-accent-soft: rgba(237, 37, 83, 0.1);
            --nh-color-danger: #d92020;
            --nh-focus-ring: rgba(237, 37, 83, 0.45);
            --nh-shadow-sm: 0 4px 8px rgba(0,0,0,0.5);
            --nh-shadow-md: 0 5px 15px rgba(0,0,0,0.5);
            --nh-shadow-lg: 0 10px 25px rgba(0,0,0,0.8);
            --nh-radius-sm: 4px;
            --nh-radius-md: 6px;
            --nh-radius-lg: 8px;
            --nh-font-size-sm: 12px;
            --nh-font-size-md: 13px;
            --nh-font-size-lg: 14px;
            --nh-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        }

        .nh-helper-suggestion-box { position: absolute; background: var(--nh-color-bg); border: 1px solid var(--nh-color-border); border-top: none; font-size: var(--nh-font-size-lg); color: var(--nh-color-text); z-index: 1001; width: 100%; max-height: 300px; overflow-y: auto; box-shadow: 0 8px 16px rgba(0,0,0,0.6); border-radius: 0 0 5px 5px; }
        .nh-helper-suggestion-box::-webkit-scrollbar { width: 6px; }
        .nh-helper-suggestion-box::-webkit-scrollbar-thumb { background: var(--nh-color-border); border-radius: 3px; }
        form[action="/search/"].nh-helper-cn-suggestion-active > [role="listbox"] { display: none !important; }
        .nh-helper-suggestion-item { padding: 6px 12px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 1px solid var(--nh-color-bg-elevated); display: flex; align-items: center; transition: background-color 0.1s; }
        .nh-helper-suggestion-item:hover, .nh-helper-suggestion-item.active { background-color: var(--nh-color-accent); color: #fff; }
        body.nh-shift-pressed .nh-helper-suggestion-item:hover, body.nh-shift-pressed .nh-helper-suggestion-item.active { background-color: var(--nh-color-danger); }
        body.nh-shift-pressed .nh-helper-suggestion-item:hover::after { content: " (排除)"; font-size: 10px; margin-left: auto; opacity: 0.8; }
        .nh-helper-loading { padding: 10px; text-align: center; color: var(--nh-color-text-subtle); font-style: italic; }
        .nh-helper-suggestion-item .type-badge { display: inline-block; font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: var(--nh-radius-sm); background: var(--nh-color-border); color: var(--nh-color-text-muted); margin-right: 10px; width: 70px; text-align: center; text-transform: uppercase; flex-shrink: 0; }
        .nh-helper-suggestion-item:hover .type-badge, .nh-helper-suggestion-item.active .type-badge { background: rgba(0,0,0,0.2); color: #fff; }
        .nh-helper-suggestion-item .content-wrapper { flex-grow: 1; overflow: hidden; text-overflow: ellipsis; }
        .nh-helper-suggestion-item .meta { font-size: var(--nh-font-size-sm); opacity: 0.6; margin-left: 8px; }
        .nh-helper-suggestion-item:hover .meta { opacity: 0.9; color: #eee; }

        #nh-helper-quick-tags { display: none; position: absolute; top: 100%; left: 0; right: 0; z-index: 1000; background-color: var(--nh-color-bg); border: 1px solid var(--nh-color-border); border-top: none; box-shadow: var(--nh-shadow-sm); border-radius: 0 0 5px 5px; gap: 8px; flex-wrap: wrap; padding: 8px; animation: fadeIn 0.2s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
        .nh-helper-tag-btn { padding: 5px 12px; font-size: var(--nh-font-size-sm); background: var(--nh-color-bg-muted); border: 1px solid var(--nh-color-border-strong); border-radius: 15px; cursor: pointer; color: #bbb; transition: all 0.2s; }
        .nh-helper-tag-btn:hover { background: var(--nh-color-accent); border-color: var(--nh-color-accent); color: #fff; }
        body.nh-shift-pressed .nh-helper-tag-btn:hover { background: var(--nh-color-danger); border-color: var(--nh-color-danger); }
        body.nh-shift-pressed .nh-helper-tag-btn:hover::after { content: " (-)"; }

        .nh-translated-tag { font-size: 90%; color: var(--nh-color-text-muted); margin-left: 4px; }
        .nh-original-tag { font-size: 90%; color: var(--nh-color-text-muted); margin-left: 4px; }
        .nh-inline-subtag { font-size: 85%; opacity: 0.7; margin-left: 2px; }
        .tag:hover .nh-translated-tag, .tag:hover .nh-original-tag { color: rgba(255,255,255,0.8); }
        #nh-db-status { font-size: var(--nh-font-size-sm); color: var(--nh-color-accent); margin-left: 10px; display: inline-block; }
        #nh-toast-root { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 10100; display: flex; flex-direction: column; align-items: center; gap: 8px; width: max-content; max-width: calc(100vw - 32px); pointer-events: none; }
        .nh-toast { padding: 9px 16px; border-radius: var(--nh-radius-md); background: rgba(20,20,20,0.94); color: var(--nh-color-text); border: 1px solid var(--nh-color-border-strong); box-shadow: var(--nh-shadow-md); font-family: var(--nh-font-family); font-size: var(--nh-font-size-md); line-height: 1.4; animation: fadeIn 0.2s ease-out; }
        .nh-toast-error { color: #ffd3dd; border-color: rgba(255, 99, 132, 0.55); }

        /* ===== Settings modal (preference sheet) ===== */
        #nh-settings-overlay {
            position: fixed; inset: 0; z-index: 9999;
            display: flex; justify-content: center; align-items: center;
            padding: 20px 12px;
            background:
                radial-gradient(1200px 500px at 50% -10%, rgba(237, 37, 83, 0.18), transparent 55%),
                rgba(8, 8, 10, 0.72);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            animation: nh-settings-fade-in 0.16s ease-out;
        }
        @keyframes nh-settings-fade-in {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        #nh-settings-modal {
            --nh-settings-pad-x: 20px;
            width: min(96vw, 560px);
            max-height: min(88vh, 760px);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-sizing: border-box;
            color: var(--nh-color-text);
            font-family: var(--nh-font-family);
            border-radius: 18px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            background:
                linear-gradient(180deg, rgba(42, 28, 34, 0.55) 0%, rgba(24, 24, 26, 0) 120px),
                linear-gradient(180deg, #1c1c1f 0%, #161618 100%);
            box-shadow:
                0 0 0 1px rgba(237, 37, 83, 0.08),
                0 28px 80px rgba(0, 0, 0, 0.55),
                0 2px 0 rgba(255, 255, 255, 0.04) inset;
            animation: nh-settings-pop-in 0.18s ease-out;
        }
        @keyframes nh-settings-pop-in {
            from { opacity: 0; transform: translateY(10px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
            #nh-settings-overlay,
            #nh-settings-modal { animation: none; }
            .nh-tab-content { animation: none !important; }
        }
        #nh-settings-modal h3 {
            margin: 0;
            border: none;
            color: #fff;
            font-size: 18px;
            font-weight: 700;
            letter-spacing: 0.01em;
            line-height: 1.25;
        }
        .nh-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
            flex: 0 0 auto;
            padding: 18px var(--nh-settings-pad-x) 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            background: linear-gradient(180deg, rgba(255,255,255,0.02), transparent);
        }
        .nh-modal-header-main {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 0;
        }
        .nh-modal-eyebrow {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            color: #ff7a9a;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }
        .nh-modal-eyebrow::before {
            content: "";
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: var(--nh-color-accent);
            box-shadow: 0 0 0 3px rgba(237, 37, 83, 0.22);
        }
        .nh-modal-header .version {
            font-size: 11px;
            font-weight: 600;
            color: #8a8a92;
            font-variant-numeric: tabular-nums;
            padding: 3px 8px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.06);
        }
        .nh-modal-tools { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
        .nh-lang-switch-btn {
            padding: 5px 10px !important;
            font-size: 11px !important;
            font-weight: 700 !important;
            border-radius: 999px !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            background: rgba(255, 255, 255, 0.05) !important;
            color: #ddd !important;
        }
        .nh-lang-switch-btn:hover {
            background: rgba(237, 37, 83, 0.16) !important;
            border-color: rgba(237, 37, 83, 0.35) !important;
            color: #fff !important;
        }

        .nh-tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            flex: 0 0 auto;
            margin: 0;
            padding: 12px var(--nh-settings-pad-x) 10px;
            overflow: visible;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            background: rgba(0, 0, 0, 0.12);
        }
        .nh-tab-btn {
            flex: 1 1 calc(33.333% - 6px);
            min-width: 0;
            max-width: 100%;
            padding: 7px 8px;
            border: 1px solid transparent;
            border-radius: 999px;
            background: transparent;
            color: #9a9aa3;
            cursor: pointer;
            font-size: 12px;
            font-weight: 700;
            line-height: 1.2;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .nh-tab-btn:hover {
            color: #f0f0f3;
            background: rgba(255, 255, 255, 0.05);
        }
        .nh-tab-btn.active {
            color: #fff;
            background: linear-gradient(180deg, rgba(237, 37, 83, 0.95), rgba(196, 24, 64, 0.95));
            border-color: rgba(255, 255, 255, 0.08);
            box-shadow: 0 6px 16px rgba(237, 37, 83, 0.28);
        }
        .nh-tab-btn:focus-visible {
            outline: 2px solid var(--nh-color-accent);
            outline-offset: 2px;
        }

        .nh-modal-body {
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 14px var(--nh-settings-pad-x) 8px;
            scrollbar-width: thin;
            scrollbar-color: rgba(255,255,255,0.14) transparent;
        }
        .nh-modal-body::-webkit-scrollbar { width: 8px; }
        .nh-modal-body::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.12);
            border-radius: 999px;
            border: 2px solid transparent;
            background-clip: padding-box;
        }
        .nh-tab-content { display: none; animation: fadeIn 0.16s ease-out; }
        .nh-tab-content.active { display: block; }

        .nh-setting-group-title {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 16px 0 10px;
            padding: 0 2px;
            border: none;
            background: none;
            color: #ff8aaa;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            text-align: left;
        }
        .nh-setting-group-title:first-child { margin-top: 2px; }
        .nh-setting-group-title::before {
            content: "";
            width: 3px;
            height: 12px;
            border-radius: 999px;
            background: var(--nh-color-accent);
            box-shadow: 0 0 0 3px rgba(237, 37, 83, 0.16);
        }

        .nh-setting-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 14px;
            margin: 0 0 8px;
            padding: 12px 14px;
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 12px;
            background: linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015));
            transition: border-color 0.15s ease, background 0.15s ease;
        }
        .nh-setting-item:hover {
            border-color: rgba(237, 37, 83, 0.22);
            background: linear-gradient(180deg, rgba(237, 37, 83, 0.08), rgba(255,255,255,0.02));
        }
        .nh-setting-item-compact {
            margin: 0 0 8px;
            padding: 10px 12px;
            background: rgba(0, 0, 0, 0.16);
        }
        .nh-setting-content {
            text-align: left;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 3px;
            min-width: 0;
            flex: 1 1 auto;
            max-width: none;
        }
        .nh-setting-label {
            font-size: 14px;
            line-height: 1.35;
            font-weight: 650;
            color: #f7f7f8;
        }
        .nh-info-text {
            color: #8f8f98;
            font-size: 12px;
            line-height: 1.45;
            margin-top: 0;
        }

        .nh-setting-sub-group {
            margin: 0 0 8px;
            padding: 10px;
            background: rgba(0, 0, 0, 0.18);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 12px;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .nh-setting-sub-group-3 { display: flex; flex-wrap: wrap; }
        .nh-setting-sub-item {
            display: inline-flex;
            align-items: center;
            gap: 0;
            margin: 0;
            padding: 7px 12px;
            border-radius: 999px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            background: rgba(255, 255, 255, 0.04);
            color: #cfcfd6;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            user-select: none;
            transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
        }
        .nh-setting-sub-item:hover {
            border-color: rgba(237, 37, 83, 0.35);
            color: #fff;
        }
        .nh-setting-sub-item:has(input:checked) {
            background: rgba(237, 37, 83, 0.18);
            border-color: rgba(237, 37, 83, 0.45);
            color: #fff;
        }
        .nh-setting-sub-item input {
            position: absolute;
            opacity: 0;
            width: 0;
            height: 0;
            pointer-events: none;
        }

        .nh-switch {
            position: relative;
            display: inline-block;
            width: 44px;
            height: 26px;
            flex: 0 0 auto;
        }
        .nh-switch input { opacity: 0; width: 0; height: 0; }
        .nh-slider {
            position: absolute;
            cursor: pointer;
            inset: 0;
            background: #3a3a42;
            border: 1px solid rgba(255,255,255,0.06);
            transition: background 0.18s ease, box-shadow 0.18s ease;
            border-radius: 999px;
        }
        .nh-slider:before {
            position: absolute;
            content: "";
            height: 20px;
            width: 20px;
            left: 2px;
            top: 2px;
            background: #fff;
            transition: transform 0.18s ease;
            border-radius: 50%;
            box-shadow: 0 1px 3px rgba(0,0,0,0.35);
        }
        input:checked + .nh-slider {
            background: linear-gradient(180deg, #f03a64, #d61d4e);
            border-color: transparent;
            box-shadow: 0 0 0 3px rgba(237, 37, 83, 0.14);
        }
        input:checked + .nh-slider:before { transform: translateX(18px); }

        .nh-select {
            background: var(--nh-color-bg-muted);
            color: #f4f4f4;
            border: 1px solid var(--nh-color-border);
            padding: 4px 10px;
            border-radius: var(--nh-radius-sm);
            outline: none;
            font-size: var(--nh-font-size-md);
            color-scheme: dark;
        }
        .nh-select:focus { border-color: var(--nh-color-accent); }
        .nh-select option { background: #2a2a2a; color: #f4f4f4; }

        .nh-settings-actions {
            display: flex;
            justify-content: flex-end;
            align-items: center;
            gap: 10px;
            flex: 0 0 auto;
            margin: 0;
            padding: 14px var(--nh-settings-pad-x) 16px;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
            background: linear-gradient(180deg, rgba(0,0,0,0.08), rgba(0,0,0,0.22));
        }
        .nh-btn {
            padding: 9px 16px;
            border-radius: 10px;
            border: none;
            cursor: pointer;
            font-size: 13px;
            font-weight: 700;
            transition: background 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease;
        }
        .nh-btn:active { transform: translateY(1px); }
        .nh-btn-primary {
            background: linear-gradient(180deg, #f03a64, #d61d4e);
            color: white;
            margin-left: 0;
            box-shadow: 0 8px 18px rgba(237, 37, 83, 0.28);
        }
        .nh-btn-primary:hover { background: linear-gradient(180deg, #ff4b72, #e02055); }
        .nh-btn-secondary {
            background: rgba(255, 255, 255, 0.06);
            color: #d8d8de;
            border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .nh-btn-secondary:hover {
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
        }
        .nh-force-update-wrap { margin: 12px 0 4px; text-align: center; }
        .nh-btn-block {
            width: 100%;
            font-size: 13px;
            padding: 11px 14px;
            border-radius: 12px;
        }
        .nh-api-key-card {
            margin: 0 0 8px;
            padding: 14px;
            border: 1px solid rgba(255, 255, 255, 0.07);
            border-radius: 14px;
            background:
                linear-gradient(180deg, rgba(237, 37, 83, 0.08), transparent 48%),
                rgba(0, 0, 0, 0.18);
        }
        .nh-api-key-content { max-width: none; margin-bottom: 10px; }
        .nh-password-input {
            width: 100%;
            box-sizing: border-box;
            padding: 10px 12px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 10px;
            background: rgba(0, 0, 0, 0.28);
            color: var(--nh-color-text);
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            font-size: 13px;
        }
        .nh-password-input:focus {
            outline: none;
            border-color: rgba(237, 37, 83, 0.55);
            box-shadow: 0 0 0 3px rgba(237, 37, 83, 0.16);
        }
        .nh-api-key-status {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-top: 10px;
            color: #9a9aa3;
            font-size: 12px;
        }
        .nh-api-key-status strong { color: #f0f0f3; font-weight: 700; }
        .nh-api-key-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        .nh-api-key-actions .nh-btn { margin-left: 0; }
        .nh-api-key-message {
            min-height: 16px;
            margin-top: 10px;
            color: #8f8f98;
            font-size: 12px;
        }
        .nh-api-key-message[data-state="success"] { color: #8bdc9b; }
        .nh-api-key-message[data-state="failure"] { color: #ff9a9a; }

        .nh-quicktags-list {
            margin: 0 0 10px;
            padding: 12px;
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-left: 3px solid rgba(237, 37, 83, 0.55);
            border-radius: 12px;
            background: rgba(0, 0, 0, 0.16);
        }
        .nh-quicktags-list.is-hidden { display: none; }
        .nh-quicktags-label {
            font-size: 12px;
            color: #8f8f98;
            margin-bottom: 8px;
            font-weight: 600;
        }
        .nh-preview-popup-settings {
            margin: 0 0 10px;
            padding: 12px;
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-left: 3px solid rgba(237, 37, 83, 0.45);
            background: rgba(0, 0, 0, 0.16);
            border-radius: 12px;
        }
        .nh-preview-popup-settings.is-hidden { display: none; }

        .nh-setting-control {
            display: inline-flex;
            align-items: center;
            justify-content: flex-end;
            min-width: 108px;
            min-height: 36px;
            padding: 0 10px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 10px;
            background: rgba(0, 0, 0, 0.22);
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
            flex: 0 0 auto;
        }
        .nh-setting-control-select {
            position: relative;
            min-width: 148px;
            max-width: 200px;
            padding-right: 30px;
        }
        .nh-setting-control-select::after {
            content: "";
            position: absolute;
            right: 12px;
            top: 50%;
            width: 7px;
            height: 7px;
            border-right: 2px solid rgba(255,255,255,0.55);
            border-bottom: 2px solid rgba(255,255,255,0.55);
            transform: translateY(-62%) rotate(45deg);
            pointer-events: none;
        }
        .nh-setting-unit {
            margin-left: 6px;
            color: #8f8f98;
            font-size: 12px;
            font-weight: 700;
        }
        .nh-number-input {
            width: 56px;
            padding: 2px 0;
            border: none;
            background: transparent;
            color: #fff;
            font-size: 16px;
            line-height: 1;
            font-weight: 700;
            text-align: right;
            font-variant-numeric: tabular-nums;
            appearance: textfield;
            -moz-appearance: textfield;
        }
        .nh-number-input:focus { outline: none; }
        .nh-number-input::-webkit-outer-spin-button,
        .nh-number-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .nh-setting-control:focus-within {
            border-color: rgba(237, 37, 83, 0.55);
            box-shadow: 0 0 0 3px rgba(237, 37, 83, 0.14), inset 0 1px 0 rgba(255,255,255,0.03);
        }
        .nh-setting-control .nh-select {
            width: 100%;
            border: none;
            background: transparent;
            padding: 2px 0;
            min-width: 100px;
            text-align: right;
            color: #fff;
            -webkit-text-fill-color: #fff;
            appearance: none;
            font-weight: 650;
            font-size: 13px;
        }
        .nh-setting-control .nh-select:focus { border-color: transparent; }

        #nh-web-settings-btn { display: inline-block; vertical-align: middle; }
        ul.menu.left { display: flex !important; flex-wrap: nowrap !important; align-items: center !important; float: left; height: 45px; }
        ul.menu.left > li:not(.dropdown) { display: flex; align-items: center; height: 100%; }
        ul.menu.left > li.dropdown { position: relative; display: flex; align-items: center; height: 100%; }
        ul.menu.left > li.dropdown > .dropdown-menu {
            display: none !important;
            position: absolute;
            top: calc(100% + 4px);
            right: 0;
            min-width: 140px;
            z-index: 1005;
            white-space: nowrap;
        }
        ul.menu.left > li.dropdown:hover > .dropdown-menu,
        ul.menu.left > li.dropdown:focus-within > .dropdown-menu {
            display: block !important;
        }
        ul.menu.left > li.dropdown > .dropdown-menu > li {
            display: block;
            height: auto;
        }
        #nh-web-settings-btn a { display: flex; align-items: center; height: 100%; color: rgb(217, 217, 217); text-decoration: none; font-weight: bold; padding: 0 15px; transition: color 0.2s; }
        #nh-web-settings-btn a:hover { color: var(--nh-color-text); }
        #nh-web-settings-btn i { margin-right: 5px; font-size: var(--nh-font-size-lg); }

        .nh-lang-container { position: relative; margin-left: 10px; margin-right: 5px; z-index: 1002; }
        .nh-lang-btn { background-color: var(--nh-color-bg-strong); color: rgb(217, 217, 217); border: 1px solid var(--nh-color-border); border-radius: var(--nh-radius-sm); padding: 5px 10px; font-size: var(--nh-font-size-md); font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: space-between; min-width: 90px; transition: all 0.2s; }
        .nh-lang-btn:hover, .nh-lang-btn.active { background-color: var(--nh-color-bg-hover); border-color: var(--nh-color-accent); color: #fff; }
        .nh-lang-arrow { margin-left: 8px; font-size: 10px; color: var(--nh-color-accent); }
        .nh-lang-menu { position: absolute; top: 100%; right: 0; margin-top: 5px; background-color: var(--nh-color-bg); border: 1px solid var(--nh-color-border); border-radius: var(--nh-radius-sm); box-shadow: var(--nh-shadow-md); display: none; flex-direction: column; min-width: 120px; overflow: hidden; }
        .nh-lang-menu.show { display: flex; }
        .nh-lang-item { padding: 8px 12px; cursor: pointer; display: flex; align-items: center; color: var(--nh-color-text-soft); font-size: var(--nh-font-size-md); transition: background 0.1s; user-select: none; }
        .nh-lang-item:hover { background-color: var(--nh-color-bg-hover); color: #fff; }
        .nh-lang-item.selected { color: var(--nh-color-accent); font-weight: bold; background-color: var(--nh-color-accent-soft); }
        .nh-lang-checkbox { width: 14px; height: 14px; border: 1px solid #555; border-radius: 2px; margin-right: 8px; display: flex; align-items: center; justify-content: center; transition: all 0.1s; }
        .nh-lang-item.selected .nh-lang-checkbox { background-color: var(--nh-color-accent); border-color: var(--nh-color-accent); }
        .nh-lang-item.selected .nh-lang-checkbox::after { content: "✓"; color: #fff; font-size: 10px; line-height: 1; }
        .nh-helper-hidden { display: none !important; }
        .gallery.blacklisted,
        .gallery.nh-site-blacklisted {
            display: none !important;
        }
        .nh-page-number { position: absolute; top: 5px; right: 5px; background-color: rgba(0,0,0,0.6); color: #fff; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: bold; z-index: 10; pointer-events: none; }
        .nh-scroll-page-marker {
            width: fit-content;
            min-width: 96px;
            margin: 12px auto 14px;
            padding: 4px 14px;
            border-radius: 999px;
            background: linear-gradient(180deg, rgba(35,35,35,0.95), rgba(22,22,22,0.95));
            color: #fff;
            border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 6px 14px rgba(0,0,0,0.35);
            font-size: 12px;
            font-weight: bold;
            text-align: center;
            letter-spacing: 0.4px;
        }
        #nh-infinite-sentinel {
            margin: 16px auto 10px;
            padding: 10px 14px;
            width: min(100%, 420px);
            text-align: center;
            color: var(--nh-color-text-soft);
            font-size: var(--nh-font-size-md);
            background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015));
            border: 1px solid var(--nh-color-border);
            border-radius: var(--nh-radius-md);
            box-shadow: var(--nh-shadow-sm);
        }
        #nh-infinite-sentinel.is-loading {
            color: #fff;
            border-color: rgba(237, 37, 83, 0.45);
        }
        #nh-infinite-sentinel.is-loading::after {
            content: "";
            display: block;
            width: 24px;
            height: 24px;
            margin: 10px auto 0;
            border-radius: 999px;
            border: 2px solid rgba(255,255,255,0.15);
            border-top-color: var(--nh-color-accent);
            animation: nh-infinite-spin 0.8s linear infinite;
        }
        #nh-infinite-sentinel.is-error {
            color: #ffd3dd;
            border-color: rgba(255, 99, 132, 0.4);
        }
        #nh-infinite-sentinel.is-done {
            color: var(--nh-color-text-muted);
            opacity: 0.85;
        }
        @keyframes nh-infinite-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        /* detail / blacklist tools (settings modal styles defined above) */
        .nh-detail-tag-tools { display: inline-flex; align-items: center; gap: 4px; margin-left: 4px; }
        .nh-tag-blacklist-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            margin-left: 4px;
            border: none;
            border-radius: 999px;
            background: rgba(255,255,255,0.06);
            color: var(--nh-color-text-subtle);
            cursor: pointer;
            vertical-align: middle;
            transition: background-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;
        }
        .nh-tag-blacklist-btn:hover {
            background: rgba(237, 37, 83, 0.15);
            color: var(--nh-color-accent);
        }
        .nh-tag-blacklist-btn.is-blacklisted {
            background: rgba(237, 37, 83, 0.16);
            color: var(--nh-color-accent);
        }
        .nh-tag-blacklist-btn.is-loading,
        .nh-tag-blacklist-btn:disabled {
            opacity: 0.7;
            cursor: wait;
        }
        .nh-tag-blacklist-btn i {
            font-size: 10px;
            line-height: 1;
            pointer-events: none;
        }
        .nh-blacklist-filter-bar {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin: 12px 0 10px;
        }
        .nh-blacklist-filter-btn {
            padding: 4px 10px;
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 999px;
            background: rgba(255,255,255,0.04);
            color: var(--nh-color-text-soft);
            cursor: pointer;
            font-size: 12px;
            line-height: 1.2;
            transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
        }
        .nh-blacklist-filter-btn:hover {
            background: rgba(255,255,255,0.08);
            color: #fff;
        }
        .nh-blacklist-filter-btn.is-active {
            background: rgba(237, 37, 83, 0.14);
            border-color: rgba(237, 37, 83, 0.45);
            color: var(--nh-color-accent);
        }
        .nh-blacklist-filter-count {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 18px;
            height: 18px;
            margin-left: 6px;
            padding: 0 5px;
            border-radius: 999px;
            background: rgba(255,255,255,0.08);
            color: inherit;
            font-size: 11px;
            line-height: 1;
        }
        .nh-blacklist-filter-empty {
            margin: 8px 0 0;
            color: var(--nh-color-text-subtle);
            font-size: 12px;
        }
        .nh-reading-mode-entry {
            position: relative;
        }
        .nh-reading-mode-entry.is-loading {
            opacity: 0.75;
            pointer-events: none;
        }
        .nh-number-input {
            width: 96px;
            padding: 5px 8px;
            background: var(--nh-color-bg-muted);
            color: var(--nh-color-text);
            border: 1px solid var(--nh-color-border);
            border-radius: var(--nh-radius-sm);
            outline: none;
            font-size: var(--nh-font-size-md);
            text-align: right;
            box-sizing: border-box;
        }
        .nh-number-input:focus {
            border-color: var(--nh-color-accent);
        }
        .nh-reading-open,
        .nh-reading-open body {
            overflow: hidden !important;
        }
        #nh-reading-overlay {
            position: fixed;
            inset: 0;
            z-index: 10060;
            background: rgba(10, 10, 10, 0.96);
            color: var(--nh-color-text);
            font-family: var(--nh-font-family);
        }
        .nh-reading-shell {
            position: relative;
            width: 100%;
            height: 100%;
        }
        .nh-reading-main {
            position: relative;
            width: 100%;
            height: 100%;
        }
        .nh-reading-topbar {
            position: absolute;
            top: 10px;
            left: 12px;
            right: 18px;
            z-index: 6;
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
            pointer-events: none;
        }
        .nh-reading-meta {
            min-width: 0;
            max-width: min(58vw, 560px);
            padding: 0;
            border: none;
            background: none;
            box-shadow: none;
            backdrop-filter: none;
        }
        .nh-reading-title {
            font-size: 13px;
            font-weight: 600;
            color: #fff;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1.2;
            text-shadow: 0 2px 10px rgba(0,0,0,0.75);
        }
        .nh-reading-status {
            margin-top: 3px;
            color: rgba(255,255,255,0.78);
            font-size: 10px;
            line-height: 1.2;
            text-shadow: 0 2px 10px rgba(0,0,0,0.75);
        }
        .nh-reading-actions {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 0 0 auto;
            pointer-events: auto;
        }
        .nh-reading-close {
            padding: 6px 11px;
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 999px;
            background: rgba(18,18,18,0.72);
            color: #fff;
            cursor: pointer;
            font-size: 11px;
            line-height: 1;
            box-shadow: 0 8px 20px rgba(0,0,0,0.16);
            backdrop-filter: blur(8px);
            transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
        }
        .nh-reading-close:hover {
            background: rgba(255,255,255,0.10);
            border-color: rgba(255,255,255,0.18);
            transform: translateY(-1px);
        }
        .nh-reading-scroller {
            height: 100%;
            overflow-y: auto;
            overscroll-behavior: contain;
            padding: 12px 0 24px;
            scrollbar-width: none;
            -ms-overflow-style: none;
        }
        .nh-reading-scroller::-webkit-scrollbar {
            width: 0;
            height: 0;
        }
        .nh-reading-pages {
            width: min(100%, var(--nh-reading-max-width, 1360px));
            margin: 0 auto;
            padding: 0 clamp(8px, 1vw, 14px);
            box-sizing: border-box;
        }
        .nh-reading-page {
            position: relative;
            margin: 0 0 var(--nh-reading-gap, 10px);
        }
        .nh-reading-page:last-child {
            margin-bottom: 0;
        }
        .nh-reading-page img {
            display: block;
            width: 100%;
            height: auto;
            min-height: 120px;
            margin: 0 auto;
            border-radius: 2px;
            background: rgba(255,255,255,0.015);
            box-shadow: none;
        }
        .nh-reading-tools {
            position: absolute;
            left: 0;
            top: 50%;
            z-index: 5;
            display: flex;
            flex-direction: column;
            gap: 10px;
            width: 86px;
            padding: 10px 10px 10px 8px;
            border-radius: 0 14px 14px 0;
            background: rgba(18,18,18,0.58);
            border: 1px solid rgba(255,255,255,0.08);
            border-left: none;
            box-shadow: 0 10px 24px rgba(0,0,0,0.12);
            backdrop-filter: blur(8px);
            transform: translateY(-50%) translateX(-8px);
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.15s ease, transform 0.15s ease, background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
        }
        #nh-reading-overlay.is-tools-visible .nh-reading-tools,
        .nh-reading-tools:focus-within,
        .nh-reading-tools:hover {
            opacity: 1;
            pointer-events: auto;
            transform: translateY(-50%);
            background: rgba(18,18,18,0.82);
            border-color: rgba(255,255,255,0.12);
            box-shadow: 0 12px 28px rgba(0,0,0,0.18);
        }
        .nh-reading-tool-field {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        .nh-reading-tool-caption {
            color: rgba(255,255,255,0.72);
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }
        .nh-reading-tool-input-wrap {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 0 8px;
            height: 30px;
            border-radius: 999px;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.08);
        }
        .nh-reading-tool-input-wrap:focus-within {
            border-color: rgba(237, 37, 83, 0.65);
            background: rgba(255,255,255,0.1);
            box-shadow: 0 0 0 2px rgba(237, 37, 83, 0.16);
        }
        .nh-reading-tool-input {
            width: 100%;
            min-width: 0;
            padding: 0;
            border: none;
            background: transparent;
            color: #fff;
            font-size: 12px;
            line-height: 1;
            text-align: right;
            font-variant-numeric: tabular-nums;
            outline: none;
            appearance: textfield;
        }
        .nh-reading-tool-input::-webkit-outer-spin-button,
        .nh-reading-tool-input::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }
        .nh-reading-tool-unit {
            color: rgba(255,255,255,0.62);
            font-size: 11px;
            flex: 0 0 auto;
        }
        .nh-reading-page.is-loading img {
            opacity: 0.82;
            filter: saturate(0.9);
        }
        .nh-reading-page.is-error img {
            opacity: 0.45;
        }
        .nh-reading-page.is-error {
            cursor: pointer;
        }
        .nh-reading-page.is-error::after {
            content: attr(data-retry-text);
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            padding: 8px 14px;
            border-radius: var(--nh-radius-md);
            background: rgba(20,20,20,0.88);
            border: 1px solid rgba(255, 99, 132, 0.45);
            color: #ffd3dd;
            font-size: var(--nh-font-size-md);
            white-space: nowrap;
            pointer-events: none;
        }
        .nh-reading-scrollbar {
            position: absolute;
            top: 42px;
            right: 9px;
            bottom: 14px;
            width: 6px;
            padding: 0;
            overflow: visible;
            z-index: 2;
            touch-action: none;
            user-select: none;
        }
        .nh-reading-scrollbar-track {
            position: relative;
            width: 100%;
            height: 100%;
            padding: 0;
            border-radius: 999px;
            background: rgba(255,255,255,0.08);
            display: flex;
            flex-direction: column;
            gap: 0;
            overflow: hidden;
            box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05);
            backdrop-filter: blur(2px);
        }
        .nh-reading-scrollbar.is-dragging .nh-reading-scrollbar-track {
            box-shadow: inset 0 0 0 1px rgba(237, 37, 83, 0.45);
        }
        .nh-reading-scrollbar-popper {
            --nh-reading-scrollbar-popper-y: 0px;
            position: absolute;
            top: 0;
            right: 15px;
            min-width: 48px;
            padding: 4px 10px;
            border-radius: 6px;
            background: rgba(34,34,34,0.94);
            color: #fff;
            font-size: 11px;
            font-weight: 600;
            line-height: 1.3;
            text-align: center;
            white-space: nowrap;
            box-shadow: 0 8px 18px rgba(0,0,0,0.32);
            border: 1px solid rgba(255,255,255,0.08);
            opacity: 0;
            pointer-events: none;
            transform: translate3d(0, var(--nh-reading-scrollbar-popper-y), 0);
            transition: opacity 0.15s ease;
            z-index: 4;
        }
        .nh-reading-scrollbar-popper::after {
            content: "";
            position: absolute;
            top: 50%;
            right: -6px;
            width: 0;
            height: 0;
            border-top: 6px solid transparent;
            border-bottom: 6px solid transparent;
            border-left: 6px solid rgba(34,34,34,0.94);
            transform: translateY(-50%);
        }
        .nh-reading-scrollbar:hover .nh-reading-scrollbar-popper,
        .nh-reading-scrollbar.is-dragging .nh-reading-scrollbar-popper {
            opacity: 1;
        }
        .nh-reading-scrollbar-thumb {
            position: absolute;
            top: 0;
            left: -1px;
            width: 8px;
            min-height: 18px;
            border-radius: 999px;
            background: rgba(255,255,255,0.75);
            box-shadow: 0 2px 10px rgba(0,0,0,0.28);
            pointer-events: none;
            opacity: 0.28;
            transition: box-shadow 0.15s ease, background-color 0.15s ease, opacity 0.15s ease;
            z-index: 3;
        }
        .nh-reading-scrollbar:hover .nh-reading-scrollbar-thumb {
            opacity: 0.92;
        }
        .nh-reading-scrollbar.is-dragging .nh-reading-scrollbar-thumb {
            background: #fff;
            box-shadow: 0 2px 14px rgba(237, 37, 83, 0.45);
            opacity: 1;
        }
        .nh-reading-scrollbar-item {
            flex: 1 1 0;
            min-height: 3px;
            padding: 0;
            border: none;
            border-radius: 0;
            background: rgba(255,255,255,0.15);
            cursor: ns-resize;
            transition: background-color 0.15s ease, opacity 0.15s ease;
            appearance: none;
        }
        .nh-reading-scrollbar-item:hover {
            opacity: 0.95;
        }
        .nh-reading-scrollbar-item.is-active {
            background: var(--nh-color-accent);
            box-shadow: inset 0 0 0 1px rgba(255,255,255,0.55);
        }
        .nh-reading-scrollbar-item[data-state="wait"] {
            background: rgba(255,255,255,0.12);
        }
        .nh-reading-scrollbar-item[data-state="loading"] {
            background: rgba(237, 37, 83, 0.5);
        }
        .nh-reading-scrollbar-item[data-state="loaded"] {
            background: rgba(255,255,255,0.28);
        }
        .nh-reading-scrollbar-item[data-state="error"] {
            background: rgba(217, 32, 32, 0.75);
        }

        /* Preview Feature Styles */
        .gallery.is-previewing .cover { padding-bottom: 0 !important; height: auto !important; display: flex; flex-direction: column; }
        .gallery.is-previewing .cover img { position: relative !important; height: auto !important; width: 100% !important; max-height: none !important; object-fit: contain; }
        .inline-preview-ui { display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10; }
        .gallery:hover .inline-preview-ui, .gallery.is-previewing .inline-preview-ui { display: block; }
        .gallery { vertical-align: top !important; }
        .hotzone { position: absolute; top: 0; height: calc(100% - 15px); width: 40%; cursor: default; z-index: 20; }
        .hotzone-left { left: 0; } .hotzone-right { right: 0; }
        .seek-container { position: absolute; bottom: 0; left: 0; width: 100%; height: 20px; z-index: 40; cursor: pointer; display: flex; align-items: flex-end; }
        .seek-bg { width: 100%; height: 3px; background: rgba(255,255,255,0.2); transition: height 0.1s; position: relative; backdrop-filter: blur(2px); }
        .seek-container:hover .seek-bg { height: 15px; background: rgba(255,255,255,0.3); }
        .seek-fill { height: 100%; background: var(--nh-color-accent); width: 0%; transition: width 0.1s; }
        .seek-tooltip { position: absolute; bottom: 17px; transform: translateX(-50%); background: var(--nh-color-accent); color: #fff; font-size: 10px; padding: 2px 4px; border-radius: .3em; opacity: 0; pointer-events: none; white-space: nowrap; font-weight: bold; transition: opacity 0.1s; }
        .seek-container:hover .seek-tooltip { opacity: 1; }
        .tag-trigger { position: absolute; top: 5px; left: 5px; background: rgba(0,0,0,0.6); color: #fff; font-size: 10px; padding: 2px 6px; border-radius: .3em; cursor: help; z-index: 50; font-family: var(--nh-font-family); opacity: 0.7; border: 1px solid rgba(255,255,255,0.2); transition: all 0.2s; }
        .tag-trigger:hover { opacity: 1; background: var(--nh-color-accent); border-color: var(--nh-color-accent); }
        .tag-popup { display: none; position: absolute; top: 25px; left: 5px; width: 215px; max-height: 250px; overflow-y: auto; background: rgba(15,15,15,0.95); color: #ddd; border: 1px solid var(--nh-color-border); border-radius: .3em; padding: 8px; font-size: 11px; z-index: 60; box-shadow: var(--nh-shadow-sm); text-align: left; line-height: 1.4; }
        .tag-trigger:hover + .tag-popup, .tag-popup:hover { display: block; }
        .tag-category { color: var(--nh-color-accent); font-weight: bold; margin-bottom: 2px; margin-top: 6px; font-size: 10px; text-transform: uppercase; }
        .tag-category:first-child { margin-top: 0; }
        .tag-pill { display: inline-block; transition: all 0.2s; background: var(--nh-color-border); padding: 1px 4px; margin: 1px; border-radius: .3em; color: var(--nh-color-text-soft); }
        .nh-tag-popup-state { padding: 10px; text-align: center; color: var(--nh-color-text-subtle); font-style: italic; }
        .nh-empty-state { padding: 5px; color: var(--nh-color-text-subtle); }
        .nh-preview-popup {
            --nh-preview-popup-width: 34vw;
            --nh-preview-popup-max-height: 70vh;
            --nh-preview-popup-media-width: auto;
            --nh-preview-popup-media-height: var(--nh-preview-popup-max-height);
            position: fixed;
            top: 0;
            left: 0;
            width: min(var(--nh-preview-popup-width), calc(100vw - 24px));
            padding: 10px 10px 12px;
            border-radius: 14px;
            background: rgba(16,16,16,0.96);
            border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 18px 44px rgba(0,0,0,0.42);
            z-index: 10020;
            opacity: 0;
            pointer-events: none;
            transform: translate3d(0, 8px, 0) scale(0.98);
            transition: opacity 0.16s ease, transform 0.16s ease;
            backdrop-filter: blur(10px);
        }
        .nh-preview-popup.is-visible {
            opacity: 1;
            pointer-events: auto;
            transform: translate3d(0, 0, 0) scale(1);
        }
        .nh-preview-media {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            width: min(100%, var(--nh-preview-popup-media-width));
            height: var(--nh-preview-popup-media-height);
            margin: 0 auto;
            border-radius: 10px;
            background: linear-gradient(180deg, rgba(24,24,24,0.96), rgba(8,8,8,0.98));
        }
        .nh-preview-image {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: contain;
            background: #101010;
        }
        .nh-preview-image.is-empty {
            visibility: hidden;
        }
        .nh-preview-hotzone {
            position: absolute;
            top: 0;
            bottom: 0;
            width: 24%;
            border: none;
            padding: 0;
            background: transparent;
            cursor: pointer;
            z-index: 2;
        }
        .nh-preview-hotzone::before {
            content: "";
            position: absolute;
            inset: 0;
            opacity: 0;
            transition: opacity 0.18s ease;
        }
        .nh-preview-hotzone:hover::before,
        .nh-preview-hotzone:focus-visible::before {
            opacity: 1;
        }
        .nh-preview-hotzone-left { left: 0; }
        .nh-preview-hotzone-left::before { background: linear-gradient(90deg, rgba(0,0,0,0.34), transparent); }
        .nh-preview-hotzone-right { right: 0; }
        .nh-preview-hotzone-right::before { background: linear-gradient(270deg, rgba(0,0,0,0.34), transparent); }
        .nh-preview-popup .tag-trigger {
            top: 8px;
            left: 8px;
            z-index: 4;
        }
        .nh-preview-popup .tag-popup {
            top: 34px;
            left: 8px;
            width: min(320px, calc(100vw - 48px));
            max-height: 240px;
            z-index: 5;
        }
        .nh-preview-popup .seek-container {
            position: relative;
            left: auto;
            bottom: auto;
            width: 100%;
            height: 24px;
            margin-top: 10px;
            align-items: center;
        }
        .nh-preview-popup .seek-bg {
            height: 4px;
            border-radius: 999px;
            overflow: hidden;
        }
        .nh-preview-popup .seek-container:hover .seek-bg,
        .nh-preview-popup.is-dragging .seek-bg {
            height: 12px;
        }
        .nh-preview-popup .seek-tooltip {
            bottom: 18px;
        }
        #nh-dev-panel { position: fixed; right: 12px; bottom: 12px; width: min(300px, calc(100vw - 24px)); background: rgba(20,20,20,0.92); border: 1px solid var(--nh-color-border); border-radius: var(--nh-radius-md); z-index: 10050; color: #ddd; font-size: 11px; line-height: 1.35; font-family: Consolas, monospace; box-shadow: 0 8px 20px rgba(0,0,0,0.45); pointer-events: none; }
        #nh-dev-panel .hd { padding: 6px 8px; border-bottom: 1px solid var(--nh-color-border); color: var(--nh-color-accent); font-weight: bold; }
        #nh-dev-panel .groups { padding: 6px; display: flex; flex-direction: column; gap: 6px; }
        #nh-dev-panel .group { border: 1px solid var(--nh-color-border); border-radius: var(--nh-radius-sm); background: rgba(255,255,255,0.02); overflow: hidden; }
        #nh-dev-panel .gh { padding: 4px 6px; border-bottom: 1px solid var(--nh-color-border); color: var(--nh-color-accent); font-weight: bold; background: rgba(255,255,255,0.03); }
        #nh-dev-panel .gsh { padding: 4px 6px; color: var(--nh-color-text-subtle); font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; border-top: 1px solid rgba(255,255,255,0.04); background: rgba(255,255,255,0.015); }
        #nh-dev-panel .gsh:first-of-type { border-top: none; }
        #nh-dev-panel .gsb { padding: 4px 6px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 1px 6px; }
        #nh-dev-panel .gb { padding: 5px 6px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 1px 6px; }
        #nh-dev-panel .gsb .k { color: var(--nh-color-text-muted); }
        #nh-dev-panel .gsb .v { color: var(--nh-color-text); text-align: right; max-width: 132px; word-break: break-all; }
        #nh-dev-panel .gb .k { color: var(--nh-color-text-muted); }
        #nh-dev-panel .gb .v { color: var(--nh-color-text); text-align: right; max-width: 132px; word-break: break-all; }

        .nh-btn:focus-visible,
        .nh-tab-btn:focus-visible,
        .nh-select:focus-visible,
        .nh-lang-btn:focus-visible,
        .nh-helper-tag-btn:focus-visible,
        .nh-preview-hotzone:focus-visible,
        #nh-web-settings-btn a:focus-visible,
        .tag-trigger:focus-visible {
            outline: 2px solid var(--nh-color-accent);
            outline-offset: 2px;
            box-shadow: 0 0 0 3px var(--nh-focus-ring);
        }
        .nh-setting-sub-item input:focus-visible,
        .nh-switch input:focus-visible + .nh-slider,
        .nh-lang-item:focus-visible {
            outline: 2px solid var(--nh-color-accent);
            outline-offset: 2px;
            box-shadow: 0 0 0 3px var(--nh-focus-ring);
        }

        @media (max-width: 900px) {
            ul.menu.left { flex-wrap: wrap !important; height: auto !important; justify-content: flex-start; row-gap: 4px; }
            ul.menu.left > li:not(.dropdown) { height: auto; min-height: 36px; }
            ul.menu.left > li.dropdown { height: auto; min-height: 36px; }
            #nh-web-settings-btn a { padding: 0 8px; }
            #nh-lang-filter { margin-left: auto; }
            .nh-lang-container { margin-left: 4px; margin-right: 0; }
            .nh-lang-btn { min-width: auto; padding: 5px 8px; }
            .nh-preview-popup { display: none !important; }
        }
        @media (max-width: 768px) {
            #nh-settings-overlay { padding: 10px 8px; align-items: flex-end; }
            #nh-settings-modal {
                width: min(100vw - 16px, 560px);
                max-height: min(92vh, 820px);
                border-radius: 16px 16px 12px 12px;
                --nh-settings-pad-x: 14px;
            }
            .nh-modal-header { padding-top: 14px; }
            .nh-tab-btn { padding: 7px 12px; font-size: 12px; }
            .nh-setting-item { padding: 11px 12px; gap: 10px; }
            .nh-setting-control-select { min-width: 128px; max-width: 160px; }
            .nh-api-key-status { grid-template-columns: 1fr; }
            .nh-settings-actions { gap: 8px; }
            .nh-settings-actions .nh-btn { flex: 1 1 auto; text-align: center; }
            .nh-reading-topbar {
                top: 10px;
                left: 10px;
                right: 12px;
                gap: 8px;
            }
            .nh-reading-meta {
                max-width: calc(100vw - 104px);
            }
            .nh-reading-title { font-size: 12px; }
            .nh-reading-status { font-size: 10px; }
            .nh-reading-close {
                padding: 6px 10px;
                font-size: 11px;
            }
            .nh-reading-tools {
                width: 74px;
                padding: 8px 8px 8px 6px;
                gap: 8px;
            }
            .nh-reading-tool-caption,
            .nh-reading-tool-unit,
            .nh-reading-tool-input {
                font-size: 10px;
            }
            .nh-reading-tool-input-wrap {
                height: 28px;
                padding: 0 7px;
            }
            .nh-reading-pages { padding: 0 8px; }
            .nh-reading-scroller { padding-top: 10px; }
            .nh-reading-scrollbar {
                top: 40px;
                right: 4px;
                bottom: 12px;
                width: 5px;
            }
            .nh-reading-scrollbar-popper {
                right: 13px;
                min-width: 42px;
                padding: 3px 8px;
                font-size: 10px;
            }
            .nh-reading-scrollbar-thumb {
                width: 7px;
                left: -1px;
            }
            .hotzone { width: 34%; }
            .tag-popup { width: min(70vw, 220px); max-height: 180px; right: 5px; left: auto; top: 22px; }
        }
        @media (max-width: 520px) {
            #nh-lang-label { display: none; }
            .nh-lang-arrow { margin-left: 0; }
            .seek-container { height: 16px; }
            .seek-bg { height: 2px; }
            .seek-container:hover .seek-bg { height: 10px; }
        }
        @media (prefers-reduced-motion: reduce) {
            .nh-helper-suggestion-item,
            .nh-helper-tag-btn,
            .nh-slider,
            .nh-slider:before,
            .nh-tab-btn,
            .seek-bg,
            .seek-fill,
            .seek-tooltip,
            .tag-trigger,
            .tag-pill,
            .nh-lang-btn,
            .nh-lang-item,
            #nh-helper-quick-tags,
            .nh-toast,
            .nh-tab-content {
                transition: none !important;
                animation: none !important;
            }
        }
    `,
        styleElements: new Map(),
        criticalCss: '',
        featureCss: null,
        deferredScheduled: false,
        buildCssBundles() {
            if (this.featureCss && this.criticalCss) {
                return {
                    criticalCss: this.criticalCss,
                    featureCss: this.featureCss
                };
            }

            const source = this.base;
            const readingStart = source.indexOf('.nh-reading-mode-entry {');
            const previewStart = source.indexOf('/* Preview Feature Styles */');
            const diagnosticsStart = source.indexOf('#nh-dev-panel {');
            const diagnosticsEnd = source.indexOf('.nh-btn:focus-visible,');

            const featureCss = {
                readingMode: '',
                preview: '',
                diagnostics: ''
            };

            if (readingStart === -1 || previewStart === -1 || diagnosticsStart === -1 || diagnosticsEnd === -1) {
                this.criticalCss = source;
                this.featureCss = featureCss;
                return {
                    criticalCss: this.criticalCss,
                    featureCss: this.featureCss
                };
            }

            featureCss.readingMode = source.slice(readingStart, previewStart).trim();
            featureCss.preview = source.slice(previewStart, diagnosticsStart).trim();
            featureCss.diagnostics = source.slice(diagnosticsStart, diagnosticsEnd).trim();
            this.criticalCss = [
                source.slice(0, readingStart),
                source.slice(diagnosticsEnd)
            ].join('').replace(/\n{3,}/g, '\n\n');
            this.featureCss = featureCss;
            return {
                criticalCss: this.criticalCss,
                featureCss: this.featureCss
            };
        },
        appendStyleText(key, cssText) {
            if (!cssText || this.styleElements.has(key)) return;
            const styleEl = document.createElement('style');
            styleEl.dataset.nhStyleKey = key;
            styleEl.textContent = cssText;
            document.head.appendChild(styleEl);
            this.styleElements.set(key, styleEl);
        },
        ensureFeatureStyles(featureName) {
            const { featureCss } = this.buildCssBundles();
            this.appendStyleText(`feature-${featureName}`, featureCss[featureName] || '');
        },
        scheduleDeferredStyles() {
            if (this.deferredScheduled) return;
            this.deferredScheduled = true;
            const injectDeferred = () => {
                this.ensureFeatureStyles('readingMode');
                this.ensureFeatureStyles('preview');
                this.ensureFeatureStyles('diagnostics');
            };
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(injectDeferred, { timeout: 1200 });
            } else {
                setTimeout(injectDeferred, 800);
            }
        },
        inject() {
            const { criticalCss } = this.buildCssBundles();
            this.appendStyleText('critical-base', criticalCss);
            this.scheduleDeferredStyles();
        }
    };

    // ===== 4. 词库存储、下载、索引 =====
    const IDB_Helper = {
        dbName: 'nh_helper_db',
        storeName: 'keyval',
        dbPromise: null,
        open() {
            if (this.dbPromise) return this.dbPromise;
            this.dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, 1);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(this.storeName)) db.createObjectStore(this.storeName);
                };
                request.onsuccess = (e) => resolve(e.target.result);
                request.onerror = (e) => reject(e);
            });
            return this.dbPromise;
        },
        async get(key) {
            const db = await this.open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readonly');
                const req = tx.objectStore(this.storeName).get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        },
        async set(key, value) {
            const db = await this.open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                const req = tx.objectStore(this.storeName).put(value, key);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        },
        async delete(key) {
            const db = await this.open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                const req = tx.objectStore(this.storeName).delete(key);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        }
    };

    // 数据库模块负责本地缓存、远端同步和搜索索引三件事。
    const DB = {
        data: {},
        cnToItem: {},
        indexReady: false,
        worker: null,
        workerUrl: null,
        pendingSearches: new Map(),
        searchId: 0,
        searchTimeoutMs: 3000,
        // GM_xmlhttpRequest 默认不超时；不设上限时请求挂起会让 DB.init 永不返回。
        fetchTimeoutMs: 30000,
        releaseTimeoutMs: 60000,
        probeTimeoutMs: 15000,
        slugIndex: {},
        slugIndexSource: null,
        hasRequiredNamespaces(data) {
            if (!data || typeof data !== 'object') return false;
            const requiredNamespaces = ['tag', 'artist', 'group', 'parody', 'character', 'language'];
            return requiredNamespaces.every(ns => data[ns] && Object.keys(data[ns]).length > 0);
        },
        async init() {
            GM_registerMenuCommand("强制更新汉化数据库", () => this.update(true));
            let dbMeta = (await IDB_Helper.get('db_meta')) || {
                lastUpdate: 0,
                version: 0
            };
            const now = Date.now();
            let idbData = await IDB_Helper.get('tag_db');
            if (!idbData) {
                const legacyData = GM_getValue('tag_db', null);
                if (legacyData) {
                    try {
                        idbData = JSON.parse(legacyData);
                        await IDB_Helper.set('tag_db', idbData);
                        dbMeta = {
                            lastUpdate: GM_getValue('last_update', now),
                            version: GM_getValue('db_version', DB_VERSION)
                        };
                        await IDB_Helper.set('db_meta', dbMeta);
                        GM_deleteValue('tag_db');
                    } catch (e) {}
                }
            }
            const hasLocalDb = !!idbData;
            const disableAutoDbUpdate = Config.get('disableAutoDbUpdate');
            const shouldAutoIntervalUpdate = hasLocalDb && !disableAutoDbUpdate && (now - dbMeta.lastUpdate > Config.get('updateInterval'));
            const needsVersionUpdate = hasLocalDb && dbMeta.version < DB_VERSION;
            const needsIntegrityUpdate = hasLocalDb && !this.hasRequiredNamespaces(idbData);
            const needsFirstInit = !hasLocalDb;

            if (needsFirstInit) {
                await this.update();
                return;
            }

            this.data = idbData;
            this.rebuildCnIndex();
            runContentTranslation();
            this.initWorker();
            if (shouldAutoIntervalUpdate || needsVersionUpdate || needsIntegrityUpdate) {
                // 本地已有词库时先启用再后台更新，远端慢或不可达都不阻塞汉化与搜索联想。
                this.update().catch(error => console.error('[nHentai Pro] 词库后台更新失败:', error));
            }
        },
        async update(force = false) {
            const form = document.querySelector('form[action="/search/"]');
            let status = document.getElementById('nh-db-status');
            if (form && !status) {
                status = document.createElement('span');
                status.id = 'nh-db-status';
                form.appendChild(status);
            }
            if (status) status.textContent = getUIText('db_status_downloading');
            const currentMeta = (await IDB_Helper.get('db_meta')) || {
                lastUpdate: 0,
                version: 0,
                sha: '',
                sourceProvider: ''
            };
            const currentData = this.hasRequiredNamespaces(this.data)
                ? this.data
                : await IDB_Helper.get('tag_db');

            if (!force && this.hasRequiredNamespaces(currentData) && currentMeta.version >= DB_VERSION) {
                if (status) status.textContent = getUIText('db_status_checking');
                // 只比对 40 字节的 sha；取不到 sha 或本地来自备用源（无 sha）时按有更新处理。
                const remoteSha = await this.fetchReleaseSha();
                if (remoteSha && remoteSha === currentMeta.sha) {
                    await IDB_Helper.set('db_meta', {
                        ...currentMeta,
                        lastUpdate: Date.now(),
                        version: DB_VERSION
                    });
                    if (this.data !== currentData) {
                        this.data = currentData;
                        this.rebuildCnIndex();
                    }
                    // init 已先用本地词库启动 Worker；正在建索引时不要重启。
                    if (!this.worker) {
                        this.initWorker();
                    }
                    if (status) {
                        status.textContent = getUIText('db_status_latest');
                        setTimeout(() => status.remove(), 2000);
                    }
                    return;
                }
                if (status) status.textContent = getUIText('db_status_downloading');
            }

            try {
                let download = await this.downloadReleaseDatabase();
                if (!this.hasRequiredNamespaces(download.data)) {
                    console.warn('[nHentai Pro] EhTag 词库不完整，尝试兜底镜像...');
                    if (status) status.textContent = getUIText('db_status_fallback');
                    download = await this.downloadTagDatabase(LEGACY_TAG_DB_SOURCES, 'legacy');
                }
                if (!this.hasRequiredNamespaces(download.data)) {
                    throw new Error('primary and legacy tag database incomplete');
                }

                await IDB_Helper.set('tag_db', download.data);
                await IDB_Helper.set('db_meta', {
                    lastUpdate: Date.now(),
                    version: DB_VERSION,
                    sha: download.sha,
                    sourceProvider: download.provider
                });
                this.data = download.data;
                this.rebuildCnIndex();
                if (status) {
                    status.textContent = getUIText(download.provider === 'ehtag' ? 'db_status_done' : 'db_status_done_fallback');
                    setTimeout(() => status.remove(), 2000);
                }
                runContentTranslation();
                this.terminateWorker();
                this.initWorker();
                if (force) location.reload();
            } catch (e) {
                console.error(e);
                // 远端失败时继续使用本地已有词库，避免版本升级/完整性检查失败后汉化与联想整体失效。
                const canUseLocal = this.hasRequiredNamespaces(currentData);
                if (canUseLocal && this.data !== currentData) {
                    this.data = currentData;
                    this.rebuildCnIndex();
                    runContentTranslation();
                    this.initWorker();
                }
                if (status) {
                    status.textContent = getUIText(canUseLocal ? 'db_status_failed_local' : 'db_status_failed');
                    // 本地词库可用时功能不受影响，提示几秒后收起；完全不可用时保留提示。
                    if (canUseLocal) setTimeout(() => status.remove(), 5000);
                }
            }
        },
        createEmptyTagData() {
            return {
                tag: {},
                artist: {},
                group: {},
                parody: {},
                character: {},
                language: {}
            };
        },
        removeCommonLanguageTags(data) {
            ['chinese', 'japanese', 'english'].forEach(lang => {
                if (data.tag[lang]) delete data.tag[lang];
            });
            return data;
        },
        async fetchReleaseSha() {
            const result = await this.fetchText(EHTAG_RELEASE_SHA_URL, this.probeTimeoutMs);
            const sha = result.ok ? result.text.trim().toLowerCase() : '';
            return /^[0-9a-f]{40}$/.test(sha) ? sha : '';
        },
        // 主源：EhTag 单文件 release；结构为 { head: { sha }, data: [{ namespace, data: { 原始标签: { name } } }] }。
        async downloadReleaseDatabase() {
            const failed = { data: this.createEmptyTagData(), sha: '', provider: 'ehtag' };
            const result = await this.fetchText(EHTAG_RELEASE_DB_URL, this.releaseTimeoutMs);
            if (!result.ok || !result.text) return failed;
            let release;
            try {
                release = JSON.parse(result.text);
            } catch (error) {
                console.warn('[nHentai Pro] EhTag release 解析失败:', error);
                return failed;
            }
            const sha = String(release?.head?.sha || '').trim().toLowerCase();
            return {
                data: this.convertReleaseDatabase(release),
                sha: /^[0-9a-f]{40}$/.test(sha) ? sha : '',
                provider: 'ehtag'
            };
        },
        convertReleaseDatabase(release) {
            const data = this.createEmptyTagData();
            const priorityMaps = {};
            // 与原逐文件合并一致：低优先级先写、高优先级后写，再叠加 priority 比较（female > mixed > other > location > male）。
            (Array.isArray(release?.data) ? release.data : [])
                .map(block => ({ block, target: EHTAG_RELEASE_NAMESPACES[block?.namespace] }))
                .filter(({ target }) => target)
                .sort((a, b) => (a.target.priority || 0) - (b.target.priority || 0))
                .forEach(({ block, target }) => {
                    const priorityMap = priorityMaps[target.ns] || (priorityMaps[target.ns] = {});
                    Object.entries(block.data || {}).forEach(([raw, entry]) => {
                        this.mergeTranslationEntry(
                            data[target.ns],
                            raw,
                            this.cleanTranslationText(entry?.name),
                            target.priority || 0,
                            priorityMap
                        );
                    });
                });
            return this.removeCommonLanguageTags(data);
        },
        // 兜底镜像：按命名空间下载 markdown 表格。
        async downloadTagDatabase(sources, provider) {
            const results = await Promise.all(sources.map(src => this.fetchAndParseNamespace(src.ns, src.urls)));
            const newData = this.createEmptyTagData();
            results.forEach(res => {
                if (newData[res.ns]) Object.assign(newData[res.ns], res.data);
                else newData[res.ns] = res.data;
            });
            return { data: this.removeCommonLanguageTags(newData), sha: '', provider };
        },
        containsChinese(text) {
            return /[\u4e00-\u9fff]/.test(String(text || ''));
        },
        // 主源 name 与兜底 markdown 单元格共用：去掉图片/链接/HTML 标记与装饰性 emoji（含变体选择符）。
        cleanTranslationText(text) {
            let value = String(text || '');
            value = value.replace(/!\[[^\]]*]\([^)]*\)/g, '');
            value = value.replace(/\[([^\]]*)]\([^)]*\)/g, '$1');
            value = value.replace(/<[^>]+>/g, '');
            try {
                value = value.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '');
            } catch (error) {
                value = value.replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]/g, '');
            }
            return value.replace(/\s+/g, ' ').trim();
        },
        normalizeSourceUrlEntry(entry) {
            if (typeof entry === 'string') {
                return { url: entry, priority: 0 };
            }
            if (entry && typeof entry === 'object' && entry.url) {
                return {
                    url: String(entry.url),
                    priority: Number.isFinite(Number(entry.priority)) ? Number(entry.priority) : 0
                };
            }
            return null;
        },
        mergeTranslationEntry(map, enName, cnName, priority = 0, priorityMap = null) {
            const en = String(enName || '').trim().toLowerCase();
            const cn = String(cnName || '').trim();
            if (!en || en === 'name' || en === '名称' || en.includes('tag (')) return;
            if (!cn || cn === '-') return;

            const current = map[en];
            const isNewChinese = this.containsChinese(cn);
            const isOldChinese = current ? this.containsChinese(current) : false;
            const nextPriority = Number.isFinite(Number(priority)) ? Number(priority) : 0;

            // 带优先级：低优先级不得覆盖高优先级（解决 female/male 同名冲突）。
            if (priorityMap) {
                const prevPriority = Object.prototype.hasOwnProperty.call(priorityMap, en)
                    ? priorityMap[en]
                    : Number.NEGATIVE_INFINITY;

                if (nextPriority < prevPriority) return;

                if (nextPriority > prevPriority) {
                    map[en] = cn;
                    priorityMap[en] = nextPriority;
                    return;
                }

                // 同优先级：中文优先，且不互相覆盖已有中文。
                if (!current) {
                    map[en] = cn;
                    priorityMap[en] = nextPriority;
                    return;
                }
                if (!isOldChinese && isNewChinese) {
                    map[en] = cn;
                    priorityMap[en] = nextPriority;
                }
                return;
            }

            // 无优先级：先到的中文保留，避免后加载 gender 文件覆盖。
            if (isNewChinese) {
                if (!current || !isOldChinese) map[en] = cn;
            } else if (!current) {
                map[en] = cn;
            } else if (!isOldChinese) {
                map[en] = cn;
            }
        },
        parseTranslationMarkdown(text, priority = 0, priorityMap = null) {
            const data = {};
            String(text || '').split(/\r?\n/).forEach(line => {
                const trimmed = line.trim();
                if (!trimmed.startsWith('|') || trimmed.includes('---|')) return;
                const parts = trimmed.split('|');
                if (parts.length < 3) return;
                const en = this.cleanTranslationText(parts[1]);
                const cn = this.cleanTranslationText(parts[2]);
                this.mergeTranslationEntry(data, en, cn, priority, priorityMap);
            });
            return data;
        },
        fetchText(url, timeoutMs = this.fetchTimeoutMs) {
            return new Promise((resolve) => {
                const fail = () => resolve({ text: '', ok: false });
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(),
                    timeout: timeoutMs,
                    onload: (response) => {
                        if (response.status && response.status >= 400) {
                            fail();
                            return;
                        }
                        resolve({
                            text: response.responseText || '',
                            ok: true
                        });
                    },
                    onerror: fail,
                    ontimeout: fail,
                    onabort: fail
                });
            });
        },
        async fetchAndParseNamespace(ns, urls = []) {
            const data = {};
            const priorityMap = {};
            const list = (Array.isArray(urls) ? urls : [])
                .map(entry => this.normalizeSourceUrlEntry(entry))
                .filter(Boolean);
            // 并行下载；合并仍按低优先级先写、高优先级后写，再叠加 priority 比较，结果与串行一致。
            list.sort((a, b) => a.priority - b.priority);
            const results = await Promise.all(list.map(({ url }) => this.fetchText(url)));
            list.forEach(({ priority }, index) => {
                const result = results[index];
                if (!result.ok || !result.text) return;
                const parsed = this.parseTranslationMarkdown(result.text);
                Object.keys(parsed).forEach(en => {
                    this.mergeTranslationEntry(data, en, parsed[en], priority, priorityMap);
                });
            });
            return { ns, data };
        },
        // 兼容旧调用名
        fetchAndParse(url, ns) {
            return this.fetchAndParseNamespace(ns, [url]);
        },
        rebuildCnIndex() {
            const map = {};
            Object.keys(this.data || {}).forEach(ns => {
                const bucket = this.data[ns];
                if (!bucket) return;
                Object.keys(bucket).forEach(en => {
                    const cn = bucket[en];
                    if (!cn || cn === '-') return;
                    const key = String(cn).trim().toLowerCase();
                    if (!key || map[key]) return;
                    map[key] = { value: en, namespace: ns, cn };
                });
            });
            this.cnToItem = map;
        },
        // 标签链接只有 slug（x-ray 与 big breasts 都写成 a-b），按 slug 反查词库原始英文名；按命名空间懒构建。
        findKeyBySlug(ns, slug) {
            const bucket = this.data?.[ns];
            if (!slug || !bucket) return '';
            if (this.slugIndexSource !== this.data) {
                this.slugIndex = {};
                this.slugIndexSource = this.data;
            }
            if (!this.slugIndex[ns]) {
                const map = {};
                Object.keys(bucket).forEach(en => {
                    const key = slugifyTagName(en);
                    if (key && !map[key]) map[key] = en;
                });
                this.slugIndex[ns] = map;
            }
            return this.slugIndex[ns][slug] || '';
        },
        terminateWorker() {
            if (this.worker) {
                this.worker.terminate();
                this.worker = null;
            }
            if (this.workerUrl) {
                URL.revokeObjectURL(this.workerUrl);
                this.workerUrl = null;
            }
            this.indexReady = false;
            this.pendingSearches.forEach(resolve => resolve([]));
            this.pendingSearches.clear();
        },
        // Worker 只负责搜索索引匹配，避免大词库检索阻塞主线程。
        initWorker() {
            if (this.worker) this.terminateWorker();
            const workerScript = `
            let index = { all: [] };
            let sortedIndex = { all: [] };
            const NS_PLURAL_MAP = {
                'tag': 'tags',
                'artist': 'artists',
                'group': 'groups',
                'parody': 'parodies',
                'character': 'characters',
                'language': 'languages'
            };

            self.onmessage = function(e) {
                const msg = e.data;
                if (msg.type === 'init') {
                    const rawData = msg.data;
                    index = { all: [] };
                    sortedIndex = { all: [] };
                    const nsDisplayMap = { 'tag': 'TAG', 'artist': 'ARTIST', 'group': 'GROUP', 'parody': 'PARODY', 'character': 'CHAR', 'language': 'LANG' };

                    for (const ns of Object.keys(rawData)) {
                        index[ns] = []; // Init namespace bucket
                        const map = rawData[ns];
                        const nsBadge = nsDisplayMap[ns] || ns.toUpperCase();

                        for (const en in map) {
                            if (ns === 'tag' && ['chinese', 'english', 'japanese'].includes(en)) continue;
                            const cn = map[en];
                            const safeEn = escapeHtml(en);
                            const safeCn = escapeHtml(cn);
                            const safeBadge = escapeHtml(nsBadge);
                            const contentHtml = cn ? safeEn + ' <span class="meta">' + safeCn + '</span>' : safeEn;
                            const fullHtml = '<span class="type-badge">' + safeBadge + '</span><span class="content-wrapper">' + contentHtml + '</span>';

                            const item = { term: en, display: fullHtml, value: en, namespace: ns, cn: cn, isCnInput: false };
                            index.all.push(item);
                            index[ns].push(item);

                            if (cn) {
                                const cnFullHtml = '<span class="type-badge">' + safeBadge + '</span><span class="content-wrapper">' + safeCn + ' <span class="meta">' + safeEn + '</span></span>';
                                const cnItem = { term: cn.toLowerCase(), display: cnFullHtml, value: en, namespace: ns, cn: cn, isCnInput: true };
                                index.all.push(cnItem);
                                index[ns].push(cnItem);
                            }
                        }

                        sortedIndex[ns] = index[ns].slice().sort(compareIndexItems);
                    }
                    sortedIndex.all = index.all.slice().sort(compareIndexItems);
                    self.postMessage({ type: 'initReady' });
                } else if (msg.type === 'search') {
                    const { id, query } = msg;
                    const results = getSuggestions(query);
                    self.postMessage({ type: 'searchResult', id, results });
                }
            };

            // 联想项以 innerHTML 渲染，词库文本需转义。
            function escapeHtml(value) {
                return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
                });
            }

            function compareIndexItems(a, b) {
                if (a.term < b.term) return -1;
                if (a.term > b.term) return 1;
                if (a.value < b.value) return -1;
                if (a.value > b.value) return 1;
                return 0;
            }

            function lowerBound(items, term) {
                let left = 0;
                let right = items.length;
                while (left < right) {
                    const mid = Math.floor((left + right) / 2);
                    if (items[mid].term < term) left = mid + 1;
                    else right = mid;
                }
                return left;
            }

            function scoreMatch(itemTerm, cleanTerm, lookBackSize, matchType) {
                let score = matchType === 'exact' ? 100 : matchType === 'prefix' ? 80 : 50;
                score -= (itemTerm.length - cleanTerm.length) * 0.5;
                if (lookBackSize > 1) score += 20 * lookBackSize;
                score += cleanTerm.length * 2;
                return score;
            }

            function collectPrefixMatches(targetIndex, cleanTerm, lookBackSize, originalMatch, prefix, limit) {
                const results = [];
                const start = lowerBound(targetIndex, cleanTerm);
                for (let i = start; i < targetIndex.length; i += 1) {
                    const item = targetIndex[i];
                    if (!item.term.startsWith(cleanTerm)) break;
                    results.push({
                        item,
                        score: scoreMatch(item.term, cleanTerm, lookBackSize, item.term === cleanTerm ? 'exact' : 'prefix'),
                        originalMatch,
                        nsPrefix: prefix
                    });
                    if (results.length >= limit) break;
                }
                return results;
            }

            function collectContainsMatches(targetIndex, cleanTerm, lookBackSize, originalMatch, prefix, limit) {
                const results = [];
                for (let i = 0; i < targetIndex.length; i += 1) {
                    const item = targetIndex[i];
                    if (item.term.startsWith(cleanTerm) || !item.term.includes(cleanTerm)) continue;
                    results.push({
                        item,
                        score: scoreMatch(item.term, cleanTerm, lookBackSize, 'contains'),
                        originalMatch,
                        nsPrefix: prefix
                    });
                    if (results.length >= limit) break;
                }
                return results;
            }

            function getSuggestions(inputStr) {
                const tokens = inputStr.match(/(-?[a-zA-Z0-9_]+:"[^"]*"|"[^"]*"|[^"\\s]+)/g) || [];
                if (inputStr.trim() === '' || (inputStr.endsWith(' ') && tokens.length > 0 && inputStr.slice(inputStr.lastIndexOf(tokens[tokens.length - 1])).trim() === tokens[tokens.length - 1] && tokens[tokens.length - 1].endsWith('"'))) {
                    return [];
                }
                const words = inputStr.trim().split(/\\s+/);
                if (words.length === 0) return [];

                const matches = [];
                const maxLookBack = 4;

                // Only look at the last "word" chunk for suggestion
                for (let i = Math.min(words.length, maxLookBack); i >= 1; i--) {
                    const slice = words.slice(-i).join(' ');
                    let searchNs = null;
                    let searchTerm = slice;
                    let prefix = '';

                    const nsMatch = slice.match(/^(-?)([a-zA-Z0-9_]+):(.*)/);
                    if (nsMatch) {
                        prefix = nsMatch[1] + nsMatch[2] + ':';
                        searchNs = nsMatch[2];
                        if (searchNs.endsWith('s')) searchNs = searchNs.slice(0, -1);
                        searchTerm = nsMatch[3];
                    }

                    const cleanTerm = searchTerm.replace(/^"|"$/g, '').toLowerCase();
                    if (cleanTerm.length < 1) continue;

                    // SELECT THE RIGHT BUCKET
                    let targetIndex = index.all;
                    let targetSortedIndex = sortedIndex.all;
                    if (searchNs && index[searchNs]) {
                        targetIndex = index[searchNs];
                        targetSortedIndex = sortedIndex[searchNs] || index[searchNs];
                    } else if (searchNs) {
                        // Namespace exists but not in our DB (e.g. pages:), skip search or return empty
                        continue;
                    }

                    const tempResults = collectPrefixMatches(targetSortedIndex, cleanTerm, i, slice, prefix, 24);
                    if (tempResults.length < 12) {
                        const containsResults = collectContainsMatches(targetIndex, cleanTerm, i, slice, prefix, 12 - tempResults.length);
                        tempResults.push(...containsResults);
                    }
                    tempResults.sort((a, b) => b.score - a.score);
                    matches.push(...tempResults.slice(0, 20));
                }

                const uniqueMap = new Map();
                matches.sort((a, b) => b.score - a.score);
                matches.forEach(m => {
                    const uniqueKey = m.item.namespace + ':' + m.item.value;
                    if (!uniqueMap.has(uniqueKey)) {
                        const pluralNs = NS_PLURAL_MAP[m.item.namespace] || m.item.namespace;
                        const finalVal = \`\${pluralNs}:"\${m.item.value}"\`;
                        uniqueMap.set(uniqueKey, {
                            display: m.item.display,
                            finalValue: finalVal,
                            originalMatch: m.originalMatch,
                            namespace: m.item.namespace,
                            value: m.item.value,
                            cn: m.item.cn || '',
                            isCnInput: m.item.isCnInput === true
                        });
                    }
                });
                return Array.from(uniqueMap.values()).slice(0, 50);
            }
        `;
            const blob = new Blob([workerScript], {
                type: 'application/javascript'
            });
            this.workerUrl = URL.createObjectURL(blob);
            this.worker = new Worker(this.workerUrl);
            this.worker.onmessage = (e) => {
                const msg = e.data;
                if (msg.type === 'initReady') {
                    this.indexReady = true;
                } else if (msg.type === 'searchResult') {
                    const { id, results } = msg;
                    if (this.pendingSearches.has(id)) {
                        this.pendingSearches.get(id)(results);
                        this.pendingSearches.delete(id);
                    }
                }
            };
            this.worker.postMessage({ type: 'init', data: this.data });
        },
        search(query) {
             if (!this.worker || !this.indexReady) return Promise.resolve([]);
             return new Promise(resolve => {
                 const id = ++this.searchId;
                 const timeout = setTimeout(() => {
                     if (!this.pendingSearches.has(id)) return;
                     this.pendingSearches.delete(id);
                     resolve([]);
                 }, this.searchTimeoutMs);
                 this.pendingSearches.set(id, (results) => {
                     clearTimeout(timeout);
                     resolve(results);
                 });
                 try {
                     this.worker.postMessage({ type: 'search', id, query });
                 } catch (e) {
                     clearTimeout(timeout);
                     this.pendingSearches.delete(id);
                     resolve([]);
                 }
             });
        }
    };

    // ===== 5. 搜索、翻译、语言筛选、设置 UI =====
    const SettingsUIDict = {
        'zh': {
            "title": "nHentai Pro 设置 v2.8.2.18",
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
            "title": "nHentai Pro Settings v2.8.2.18",
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
                    <span class="version">v2.8.2.18</span>
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

    const DetailQuickBlacklistState = {
        galleryId: '',
        metaPromise: null,
        pendingTagIds: new Set(),
        blacklistReadyPromise: null
    };

    function isGalleryDetailRoute(pathname = window.location.pathname) {
        return /^\/g\/\d+\/?$/.test(pathname);
    }

    function getCurrentGalleryIdFromLocation(pathname = window.location.pathname) {
        const match = String(pathname || '').match(/^\/g\/(\d+)\/?$/);
        return match ? match[1] : '';
    }

    function normalizeTagUrlPath(url = '') {
        try {
            const parsed = new URL(url, window.location.origin);
            return parsed.pathname.replace(/\/+$/, '') || parsed.pathname;
        } catch (error) {
            return String(url || '').replace(window.location.origin, '').replace(/\/+$/, '');
        }
    }

    function getQuickBlacklistHintText() {
        return isUserLoggedIn()
            ? getUIText('desc_quick_blacklist_ready')
            : getUIText('desc_quick_blacklist_login_required');
    }

    function getDetailBlacklistMeta(galleryId = getCurrentGalleryIdFromLocation()) {
        if (!galleryId) return Promise.resolve(null);
        if (DetailQuickBlacklistState.galleryId !== galleryId || !DetailQuickBlacklistState.metaPromise) {
            DetailQuickBlacklistState.galleryId = galleryId;
            DetailQuickBlacklistState.metaPromise = GalleryMeta.get(galleryId);
        }
        return DetailQuickBlacklistState.metaPromise;
    }

    function getTagContainerHeader(container) {
        const headerNode = Array.from(container?.childNodes || []).find(node => {
            return node.nodeType === Node.TEXT_NODE && node.textContent.trim();
        });
        return headerNode ? headerNode.textContent.trim().replace(/:$/, '') : '';
    }

    function shouldSkipQuickBlacklistContainer(container) {
        const header = getTagContainerHeader(container);
        return mapTagHeaders[header] === 'pages';
    }

    function createDetailBlacklistTagMap(meta) {
        const map = new Map();
        (meta?.tags || []).forEach(tag => {
            const key = normalizeTagUrlPath(tag?.url || '');
            if (key) map.set(key, tag);
        });
        return map;
    }

    function syncBlacklistAppOptions(nextSet) {
        const app = SiteBlacklist.getApp();
        if (!app?.options) return;
        app.options.blacklisted_tags = Array.from(nextSet);
    }

    function readAccessTokenCookie() {
        const match = document.cookie.match(/(?:^|; )access_token=([^;]*)/);
        return match ? decodeURIComponent(match[1]) : '';
    }

    function isNhentaiApiV2Endpoint(endpoint = '') {
        try {
            const parsed = new URL(endpoint, window.location.origin);
            return parsed.hostname === 'nhentai.net' && parsed.pathname.startsWith('/api/v2/');
        } catch (error) {
            return false;
        }
    }

    function buildNhentaiApiHeaders(endpoint, options = {}) {
        const token = readAccessTokenCookie();
        const isApiV2 = isNhentaiApiV2Endpoint(endpoint);
        const headers = {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(isApiV2 && token ? { Authorization: `User ${token}` } : {})
        };
        const apiKey = String(Config.get('apiKey') || '').trim();
        if (apiKey && isApiV2) {
            headers.Authorization = `Key ${apiKey}`;
        }
        Object.assign(headers, options.headers || {});
        return headers;
    }

    async function testConfiguredApiKey(apiKey) {
        const normalizedKey = String(apiKey || '').trim();
        if (!normalizedKey) {
            return { ok: false, status: 0 };
        }
        const response = await fetch('/api/v2/user', {
            credentials: 'same-origin',
            headers: buildNhentaiApiHeaders('/api/v2/user', {
                headers: { Authorization: `Key ${normalizedKey}` }
            })
        });
        let payload = null;
        try {
            payload = await response.json();
        } catch (error) {
            payload = null;
        }
        return {
            ok: response.ok,
            status: response.status,
            payload
        };
    }

    async function requestNhentaiApiJson(endpoint, options = {}) {
        const headers = buildNhentaiApiHeaders(endpoint, options);
        const response = await fetch(endpoint, {
            credentials: 'same-origin',
            ...options,
            headers
        });
        let payload = null;
        try {
            payload = await response.json();
        } catch (error) {
            payload = null;
        }
        if (!response.ok) {
            const message = payload?.detail || payload?.error || `${response.status} ${response.statusText}`.trim();
            throw new Error(message || 'Request failed');
        }
        return payload;
    }

    function ensureBlacklistReady() {
        if (SiteBlacklist.hasSyncedOnce) {
            return Promise.resolve();
        }
        if (DetailQuickBlacklistState.blacklistReadyPromise) {
            return DetailQuickBlacklistState.blacklistReadyPromise;
        }
        DetailQuickBlacklistState.blacklistReadyPromise = (async () => {
            if (!isUserLoggedIn()) return;
            const syncedFromPage = SiteBlacklist.syncFromPage();
            if (syncedFromPage) {
                SiteBlacklist.apply(document);
                return;
            }
            await SiteBlacklist.syncFromApi();
            SiteBlacklist.apply(document);
        })().finally(() => {
            DetailQuickBlacklistState.blacklistReadyPromise = null;
        });
        return DetailQuickBlacklistState.blacklistReadyPromise;
    }

    function getBlacklistButtonState(tagId) {
        const normalizedId = Number(tagId);
        return {
            isLoading: DetailQuickBlacklistState.pendingTagIds.has(normalizedId),
            isBlacklisted: SiteBlacklist.tagSet.has(normalizedId)
        };
    }

    function renderQuickBlacklistButton(button, tagId) {
        const state = getBlacklistButtonState(tagId);
        button.classList.toggle('is-blacklisted', state.isBlacklisted);
        button.classList.toggle('is-loading', state.isLoading);
        button.disabled = state.isLoading;
        button.dataset.blacklisted = state.isBlacklisted ? 'true' : 'false';
        button.title = getUIText(state.isBlacklisted ? 'quick_blacklist_remove' : 'quick_blacklist_add');
        button.setAttribute('aria-label', button.title);

        if (state.isLoading) {
            button.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
        } else if (state.isBlacklisted) {
            button.innerHTML = '<i class="fa fa-undo"></i>';
        } else {
            button.innerHTML = '<i class="fa fa-ban"></i>';
        }
    }

    function refreshRenderedQuickBlacklistButtons(root = document) {
        queryAll(root, '.nh-tag-blacklist-btn').forEach(button => {
            renderQuickBlacklistButton(button, button.dataset.tagId);
        });
    }

    async function updateQuickBlacklist(tagId, shouldBlacklist) {
        const normalizedId = Number(tagId);
        if (!Number.isFinite(normalizedId) || normalizedId <= 0) {
            throw new Error('Invalid tag id');
        }

        const payload = await requestNhentaiApiJson(API_ENDPOINTS.blacklist, {
            method: 'POST',
            body: JSON.stringify({
                added: shouldBlacklist ? [normalizedId] : [],
                removed: shouldBlacklist ? [] : [normalizedId]
            })
        });

        SiteBlacklist.applyDiff(
            shouldBlacklist ? [normalizedId] : [],
            shouldBlacklist ? [] : [normalizedId]
        );
        SiteBlacklist.apply(document);
        refreshRenderedQuickBlacklistButtons(document);
        return payload;
    }

    async function handleQuickBlacklistToggle(event) {
        event.preventDefault();
        event.stopPropagation();

        const button = event.currentTarget;
        const tagId = Number(button?.dataset?.tagId || 0);
        if (!tagId || DetailQuickBlacklistState.pendingTagIds.has(tagId)) return;

        const shouldBlacklist = button.dataset.blacklisted !== 'true';
        DetailQuickBlacklistState.pendingTagIds.add(tagId);
        refreshRenderedQuickBlacklistButtons(document);

        try {
            await updateQuickBlacklist(tagId, shouldBlacklist);
        } catch (error) {
            console.error('[nHentai Pro] Failed to update quick blacklist:', error);
            showToast(getUIText('quick_blacklist_error'), { type: 'error' });
        } finally {
            DetailQuickBlacklistState.pendingTagIds.delete(tagId);
            refreshRenderedQuickBlacklistButtons(document);
        }
    }

    function ensureQuickBlacklistButton(link, tag) {
        if (!link || !tag) return;
        let button = link.nextElementSibling;
        if (!button || !button.classList.contains('nh-tag-blacklist-btn')) {
            button = document.createElement('button');
            button.type = 'button';
            button.className = 'nh-tag-blacklist-btn';
            button.addEventListener('click', handleQuickBlacklistToggle);
            link.insertAdjacentElement('afterend', button);
        }
        button.dataset.tagId = String(tag.id);
        button.dataset.tagType = tag.type || '';
        renderQuickBlacklistButton(button, tag.id);
    }

    async function refreshDetailQuickBlacklistButtons(context = document) {
        if (!isGalleryDetailRoute()) return;

        const containers = queryAll(context, '#tags .tag-container');
        if (!containers.length) return;

        if (!Config.get('enableDetailQuickBlacklist')) {
            containers.forEach(container => {
                queryAll(container, '.nh-tag-blacklist-btn').forEach(button => button.remove());
            });
            return;
        }

        if (!isUserLoggedIn()) {
            containers.forEach(container => {
                queryAll(container, '.nh-tag-blacklist-btn').forEach(button => button.remove());
            });
            return;
        }

        await ensureBlacklistReady();
        const meta = await getDetailBlacklistMeta();
        if (!meta?.tags?.length) return;
        const tagMap = createDetailBlacklistTagMap(meta);

        containers.forEach(container => {
            if (shouldSkipQuickBlacklistContainer(container)) {
                queryAll(container, '.nh-tag-blacklist-btn').forEach(button => button.remove());
                return;
            }

            const links = queryAll(container, 'a.tag, a.tagchip');
            links.forEach(link => {
                const tag = tagMap.get(normalizeTagUrlPath(link.getAttribute('href') || link.href || ''));
                if (!tag || !['tag', 'artist', 'character', 'parody', 'group', 'language', 'category'].includes(tag.type)) return;
                ensureQuickBlacklistButton(link, tag);
            });
        });
    }

    function clearDetailQuickBlacklistButtons(context = document) {
        queryAll(context, '.nh-tag-blacklist-btn').forEach(button => button.remove());
    }

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

    function translateTextNode(rootNode) {
        const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null, false);
        let node;
        while(node = walker.nextNode()) {
            if (node.nodeType === Node.TEXT_NODE) {
                let text = node.nodeValue.trim();
                if (!text) continue;
                const translated = getUITranslation(text, node.parentElement);
                if (translated) {
                    node.nodeValue = translated;
                    continue;
                }
                if (text.match(/^\d+ results?$/)) { node.nodeValue = text.replace('results', '个结果').replace('result', '个结果'); continue; }

            } else if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
                const ph = node.getAttribute('placeholder');
                if (ph && uiTranslations[ph]) {
                    node.setAttribute('placeholder', uiTranslations[ph]);
                }
            }
        }
    }

    const USER_SETTINGS_SECTION_ORDER = ['profile', 'blacklist', 'apikeys', 'sessions', 'danger'];
    let userSettingsRefreshTimer = null;
    let userSettingsAccordionBound = false;

    function getUserSettingsHashTokens(hash = window.location.hash) {
        return hash
            .replace(/^#/, '')
            .split(',')
            .map(token => token.trim().toLowerCase())
            .filter(Boolean);
    }

    function scheduleUserSettingsTranslationRefresh(delay = 120) {
        clearTimeout(userSettingsRefreshTimer);
        userSettingsRefreshTimer = setTimeout(() => {
            if (!window.location.pathname.startsWith('/user/settings')) return;
            runUITranslation(document);
            runContentTranslation(document);
        }, delay);
    }

    function bindUserSettingsAccordionWatcher() {
        if (userSettingsAccordionBound) return;
        userSettingsAccordionBound = true;

        document.addEventListener('click', (event) => {
            const header = event.target.closest?.('.acc-header');
            if (!header || !window.location.pathname.startsWith('/user/settings')) return;
            scheduleUserSettingsTranslationRefresh(180);
        }, true);

        window.addEventListener('hashchange', () => {
            if (!window.location.pathname.startsWith('/user/settings')) return;
            scheduleUserSettingsTranslationRefresh(60);
        });
    }

    function syncUserSettingsAccordionFromHash(settingsRoot) {
        const hashTokens = new Set(getUserSettingsHashTokens());
        if (!hashTokens.size) return false;

        let opened = false;
        queryAll(settingsRoot, '.acc-section').forEach((section, index) => {
            const token = USER_SETTINGS_SECTION_ORDER[index];
            if (!token || token === 'danger') return;
            if (!hashTokens.has(token)) return;
            if (section.classList.contains('open')) return;

            const header = queryOne(section, '.acc-header');
            if (!header) return;
            header.click();
            opened = true;
        });

        return opened;
    }

    function translateInfoPage() {
        const infoContainer = document.querySelector('#info-container');
        if (!infoContainer) return;
        const normalizeInfoText = (text = '') => text.replace(/\s+/g, ' ').trim();
        const buildAttrString = (el, names) => names
            .map(name => {
                const value = el?.getAttribute?.(name);
                return value ? ` ${name}="${escapeHtml(value)}"` : '';
            })
            .join('');
        const renderAnchor = (anchor, text = anchor?.textContent?.trim() || '') =>
            anchor ? `<a${buildAttrString(anchor, ['href', 'target', 'rel', 'style', 'class'])}>${escapeHtml(text)}</a>` : escapeHtml(text);
        const renderBreak = (node) => `<br${buildAttrString(node, ['class'])}>`;
        const renderInline = (tagName, node, innerHTML) =>
            `<${tagName}${buildAttrString(node, ['style', 'class'])}>${innerHTML}</${tagName}>`;
        const replaceText = (el, map) => {
            if (!el) return;
            el.childNodes.forEach(node => {
                if (node.nodeType === 3) {
                    const txt = node.textContent.trim();
                    if (map[txt]) node.textContent = map[txt];
                    else {
                        const normalized = txt.replace(/\.$/, '');
                        if (map[normalized]) node.textContent = map[normalized];
                    }
                } else {
                    replaceText(node, map);
                }
            });
        };

        const headingMap = {
            "Accessing nhentai": "访问 nhentai",
            "Accounts": "账号",
            "Search": "搜索",
            "API": "接口 API",
            "Anti-Spam Challenges": "反垃圾挑战",
            "Want to get in touch?": "想联系我们？"
        };

        const inlineTextMap = {
            "Official domain:": "官方域名：",
            "Official domain: ": "官方域名：",
            "Tor Onion:": "Tor 洋葱地址：",
            "You must be inside the tor network.": "您必须在 Tor 网络中。",
            "Learn more": "了解更多",
            "Learn more.": "了解更多。",
            "More to come.": "更多内容即将推出。",
            "Features": "功能",
            "We will never add forums.": "我们永远不会添加论坛。",
            "You will be able to upload and edit galleries soon.": "您很快就可以上传和编辑图库了。",
            "Unlimited favorites": "无限收藏",
            "Unlimited favorites.": "无限收藏。",
            "Tag blacklist": "标签黑名单",
            "Tag blacklisting.": "标签黑名单。",
            "API key access for developers.": "为开发者提供 API 密钥访问。",
            "Three gorgeous themes: Light, Blue, and Dark.": "三个华丽的主题：浅色、蓝色和黑色。",
            "Three gorgeous themes: light, blue, and black.": "三个华丽的主题：浅色、蓝色和黑色。",
            "You can search for multiple terms at the same time, and this will return only galleries that contain both terms. For example,": "您可以同时搜索多个词条，结果只会返回同时包含这些词条的画廊。例如：",
            "matches all galleries matching": "会匹配所有同时包含",
            " and ": " 和 ",
            "and": "和",
            "You can exclude terms by prefixing them with": "您可以通过添加前缀来排除词条",
            ". For example,": "。例如：",
            "finds all galleries that contain both": "会找到同时包含",
            " but not ": " 但不包含 ",
            "but not": "但不包含",
            "Exact searches can be performed by wrapping terms in double quotes. For example,": "可以使用双引号进行精确搜索。例如：",
            "only matches galleries with \"big breasts\" somewhere in the title or in tags.": "只会匹配标题或标签中出现“big breasts”的画廊。",
            "These can be combined with tag namespaces for finer control over the query:": "这些也可以与标签命名空间组合使用，以更精细地控制查询：",
            "You can search for galleries with a specific number of pages with": "你可以用以下方式搜索特定页数的画廊：",
            ", or with a page range:": "，或者用页数范围：",
            "or with a page range:": "或者用页数范围：",
            "You can search for galleries uploaded within some timeframe with": "你可以用以下方式搜索某个时间范围内上传的画廊：",
            "Valid units are": "有效单位有",
            ". Valid units are": "。有效单位有",
            "You can also specify a range:": "你也可以指定一个范围：",
            "You can use ranges as well:": "你也可以使用范围：",
            ". You can use ranges as well:": "。你也可以使用范围：",
            "Get in touch": "联系我们",
            "General Inquiries:": "一般咨询：",
            "Support:": "支持邮箱：",
            "Abuse:": "滥用举报：",
            "Twitter:": "推特：",
            "Email:": "邮箱：",
            "(if you are having technical issues please include your OS and Browser information plus version numbers)": "（如果你遇到技术问题，请附上操作系统、浏览器及其版本信息）",
            "Thanks for supporting the site!": "感谢你对本站的支持！",
            "Love,": "爱你，",
            "–Team nhentai": "——nhentai 团队",
            "Some areas of the site are protected by a short cryptographic puzzle your browser solves automatically.": "网站的部分区域会受到一种简短的加密谜题保护，该谜题会由你的浏览器自动完成。",
            "This helps deter some automated spam without requiring invasive tracking or third-party services.": "这有助于阻止部分自动化垃圾信息，同时不需要侵入式跟踪或第三方服务。",
            "It typically takes a few seconds on modern devices but may take longer on older hardware.": "在现代设备上通常只需几秒钟，但在较旧的硬件上可能需要更长时间。"
        };

        const liRenderers = {
            'Official domain: nhentai.net': (item, links) => links[0]
                ? `官方域名：${renderAnchor(links[0])}`
                : null,
            'API documentation is available at /api/v2/docs.': (item, links) => links[0]
                ? `API 文档可在 ${renderAnchor(links[0])} 查看。`
                : null,
            'Generate API keys in your account settings to access the API programmatically.': (item, links) => links[0]
                ? `你可以在 ${renderAnchor(links[0], '账户设置')} 中生成 API 密钥，以编程方式访问接口。`
                : null,
            'Have a cool project that needs higher rate limits? Tell us about it at support@nhentai.net.': (item, links) => links[0]
                ? `如果你有很酷的项目需要更高的速率限制，可以发邮件到 ${renderAnchor(links[0])} 告诉我们。`
                : null,
            'General Inquiries: hey@nhentai.net': (item, links) => links[0]
                ? `一般咨询：${renderAnchor(links[0])}`
                : null,
            'Support: support@nhentai.net': (item, links) => links[0]
                ? `支持邮箱：${renderAnchor(links[0])}`
                : null,
            'Abuse: abuse@nhentai.net': (item, links) => links[0]
                ? `滥用举报：${renderAnchor(links[0])}`
                : null,
            'Twitter: @nhentaiOfficial': (item, links) => links[0]
                ? `推特：${renderAnchor(links[0])}`
                : null
        };

        const renderTorOnionItem = (item, links) => {
            if (!item || links.length < 2) return null;
            const lineBreak = item.querySelector('br');
            const hint = item.querySelector('span');
            const emphasize = item.querySelector('u');
            const emphasizedMust = emphasize
                ? renderInline('u', emphasize, '必须')
                : '必须';
            const hintHtml = `${renderInline('span', hint, `你${emphasizedMust}在 Tor 网络中。 ${renderAnchor(links[1], '了解更多')}.`)}`;
            return `Tor 洋葱地址：${renderAnchor(links[0])}。${lineBreak ? renderBreak(lineBreak) : '<br>'} ${hintHtml}`;
        };

        queryAll(infoContainer, 'h2').forEach(header => {
            const text = normalizeInfoText(header.textContent);
            if (headingMap[text]) {
                header.textContent = headingMap[text];
            }
        });

        queryAll(infoContainer, 'li').forEach(item => {
            const text = normalizeInfoText(item.textContent);
            const links = queryAll(item, 'a');
            const renderer = liRenderers[text];

            if (renderer) {
                const html = renderer(item, links);
                if (html) item.innerHTML = html;
                return;
            }

            if (text.includes('You must be inside the tor network.') && links.length >= 2) {
                const html = renderTorOnionItem(item, links);
                if (html) item.innerHTML = html;
                return;
            }

            if (inlineTextMap[text]) {
                item.textContent = inlineTextMap[text];
                return;
            }

            replaceText(item, inlineTextMap);
        });

        const thanksSection = queryOne(infoContainer, '#thanks');
        if (thanksSection) {
            const breaks = queryAll(thanksSection, 'br');
            const heartIcon = queryOne(thanksSection, 'i');
            const firstBreak = breaks[0] ? renderBreak(breaks[0]) : '<br>';
            const secondBreak = breaks[1] ? renderBreak(breaks[1]) : '<br>';
            const heartHtml = heartIcon
                ? `<i${buildAttrString(heartIcon, ['class'])}></i>`
                : '';
            thanksSection.innerHTML = `感谢你对本站的支持！ ${firstBreak} ${heartHtml} 爱你， ${secondBreak} ——nhentai 团队`;
        }
    }

    function translateGalleryDetailMeta(context = document) {
        queryAll(context, '#tags .tag-container').forEach(container => {
            Array.from(container.childNodes).forEach(node => {
                if (node.nodeType !== Node.TEXT_NODE) return;
                const text = node.textContent.trim();
                if (!text) return;
                const translated = Dict.Meta[text.replace(/:$/, '')];
                if (translated) {
                    node.textContent = `${translated}: `;
                }
            });
        });

        refreshDetailQuickBlacklistButtons(context);
    }

    function translateUserSettingsPage(context = document) {
        if (!window.location.href.includes('/user/settings')) return;

        const settingsRoot = context.matches?.('.acc-page') ? context : queryOne(context, '.acc-page');
        if (!settingsRoot) return;

        bindUserSettingsAccordionWatcher();
        if (syncUserSettingsAccordionFromHash(settingsRoot)) {
            scheduleUserSettingsTranslationRefresh(180);
        }

        translateTextNode(settingsRoot);

        queryAll(settingsRoot, 'input, textarea').forEach(field => {
            const placeholder = field.getAttribute('placeholder');
            if (placeholder && uiTranslations[placeholder]) {
                field.setAttribute('placeholder', uiTranslations[placeholder]);
            }
        });

        queryAll(settingsRoot, 'select option').forEach(option => {
            const text = option.textContent.trim();
            if (uiTranslations[text]) {
                option.textContent = uiTranslations[text];
            }
        });

        queryAll(settingsRoot, 'label, button, .btn, a.btn, [role="button"], .acc-page h2, .acc-page h3, .acc-page h4').forEach(el => {
            const text = el.textContent.replace(/\s+/g, ' ').trim();
            if (!text) return;
            if (/^Blacklist Tags\b/i.test(text)) {
                el.textContent = text.replace(/^Blacklist Tags/i, '黑名单标签');
                return;
            }
            if (/^API Keys\b/i.test(text)) {
                el.textContent = text.replace(/^API Keys/i, 'API 密钥');
                return;
            }
            if (/^Sessions\b/i.test(text)) {
                el.textContent = text.replace(/^Sessions/i, '会话');
                return;
            }
            if (/^Signed in\b/i.test(text)) {
                el.textContent = text.replace(/^Signed in/i, '登录于');
                return;
            }
            if (/^Expires\b/i.test(text)) {
                el.textContent = text.replace(/^Expires/i, '过期于');
                return;
            }
            const translated = getUITranslation(text, el);
            if (translated) {
                el.textContent = translated;
            }
        });

        queryAll(settingsRoot, '[role="option"], [role="listbox"] *, .choices__item, .choices__list *, .select2-results__option, .select2-selection__rendered, .ts-dropdown *, .ts-control *').forEach(el => {
            if (el.children.length > 0) return;
            const text = el.textContent.replace(/\s+/g, ' ').trim();
            if (!text) return;
            if (uiTranslations[text]) {
                el.textContent = uiTranslations[text];
            }
        });

        queryAll(settingsRoot, '.acc-danger p').forEach(el => {
            const text = el.textContent.replace(/\s+/g, ' ').trim();
            if (text === 'Permanently delete your account and all associated data. This action is completely irreversible — your account, favorites, comments, and settings will be permanently erased and cannot be recovered.') {
                el.innerHTML = '将永久删除你的账户及所有关联数据。此操作<b>完全不可逆</b>，你的账户、收藏、评论和设置都将被永久清除，且无法恢复。';
            }
        });

        queryAll(settingsRoot, '.key-card-dates > div').forEach(el => {
            const text = el.textContent.replace(/\s+/g, ' ').trim();
            if (/^Signed in\b/i.test(text)) {
                el.textContent = text.replace(/^Signed in/i, '登录于');
                return;
            }
            if (/^Expires\b/i.test(text)) {
                el.textContent = text.replace(/^Expires/i, '过期于');
            }
        });

        if (DB.data?.tag) {
            queryAll(settingsRoot, 'a.tag-name').forEach(el => {
                const href = el.getAttribute('href') || '';
                const ns = detectTagNamespaceFromHref(href);
                if (ns) {
                    translateTagElement(el, ns);
                }
            });
        }

        runContentTranslation(settingsRoot);
        UserSettingsBlacklistFilter.init(settingsRoot);
    }

    function formatAbsoluteDateTime(date) {
        return date.toLocaleString('zh-cn', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }

    function formatRelativeDateTime(date) {
        const diffMs = Date.now() - date.getTime();
        const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));
        const units = [
            { seconds: 365 * 24 * 60 * 60, label: '年' },
            { seconds: 30 * 24 * 60 * 60, label: '个月' },
            { seconds: 7 * 24 * 60 * 60, label: '周' },
            { seconds: 24 * 60 * 60, label: '天' },
            { seconds: 60 * 60, label: '小时' },
            { seconds: 60, label: '分钟' },
            { seconds: 1, label: '秒' }
        ];

        const parts = [];
        let remaining = diffSeconds;

        for (const unit of units) {
            if (parts.length >= 2) break;
            if (remaining < unit.seconds) continue;
            const value = Math.floor(remaining / unit.seconds);
            remaining -= value * unit.seconds;
            parts.push(`${value}${unit.label}`);
        }

        if (!parts.length) return '刚刚';
        return `${parts.join('')}前`;
    }

    function formatConfiguredTimeDisplay(date) {
        const mode = Config.get('uploadTimeDisplayMode') || 'combined';
        const relative = formatRelativeDateTime(date);
        const absolute = formatAbsoluteDateTime(date);

        if (mode === 'relative') return relative;
        if (mode === 'absolute') return absolute;
        return `${relative} (${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()})`;
    }

    function runUITranslation(context = document) {
        if (!Config.get('enableTranslation')) return;
        const loc = window.location.href;
        const indexNamespace = getIndexPageNamespace();

        if (indexNamespace) {
            restoreIndexPageState(context, indexNamespace);
        }

        queryAll(context, "li.desktop > a, ul.dropdown-menu > li > a, .menu-sign-in a, .menu.right a").forEach(item => {
            const txt = item.textContent.trim();
            if (mapMenu[txt]) item.innerHTML = item.innerHTML.replace(txt, mapMenu[txt]);
            else if (uiTranslations[txt]) item.textContent = uiTranslations[txt];
        });

        const sortTypes = queryAll(context, '.sort-type');
        sortTypes.forEach(div => {
            if (div.querySelector('a[data-month-added]')) return;
            const weekBtn = Array.from(div.querySelectorAll('a')).find(a => a.href.includes('popular-week'));
            if (weekBtn) {
                const monthBtn = weekBtn.cloneNode(true);
                monthBtn.href = monthBtn.href.replace('popular-week', 'popular-month');
                monthBtn.textContent = Config.get('enableTranslation') ? '本月' : 'month';
                monthBtn.setAttribute('data-month-added', 'true');
                if (window.location.search.includes('sort=popular-month')) {
                    div.querySelectorAll('a').forEach(a => a.classList.remove('current'));
                    monthBtn.classList.add('current');
                } else {
                    monthBtn.classList.remove('current');
                }
                weekBtn.after(monthBtn);
            }
        });

        queryAll(context, 'time').forEach(t => {
            if (t.dateTime) {
                try {
                    const d = new Date(t.dateTime);
                    t.textContent = formatConfiguredTimeDisplay(d);
                    t.dataset.nhTranslatedTime = '1';
                } catch (e) {}
            }
        });

        queryAll(context, 'h2, .section > h3, #content > h1').forEach(header => {
            let txt = header.textContent.trim();
            if (txt.includes('results')) header.innerHTML = header.innerHTML.replace(/\d+ results?/, match => ` ${match.split(' ')[0]} 个结果`);
            else if (uiTranslations[txt]) header.textContent = uiTranslations[txt];
        });

        queryAll(context, '.advertisement').forEach(ad => ad.remove());

        if (
            window.location.pathname === '/login'
            || loc.includes('/login/')
            || window.location.pathname === '/register'
            || loc.includes('/register/')
            || window.location.pathname === '/reset-password'
            || loc.includes('/reset/')
        ) {
            queryAll(context, 'label, button, .lead').forEach(el => translateTextNode(el));
            queryAll(context, 'input').forEach(inp => {
                const ph = inp.getAttribute('placeholder');
                if (ph && uiTranslations[ph]) inp.setAttribute('placeholder', uiTranslations[ph]);
            });
            queryAll(context, 'form + div a, .login-form a, .register-form a').forEach(a => translateTextNode(a));
            queryAll(context, '#content > div, #content p.lead').forEach(el => translateTextNode(el));
        }

        if (window.location.pathname === '/user/favorites' || loc.includes('/favorites/')) {
            const usernameEl = queryOne(context, '.username');
            const h1 = queryOne(context, '#content h1');
            if (usernameEl && h1 && h1.childNodes.length > 1) {
                h1.childNodes[1].textContent = ` ${usernameEl.textContent.trim()} 的收藏`;
            } else if (h1) {
                h1.textContent = h1.textContent.replace(/^(.+?)'s favorites\b/i, (_, username) => `${username} 的收藏`);
            }
            queryAll(context, '.remove-button, .remove-button > span').forEach(el => {
                 if (el.textContent.trim() === 'Remove') el.textContent = '取消收藏';
             });
        }

        if (loc.includes('/logout/')) {
            queryAll(context, '.container p, #content p').forEach(el => {
                if(el.textContent.includes('Are you sure you want to log out?')) {
                     el.textContent = '真的要注销吗？';
                }
            });

            queryAll(context, 'a').forEach(a => {
                if(a.textContent.toLowerCase().includes('take me back')) {
                     a.textContent = '不，回到之前的页面。';
                }
            });

             queryAll(context, 'button').forEach(btn => {
                if (btn.textContent.toLowerCase().includes('log out')) {
                    btn.childNodes.forEach(child => {
                        if (child.nodeType === Node.TEXT_NODE && child.nodeValue.trim().length > 0) {
                            child.nodeValue = ' 注销';
                        }
                    });
                }
            });
        }

        if ((loc.includes('/users/') && (loc.includes('/edit') || loc.includes('/delete'))) || loc.includes('/user/settings')) {
            queryAll(context, 'label, .btn').forEach(el => translateTextNode(el));
            queryAll(context, 'input').forEach(inp => {
                 const ph = inp.getAttribute('placeholder');
                 if (ph && uiTranslations[ph]) inp.setAttribute('placeholder', uiTranslations[ph]);
             });
            queryAll(context, 'button, .btn, a.btn, [role="button"]').forEach(el => {
                const text = el.textContent.replace(/\s+/g, ' ').trim();
                if (!text) return;
                if (/^Blacklist Tags\b/i.test(text)) {
                    el.textContent = text.replace(/^Blacklist Tags/i, '黑名单标签');
                    return;
                }
                if (/^API Keys\b/i.test(text)) {
                    el.textContent = text.replace(/^API Keys/i, 'API 密钥');
                    return;
                }
                if (/^Sessions\b/i.test(text)) {
                    el.textContent = text.replace(/^Sessions/i, '会话');
                    return;
                }
                if (uiTranslations[text]) {
                    el.textContent = uiTranslations[text];
                }
            });
            const msg = queryOne(context, '.message');
            if (msg && msg.textContent.includes('settings have been updated')) msg.textContent = '您的用户设置已更新';
            const deleteP = queryOne(context, 'p');
            if (deleteP && deleteP.textContent.includes('going to delete')) deleteP.innerHTML = '即将删除账户，<b>此操作无法撤销</b>。';
            translateUserSettingsPage(context);
        }

        if (window.location.pathname === '/user/delete') {
            queryAll(context, '#settings-container h2, #settings-container label, #settings-container a.btn, #settings-container button').forEach(el => {
                const text = el.textContent.replace(/\s+/g, ' ').trim();
                const translated = getUITranslation(text, el);
                if (translated) {
                    el.textContent = translated;
                }
            });
            queryAll(context, '#settings-container p').forEach(el => {
                const text = el.textContent.replace(/\s+/g, ' ').trim();
                if (text === "You're about to delete your account. This cannot be undone.") {
                    el.innerHTML = '你即将删除你的账户。此<b>操作无法撤销</b>。';
                }
            });
        }

        if (loc.includes('/users/') && !loc.includes('/edit')) {
             queryAll(context, '.user-info b').forEach(b => { if(b.textContent.includes('Member since')) b.textContent = '注册日期:'; });
             queryAll(context, '.user-info .fa-heart').forEach(i => { if(i.nextSibling) i.nextSibling.textContent = ' 收藏夹'; });
             queryAll(context, '.user-info .fa-cog').forEach(i => { if(i.nextSibling) i.nextSibling.textContent = ' 设置'; });
             queryAll(context, '.user-info .fa-ban').forEach(i => { if(i.nextSibling) i.nextSibling.textContent = ' 屏蔽的标签'; });

             const recentFav = queryOne(context, '#recent-favorites-container h2');
             if (recentFav && recentFav.childNodes[1]) recentFav.childNodes[1].textContent = ' 最近收藏';

             queryAll(context, '.fa-comments').forEach(i => {
                 if (i.parentNode.tagName === 'H2' || i.parentNode.tagName === 'H3') {
                     if (i.nextSibling && i.nextSibling.textContent.includes('Recent Comments')) {
                         i.nextSibling.textContent = ' 最近评论';
                     }
                 }
             });
        }

        if (loc.includes('/g/')) {
            const favSpan = queryOne(context, '#favorite .text');
            if (favSpan && (favSpan.textContent === 'Favorite' || favSpan.textContent === 'Unfavorite')) {
                favSpan.textContent = uiTranslations[favSpan.textContent];
            }
            const downloadBtn = queryOne(context, '#download');
            if (downloadBtn && downloadBtn.textContent.includes('Download')) downloadBtn.innerHTML = '<i class="fa fa-download"></i> 下载 (种子)';

            queryAll(context, '#show-all-images-button .text').forEach(el => el.textContent = '显示全部');
            queryAll(context, '#show-more-images-button .text').forEach(el => el.textContent = '显示更多');
            queryAll(context, '#related-container h2').forEach(el => el.textContent = '相似推荐');
            translateGalleryDetailMeta(context);

            const commentHeader = queryOne(context, '#comment-post-container h3');
            if (commentHeader && /Post a comment|New Comment/i.test(commentHeader.textContent)) {
                commentHeader.innerHTML = '<i class="fa fa-pencil"></i> 发布评论';
            }
            const postBtn = queryOne(context, '#comment_form .btn');
            if (postBtn && /Comment|Post/i.test(postBtn.textContent)) postBtn.textContent = '评论';
            const commentInput = queryOne(context, '#comment_form textarea');
            if (commentInput && commentInput.getAttribute('placeholder') === 'If you ask for translations, you will die.') {
                commentInput.setAttribute('placeholder', '如果你敢在评论里求翻译，你就死定了。');
            }
            queryAll(context, '#comments, #comments-container, .comment-container, .comments').forEach(container => {
                queryAll(container, 'p, .empty, .empty-comments, .placeholder').forEach(el => {
                    const text = el.textContent.replace(/\s+/g, ' ').trim();
                    if (text === 'No comments yet. Be the first to comment!') {
                        el.textContent = '还没有评论，来成为第一个评论的人吧！';
                    }
                });
            });
        }

        if (window.location.pathname === '/info' || loc.includes('/info/')) {
            translateInfoPage();
        }

        queryAll(context, '.fa-fire').forEach(i => { if(i.parentNode.textContent.includes('Popular')) i.parentNode.innerHTML = '<i class="fa fa-fire"></i> 当前热门'; });
        queryAll(context, '.fa-box-tissue').forEach(i => { if(i.parentNode.textContent.includes('New Uploads')) i.parentNode.innerHTML = '<i class="fa fa-box-tissue"></i> 最新上传'; });

        queryAll(context, '.sort-type, .sort-type a, .sort-type span').forEach(el => translateTextNode(el));

        queryAll(context, '.container > h1, .container > h2').forEach(el => translateTextNode(el));
    }

    const TAG_NAME_SELECTOR = '.tag .name, a.tagchip .name';

    function getTagElementHref(element) {
        const link = element?.closest?.('a');
        return link ? (link.getAttribute('href') || link.href || '') : '';
    }

    function getTagElementRawName(element) {
        if (!element) return '';
        return deriveTagNameFromHref(getTagElementHref(element)) || element.textContent.trim();
    }

    // 先按名称精确匹配；href 推导的名称会把连字符变成空格（x-ray → "x ray"），再按 slug 反查词库原名。
    function lookupTagTranslation(rawName, dbNs, href = '') {
        const enName = rawName.toLowerCase();
        if (DB.data[dbNs]?.[enName]) return { cnName: DB.data[dbNs][enName], rawName };
        if (DB.data.tag?.[enName]) return { cnName: DB.data.tag[enName], rawName };
        if (specialTagValueTranslations[enName]) return { cnName: specialTagValueTranslations[enName], rawName };

        const slug = getTagSlugFromHref(href);
        for (const ns of [dbNs, 'tag']) {
            const key = DB.findKeyBySlug(ns, slug);
            if (key) return { cnName: DB.data[ns][key], rawName: key };
        }
        return null;
    }

    function translateTagElement(element, dbNs, rawNameOverride = '') {
        if (!element || element.dataset.nhTranslated) return;
        const href = getTagElementHref(element);
        const rawNameInput = String(rawNameOverride || getTagElementRawName(element)).trim();
        if (!rawNameInput) return;
        const match = lookupTagTranslation(rawNameInput, dbNs, href);
        if (!match) return;

        const { cnName, rawName } = match;
        element.dataset.nhTranslated = "true";
        element.dataset.nhRawHref = href;
        const mode = Config.get('translationMode');

        if (mode === 'original') {
            // No title attribute set, no hover translation
        } else {
            element.title = rawName;
            if (mode === 'clean') element.textContent = cnName;
            else if (mode === 'replace') element.innerHTML = `${escapeHtml(cnName)} <span class="nh-original-tag">${escapeHtml(rawName)}</span>`;
            else element.innerHTML = `${escapeHtml(rawName)} <span class="nh-translated-tag">${escapeHtml(cnName)}</span>`;
        }
    }

    function getIndexPageNamespace(pathname = window.location.pathname) {
        if (pathname.startsWith('/tags')) return 'tag';
        if (pathname.startsWith('/artists')) return 'artist';
        if (pathname.startsWith('/characters')) return 'character';
        if (pathname.startsWith('/parodies')) return 'parody';
        if (pathname.startsWith('/groups')) return 'group';
        if (pathname.startsWith('/languages')) return 'language';
        return null;
    }

    function getIndexPageHeading(namespace) {
        const headingKeyMap = {
            tag: 'Tags',
            artist: 'Artists',
            character: 'Characters',
            parody: 'Parodies',
            group: 'Groups',
            language: 'Languages'
        };
        const key = headingKeyMap[namespace];
        if (!key) return null;
        return Config.get('enableTranslation') ? (uiTranslations[key] || key) : key;
    }

    function decodeTagSlug(rawValue) {
        if (!rawValue) return '';
        return decodeURIComponent(rawValue)
            .replace(/\+/g, ' ')
            .replace(/-/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // 与站点标签 URL 的 slug 规则对齐（同 Django slugify）：去掉非 ASCII 单词字符，空白与连字符合并为 "-"。
    function slugifyTagName(name) {
        return String(name || '')
            .normalize('NFKD')
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/[-\s]+/g, '-')
            .replace(/^[-_]+|[-_]+$/g, '');
    }

    function getTagSlugFromHref(href) {
        if (!href) return '';
        try {
            const parts = new URL(href, window.location.origin).pathname.split('/').filter(Boolean);
            return parts.length >= 2 ? decodeURIComponent(parts[1]).toLowerCase() : '';
        } catch (error) {
            return '';
        }
    }

    function deriveTagNameFromHref(href, fallbackNs = null) {
        if (!href) return '';
        try {
            const url = new URL(href, window.location.origin);
            const parts = url.pathname.split('/').filter(Boolean);
            if (parts.length < 2) return '';
            const namespace = detectTagNamespaceFromHref(url.pathname, fallbackNs);
            if (!namespace) return '';
            return decodeTagSlug(parts[1]);
        } catch (error) {
            return '';
        }
    }

    function restoreIndexPageState(context = document, namespace = getIndexPageNamespace()) {
        if (!namespace) return;

        const heading = getIndexPageHeading(namespace);
        queryAll(context, '#content > h1').forEach(header => {
            if (heading) {
                header.textContent = heading;
            }
        });

        queryAll(context, TAG_NAME_SELECTOR).forEach(element => {
            // 未改写过的节点由站点维护文本，原样保留（slug 无法还原连字符等字符）。
            if (!element.dataset.nhTranslated) return;
            if (element.title) {
                // href 未变时 title 即原文；节点被复用到其它标签时才退回按 href 推导。
                const href = getTagElementHref(element);
                const original = element.dataset.nhRawHref === href
                    ? element.title
                    : deriveTagNameFromHref(href, namespace);
                if (!original) return;
                element.textContent = original;
            }
            element.removeAttribute('data-nh-translated');
            element.removeAttribute('data-nh-raw-href');
            element.removeAttribute('title');
        });
    }

    function resetTagTranslationState(context = document) {
        queryAll(context, `${TAG_NAME_SELECTOR}[data-nh-translated]`).forEach(element => {
            const original = element.getAttribute('title');
            if (original) {
                element.textContent = original;
            }
            element.removeAttribute('data-nh-translated');
            element.removeAttribute('data-nh-raw-href');
            element.removeAttribute('title');
        });
    }

    function runContentTranslation(context = document) {
        if (!Config.get('enableTranslation') || !DB.data.tag) return;

        const globalNs = getIndexPageNamespace();
        if (globalNs) {
            restoreIndexPageState(context, globalNs);
        }

        const processContainer = (container) => {
            const ns = detectTagNamespaceFromText(container.textContent);
            container.querySelectorAll(`.tags ${TAG_NAME_SELECTOR}`).forEach(el => translateTagElement(el, ns));
        };
        if (context.classList && context.classList.contains('tag-container')) processContainer(context);
        else queryAll(context, '.tag-container').forEach(processContainer);

        const processTag = (el) => {
            const link = el.closest('a');
            const href = link ? (link.getAttribute('href') || '') : '';
            const ns = detectTagNamespaceFromHref(href, globalNs);
            translateTagElement(el, ns, deriveTagNameFromHref(href, ns));
        };
        queryAll(context, TAG_NAME_SELECTOR).forEach(processTag);

        if (window.location.pathname.startsWith('/user/settings')) {
            queryAll(context, 'a.tag-name').forEach(el => {
                const href = el.getAttribute('href') || '';
                const ns = detectTagNamespaceFromHref(href);
                if (ns) {
                    translateTagElement(el, ns, deriveTagNameFromHref(href, ns));
                }
            });
        }

        const titleSpan = queryOne(context, 'span.name');
        if (titleSpan && !titleSpan.dataset.nhTranslated && DB.data.tag[titleSpan.textContent.toLowerCase()]) {
            translateTagElement(titleSpan, 'tag');
        }
    }

    function getGalleryNodes(context = document) {
        const unique = new Set();
        const collect = (node) => {
            if (!node) return;
            if (node.classList && node.classList.contains('gallery')) {
                unique.add(node);
            }
            if (node.querySelectorAll) {
                node.querySelectorAll(GALLERY_SELECTORS.gallery).forEach(gallery => unique.add(gallery));
            }
        };

        if (Array.isArray(context) || context instanceof Set) {
            Array.from(context).forEach(collect);
        } else {
            collect(context);
        }

        return Array.from(unique);
    }

    const SiteBlacklist = {
        tagSet: new Set(),
        syncTimer: null,
        syncAttempts: 0,
        maxSyncAttempts: 12,
        hasSyncedOnce: false,
        hookedOptions: null,
        patchedArray: null,

        getApp() {
            return window._n_app ?? window.n ?? null;
        },

        applyCurrentBlacklistState() {
            this.apply(document);
            refreshDetailQuickBlacklistButtons(document);
        },

        replaceTagSet(nextSet) {
            let changed = nextSet.size !== this.tagSet.size;
            if (!changed) {
                for (const tagId of nextSet) {
                    if (!this.tagSet.has(tagId)) {
                        changed = true;
                        break;
                    }
                }
            }

            const firstSync = !this.hasSyncedOnce;
            this.hasSyncedOnce = true;
            this.tagSet = nextSet;
            // 不在这里回写页面：来源是页面时回写会触发 blacklisted_tags setter → syncFromPage → 无限递归。
            return changed || firstSync;
        },

        syncFromPage() {
            const app = this.getApp();
            const rawList = app?.options?.blacklisted_tags;
            if (!Array.isArray(rawList)) {
                return false;
            }

            const nextSet = new Set(
                rawList
                    .map(tagId => Number(tagId))
                    .filter(tagId => Number.isFinite(tagId) && tagId > 0)
            );
            return this.replaceTagSet(nextSet);
        },

        async syncFromApi() {
            try {
                const data = await requestNhentaiApiJson(API_ENDPOINTS.blacklistIds, {
                    method: 'GET'
                });
                const rawList = Array.isArray(data)
                    ? data
                    : (Array.isArray(data?.ids)
                        ? data.ids
                        : (Array.isArray(data?.result) ? data.result : null));
                if (!Array.isArray(rawList)) {
                    return false;
                }
                const nextSet = new Set(
                    rawList
                        .map(tagId => Number(tagId))
                        .filter(tagId => Number.isFinite(tagId) && tagId > 0)
                );
                const changed = this.replaceTagSet(nextSet);
                // API 是页面之外的来源，需要同步回页面；随后的 setter → syncFromPage 读到同一集合，不会再回写。
                syncBlacklistAppOptions(nextSet);
                return changed;
            } catch (error) {
                return false;
            }
        },

        applyDiff(added = [], removed = []) {
            const nextSet = new Set(this.tagSet);
            added.forEach(tagId => {
                const normalized = Number(tagId);
                if (Number.isFinite(normalized) && normalized > 0) {
                    nextSet.add(normalized);
                }
            });
            removed.forEach(tagId => {
                const normalized = Number(tagId);
                if (Number.isFinite(normalized) && normalized > 0) {
                    nextSet.delete(normalized);
                }
            });
            this.hasSyncedOnce = true;
            this.tagSet = nextSet;
            syncBlacklistAppOptions(nextSet);
        },

        patchBlacklistArray(arrayRef) {
            if (!Array.isArray(arrayRef) || this.patchedArray === arrayRef) return;
            const methods = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'];
            methods.forEach(methodName => {
                const original = arrayRef[methodName];
                if (typeof original !== 'function' || original.__nhPatched) return;
                const wrapped = (...args) => {
                    const result = original.apply(arrayRef, args);
                    const changed = this.syncFromPage();
                    if (changed) this.applyCurrentBlacklistState();
                    return result;
                };
                wrapped.__nhPatched = true;
                arrayRef[methodName] = wrapped;
            });
            this.patchedArray = arrayRef;
        },

        hookAppOptions() {
            const app = this.getApp();
            const options = app?.options;
            if (!options || this.hookedOptions === options) {
                this.patchBlacklistArray(options?.blacklisted_tags);
                return;
            }

            const descriptor = Object.getOwnPropertyDescriptor(options, 'blacklisted_tags');
            if (descriptor && descriptor.configurable === false) {
                this.hookedOptions = options;
                this.patchBlacklistArray(options.blacklisted_tags);
                return;
            }

            let currentValue = options.blacklisted_tags;
            Object.defineProperty(options, 'blacklisted_tags', {
                configurable: true,
                enumerable: true,
                get: () => currentValue,
                set: (nextValue) => {
                    currentValue = nextValue;
                    this.patchBlacklistArray(currentValue);
                    const changed = this.syncFromPage();
                    if (changed) this.applyCurrentBlacklistState();
                }
            });
            this.hookedOptions = options;
            this.patchBlacklistArray(currentValue);
        },

        parseGalleryTags(gallery) {
            const rawTags = gallery?.dataset?.tags || gallery?.getAttribute?.('data-tags') || '';
            const rawMetaTags = gallery?.dataset?.nhTagIds || '';
            const source = `${rawTags} ${rawMetaTags}`.trim();
            if (!source) return [];
            return source
                .split(/\s+/)
                .map(tagId => Number(tagId))
                .filter(tagId => Number.isFinite(tagId) && tagId > 0);
        },

        isBlacklistedGallery(gallery) {
            if (!Config.get('enableFullBlacklistHide')) return false;
            if (gallery?.dataset?.nhBlacklisted === 'true') return true;
            if (!this.tagSet.size) return false;
            const tags = this.parseGalleryTags(gallery);
            return tags.some(tagId => this.tagSet.has(tagId));
        },

        applyToGallery(gallery) {
            if (!gallery) return;
            syncGalleryNodeMetaState(gallery);
            gallery.classList.remove(GALLERY_STATE_CLASSES.blacklisted);
            if (this.isBlacklistedGallery(gallery)) {
                gallery.classList.add(GALLERY_STATE_CLASSES.blacklisted);
            }
        },

        apply(context = document) {
            const galleries = getGalleryNodes(context);
            if (!galleries.length) return;
            galleries.forEach(gallery => this.applyToGallery(gallery));
        },

        scheduleSync(delay = 300) {
            if (this.syncTimer) return;
            this.syncTimer = setTimeout(async () => {
                this.syncTimer = null;
                this.syncAttempts += 1;
                this.hookAppOptions();
                let synced = this.syncFromPage();
                if (!synced && isUserLoggedIn()) {
                    synced = await this.syncFromApi();
                }
                if (synced) {
                    this.applyCurrentBlacklistState();
                }

                if (!this.hasSyncedOnce && this.syncAttempts < this.maxSyncAttempts) {
                    this.scheduleSync(Math.min(1800, delay + 200));
                }
            }, delay);
        },

        init() {
            this.syncAttempts = 0;
            this.hasSyncedOnce = false;
            this.hookedOptions = null;
            this.patchedArray = null;
            this.hookAppOptions();
            this.scheduleSync(120);
        }
    };

    function applyGalleryVisibility(galleries, langIds = Config.get('langFilter')) {
        if (!galleries.length) return;
        const showAllLangs = langIds.length === 0 || langIds.length === 3;

        galleries.forEach(gallery => {
            gallery.classList.remove(GALLERY_STATE_CLASSES.hidden);
            SiteBlacklist.applyToGallery(gallery);

            if (!showAllLangs && !resolveGalleryLanguageMatch(gallery, langIds)) {
                gallery.classList.add(GALLERY_STATE_CLASSES.hidden);
            }
        });
    }

    function runLanguageFilter(context = document, langIds = Config.get('langFilter')) {
        const galleries = getGalleryNodes(context);
        if (galleries.length === 0) return;
        applyGalleryVisibility(galleries, langIds);
    }

    function refreshGalleryEnhancements(
        context = document,
        { translate = false, metaData = NhentaiUserscriptBridge.getData() } = {}
    ) {
        GalleryMeta.refresh(context, metaData);
        const galleries = getGalleryNodes(context);
        if (!galleries.length) {
            if (translate) runContentTranslation(context);
            return;
        }
        applyGalleryVisibility(galleries);
        galleries.forEach(initPreviewUI);
        if (translate) runContentTranslation(context);
    }

    function resetSingleGalleryEnhancementState(gallery) {
        if (!gallery) return;

        if (hoveredGallery === gallery) {
            hoveredGallery = null;
        }
        if (typeof resetPreviewPopupSession === 'function') {
            resetPreviewPopupSession(true);
        } else if (typeof hidePreviewPopup === 'function') {
            hidePreviewPopup(true);
        }
        gallery.classList.remove(
            GALLERY_STATE_CLASSES.hidden,
            GALLERY_STATE_CLASSES.blacklisted,
            GALLERY_STATE_CLASSES.previewing
        );
        delete gallery.dataset.init;
        delete gallery.dataset.gid;
        delete gallery.dataset.tagsLoaded;
        delete gallery.dataset.nhTagIds;
        delete gallery.dataset.nhBlacklisted;

        const cover = gallery.querySelector(GALLERY_SELECTORS.coverLink);
        if (cover) {
            delete cover.dataset.pageProcessed;
            queryAll(cover, '.nh-page-number, .inline-preview-ui').forEach(node => node.remove());
        }
        queryAll(gallery, '.nh-page-number').forEach(node => {
            if (node.parentElement !== cover) node.remove();
        });
    }

    function resetGalleryEnhancementState(context = document) {
        const galleries = getGalleryNodes(context);
        if (!galleries.length) return;

        hoveredGallery = null;
        if (hoverTimeout) {
            clearTimeout(hoverTimeout);
            hoverTimeout = null;
        }
        states.clear();

        galleries.forEach(gallery => {
            resetSingleGalleryEnhancementState(gallery);
        });
    }

    const OBSERVED_GALLERY_CLASS_IGNORES = new Set([
        'downloaded',
        'uncensored'
    ]);

    function normalizeObservedGalleryClassName(className = '') {
        return String(className)
            .split(/\s+/)
            .filter(token => (
                token
                && token !== GALLERY_STATE_CLASSES.previewing
                && !token.startsWith('nh-')
                && !token.startsWith('nhentai-helper-')
                && !OBSERVED_GALLERY_CLASS_IGNORES.has(token)
            ))
            .sort()
            .join(' ');
    }

    let routeRefreshGeneration = 0;
    let routeRefreshTimers = [];
    let userscriptRouteUnsubscribe = null;
    let routeWatcherIntervalId = 0;

    function clearScheduledRouteRefresh() {
        routeRefreshTimers.forEach(timer => clearTimeout(timer));
        routeRefreshTimers = [];
    }

    function runRouteRefreshPass(generation, { resetGalleryState = false } = {}) {
        if (generation !== routeRefreshGeneration) return;
        if (typeof resetPreviewPopupSession === 'function') {
            resetPreviewPopupSession(true);
        } else if (typeof hidePreviewPopup === 'function') {
            hidePreviewPopup(true);
        }
        if (resetGalleryState) {
            resetGalleryEnhancementState(document);
        }
        resetTagTranslationState(document);
        refreshNavbarUI();
        runUITranslation(document);
        refreshGalleryEnhancements(document, { translate: true });
        InfiniteScroll.init();
        ReadingMode.refresh();
    }

    function scheduleRouteRefresh({ source = 'fallback' } = {}) {
        routeRefreshGeneration += 1;
        const generation = routeRefreshGeneration;
        clearScheduledRouteRefresh();

        const passes = source === 'userscript'
            ? [
                { delay: 0, resetGalleryState: true },
                { delay: 220, resetGalleryState: false }
            ]
            : [
                { delay: 0, resetGalleryState: true },
                { delay: 300, resetGalleryState: false },
                { delay: 1200, resetGalleryState: false }
            ];

        routeRefreshTimers = passes.map(pass => setTimeout(() => {
            runRouteRefreshPass(generation, pass);
        }, pass.delay));
    }

    function syncRouteRefreshFromUserscript(data = NhentaiUserscriptBridge.getData()) {
        const pageName = NhentaiUserscriptBridge.getCurrentPageName(data);
        if (!pageName) return;
        if (isRouteRefreshSuppressed()) return;
        const nextUrl = location.href;
        if (nextUrl === lastObservedUrl) return;
        syncObservedUrl(nextUrl);
        scheduleRouteRefresh({ source: 'userscript' });
    }

    function handlePotentialRouteChange() {
        if (location.href === lastObservedUrl) return;
        if (isRouteRefreshSuppressed()) {
            syncObservedUrl(location.href);
            return;
        }
        syncObservedUrl(location.href);
        scheduleRouteRefresh();
    }

    function initRouteWatcher() {
        const wrapHistoryMethod = (methodName) => {
            const original = history[methodName];
            if (typeof original !== 'function' || original.__nhWrapped) return;

            const wrapped = function(...args) {
                const result = original.apply(this, args);
                handlePotentialRouteChange();
                return result;
            };
            wrapped.__nhWrapped = true;
            history[methodName] = wrapped;
        };

        wrapHistoryMethod('pushState');
        wrapHistoryMethod('replaceState');
        window.addEventListener('popstate', handlePotentialRouteChange);
        if (!routeWatcherIntervalId) {
            const hasUserscriptUpdate = Boolean(NhentaiUserscriptBridge.getApi()?.onUpdate);
            routeWatcherIntervalId = setInterval(handlePotentialRouteChange, hasUserscriptUpdate ? 1200 : 400);
        }
        if (!userscriptRouteUnsubscribe) {
            userscriptRouteUnsubscribe = NhentaiUserscriptBridge.onUpdate((data) => {
                syncRouteRefreshFromUserscript(data);
            });
        }
    }

    // ===== 6. 无限滚动与预览共享状态 =====
    const MAX_PREVIEW_STATES = 600;
    const states = new Map();
    let hoveredGallery = null;
    let hoverTimeout = null;
    let lastObservedUrl = location.href;
    let suppressRouteRefreshUntil = 0;
    let suppressedRouteUrl = '';

    function normalizeRouteUrl(url = location.href) {
        try {
            const parsed = new URL(url, location.origin);
            return `${parsed.pathname}${parsed.search}`;
        } catch (error) {
            return String(url || '');
        }
    }

    function suppressRouteRefresh(duration = 1500, routeUrl = location.href) {
        suppressRouteRefreshUntil = Date.now() + duration;
        suppressedRouteUrl = normalizeRouteUrl(routeUrl);
    }

    function isRouteRefreshSuppressed(url = location.href) {
        if (Date.now() >= suppressRouteRefreshUntil) return false;
        return normalizeRouteUrl(url) === suppressedRouteUrl;
    }

    function syncObservedUrl(url = location.href) {
        lastObservedUrl = url;
    }

    function recordInfiniteScrollDebug(key, value) {
        if (typeof Diagnostics === 'undefined') return;
        Diagnostics.recordInfiniteScrollDebug?.(key, value);
    }

    function getInfiniteScrollDebug() {
        if (typeof Diagnostics === 'undefined') return {};
        return Diagnostics.getInfiniteScrollDebug?.() || {};
    }

    function resetInfiniteScrollDebug() {
        if (typeof Diagnostics === 'undefined') return;
        Diagnostics.resetInfiniteScrollDebug?.();
    }

    const InfiniteScroll = {
        observer: null,
        sentinel: null,
        scrollHandler: null,
        userscriptPaginationUnsubscribe: null,
        nextUrl: '',
        status: 'idle',
        loading: false,
        pendingRequestUrl: '',
        pendingRequestToken: '',
        lastLoadedPageUrl: '',
        userScrolledSinceInit: false,
        inputIntentSinceInit: false,
        visibilityCheckTimers: [],
        nextUrlRecoveryTimers: [],
        paginationRecoveryAttempts: 0,
        lastAttemptAt: 0,
        currentListKey: '',
        basePageNumber: 0,
        originRouteUrl: '',
        loadedUrls: new Set(),
        wheelHandler: null,
        middleClickHandler: null,
        generation: 0,
        requestSerial: 0,

        isListPage() {
            if (!Config.get('enableInfiniteScroll')) return false;
            if (/^\/g\/\d+/.test(location.pathname)) return false;
            return getGalleryNodes(document).length > 0;
        },

        getContentRoot() {
            return document.getElementById('content');
        },

        getListKey() {
            const url = new URL(location.href);
            url.searchParams.delete('page');
            return `${url.pathname}?${url.searchParams.toString()}`;
        },

        getCurrentRouteUrl() {
            return `${location.pathname}${location.search}`;
        },

        markActivationSource(source = '') {
            if (!source) return;
            recordInfiniteScrollDebug('lastActivationSource', source);
        },

        recordResetReason(reason = '') {
            if (!reason) return;
            recordInfiniteScrollDebug('lastResetReason', reason);
        },

        getTailPagination(root = document) {
            if (!root) return null;

            const directChildren = Array.from(root.children || []);
            for (let index = directChildren.length - 1; index >= 0; index--) {
                const node = directChildren[index];
                if (node?.matches?.(GALLERY_SELECTORS.pagination)) {
                    return node;
                }
            }

            const paginations = queryAll(root, GALLERY_SELECTORS.pagination);
            return paginations.length ? paginations[paginations.length - 1] : null;
        },

        getNextUrl(root = document) {
            const pagination = this.getTailPagination(root);
            const nextLink = pagination?.querySelector?.('a.next') || null;
            return nextLink?.href || '';
        },

        deriveImplicitNextUrl() {
            const isHome = location.pathname === '/' && !new URL(location.href).searchParams.has('page');
            if (!isHome) return '';
            return `${location.origin}/?page=2`;
        },

        deriveUserscriptNextUrl(pagination = null) {
            const pageInfo = pagination || NhentaiUserscriptBridge.getData()?.pagination || null;
            const currentPage = Number(pageInfo?.page || 0);
            const totalPages = Number(pageInfo?.numPages || 0);
            if (!Number.isFinite(currentPage) || !Number.isFinite(totalPages) || currentPage <= 0 || totalPages <= 0) {
                return '';
            }
            if (currentPage >= totalPages) return '';
            return NhentaiUserscriptBridge.buildPageUrl(currentPage + 1);
        },

        syncNextUrlFromDom(root = this.getContentRoot(), { preserveWhenMissing = false, source = 'dom' } = {}) {
            const nextUrl = this.getNextUrl(root) || this.deriveUserscriptNextUrl() || this.deriveImplicitNextUrl();
            recordInfiniteScrollDebug('lastNextUrlSyncSource', `${source}:${nextUrl ? 'hit' : 'miss'}${!nextUrl && preserveWhenMissing ? ':preserved' : ''}`);
            if (nextUrl || !preserveWhenMissing) {
                this.nextUrl = nextUrl;
            }
            return this.nextUrl;
        },

        syncNextUrlFromUserscriptPagination(pagination = null) {
            if (!this.isListPage()) return;
            const nextUrl = this.deriveUserscriptNextUrl(pagination);
            if (!nextUrl && this.hasNextPage()) return;
            this.nextUrl = nextUrl;
            if (!this.isLoadingState()) {
                this.syncStatusByNextUrl();
            } else {
                this.updateSentinelState();
            }
        },

        hasUserScrollActivation() {
            return this.loadedUrls.size > 0
                || this.userScrolledSinceInit
                || this.inputIntentSinceInit
                || window.scrollY > 8
        },

        clearScheduledVisibilityChecks() {
            this.visibilityCheckTimers.forEach(timer => clearTimeout(timer));
            this.visibilityCheckTimers = [];
        },

        clearScheduledNextUrlRecovery() {
            this.nextUrlRecoveryTimers.forEach(timer => clearTimeout(timer));
            this.nextUrlRecoveryTimers = [];
        },

        resetPaginationRecovery() {
            this.paginationRecoveryAttempts = 0;
        },

        scheduleVisibilityChecks() {
            this.clearScheduledVisibilityChecks();
            const delays = [120, 360, 900];
            this.visibilityCheckTimers = delays.map(delay => setTimeout(() => {
                this.checkSentinelVisibility(`visibility-${delay}`);
            }, delay));
        },

        recoverNextUrlFromDom() {
            if (this.isLoadingState() || !this.isListPage()) return false;
            const contentRoot = this.getContentRoot();
            if (!contentRoot) return false;
            const nextUrl = this.syncNextUrlFromDom(contentRoot, { preserveWhenMissing: false, source: 'recovery-window' });
            if (!nextUrl) return false;
            this.ensureSentinel(contentRoot);
            this.syncStatusByNextUrl();
            this.ensureFallbackListener();
            this.observe();
            return true;
        },

        scheduleNextUrlRecoveryChecks() {
            this.clearScheduledNextUrlRecovery();
            const delays = [120, 360, 900, 1600];
            const generation = this.generation;
            this.nextUrlRecoveryTimers = delays.map(delay => setTimeout(() => {
                if (generation !== this.generation) return;
                const recovered = this.recoverNextUrlFromDom();
                if (recovered) {
                    this.clearScheduledNextUrlRecovery();
                }
            }, delay));
        },

        hasNextPage() {
            return Boolean(this.nextUrl);
        },

        isLoadingState() {
            return this.status === 'loading';
        },

        nextGeneration() {
            this.generation += 1;
            this.requestSerial = 0;
            this.pendingRequestToken = '';
            return this.generation;
        },

        createRequestToken() {
            const token = `${this.generation}:${++this.requestSerial}`;
            this.pendingRequestToken = token;
            return token;
        },

        isRequestTokenActive(token) {
            return Boolean(token) && token === this.pendingRequestToken;
        },

        setStatus(status, { sentinelState = '' } = {}) {
            this.status = status;
            this.loading = status === 'loading';
            if (status !== 'loading') {
                this.pendingRequestUrl = '';
                this.pendingRequestToken = '';
            }
            this.updateSentinelState(sentinelState);
        },

        syncStatusByNextUrl({ sentinelState = '' } = {}) {
            this.setStatus(this.hasNextPage() ? 'idle' : 'done', { sentinelState });
        },

        getStats() {
            const isListPage = this.isListPage();
            const contentRoot = this.getContentRoot();
            const sentinelText = this.sentinel?.textContent?.replace(/\s+/g, ' ').trim() || '';
            return {
                isListPage,
                currentRouteUrl: this.getCurrentRouteUrl(),
                currentListKey: this.currentListKey || (isListPage ? this.getListKey() : ''),
                nextUrl: this.nextUrl || '',
                pendingRequestUrl: this.pendingRequestUrl || '',
                pendingRequestToken: this.pendingRequestToken || '',
                lastLoadedPageUrl: this.lastLoadedPageUrl || '',
                status: this.status,
                loading: this.loading,
                userScrolledSinceInit: this.userScrolledSinceInit,
                inputIntentSinceInit: this.inputIntentSinceInit,
                loadedUrlCount: this.loadedUrls.size,
                sentinelPresent: Boolean(this.sentinel && this.sentinel.isConnected),
                sentinelText,
                basePageNumber: this.basePageNumber,
                originRouteUrl: this.originRouteUrl || '',
                paginationRecoveryAttempts: this.paginationRecoveryAttempts,
                hasPaginationContext: Boolean(this.getTailPagination(contentRoot)),
                hasAppendedPageNodes: this.hasAppendedPageNodes(contentRoot),
                ...getInfiniteScrollDebug(),
                generation: this.generation
            };
        },

        getPageNumberFromUrl(url = location.href) {
            try {
                const parsedUrl = new URL(url, location.origin);
                const page = Number(parsedUrl.searchParams.get('page') || '1');
                return Number.isFinite(page) && page > 0 ? page : 1;
            } catch (error) {
                return 1;
            }
        },

        getPageMarkerText(pageNumber) {
            return getUIText('infinite_page_marker').replace('{page}', String(Number(pageNumber) || 1));
        },

        createPageMarker(pageNumber) {
            const marker = document.createElement('div');
            marker.className = 'nh-scroll-page-marker';
            marker.dataset.pageNumber = String(pageNumber);
            marker.textContent = this.getPageMarkerText(pageNumber);
            return marker;
        },

        markInfiniteAppended(node) {
            if (!node) return node;
            node.dataset.nhInfiniteAppended = '1';
            return node;
        },

        hasAppendedPageNodes(contentRoot = this.getContentRoot()) {
            return Boolean(queryOne(contentRoot, '[data-nh-infinite-appended="1"]'));
        },

        removeAppendedPageNodes(contentRoot = this.getContentRoot()) {
            if (!contentRoot) return;
            queryAll(contentRoot, '[data-nh-infinite-appended="1"]').forEach(node => node.remove());
        },

        removeExistingPagination(contentRoot) {
            queryAll(contentRoot, GALLERY_SELECTORS.pagination).forEach(pagination => pagination.remove());
            const sentinel = contentRoot.querySelector('#nh-infinite-sentinel');
            sentinel?.remove();
        },

        clearPageMarkers(contentRoot = this.getContentRoot()) {
            if (!contentRoot) return;
            queryAll(contentRoot, '.nh-scroll-page-marker').forEach(marker => marker.remove());
        },

        ensureInitialPageMarker(contentRoot) {
            const firstContainer = queryOne(contentRoot, GALLERY_SELECTORS.listContainer);
            if (!firstContainer) return;
            const pageNumber = this.getPageNumberFromUrl(location.href);
            const isImplicitHomePageOne = location.pathname === '/' && !new URL(location.href).searchParams.has('page') && pageNumber === 1;
            if (isImplicitHomePageOne) return;
            const existingMarker = firstContainer.previousElementSibling;
            if (existingMarker?.classList?.contains('nh-scroll-page-marker')) {
                existingMarker.dataset.pageNumber = String(pageNumber);
                existingMarker.textContent = this.getPageMarkerText(pageNumber);
                return;
            }
            firstContainer.before(this.createPageMarker(pageNumber));
        },

        ensureSentinel(contentRoot) {
            if (!this.sentinel || !this.sentinel.isConnected) {
                this.sentinel = document.createElement('div');
                this.sentinel.id = 'nh-infinite-sentinel';
            }
            contentRoot.appendChild(this.sentinel);
            this.updateSentinelState();
        },

        updateSentinelState(state = '') {
            if (!this.sentinel) return;
            this.sentinel.classList.remove('is-loading', 'is-error', 'is-done');

            let key = 'infinite_ready';
            if (state === 'syncing') {
                key = 'infinite_sync';
            } else if (state === 'error' || this.status === 'error') {
                key = 'infinite_error';
                this.sentinel.classList.add('is-error');
            } else if (state === 'loading' || this.isLoadingState()) {
                key = 'infinite_loading';
                this.sentinel.classList.add('is-loading');
            } else if (state === 'done' || this.status === 'done' || !this.hasNextPage()) {
                key = 'infinite_done';
                this.sentinel.classList.add('is-done');
            }

            this.sentinel.textContent = getUIText(key);
        },

        disconnectObserver() {
            if (this.observer) {
                this.observer.disconnect();
            }
        },

        setLoading(loading, state = '') {
            this.setStatus(loading ? 'loading' : 'idle', { sentinelState: state });
        },

        normalizeNewGalleryNodes(container) {
            queryAll(container, GALLERY_SELECTORS.gallery).forEach(gallery => {
                queryAll(gallery, 'img').forEach(img => {
                    const actualSrc = img.getAttribute('data-src') || img.dataset?.src || img.getAttribute('src');
                    if (actualSrc) img.setAttribute('src', actualSrc);
                });
            });
        },

        observe() {
            if (!this.sentinel || !this.hasNextPage()) return;
            if (!this.observer) {
                this.observer = new IntersectionObserver(entries => {
                    if (entries.some(entry => entry.isIntersecting) && this.hasUserScrollActivation()) {
                        this.markActivationSource('observer');
                        this.loadNextPage();
                    }
                }, { rootMargin: '300px 0px' });
            }
            this.disconnectObserver();
            this.observer.observe(this.sentinel);
            this.checkSentinelVisibility('observe-initial');
            this.scheduleVisibilityChecks();
        },

        ensureFallbackListener() {
            if (!this.scrollHandler) {
                this.scrollHandler = debounce(() => {
                    if (window.scrollY > 8) {
                        this.userScrolledSinceInit = true;
                        this.markActivationSource('scroll');
                    }
                    this.checkSentinelVisibility('scroll');
                }, 80);
                window.addEventListener('scroll', this.scrollHandler, { passive: true });
                window.addEventListener('resize', this.scrollHandler, { passive: true });
            }
            if (!this.wheelHandler) {
                this.wheelHandler = (event) => {
                    if (event.deltaY <= 0) return;
                    this.inputIntentSinceInit = true;
                    this.markActivationSource('wheel');
                    this.checkSentinelVisibility('wheel');
                };
                window.addEventListener('wheel', this.wheelHandler, { passive: true });
            }
            if (!this.middleClickHandler) {
                this.middleClickHandler = (event) => {
                    if (event.button !== 1) return;
                    this.inputIntentSinceInit = true;
                    this.markActivationSource('middle-click');
                    this.scheduleVisibilityChecks();
                    this.checkSentinelVisibility('middle-click');
                };
                window.addEventListener('mousedown', this.middleClickHandler, { passive: true });
            }
        },

        checkSentinelVisibility(source = 'manual-check') {
            if (!this.sentinel || !this.hasNextPage() || this.isLoadingState() || !this.hasUserScrollActivation()) return;
            const rect = this.sentinel.getBoundingClientRect();
            if (rect.top <= window.innerHeight + 520) {
                this.markActivationSource(source);
                this.loadNextPage();
            }
        },

        cleanup({ keepLoadedUrls = false } = {}) {
            const contentRoot = this.getContentRoot();
            this.nextGeneration();
            this.disconnectObserver();
            if (this.observer) {
                this.observer = null;
            }
            if (this.scrollHandler) {
                window.removeEventListener('scroll', this.scrollHandler);
                window.removeEventListener('resize', this.scrollHandler);
                this.scrollHandler = null;
            }
            if (this.wheelHandler) {
                window.removeEventListener('wheel', this.wheelHandler);
                this.wheelHandler = null;
            }
            if (this.middleClickHandler) {
                window.removeEventListener('mousedown', this.middleClickHandler);
                this.middleClickHandler = null;
            }
            if (this.userscriptPaginationUnsubscribe) {
                this.userscriptPaginationUnsubscribe();
                this.userscriptPaginationUnsubscribe = null;
            }
            if (this.sentinel?.isConnected) {
                this.sentinel.remove();
            }
            this.sentinel = null;
            if (contentRoot) {
                this.removeAppendedPageNodes(contentRoot);
                this.clearPageMarkers(contentRoot);
            }
            this.clearScheduledVisibilityChecks();
            this.clearScheduledNextUrlRecovery();
            this.status = 'idle';
            this.loading = false;
            this.pendingRequestUrl = '';
            this.pendingRequestToken = '';
            this.lastLoadedPageUrl = '';
            this.userScrolledSinceInit = false;
            this.inputIntentSinceInit = false;
            this.nextUrl = '';
            this.lastAttemptAt = 0;
            this.currentListKey = '';
            this.basePageNumber = 0;
            this.originRouteUrl = '';
            this.resetPaginationRecovery();
            resetInfiniteScrollDebug();
            if (!keepLoadedUrls) {
                this.loadedUrls.clear();
            }
        },

        parseNextPageDocument(htmlText) {
            const parsed = new DOMParser().parseFromString(htmlText, 'text/html');
            return {
                parsed,
                container: queryOne(parsed, GALLERY_SELECTORS.listContainer),
                pagination: queryOne(parsed, GALLERY_SELECTORS.pagination)
            };
        },

        appendLoadedPage(contentRoot, container, pagination, pageNumber) {
            this.removeExistingPagination(contentRoot);
            const shouldWrapSearchGrid = container.matches?.('.gallery-grid');
            const pageMarker = this.markInfiniteAppended(this.createPageMarker(pageNumber));

            if (shouldWrapSearchGrid) {
                const wrapper = this.markInfiniteAppended(document.createElement('div'));
                wrapper.className = 'container';
                wrapper.appendChild(pageMarker);
                this.markInfiniteAppended(container);
                wrapper.appendChild(container);
                contentRoot.appendChild(wrapper);
            } else {
                contentRoot.appendChild(pageMarker);
                this.markInfiniteAppended(container);
                contentRoot.appendChild(container);
                if (pagination) {
                    this.markInfiniteAppended(pagination);
                    contentRoot.appendChild(pagination);
                    runUITranslation(pagination);
                }
            }
            this.ensureSentinel(contentRoot);
            refreshGalleryEnhancements(container, { translate: true });
        },

        syncRouteAfterAppend(requestUrl) {
            suppressRouteRefresh(2200, requestUrl);
            // 保留站点原有 history state，避免后退时 URL 已变化但路由状态丢失。
            history.replaceState(history.state, '', requestUrl);
            syncObservedUrl(requestUrl);
        },

        finishLoadWithObserver() {
            this.syncStatusByNextUrl();
            this.clearScheduledNextUrlRecovery();
            if (this.hasNextPage()) {
                this.observe();
            } else {
                this.disconnectObserver();
            }
        },

        handleLoadError(error) {
            this.clearScheduledVisibilityChecks();
            this.clearScheduledNextUrlRecovery();
            this.setStatus('error');
            console.error('[nHentai Pro] Infinite scroll failed:', error);
            if (this.observer && this.sentinel) {
                const generation = this.generation;
                this.disconnectObserver();
                setTimeout(() => {
                    if (generation !== this.generation) return;
                    if (this.sentinel?.isConnected && this.hasNextPage() && !this.isLoadingState()) {
                        this.syncStatusByNextUrl();
                        this.observe();
                    }
                }, 1200);
            }
        },

        handleDuplicateNextUrl(contentRoot, requestUrl) {
            const syncedNextUrl = this.syncNextUrlFromDom(contentRoot, {
                preserveWhenMissing: false,
                source: 'duplicate-next-url'
            });

            if (syncedNextUrl && syncedNextUrl !== requestUrl && !this.loadedUrls.has(syncedNextUrl)) {
                this.syncStatusByNextUrl();
                this.observe();
                return;
            }

            if (syncedNextUrl === requestUrl) {
                this.nextUrl = '';
                this.setStatus('idle', { sentinelState: 'syncing' });
                this.disconnectObserver();
                this.scheduleNextUrlRecoveryChecks();
                return;
            }

            this.nextUrl = '';
            this.setStatus('done');
            this.disconnectObserver();
        },

        resetForList(contentRoot, listKey, nextUrl) {
            this.cleanup();
            this.currentListKey = listKey;
            this.basePageNumber = this.getPageNumberFromUrl(location.href);
            this.originRouteUrl = this.getCurrentRouteUrl();
            this.removeAppendedPageNodes(contentRoot);
            this.clearPageMarkers(contentRoot);
            this.nextUrl = nextUrl || '';
            this.syncNextUrlFromDom(contentRoot, { preserveWhenMissing: false, source: 'reset-for-list' });
            this.ensureInitialPageMarker(contentRoot);
        },

        buildInitContext(contentRoot = this.getContentRoot()) {
            const listKey = this.getListKey();
            const tailPagination = this.getTailPagination(contentRoot);
            const nextUrl = this.getNextUrl(contentRoot) || this.deriveUserscriptNextUrl() || this.deriveImplicitNextUrl();
            const currentRouteUrl = this.getCurrentRouteUrl();
            const hasAppendedNodes = this.hasAppendedPageNodes(contentRoot);
            const hasPaginationContext = Boolean(tailPagination || nextUrl);
            const normalizedLastLoadedPageUrl = this.lastLoadedPageUrl ? normalizeRouteUrl(this.lastLoadedPageUrl) : '';
            const normalizedOriginRouteUrl = this.originRouteUrl ? normalizeRouteUrl(this.originRouteUrl) : '';
            return {
                contentRoot,
                listKey,
                tailPagination,
                nextUrl,
                currentRouteUrl,
                hasAppendedNodes,
                hasPaginationContext,
                normalizedLastLoadedPageUrl,
                normalizedOriginRouteUrl
            };
        },

        sameContextSync(context) {
            this.recordResetReason('same_context_sync');
            this.syncNextUrlFromDom(context.contentRoot, { preserveWhenMissing: true, source: 'same-context-sync' });
            this.ensureFallbackListener();
            this.ensureSentinel(context.contentRoot);
            if (!this.isLoadingState()) {
                this.syncStatusByNextUrl();
            } else {
                this.updateSentinelState();
            }
            if (this.isLoadingState()) return;
            if (this.hasNextPage()) this.observe();
            else this.disconnectObserver();
        },

        sameContextReset(context, reason = 'same_context_reset') {
            this.recordResetReason(reason);
            this.resetForList(context.contentRoot, context.listKey, context.nextUrl);
            this.ensureFallbackListener();
            this.ensureSentinel(context.contentRoot);
            if (!this.hasNextPage()) {
                this.setStatus('idle', { sentinelState: 'syncing' });
                this.scheduleNextUrlRecoveryChecks();
                return;
            }
            this.syncStatusByNextUrl();
            this.observe();
        },

        newContextReset(context) {
            this.recordResetReason('new_context_reset');
            this.resetForList(context.contentRoot, context.listKey, context.nextUrl);
            this.ensureFallbackListener();
            this.ensureSentinel(context.contentRoot);
            if (!this.hasNextPage()) {
                this.setStatus('idle', { sentinelState: 'syncing' });
                this.scheduleNextUrlRecoveryChecks();
                return;
            }
            this.syncStatusByNextUrl();
            this.observe();
        },

        async loadNextPage() {
            if (this.isLoadingState() || !this.hasNextPage()) return;

            const now = Date.now();
            if (now - this.lastAttemptAt < 600) return;
            this.lastAttemptAt = now;

            const contentRoot = this.getContentRoot();
            if (!contentRoot) {
                this.cleanup();
                return;
            }

            const requestUrl = this.nextUrl;
            if (this.loadedUrls.has(requestUrl)) {
                this.handleDuplicateNextUrl(contentRoot, requestUrl);
                return;
            }

            const requestToken = this.createRequestToken();
            this.pendingRequestUrl = requestUrl;
            this.setStatus('loading');

            try {
                const res = await fetch(requestUrl, { credentials: 'same-origin' });
                if (!this.isRequestTokenActive(requestToken)) return;
                if (!res.ok) {
                    throw new Error(res.statusText || `HTTP ${res.status}`);
                }

                const htmlText = await res.text();
                if (!this.isRequestTokenActive(requestToken)) return;
                const { container, pagination } = this.parseNextPageDocument(htmlText);

                if (!container) {
                    throw new Error('Infinite scroll container not found');
                }

                const latestContentRoot = this.getContentRoot();
                if (!latestContentRoot || !this.isRequestTokenActive(requestToken)) {
                    return;
                }

                const pageNumber = this.getPageNumberFromUrl(requestUrl);
                this.loadedUrls.add(requestUrl);
                this.lastLoadedPageUrl = requestUrl;
                this.resetPaginationRecovery();
                this.nextUrl = pagination?.querySelector('a.next')?.href || '';
                this.normalizeNewGalleryNodes(container);

                this.appendLoadedPage(latestContentRoot, container, pagination, pageNumber);
                if (!this.isRequestTokenActive(requestToken)) return;
                this.syncNextUrlFromDom(latestContentRoot, { preserveWhenMissing: true });
                this.syncRouteAfterAppend(requestUrl);
                this.finishLoadWithObserver();
            } catch (error) {
                if (!this.isRequestTokenActive(requestToken)) return;
                this.handleLoadError(error);
            }
        },

        init(force = false) {
            if (!this.isListPage()) {
                this.cleanup();
                return;
            }

            if (!this.userscriptPaginationUnsubscribe) {
                this.userscriptPaginationUnsubscribe = NhentaiUserscriptBridge.onPagination((pagination) => {
                    this.syncNextUrlFromUserscriptPagination(pagination);
                });
            }

            const contentRoot = this.getContentRoot();
            if (!contentRoot) {
                this.cleanup();
                return;
            }

            const context = this.buildInitContext(contentRoot);

            if (!context.hasPaginationContext && !context.nextUrl) {
                this.paginationRecoveryAttempts += 1;
                if (this.paginationRecoveryAttempts <= 4) {
                    this.ensureFallbackListener();
                    this.ensureSentinel(context.contentRoot);
                    this.setStatus('idle', { sentinelState: 'syncing' });
                    this.scheduleNextUrlRecoveryChecks();
                    this.recordResetReason('pagination_recovery_wait');
                    return;
                }
                this.cleanup();
                this.removeAppendedPageNodes(context.contentRoot);
                this.clearPageMarkers(context.contentRoot);
                this.recordResetReason('non_paginated_list');
                return;
            }

            this.resetPaginationRecovery();

            const shouldResetSameList = !force
                && this.currentListKey === context.listKey
                && context.hasAppendedNodes
                && context.normalizedLastLoadedPageUrl
                && context.currentRouteUrl !== context.normalizedLastLoadedPageUrl;

            if (!force && this.currentListKey === context.listKey && !shouldResetSameList) {
                this.sameContextSync(context);
                return;
            }

            if (!force && this.currentListKey === context.listKey && shouldResetSameList) {
                this.sameContextReset(context);
                return;
            }

            this.newContextReset(context);
        }
    };

    const RuntimeMetrics = {
        cacheHit: 0,
        cacheMiss: 0,
        fetchOk: 0,
        fetch429: 0,
        fetchAbort: 0,
        fetchError: 0,
        prefetchScheduled: 0,
        prefetchSkipped: 0,
        pageListFetch: 0,
        failureTimestamps: [],
        recordFailure(now = Date.now()) {
            this.failureTimestamps.push(now);
            this.pruneFailures(now);
        },
        pruneFailures(now = Date.now()) {
            const threshold = now - 60 * 1000;
            while (this.failureTimestamps.length && this.failureTimestamps[0] < threshold) {
                this.failureTimestamps.shift();
            }
        },
        getRecentFailureCount() {
            this.pruneFailures();
            return this.failureTimestamps.length;
        },
        getCacheHitRate() {
            const total = this.cacheHit + this.cacheMiss;
            return total > 0 ? (this.cacheHit / total) : 0;
        }
    };

    // 完整画廊元数据缓存只由 GalleryMeta implementation 管理。
    const cache = new LRUCache(500);

    function isCompleteMeta(meta) {
        return Boolean(
            meta
            && meta.mediaId
            && Number(meta.total || 0) > 0
            && Array.isArray(meta.pages)
            && meta.pages.length > 0
            && meta.pages.every(page => page?.path)
        );
    }

    // GalleryMeta 内部 transport：集中浏览器/HTTP 依赖，便于测试时替换。
    const GalleryMetaTransport = {
        now() {
            return Date.now();
        },
        sleep(ms) {
            const delay = Math.max(0, Number(ms) || 0);
            if (delay <= 0) return Promise.resolve();
            return new Promise(resolve => setTimeout(resolve, delay));
        },
        fetch(url, options) {
            return fetch(url, options);
        },
        createAbortController() {
            return new AbortController();
        }
    };

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

    const PageMetaResolver = {
        activeSignature: '',
        activeEntry: null,
        inFlightSignature: '',
        inFlightPromise: null,
        tagIdCache: new Map(),
        failedSignature: '',
        failedAt: 0,
        cacheTtlMs: 20 * 1000,
        failureCooldownMs: 6 * 1000,

        isFresh(entry) {
            return Boolean(entry && (Date.now() - entry.fetchedAt) < this.cacheTtlMs);
        },

        getContext() {
            const pathname = location.pathname;
            const searchParams = new URLSearchParams(location.search);
            const page = Math.max(1, Number(searchParams.get('page') || '1'));
            const sort = searchParams.get('sort') || 'date';

            if (pathname === '/') {
                return {
                    type: 'home',
                    signature: `home:${page}:${sort}`,
                    page,
                    sort
                };
            }

            if (/^\/search\/?$/.test(pathname)) {
                const query = searchParams.get('q') || '';
                return {
                    type: 'search',
                    signature: `search:${query}:${page}:${sort}`,
                    page,
                    sort,
                    query
                };
            }

            const namespaceMatch = pathname.match(/^\/(tag|artist|group|parody|character|language|category)\/([^/]+)\/?$/);
            if (namespaceMatch) {
                return {
                    type: 'namespace',
                    signature: `namespace:${namespaceMatch[1]}:${namespaceMatch[2]}:${page}:${sort}`,
                    namespace: namespaceMatch[1],
                    slug: namespaceMatch[2],
                    page,
                    sort
                };
            }

            if (
                pathname === '/user/favorites'
                || /^\/favorites\/?$/.test(pathname)
                || /^\/users\/[^/]+\/favorites\/?$/.test(pathname)
            ) {
                return {
                    type: 'favorites',
                    signature: `favorites:${pathname}:${page}`,
                    page
                };
            }

            if (/^\/users\/[^/]+\/?$/.test(pathname)) {
                return {
                    type: 'profile',
                    signature: `profile:${pathname}:${page}`,
                    page
                };
            }

            return null;
        },

        unwrapList(payload) {
            if (Array.isArray(payload)) return payload;
            if (Array.isArray(payload?.result)) return payload.result;
            if (Array.isArray(payload?.items)) return payload.items;
            if (Array.isArray(payload?.galleries)) return payload.galleries;
            if (Array.isArray(payload?.data)) return payload.data;
            return [];
        },

        unwrapObject(payload) {
            if (!payload || typeof payload !== 'object') return null;
            if (payload.id) return payload;
            if (payload.result && typeof payload.result === 'object') return payload.result;
            if (payload.data && typeof payload.data === 'object') return payload.data;
            return null;
        },

        hasAllTargets(entry, targetIds = []) {
            if (!entry?.byId || !Array.isArray(targetIds) || targetIds.length === 0) return true;
            return targetIds.every(id => entry.byId.has(String(id)));
        },

        getStoredMeta(entry, id, allowPartial = false) {
            if (!entry?.byId || !id) return null;
            const record = entry.byId.get(String(id));
            if (!record) return null;
            if (!allowPartial && !record.complete) return null;
            return record.meta || null;
        },

        hasRecentFailure(signature) {
            if (!signature || this.failedSignature !== signature) return false;
            return this.failedAt > 0 && (Date.now() - this.failedAt) < this.failureCooldownMs;
        },

        rememberFailure(signature) {
            this.failedSignature = signature;
            this.failedAt = Date.now();
        },

        getActiveEntry(signature = this.getContext()?.signature) {
            if (!signature || this.activeSignature !== signature) return null;
            return this.activeEntry;
        },

        getUserscriptMeta(id, { allowPartial = false } = {}) {
            const currentGalleryMeta = NhentaiUserscriptBridge.getCurrentGalleryMeta(id);
            if (currentGalleryMeta && (allowPartial || isCompleteMeta(currentGalleryMeta))) {
                return currentGalleryMeta;
            }
            return null;
        },

        seedFromUserscriptContext(context = this.getContext(), data = NhentaiUserscriptBridge.getData()) {
            if (!context) return null;
            const entries = NhentaiUserscriptBridge.getCurrentListEntries(context, data);
            if (!entries.length) return null;
            return this.storeEntries(context.signature, entries);
        },

        async fetchJson(endpoint) {
            return requestNhentaiApiJson(endpoint, { method: 'GET' });
        },

        async resolveNamespaceTagId(context) {
            const key = `${context.namespace}:${context.slug}`;
            if (this.tagIdCache.has(key)) return this.tagIdCache.get(key);
            const userscriptTagId = NhentaiUserscriptBridge.getCurrentTagId(context);
            if (userscriptTagId > 0) {
                this.tagIdCache.set(key, userscriptTagId);
                return userscriptTagId;
            }
            const payload = await this.fetchJson(`/api/v2/tags/${context.namespace}/${context.slug}`);
            const tagInfo = this.unwrapObject(payload);
            const tagId = Number(tagInfo?.id || 0);
            if (tagId > 0) {
                this.tagIdCache.set(key, tagId);
                return tagId;
            }
            return 0;
        },

        async fetchPageEntries(context) {
            if (!context) return [];
            if (context.type === 'home') {
                return this.unwrapList(await this.fetchJson(`/api/v2/galleries?page=${context.page}`));
            }
            if (context.type === 'search') {
                const query = encodeURIComponent(context.query || '');
                const sort = encodeURIComponent(context.sort || 'date');
                return this.unwrapList(await this.fetchJson(`/api/v2/search?query=${query}&sort=${sort}&page=${context.page}`));
            }
            if (context.type === 'namespace') {
                const tagId = await this.resolveNamespaceTagId(context);
                if (!tagId) return [];
                const sort = encodeURIComponent(context.sort || 'date');
                return this.unwrapList(await this.fetchJson(`/api/v2/galleries/tagged?tag_id=${tagId}&sort=${sort}&page=${context.page}`));
            }
            return [];
        },

        normalizeStoredMeta(entry) {
            const normalized = normalizeGalleryMeta(entry || {});
            return {
                meta: normalized,
                complete: isCompleteMeta(normalized)
            };
        },

        storeEntries(signature, entries) {
            const byId = new Map();
            entries.forEach(entry => {
                const id = String(entry?.id || '');
                if (!id) return;
                const stored = this.normalizeStoredMeta(entry);
                byId.set(id, stored);
                if (stored.complete) {
                    cache.set(id, stored.meta);
                }
            });
            const stored = { signature, fetchedAt: Date.now(), byId };
            this.activeSignature = signature;
            this.activeEntry = stored;
            return stored;
        },

        async ensureContextEntries(targetIds = []) {
            const context = this.getContext();
            if (!context) return null;
            if (this.hasRecentFailure(context.signature)) return null;

            const cachedEntry = this.getActiveEntry(context.signature);
            if (this.isFresh(cachedEntry) && this.hasAllTargets(cachedEntry, targetIds)) return cachedEntry;

            const seededEntry = this.seedFromUserscriptContext(context);
            if (seededEntry && this.hasAllTargets(seededEntry, targetIds)) {
                return seededEntry;
            }
            // 当前页列表已就绪时缺失的 id 不属于这一页（如无限滚动后地址栏已切到下一页），重复请求同一页也拿不到。
            if (seededEntry) return seededEntry;
            if (this.isFresh(cachedEntry)) return cachedEntry;
            if (this.inFlightPromise && this.inFlightSignature === context.signature) return this.inFlightPromise;

            RuntimeMetrics.pageListFetch++;
            const requestPromise = this.fetchPageEntries(context)
                .then(entries => this.storeEntries(context.signature, entries))
                .catch(error => {
                    this.rememberFailure(context.signature);
                    if (Config.get('showDevPanel')) {
                        console.debug('[nHentai Pro] Page meta fetch failed:', context.signature, error);
                    }
                    return null;
                })
                .finally(() => {
                    if (this.inFlightSignature === context.signature) {
                        this.inFlightSignature = '';
                        this.inFlightPromise = null;
                    }
                });

            this.inFlightSignature = context.signature;
            this.inFlightPromise = requestPromise;
            return requestPromise;
        },

        async resolve(id, { allowPartial = false } = {}) {
            const targetId = String(id || '');
            if (!targetId) return null;
            const userscriptMeta = this.getUserscriptMeta(targetId, { allowPartial });
            if (userscriptMeta) {
                cache.set(targetId, userscriptMeta);
                return userscriptMeta;
            }
            const context = this.getContext();
            if (!context) return null;

            const cachedEntry = this.getActiveEntry(context.signature);
            if (this.isFresh(cachedEntry) && cachedEntry.byId.has(targetId)) {
                return this.getStoredMeta(cachedEntry, targetId, allowPartial);
            }

            const entry = await this.ensureContextEntries([targetId]);
            return this.getStoredMeta(entry, targetId, allowPartial);
        },

        prewarm(galleryIds = []) {
            const missingIds = galleryIds
                .map(id => String(id || ''))
                .filter(id => id && !cache.has(id));
            if (!missingIds.length) return;
            return this.ensureContextEntries(missingIds);
        },

        rememberResolvedMeta(id, meta) {
            const context = this.getContext();
            if (!context || !meta || !id) return;
            const entry = this.getActiveEntry(context.signature);
            if (!entry?.byId) return;
            entry.byId.set(String(id), {
                meta,
                complete: true
            });
            entry.fetchedAt = Date.now();
        },

        rememberUserscriptCurrentGallery(data = NhentaiUserscriptBridge.getData()) {
            const gallery = data?.gallery;
            if (!gallery?.id) return null;
            const normalized = normalizeGalleryMeta(gallery);
            if (!isCompleteMeta(normalized)) return null;
            const id = String(gallery.id);
            cache.set(id, normalized);
            this.rememberResolvedMeta(id, normalized);
            return normalized;
        }
    };

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

    // GalleryMeta 是画廊元数据能力的唯一外部 interface。
    // Resolver、RequestQueue、PrefetchManager 与缓存均属于内部 implementation。
    const GalleryMeta = {
        get(id, { priority = 'normal' } = {}) {
            const targetId = String(id || '').trim();
            if (!/^\d+$/.test(targetId)) return Promise.resolve(null);

            if (priority === 'interactive') {
                RequestQueue.prioritize(targetId);
            }
            return getCompleteMeta(targetId, { priority });
        },

        refresh(context = document, data = NhentaiUserscriptBridge.getData()) {
            const pageContext = PageMetaResolver.getContext();
            PageMetaResolver.seedFromUserscriptContext(pageContext, data);
            PageMetaResolver.rememberUserscriptCurrentGallery(data);
            PrefetchManager.init();
            runPageNumberDisplay(context);
            PrefetchManager.scheduleScan(60);
        },

        snapshot() {
            return Object.freeze({
                queue: Object.freeze({ ...RequestQueue.getStats() }),
                prefetch: Object.freeze({ ...PrefetchManager.getStats() })
            });
        }
    };

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

    // ===== 7. 启动流程与动态观察器 =====
    function getTopLevelObservedNodes(liveNodes) {
        return liveNodes.filter((node, index) => {
            if (!node || !document.contains(node)) return false;
            return !liveNodes.some((candidate, candidateIndex) => {
                return candidateIndex !== index
                    && candidate instanceof Node
                    && candidate.contains?.(node);
            });
        });
    }

    function processObservedNodes(liveNodes, { fullRefresh = false } = {}) {
        if (!liveNodes.length) return;

        if (fullRefresh) {
            runUITranslation(document);
            refreshGalleryEnhancements(document, { translate: true });
            ReadingMode.refresh();
            return;
        }

        const topLevelNodes = getTopLevelObservedNodes(liveNodes);
        topLevelNodes.forEach(node => {
            runUITranslation(node);
            runContentTranslation(node);
        });

        refreshGalleryEnhancements(topLevelNodes);
        ReadingMode.refresh();
    }

    // 动态内容更新频繁时，先收集节点再批量处理，避免每次 DOM 变化都全量重跑。
    function createContentObserver() {
        let observerTimeout;
        let pendingNodes = new Set();
        let needsFullRefresh = false;

        const isGalleryRelatedNode = (node) => {
            if (!node || node.nodeType !== 1) return false;
            if (node.closest?.('#info-container') || node.querySelector?.('#info-container')) return true;
            if (node.closest?.('#tags, #tag-container') || node.querySelector?.('#tags, #tag-container')) return true;
            if (node.matches?.('.tag, .sort, h1')) return true;
            if (node.querySelector?.('.tag, .sort, h1')) return true;
            if (node.matches?.(GALLERY_SELECTORS.dynamicRoot)) return true;
            return !!node.querySelector?.(GALLERY_SELECTORS.dynamicRoot);
        };

        return new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                if (mutation.type === 'attributes') {
                    const target = mutation.target;
                    const isGalleryClassMutation = mutation.attributeName === 'class' && target.classList?.contains('gallery');
                    const isCoverHrefMutation = mutation.attributeName === 'href' && target.matches?.(GALLERY_SELECTORS.coverLink);
                    const isIndexTagHrefMutation = mutation.attributeName === 'href' && target.matches?.('a.tag, a.tagchip');

                    if (!isGalleryClassMutation && !isCoverHrefMutation && !isIndexTagHrefMutation) {
                        return;
                    }

                    if (
                        isGalleryClassMutation
                        && normalizeObservedGalleryClassName(mutation.oldValue) === normalizeObservedGalleryClassName(target.className)
                    ) {
                        return;
                    }
                    const gallery = target.closest?.(GALLERY_SELECTORS.gallery);
                    if (gallery) {
                        resetSingleGalleryEnhancementState(gallery);
                        pendingNodes.add(gallery);
                        needsFullRefresh = true;
                        return;
                    }

                    if (isIndexTagHrefMutation) {
                        pendingNodes.add(target.closest?.('#tags, #tag-container') || target);
                        needsFullRefresh = true;
                    }
                    return;
                }

                if (mutation.addedNodes.length > 0) mutation.addedNodes.forEach(node => {
                    // 无限滚动追加的节点已在 appendLoadedPage 中增强过，避免每追加一页都触发整页全量刷新。
                    if (node.dataset?.nhInfiniteAppended === '1') return;
                    if (node.nodeType === 1 && isGalleryRelatedNode(node)) {
                        pendingNodes.add(node);
                        needsFullRefresh = true;
                    }
                });
            });

            clearTimeout(observerTimeout);
            observerTimeout = setTimeout(() => {
                const liveNodes = Array.from(pendingNodes).filter(node => document.contains(node));
                pendingNodes.clear();
                processObservedNodes(liveNodes, { fullRefresh: needsFullRefresh });
                needsFullRefresh = false;
            }, 100);
        });
    }

    function initCoreUI() {
        Styles.inject();
        SiteBlacklist.init();
        Diagnostics.sync();
        setupSettingsUI();
        updatePageSettingsButton();
        setupLanguageFilterUI();
        runLanguageFilter();
        runUITranslation();
        ReadingMode.refresh();
    }

    async function initSearchAndTranslation() {
        // 保持原有策略：先完成词库初始化，再启用搜索联想与内容翻译。
        await DB.init();
        setupSearchUI();
        runContentTranslation();
    }

    function initPageMetaFeatures() {
        CDN.ensure();
        GalleryMeta.refresh(document);
        queryAll(document, GALLERY_SELECTORS.uninitializedGallery).forEach(initPreviewUI);
        InfiniteScroll.init();
    }

    function refreshNavbarUI() {
        const nav = document.querySelector('nav');
        if (!nav) return;
        updatePageSettingsButton();
        setupLanguageFilterUI();
        setupSearchUI();
        runUITranslation(nav);
    }

    function isNavbarRelatedNode(node) {
        if (!node || node.nodeType !== 1) return false;
        if (node.matches?.('nav, .collapse, ul.menu.left, ul.menu.right')) return true;
        return !!node.querySelector?.('nav, .collapse, ul.menu.left, ul.menu.right');
    }

    function createNavbarObserver() {
        let navObserverTimer = null;
        let lastNavFingerprint = '';

        const scheduleNavbarRefresh = () => {
            clearTimeout(navObserverTimer);
            navObserverTimer = setTimeout(() => {
                const nav = document.querySelector('nav');
                const menuLeft = nav?.querySelector('ul.menu.left');
                if (!nav || !menuLeft) return;

                const fingerprint = [
                    menuLeft.childElementCount,
                    Boolean(document.getElementById('nh-web-settings-btn')),
                    Boolean(document.getElementById('nh-lang-filter')),
                    menuLeft.textContent.replace(/\s+/g, ' ').trim()
                ].join('|');

                if (fingerprint === lastNavFingerprint) return;
                lastNavFingerprint = fingerprint;
                refreshNavbarUI();
            }, 80);
        };

        scheduleNavbarRefresh();

        return new MutationObserver((mutations) => {
            const shouldRefresh = mutations.some(mutation => {
                return Array.from(mutation.addedNodes).some(isNavbarRelatedNode)
                    || Array.from(mutation.removedNodes).some(isNavbarRelatedNode);
            });

            if (shouldRefresh) {
                scheduleNavbarRefresh();
            }
        });
    }

    function initDynamicObservers() {
        const observer = createContentObserver();
        const navObserver = createNavbarObserver();
        const contentRoot = document.body || document.documentElement;
        if (contentRoot) {
            observer.observe(contentRoot, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'href'],
                attributeOldValue: true
            });
        }
        navObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        return { observer, navObserver };
    }

    function handlePreviewKeyNavigation(e) {
        // 输入框里的方向键用于移动光标，组合键留给浏览器/站点。
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (isEditableKeyTarget(e.target)) return;
        if (hoveredGallery && !document.fullscreenElement) {
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                updatePreview(hoveredGallery, 1);
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                updatePreview(hoveredGallery, -1);
            }
        }
    }

    function bindGlobalInteractions() {
        document.addEventListener('keydown', handlePreviewKeyNavigation);
    }

    function isUserscriptPageName(data, candidates = []) {
        return NhentaiUserscriptBridge.isPageName(
            NhentaiUserscriptBridge.getCurrentPageName(data),
            candidates
        );
    }

    function isUserscriptListPage(data = NhentaiUserscriptBridge.getData()) {
        return isUserscriptPageName(data, [
            'homepage',
            'search',
            'tagDetail',
            'favorites',
            'userFavorites',
            'profile',
            'userProfile'
        ]);
    }

    function isUserscriptDetailPage(data = NhentaiUserscriptBridge.getData()) {
        return isUserscriptPageName(data, ['galleryDetail', 'gallery']);
    }

    const scheduleUserscriptListRefresh = debounce((data = NhentaiUserscriptBridge.getData()) => {
        if (!isUserscriptListPage(data)) return;
        runUITranslation(document);
        refreshGalleryEnhancements(document, {
            translate: true,
            metaData: data
        });
    }, 80);

    const scheduleUserscriptDetailRefresh = debounce((data = NhentaiUserscriptBridge.getData()) => {
        if (!isUserscriptDetailPage(data)) return;
        resetTagTranslationState(document);
        runUITranslation(document);
        refreshGalleryEnhancements(document, {
            translate: true,
            metaData: data
        });
        void refreshDetailQuickBlacklistButtons(document);
        ReadingMode.refresh();
    }, 80);

    const PageScopedMounts = {
        galleryDetailUnsubscribe: null,
        galleryDataUnsubscribe: null,
        settingsUnsubscribe: null,
        favoritesUnsubscribe: null,
        profileUnsubscribe: null,
        galleriesUnsubscribe: null,
        started: false,

        async init() {
            if (this.started) return;
            this.started = true;
            await NhentaiUserscriptBridge.ready();
            this.galleryDetailUnsubscribe = NhentaiUserscriptBridge.whilePage('galleryDetail', () => {
                ReadingMode.mountGalleryDetail();
                refreshDetailQuickBlacklistButtons(document);
                scheduleUserscriptDetailRefresh();
                return () => {
                    clearDetailQuickBlacklistButtons(document);
                    ReadingMode.unmountGalleryDetail();
                };
            }) || null;

            this.settingsUnsubscribe = NhentaiUserscriptBridge.whilePage('settings', () => {
                UserSettingsBlacklistFilter.init(document);
                return () => {
                    UserSettingsBlacklistFilter.teardown(document);
                };
            }) || null;

            this.favoritesUnsubscribe = NhentaiUserscriptBridge.whilePage('favorites', () => {
                scheduleUserscriptListRefresh();
                return () => {};
            }) || null;

            this.profileUnsubscribe = NhentaiUserscriptBridge.whilePage('profile', () => {
                scheduleUserscriptListRefresh();
                return () => {};
            }) || null;

            this.galleryDataUnsubscribe = NhentaiUserscriptBridge.onGallery((gallery, data) => {
                if (!gallery || !isUserscriptDetailPage(data)) return;
                scheduleUserscriptDetailRefresh(data);
            }) || null;

            this.galleriesUnsubscribe = NhentaiUserscriptBridge.onGalleries((galleries, data) => {
                if (!isUserscriptListPage(data) || !Array.isArray(galleries) || galleries.length === 0) return;
                scheduleUserscriptListRefresh(data);
            }) || null;
        }
    };

    const Bootstrap = {
        runSyncPhase() {
            initCoreUI();
            initPageMetaFeatures();
            initRouteWatcher();
            initDynamicObservers();
            bindGlobalInteractions();
            void PageScopedMounts.init();
        },

        async runAsyncPhase() {
            await initSearchAndTranslation();
            scheduleRouteRefresh();
        },

        async start() {
            console.log('[nHentai Pro] 正在启动...');
            this.runSyncPhase();
            await this.runAsyncPhase();
        }
    };

    async function main() {
        await Bootstrap.start();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
    else main();
})();
