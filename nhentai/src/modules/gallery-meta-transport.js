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
