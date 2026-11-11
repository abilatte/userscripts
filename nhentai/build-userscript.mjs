import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

const sourceFiles = [
  'src/entry/header.js',
  'src/entry/open.js',
  'src/modules/config-foundation.js',
  'src/modules/core-cache.js',
  'src/modules/dom-utils.js',
  'src/modules/nhentai-bridge.js',
  'src/modules/cdn-utils.js',
  'src/modules/gallery-normalize.js',
  'src/modules/styles-utils.js',
  'src/modules/db.js',
  'src/modules/settings-navbar.js',
  'src/modules/settings-modal.js',
  'src/modules/detail-blacklist.js',
  'src/modules/user-settings-blacklist.js',
  'src/modules/search-ui.js',
  'src/modules/ui-translation.js',
  'src/modules/content-translation.js',
  'src/modules/gallery-runtime-bridge.js',
  'src/modules/infinite-scroll.js',
  'src/modules/gallery-meta-core.js',
  'src/modules/gallery-meta-transport.js',
  'src/modules/gallery-meta-queue-policy.js',
  'src/modules/gallery-meta-resolver.js',
  'src/modules/gallery-meta-request-queue.js',
  'src/modules/gallery-meta-viewport.js',
  'src/modules/gallery-meta.js',
  'src/modules/reading-mode.js',
  'src/modules/diagnostics.js',
  'src/modules/preview.js',
  'src/modules/bootstrap.js',
];

const outputFile = 'nhentai-pro.user.js';

function readSourceFile(relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  return fs.readFileSync(absolutePath, 'utf8').replace(/\r\n/g, '\n');
}

// 版本号只在 header.js 的 @version 维护；其余源码用 __NH_VERSION__ 占位，构建时统一注入。
const VERSION_TOKEN = '__NH_VERSION__';
const versionMatch = readSourceFile('src/entry/header.js').match(/^\/\/ @version\s+([0-9.]+)\s*$/m);
if (!versionMatch) {
  throw new Error('[build-userscript] 无法从 src/entry/header.js 解析 @version');
}
const version = versionMatch[1];

const output = sourceFiles
  .map(readSourceFile)
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .split(VERSION_TOKEN)
  .join(version);

fs.writeFileSync(path.join(rootDir, outputFile), output, 'utf8');
console.log(`[build-userscript] 已生成 ${outputFile}（v${version}）`);
