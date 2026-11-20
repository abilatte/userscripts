const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const loadSources = require("./support/load-sources.cjs");

const script = loadSources(`
    import { CoverPager } from "./src/pages/pagination.mjs";
    import { ListPage } from "./src/pages/list.mjs";
    Object.assign(globalThis, { pager: CoverPager, ListPage });
`);
const next = "https://www.qidian.com/all/chanId22-orderId11-page2/";

function createPager(responses) {
    const window = Object.assign(new EventTarget(), { scrollY: 100, innerHeight: 800 });
    const requests = [];
    let now = 0;
    const footerRect = { top: 900, bottom: 940 };
    const context = vm.createContext({
        GM_addStyle() {},
        window, AbortController, URL, setTimeout, clearTimeout,
        Date: { now: () => now },
        location: { origin: "https://www.qidian.com" },
        console: { warn() {} },
        fetch: async (url) => {
            requests.push(url);
            const status = responses.shift();
            assert.ok(status !== undefined, "unexpected pagination request");
            return { status, text: async () => "" };
        },
        DOMParser: class {
            parseFromString() {
                return {
                    querySelector: () => ({ dataset: { page: "2" }, querySelector: () => null }),
                    querySelectorAll: () => [{ querySelector: () => ({ dataset: { bid: "123" } }) }]
                };
            }
        }
    });
    script.runInContext(context);
    const { pager } = context;
    pager.append = () => {};
    const view = {
        page: { number: 1, next }, list: { isConnected: true }, retryCount: 0,
        footer: { getBoundingClientRect: () => footerRect },
        status: {}, retry: {}, openPage: {}, observer: { disconnect() {}, observe() {} }
    };
    pager.view = view;
    return {
        view, requests, footerRect, pager, ListPage: context.ListPage, load: () => pager.load(view),
        advance: () => { now += 1500; },
        wheel: (deltaY, target) => {
            const event = Object.assign(new Event("wheel"), { deltaY });
            if (target) Object.defineProperty(event, "target", { value: target });
            window.dispatchEvent(event);
        },
        scroll: (y) => { window.scrollY = y; window.dispatchEvent(new Event("scroll")); }
    };
}

const flush = () => new Promise(setImmediate);

test("临时故障后仅在靠近页尾向下滚动时重试，每页自动重试最多两次", async () => {
    const h = createPager([503, 503, 503, 200]);
    await h.load();
    assert.match(h.view.status.textContent, /HTTP 503.*向下滚动/);
    assert.equal(h.view.openPage.href, next);
    h.wheel(100);
    h.advance();
    h.wheel(-100);
    h.footerRect.top = 1200;
    h.wheel(100);
    assert.equal(h.requests.length, 1);

    h.footerRect.top = 900;
    h.wheel(100);
    h.wheel(100);
    await flush();
    assert.equal(h.requests.length, 2);
    h.advance();
    h.scroll(120);
    await flush();
    assert.equal(h.requests.length, 3);
    h.advance();
    h.wheel(100);
    assert.equal(h.requests.length, 3);
    assert.doesNotMatch(h.view.status.textContent, /向下滚动/);
    assert.equal(h.view.retry.hidden, false);

    await h.load();
    assert.deepEqual(h.requests, [next, next, next, next]);
    assert.equal(h.view.retryCount, 0);
    assert.match(h.view.status.textContent, /第 2 页.*最后一页/);
});

test("不完整页面、限流或跳转只提供手动恢复，继续滚动也不会自动请求", async () => {
    for (const [status, message] of [[202, /HTTP 202/], [429, /HTTP 429/], [0, /要求跳转/]]) {
        const h = createPager([status]);
        await h.load();
        assert.match(h.view.status.textContent, message);
        assert.equal(h.view.openPage.href, next);
        assert.equal(h.view.openPage.hidden, false);
        h.advance();
        h.wheel(100);
        h.scroll(120);
        assert.equal(h.requests.length, 1);
    }
});

