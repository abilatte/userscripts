const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const loadSources = require("./support/load-sources.cjs");

const script = loadSources(`
    import { Storage, DATA_KEY, STORAGE_LOCK, STORAGE_INSTANCE_KEY } from "./src/core/storage.mjs";
    import { Sync } from "./src/core/sync.mjs";
    import { init } from "./src/app.mjs";
    Object.assign(globalThis, { Storage, Sync, init, DATA_KEY, STORAGE_LOCK, STORAGE_INSTANCE_KEY });
`);
const entry = (title) => ({ title, time: 1 });
const config = (repo = "mock/old") => ({ repo, path: "blocklist.json", token: "mock-token" });
const RealDate = Date;

function createHarness(initial = {}, initialLocal = {}) {
    const saved = new Map(Object.entries(initial));
    const local = new Map(Object.entries(initialLocal));
    const tabs = [];
    const requests = [];
    const waiters = [];
    const errors = [];
    const namespace = crypto.randomUUID();
    let timeOffset = 0;
    class TestDate extends RealDate {
        static now() { return RealDate.now() + timeOffset; }
    }

    const createTab = () => {
        const cache = structuredClone(saved);
        const notifications = [];
        const listeners = new Map();
        const context = vm.createContext({
            navigator: { locks: {
                request: (name, callback) => navigator.locks.request(namespace + name, callback)
            } },
            localStorage: {
                getItem: (key) => local.get(key) ?? null,
                setItem: (key, value) => local.set(key, value),
                removeItem: (key) => local.delete(key)
            },
            location: { pathname: "/" },
            document: { readyState: "complete", addEventListener() {} },
            Date: TestDate, AbortController, TextEncoder, TextDecoder, atob, btoa,
            console: { error: (...args) => errors.push(args) },
            setTimeout: (fn, ms) => ms < 1000 ? setTimeout(fn, ms) : undefined,
            clearTimeout,
            GM_addStyle() {},
            GM_registerMenuCommand() {},
            GM_addValueChangeListener: (key, listener) => listeners.set(key, listener),
            GM_getValue: (key, fallback) => cache.has(key) ? structuredClone(cache.get(key)) : fallback,
            GM_setValue: (key, value) => {
                cache.set(key, structuredClone(value));
                saved.set(key, structuredClone(value));
                for (const other of tabs) {
                    if (other === context) continue;
                    other.notifications.push(() => {
                        const previous = other.cache.get(key);
                        const next = structuredClone(value);
                        other.cache.set(key, next);
                        other.listeners.get(key)?.(key, previous, structuredClone(next), true);
                    });
                }
            },
            GM_xmlhttpRequest: ({ method, url, headers, data, onload, onabort }) => {
                const request = {
                    method, url, headers, body: data && JSON.parse(data), aborted: false,
                    respond: (status, body, responseHeaders = "") => onload({
                        status,
                        responseHeaders,
                        responseText: body === undefined ? "" : (typeof body === "string" ? body : JSON.stringify(body))
                    }),
                    remote(sha, map, etag = null) {
                        const content = Buffer.from(JSON.stringify(map)).toString("base64");
                        this.respond(200, { type: "file", sha, encoding: "base64", content }, etag ? `ETag: ${etag}\r\n` : "");
                    },
                    upload(sha) { this.respond(200, { content: { sha } }); },
                    books() { return JSON.parse(Buffer.from(this.body.content, "base64").toString()); }
                };
                if (waiters.length) waiters.shift()(request);
                else requests.push(request);
                return { abort() { request.aborted = true; onabort(); } };
            }
        });
        script.runInContext(context);
        Object.assign(context, { cache, listeners, notifications });
        tabs.push(context);
        // 通过正常入口安装监听器，测试显式控制同步开始时间。
        const run = context.Sync.run;
        context.Sync.run = () => {};
        context.init();
        context.Sync.run = run;
        return context;
    };

    const deliver = (tab) => tab.notifications.splice(0).forEach((notify) => notify());
    const advance = (ms) => { timeOffset += ms; };
    // 模拟仍在运行中的旧版 v2.8 标签页：用 Number() 读 STORAGE_LOCK，不读写实例键
    const createLegacyTab = () => {
        const cache = structuredClone(saved);
        const notifications = [];
        let _data = null;
        const tab = { cache, notifications };
        const read = () => {
            const s = cache.has("qidian_sync_config") ? structuredClone(cache.get("qidian_sync_config")) : null;
            if (_data?.revision > 0 && !(s?.revision > _data.revision)) return _data;
            if (s?.revision > 0) return s;
            return {
                revision: 0,
                mapRevision: 0,
                configRevision: 0,
                map: cache.has("qidian_blocked_map_v5") ? structuredClone(cache.get("qidian_blocked_map_v5")) : {},
                config: null,
                sync: { sha: null, upsert: [], remove: [], lastSyncTime: 0, lastCheckTime: 0, lastError: "" }
            };
        };
        const accept = (data) => {
            if (_data && data.revision <= _data.revision) return;
            _data = data;
        };
        tab.listeners = new Map([["qidian_sync_config", (_k, _old, next, remote) => {
            if (remote && next) accept(next);
        }]]);
        tab.Storage = {
            getMap: () => (_data ??= read()).map,
            add: (bid, title) => navigator.locks.request(namespace + "abilatte:qidian-blocker:storage", async () => {
                const revision = Number(local.get("abilatte:qidian-blocker:storage") ?? null);
                let current = read();
                while (current.revision < revision) {
                    await new Promise((r) => setTimeout(r, 25));
                    current = read();
                }
                accept(current);
                const next = { ...current, map: { ...current.map, [bid]: { title, time: 1 } } };
                next.revision++;
                next.mapRevision++;
                local.set("abilatte:qidian-blocker:storage", String(next.revision));
                cache.set("qidian_sync_config", structuredClone(next));
                saved.set("qidian_sync_config", structuredClone(next));
                for (const other of tabs) {
                    if (other === tab) continue;
                    other.notifications.push(() => {
                        const prev = other.cache.get("qidian_sync_config");
                        const copy = structuredClone(next);
                        other.cache.set("qidian_sync_config", copy);
                        other.listeners.get("qidian_sync_config")?.("qidian_sync_config", prev, structuredClone(copy), true);
                    });
                }
                accept(next);
            })
        };
        tabs.push(tab);
        return tab;
    };
    const nextRequest = async (method, repo = "mock/old") => {
        const request = requests.shift() ?? await new Promise((resolve) => waiters.push(resolve));
        assert.equal(request.method, method);
        assert.match(request.url, new RegExp("/repos/" + repo + "/"));
        return request;
    };
    return { createTab, createLegacyTab, deliver, advance, nextRequest, saved, local, requests, errors };
}

