import type { SiteEntry, TocItem } from '../types';
import { cleanText, urlShape as shape } from './extract';
import { fetchDocument } from './fetcher';

/** 书页上指向完整目录的链接文字 */
const FULL_TOC_TEXT = /^[\s[【]*(查看|进入|點擊|点击)?(全部|完整|全文)?(章[节節])?目[录錄](列表)?[\s\]】]*$|^(全部|所有)章[节節]$/;
/** 目录分页的「下一页」 */
const NEXT_PAGE_TEXT = /^[\s[【<«‹]*(下一?[页頁]|next(\s*page)?)[\s\]】>»›→]*$/i;
/** 目录最多翻的页数（每页通常几百到一千章） */
const MAX_TOC_PAGES = 50;

type Filter = (url: string) => boolean;

const http = (href: string) => /^https?:/.test(href);

/**
 * 链接的真实地址。有的站点把部分章节链接写成 javascript:void(0)，
 * 真实地址放在 data-href / data-url，或 base64 编码后放在 data-enc。
 */
function anchorUrl(a: HTMLAnchorElement): string {
  if (a.getAttribute('href') && http(a.href)) return a.href;
  for (const attr of ['data-href', 'data-url']) {
    const v = a.getAttribute(attr);
    if (v) return new URL(v, a.baseURI).href;
  }
  const enc = a.getAttribute('data-enc');
  if (enc) {
    try {
      const decoded = atob(enc);
      if (http(decoded)) return decoded;
    } catch {
      // 不是 base64，按无地址处理
    }
  }
  return '';
}

/** 未指定章节过滤时，取 URL 形状相同、数量最多的一组链接作为章节 */
function resolveFilter(docs: Document[], keep?: Filter): Filter {
  if (keep) return keep;
  const counts = new Map<string, number>();
  for (const doc of docs) {
    for (const a of doc.querySelectorAll('a')) {
      const url = anchorUrl(a);
      if (url && cleanText(a.textContent)) counts.set(shape(url), (counts.get(shape(url)) ?? 0) + 1);
    }
  }
  const best = [...counts].sort((x, y) => y[1] - x[1])[0]?.[0];
  return (url) => shape(url) === best;
}

/** 章节列表容器至少要包含本页多少比例的章节链接 */
const LIST_SHARE = 0.8;
const LIST_MAX_DEPTH = 6;

/**
 * 本页的章节列表容器：包含本页八成以上章节链接的最深元素。
 * 用来排除"最新章节"区块、「开始阅读」按钮这类列表外的章节链接，它们在分页目录里会打乱顺序。
 */
function listContainer(doc: Document, chapterAnchors: HTMLAnchorElement[]): Element {
  const counts = new Map<Element, { count: number; depth: number }>();
  for (const a of chapterAnchors) {
    let el = a.parentElement;
    for (let i = 0; el && i < LIST_MAX_DEPTH; i++, el = el.parentElement) {
      const c = counts.get(el) ?? { count: 0, depth: 0 };
      c.count++;
      counts.set(el, c);
    }
  }
  for (const el of counts.keys()) {
    let depth = 0;
    for (let p = el.parentElement; p; p = p.parentElement) depth++;
    counts.get(el)!.depth = depth;
  }
  let best: Element = doc.body;
  let bestDepth = -1;
  for (const [el, c] of counts) {
    if (c.count >= chapterAnchors.length * LIST_SHARE && c.depth > bestDepth) {
      best = el;
      bestDepth = c.depth;
    }
  }
  return best;
}

/** 收集一个或多个目录页（按页序）里的章节链接 */
export function collectToc(docs: Document[], keep?: Filter): TocItem[] {
  const filter = resolveFilter(docs, keep);
  const usable = (url: string) => !!url && filter(url);
  const all = docs.flatMap((doc) => [...doc.querySelectorAll('a')]);
  // 有的站点列表里最新一章没有地址，真实地址只出现在"最新章节"区块，按同名章节补上
  const urlByTitle = new Map(
    all.flatMap((a) => {
      const title = cleanText(a.textContent);
      const url = anchorUrl(a);
      return title && usable(url) ? [[title, url] as const] : [];
    }),
  );
  const items: TocItem[] = [];
  for (const doc of docs) {
    const anchors = [...doc.querySelectorAll('a')];
    const container = listContainer(doc, anchors.filter((a) => usable(anchorUrl(a))));
    for (const a of container.querySelectorAll('a')) {
      const title = cleanText(a.textContent);
      if (!title) continue;
      const url = usable(anchorUrl(a)) ? anchorUrl(a) : urlByTitle.get(title);
      if (url) items.push({ url: url.split('#')[0], title });
    }
  }
  // 目录页顶部常有"最新章节"区块与正文列表重复，保留最后一次出现的位置（分页时跨页比较）
  const lastIndex = new Map(items.map((it, i) => [it.url, i]));
  return items.filter((it, i) => lastIndex.get(it.url) === i);
}

