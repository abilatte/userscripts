const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

test("发布产物带原有元数据，并从正常入口加载样式、注册菜单", () => {
    const source = readFileSync(join(__dirname, "../qidian-novel-blocker.user.js"), "utf8");
    const metadata = readFileSync(join(__dirname, "../src/userscript.meta.txt"), "utf8").trimEnd();
    assert.ok(source.startsWith(metadata + "\n"));
    assert.match(metadata, /^\/\/ @run-at\s+document-start$/m);
    assert.match(metadata, /^\/\/ @downloadURL\s+https:\/\/raw\.githubusercontent\.com\/abilatte\/userscripts\/main\/Qidian\/qidian-novel-blocker\.user\.js$/m);

    let css;
    let reloaded = false;
    const values = new Map();
    const commands = new Map();
    const events = new Map();
    const context = {
        location: { pathname: "/all/", reload: () => { reloaded = true; } },
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
    runInNewContext(source, context);
    assert.match(css, /\.qd-hidden \{ display: none !important; \}/);
    assert.equal(typeof events.get("DOMContentLoaded"), "function");
    assert.equal(typeof events.get("visibilitychange"), "function");
    assert.equal(typeof commands.get("⚙️ 管理屏蔽列表"), "function");
    assert.equal(typeof commands.get("按分类屏蔽"), "function");
    commands.get("关闭内置无缝翻页")();
    assert.equal(values.get("qidian_cover_pager_enabled"), false);
    assert.equal(reloaded, true);
    assert.equal(context.Storage, undefined);
});
