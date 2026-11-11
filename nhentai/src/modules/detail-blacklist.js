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
