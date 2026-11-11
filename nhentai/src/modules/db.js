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