test("首次同步遇到 SHA 冲突，重试保留本机记录并接受远端变更", { timeout: 3000 }, async () => {
    const h = createHarness({ qidian_blocked_map_v5: { 1: "本机书" } });
    const { Sync, DATA_KEY } = h.createTab();
    await Sync.saveConfig(config());
    const running = Sync.run();

    (await h.nextRequest("GET")).remote("first", { 2: entry("远端旧书") });
    const first = await h.nextRequest("PUT");
    assert.deepEqual(Object.keys(first.books()), ["1", "2"]);
    assert.deepEqual(h.saved.get(DATA_KEY).sync.upsert, ["1"]);
    first.respond(409, {});

    (await h.nextRequest("GET")).remote("second", { 3: entry("远端新书") });
    const retry = await h.nextRequest("PUT");
    assert.equal(retry.body.sha, "second");
    assert.deepEqual(retry.books(), { 1: { title: "本机书", time: 0 }, 3: entry("远端新书") });
    retry.upload("uploaded");
    await running;
    assert.deepEqual(h.saved.get(DATA_KEY).map, retry.books());
    assert.deepEqual(h.saved.get(DATA_KEY).sync.upsert, []);
    assert.equal(h.saved.get(DATA_KEY).sync.sha, "uploaded");
    assert.deepEqual(h.errors, []);
});

