import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const modulesDir = path.join(rootDir, 'src/modules');
const failures = [];

function fail(message) {
    failures.push(message);
    console.log(`[FAIL] ${message}`);
}

function pass(message) {
    console.log(`[PASS] ${message}`);
}

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

const internalFiles = new Set([
    'gallery-meta-core.js',
    'gallery-meta-transport.js',
    'gallery-meta-queue-policy.js',
    'gallery-meta-resolver.js',
    'gallery-meta-request-queue.js',
    'gallery-meta-viewport.js',
    'gallery-meta.js'
]);
const forbiddenSymbols = [
    'PageMetaResolver',
    'RequestQueue',
    'PrefetchManager',
    'getCompleteMeta',
    'runPageNumberDisplay',
    'GalleryMetaTransport',
    'GalleryMetaQueuePolicy'
];

for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js') || internalFiles.has(entry.name)) continue;
    const source = fs.readFileSync(path.join(modulesDir, entry.name), 'utf8');
    for (const symbol of forbiddenSymbols) {
        if (new RegExp(`\\b${symbol}\\b`).test(source)) {
            fail(`${entry.name} 越过 GalleryMeta seam 引用了 ${symbol}`);
        }
    }
    if (entry.name !== 'core-cache.js' && /\bcache\.(?:get|set|has)\s*\(/.test(source)) {
        fail(`${entry.name} 直接访问画廊元数据 cache`);
    }
}

if (!failures.length) {
    pass('外部调用方未访问 GalleryMeta 内部 implementation');
}

const publicModule = read('src/modules/gallery-meta.js');
for (const method of ['get', 'refresh', 'snapshot']) {
    if (new RegExp(`\\n\\s{8}${method}\\(`).test(publicModule)) {
        pass(`GalleryMeta.${method} interface 存在`);
    } else {
        fail(`缺少 GalleryMeta.${method} interface`);
    }
}

const buildScript = read('build-userscript.mjs');
const expectedOrder = [
    'gallery-meta-core.js',
    'gallery-meta-transport.js',
    'gallery-meta-queue-policy.js',
    'gallery-meta-resolver.js',
    'gallery-meta-request-queue.js',
    'gallery-meta-viewport.js',
    'gallery-meta.js'
];
let previousIndex = -1;
for (const fileName of expectedOrder) {
    const index = buildScript.indexOf(fileName);
    if (index < 0) {
        fail(`构建脚本缺少 ${fileName}`);
    } else if (index <= previousIndex) {
        fail(`构建顺序错误：${fileName}`);
    } else {
        previousIndex = index;
    }
}
if (!buildScript.includes('page-meta.js')) {
    pass('构建脚本已移除旧 page-meta.js');
} else {
    fail('构建脚本仍引用旧 page-meta.js');
}

const requestQueue = read('src/modules/gallery-meta-request-queue.js');
for (const endpoint of ['API_ENDPOINTS.galleryV2', 'API_ENDPOINTS.legacyGallery']) {
    if (requestQueue.includes(endpoint)) {
        pass(`详情请求由统一 queue 使用 ${endpoint}`);
    } else {
        fail(`统一 queue 缺少 ${endpoint}`);
    }
}

if (failures.length) {
    console.log(`\n[SUMMARY] ${failures.length} 项检查失败`);
    process.exit(1);
}

console.log('\n[SUMMARY] GalleryMeta interface 检查通过');
