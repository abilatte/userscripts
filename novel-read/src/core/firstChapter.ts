import { BOOK_SEARCH } from '../sites/builtin';
import { hostMatches } from '../storage';
import type { SiteEntry } from '../types';
import { cleanText } from './extract';
import { fetchPage } from './fetcher';
import { collectToc, loadTocFromBookPage } from './toc';

const START_READING = /^(开始阅读|開始閱讀)$/;

/** 优先使用站点的「开始阅读」，不把书页的最新章节误当成首章。 */
export async function loadFirstChapter(site: SiteEntry, bookUrl: string): Promise<string> {
  const rule = BOOK_SEARCH[site.id];
  const onSite = (u: URL) => /^https?:$/.test(u.protocol) && site.hosts.some((host) => hostMatches(u.hostname, host));
  const book = new URL(bookUrl);
  if (!onSite(book)) throw new Error('不是本站可识别的书页');
  const chapterPattern = site.chapterPattern && new RegExp(site.chapterPattern);

  if (rule) {
    const id = rule.bookPath.exec(book.pathname)?.[1];
    if (!id) throw new Error('不是本站可识别的书页');
    const chapterRoot = `${rule.chapterRoot}${id}/`;
    const isChapter = (href: string) => {
      const u = new URL(href);
      return (
        onSite(u) &&
        u.pathname.startsWith(chapterRoot) &&
        /^\d+(?:\.html)?$/.test(u.pathname.slice(chapterRoot.length)) &&
        (!chapterPattern || chapterPattern.test(u.pathname))
      );
    };
    const page = await fetchPage(bookUrl);
    const current = new URL(page.url);
    if (!onSite(current) || rule.bookPath.exec(current.pathname)?.[1] !== id) throw new Error('书页跳转到了意外的地址');

    for (const a of page.doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      if (!START_READING.test(cleanText(a.textContent).replace(/\s/g, ''))) continue;
      const url = new URL(a.href, page.url);
      if (isChapter(url.href)) return url.href;
      // 台湾小说网的「开始阅读」指向正序目录，首章已经在目录首屏，无需获取完整目录。
      if (onSite(url) && url.pathname === rule.startDirectory?.replace('{id}', id)) {
        const directory = await fetchPage(url.href);
        const final = new URL(directory.url);
        if (onSite(final) && final.pathname === url.pathname) {
          const first = collectToc([directory.doc], isChapter)[0];
          if (first) return first.url;
        }
      }
    }
    throw new Error('未找到第一章，请点书名到书页查看');
  }

  // 自定义站点支持：先匹配「开始阅读」，否则从书页目录取首章
  const customBookPath = site.search?.bookPath ? new RegExp(site.search.bookPath) : undefined;
  const bookId = customBookPath?.exec(book.pathname)?.[1];
  const chapterRoot = site.search?.chapterRoot && bookId ? `${site.search.chapterRoot}${bookId}/` : undefined;
  const isCustomChapter = (href: string) => {
    const u = new URL(href);
    if (!onSite(u)) return false;
    if (chapterPattern) return chapterPattern.test(u.pathname);
    if (chapterRoot) return u.pathname.startsWith(chapterRoot);
    return u.href.split('#')[0] !== book.href.split('#')[0];
  };
  const page = await fetchPage(bookUrl);
  for (const a of page.doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (!START_READING.test(cleanText(a.textContent).replace(/\s/g, ''))) continue;
    const url = new URL(a.href, page.url);
    if (isCustomChapter(url.href)) return url.href;
  }
  const toc = await loadTocFromBookPage(site, page.url, page.doc);
  if (toc[0]) return toc[0].url;
  throw new Error('未找到第一章，请点书名到书页查看');
}
