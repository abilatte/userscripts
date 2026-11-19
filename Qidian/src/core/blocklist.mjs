export const BID_PATTERN = /^\d+$/;

// 存储格式：{ [bid]: { title, time, category?, subCategory? } }
// time 为 0 表示旧版本迁移来的记录；分区未知时不写对应字段
export const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export const Category = {
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

export const normalizeEntry = (value) => {
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
};

// 返回 { map, skipped }，skipped 为无效记录数
export const normalizeBlocklist = (rawMap) => {
    const map = {};
    let skipped = 0;
    if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) return { map, skipped };

    Object.keys(rawMap).forEach((bid) => {
        const entry = BID_PATTERN.test(bid) ? normalizeEntry(rawMap[bid]) : null;
        if (entry) map[bid] = entry;
        else skipped++;
    });
    return { map, skipped };
};

// 两份数据之间的差异：{ upsert: 新增或内容变化的 ID, remove: 被移除的 ID }
export const diffBlocklist = (oldMap, newMap) => {
    const same = (a, b) => a === b || (a.title === b.title && a.time === b.time &&
        a.category === b.category && a.subCategory === b.subCategory);
    return {
        upsert: Object.keys(newMap).filter((bid) => !hasOwn(oldMap, bid) || !same(oldMap[bid], newMap[bid])),
        remove: Object.keys(oldMap).filter((bid) => !hasOwn(newMap, bid))
    };
};
