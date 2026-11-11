import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const runBuild = process.argv.includes('--build');

function readFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function pass(message) {
  console.log(`[PASS] ${message}`);
}

function fail(message, failures) {
  failures.push(message);
  console.log(`[FAIL] ${message}`);
}

async function runBuildCheck(failures) {
  try {
    const moduleUrl = `${pathToFileURL(path.join(rootDir, 'build-userscript.mjs')).href}?t=${Date.now()}`;
    await import(moduleUrl);
    pass('构建命令通过');
    return true;
  } catch (error) {
    fail(`构建命令失败（${error.message}）`, failures);
    return false;
  }
}

async function runNodeScriptCheck(relativePath, description, failures) {
  try {
    const moduleUrl = `${pathToFileURL(path.join(rootDir, relativePath)).href}?t=${Date.now()}`;
    await import(moduleUrl);
    pass(description);
    return true;
  } catch (error) {
    fail(`${description} 失败（${error.message}）`, failures);
    return false;
  }
}

function runSyntaxCheck(scriptPath, failures, description) {
  try {
    const source = fs.readFileSync(path.join(rootDir, scriptPath), 'utf8');
    new vm.Script(source, { filename: scriptPath });
    pass(`${description} 通过`);
    return true;
  } catch (error) {
    fail(`${description} 失败（${error.message}）`, failures);
    return false;
  }
}

function extractVersion(content, pattern, label, failures) {
  const match = content.match(pattern);
  if (!match) {
    fail(`无法解析 ${label}`, failures);
    return '';
  }
  return match[1];
}

const failures = [];

const header = readFile('src/entry/header.js');
const settingsNavbar = readFile('src/modules/settings-navbar.js');
const settingsModal = readFile('src/modules/settings-modal.js');
const searchUi = readFile('src/modules/search-ui.js');
const uiTranslation = readFile('src/modules/ui-translation.js');
const contentTranslation = readFile('src/modules/content-translation.js');
const buildScript = readFile('build-userscript.mjs');
const projectReadme = readFile('nhentai Pro.md');
// AGENTS.md 为本地 AI 手册，可不纳入仓库；存在时才校验其中的版本引用
const agentsPath = path.join(rootDir, 'AGENTS.md');
const agentsDoc = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : '';

const headerVersion = extractVersion(header, /@version\s+([0-9.]+)/, 'header 版本号', failures);
const zhTitleVersion = extractVersion(settingsNavbar, /"title": "nHentai Pro .*? v([0-9.]+)"/, '设置标题中文版本号', failures);
const enTitleVersion = extractVersion(settingsNavbar, /"title": "nHentai Pro Settings v([0-9.]+)"/, '设置标题英文版本号', failures);
const panelVersion = extractVersion(settingsModal, /<span class="version">v([0-9.]+)<\/span>/, '设置面板角标版本号', failures);
// 产物文件名固定、不带版本号：GitHub raw 的 @updateURL 依赖稳定路径
const expectedMainScript = 'nhentai-pro.user.js';
const buildOutputMatch = buildScript.match(/const outputFile = '([^']+)';/);
const buildOutputFile = buildOutputMatch ? buildOutputMatch[1] : '';
const headerUpdateUrlCount = header
  .split(/\r?\n/)
  .filter(line => /^\/\/ @(updateURL|downloadURL)\s/.test(line) && line.trimEnd().endsWith(`/nhentai/${expectedMainScript}`))
  .length;
const readmeBadgeVersion = extractVersion(projectReadme, /Version-([0-9.]+)-ed2553/, 'README 版本徽章', failures);

let agentsVersion = '';
if (agentsDoc) {
  agentsVersion = extractVersion(agentsDoc, /现为 \*\*([0-9.]+)\*\*/, 'AGENTS 当前版本号', failures);
} else {
  pass('AGENTS.md 未纳入仓库（本地可选），跳过其版本校验');
}

const rootFiles = fs.readdirSync(rootDir, { withFileTypes: true });
const rootUserScripts = rootFiles
  .filter(entry => entry.isFile() && /\.user\.js$/.test(entry.name))
  .map(entry => entry.name)
  .sort();

const requiredFiles = [
  expectedMainScript,
  'build-userscript.mjs',
  'src/entry/header.js',
  'src/modules/settings-navbar.js',
  'src/modules/settings-modal.js',
  'src/modules/detail-blacklist.js',
  'src/modules/user-settings-blacklist.js',
  'src/modules/search-ui.js',
  'src/modules/ui-translation.js',
  'src/modules/content-translation.js',
  'src/modules/reading-mode.js',
  'src/modules/gallery-meta.js',
  'src/modules/gallery-meta-transport.js',
  'src/modules/gallery-meta-queue-policy.js',
  'tools/self-check.mjs',
  'tools/check-gallery-meta-interface.mjs',
  'tools/test-gallery-meta-queue-policy.mjs',
  'tools/test-ehtag-gender-merge.mjs',
  'tools/translate_tags.py',
  'nhentai Pro.md'
];

requiredFiles.forEach(relativePath => {
  if (fs.existsSync(path.join(rootDir, relativePath))) {
    pass(`存在 ${relativePath}`);
  } else {
    fail(`缺少 ${relativePath}`, failures);
  }
});

if (rootUserScripts.length === 1 && rootUserScripts[0] === expectedMainScript) {
  pass(`根目录主脚本唯一且名称正确：${expectedMainScript}`);
} else {
  fail(`根目录主脚本状态异常：${rootUserScripts.join(', ') || '无'}`, failures);
}

if (buildOutputFile === expectedMainScript) {
  pass(`构建输出文件名固定为 ${expectedMainScript}`);
} else {
  fail(`构建输出文件名应为 ${expectedMainScript}，实际为 ${buildOutputFile || 'N/A'}`, failures);
}

if (headerUpdateUrlCount === 2) {
  pass('@updateURL / @downloadURL 均指向固定产物文件名');
} else {
  fail(`@updateURL / @downloadURL 未同时指向 nhentai/${expectedMainScript}`, failures);
}

const versions = [
  ['header', headerVersion],
  ['settings.zh', zhTitleVersion],
  ['settings.en', enTitleVersion],
  ['panel', panelVersion],
  ['readme.badge', readmeBadgeVersion]
];
if (agentsDoc) {
  versions.push(['agents', agentsVersion]);
}

const uniqueVersions = Array.from(new Set(versions.map(([, version]) => version).filter(Boolean)));
if (uniqueVersions.length === 1 && uniqueVersions[0] === headerVersion) {
  pass(`版本一致：${headerVersion}`);
} else {
  fail(`版本不一致：${versions.map(([name, version]) => `${name}=${version || 'N/A'}`).join(', ')}`, failures);
}

if (runBuild) {
  await runBuildCheck(failures);
}

runSyntaxCheck(expectedMainScript, failures, `语法检查 ${expectedMainScript}`);
await runNodeScriptCheck(
  'tools/check-gallery-meta-interface.mjs',
  'GalleryMeta interface 结构检查',
  failures
);
await runNodeScriptCheck(
  'tools/test-gallery-meta-queue-policy.mjs',
  'GalleryMeta 队列策略特征测试',
  failures
);
await runNodeScriptCheck(
  'tools/test-ehtag-gender-merge.mjs',
  'EhTag gender 合并检查',
  failures
);

if (failures.length > 0) {
  console.log('');
  console.log(`[SUMMARY] ${failures.length} 项检查失败`);
  process.exit(1);
}

console.log('');
console.log('[SUMMARY] 全部检查通过');