test("远端含无效记录时停止同步，既不改本机书单也不覆盖远端", { timeout: 3000 }, async () => {
    for (const remote of [
        { settings: { theme: "dark" } },
        { 2: entry("有效书目"), 3: { title: "未知格式", notes: "保留这段内容" } },
        { 2: { title: "异常时间", time: true } }
    ]) {
        const h = createHarness({ qidian_blocked_map_v5: { 1: "本机书" } });
        const { Sync, DATA_KEY } = h.createTab();
        await Sync.saveConfig({ ...config(), path: "wrong.json" });
        const running = Sync.run();
        (await h.nextRequest("GET")).remote("original", remote);
        await running;
        assert.deepEqual(h.requests, []);
        const state = h.saved.get(DATA_KEY);
        assert.deepEqual(Object.keys(state.map), ["1"]);
        assert.equal(state.sync.sha, null);
        assert.match(state.sync.lastError, /mock\/old\/wrong\.json/);
    }
});

test("旧版字符串记录与空书单仍可作为远端数据", { timeout: 3000 }, async () => {
    for (const remote of [{ 2: "旧格式书目" }, {}]) {
        const h = createHarness();
        const { Sync, DATA_KEY } = h.createTab();
        await Sync.saveConfig(config());
        const running = Sync.run();
        (await h.nextRequest("GET")).remote("legacy", remote);
        await running;
        assert.deepEqual(h.requests, []);
        const state = h.saved.get(DATA_KEY);
        assert.deepEqual(Object.keys(state.map), Object.keys(remote));
        if (remote[2]) assert.deepEqual(state.map[2], { title: "旧格式书目", time: 0 });
        assert.equal(state.sync.sha, "legacy");
        assert.equal(state.sync.lastError, "");
    }
});

test("按分类批量加入书目保留旧记录，自动规则独立保存且不进入待同步书单", { timeout: 3000 }, async () => {
    const old = { ...entry("旧书"), category: "仙侠", subCategory: "古典仙侠" };
    const h = createHarness({
        qidian_blocked_map_v5: { 1: old },
        qidian_sync_config: config(),
        qidian_sync_state: { sha: "base" }
    });
    const a = h.createTab();
    const b = h.createTab();
    const { Storage, DATA_KEY } = a;
    const rule = { category: "仙侠", subCategory: "古典仙侠" };
    let ruleChanges = 0;
    b.Storage.onCategoryRulesChange(() => { ruleChanges++; });

    const added = await Storage.addMany({
        1: { title: "不要覆盖旧书", ...rule },
        2: { title: "新书", ...rule }
    });
    assert.deepEqual(Array.from(added), ["2"]);
    assert.deepEqual(h.saved.get(DATA_KEY).map[1], old);
    assert.deepEqual(h.saved.get(DATA_KEY).sync.upsert, ["2"]);
    assert.equal(await Storage.setCategoryRule(rule, true), true);
    assert.equal(await Storage.setCategoryRule(rule, true), false);
    h.deliver(b);
    assert.deepEqual(structuredClone(b.Storage.getCategoryRules()), [rule]);

    assert.equal(await Storage.setCategoryRule(rule, false), true);
    h.deliver(b);
    assert.equal(ruleChanges, 2);
    assert.deepEqual(h.saved.get(DATA_KEY).categoryRules, []);
    assert.deepEqual(h.saved.get(DATA_KEY).sync.upsert, ["2"]);
    assert.deepEqual(Object.keys(h.saved.get(DATA_KEY).map), ["1", "2"]);
    assert.deepEqual(h.requests, []);
});

