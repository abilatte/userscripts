import { GM_addStyle, GM_registerMenuCommand } from '$';
import { detectPage } from './core/extract';
import { type Arrival, consumeAutoOpen, createSite, findSite, loadSites, normalizeHost, upsertSite } from './storage';
import type { SiteEntry } from './types';
import { Entry } from './ui/Entry';
import { mountHost, type Host } from './ui/host';
import { Picker } from './ui/Picker';
import { Reader } from './ui/Reader';

const ENTRY_ID = 'nr-entry';
const READER_ID = 'nr-reader';
const PICKER_ID = 'nr-picker';
/** 强制打开时使用的临时站点 id，适配保存后才加入站点列表 */
const TEMP_ID = 'temp';

let entry: Host | undefined;
let reader: Host | undefined;
let picker: Host | undefined;
let styleInjected = false;

function hideEntry() {
  entry?.destroy();
  entry = undefined;
}

function showEntry(site: SiteEntry, kind: 'read' | 'adapt') {
  hideEntry();
  entry = mountHost(
    ENTRY_ID,
    <Entry kind={kind} onClick={() => (kind === 'read' ? openReader(site) : startPicker(site))} onDismiss={hideEntry} />,
  );
}

function openReader(site: SiteEntry, arrival?: Arrival) {
  if (reader) return;
  hideEntry();
  if (!styleInjected) {
    // 阅读模式下隐藏原页面（含后插入的广告），只保留阅读器
    GM_addStyle(`
      html.nr-active > :not(#${READER_ID}):not(head) { display: none !important; }
      html.nr-active { overflow: hidden !important; }
    `);
    styleInjected = true;
  }
  const originalUrl = location.href;
  const originalTitle = document.title;
  document.documentElement.classList.add('nr-active');
  // 没有 viewport 的站点在手机上会按 980px 布局，阅读器需要按设备宽度排版
  let viewport: HTMLMetaElement | undefined;
  if (!document.querySelector('meta[name="viewport"]')) {
    viewport = document.createElement('meta');
    viewport.name = 'viewport';
    viewport.content = 'width=device-width, initial-scale=1';
    document.head.append(viewport);
  }

  const close = () => {
    reader?.destroy();
    reader = undefined;
    viewport?.remove();
    document.documentElement.classList.remove('nr-active');
  };

  reader = mountHost(
    READER_ID,
    <Reader
      site={site}
      startUrl={originalUrl}
      firstDoc={site.freshFirst ? undefined : document}
      guessedBookName={guessBookName()}
      arrival={arrival}
      onExit={(currentUrl) => {
        close();
        if (currentUrl === originalUrl) {
          if (location.href !== originalUrl) history.replaceState(history.state, '', originalUrl);
          document.title = originalTitle;
          boot();
        } else {
          // 回到当前所读章节的原始页面
          if (location.href === currentUrl) location.reload();
          else location.href = currentUrl;
        }
      }}
      onReadapt={() => {
        close();
        // 点选在当前文档上进行，恢复为该文档对应的地址和标题
        history.replaceState(history.state, '', originalUrl);
        document.title = originalTitle;
        startPicker(site);
      }}
    />,
  );
}

/**
 * 从网页标题猜书名：标题通常是「章节名-书名-作者-分类-站名」或「书名_章节名_站名」，
 * 取第一个不像章节名的片段。
 */
function guessBookName(): string {
  const norm = (s: string) => s.replace(/\s+/g, '');
  const h1 = norm(document.querySelector('h1')?.textContent ?? '');
  const segments = document.title
    .split(/[-_|｜–—]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const book = segments.find((seg) => {
    const n = norm(seg);
    return !/第[\d零一二三四五六七八九十百千万]+[章节回卷]/.test(seg) && !(h1 && (h1.includes(n) || n.includes(h1)));
  });
  return book ?? location.hostname;
}

function startPicker(site: SiteEntry) {
  if (picker) return;
  hideEntry();
  const stop = () => {
    picker?.destroy();
    picker = undefined;
  };
  picker = mountHost(
    PICKER_ID,
    <Picker
      site={site}
      onSave={(updated) => {
        stop();
        upsertSite(updated.id === TEMP_ID ? { ...updated, id: `site-${updated.hosts[0]}` } : updated);
        boot();
      }}
      onCancel={() => {
        stop();
        boot();
      }}
    />,
  );
}

function tempSite(): SiteEntry {
  const host = normalizeHost(location.hostname);
  return { id: TEMP_ID, name: host, hosts: [host], enabled: true };
}

/** 判断当前页面并显示对应的入口按钮 */
function boot(): boolean {
  hideEntry();
  const site = findSite(loadSites(), location.hostname);
  if (!site || !site.enabled) return false;
  if (detectPage(document, site, location.href)) {
    // 从书架跳转过来的章节直接进入阅读模式
    const arrival = consumeAutoOpen(location.href);
    if (arrival) openReader(site, arrival);
    else showEntry(site, 'read');
    return true;
  }
  if (!site.content) {
    showEntry(site, 'adapt');
    return true;
  }
  return false;
}

function registerMenus() {
  const site = findSite(loadSites(), location.hostname);
  if (!site) {
    GM_registerMenuCommand('将本站加入阅读站点', () => {
      try {
        createSite(location.hostname);
        boot();
      } catch (e) {
        alert((e as Error).message);
      }
    });
  } else {
    GM_registerMenuCommand('适配本站（点选正文）', () => startPicker(site));
  }
  GM_registerMenuCommand('强制在此页打开阅读模式', () => openReader(site ?? tempSite()));
}

/** 页面内容变化后隔多久重新判断一次 */
const LATE_BOOT_DEBOUNCE = 400;
/** load 之后最多等多久，超过就不再监听 */
const LATE_BOOT_WINDOW = 10_000;

/**
 * 部分站点正文由脚本延迟渲染：load 后再判断一次，仍识别不到就在一段时间内跟随页面变化重试。
 * 只对站点列表里的站点监听，其它网页不受影响。
 */
function bootLater() {
  const idle = () => !reader && !picker;
  if (!idle() || boot()) return;
  const site = findSite(loadSites(), location.hostname);
  if (!site?.enabled) return;
  let timer = 0;
  const observer = new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (!idle() || boot()) stop();
    }, LATE_BOOT_DEBOUNCE);
  });
  const stop = () => {
    observer.disconnect();
    window.clearTimeout(timer);
    window.clearTimeout(deadline);
  };
  const deadline = window.setTimeout(stop, LATE_BOOT_WINDOW);
  observer.observe(document.body, { childList: true, subtree: true });
}

registerMenus();
if (!boot()) {
  if (document.readyState === 'complete') bootLater();
  else window.addEventListener('load', bootLater, { once: true });
}
