import { SELECTORS } from "../config.mjs";
import { BID_PATTERN, Category, diffBlocklist, hasOwn } from "../core/blocklist.mjs";
import { Storage } from "../core/storage.mjs";
import { Toast } from "../ui/toast.mjs";

const HIDDEN_CLASS = "qd-hidden";

export const ListPage = {
    itemSelector: SELECTORS.listLayouts.map((layout) => layout.item).join(", "),
    byItem: new Map(),
    byBid: new Map(),
    blocked: new Set(),
    summary: null,
    reveal: false,

    forget: (item) => {
        const record = ListPage.byItem.get(item);
        if (!record) return;
        ListPage.byItem.delete(item);
        const records = ListPage.byBid.get(record.bid);
        records.delete(record);
        if (!records.size) {
            ListPage.byBid.delete(record.bid);
            ListPage.blocked.delete(record.bid);
        }
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
            return current;
        }
        ListPage.forget(item);
        if (!BID_PATTERN.test(bid)) return null;

        // 第三方翻页插件可能复制了本脚本的按钮，但复制的节点没有点击处理函数。
        item.querySelectorAll(".qd-block-btn, .qd-blocked-preview-label").forEach((el) => el.remove());
        const button = ListPage.createButton(bid, link, item, layout);
        link.before(button);
        const record = { bid, item, link, layout, button, label: null };
        ListPage.byItem.set(item, record);
        if (!ListPage.byBid.has(bid)) ListPage.byBid.set(bid, new Set());
        ListPage.byBid.get(bid).add(record);
        return record;
    },

    update: (records, map) => {
        const updates = {};
        records.forEach((record) => {
            const { item, bid, link, layout } = record;
            const blocked = hasOwn(map, bid);
            ListPage.setVisibility(item, blocked);
            if (!blocked) {
                ListPage.blocked.delete(bid);
                return;
            }
            ListPage.blocked.add(bid);
            if (!record.label?.isConnected) {
                const label = document.createElement("span");
                label.className = "qd-blocked-preview-label";
                label.textContent = "已屏蔽";
                link.before(label);
                record.label = label;
            }
            if (Category.isMissing(map[bid])) {
                updates[bid] = { ...updates[bid], ...Category.fromElements(item, layout) };
            }
        });
        Storage.fillCategories(updates);
        ListPage.renderSummary();
    },
    applyNew: (items) => {
        const records = Array.from(items, ListPage.track).filter(Boolean);
        if (records.length) ListPage.update(records, Storage.getMap());
    },
    applyChanges: (map, previous) => {
        const { upsert, remove } = diffBlocklist(previous ?? {}, map);
        const records = [...upsert, ...remove].flatMap((bid) => [...(ListPage.byBid.get(bid) ?? [])]);
        if (records.length) ListPage.update(records, map);
    },

    mountSummary: () => {
        const root = document.querySelector(SELECTORS.listLayouts.map((layout) => layout.root).join(", "));
        if (ListPage.summary?.root === root) return;
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
        toolbar.append(status, toggle);
        document.body.append(toolbar);
        ListPage.summary = { root, toolbar, status, toggle };
        ListPage.renderSummary();
    },
    setReveal: (reveal) => {
        ListPage.reveal = reveal;
        ListPage.blocked.forEach((bid) => {
            ListPage.byBid.get(bid).forEach(({ item }) => ListPage.setVisibility(item, true));
        });
        ListPage.renderSummary();
    },
    setVisibility: (item, blocked) => {
        item.classList.toggle(HIDDEN_CLASS, blocked && !ListPage.reveal);
        item.classList.toggle("qd-blocked-preview", blocked && ListPage.reveal);
    },
    renderSummary: () => {
        if (!ListPage.summary) return;
        const { toolbar, status, toggle } = ListPage.summary;
        const count = ListPage.blocked.size;
        toolbar.hidden = count === 0 && !ListPage.reveal;
        const message = `${ListPage.reveal ? "临时显示已屏蔽作品" : "已隐藏"} ${count} 本`;
        if (status.textContent !== message) status.textContent = message;
        const action = ListPage.reveal ? "恢复隐藏" : "临时显示";
        if (toggle.textContent !== action) toggle.textContent = action;
    },

    // 解析时书目可能分段插入，观察新增子树和已有书目内的变化。
    watch: (onStructureChange, needsRefresh) => {
        const { itemSelector } = ListPage;
        const structureSelector = [SELECTORS.pagination, ...SELECTORS.listLayouts.map((layout) => layout.root)].join(", ");
        new MutationObserver((mutations) => {
            const items = new Set();
            let structureChanged = ListPage.summary?.root.isConnected === false || needsRefresh();
            for (const { target, addedNodes, removedNodes } of mutations) {
                const parentItem = target.closest?.(itemSelector);
                if (parentItem) items.add(parentItem);
                for (const node of addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    if (node.matches(itemSelector)) items.add(node);
                    node.querySelectorAll(itemSelector).forEach((item) => items.add(item));
                    structureChanged ||= node.matches(structureSelector) || !!node.querySelector(structureSelector);
                }
                for (const node of removedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
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
            ListPage.applyNew(items);
            if (structureChanged || items.size) onStructureChange();
        }).observe(document, { childList: true, subtree: true, attributeFilter: ["data-bid"] });
    },
    // 书名和分区在点击时才读取：按钮可能在条目还没解析完整时就已创建
    createButton: (bid, link, item, layout) => {
        const btn = document.createElement("span");
        btn.className = "qd-block-btn";
        btn.textContent = "🚫";
        btn.title = "屏蔽此书";
        btn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const title = (link.getAttribute("title") || link.textContent).trim();
            if (!title) {
                alert("未能读取书名，屏蔽失败。");
                return;
            }
            try {
                await Storage.add(bid, title, Category.fromElements(item, layout));
                Toast.show(`已屏蔽《${title}》`, "撤销", () => Storage.remove([bid]).catch(Storage.reportError));
            } catch (err) {
                Storage.reportError(err);
            }
        });
        return btn;
    }
};