test("首次同步耗尽重试后，重新打开标签页仍能上传本机记录", { timeout: 3000 }, async () => {
    const h = createHarness({ qidian_blocked_map_v5: { 1: "本机书" } });
    const a = h.createTab();
    await a.Sync.saveConfig(config());
    const running = a.Sync.run();
    for (let attempt = 0; attempt < 3; attempt++) {
        (await h.nextRequest("GET")).remote(`sha-${attempt}`, { 2: entry("远端书") });
        (await h.nextRequest("PUT")).respond(409, {});
    }
    await running;
    const state = h.saved.get(a.DATA_KEY).sync;
    assert.deepEqual(state.upsert, ["1"]);
    assert.equal(state.lastSyncTime, 0);
    assert.match(state.lastError, /请稍后重试/);

    const b = h.createTab();
    const next = b.Sync.run();
    (await h.nextRequest("GET")).remote("newer", {});
    const put = await h.nextRequest("PUT");
    assert.deepEqual(Object.keys(put.books()), ["1"]);
    put.upload("uploaded");
    await next;
    assert.equal(h.saved.get(a.DATA_KEY).sync.lastError, "");
});

test("改同步目标后，即使旧响应先于变更通知到达也无法写入", { timeout: 3000 }, async () => {
    const h = createHarness({ qidian_blocked_map_v5: { 1: "本机书" } });
    const a = h.createTab();
    const b = h.createTab();
    await a.Sync.saveConfig(config());
    h.deliver(b);
    const oldRun = a.Sync.run();
    const oldGet = await h.nextRequest("GET");

    await b.Sync.saveConfig(config("mock/new"));
    const newRun = b.Sync.run({ force: true });
    assert.equal(a.Sync.getConfig().repo, "mock/old");
    oldGet.remote("old-sha", { 2: entry("旧仓库书") });
    await new Promise(setImmediate);
    assert.deepEqual(h.requests, []);
    h.deliver(a);

    (await h.nextRequest("GET", "mock/new")).respond(404, {});
    const put = await h.nextRequest("PUT", "mock/new");
    assert.deepEqual(Object.keys(put.books()), ["1"]);
    put.upload("new-sha");
    await Promise.all([oldRun, newRun]);
    assert.equal(h.saved.get(a.DATA_KEY).sync.sha, "new-sha");
    assert.deepEqual(h.errors, []);
});

test("停用同步中止正在上传的请求，迟到的响应不会恢复同步状态", { timeout: 3000 }, async () => {
    const h = createHarness({ qidian_blocked_map_v5: { 1: "本机书" } });
    const { Sync, DATA_KEY } = h.createTab();
    await Sync.saveConfig(config());
    const running = Sync.run();
    (await h.nextRequest("GET")).respond(404, {});
    const put = await h.nextRequest("PUT");

    await Sync.clearConfig();
    assert.equal(put.aborted, true);
    put.upload("late");
    await running;
    const state = h.saved.get(DATA_KEY);
    assert.equal(state.config, null);
    assert.equal(state.sync.sha, null);
    assert.equal(state.sync.lastCheckTime, 0);
    assert.deepEqual(Object.keys(state.map), ["1"]);
    assert.deepEqual(h.errors, []);
});

test("关闭同步时，两个已读过旧缓存的标签页都能保存自己的改动", { timeout: 3000 }, async () => {
    const h = createHarness({ qidian_blocked_map_v5: { 1: "旧记录" } });
    const a = h.createTab();
    const b = h.createTab();
    a.Storage.getMap();
    b.Storage.getMap();

    await a.Storage.add("2", "A 的新记录", {});
    const bWrite = b.Storage.remove(["1"]);
    await new Promise(setImmediate);
    assert.equal(h.saved.get(a.DATA_KEY).map["1"].title, "旧记录");
    h.deliver(b);
    await bWrite;
    h.deliver(a);

    assert.deepEqual(Object.keys(a.Storage.getMap()), ["2"]);
    assert.deepEqual(Object.keys(b.Storage.getMap()), ["2"]);
    assert.equal(h.local.get(a.STORAGE_LOCK), "2");
    assert.equal(typeof h.local.get(a.STORAGE_INSTANCE_KEY), "string");
    assert.ok(h.local.get(a.STORAGE_INSTANCE_KEY).length > 0);
    for (const val of h.local.values()) {
        assert.ok(!val.includes("新记录") && !val.includes("mock-token"));
    }
    assert.deepEqual(h.requests, []);
});

