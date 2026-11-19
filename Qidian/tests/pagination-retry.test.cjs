const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const loadSources = require("./support/load-sources.cjs");

const script = loadSources(`
    import { CoverPager } from "./src/pages/pagination.mjs";
    globalThis.pager = CoverPager;
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
        view, requests, footerRect, load: () => pager.load(view),
        advance: () => { now += 1500; },
        wheel: (deltaY) => window.dispatchEvent(Object.assign(new Event("wheel"), { deltaY })),
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
