import { SELECTORS } from "../config.mjs";
import { BID_PATTERN, Category, diffBlocklist, hasOwn } from "../core/blocklist.mjs";
import { Storage } from "../core/storage.mjs";
import { Toast } from "../ui/toast.mjs";

const HIDDEN_CLASS = "qd-hidden";
const OWN_UI_SELECTOR = ".qd-modal-dialog, .qd-modal-overlay, .qd-category-dialog, .qd-toast, .qd-hidden-summary, .qd-list-pager";
const readTitle = (link) => (link.getAttribute("title") || link.textContent).trim();
const isOwnItemNode = (node) => node?.nodeType === Node.ELEMENT_NODE &&
    (node.classList.contains("qd-block-btn") || node.classList.contains("qd-blocked-preview-label"));
const isOwnUiNode = (node) => node?.nodeType === Node.ELEMENT_NODE &&
    (node.matches(OWN_UI_SELECTOR) || Boolean(node.closest?.(OWN_UI_SELECTOR)));

export const ListPage = {
    itemSelector: SELECTORS.listLayouts.map((layout) => layout.item).join(", "),
    byItem: new Map(),
    byBid: new Map(),
    blocked: new Set(),
    summary: null,
    reveal: false,
    pagerState: { available: false, autoPaging: false, waitingRetry: false },

    forget: (item) => {
        const record = ListPage.byItem.get(item);
        if (!record) return;
        ListPage.byItem.delete(item);
        const records = ListPage.byBid.get(record.bid);
        records.delete(record);
        if (!records.size) ListPage.byBid.delete(record.bid);
        ListPage.refreshBlocked(record.bid);
        ListPage.setVisibility(item, false);
        record.button.remove();
        record.label?.remove();
    },

    track: (item) => {
        const layout = SELECTORS.listLayouts.find((candidate) => item.matches(candidate.item));
        const link = layout && item.querySelector(layout.link);
        const bid = link?.dataset.bid ?? "";
        const current = ListPage.byItem.get(item);
        if (current && current.layout === layout && current.link === link && current.bid === bid &&
            current.button.parentElement === link.parentElement) {
            current.category = Category.fromElements(item, layout);
            return current;
        }
        ListPage.forget(item);
        if (!BID_PATTERN.test(bid)) return null;

        // 第三方翻页插件可能复制了本脚本的按钮，但复制的节点没有点击处理函数。
        item.querySelectorAll(".qd-block-btn, .qd-blocked-preview-label").forEach((el) => el.remove());
        const button = ListPage.createButton(bid, link, item, layout);
        link.before(button);
        const category = Category.fromElements(item, layout);
        const record = { bid, item, link, layout, category, button, label: null, blocked: false };
        ListPage.byItem.set(item, record);
        if (!ListPage.byBid.has(bid)) ListPage.byBid.set(bid, new Set());
        ListPage.byBid.get(bid).add(record);
        return record;
    },

    update: (records, map) => {
        const rules = Storage.getCategoryRules();
        const updates = {};
        const changedIds = new Set();
        for (const record of records) {
            const { item, bid, link, category } = record;
            const individuallyBlocked = hasOwn(map, bid);
            record.blocked = individuallyBlocked || rules.some((rule) => Category.matches(category, rule));
            changedIds.add(bid);
            ListPage.setVisibility(item, record.blocked);
            if (!record.blocked) continue;
            if (!record.label?.isConnected) {
                const label = document.createElement("span");
                label.className = "qd-blocked-preview-label";
                link.before(label);
                record.label = label;
            }
            const label = individuallyBlocked ? "已屏蔽" : "按分类屏蔽";
            if (record.label.textContent !== label) record.label.textContent = label;
            if (individuallyBlocked && Category.canFill(map[bid], category)) {
                updates[bid] = { ...updates[bid], ...category };
            }
        }
        changedIds.forEach(ListPage.refreshBlocked);
        Storage.fillCategories(updates);
        ListPage.renderSummary();
    },
    refreshBlocked: (bid) => {
        const records = ListPage.byBid.get(bid);
        if (records && [...records].some((record) => record.blocked)) ListPage.blocked.add(bid);
        else ListPage.blocked.delete(bid);
    },
    applyNew: (items) => {
        const records = Array.from(items, ListPage.track).filter(Boolean);
        if (records.length) ListPage.update(records, Storage.getMap());
    },
    applyChanges: (map, previous, changes) => {
        const { upsert, remove } = changes ?? diffBlocklist(previous ?? {}, map);
        const records = [...upsert, ...remove].flatMap((bid) => [...(ListPage.byBid.get(bid) ?? [])]);
        if (records.length) ListPage.update(records, map);
    },
    applyRules: () => ListPage.update(ListPage.byItem.values(), Storage.getMap()),
    getBatchEntries: (selection) => {
        const entries = {};
        if (!selection.category) return entries;
        const map = Storage.getMap();
        for (const { bid, category, link } of ListPage.byItem.values()) {
            if (hasOwn(map, bid) || hasOwn(entries, bid) || !Category.matches(category, selection)) continue;
            const title = readTitle(link);
            if (title) entries[bid] = { title, ...category };
        }
        return entries;
    },

    mountSummary: (openCategoryPanel, onToggleAutoPage) => {
        const root = document.querySelector(SELECTORS.listLayouts.map((layout) => layout.root).join(", "));
        if (ListPage.summary?.root === root && ListPage.summary.toolbar.isConnected) return;
        ListPage.summary?.toolbar.remove();
        ListPage.summary = null;
        if (!root) return;
        const toolbar = document.createElement("div");
        toolbar.className = "qd-hidden-summary";
        const status = document.createElement("span");
        status.setAttribute("role", "status");
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "qd-list-action";
        toggle.onclick = () => ListPage.setReveal(!ListPage.reveal);
        const categories = document.createElement("button");
        categories.type = "button";
        categories.className = "qd-list-action";
        categories.textContent = "按分类屏蔽";
        categories.onclick = openCategoryPanel;
        const autoPage = document.createElement("button");
        autoPage.type = "button";
        autoPage.className = "qd-list-action";
        autoPage.hidden = true;
        autoPage.onclick = () => onToggleAutoPage?.();
        toolbar.append(status, toggle, categories, autoPage);
        document.body.append(toolbar);
        ListPage.summary = { root, toolbar, status, toggle, autoPage };
        ListPage.renderSummary();
    },
    setPagerState: (state) => {
        ListPage.pagerState = { ...ListPage.pagerState, ...state };
        ListPage.renderSummary();
    },
    setReveal: (reveal) => {
        ListPage.reveal = reveal;
        ListPage.blocked.forEach((bid) => {
            ListPage.byBid.get(bid).forEach(({ item, blocked }) => ListPage.setVisibility(item, blocked));
        });
        ListPage.renderSummary();
    },
    setVisibility: (item, blocked) => {
        item.classList.toggle(HIDDEN_CLASS, blocked && !ListPage.reveal);
        item.classList.toggle("qd-blocked-preview", blocked && ListPage.reveal);
    },
    renderSummary: () => {
        if (!ListPage.summary) return;
        const { status, toggle, autoPage } = ListPage.summary;
        const count = ListPage.blocked.size;
        toggle.hidden = count === 0 && !ListPage.reveal;
        const message = `${ListPage.reveal ? "临时显示" : "已隐藏"} ${count} 本\n已加载 ${ListPage.byItem.size} 本`;
        if (status.textContent !== message) status.textContent = message;
        const action = ListPage.reveal ? "恢复隐藏" : "临时显示";
        if (toggle.textContent !== action) toggle.textContent = action;

        const { available, autoPaging, waitingRetry } = ListPage.pagerState;
        const active = Boolean(autoPaging || waitingRetry);
        autoPage.hidden = !available && !active;
        const autoLabel = active ? "停止翻页" : "自动翻页";
        if (autoPage.textContent !== autoLabel) autoPage.textContent = autoLabel;
        autoPage.classList.toggle("is-active", active);
    },

    // 解析时书目可能分段插入，观察新增子树和已有书目内的变化。
    watch: (onStructureChange, needsRefresh, onItemsChange) => {
        const { itemSelector } = ListPage;
        const structureSelector = [SELECTORS.pagination, ...SELECTORS.listLayouts.map((layout) => layout.root)].join(", ");
        const allOwnNodes = (list) => {
            for (const node of list) {
                if (node.nodeType !== Node.ELEMENT_NODE) return false;
                if (!isOwnItemNode(node) && !node.matches(OWN_UI_SELECTOR)) return false;
            }
            return true;
        };
        new MutationObserver((mutations) => {
            const items = new Set();
            let structureChanged = ListPage.summary?.root.isConnected === false ||
                ListPage.summary?.toolbar.isConnected === false ||
                needsRefresh();
            for (const mutation of mutations) {
                const { type, target, addedNodes, removedNodes } = mutation;
                const targetEl = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
                if (isOwnUiNode(targetEl) || isOwnItemNode(targetEl)) continue;
                if (type === "childList" && allOwnNodes(addedNodes) && allOwnNodes(removedNodes)) continue;

                const parentItem = targetEl?.closest?.(itemSelector);
                if (parentItem) items.add(parentItem);
                for (const node of addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE || isOwnItemNode(node) || node.matches(OWN_UI_SELECTOR)) continue;
                    if (node.matches(itemSelector)) items.add(node);
                    node.querySelectorAll(itemSelector).forEach((item) => items.add(item));
                    structureChanged ||= node.matches(structureSelector) || Boolean(node.querySelector(structureSelector));
                }
                if (ListPage.byItem.size > 0) {
                    for (const node of removedNodes) {
                        if (node.nodeType !== Node.ELEMENT_NODE || isOwnItemNode(node) || node.matches(OWN_UI_SELECTOR)) continue;
                        const forgetIfDetached = (item) => {
                            if (ListPage.byItem.has(item) && (!item.isConnected || !item.matches(itemSelector))) {
                                ListPage.forget(item);
                                structureChanged = true;
                            }
                        };
                        forgetIfDetached(node);
                        node.querySelectorAll("li, tr").forEach(forgetIfDetached);
                    }
                }
            }
            ListPage.applyNew(items);
            if (structureChanged) onStructureChange();
            else if (items.size) onItemsChange?.();
        }).observe(document, { childList: true, subtree: true, attributeFilter: ["data-bid"] });
    },
    // 书名和分区在点击时才读取：按钮可能在条目还没解析完整时就已创建
    createButton: (bid, link, item, layout) => {
        const btn = document.createElement("span");
        btn.className = "qd-block-btn";
        btn.textContent = "🚫";
        btn.title = "屏蔽此书";
        let busy = false;
        btn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (busy) return;
            const title = readTitle(link);
            if (!title) {
                alert("未能读取书名，屏蔽失败。");
                return;
            }
            busy = true;
            try {
                await Storage.add(bid, title, Category.fromElements(item, layout));
                Toast.show(`已屏蔽《${title}》`, "撤销", () => Storage.remove([bid]).catch(Storage.reportError));
            } catch (err) {
                Storage.reportError(err);
            } finally {
                busy = false;
            }
        });
        return btn;
    }
};
