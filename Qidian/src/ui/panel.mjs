import { hasOwn } from "../core/blocklist.mjs";
import { formatDate } from "../core/date.mjs";
import { Storage } from "../core/storage.mjs";
import { Sync, SYNC_DEFAULT_PATH, SYNC_REPO_PATTERN } from "../core/sync.mjs";
import { Transfer } from "./transfer.mjs";

const UNKNOWN_CATEGORY = "__unknown__";

export const Panel = {
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
                <div class="qd-sync-bar">
                    <div class="qd-sync-row">
                        <span class="qd-sync-status" data-el="syncStatus"></span>
                        <button class="qd-btn" data-el="syncNow">立即同步</button>
                        <button class="qd-btn" data-el="syncSettings">同步设置</button>
                    </div>
                    <div class="qd-sync-form" data-el="syncForm" hidden>
                        <input type="text" class="qd-search-input" data-el="syncRepo" placeholder="仓库：用户名/仓库名" spellcheck="false">
                        <input type="text" class="qd-search-input" data-el="syncPath" placeholder="文件路径" spellcheck="false">
                        <input type="password" class="qd-search-input" data-el="syncToken" autocomplete="off">
                        <button class="qd-btn" data-el="syncSave">保存并同步</button>
                        <button class="qd-btn qd-btn-danger" data-el="syncDisable">停用同步</button>
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
            if (ids.length && confirm(`确认要移除选中的 ${ids.length} 本书吗？`)) Storage.remove(ids).catch(Storage.reportError);
        };

        const syncConfig = Sync.getConfig();
        els.syncRepo.value = syncConfig ? syncConfig.repo : "";
        els.syncPath.value = syncConfig ? syncConfig.path : SYNC_DEFAULT_PATH;
        els.syncSettings.onclick = () => { els.syncForm.hidden = !els.syncForm.hidden; };
        els.syncNow.onclick = () => Sync.run({ force: true });
        els.syncSave.onclick = () => Panel.saveSync().catch(Storage.reportError);
        els.syncDisable.onclick = () => {
            if (confirm("确认停用同步吗？\n本机和 GitHub 上的屏蔽列表都会保留，只是不再互相同步。")) Sync.clearConfig().catch(Storage.reportError);
        };

        els.import.onclick = Transfer.importFile;
        els.export.onclick = Transfer.exportFile;
        els.clear.onclick = () => {
            if (confirm("⚠️ 确认要清空所有屏蔽记录吗？\n此操作不可恢复，建议先导出备份。")) Storage.clear().catch(Storage.reportError);
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

    refreshSync: () => {
        if (!Panel.els) return;
        const { els } = Panel;
        const configured = Sync.getConfig() !== null;
        els.syncStatus.textContent = Sync.describe();
        els.syncStatus.title = els.syncStatus.textContent;
        els.syncNow.disabled = !configured || Sync.isBusy();
        els.syncDisable.disabled = !configured;
        els.syncToken.placeholder = configured ? "GitHub 令牌（已保存，留空则不修改）" : "GitHub 令牌";
    },

    // 令牌只保存在脚本管理器的存储里，不会回填到输入框
    saveSync: async () => {
        const { els } = Panel;
        const config = {
            repo: els.syncRepo.value.trim(),
            path: els.syncPath.value.trim().replace(/^\/+/, ""),
            token: els.syncToken.value.trim()
        };
        if (!SYNC_REPO_PATTERN.test(config.repo)) {
            alert("仓库格式应为「用户名/仓库名」。");
            return;
        }
        if (!config.path) {
            alert("请填写文件路径。");
            return;
        }
        await Sync.saveConfig(config);
        els.syncToken.value = "";
        els.syncForm.hidden = true;
        Sync.run({ force: true });
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
        Panel.refreshSync();
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
            if (confirm(`确认移除《${item.title}》吗？`)) Storage.remove([item.bid]).catch(Storage.reportError);
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
