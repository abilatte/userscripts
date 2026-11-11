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
