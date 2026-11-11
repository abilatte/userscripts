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
