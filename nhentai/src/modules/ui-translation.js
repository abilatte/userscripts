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

