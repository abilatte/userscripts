const { resolve } = require("node:path");
const { Script } = require("node:vm");
const { buildSync } = require("esbuild");

// 将公开的源码模块装入各测试自己的 VM，让每个标签页拥有独立的内存状态。
module.exports = (entry) => {
    const result = buildSync({
        absWorkingDir: resolve(__dirname, "../.."),
        stdin: { contents: entry, resolveDir: resolve(__dirname, "../..") },
        bundle: true,
        format: "iife",
        write: false
    });
    return new Script(result.outputFiles[0].text);
};