test("弹窗内的 wheel 事件不会触发翻页失败后的自动重试", async () => {
    const h = createPager([503, 200]);
    await h.load();
    h.advance();

    h.wheel(100, { closest: (sel) => sel.includes(".qd-modal-dialog") ? {} : null });
    await flush();
    assert.equal(h.requests.length, 1);

    h.wheel(100, { closest: () => null });
    await flush();
    assert.equal(h.requests.length, 2);
});

test("全被屏蔽页在节流间隔后自动恢复观察且不暂停连续下滑", async () => {
    const observed = [];
    const scheduled = [];
    const pages = [
        { number: 2, next: "https://www.qidian.com/all/page3/" },
        { number: 3, next: "https://www.qidian.com/all/page4/" },
        { number: 4, next: "https://www.qidian.com/all/page5/" },
        { number: 5, next: null }
    ];
    const window = Object.assign(new EventTarget(), { scrollY: 100, innerHeight: 800 });
    const context = vm.createContext({
        GM_addStyle() {},
        window, AbortController, URL, Date,
        setTimeout: (fn, ms) => {
            scheduled.push({ fn, ms });
            return scheduled.length;
        },
        clearTimeout() {},
        location: { origin: "https://www.qidian.com" },
        console: { warn() {} },
        fetch: async () => ({ status: 200, text: async () => "" }),
        DOMParser: class {
            parseFromString() {
                const p = pages.shift();
                return {
                    querySelector: (sel) => sel === "#page-container" ? {
                        dataset: { page: String(p.number) },
                        querySelector: () => p.next ? { getAttribute: () => p.next } : null
                    } : null,
                    querySelectorAll: () => [{ querySelector: () => ({ dataset: { bid: "123" } }) }]
                };
            }
        }
    });
    script.runInContext(context);
    const { pager, ListPage } = context;
    ListPage.applyNew = (cards) => {
        cards.forEach((card) => ListPage.byItem.set(card, { blocked: true }));
    };
    pager.append = () => [{ id: "card" }];
    const view = {
        page: { number: 1, next }, list: { isConnected: true }, retryCount: 0, observeTimer: 0,
        footer: {}, status: {}, retry: { hidden: true }, openPage: { hidden: true },
        observer: { disconnect() {}, observe: (el) => observed.push(el) }
    };
    pager.view = view;

    for (let i = 0; i < 3; i++) {
        await pager.load(view);
        assert.equal(view.retry.hidden, true);
        assert.equal(observed.length, i);
        const observeTask = scheduled.findLast((item) => item.ms === 400);
        assert.ok(observeTask);
        observeTask.fn();
        assert.equal(observed.length, i + 1);
    }

    await pager.load(view);
    assert.match(view.status.textContent, /第 5 页.*最后一页/);
});

test("跨页切换到其他模式（如文字模式）时给出明确切换提示", async () => {
    const window = Object.assign(new EventTarget(), { scrollY: 100, innerHeight: 800 });
    const context = vm.createContext({
        GM_addStyle() {},
        window, AbortController, URL, setTimeout, clearTimeout, Date,
        location: { origin: "https://www.qidian.com" },
        console: { warn() {} },
        fetch: async () => ({ status: 200, text: async () => "" }),
        DOMParser: class {
            parseFromString() {
                return {
                    querySelector: (sel) => {
                        if (sel === "#page-container") return { dataset: { page: "2" }, querySelector: () => null };
                        if (sel === "#book-text") return {};
                        return null;
                    },
                    querySelectorAll: () => []
                };
            }
        }
    });
    script.runInContext(context);
    const { pager } = context;
    const view = {
        page: { number: 1, next }, list: { isConnected: true }, retryCount: 0, observeTimer: 0,
        footer: {}, status: {}, retry: { hidden: true }, openPage: { hidden: true },
        observer: { disconnect() {}, observe() {} }
    };
    pager.view = view;

    await pager.load(view);
    assert.match(view.status.textContent, /当前已切换为文字模式/);
    assert.equal(view.retry.hidden, false);
});