test("上传期间其他标签页的新增和删除保留到下一次上传", { timeout: 3000 }, async () => {
    const h = createHarness({
        qidian_blocked_map_v5: { 1: entry("旧记录"), 2: entry("待传书") },
        qidian_sync_config: config(),
        qidian_sync_state: { sha: "base", upsert: ["2"] }
    });
    const a = h.createTab();
    const b = h.createTab();
    const running = a.Sync.run();
    (await h.nextRequest("GET")).remote("base", { 1: entry("旧记录") });
    const first = await h.nextRequest("PUT");
    assert.deepEqual(Object.keys(first.books()), ["1", "2"]);

    await b.Storage.merge({ 3: entry("新导入") });
    await b.Storage.remove(["1"]);
    h.deliver(a);
    first.upload("first-upload");
    await running;
    const state = h.saved.get(a.DATA_KEY).sync;
    assert.deepEqual(state.upsert, ["3"]);
    assert.deepEqual(state.remove, ["1"]);
    assert.equal(state.sha, "first-upload");

    const next = a.Sync.run();
    (await h.nextRequest("GET")).remote("first-upload", first.books());
    const second = await h.nextRequest("PUT");
    assert.deepEqual(Object.keys(second.books()), ["2", "3"]);
    second.upload("second-upload");
    await next;
    assert.deepEqual(h.saved.get(a.DATA_KEY).sync.remove, []);
    assert.deepEqual(h.errors, []);
});

test("旧版标签页与新版标签页同时打开交错写入互不覆盖", { timeout: 3000 }, async () => {
    const h = createHarness();
    const newTab = h.createTab();
    const oldTab = h.createLegacyTab();
    newTab.Storage.getMap();
    oldTab.Storage.getMap();

    // 1. 新标签页先屏蔽书 1，旧标签页持旧缓存写入书 2：旧标签页能读到纯数字版本号并等待通知
    await newTab.Storage.add("1", "新标签页书1", {});
    assert.equal(h.local.get(newTab.STORAGE_LOCK), "1");
    const oldWrite = oldTab.Storage.add("2", "旧标签页书2");
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(Object.keys(h.saved.get(newTab.DATA_KEY).map), ["1"]);
    h.deliver(oldTab);
    await oldWrite;
    assert.deepEqual(Object.keys(h.saved.get(newTab.DATA_KEY).map).sort(), ["1", "2"]);

    // 2. 旧标签页继续写入书 3，新标签页持旧缓存写入书 4：新标签页等待通知并保留全部书目
    await oldTab.Storage.add("3", "旧标签页书3");
    assert.equal(h.local.get(newTab.STORAGE_LOCK), "3");
    const newWrite = newTab.Storage.add("4", "新标签页书4", {});
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(Object.keys(h.saved.get(newTab.DATA_KEY).map).sort(), ["1", "2", "3"]);
    h.deliver(newTab);
    await newWrite;
    assert.deepEqual(Object.keys(h.saved.get(newTab.DATA_KEY).map).sort(), ["1", "2", "3", "4"]);
});

