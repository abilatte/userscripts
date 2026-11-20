import { hasOwn } from "../core/blocklist.mjs";
import { formatDate } from "../core/date.mjs";
import { DEFAULT_PAGER_SETTINGS, normalizePagerSettings } from "../core/settings.mjs";
import { Storage } from "../core/storage.mjs";
import { Sync, SYNC_DEFAULT_PATH, SYNC_REPO_PATTERN } from "../core/sync.mjs";
import { CategoryPanel } from "./category-panel.mjs";
import { Toast } from "./toast.mjs";
import { Transfer } from "./transfer.mjs";

const UNKNOWN_CATEGORY = "__unknown__";
const SEARCH_DEBOUNCE_MS = 120;
const zhCollator = new Intl.Collator("zh");

function fillCountSelect(select, counts, value, allLabel, unknownLabel) {
    const names = Array.from(counts.keys())
        .filter((name) => name !== UNKNOWN_CATEGORY)
        .sort((a, b) => zhCollator.compare(a, b));
    if (counts.has(UNKNOWN_CATEGORY)) names.push(UNKNOWN_CATEGORY);

    const nextOptions = [
        [allLabel, ""],
        ...names.map((name) => [`${name === UNKNOWN_CATEGORY ? unknownLabel : name} (${counts.get(name)})`, name])
    ];
    const unchanged = select.options.length === nextOptions.length &&
        nextOptions.every(([text, val], i) => select.options[i].text === text && select.options[i].value === val);
    if (!unchanged) {
        select.replaceChildren(...nextOptions.map(([text, val]) => new Option(text, val)));
    }
    select.value = value;
}