test("append 为封面设置 lazy、过滤 script、去重并对畸形 URL 容错", () => {
    const makeEl = (tag, attrs = {}) => ({
        tagName: tag.toUpperCase(),
        removed: false,
        attrs: { ...attrs },
        getAttribute(k) { return this.attrs[k] ?? null; },
        setAttribute(k, v) { this.attrs[k] = v; },
        remove() { this.removed = true; }
    });
    const makeCard = (bid, href, src) => {
        const link = { dataset: { bid } };
        const scriptEl = makeEl("script");
        const imgEl = makeEl("img", { src });
        const anchorEl = makeEl("a", { href });
        return {
            bid,
            scriptEl,
            imgEl,
            anchorEl,
            querySelector: (sel) => sel.includes("data-bid") ? link : null,
            querySelectorAll: (sel) => {
                if (sel === "script") return [scriptEl];
                if (sel === "img") return [imgEl];
                if (sel === "a[href], img[src]") return [anchorEl, imgEl];
                return [];
            }
        };
    };

    const appended = [];
    const existingDomItem = { id: "existing-100" };
    const list = {
        contains: (node) => node === existingDomItem,
        append: (frag) => appended.push(...frag.children)
    };
    const context = vm.createContext({
        GM_addStyle() {},
        URL,
        document: {
            createDocumentFragment: () => ({ children: [], append(n) { this.children.push(n); } }),
            importNode: (node) => node
        }
    });
    script.runInContext(context);
    const { pager, ListPage } = context;
    ListPage.byBid.set("100", new Set([{ item: existingDomItem }]));

    const items = [
        makeCard("100", "/book/100/", "//bookcover.yuewen.com/100.webp"),
        makeCard("101", "/book/101/", "//bookcover.yuewen.com/101.webp"),
        makeCard("101", "/book/101/", "//bookcover.yuewen.com/101.webp"),
        makeCard("102", "http://[bad", "//bookcover.yuewen.com/102.webp")
    ];
    const cards = pager.append(list, items, "https://www.qidian.com/all/");
    assert.equal(cards.length, 2);
    assert.equal(appended.length, 2);
    assert.equal(cards[0].bid, "101");
    assert.equal(cards[0].scriptEl.removed, true);
    assert.equal(cards[0].imgEl.loading, "lazy");
    assert.equal(cards[0].imgEl.attrs.src, "https://bookcover.yuewen.com/101.webp");
    assert.equal(cards[0].anchorEl.attrs.href, "https://www.qidian.com/book/101/");
    assert.equal(cards[1].bid, "102");
    assert.equal(cards[1].anchorEl.attrs.href, "http://[bad");
});