test("GM 缓存暂时为空、跨实例不一致或超时时绝不覆盖已保存书单，仅在显式重置锚点后恢复", { timeout: 3000 }, async () => {
    const lockKey = "abilatte:qidian-blocker:storage";
    const instanceKey = "abilatte:qidian-blocker:instance";

    // 1. 标签页 A 已写入书 1，标签页 B 缓存仍为空且通知未送达：超时必须报错且绝不覆盖书 1 或清除锚点
    const hLagEmpty = createHarness();
    const a = hLagEmpty.createTab();
    const b = hLagEmpty.createTab();
    b.Storage.getMap();

    await a.Storage.add("1", "已保存书1", {});
    assert.equal(hLagEmpty.local.get(lockKey), "1");

    const blockedWrite = b.Storage.add("2", "书2", {});
    const blockedRejected = assert.rejects(blockedWrite, /未能读取其他标签页刚保存的数据/);
    for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 20));
        hLagEmpty.advance(1500);
    }
    await blockedRejected;
    assert.deepEqual(Object.keys(hLagEmpty.saved.get(a.DATA_KEY).map), ["1"]);
    assert.equal(hLagEmpty.saved.get(a.DATA_KEY).revision, 1);
    assert.equal(hLagEmpty.local.get(lockKey), "1");

    // 收到通知后即可正常合并写入
    hLagEmpty.deliver(b);
    await b.Storage.add("2", "书2", {});
    assert.deepEqual(Object.keys(hLagEmpty.saved.get(a.DATA_KEY).map).sort(), ["1", "2"]);

    // 2. GM 数据确实被清空（localStorage 留有旧数字锚点）：不自动清空，需显式 resetAnchor() 后恢复
    const hCleared = createHarness({}, { [lockKey]: "50", [instanceKey]: "old-inst" });
    const tCleared = hCleared.createTab();
    const clearedWrite = tCleared.Storage.add("1", "书1", {});
    const clearedRejected = assert.rejects(clearedWrite, /重置版本锚点/);
    for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 20));
        hCleared.advance(1500);
    }
    await clearedRejected;
    assert.equal(hCleared.local.get(lockKey), "50");

    assert.equal(await tCleared.Storage.resetAnchor(), 0);
    await tCleared.Storage.add("1", "书1", {});
    assert.equal(hCleared.saved.get(tCleared.DATA_KEY).revision, 1);
    assert.equal(hCleared.local.get(lockKey), "1");

    // 3a. 实例 ID 不匹配且旧缓存版本号更小（例如旧标签页 revision=5 遇到新版 revision=7）：必须等待并在超时后报错，绝不写回 revision=6 覆盖新版书单
    const hCrossLag = createHarness({
        qidian_sync_config: { revision: 5, mapRevision: 1, configRevision: 0, instanceId: "inst-A", map: { 1: entry("旧书") }, config: null, sync: {} }
    }, {
        [lockKey]: "5",
        [instanceKey]: "inst-A"
    });
    const staleCrossTab = hCrossLag.createTab();
    staleCrossTab.Storage.getMap();
    const latestPayload = {
        revision: 7,
        mapRevision: 2,
        configRevision: 0,
        instanceId: "inst-B",
        map: { 1: entry("旧书"), 2: entry("新版书2") },
        config: null,
        sync: {}
    };
    hCrossLag.saved.set(staleCrossTab.DATA_KEY, structuredClone(latestPayload));
    hCrossLag.local.set(lockKey, "7");
    hCrossLag.local.set(instanceKey, "inst-B");

    const staleCrossWrite = staleCrossTab.Storage.add("3", "滞后书3", {});
    const staleCrossRejected = assert.rejects(staleCrossWrite, /重置版本锚点/);
    for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 20));
        hCrossLag.advance(1500);
    }
    await staleCrossRejected;
    assert.equal(hCrossLag.saved.get(staleCrossTab.DATA_KEY).revision, 7);
    assert.deepEqual(Object.keys(hCrossLag.saved.get(staleCrossTab.DATA_KEY).map).sort(), ["1", "2"]);

    // 3b. 实例 ID 不匹配且 current.revision >= anchor.revision：普通写入明确失败，显式 resetAnchor() 后才可写入
    const hCross = createHarness({
        qidian_sync_config: { revision: 10, mapRevision: 1, configRevision: 0, instanceId: "inst-B", map: { 9: entry("新实例书") }, config: null, sync: {} }
    }, {
        [lockKey]: "7",
        [instanceKey]: "inst-A"
    });
    const tabCross = hCross.createTab();
    await assert.rejects(tabCross.Storage.add("1", "书1", {}), /实例不一致/);
    assert.equal(hCross.saved.get(tabCross.DATA_KEY).revision, 10);
    assert.equal(await tabCross.Storage.resetAnchor(), 10);
    await tabCross.Storage.add("1", "书1", {});
    assert.equal(hCross.saved.get(tabCross.DATA_KEY).revision, 11);
    assert.deepEqual(Object.keys(hCross.saved.get(tabCross.DATA_KEY).map).sort(), ["1", "9"]);
    assert.equal(hCross.local.get(lockKey), "11");
    assert.equal(hCross.local.get(instanceKey), "inst-B");

    // 4. 同实例真实滞后：等待超时后仍抛出提示
    const hLag = createHarness({
        qidian_sync_config: { revision: 5, mapRevision: 1, configRevision: 0, instanceId: "inst-A", map: {}, config: null, sync: {} }
    }, {
        [lockKey]: "6",
        [instanceKey]: "inst-A"
    });
    const tabLag = hLag.createTab();
    const lagWrite = tabLag.Storage.add("1", "书1", {});
    const rejected = assert.rejects(lagWrite, /未能读取其他标签页刚保存的数据/);
    for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 20));
        hLag.advance(1500);
    }
    await rejected;
});

