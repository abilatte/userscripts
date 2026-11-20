import type { Chapter, SiteEntry } from '../types';
import { extractChapter, parsePageMark, sameChapterTitle, stripPageMark } from './extract';
import { fetchDocument } from './fetcher';
import { getAdapter } from '../sites/adapters';

const MAX_PAGES_PER_CHAPTER = 30;
const MAX_CACHE_SIZE = 30;
const PREFETCH_CONCURRENCY = 4;

export interface ChapterLoader {
  /** 加载一整章：同标题的分页（"下一页"）会合并进来 */
  load(url: string, doc?: Document): Promise<Chapter>;
}

/** 根据第 1 页与第 2 页地址规律，推算第 2..N 页分页地址列表 */
function pagedUrls(firstUrl: string, secondUrl: string, total: number): string[] {
  const u = new URL(firstUrl);
  const nu = new URL(secondUrl);
  if (u.origin !== nu.origin || u.search !== nu.search) return [];
  const m = u.pathname.match(/^(.*?)(\.\w+)?$/);
  if (!m) return [];
  const [, base, ext = ''] = m;
  const sep = nu.pathname === `${base}_2${ext}` ? '_' : nu.pathname === `${base}-2${ext}` ? '-' : '';
  if (!sep) return [];
  const limit = Math.min(total, MAX_PAGES_PER_CHAPTER);
  const urls: string[] = [];
  for (let k = 2; k <= limit; k++) {
    urls.push(`${u.origin}${base}${sep}${k}${ext}${u.search}`);
  }
  return urls;
}

export function createLoader(site: SiteEntry): ChapterLoader {
  const pages = new Map<string, Promise<Chapter>>();
  const chapters = new Map<string, Promise<Chapter>>();

  // 失败的请求不缓存，便于重试；超过上限按 LRU 淘汰最旧条目
  function memo(map: Map<string, Promise<Chapter>>, url: string, make: () => Promise<Chapter>): Promise<Chapter> {
    let p = map.get(url);
    if (p) {
      map.delete(url);
      map.set(url, p);
      return p;
    }
    p = make();
    map.set(url, p);
    if (map.size > MAX_CACHE_SIZE) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
    p.catch(() => map.delete(url));
    return p;
  }

  function loadPage(url: string, doc?: Document): Promise<Chapter> {
    if (site.adapter) {
      const adapter = getAdapter(site.adapter);
      return memo(pages, url, () => adapter.load(url, site, doc));
    }
    return memo(pages, url, async () => extractChapter(doc ?? (await fetchDocument(url)), site, url));
  }

  function load(url: string, doc?: Document): Promise<Chapter> {
    return memo(chapters, url, async () => {
      let ch = await loadPage(url, doc);
      const mark = parsePageMark(ch.title);
      const queue = mark && mark.page === 1 && mark.total > 2 && ch.nextUrl ? pagedUrls(url, ch.nextUrl, mark.total) : [];
      let stopped = false;
      if (queue.length) {
        const workerCount = Math.min(PREFETCH_CONCURRENCY, queue.length);
        for (let i = 0; i < workerCount; i++) {
          void (async () => {
            while (!stopped && queue.length) {
              const pageUrl = queue.shift()!;
              await loadPage(pageUrl).catch(() => undefined);
            }
          })();
        }
      }
      try {
        // 只在有分页迹象时才探测下一个地址，否则打开每一章都要多等一次请求；
        // 已经合并过一页（i > 0）说明本章确实分页，继续探测到标题变化为止
        for (let i = 0; i < MAX_PAGES_PER_CHAPTER && ch.nextUrl && (i > 0 || ch.nextIsPage); i++) {
          // 预取到的若是下一章，会留在页面缓存里，后续加载直接复用
          // 探测失败不影响本章：真正翻到下一章时会重新请求并展示错误
          const next = await loadPage(ch.nextUrl).catch(() => undefined);
          if (!next || !sameChapterTitle(ch.title, next.title)) break;
          ch = {
            ...ch,
            // 合并后是整章，去掉「（1 / 3）」这类分页标记
            title: stripPageMark(ch.title) || ch.title,
            paragraphs: [...ch.paragraphs, ...next.paragraphs],
            nextUrl: next.nextUrl,
            nextIsPage: next.nextIsPage,
            tocUrl: ch.tocUrl ?? next.tocUrl,
            bookUrl: ch.bookUrl ?? next.bookUrl,
          };
        }
      } finally {
        stopped = true;
      }
      return ch;
    });
  }

  return { load };
}
