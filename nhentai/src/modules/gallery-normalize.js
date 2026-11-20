    // ===== 3.5 画廊元数据归一化与列表辅助 =====
    const galleryListMetaCache = new LRUCache(1500);

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
        const thumbnail = typeof data.thumbnail === 'string'
            ? data.thumbnail
            : (data.thumbnail?.path || data.cover?.path || '');
        return {
            galleryId: data.id || null,
            mediaId,
            pages,
            total: Number(data.num_pages || data.total_pages) || pages.length,
            tag_ids: tagIds,
            tagIds,
            blacklisted: data.blacklisted === true,
            tags: Array.isArray(data.tags) ? data.tags : [],
            thumbnail,
            thumbnailWidth: Number(data.thumbnail_width || data.thumbnail?.width || data.cover?.width) || 0,
            thumbnailHeight: Number(data.thumbnail_height || data.thumbnail?.height || data.cover?.height) || 0,
            englishTitle: data.english_title || data.title?.english || '',
            japaneseTitle: data.japanese_title || data.title?.japanese || '',
            title: data.title?.english || data.title?.japanese || data.title?.pretty || data.english_title || data.japanese_title || ''
        };
    }

    function rememberGalleryListEntries(entries = []) {
        if (!Array.isArray(entries)) return [];
        const normalizedList = [];
        entries.forEach(entry => {
            const id = String(entry?.id || entry?.galleryId || '');
            if (!id) return;
            const meta = (entry?.galleryId && Array.isArray(entry?.tag_ids))
                ? entry
                : normalizeGalleryMeta(entry);
            galleryListMetaCache.set(id, meta);
            normalizedList.push(meta);
        });
        return normalizedList;
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
        const cached = galleryListMetaCache.get(id);
        if (cached) return cached;
        const data = NhentaiUserscriptBridge.getData();
        if (Array.isArray(data?.galleries) && data.galleries.length) {
            rememberGalleryListEntries(data.galleries);
        }
        if (Array.isArray(data?.gallery?.related) && data.gallery.related.length) {
            rememberGalleryListEntries(data.gallery.related);
        }
        return galleryListMetaCache.get(id) || null;
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
