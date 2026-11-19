const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const loadSources = require("./support/load-sources.cjs");

const script = loadSources(`
    import { Storage, DATA_KEY, STORAGE_LOCK } from "./src/core/storage.mjs";
    import { Sync } from "./src/core/sync.mjs";
    import { init } from "./src/app.mjs";
    Object.assign(globalThis, { Storage, Sync, init, DATA_KEY, STORAGE_LOCK });
`);
const entry = (title) => ({ title, time: 1 });
const config = (repo = "mock/old") => ({ repo, path: "blocklist.json", token: "mock-token" });

function createHarness(initial = {}) {
    const saved = new Map(Object.entries(initial));
    const local = new Map();
    const tabs = [];
    const requests = [];
    const waiters = [];
    const errors = [];
    const namespace = crypto.randomUUID();

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
                setItem: (key, value) => local.set(key, value)
            },
            location: { pathname: "/" },
            document: { readyState: "complete", addEventListener() {} },
            Date, AbortController, TextEncoder, TextDecoder, atob, btoa,
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
            GM_xmlhttpRequest: ({ method, url, data, onload, onabort }) => {
                const request = {
                    method, url, body: data && JSON.parse(data), aborted: false,
                    respond: (status, body) => onload({ status, responseText: JSON.stringify(body) }),
                    remote(sha, map) {
                        const content = Buffer.from(JSON.stringify(map)).toString("base64");
                        this.respond(200, { type: "file", sha, encoding: "base64", content });
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
    const nextRequest = async (method, repo = "mock/old") => {
        const request = requests.shift() ?? await new Promise((resolve) => waiters.push(resolve));
        assert.equal(request.method, method);
        assert.match(request.url, new RegExp("/repos/" + repo + "/"));
        return request;
    };
    return { createTab, deliver, nextRequest, saved, local, requests, errors };
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
    assert.deepEqual([...h.local.values()], ["2"]);
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