export const Panel = {
    state: {
        activeTab: "list", // list | categories | settings
        searchText: "",
        sortType: "timeDesc", // timeDesc | timeAsc | title
        categoryFilter: "", // "" 表示全部，UNKNOWN_CATEGORY 表示未知分区
        subCategoryFilter: "",
        selectedIds: new Set(),
        currentPage: 1,
        pageSize: 50
    },
    _options: {
        isListPage: false,
        getCoverPagerEnabled: () => true,
        setCoverPagerEnabled: () => {},
        getPagerSettings: () => DEFAULT_PAGER_SETTINGS,
        savePagerSettings: (patch) => normalizePagerSettings(patch),
        getPagerState: () => ({ available: false, autoPaging: false, waitingRetry: false }),
        toggleAutoPage: () => false
    },
    els: null,
    _searchTimer: 0,
    _matchedIds: [],

    configure: (options = {}) => {
        Object.assign(Panel._options, options);
    },

    open: ({ tab = "list" } = {}) => {
        if (Panel.els) {
            Panel.setTab(tab);
            return;
        }
        Object.assign(Panel.state, {
            activeTab: tab,
            searchText: "",
            categoryFilter: "",
            subCategoryFilter: "",
            currentPage: 1
        });
        Panel.state.selectedIds.clear();

        const dialog = document.createElement("dialog");
        dialog.className = "qd-modal-dialog";
        dialog.setAttribute("aria-labelledby", "qd-modal-title");
        dialog.innerHTML = `
            <div class="qd-modal">
                <div class="qd-modal-header">
                    <span class="qd-modal-title" id="qd-modal-title">🛡️ 起点小说屏蔽<span class="qd-modal-count" data-el="count"></span></span>
                    <div class="qd-header-btns">
                        <button type="button" class="qd-header-sync" data-el="headerSync"></button>
                        <button type="button" class="qd-btn qd-btn-close" data-el="close" title="关闭" aria-label="关闭">×</button>
                    </div>
                </div>
                <div class="qd-tabs" role="tablist">
                    <button type="button" role="tab" class="qd-tab" data-el="tabList" aria-selected="true">屏蔽列表</button>
                    <button type="button" role="tab" class="qd-tab" data-el="tabCategories" aria-selected="false">分类规则</button>
                    <button type="button" role="tab" class="qd-tab" data-el="tabSettings" aria-selected="false">设置与同步</button>
                </div>
                <div class="qd-tab-panel" data-el="panelList" role="tabpanel">
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
                        <div class="qd-batch-select">
                            <label><input type="checkbox" class="qd-chk" data-el="selectAll">全选当前页</label>
                            <button type="button" class="qd-list-action" data-el="selectAllMatched" hidden></button>
                        </div>
                        <button type="button" class="qd-btn qd-btn-danger" data-el="batchDel" disabled>批量移除</button>
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
                            <button type="button" class="qd-btn" data-el="prev">上一页</button>
                            <span class="qd-page-info" data-el="pageInfo"></span>
                            <button type="button" class="qd-btn" data-el="next">下一页</button>
                        </div>
                    </div>
                </div>
                <div class="qd-tab-panel qd-settings-body" data-el="panelCategories" role="tabpanel" hidden></div>
                <div class="qd-tab-panel qd-settings-body" data-el="panelSettings" role="tabpanel" hidden>
                    <section class="qd-settings-section">
                        <h3>页面功能</h3>
                        <label class="qd-setting-toggle">
                            <input type="checkbox" class="qd-chk" data-el="coverPagerToggle">
                            <span>开启「全部作品」页内置无缝翻页（支持图文与文字模式）</span>
                        </label>
                        <p class="qd-category-note">使用 Pagetual 等第三方翻页脚本时可关闭以避免重复加载；修改后立即生效。</p>
                        <div class="qd-setting-list">
                            <label class="qd-setting-row">
                                <span>翻页延迟</span>
                                <input type="number" class="qd-num-input" min="0" max="60000" step="100" data-el="pagerDelay">
                                <span class="qd-setting-hint">毫秒（每次翻页后的等待间隔）</span>
                            </label>
                            <label class="qd-setting-row">
                                <span>限流自动重试</span>
                                <input type="number" class="qd-num-input" min="0" max="600" step="1" data-el="pagerRateLimitRetry">
                                <span class="qd-setting-hint">秒（HTTP 429 / 404 后等待秒数，0 = 不自动重试）</span>
                            </label>
                            <label class="qd-setting-row">
                                <span>自动翻页目标</span>
                                <input type="number" class="qd-num-input" min="0" max="999" step="1" data-el="pagerAutoTarget">
                                <span class="qd-setting-hint">页（0 = 一直翻到结尾）</span>
                            </label>
                            <label class="qd-setting-toggle">
                                <input type="checkbox" class="qd-chk" data-el="pagerAutoStart">
                                <span>打开「全部作品」页时自动开始翻页</span>
                            </label>
                            <div class="qd-setting-row" data-el="pagerAutoActions" hidden>
                                <button type="button" class="qd-btn" data-el="pagerAutoBtn">立即开始自动翻页</button>
                            </div>
                        </div>
                    </section>
                    <section class="qd-settings-section">
                        <div class="qd-sync-head">
                            <h3>多设备同步（GitHub）</h3>
                            <button type="button" class="qd-btn" data-el="syncNow">立即同步</button>
                        </div>
                        <p class="qd-sync-status" data-el="syncStatus"></p>
                        <form class="qd-sync-form" data-el="syncForm">
                            <input type="text" class="qd-search-input" data-el="syncRepo" placeholder="仓库：用户名/仓库名" spellcheck="false">
                            <input type="text" class="qd-search-input" data-el="syncPath" placeholder="文件路径" spellcheck="false">
                            <input type="password" class="qd-search-input" data-el="syncToken" autocomplete="off">
                            <button type="submit" class="qd-btn" data-el="syncSave">保存并同步</button>
                            <button type="button" class="qd-btn qd-btn-danger" data-el="syncDisable">停用同步</button>
                        </form>
                        <p class="qd-category-note">在 GitHub 私有仓库使用 Fine-grained token（仅授权该仓库 Contents 读写权限）。令牌只保存在本地脚本管理器存储中。</p>
                    </section>
                    <section class="qd-settings-section">
                        <h3>数据备份与管理</h3>
                        <div class="qd-settings-actions">
                            <button type="button" class="qd-btn" data-el="import">导入备份</button>
                            <button type="button" class="qd-btn" data-el="export">导出备份</button>
                            <button type="button" class="qd-btn" data-el="resetAnchor">重置版本锚点</button>
                            <button type="button" class="qd-btn qd-btn-danger" data-el="clear">清空全部屏蔽记录</button>
                        </div>
                        <p class="qd-category-note">仅在清空或重装脚本数据后提示无法保存时使用；执行前请先刷新或关闭其他起点标签页。</p>
                    </section>
                </div>
            </div>
        `;

        const els = { dialog, filterKey: null, syncDirty: false };
        dialog.querySelectorAll("[data-el]").forEach((el) => { els[el.dataset.el] = el; });
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
            Panel.render();
            els.body.scrollTop = 0;
        };

        let composing = false;
        const scheduleSearch = () => {
            clearTimeout(Panel._searchTimer);
            Panel._searchTimer = setTimeout(() => {
                Panel._searchTimer = 0;
                if (Panel.els === els) resetView({ searchText: els.search.value });
            }, SEARCH_DEBOUNCE_MS);
        };
        els.search.addEventListener("compositionstart", () => { composing = true; });
        els.search.addEventListener("compositionend", () => {
            composing = false;
            scheduleSearch();
        });
        els.search.addEventListener("input", (e) => {
            if (!composing && !e.isComposing) scheduleSearch();
        });

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
        els.selectAllMatched.onclick = () => {
            Panel._matchedIds.forEach((bid) => Panel.state.selectedIds.add(bid));
            els.body.querySelectorAll(".qd-item-chk").forEach((cb) => { cb.checked = true; });
            Panel.syncSelection();
        };
        els.batchDel.onclick = () => {
            const ids = Array.from(Panel.state.selectedIds);
            if (ids.length && confirm(`确认要移除选中的 ${ids.length} 本书吗？`)) Storage.remove(ids).catch(Storage.reportError);
        };

        els.body.onchange = (e) => {
            const cb = e.target.closest(".qd-item-chk");
            if (!cb) return;
            if (cb.checked) Panel.state.selectedIds.add(cb.value);
            else Panel.state.selectedIds.delete(cb.value);
            Panel.syncSelection();
        };
        els.body.onclick = (e) => {
            const removeBtn = e.target.closest("[data-remove-bid]");
            if (!removeBtn) return;
            const bid = removeBtn.dataset.removeBid;
            const entry = Storage.getMap()[bid];
            if (!entry) return;
            Storage.remove([bid]).then(() => {
                Toast.show(`已移除《${entry.title}》`, "撤销", () => Storage.merge({ [bid]: entry }).catch(Storage.reportError));
            }).catch(Storage.reportError);
        };

        els.tabList.onclick = () => Panel.setTab("list");
        els.tabCategories.onclick = () => Panel.setTab("categories");
        els.tabSettings.onclick = () => Panel.setTab("settings");
        els.headerSync.onclick = () => Panel.setTab("settings");

        const updatePagerSetting = (patch) => {
            Panel._options.savePagerSettings(patch);
            Panel.refreshSettings();
        };
        els.coverPagerToggle.onchange = () => {
            Panel._options.setCoverPagerEnabled(els.coverPagerToggle.checked);
        };
        els.pagerDelay.onchange = () => updatePagerSetting({ delayMs: els.pagerDelay.value });
        els.pagerRateLimitRetry.onchange = () => updatePagerSetting({ rateLimitRetrySec: els.pagerRateLimitRetry.value });
        els.pagerAutoTarget.onchange = () => updatePagerSetting({ autoTargetPages: els.pagerAutoTarget.value });
        els.pagerAutoStart.onchange = () => updatePagerSetting({ autoStart: els.pagerAutoStart.checked });
        els.pagerAutoBtn.onclick = () => {
            const started = Panel._options.toggleAutoPage();
            Panel.refreshSettings();
            if (started) Panel.close();
        };

        const syncConfig = Sync.getConfig();
        els.syncRepo.value = syncConfig ? syncConfig.repo : "";
        els.syncPath.value = syncConfig ? syncConfig.path : SYNC_DEFAULT_PATH;
        els.syncRepo.oninput = () => { els.syncDirty = true; };
        els.syncPath.oninput = () => { els.syncDirty = true; };
        els.syncNow.onclick = () => Sync.run({ force: true });
        els.syncForm.onsubmit = (e) => {
            e.preventDefault();
            Panel.saveSync().catch(Storage.reportError);
        };
        els.syncDisable.onclick = () => {
            if (confirm("确认停用同步吗？\n本机和 GitHub 上的屏蔽列表都会保留，只是不再互相同步。")) {
                els.syncDirty = false;
                Sync.clearConfig().catch(Storage.reportError);
            }
        };

        els.import.onclick = Transfer.importFile;
        els.export.onclick = Transfer.exportFile;
        els.resetAnchor.onclick = () => {
            if (!confirm("确认重置本地版本锚点吗？\n请先确保已刷新或关闭其他已打开的起点标签页，以免覆盖未同步的更改。")) return;
            Storage.resetAnchor().then(() => {
                alert("本地版本锚点已重置，现在可以正常保存。");
            }).catch(Storage.reportError);
        };
        els.clear.onclick = () => {
            if (confirm("⚠️ 确认要清空所有屏蔽记录吗？\n此操作不可恢复，建议先导出备份。")) Storage.clear().catch(Storage.reportError);
        };

        els.close.onclick = Panel.close;
        dialog.addEventListener("click", (e) => { if (e.target === dialog) Panel.close(); });
        dialog.addEventListener("close", () => {
            clearTimeout(Panel._searchTimer);
            Panel._searchTimer = 0;
            CategoryPanel.unmount();
            if (Panel.els === els) Panel.els = null;
            dialog.remove();
        }, { once: true });

        document.body.appendChild(dialog);
        Panel.els = els;
        CategoryPanel.mount(els.panelCategories, { isListPage: Panel._options.isListPage });
        Panel.render();
        dialog.showModal();
        Panel.setTab(tab);
    },

    close: () => {
        if (!Panel.els) return;
        Panel.els.dialog.close();
    },

    setTab: (tab) => {
        if (!Panel.els) return;
        const { els } = Panel;
        const valid = ["list", "categories", "settings"].includes(tab) ? tab : "list";
        Panel.state.activeTab = valid;
        const pairs = [
            ["list", els.tabList, els.panelList],
            ["categories", els.tabCategories, els.panelCategories],
            ["settings", els.tabSettings, els.panelSettings]
        ];
        for (const [name, btn, panel] of pairs) {
            const active = name === valid;
            btn.classList.toggle("is-active", active);
            btn.setAttribute("aria-selected", String(active));
            panel.hidden = !active;
        }
        if (valid === "list") els.search.focus();
        else if (valid === "categories") {
            CategoryPanel.refresh();
            CategoryPanel.focus();
        } else {
            Panel.refreshSettings();
            Panel.refreshSync();
            els.coverPagerToggle.focus();
        }
    },

    refresh: () => {
        if (!Panel.els) return;
        Panel.render();
    },

    refreshCategories: () => {
        if (!Panel.els) return;
        const count = Storage.getCategoryRules().length;
        Panel.els.tabCategories.textContent = count ? `分类规则 (${count})` : "分类规则";
        CategoryPanel.refresh();
    },

    refreshSettings: () => {
        if (!Panel.els) return;
        const { els } = Panel;
        const enabled = Boolean(Panel._options.getCoverPagerEnabled());
        const settings = normalizePagerSettings(Panel._options.getPagerSettings());
        const pagerState = Panel._options.getPagerState();
        const active = Boolean(pagerState.autoPaging || pagerState.waitingRetry);
        const activeEl = typeof document !== "undefined" ? document.activeElement : null;

        els.coverPagerToggle.checked = enabled;
        if (activeEl !== els.pagerDelay) els.pagerDelay.value = String(settings.delayMs);
        if (activeEl !== els.pagerRateLimitRetry) els.pagerRateLimitRetry.value = String(settings.rateLimitRetrySec);
        if (activeEl !== els.pagerAutoTarget) els.pagerAutoTarget.value = String(settings.autoTargetPages);
        els.pagerAutoStart.checked = settings.autoStart;

        els.pagerDelay.disabled = !enabled;
        els.pagerRateLimitRetry.disabled = !enabled;
        els.pagerAutoTarget.disabled = !enabled;
        els.pagerAutoStart.disabled = !enabled;

        els.pagerAutoActions.hidden = !Panel._options.isListPage;
        els.pagerAutoBtn.disabled = !enabled || (!pagerState.available && !active);
        els.pagerAutoBtn.textContent = active ? "停止自动翻页" : "立即开始自动翻页";
        els.pagerAutoBtn.classList.toggle("qd-btn-danger", active);
    },

    refreshSync: () => {
        if (!Panel.els) return;
        const { els } = Panel;
        const config = Sync.getConfig();
        const configured = config !== null;
        const statusText = Sync.describe();
        const hasError = Boolean(configured && Storage.getData().sync.lastError);
        els.headerSync.textContent = statusText;
        els.headerSync.title = `${statusText}（点击前往同步设置）`;
        els.headerSync.classList.toggle("is-error", hasError);
        els.tabSettings.textContent = hasError ? "设置与同步 ⚠️" : "设置与同步";
        els.syncStatus.textContent = statusText;
        els.syncStatus.title = statusText;
        els.syncNow.disabled = !configured || Sync.isBusy();
        els.syncDisable.disabled = !configured;
        els.syncToken.placeholder = configured ? "GitHub 令牌（已保存，留空则不修改）" : "GitHub 令牌";
        if (!els.syncDirty) {
            els.syncRepo.value = config ? config.repo : "";
            els.syncPath.value = config ? config.path : SYNC_DEFAULT_PATH;
        }
    },

    // 令牌只保存在脚本管理器的存储里，不会回填到输入框
    saveSync: async () => {
        const { els } = Panel;
        const config = {
            repo: els.syncRepo.value.trim(),
            path: els.syncPath.value.trim().replace(/^\/+|\/+$/g, ""),
            token: els.syncToken.value.trim()
        };
        if (!SYNC_REPO_PATTERN.test(config.repo)) {
            alert("仓库格式应为「用户名/仓库名」。");
            return;
        }
        if (!config.path || config.path.split("/").some((seg) => !seg || seg === "." || seg === "..")) {
            alert("请填写有效的文件路径。");
            return;
        }
        await Sync.saveConfig(config);
        els.syncToken.value = "";
        els.syncDirty = false;
        Sync.run({ force: true });
    },

    getList: () => {
        const map = Storage.getMap();
        const { categoryFilter, subCategoryFilter, searchText, sortType } = Panel.state;
        const keyword = searchText.trim().toLowerCase();
        const list = [];
        for (const bid of Object.keys(map)) {
            const item = map[bid];
            if (categoryFilter && (item.category || UNKNOWN_CATEGORY) !== categoryFilter) continue;
            if (subCategoryFilter && (item.subCategory || UNKNOWN_CATEGORY) !== subCategoryFilter) continue;
            if (keyword && !bid.includes(keyword) && !item.title.toLowerCase().includes(keyword)) continue;
            list.push({ bid, ...item });
        }

        const sorters = {
            timeDesc: (a, b) => b.time - a.time,
            timeAsc: (a, b) => a.time - b.time,
            title: (a, b) => zhCollator.compare(a.title, b.title)
        };
        return list.sort(sorters[sortType]);
    },

    // 选项从已屏蔽的记录动态生成；当前选中项已不存在时回到「全部」
    renderFilters: () => {
        const { els, state } = Panel;
        const mapRevision = Storage.getData().mapRevision ?? 0;
        const nextKey = `${mapRevision}:${state.categoryFilter}`;
        if (els.filterKey === nextKey) return;

        const countBy = (entries, key) => {
            const counts = new Map();
            entries.forEach((entry) => {
                const name = entry[key] || UNKNOWN_CATEGORY;
                counts.set(name, (counts.get(name) || 0) + 1);
            });
            return counts;
        };

        const entries = Object.values(Storage.getMap());
        const categoryCounts = countBy(entries, "category");
        if (!categoryCounts.has(state.categoryFilter)) state.categoryFilter = "";
        const subEntries = entries.filter((entry) => (entry.category || UNKNOWN_CATEGORY) === state.categoryFilter);
        const subCategoryCounts = countBy(subEntries, "subCategory");
        if (!subCategoryCounts.has(state.subCategoryFilter)) state.subCategoryFilter = "";

        fillCountSelect(els.categoryFilter, categoryCounts, state.categoryFilter, "全部大分区", "未知分区");
        fillCountSelect(els.subCategoryFilter, subCategoryCounts, state.subCategoryFilter, "全部小分区", "未知小分区");
        els.subCategoryFilter.disabled = !state.categoryFilter;
        els.filterKey = `${mapRevision}:${state.categoryFilter}`;
    },

    render: () => {
        const { els, state } = Panel;
        const map = Storage.getMap();
        state.selectedIds.forEach((bid) => {
            if (!hasOwn(map, bid)) state.selectedIds.delete(bid);
        });

        Panel.renderFilters();
        const list = Panel.getList();
        Panel._matchedIds = list.map((item) => item.bid);
        const totalCount = Object.keys(map).length;
        const isFiltered = Boolean(state.searchText.trim() || state.categoryFilter || state.subCategoryFilter);
        const totalPages = Math.max(1, Math.ceil(list.length / state.pageSize));
        state.currentPage = Math.min(Math.max(state.currentPage, 1), totalPages);
        const start = (state.currentPage - 1) * state.pageSize;
        const pageList = list.slice(start, start + state.pageSize);

        els.count.textContent = isFiltered ? `(匹配 ${list.length} / 共 ${totalCount} 条)` : `(共 ${totalCount} 条)`;
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
        Panel.refreshCategories();
        Panel.refreshSettings();
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

        const info = document.createElement("div");
        info.className = "qd-item-info";
        const title = document.createElement("a");
        title.className = "qd-item-title";
        title.href = `https://www.qidian.com/book/${item.bid}/`;
        title.target = "_blank";
        title.rel = "noopener noreferrer";
        title.textContent = item.title;
        const meta = document.createElement("div");
        meta.className = "qd-item-meta";
        const categoryLabel = [item.category, item.subCategory].filter(Boolean).join(" · ") || "未知分区";
        meta.textContent = `${categoryLabel} | ID: ${item.bid} | ${formatDate(item.time)}`;
        info.append(title, meta);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "qd-btn";
        removeBtn.dataset.removeBid = item.bid;
        removeBtn.textContent = "移除";

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

        const matchedCount = Panel._matchedIds.length;
        const allMatchedSelected = matchedCount > 0 && Panel._matchedIds.every((bid) => state.selectedIds.has(bid));
        els.selectAllMatched.hidden = !(matchedCount > boxes.length && !allMatchedSelected);
        if (!els.selectAllMatched.hidden) {
            els.selectAllMatched.textContent = `选择全部 ${matchedCount} 条匹配结果`;
        }

        const count = state.selectedIds.size;
        els.batchDel.disabled = count === 0;
        els.batchDel.textContent = count ? `批量移除 (${count})` : "批量移除";
    }
};