function createScheduledContext({ responses, pages, settings }) {
    let now = 10000;
    let nextTimerId = 1;
    const timers = new Map();
    const observed = [];
    const requests = [];
    const states = [];
    const window = Object.assign(new EventTarget(), { scrollY: 100, innerHeight: 800 });
    const context = vm.createContext({
        GM_addStyle() {},
        window, AbortController, URL,
        Date: { now: () => now },
        setTimeout: (fn, ms) => {
            const id = nextTimerId++;
            timers.set(id, { id, fn, ms, at: now + ms });
            return id;
        },
        clearTimeout: (id) => timers.delete(id),
        location: { origin: "https://www.qidian.com" },
        console: { warn() {} },
        fetch: async (url) => {
            requests.push(url);
            const resp = responses.shift();
            assert.ok(resp !== undefined, "unexpected pagination request");
            const status = typeof resp === "number" ? resp : resp.status;
            const retryAfter = typeof resp === "object" ? resp.retryAfter : undefined;
            return {
                status,
                headers: retryAfter !== undefined ? { get: (k) => k.toLowerCase() === "retry-after" ? String(retryAfter) : null } : undefined,
                text: async () => ""
            };
        },
        DOMParser: class {
            parseFromString() {
                const p = pages.shift();
                return {
                    querySelector: (sel) => sel === "#page-container" ? {
                        dataset: { page: String(p.number) },
                        querySelector: () => p.next ? { getAttribute: () => p.next } : null
                    } : null,
                    querySelectorAll: () => [{ querySelector: () => ({ dataset: { bid: "123" } }) }]
                };
            }
        }
    });
    script.runInContext(context);
    const { pager } = context;
    pager.configure({ getSettings: () => settings });
    pager.onStateChange((state) => states.push(state));
    pager.append = () => [];
    const view = {
        page: { number: 1, next }, list: { isConnected: true },
        footer: {}, status: {}, retry: { hidden: true }, stopBtn: { hidden: true },
        openPage: { hidden: true }, topBtn: { hidden: true },
        observer: { disconnect() {}, observe: (el) => observed.push(el) },
        observeTimer: 0, autoPaging: false, autoTarget: 0, autoLoaded: 0, autoTimer: 0,
        retryCount: 0, rateLimitRetryCount: 0, rateLimitTimer: 0, rateLimitCountdownTimer: 0
    };
    pager.view = view;
    const runNextTimer = async (expectedMs) => {
        const list = [...timers.values()].sort((a, b) => a.at - b.at);
        const target = expectedMs === undefined ? list[0] : list.find((t) => t.ms === expectedMs);
        assert.ok(target, `missing timer (expectedMs=${expectedMs})`);
        timers.delete(target.id);
        now = Math.max(now, target.at);
        await target.fn();
        await flush();
    };
    return { context, pager, view, timers, observed, requests, states, runNextTimer };
}

test("可配置翻页延迟生效（支持自定义毫秒及 0ms）", async () => {
    for (const delayMs of [1200, 0]) {
        const h = createScheduledContext({
            responses: [200],
            pages: [{ number: 2, next: "https://www.qidian.com/all/page3/" }],
            settings: { delayMs, rateLimitRetrySec: 0, autoTargetPages: 0, autoStart: false }
        });
        await h.pager.load(h.view);
        assert.equal(h.observed.length, 0);
        await h.runNextTimer(delayMs);
        assert.equal(h.observed.length, 1);
    }
});

test("HTTP 429 与 404 按配置秒数与 Retry-After 倒计时自动重试，达上限后停止并支持手动取消", async () => {
    // 1. rateLimitRetrySec === 0 时 404 不自动重试
    const hNoRetry = createScheduledContext({
        responses: [404],
        pages: [],
        settings: { delayMs: 200, rateLimitRetrySec: 0, autoTargetPages: 0, autoStart: false }
    });
    await hNoRetry.pager.load(hNoRetry.view);
    assert.match(hNoRetry.view.status.textContent, /HTTP 404/);
    assert.equal(hNoRetry.timers.size, 0);

    // 2. 取配置的 rateLimitRetrySec 与 Retry-After 的较大值，并支持每秒倒计时与手动取消
    const hCancel = createScheduledContext({
        responses: [{ status: 429, retryAfter: 5 }, 429],
        pages: [],
        settings: { delayMs: 200, rateLimitRetrySec: 3, autoTargetPages: 0, autoStart: false }
    });
    await hCancel.pager.load(hCancel.view);
    assert.match(hCancel.view.status.textContent, /HTTP 429.*5 秒后自动重试（第 1\/5 次）/);
    assert.equal(hCancel.view.stopBtn.hidden, false);
    assert.equal(hCancel.view.stopBtn.textContent, "取消重试");
    assert.ok([...hCancel.timers.values()].some((t) => t.ms === 5000));
    await hCancel.runNextTimer(1000);
    assert.match(hCancel.view.status.textContent, /HTTP 429.*4 秒后自动重试（第 1\/5 次）/);

    hCancel.pager.stopAuto(" · 已手动停止");
    assert.equal(hCancel.timers.size, 0);
    assert.equal(hCancel.view.stopBtn.hidden, true);
    assert.match(hCancel.view.status.textContent, /已手动停止/);

    // 3. HTTP 404 同样按配置秒数倒计时自动重试，连续 5 次（共 6 次）达上限后停止
    const hLimit = createScheduledContext({
        responses: [404, 404, 404, 404, 404, 404],
        pages: [],
        settings: { delayMs: 200, rateLimitRetrySec: 2, autoTargetPages: 0, autoStart: false }
    });
    await hLimit.pager.load(hLimit.view);
    assert.match(hLimit.view.status.textContent, /触发限流（HTTP 404），2 秒后自动重试（第 1\/5 次）/);
    for (let i = 0; i < 5; i++) {
        await hLimit.runNextTimer(2000);
    }
    assert.equal(hLimit.requests.length, 6);
    assert.match(hLimit.view.status.textContent, /连续触发限流（HTTP 404），已停止自动重试/);
    assert.equal(hLimit.timers.size, 0);
    assert.equal(hLimit.view.stopBtn.hidden, true);
});

