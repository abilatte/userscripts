const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const loadSources = require("./support/load-sources.cjs");

test("发布产物带原有元数据，并从正常入口加载样式、只注册单个聚合菜单", () => {
    const source = readFileSync(join(__dirname, "../qidian-novel-blocker.user.js"), "utf8");
    const metadata = readFileSync(join(__dirname, "../src/userscript.meta.txt"), "utf8").trimEnd();
    assert.ok(source.startsWith(metadata + "\n"));
    assert.match(metadata, /^\/\/ @run-at\s+document-start$/m);
    assert.match(metadata, /^\/\/ @downloadURL\s+https:\/\/raw\.githubusercontent\.com\/abilatte\/userscripts\/main\/Qidian\/qidian-novel-blocker\.user\.js$/m);

    let css;
    const values = new Map();
    const commands = new Map();
    const events = new Map();
    const context = {
        location: { pathname: "/all/" },
        navigator: { locks: { request: () => Promise.resolve() } },
        document: {
            readyState: "loading",
            addEventListener: (event, callback) => events.set(event, callback)
        },
        MutationObserver: class { observe() {} },
        GM_addStyle: (value) => { css = value; },
        GM_addValueChangeListener() {},
        GM_getValue: (key, fallback) => values.get(key) ?? fallback,
        GM_setValue: (key, value) => values.set(key, value),
        GM_registerMenuCommand: (name, callback) => commands.set(name, callback)
    };
    vm.runInNewContext(source, context);
    assert.match(css, /\.qd-hidden \{ display: none !important; \}/);
    assert.equal(typeof events.get("DOMContentLoaded"), "function");
    assert.equal(typeof events.get("visibilitychange"), "function");
    assert.deepEqual(Array.from(commands.keys()), ["管理屏蔽与设置"]);
    assert.equal(typeof commands.get("管理屏蔽与设置"), "function");
    assert.equal(context.Storage, undefined);
});

test("统一面板可即时切换内置无缝翻页而不刷新页面，CoverPager.unmount 正确清理", () => {
    const script = loadSources(`
        import { init } from "./src/app.mjs";
        import { normalizePagerSettings, Settings, PAGER_SETTINGS_KEY } from "./src/core/settings.mjs";
        import { CoverPager } from "./src/pages/pagination.mjs";
        import { Panel } from "./src/ui/panel.mjs";
        Object.assign(globalThis, { init, normalizePagerSettings, Settings, PAGER_SETTINGS_KEY, CoverPager, Panel });
    `);

    let reloaded = false;
    let footerRemoved = false;
    let disconnected = false;
    const values = new Map();
    const commands = new Map();
    const context = vm.createContext({
        location: { pathname: "/all/", href: "https://www.qidian.com/all/", origin: "https://www.qidian.com", reload: () => { reloaded = true; } },
        navigator: { locks: { request: () => Promise.resolve() } },
        document: {
            readyState: "complete",
            addEventListener() {},
            querySelector: () => null,
            querySelectorAll: () => []
        },
        MutationObserver: class { observe() {} },
        clearTimeout() {},
        GM_addStyle() {},
        GM_addValueChangeListener() {},
        GM_getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback,
        GM_setValue: (key, value) => values.set(key, value),
        GM_registerMenuCommand: (name, callback) => commands.set(name, callback)
    });
    script.runInContext(context);
    context.init();

    assert.deepEqual(Array.from(commands.keys()), ["管理屏蔽与设置"]);
    context.CoverPager.view = {
        list: { isConnected: true },
        observer: { disconnect: () => { disconnected = true; } },
        observeTimer: 0,
        autoTimer: 0,
        rateLimitTimer: 0,
        rateLimitCountdownTimer: 0,
        request: null,
        scrollRetry: null,
        footer: { remove: () => { footerRemoved = true; } }
    };

    context.Panel._options.setCoverPagerEnabled(false);
    assert.equal(values.get("qidian_cover_pager_enabled"), false);
    assert.equal(reloaded, false);
    assert.equal(disconnected, true);
    assert.equal(footerRemoved, true);
    assert.equal(context.CoverPager.view, null);

    // 校验翻页设置规范化边界与 Settings 读写联动
    assert.deepEqual(structuredClone(context.normalizePagerSettings(null)), {
        delayMs: 400,
        rateLimitRetrySec: 0,
        autoTargetPages: 0,
        autoStart: false
    });
    assert.deepEqual(structuredClone(context.normalizePagerSettings({
        delayMs: -10,
        rateLimitRetrySec: "15.8",
        autoTargetPages: 1200,
        autoStart: 1
    })), {
        delayMs: 0,
        rateLimitRetrySec: 15,
        autoTargetPages: 999,
        autoStart: true
    });
    assert.deepEqual(structuredClone(context.normalizePagerSettings({ delayMs: "" })), {
        delayMs: 400,
        rateLimitRetrySec: 0,
        autoTargetPages: 0,
        autoStart: false
    });

    const saved = context.Panel._options.savePagerSettings({
        delayMs: 70000,
        rateLimitRetrySec: 12,
        autoTargetPages: 5,
        autoStart: true
    });
    assert.deepEqual(structuredClone(saved), {
        delayMs: 60000,
        rateLimitRetrySec: 12,
        autoTargetPages: 5,
        autoStart: true
    });
    assert.deepEqual(structuredClone(values.get(context.PAGER_SETTINGS_KEY)), structuredClone(saved));
    assert.deepEqual(structuredClone(context.CoverPager._readSettings()), structuredClone(saved));
});
