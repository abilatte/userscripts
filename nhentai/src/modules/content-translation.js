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