test("自动翻页支持固定页数、0 翻到结尾、遇 429/404 自动恢复及中途停止", async () => {
    // 1. startAuto(2) 连翻 2 页后自动完成
    const hFixed = createScheduledContext({
        responses: [200, 200],
        pages: [
            { number: 2, next: "https://www.qidian.com/all/page3/" },
            { number: 3, next: "https://www.qidian.com/all/page4/" }
        ],
        settings: { delayMs: 300, rateLimitRetrySec: 0, autoTargetPages: 2, autoStart: false }
    });
    assert.equal(hFixed.pager.startAuto(2), true);
    await flush();
    assert.equal(hFixed.view.autoPaging, true);
    assert.match(hFixed.view.status.textContent, /自动翻页中（1\/2 页）/);
    await hFixed.runNextTimer(300);
    assert.equal(hFixed.view.autoPaging, false);
    assert.match(hFixed.view.status.textContent, /自动翻页已完成（共翻 2 页）/);
    assert.equal(hFixed.view.stopBtn.hidden, true);
    await hFixed.runNextTimer(300);
    assert.equal(hFixed.observed.length, 1);
    assert.equal(hFixed.states.at(-1).autoPaging, false);

    // 2. startAuto(0) 遇 429 与 404 自动重试后继续一直翻到最后一页
    const hToEnd = createScheduledContext({
        responses: [200, 429, 404, 200],
        pages: [
            { number: 2, next: "https://www.qidian.com/all/page3/" },
            { number: 3, next: null }
        ],
        settings: { delayMs: 100, rateLimitRetrySec: 2, autoTargetPages: 0, autoStart: false }
    });
    hToEnd.pager.startAuto(0);
    await flush();
    assert.match(hToEnd.view.status.textContent, /自动翻页中（已翻 1 页，至结尾）/);
    await hToEnd.runNextTimer(100);
    assert.equal(hToEnd.view.autoPaging, true);
    assert.match(hToEnd.view.status.textContent, /触发限流（HTTP 429），2 秒后自动重试/);
    await hToEnd.runNextTimer(2000);
    assert.equal(hToEnd.view.autoPaging, true);
    assert.match(hToEnd.view.status.textContent, /触发限流（HTTP 404），2 秒后自动重试（第 2\/5 次）/);
    await hToEnd.runNextTimer(2000);
    assert.equal(hToEnd.view.autoPaging, false);
    assert.match(hToEnd.view.status.textContent, /第 3 页.*已到最后一页/);
    assert.equal(hToEnd.requests.length, 4);

    // 3. 中途 stopAuto 立即取消待触发的自动翻页定时器
    const hStop = createScheduledContext({
        responses: [200],
        pages: [{ number: 2, next: "https://www.qidian.com/all/page3/" }],
        settings: { delayMs: 500, rateLimitRetrySec: 0, autoTargetPages: 0, autoStart: false }
    });
    hStop.pager.startAuto(0);
    await flush();
    assert.ok([...hStop.timers.values()].some((t) => t.ms === 500));
    hStop.pager.stopAuto(" · 已手动停止");
    assert.equal(hStop.view.autoPaging, false);
    assert.equal(hStop.timers.size, 0);
    assert.equal(hStop.observed.length, 1);
});
