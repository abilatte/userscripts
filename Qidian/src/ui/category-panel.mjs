import { Category } from "../core/blocklist.mjs";
import { Storage } from "../core/storage.mjs";
import { ListPage } from "../pages/list.mjs";

const zhCollator = new Intl.Collator("zh");
const sortNames = (names) => [...names].sort((a, b) => zhCollator.compare(a, b));

function fillSelect(select, names, label) {
    const value = select.value;
    const nextOptions = [[label, ""], ...names.map((name) => [name, name])];
    const unchanged = select.options.length === nextOptions.length &&
        nextOptions.every(([text, val], i) => select.options[i].text === text && select.options[i].value === val);
    if (!unchanged) {
        select.replaceChildren(...nextOptions.map(([text, val]) => new Option(text, val)));
    }
    select.value = names.includes(value) ? value : "";
}

export const CategoryPanel = {
    els: null,

    mount: (container, { isListPage = false } = {}) => {
        container.innerHTML = `
            <div class="qd-category-content">
                <div class="qd-category-fields">
                    <label>大类 <select class="qd-select" data-el="category"></select></label>
                    <label>小类 <select class="qd-select" data-el="subCategory"></select></label>
                </div>
                <div class="qd-category-actions">
                    <button type="button" class="qd-btn qd-btn-danger" data-el="batch">屏蔽已加载的书</button>
                    <button type="button" class="qd-btn" data-el="addRule">添加自动屏蔽规则</button>
                </div>
                <p class="qd-category-note" data-el="batchHint" hidden>如需批量屏蔽当前页面已加载的书目，请在「全部作品」列表页打开此面板。</p>
                <p class="qd-category-feedback" data-el="status" role="status"></p>
                <h3>自动屏蔽规则</h3>
                <p class="qd-category-note">规则会隐藏之后遇到的同类书，保存在当前浏览器。</p>
                <ul class="qd-category-rules" data-el="rules"></ul>
            </div>
        `;
        const els = { container, isListPage, busy: false };
        container.querySelectorAll("[data-el]").forEach((el) => { els[el.dataset.el] = el; });
        els.batch.hidden = !isListPage;
        els.batchHint.hidden = isListPage;
        els.category.onchange = () => {
            els.subCategory.value = "";
            els.status.textContent = "";
            CategoryPanel.refresh();
        };
        els.subCategory.onchange = () => {
            els.status.textContent = "";
            CategoryPanel.refresh();
        };
        els.batch.onclick = CategoryPanel.blockLoaded;
        els.addRule.onclick = () => CategoryPanel.saveRule(CategoryPanel.selection(), true);
        CategoryPanel.els = els;
        CategoryPanel.refresh();
    },

    unmount: () => {
        CategoryPanel.els = null;
    },

    focus: () => {
        CategoryPanel.els?.category.focus();
    },

    selection: () => {
        const { category, subCategory } = CategoryPanel.els;
        return Category.build(category.value, subCategory.value);
    },
    change: async (action) => {
        const els = CategoryPanel.els;
        if (!els || els.busy) return;
        els.busy = true;
        CategoryPanel.refresh();
        try {
            els.status.textContent = await action();
        } catch (err) {
            console.error("QidianBlocker Category Error:", err);
            els.status.textContent = `操作失败：${err.message}`;
        } finally {
            els.busy = false;
            if (CategoryPanel.els === els) CategoryPanel.refresh();
        }
    },
    blockLoaded: () => {
        const selection = CategoryPanel.selection();
        const entries = ListPage.getBatchEntries(selection);
        const count = Object.keys(entries).length;
        if (!count || !confirm(`将「${Category.label(selection)}」中已加载的 ${count} 本书加入屏蔽列表？`)) return;
        return CategoryPanel.change(async () => {
            const added = await Storage.addMany(entries);
            return added.length ? `已屏蔽 ${added.length} 本书` : "这些书已在屏蔽列表中";
        });
    },
    saveRule: (rule, enabled) => CategoryPanel.change(async () => {
        const changed = await Storage.setCategoryRule(rule, enabled);
        if (enabled) return changed ? `已添加「${Category.label(rule)}」规则` : "规则已存在";
        return changed ? `已移除「${Category.label(rule)}」规则` : "规则已移除";
    }),

    refresh: () => {
        const els = CategoryPanel.els;
        if (!els) return;
        const rules = Storage.getCategoryRules();
        const categories = new Map();
        const addCategory = ({ category, subCategory }) => {
            if (!category) return;
            if (!categories.has(category)) categories.set(category, new Set());
            if (subCategory) categories.get(category).add(subCategory);
        };
        ListPage.byItem.forEach((record) => addCategory(record.category));
        rules.forEach(addCategory);
        Object.values(Storage.getMap()).forEach(addCategory);
        fillSelect(els.category, sortNames(categories.keys()), categories.size ? "选择大类" : "暂无可选大类");
        fillSelect(els.subCategory, sortNames(categories.get(els.category.value) ?? []), "整个大类");
        els.subCategory.disabled = !els.category.value;

        const selection = CategoryPanel.selection();
        const count = els.isListPage ? Object.keys(ListPage.getBatchEntries(selection)).length : 0;
        const coveredByCategory = Boolean(selection.subCategory) && rules.some((rule) =>
            !rule.subCategory && rule.category === selection.category);
        const exactExists = rules.some((rule) => Category.same(rule, selection));
        els.batch.textContent = selection.category ? `屏蔽已加载的 ${count} 本` : "屏蔽已加载的书";
        els.batch.disabled = !count || els.busy;
        els.addRule.disabled = !selection.category || els.busy || exactExists || coveredByCategory;
        els.addRule.textContent = coveredByCategory ? "已被大类规则覆盖" : "添加自动屏蔽规则";
        els.rules.replaceChildren(...rules.map((rule) => {
            const item = document.createElement("li");
            const label = document.createElement("span");
            label.textContent = Category.label(rule);
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "qd-btn";
            remove.textContent = "移除规则";
            remove.setAttribute("aria-label", `移除 ${Category.label(rule)} 规则`);
            remove.disabled = els.busy;
            remove.onclick = () => CategoryPanel.saveRule(rule, false);
            item.append(label, remove);
            return item;
        }));
        if (!rules.length) {
            const empty = document.createElement("li");
            empty.textContent = "暂无规则";
            els.rules.append(empty);
        }
    }
};