test("localStorage 不可用时普通写入明确失败并保持原书单与锚点完好", { timeout: 3000 }, async () => {
    const lockKey = "abilatte:qidian-blocker:storage";

    // 1. localStorage.getItem 抛 SecurityError：两个标签页写入均失败，不会互相覆盖
    const hReadFail = createHarness({ qidian_blocked_map_v5: { 1: entry("原书") } });
    const t1 = hReadFail.createTab();
    const t2 = hReadFail.createTab();
    t1.localStorage.getItem = () => { throw new Error("SecurityError"); };
    t2.localStorage.getItem = () => { throw new Error("SecurityError"); };

    await assert.rejects(t1.Storage.add("2", "新书2", {}), /localStorage 不可用/);
    await assert.rejects(t2.Storage.add("3", "新书3", {}), /localStorage 不可用/);
    assert.equal(hReadFail.saved.get(t1.DATA_KEY), undefined);
    assert.deepEqual(Object.keys(hReadFail.saved.get("qidian_blocked_map_v5")), ["1"]);

    // 2. localStorage.setItem 抛 QuotaExceededError：在 GM_setValue 之前中止，且保留原有锚点
    const hWriteFail = createHarness();
    const tab = hWriteFail.createTab();
    await tab.Storage.add("1", "书1", {});
    assert.equal(hWriteFail.local.get(lockKey), "1");

    tab.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    await assert.rejects(tab.Storage.add("2", "书2", {}), /localStorage 不可用/);
    assert.equal(hWriteFail.saved.get(tab.DATA_KEY).revision, 1);
    assert.deepEqual(Object.keys(hWriteFail.saved.get(tab.DATA_KEY).map), ["1"]);
    assert.equal(hWriteFail.local.get(lockKey), "1");
});