/** 目录的后续页：分页下拉框里的全部页，或「下一页」链接 */
function nextTocPages(doc: Document, host: string, isChapter: Filter, visited: Set<string>): string[] {
  const candidate = (url: string) => !!url && http(url) && new URL(url).host === host && !isChapter(url) && !visited.has(url.split('#')[0]);
  const options = [...doc.querySelectorAll('select option[value]')]
    .map((o) => {
      try {
        return new URL(o.getAttribute('value')!, doc.baseURI).href;
      } catch {
        return '';
      }
    })
    .filter(candidate);
  if (options.length) return options;
  const next = [...doc.querySelectorAll('a')].find((a) => NEXT_PAGE_TEXT.test(cleanText(a.textContent)) && candidate(anchorUrl(a)));
  return next ? [anchorUrl(next)] : [];
}

/** 从第一页开始翻完目录的所有分页；某页没有新章节即停止，避免误把其它"下一页"当成目录分页 */
async function loadTocPages(firstUrl: string, firstDoc: Document, keep?: Filter): Promise<TocItem[]> {
  const docs = [firstDoc];
  const isChapter = resolveFilter(docs, keep);
  const host = new URL(firstUrl).host;
  const visited = new Set([firstUrl.split('#')[0]]);
  const queue = nextTocPages(firstDoc, host, isChapter, visited);
  let count = collectToc(docs, isChapter).length;
  while (queue.length && docs.length < MAX_TOC_PAGES) {
    const url = queue.shift()!.split('#')[0];
    if (visited.has(url)) continue;
    visited.add(url);
    const doc = await fetchDocument(url);
    const total = collectToc([...docs, doc], isChapter).length;
    if (total <= count) break;
    docs.push(doc);
    count = total;
    queue.push(...nextTocPages(doc, host, isChapter, visited).filter((u) => !queue.includes(u)));
  }
  return collectToc(docs, isChapter);
}

function chapterFilter(site: SiteEntry, refChapterUrl?: string): Filter | undefined {
  if (site.chapterPattern) {
    const pattern = new RegExp(site.chapterPattern);
    return (url) => pattern.test(new URL(url).pathname);
  }
  return refChapterUrl ? (url) => shape(url) === shape(refChapterUrl) : undefined;
}

function tocApiUrl(site: SiteEntry, refUrls: string[]): string | undefined {
  if (!site.toc?.api) return undefined;
  if (!site.toc.api.includes('{bookId}')) return site.toc.api;
  const re = site.toc.bookIdPattern ? new RegExp(site.toc.bookIdPattern) : undefined;
  const bookId = re && refUrls.map((u) => u.match(re)?.[1]).find(Boolean);
  if (!bookId) throw new Error('无法从地址中提取 bookId');
  return site.toc.api.replace('{bookId}', bookId);
}

/**
 * 获取完整目录：优先使用规则里的目录接口，否则抓取目录页（含分页）中与当前章节 URL 形状一致的链接。
 */
export async function loadFullToc(site: SiteEntry, chapterUrl: string, tocUrl: string | undefined): Promise<TocItem[]> {
  const source = tocApiUrl(site, [chapterUrl]) ?? tocUrl;
  if (!source) throw new Error('当前页面没有找到目录链接，可在站点适配中指定');
  const items = await loadTocPages(source, await fetchDocument(source), chapterFilter(site, chapterUrl));
  if (!items.length) throw new Error('目录页中没有找到章节链接');
  return items;
}

/** 从书页获取完整目录：目录接口 → 书页本身的章节列表（含分页） → 书页上的「目录」链接 */
export async function loadTocFromBookPage(site: SiteEntry, bookUrl: string, bookDoc: Document): Promise<TocItem[]> {
  const filter = chapterFilter(site);
  const api = tocApiUrl(site, [bookUrl]);
  if (api) return loadTocPages(api, await fetchDocument(api), filter);
  const items = await loadTocPages(bookUrl, bookDoc, filter);
  // 书页只列了最新几章时，去完整目录页
  if (items.length >= 20) return items;
  const link = [...bookDoc.querySelectorAll('a')].find((a) => FULL_TOC_TEXT.test(cleanText(a.textContent)) && http(anchorUrl(a)));
  if (!link || anchorUrl(link).split('#')[0] === bookUrl.split('#')[0]) return items;
  const fullUrl = anchorUrl(link);
  const full = await loadTocPages(fullUrl, await fetchDocument(fullUrl), filter);
  return full.length > items.length ? full : items;
}
