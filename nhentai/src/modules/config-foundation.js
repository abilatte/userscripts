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
        enableMetaPersistentCache: true,
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
            if (typeof this.settings.enableMetaPersistentCache !== 'boolean') {
                this.settings.enableMetaPersistentCache = DEFAULT_CONFIG.enableMetaPersistentCache;
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
        saveTimer: null,
        save() {
            if (this.saveTimer) {
                clearTimeout(this.saveTimer);
                this.saveTimer = null;
            }
            GM_setValue('user_settings', JSON.stringify(this.settings));
        },
        // 高频调整（如 Ctrl+滚轮缩放）先改内存值，停止操作后再落盘一次。
        setDeferred(key, val, delay = 400) {
            this.settings[key] = val;
            clearTimeout(this.saveTimer);
            this.saveTimer = setTimeout(() => this.save(), delay);
        },
        // 有待落盘的延迟写入时立即写入（离开页面、退出阅读时调用）。
        flush() {
            if (this.saveTimer) this.save();
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
    window.addEventListener('pagehide', () => Config.flush());

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

