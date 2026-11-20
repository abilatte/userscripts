const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const loadSources = require("./support/load-sources.cjs");

const script = loadSources(`
    import { Category, diffBlocklist, normalizeBlocklist, normalizeEntry, serializeBlocklist } from "./src/core/blocklist.mjs";
    import { Storage, DATA_KEY } from "./src/core/storage.mjs";
    import { Transfer } from "./src/ui/transfer.mjs";
    Object.assign(globalThis, { Category, diffBlocklist, normalizeBlocklist, normalizeEntry, serializeBlocklist, Storage, Transfer, DATA_KEY });
`);

function createEnv(initial = {}) {
    const saved = new Map(Object.entries(initial));
    const local = new Map();
    const alerts = [];
    const errors = [];
    let gmSetCount = 0;
    const namespace = crypto.randomUUID();
    const context = vm.createContext({
        navigator: { locks: { request: (name, cb) => navigator.locks.request(namespace + name, cb) } },
        localStorage: {
            getItem: (k) => local.get(k) ?? null,
            setItem: (k, v) => local.set(k, v),
            removeItem: (k) => local.delete(k)
        },
        Date, setTimeout, clearTimeout,
        console: { error: (...args) => errors.push(args) },
        alert: (msg) => alerts.push(msg),
        GM_getValue: (k, fb) => saved.has(k) ? structuredClone(saved.get(k)) : fb,
        GM_setValue: (k, v) => {
            gmSetCount++;
            saved.set(k, structuredClone(v));
        }
    });
    script.runInContext(context);
    return { context, saved, alerts, errors, getSetCount: () => gmSetCount };
}

test("normalizeEntry 与 normalizeBlocklist 校验各类合法与异常输入", () => {
    const { context } = createEnv();
    const { normalizeEntry, normalizeBlocklist } = context;

    assert.deepEqual(structuredClone(normalizeEntry(" 旧版书名 ")), { title: "旧版书名", time: 0 });
    assert.equal(normalizeEntry("   "), null);
    assert.equal(normalizeEntry(null), null);
    assert.equal(normalizeEntry([]), null);
    assert.equal(normalizeEntry({ title: "" }), null);
    assert.deepEqual(
        structuredClone(normalizeEntry({ title: " 测试书 ", time: -5, category: " 仙侠 ", subCategory: "" })),
        { title: "测试书", time: 0, category: "仙侠" }
    );
    assert.deepEqual(
        structuredClone(normalizeEntry({ title: "新书", time: 12345, category: "都市", subCategory: "都市生活" })),
        { title: "新书", time: 12345, category: "都市", subCategory: "都市生活" }
    );

    const { map, skipped } = normalizeBlocklist({
        "1001": { title: "有效1", time: 10 },
        "bad-id": { title: "非法ID", time: 10 },
        "1002": "有效2",
        "1003": { title: "  " }
    });
    assert.equal(skipped, 2);
    assert.deepEqual(structuredClone(map), {
        "1001": { title: "有效1", time: 10 },
        "1002": { title: "有效2", time: 0 }
    });
    assert.equal(normalizeBlocklist([]).skipped, 0);
});

test("diffBlocklist、serializeBlocklist 与 Category.canFill / matches", () => {
    const { context } = createEnv();
    const { Category, diffBlocklist, serializeBlocklist } = context;

    const diff = diffBlocklist(
        { "1": { title: "A", time: 1 }, "2": { title: "B", time: 2 } },
        { "2": { title: "B", time: 2, category: "奇幻" }, "3": { title: "C", time: 3 } }
    );
    assert.deepEqual(Array.from(diff.upsert), ["2", "3"]);
    assert.deepEqual(Array.from(diff.remove), ["1"]);

    assert.equal(serializeBlocklist({}), "{}\n");
    assert.equal(
        serializeBlocklist({
            "20": { subCategory: "古典仙侠", category: "仙侠", time: 2, title: "乙" },
            "10": { title: "甲", time: 1 }
        }),
        '{\n  "10": {"title":"甲","time":1},\n  "20": {"title":"乙","time":2,"category":"仙侠","subCategory":"古典仙侠"}\n}\n'
    );

    assert.equal(Category.canFill({ title: "A", time: 1 }, { category: "玄幻" }), true);
    assert.equal(Category.canFill({ title: "A", time: 1, category: "玄幻" }, { category: "都市" }), false);
    assert.equal(Category.canFill({ title: "A", time: 1, category: "玄幻" }, { category: "玄幻", subCategory: "东方玄幻" }), true);
    assert.equal(Category.canFill({ title: "A", time: 1, category: "玄幻", subCategory: "东方玄幻" }, { category: "都市", subCategory: "异能" }), false);

    assert.equal(Category.matches({ category: "仙侠", subCategory: "古典仙侠" }, { category: "仙侠" }), true);
    assert.equal(Category.matches({ category: "仙侠", subCategory: "古典仙侠" }, { category: "仙侠", subCategory: "修真文明" }), false);
});

test("Storage.fillCategories 在字段无缺失或无法补充时不发起事务写入", async () => {
    const env = createEnv({
        qidian_blocked_map_v5: {
            "1": { title: "缺小类", time: 1, category: "仙侠" },
            "2": { title: "完整", time: 1, category: "都市", subCategory: "都市生活" }
        }
    });
    const { Storage } = env.context;

    Storage.fillCategories({
        "1": { category: "仙侠" },
        "2": { category: "科幻", subCategory: "未来世界" },
        "999": { category: "历史", subCategory: "架空历史" }
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(env.getSetCount(), 0);

    Storage.fillCategories({
        "1": { category: "都市", subCategory: "修真文明" }
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(env.getSetCount(), 1);
    assert.deepEqual(structuredClone(Storage.getMap()["1"]), {
        title: "缺小类",
        time: 1,
        category: "仙侠",
        subCategory: "修真文明"
    });
});

test("Transfer.importText 处理畸形 JSON、非对象格式、全无效记录以及混合记录保留分类", async () => {
    const env = createEnv({
        qidian_blocked_map_v5: {
            "1": { title: "旧书", time: 1, category: "玄幻", subCategory: "东方玄幻" }
        }
    });
    const { Transfer, Storage } = env.context;

    await Transfer.importText("{not json");
    assert.match(env.alerts.at(-1), /不是有效的 JSON/);

    await Transfer.importText("[]");
    assert.match(env.alerts.at(-1), /数据格式应为/);

    await Transfer.importText(JSON.stringify({ "bad": { title: "无效ID" } }));
    assert.match(env.alerts.at(-1), /未发现有效记录/);

    await Transfer.importText(JSON.stringify({
        "1": { title: "新标题", time: 99 },
        "2": { title: "新增书", time: 50, category: "科幻" },
        "bad": { title: "跳过" }
    }));
    assert.match(env.alerts.at(-1), /新增 1 条，覆盖 1 条，跳过 1 条/);
    assert.deepEqual(structuredClone(Storage.getMap()["1"]), {
        title: "新标题",
        time: 99,
        category: "玄幻",
        subCategory: "东方玄幻"
    });
    assert.deepEqual(structuredClone(Storage.getMap()["2"]), {
        title: "新增书",
        time: 50,
        category: "科幻"
    });
});
