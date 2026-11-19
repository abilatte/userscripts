import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const output = new URL("qidian-novel-blocker.user.js", root);
const metadata = (await readFile(new URL("src/userscript.meta.txt", root), "utf8")).trimEnd();

const result = await build({
    absWorkingDir: fileURLToPath(root),
    entryPoints: ["src/index.mjs"],
    bundle: true,
    format: "iife",
    charset: "utf8",
    loader: { ".css": "text" },
    banner: { js: metadata + "\n\n// 此文件由 npm run build 生成，请修改 src 下的源码。" },
    write: false
});
const built = result.outputFiles[0].text;

if (process.argv.includes("--check")) {
    const saved = await readFile(output, "utf8");
    if (saved !== built) {
        console.error("qidian-novel-blocker.user.js 与源码不一致，请运行 npm run build。");
        process.exitCode = 1;
    }
} else {
    await writeFile(output, built, "utf8");
    console.log("已生成 qidian-novel-blocker.user.js");
}