test("422 冲突判定：仅在未传 sha 且为缺 sha 冲突时重试，路径错误直接失败", { timeout: 3000 }, async () => {
    // 1. 无 sha 且为路径校验 422：直接报错，不重试
    const hBadPath = createHarness({ qidian_blocked_map_v5: { 1: "本机书" } });
    const tBadPath = hBadPath.createTab();
    await tBadPath.Sync.saveConfig(config());
    const rBadPath = tBadPath.Sync.run();
    (await hBadPath.nextRequest("GET")).respond(404, {});
    (await hBadPath.nextRequest("PUT")).respond(422, { message: "path contains a malformed component" });
    await rBadPath;
    assert.deepEqual(hBadPath.requests, []);
    assert.match(hBadPath.saved.get(tBadPath.DATA_KEY).sync.lastError, /422/);

    // 2. 已带 sha 返回 422：直接报错，不重试
    const hWithSha = createHarness({
        qidian_blocked_map_v5: { 1: entry("本地书"), 2: entry("待传书") },
        qidian_sync_config: config(),
        qidian_sync_state: { sha: "s1", upsert: ["2"] }
    });
    const tWithSha = hWithSha.createTab();
    const rWithSha = tWithSha.Sync.run();
    (await hWithSha.nextRequest("GET")).remote("s1", { 1: entry("本地书") });
    (await hWithSha.nextRequest("PUT")).respond(422, {});
    await rWithSha;
    assert.deepEqual(hWithSha.requests, []);
    assert.match(hWithSha.saved.get(tWithSha.DATA_KEY).sync.lastError, /422/);

    // 3. 无 sha 且返回缺 sha 422：视作冲突并重试成功
    const hMissingSha = createHarness({ qidian_blocked_map_v5: { 1: "本机书" } });
    const tMissingSha = hMissingSha.createTab();
    await tMissingSha.Sync.saveConfig(config());
    const rMissingSha = tMissingSha.Sync.run();
    (await hMissingSha.nextRequest("GET")).respond(404, {});
    (await hMissingSha.nextRequest("PUT")).respond(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' });
    (await hMissingSha.nextRequest("GET")).remote("remote-1", { 2: entry("远端书") });
    const retryPut = await hMissingSha.nextRequest("PUT");
    assert.equal(retryPut.body.sha, "remote-1");
    assert.deepEqual(Object.keys(retryPut.books()), ["1", "2"]);
    retryPut.upload("final");
    await rMissingSha;
    assert.equal(hMissingSha.saved.get(tMissingSha.DATA_KEY).sync.lastError, "");
});

test("增量同步 mergeRemote 保留远端已有分类字段", { timeout: 3000 }, async () => {
    const h = createHarness({
        qidian_blocked_map_v5: { 1: entry("本地旧名") },
        qidian_sync_config: config(),
        qidian_sync_state: { sha: "base" }
    });
    const tab = h.createTab();
    await tab.Storage.merge({ 1: { title: "本地新名", time: 2 } });

    const running = tab.Sync.run();
    (await h.nextRequest("GET")).remote("r2", {
        1: { title: "远端书", time: 1, category: "玄幻", subCategory: "东方玄幻" }
    });
    const put = await h.nextRequest("PUT");
    assert.deepEqual(put.books()[1], {
        title: "本地新名",
        time: 2,
        category: "玄幻",
        subCategory: "东方玄幻"
    });
    put.upload("r3");
    await running;
    assert.deepEqual(h.errors, []);
});

test("支持 ETag / 304 Not Modified：无改动跳过解析，有改动直接推送并在 409 时回退全量合并", { timeout: 3000 }, async () => {
    const h = createHarness({ qidian_blocked_map_v5: { 1: entry("书1") } });
    const tab = h.createTab();
    await tab.Sync.saveConfig(config());

    // 首次拉取获取 ETag
    const first = tab.Sync.run();
    const g1 = await h.nextRequest("GET");
    assert.equal(g1.headers["If-None-Match"], undefined);
    g1.remote("sha-1", { 1: entry("书1") }, '"etag-1"');
    await first;
    assert.equal(h.saved.get(tab.DATA_KEY).sync.etag, '"etag-1"');

    // 无本地改动命中 304：跳过解析与上传
    const second = tab.Sync.run({ force: true });
    const g2 = await h.nextRequest("GET");
    assert.equal(g2.headers["If-None-Match"], '"etag-1"');
    g2.respond(304);
    await second;
    assert.deepEqual(h.requests, []);
    assert.equal(h.saved.get(tab.DATA_KEY).sync.lastError, "");

    // 有本地改动且远端 304：直接带 sha 推送；若此时 409，重试时不带 ETag 全量合并
    await tab.Storage.add("2", "书2", {});
    const third = tab.Sync.run();
    const g3 = await h.nextRequest("GET");
    assert.equal(g3.headers["If-None-Match"], '"etag-1"');
    g3.respond(304);
    const p1 = await h.nextRequest("PUT");
    assert.equal(p1.body.sha, "sha-1");
    assert.deepEqual(Object.keys(p1.books()), ["1", "2"]);
    p1.respond(409, {});

    const g4 = await h.nextRequest("GET");
    assert.equal(g4.headers["If-None-Match"], undefined);
    g4.remote("sha-2", { 1: entry("书1"), 3: entry("远端书3") }, '"etag-2"');
    const p2 = await h.nextRequest("PUT");
    assert.equal(p2.body.sha, "sha-2");
    assert.deepEqual(Object.keys(p2.books()), ["1", "2", "3"]);
    p2.upload("sha-3");
    await third;
    assert.equal(h.saved.get(tab.DATA_KEY).sync.sha, "sha-3");
    assert.equal(h.saved.get(tab.DATA_KEY).sync.etag, null);
    assert.deepEqual(h.errors, []);
});
