// ==UserScript==
// @name         起点小说屏蔽工具
// @name:en      Qidian Novel Blocker
// @namespace    abilatte
// @version      2.1
// @description  屏蔽起点「全部作品」页中不感兴趣的小说：按书籍 ID 精准屏蔽，支持图文/文字两种列表模式，详情页一键屏蔽，管理面板支持搜索、排序、批量移除与导入导出。
// @description:en  Hide unwanted novels on Qidian's "All Works" page by book ID, in both image and text list modes, with a one-click button on detail pages and a management panel supporting search, sorting, batch removal, and import/export.
// @author       abilatte
// @match        https://www.qidian.com/all*
// @match        https://www.qidian.com/book/*
// @noframes
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @license      AGPL-3.0-or-later
// @homepageURL  https://github.com/abilatte/userscripts
// @updateURL    https://raw.githubusercontent.com/abilatte/userscripts/main/Qidian/qidian-novel-blocker.user.js
// @downloadURL  https://raw.githubusercontent.com/abilatte/userscripts/main/Qidian/qidian-novel-blocker.user.js
// ==/UserScript==

(function () {
    "use strict";

    // --- 1. 配置 ---
    const STORAGE_KEY = "qidian_blocked_map_v5";
    const BID_PATTERN = /^\d+$/;
    const HIDDEN_CLASS = "qd-hidden";
    const TOAST_DURATION = 6000;

    // 起点改版时只需要调整这里的选择器
    const SELECTORS = {
        listLayouts: [
            // 图文模式，两列
            { item: "#book-img-text .all-img-list > li", link: ".book-mid-info h2 > a[data-bid]", category: "p.author a:not(.name):not(.go-sub-type)", subCategory: "a.go-sub-type" },
            // 文字模式
            { item: "#book-text .rank-table-list > tbody > tr", link: "a.name[data-bid]", category: "a.type", subCategory: "a.go-sub-type" }
        ],
        detailBtnGroup: ".normal-btn",
        detailTitle: "#bookName",
        detailCategory: { category: ".book-attribute a:not([href*='subCateId'])", subCategory: ".book-attribute a[href*='subCateId']" }
    };

    const PageType = {
        isList: () => /^\/all(\/|$)/.test(location.pathname),
        detailBid: () => {
            const match = location.pathname.match(/^\/book\/(\d+)/);
            return match ? match[1] : null;
        }
    };

    // --- 2. 样式 ---
    GM_addStyle(`
        .${HIDDEN_CLASS} { display: none !important; }

        /* 原站为 float 两列布局，条目隐藏后会错位，改为 flex 换行 */
        #book-img-text .all-img-list { display: flex !important; flex-wrap: wrap; }
        #book-img-text .all-img-list > li { float: none !important; }
        /* 非书籍条目（如无缝翻页脚本插入的分页条）原本靠 clear: both 换行，flex 下改为独占一行。
           用 :has 而不是脚本添加的 class 判断，条目在脚本处理前就能按两列排布 */
        #book-img-text .all-img-list > :not(:has(.book-mid-info)) { flex-basis: 100%; }

        /* 原站用上边框分隔各行，并靠 li:first-child 和 li:first-child + li 去掉首行的上边框。
           隐藏条目或插入分页条后「首行」不再固定，改为每个条目统一用下边框分隔，同一行的条目始终等高 */
        #book-img-text .all-img-list > li:has(.book-mid-info) { border-top: none; padding-top: 0; border-bottom: 1px solid #e6e6e6; margin-bottom: 25px; }

        /* 列表页屏蔽按钮：插在书名链接前并右浮动，文字模式的 a.name 是 block，放在后面会换行 */
        .qd-block-btn { float: right; margin: 2px 0 0 4px; cursor: pointer; font-size: 15px; line-height: 1; opacity: 0.5; transition: opacity 0.2s, transform 0.2s; user-select: none; }
        .qd-block-btn:hover { opacity: 1; transform: scale(1.2); }

        /* 详情页按钮（尺寸对齐站内 .blue-btn-detail） */
        .qd-detail-btn { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; margin-right: 12px; padding: 0; border: 1px solid #e0e0e0; border-radius: 4px; background: #fff; font-size: 20px; cursor: pointer; transition: all 0.2s; }
        .qd-detail-btn:hover { background: #f5f5f5; border-color: #ccc; }
        .qd-detail-btn.is-blocked { background: #fff0f0; border-color: #ed424b; }
        .qd-detail-btn.is-blocked:hover { background: #ed424b; }

        /* 管理面板 */
        .qd-modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 99999; display: flex; justify-content: center; align-items: center; }
        .qd-modal { background: #fff; width: 720px; max-width: calc(100vw - 32px); max-height: 85vh; border-radius: 8px; display: flex; flex-direction: column; box-shadow: 0 5px 25px rgba(0, 0, 0, 0.2); font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 14px; color: #333; }
        .qd-modal-header { padding: 15px 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; background: #f8f8f8; border-radius: 8px 8px 0 0; }
        .qd-modal-title { font-weight: bold; font-size: 16px; }
        .qd-modal-count { font-weight: normal; color: #666; font-size: 13px; margin-left: 5px; }
        .qd-header-btns { display: flex; align-items: center; gap: 8px; }
        .qd-modal-toolbar { padding: 10px 20px; border-bottom: 1px solid #eee; display: flex; align-items: center; gap: 10px; }
        .qd-search-input { flex: 1; padding: 6px 10px; border: 1px solid #ddd; border-radius: 4px; outline: none; }
        .qd-search-input:focus { border-color: #2a87d4; }
        .qd-select { padding: 5px 8px; border: 1px solid #ddd; border-radius: 4px; outline: none; cursor: pointer; background: #fff; font-size: 12px; }
        .qd-batch-bar { padding: 8px 20px; background: #f0f7ff; border-bottom: 1px solid #e1eaf5; display: flex; align-items: center; justify-content: space-between; font-size: 13px; }
        .qd-batch-bar label { cursor: pointer; display: flex; align-items: center; }
        .qd-modal-body { overflow-y: auto; flex: 1; min-height: 200px; }
        .qd-modal-footer { padding: 10px 20px; border-top: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; background: #fafafa; border-radius: 0 0 8px 8px; }
        .qd-pager { display: flex; align-items: center; gap: 10px; }
        .qd-page-info { font-size: 13px; color: #666; }
        .qd-block-item { padding: 10px 20px; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; }
        .qd-block-item:hover { background: #fafafa; }
        .qd-chk { margin: 0 12px 0 0; cursor: pointer; }
        .qd-item-info { flex: 1; display: flex; flex-direction: column; min-width: 0; }
        .qd-item-title { font-weight: 500; color: #333; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .qd-item-title:hover { color: #ed424b; }
        .qd-item-meta { font-size: 12px; color: #999; margin-top: 3px; }
        .qd-btn { padding: 5px 12px; border: 1px solid #ddd; background: #fff; cursor: pointer; border-radius: 4px; font-size: 12px; color: #333; transition: all 0.2s; }
        .qd-btn:hover:not(:disabled) { background: #f5f5f5; border-color: #ccc; }
        .qd-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .qd-btn-danger { color: #ed424b; border-color: #ffdbdb; background: #fff5f5; }
        .qd-btn-danger:hover:not(:disabled) { background: #ed424b; color: #fff; border-color: #ed424b; }
        .qd-btn-close { border: none; font-size: 18px; line-height: 1; padding: 2px 6px; margin-left: 4px; }
        .qd-empty-tip { text-align: center; color: #999; padding: 40px; }

        /* 提示条 */
        .qd-toast { position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%); z-index: 99999; display: flex; align-items: center; gap: 14px; max-width: calc(100vw - 32px); padding: 10px 16px; border-radius: 6px; background: rgba(0, 0, 0, 0.85); color: #fff; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 14px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25); }
        .qd-toast-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .qd-toast-action { flex-shrink: 0; padding: 0; border: none; background: none; color: #ffd666; font-size: 14px; cursor: pointer; }
        .qd-toast-action:hover { text-decoration: underline; }
    `);

    // --- 3. 数据存储 ---
    // 存储格式：{ [bid]: { title, time, category?, subCategory? } }
    // time 为 0 表示旧版本迁移来的记录；分区未知时不写对应字段
    const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

    const Category = {
        build: (category, subCategory) => ({
            ...(category ? { category: category } : {}),
            ...(subCategory ? { subCategory: subCategory } : {})
        }),
        // 文字模式的分区名带有「」装饰
        fromElements: (root, selectors) => {
            const readName = (selector) => {
                const el = root.querySelector(selector);
                return el ? el.textContent.replace(/[「」\s]/g, "") : "";
            };
            return Category.build(readName(selectors.category), readName(selectors.subCategory));
        },
        isMissing: (entry) => !entry.category || !entry.subCategory
    };

    const Storage = {
        _cache: null,
        _listeners: [],

        normalizeEntry: (value) => {
            if (typeof value === "string") {
                const title = value.trim();
                return title ? { title: title, time: 0 } : null;
            }
            if (!value || typeof value !== "object" || Array.isArray(value)) return null;

            const title = typeof value.title === "string" ? value.title.trim() : "";
            if (!title) return null;

            const time = Number(value.time);
            const readName = (name) => (typeof name === "string" ? name.trim() : "");
            return {
                title: title,
                time: Number.isFinite(time) && time > 0 ? time : 0,
                ...Category.build(readName(value.category), readName(value.subCategory))
            };
        },
        // 返回 { map, skipped }，skipped 为无效记录数
        normalize: (rawMap) => {
            const map = {};
            let skipped = 0;
            if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) return { map, skipped };

            Object.keys(rawMap).forEach((bid) => {
                const entry = BID_PATTERN.test(bid) ? Storage.normalizeEntry(rawMap[bid]) : null;
                if (entry) map[bid] = entry;
                else skipped++;
            });
            return { map, skipped };
        },

        getMap: () => {
            if (!Storage._cache) Storage._cache = Storage.normalize(GM_getValue(STORAGE_KEY, {})).map;
            return Storage._cache;
        },
        saveMap: (map) => {
            GM_setValue(STORAGE_KEY, map);
            Storage._cache = map;
            Storage._emit();
        },
        // 其他标签页修改了数据
        syncFromRemote: (rawMap) => {
            Storage._cache = Storage.normalize(rawMap).map;
            Storage._emit();
        },
        onChange: (fn) => Storage._listeners.push(fn),
        _emit: () => Storage._listeners.forEach((fn) => fn()),

        has: (bid) => hasOwn(Storage.getMap(), bid),
        add: (bid, title, category) => {
            if (!BID_PATTERN.test(bid) || !title) throw new Error(`invalid book: ${bid} ${title}`);
            Storage.saveMap({ ...Storage.getMap(), [bid]: { title: title, time: Date.now(), ...category } });
        },
        // 只补缺失的分区字段，已有的不覆盖；没有变化时不写存储，避免 onChange 循环
        fillCategories: (updates) => {
            const map = { ...Storage.getMap() };
            let changed = false;
            Object.keys(updates).forEach((bid) => {
                const entry = map[bid];
                if (!entry) return;
                const next = { ...updates[bid], ...entry };
                if (next.category !== entry.category || next.subCategory !== entry.subCategory) {
                    map[bid] = next;
                    changed = true;
                }
            });
            if (changed) Storage.saveMap(map);
        },
        remove: (bids) => {
            const map = { ...Storage.getMap() };
            bids.forEach((bid) => delete map[bid]);
            Storage.saveMap(map);
        },
        clear: () => Storage.saveMap({}),
        // 合并导入数据，同 ID 以导入数据为准；导入数据没有的分区字段保留现有值
        merge: (incoming) => {
            const current = Storage.getMap();
            const bids = Object.keys(incoming);
            const overwritten = bids.filter((bid) => hasOwn(current, bid)).length;
            const merged = { ...current };
            bids.forEach((bid) => { merged[bid] = { ...current[bid], ...incoming[bid] }; });
            Storage.saveMap(merged);
            return { added: bids.length - overwritten, overwritten };
        }
    };

    // --- 4. 导入导出 ---
    const pad = (n) => String(n).padStart(2, "0");

    function formatDate(timestamp) {
        if (!timestamp) return "历史记录";
        const d = new Date(timestamp);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    const Transfer = {
        exportFile: () => {
            const blob = new Blob([JSON.stringify(Storage.getMap(), null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const d = new Date();
            const a = document.createElement("a");
            a.href = url;
            a.download = `qidian_blocklist_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
            a.click();
            URL.revokeObjectURL(url);
        },
        importFile: () => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".json,application/json";
            input.onchange = () => {
                const file = input.files[0];
                if (file) file.text().then(Transfer.importText, (err) => {
                    console.error("QidianBlocker Import Error:", err);
                    alert("文件读取失败，请重新选择文件。");
                });
            };
            input.click();
        },
        importText: (text) => {
            let raw;
            try {
                raw = JSON.parse(text);
            } catch (err) {
                console.error("QidianBlocker Import Error:", err);
                alert("导入失败：文件不是有效的 JSON。");
                return;
            }
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
                alert("导入失败：数据格式应为 { 书籍ID: { title, time } }。");
                return;
            }

            const { map, skipped } = Storage.normalize(raw);
            if (Object.keys(map).length === 0) {
                alert(`未发现有效记录，已跳过 ${skipped} 条。`);
                return;
            }
            const { added, overwritten } = Storage.merge(map);
            alert(`导入完成：新增 ${added} 条，覆盖 ${overwritten} 条，跳过 ${skipped} 条无效记录。`);
        }
    };

    // --- 5. 提示条 ---
    // 同一时间只显示一条，带一个操作按钮，超时自动消失
    const Toast = {
        el: null,
        timer: 0,

        show: (message, actionLabel, onAction) => {
            Toast.hide();
            const el = document.createElement("div");
            el.className = "qd-toast";
            const text = document.createElement("span");
            text.className = "qd-toast-text";
            text.textContent = message;
            const action = document.createElement("button");
            action.type = "button";
            action.className = "qd-toast-action";
            action.textContent = actionLabel;
            action.onclick = () => {
                Toast.hide();
                onAction();
            };
            el.append(text, action);
            document.body.appendChild(el);
            Toast.el = el;
            Toast.timer = setTimeout(Toast.hide, TOAST_DURATION);
        },
        hide: () => {
            clearTimeout(Toast.timer);
            if (Toast.el) Toast.el.remove();
            Toast.el = null;
        }
    };

    // --- 6. 列表页（全部作品） ---
    const ListPage = {
        apply: () => {
            const map = Storage.getMap();
            const categoryUpdates = {};
            SELECTORS.listLayouts.forEach((layout) => {
                // 列表中可能混有无缝翻页脚本插入的分页条，只有整组都找不到书籍链接时才视为选择器失效
                let found = 0;
                let missing = 0;
                document.querySelectorAll(layout.item).forEach((item) => {
                    const link = item.querySelector(layout.link);
                    const bid = link ? link.dataset.bid : "";
                    if (!BID_PATTERN.test(bid)) {
                        missing++;
                        return;
                    }
                    found++;
                    const blocked = hasOwn(map, bid);
                    item.classList.toggle(HIDDEN_CLASS, blocked);
                    // 被隐藏的条目仍在 DOM 中，顺手补全旧记录的分区
                    if (blocked && Category.isMissing(map[bid])) {
                        categoryUpdates[bid] = Category.fromElements(item, layout);
                    }
                    if (!item.querySelector(".qd-block-btn")) {
                        link.before(ListPage.createButton(bid, link, item, layout));
                    }
                });
                // 页面解析期间条目可能还不完整，等解析结束后再判断
                if (missing && !found && document.readyState !== "loading") {
                    console.warn(`QidianBlocker: ${missing} 个条目均未找到书籍链接`, layout);
                }
            });
            Storage.fillCategories(categoryUpdates);
        },
        // 条目出现后在同一轮渲染前处理，避免被屏蔽的书先显示再消失：
        // - 页面解析期间条目是分段出现的（li 先于其中的书名链接），每批 DOM 变更都处理一次
        // - 解析结束后只关心新增条目，例如 Pagetual 等无缝翻页脚本追加的下一页
        watch: (onItemsChanged) => {
            const itemSelector = SELECTORS.listLayouts.map((layout) => layout.item).join(", ");
            const isItemNode = (node) => node.nodeType === Node.ELEMENT_NODE &&
                (node.matches(itemSelector) || node.querySelector(itemSelector) !== null);
            new MutationObserver((mutations) => {
                if (document.readyState === "loading" || mutations.some((m) => Array.from(m.addedNodes).some(isItemNode))) {
                    onItemsChanged();
                }
            }).observe(document, { childList: true, subtree: true });
        },
        // 书名和分区在点击时才读取：按钮可能在条目还没解析完整时就已创建
        createButton: (bid, link, item, layout) => {
            const btn = document.createElement("span");
            btn.className = "qd-block-btn";
            btn.textContent = "🚫";
            btn.title = "屏蔽此书";
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const title = (link.getAttribute("title") || link.textContent).trim();
                if (!title) {
                    alert("未能读取书名，屏蔽失败。");
                    return;
                }
                Storage.add(bid, title, Category.fromElements(item, layout));
                Toast.show(`已屏蔽《${title}》`, "撤销", () => Storage.remove([bid]));
            });
            return btn;
        }
    };

    // --- 7. 详情页 ---
    const DetailPage = {
        apply: (bid) => {
            let btn = document.getElementById("qd-detail-btn");
            if (!btn) {
                const group = document.querySelector(SELECTORS.detailBtnGroup);
                if (!group) {
                    console.warn("QidianBlocker: 未找到详情页按钮区域", SELECTORS.detailBtnGroup);
                    return;
                }
                btn = document.createElement("button");
                btn.id = "qd-detail-btn";
                btn.type = "button";
                btn.className = "qd-detail-btn";
                btn.addEventListener("click", () => DetailPage.toggle(bid));
                group.appendChild(btn);
            }

            const blocked = Storage.has(bid);
            btn.textContent = blocked ? "🚫" : "🛡️";
            btn.title = blocked ? "已屏蔽，点击取消" : "屏蔽此书";
            btn.classList.toggle("is-blocked", blocked);
            if (blocked && Category.isMissing(Storage.getMap()[bid])) {
                Storage.fillCategories({ [bid]: Category.fromElements(document, SELECTORS.detailCategory) });
            }
        },
        toggle: (bid) => {
            if (Storage.has(bid)) {
                Storage.remove([bid]);
                return;
            }
            const titleEl = document.querySelector(SELECTORS.detailTitle);
            const title = titleEl ? titleEl.textContent.trim() : "";
            if (!title) {
                alert("未能读取书名，屏蔽失败。");
                return;
            }
            Storage.add(bid, title, Category.fromElements(document, SELECTORS.detailCategory));
        }
    };

    // --- 8. 管理面板 ---
    const UNKNOWN_CATEGORY = "__unknown__";

    const Panel = {
        state: {
            searchText: "",
            sortType: "timeDesc", // timeDesc | timeAsc | title
            categoryFilter: "", // "" 表示全部，UNKNOWN_CATEGORY 表示未知分区
            subCategoryFilter: "",
            selectedIds: new Set(),
            currentPage: 1,
            pageSize: 50
        },
        els: null,

        open: () => {
            if (Panel.els) return;
            Object.assign(Panel.state, { searchText: "", categoryFilter: "", subCategoryFilter: "", currentPage: 1 });
            Panel.state.selectedIds.clear();

            const overlay = document.createElement("div");
            overlay.className = "qd-modal-overlay";
            overlay.innerHTML = `
                <div class="qd-modal">
                    <div class="qd-modal-header">
                        <span class="qd-modal-title">🛡️ 屏蔽管理<span class="qd-modal-count" data-el="count"></span></span>
                        <div class="qd-header-btns">
                            <button class="qd-btn" data-el="import">导入</button>
                            <button class="qd-btn" data-el="export">导出</button>
                            <button class="qd-btn qd-btn-danger" data-el="clear">全部移除</button>
                            <button class="qd-btn qd-btn-close" data-el="close" title="关闭">×</button>
                        </div>
                    </div>
                    <div class="qd-modal-toolbar">
                        <input type="text" class="qd-search-input" data-el="search" placeholder="搜索书名或ID...">
                        <select class="qd-select" data-el="categoryFilter" title="大分区"></select>
                        <select class="qd-select" data-el="subCategoryFilter" title="小分区"></select>
                        <select class="qd-select" data-el="sort">
                            <option value="timeDesc">时间倒序</option>
                            <option value="timeAsc">时间正序</option>
                            <option value="title">书名排序</option>
                        </select>
                    </div>
                    <div class="qd-batch-bar">
                        <label><input type="checkbox" class="qd-chk" data-el="selectAll">全选当前页</label>
                        <button class="qd-btn qd-btn-danger" data-el="batchDel" disabled>批量移除</button>
                    </div>
                    <div class="qd-modal-body" data-el="body"></div>
                    <div class="qd-modal-footer">
                        <select class="qd-select" data-el="pageSize">
                            <option value="20">20 条/页</option>
                            <option value="50">50 条/页</option>
                            <option value="100">100 条/页</option>
                            <option value="200">200 条/页</option>
                        </select>
                        <div class="qd-pager">
                            <button class="qd-btn" data-el="prev">上一页</button>
                            <span class="qd-page-info" data-el="pageInfo"></span>
                            <button class="qd-btn" data-el="next">下一页</button>
                        </div>
                    </div>
                </div>
            `;

            const els = { overlay };
            overlay.querySelectorAll("[data-el]").forEach((el) => { els[el.dataset.el] = el; });
            els.sort.value = Panel.state.sortType;
            els.pageSize.value = String(Panel.state.pageSize);

            // 筛选条件变化时回到第一页并清空选择
            const resetView = (patch) => {
                Object.assign(Panel.state, patch, { currentPage: 1 });
                Panel.state.selectedIds.clear();
                Panel.render();
                els.body.scrollTop = 0;
            };
            const gotoPage = (delta) => {
                Panel.state.currentPage += delta;
                Panel.state.selectedIds.clear();
                Panel.render();
                els.body.scrollTop = 0;
            };

            els.search.oninput = () => resetView({ searchText: els.search.value });
            els.categoryFilter.onchange = () => resetView({ categoryFilter: els.categoryFilter.value, subCategoryFilter: "" });
            els.subCategoryFilter.onchange = () => resetView({ subCategoryFilter: els.subCategoryFilter.value });
            els.sort.onchange = () => resetView({ sortType: els.sort.value });
            els.pageSize.onchange = () => resetView({ pageSize: Number(els.pageSize.value) });
            els.prev.onclick = () => gotoPage(-1);
            els.next.onclick = () => gotoPage(1);

            els.selectAll.onchange = () => {
                els.body.querySelectorAll(".qd-item-chk").forEach((cb) => {
                    cb.checked = els.selectAll.checked;
                    if (cb.checked) Panel.state.selectedIds.add(cb.value);
                    else Panel.state.selectedIds.delete(cb.value);
                });
                Panel.syncSelection();
            };
            els.batchDel.onclick = () => {
                const ids = Array.from(Panel.state.selectedIds);
                if (ids.length && confirm(`确认要移除选中的 ${ids.length} 本书吗？`)) Storage.remove(ids);
            };

            els.import.onclick = Transfer.importFile;
            els.export.onclick = Transfer.exportFile;
            els.clear.onclick = () => {
                if (confirm("⚠️ 确认要清空所有屏蔽记录吗？\n此操作不可恢复，建议先导出备份。")) Storage.clear();
            };

            els.close.onclick = Panel.close;
            overlay.onclick = (e) => { if (e.target === overlay) Panel.close(); };
            // 焦点可能不在面板内（例如点过面板空白处），所以监听 document
            document.addEventListener("keydown", Panel.onKeydown);

            document.body.appendChild(overlay);
            Panel.els = els;
            Panel.render();
            els.search.focus();
        },

        close: () => {
            if (!Panel.els) return;
            document.removeEventListener("keydown", Panel.onKeydown);
            Panel.els.overlay.remove();
            Panel.els = null;
        },

        onKeydown: (e) => {
            if (e.key === "Escape") Panel.close();
        },

        refresh: () => {
            if (Panel.els) Panel.render();
        },

        getList: () => {
            const map = Storage.getMap();
            const { categoryFilter, subCategoryFilter } = Panel.state;
            const keyword = Panel.state.searchText.trim().toLowerCase();
            const list = Object.keys(map)
                .map((bid) => ({ bid, ...map[bid] }))
                .filter((item) => !categoryFilter || (item.category || UNKNOWN_CATEGORY) === categoryFilter)
                .filter((item) => !subCategoryFilter || (item.subCategory || UNKNOWN_CATEGORY) === subCategoryFilter)
                .filter((item) => !keyword || item.bid.includes(keyword) || item.title.toLowerCase().includes(keyword));

            const sorters = {
                timeDesc: (a, b) => b.time - a.time,
                timeAsc: (a, b) => a.time - b.time,
                title: (a, b) => a.title.localeCompare(b.title, "zh")
            };
            return list.sort(sorters[Panel.state.sortType]);
        },

        // 选项从已屏蔽的记录动态生成；当前选中项已不存在时回到「全部」
        renderFilters: () => {
            const { els, state } = Panel;
            const countBy = (entries, key) => {
                const counts = new Map();
                entries.forEach((entry) => {
                    const name = entry[key] || UNKNOWN_CATEGORY;
                    counts.set(name, (counts.get(name) || 0) + 1);
                });
                return counts;
            };
            const fillSelect = (select, counts, value, allLabel, unknownLabel) => {
                const names = Array.from(counts.keys())
                    .filter((name) => name !== UNKNOWN_CATEGORY)
                    .sort((a, b) => a.localeCompare(b, "zh"));
                if (counts.has(UNKNOWN_CATEGORY)) names.push(UNKNOWN_CATEGORY);
                select.replaceChildren(
                    new Option(allLabel, ""),
                    ...names.map((name) => new Option(`${name === UNKNOWN_CATEGORY ? unknownLabel : name} (${counts.get(name)})`, name))
                );
                select.value = value;
            };

            const entries = Object.values(Storage.getMap());
            const categoryCounts = countBy(entries, "category");
            if (!categoryCounts.has(state.categoryFilter)) state.categoryFilter = "";
            const subEntries = entries.filter((entry) => (entry.category || UNKNOWN_CATEGORY) === state.categoryFilter);
            const subCategoryCounts = countBy(subEntries, "subCategory");
            if (!subCategoryCounts.has(state.subCategoryFilter)) state.subCategoryFilter = "";

            fillSelect(els.categoryFilter, categoryCounts, state.categoryFilter, "全部大分区", "未知分区");
            fillSelect(els.subCategoryFilter, subCategoryCounts, state.subCategoryFilter, "全部小分区", "未知小分区");
            els.subCategoryFilter.disabled = !state.categoryFilter;
        },

        render: () => {
            const { els, state } = Panel;
            const map = Storage.getMap();
            state.selectedIds.forEach((bid) => {
                if (!hasOwn(map, bid)) state.selectedIds.delete(bid);
            });

            Panel.renderFilters();
            const list = Panel.getList();
            const totalPages = Math.max(1, Math.ceil(list.length / state.pageSize));
            state.currentPage = Math.min(Math.max(state.currentPage, 1), totalPages);
            const start = (state.currentPage - 1) * state.pageSize;
            const pageList = list.slice(start, start + state.pageSize);

            els.count.textContent = `(${Object.keys(map).length} 条)`;
            // 重建列表会让滚动位置归零，移除单条记录后应停在原处；翻页和筛选由调用方自行回顶
            const scrollTop = els.body.scrollTop;
            els.body.replaceChildren();
            if (pageList.length === 0) {
                const tip = document.createElement("div");
                tip.className = "qd-empty-tip";
                tip.textContent = "未找到相关记录";
                els.body.appendChild(tip);
            } else {
                els.body.append(...pageList.map(Panel.createRow));
            }
            els.body.scrollTop = scrollTop;

            els.prev.disabled = state.currentPage === 1;
            els.next.disabled = state.currentPage === totalPages;
            els.pageInfo.textContent = `${state.currentPage} / ${totalPages}`;
            Panel.syncSelection();
        },

        createRow: (item) => {
            const row = document.createElement("div");
            row.className = "qd-block-item";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.className = "qd-chk qd-item-chk";
            checkbox.value = item.bid;
            checkbox.checked = Panel.state.selectedIds.has(item.bid);
            checkbox.onchange = () => {
                if (checkbox.checked) Panel.state.selectedIds.add(item.bid);
                else Panel.state.selectedIds.delete(item.bid);
                Panel.syncSelection();
            };

            const info = document.createElement("div");
            info.className = "qd-item-info";
            const title = document.createElement("a");
            title.className = "qd-item-title";
            title.href = `https://www.qidian.com/book/${item.bid}/`;
            title.target = "_blank";
            title.textContent = item.title;
            const meta = document.createElement("div");
            meta.className = "qd-item-meta";
            const categoryLabel = [item.category, item.subCategory].filter(Boolean).join(" · ") || "未知分区";
            meta.textContent = `${categoryLabel} | ID: ${item.bid} | ${formatDate(item.time)}`;
            info.append(title, meta);

            const removeBtn = document.createElement("button");
            removeBtn.className = "qd-btn";
            removeBtn.textContent = "移除";
            removeBtn.onclick = () => {
                if (confirm(`确认移除《${item.title}》吗？`)) Storage.remove([item.bid]);
            };

            row.append(checkbox, info, removeBtn);
            return row;
        },

        syncSelection: () => {
            const { els, state } = Panel;
            const boxes = Array.from(els.body.querySelectorAll(".qd-item-chk"));
            const checked = boxes.filter((cb) => cb.checked).length;
            els.selectAll.disabled = boxes.length === 0;
            els.selectAll.checked = boxes.length > 0 && checked === boxes.length;
            els.selectAll.indeterminate = checked > 0 && checked < boxes.length;

            const count = state.selectedIds.size;
            els.batchDel.disabled = count === 0;
            els.batchDel.textContent = count ? `批量移除 (${count})` : "批量移除";
        }
    };

    // --- 9. 初始化 ---
    function init() {
        const detailBid = PageType.detailBid();
        const applyPage = () => {
            try {
                if (PageType.isList()) ListPage.apply();
                else if (detailBid) DetailPage.apply(detailBid);
            } catch (e) {
                console.error("QidianBlocker Error:", e);
            }
        };

        Storage.onChange(applyPage);
        Storage.onChange(Panel.refresh);
        GM_addValueChangeListener(STORAGE_KEY, (name, oldValue, newValue, remote) => {
            if (remote) Storage.syncFromRemote(newValue);
        });
        GM_registerMenuCommand("⚙️ 管理屏蔽列表", Panel.open);

        // 脚本在 document-start 注入：列表页边解析边处理，详情页的按钮区要等解析结束才存在
        if (PageType.isList()) ListPage.watch(applyPage);
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyPage);
        else applyPage();
    }

    init();
})();
