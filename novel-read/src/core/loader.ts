import type { Chapter, SiteEntry } from '../types';
import { extractChapter, sameChapterTitle, stripPageMark } from './extract';
import { fetchDocument } from './fetcher';
import { getAdapter } from '../sites/adapters';

const MAX_PAGES_PER_CHAPTER = 30;

export interface ChapterLoader {
  /** 加载一整章：同标题的分页（"下一页"）会合并进来 */
  load(url: string, doc?: Document): Promise<Chapter>;
}

export function createLoader(site: SiteEntry): ChapterLoader {
  const pages = new Map<string, Promise<Chapter>>();
  const chapters = new Map<string, Promise<Chapter>>();

  // 失败的请求不缓存，便于重试
  function memo(map: Map<string, Promise<Chapter>>, url: string, make: () => Promise<Chapter>): Promise<Chapter> {
    let p = map.get(url);
    if (!p) {
      p = make();
      map.set(url, p);
      p.catch(() => map.delete(url));
    }
    return p;
  }

  function loadPage(url: string, doc?: Document): Promise<Chapter> {
    if (site.adapter) {
      const adapter = getAdapter(site.adapter);
      return memo(pages, url, () => adapter.load(url, site));
    }
    return memo(pages, url, async () => extractChapter(doc ?? (await fetchDocument(url)), site, url));
  }

  function load(url: string, doc?: Document): Promise<Chapter> {
    return memo(chapters, url, async () => {
      let ch = await loadPage(url, doc);
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
      return ch;
    });
  }

  return { load };
}
