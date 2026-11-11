import { GM_deleteValue, GM_getValue, GM_setValue } from '$';
import type { SiteEntry, TocItem } from '../types';
import { parseBookInfo } from './book';
import { cleanText, stripPageMark } from './extract';
import { encodeFormValue, fetchPage, type FetchedPage } from './fetcher';
import { loadTocFromBookPage } from './toc';

type Convert = (s: string) => string;

/** 搜索过于频繁（杰奇类站点限制两次搜索的间隔） */
export class RateLimitError extends Error {
  constructor() {
    super('搜索过于频繁');
    this.name = 'RateLimitError';
  }
}

const RATE_LIMIT_TEXT = /间隔时间|过于频繁|搜索太快|太频繁/;
/** 同一站点相邻两次搜索的最小间隔（杰奇类站点默认要求 5 秒） */
const SEARCH_INTERVAL = 5500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SEARCH_LINK_TEXT = /^[\s[【]*(搜索|搜書|搜书|找书|找書|站内搜索)/;
const MAX_CANDIDATES = 3;

// ---------- 归一化 ----------

/** 书名比较用：转简体，去掉空白和标点 */
export function nameKey(name: string, hans: Convert): string {
  return hans(name).replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
}

/** 书架合并、已读同步共用的书标识：简体书名 + 作者（与已有书架数据保持同一格式） */
export function bookMatchKey(name: string, author: string | undefined, hans: Convert): string {
  const norm = (s?: string) => hans(s ?? '').replace(/\s+/g, '');
  return `${norm(name)}|${norm(author)}`;
}

const CN_DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

function cnToNumber(s: string): number {
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const ch of s) {
    if (ch in CN_DIGITS) digit = CN_DIGITS[ch];
    else if (ch === '万') {
      total += (section + digit) * 10000;
      section = 0;
      digit = 0;
    } else if (ch in CN_UNITS) {
      section += (digit || 1) * CN_UNITS[ch];
      digit = 0;
    }
  }
  return total + section + digit;
}

/** 章节标题比较用：转简体、去分页标记、「第二十章」统一成「第20章」、去掉空白和标点 */
export function titleKey(title: string, hans: Convert): string {
  return hans(stripPageMark(title))
    .replace(/第([\d零〇一二两三四五六七八九十百千万]+)([章节回])/g, (_, n: string, unit: string) => `第${cnToNumber(n)}${unit}`)
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase();
}

/** 去掉「第20章」前缀后的章节名，用于两站章节序号写法不同（有的站点自己重新编号）时比较 */
function titleName(key: string): string {
  return key.replace(/^第\d+[章节回]/, '');
}

const tocKeyCache = new WeakMap<TocItem[], { hans: Convert; keys: string[] }>();

/**
 * 整本目录的 titleKey，按目录数组缓存。
 * 每个标题要做一次简繁转换和几次正则，几千章的目录不能在每次渲染时重算。
 */
export function tocTitleKeys(toc: TocItem[], hans: Convert): string[] {
  const cached = tocKeyCache.get(toc);
  if (cached?.hans === hans) return cached.keys;
  const keys = toc.map((t) => titleKey(t.title, hans));
  tocKeyCache.set(toc, { hans, keys });
  return keys;
}

export type ChapterMatch = { kind: 'title' | 'index'; url: string } | { kind: 'none' };

/** 在对方目录里找当前章节：标题相同 → 去掉序号后章节名唯一相同 → 按目录位置 */
export function matchChapter(title: string, index: number, toc: TocItem[], hans: Convert): ChapterMatch {
  const key = titleKey(title, hans);
  const keys = tocTitleKeys(toc, hans);
  const exact = keys.indexOf(key);
  if (exact >= 0) return { kind: 'title', url: toc[exact].url };
  const name = titleName(key);
  if (name.length >= 2) {
    const hits = keys.flatMap((k, i) => (titleName(k) === name ? [i] : []));
    if (hits.length === 1) return { kind: 'title', url: toc[hits[0]].url };
  }
  if (index >= 0 && index < toc.length) return { kind: 'index', url: toc[index].url };
  return { kind: 'none' };
}

// ---------- 搜索 ----------

interface SearchSpec {
  url: string;
  body?: string;
  charset: string;
  result?: string;
}

const specKey = (siteId: string) => `searchSpec:${siteId}`;

function siteHome(site: SiteEntry): string {
  return `https://${site.hosts[0]}/`;
}

/** 从页面里的搜索表单推出搜索请求；只认带文本输入框的表单 */
function specFromForm(page: FetchedPage): SearchSpec | undefined {
  for (const form of page.doc.querySelectorAll('form')) {
    const inputs = [...form.querySelectorAll<HTMLInputElement>('input[name], select[name]')];
    const keyInput = inputs.find((i) => i instanceof HTMLInputElement && /^(text|search|)$/.test(i.getAttribute('type') ?? ''));
    if (!keyInput) continue;
    const fields = inputs
      .filter((i) => i !== keyInput && !(i instanceof HTMLInputElement && /^(submit|button|image|reset)$/.test(i.type)))
      .map((i) => `${encodeURIComponent(i.name)}=${encodeURIComponent(i.value)}`);
    const query = [`${encodeURIComponent(keyInput.name)}={name}`, ...fields].join('&');
    const action = new URL(form.getAttribute('action') || page.url, page.url);
    const charset = form.getAttribute('accept-charset')?.split(/[\s,]/)[0]?.toLowerCase() || page.charset;
    if ((form.getAttribute('method') ?? 'get').toLowerCase() === 'post') return { url: action.href, body: query, charset };
    action.search = '';
    return { url: `${action.href}?${query}`, charset };
  }
  return undefined;
}

/** 自动识别站点搜索：首页的搜索表单 → 首页「搜索」链接指向的页面里的表单 */
async function detectSearch(site: SiteEntry): Promise<SearchSpec> {
  const home = await fetchPage(siteHome(site));
  const fromHome = specFromForm(home);
  if (fromHome) return fromHome;
  const link = [...home.doc.querySelectorAll('a')].find((a) => SEARCH_LINK_TEXT.test(cleanText(a.textContent)) && /^https?:/.test(a.href));
  if (link) {
    const fromPage = specFromForm(await fetchPage(link.href));
    if (fromPage) return fromPage;
  }
  throw new Error('没有识别到搜索框，可在站点规则里配置 search');
}

async function searchSpec(site: SiteEntry): Promise<SearchSpec> {
  if (site.search) {
    const charset = site.search.charset ?? (await fetchPage(siteHome(site))).charset;
    return { url: site.search.url, body: site.search.body, charset, result: site.search.result };
  }
  const cached = GM_getValue<SearchSpec | undefined>(specKey(site.id), undefined);
  if (cached) return cached;
  const spec = await detectSearch(site);
  GM_setValue(specKey(site.id), spec);
  return spec;
}

function fill(template: string, name: string, charset: string): string {
  return template.replace('{name}', encodeFormValue(name, charset));
}

/** 在线搜索页地址（GET 站点可直接打开，POST 站点退回首页），用于「去站内搜索」 */
export function searchPageUrl(site: SiteEntry, name: string): string {
  const spec = site.search ?? GM_getValue<SearchSpec | undefined>(specKey(site.id), undefined);
  if (!spec || spec.body) return siteHome(site);
  try {
    return fill(spec.url, name, (spec as SearchSpec).charset ?? 'utf-8');
  } catch {
    return siteHome(site);
  }
}

const searchQueues = new Map<string, Promise<unknown>>();

/**
 * 同一站点的搜索排队执行，相邻两次至少间隔 SEARCH_INTERVAL。
 * 换源会用简体、繁体书名各搜一次，不排队就会撞上杰奇类站点「两次搜索间隔 5 秒」的限制。
 */
function queued<T>(siteId: string, task: () => Promise<T>): Promise<T> {
  const prev = searchQueues.get(siteId) ?? Promise.resolve();
  const run = prev.then(task);
  searchQueues.set(
    siteId,
    run.then(
      () => sleep(SEARCH_INTERVAL),
      () => sleep(SEARCH_INTERVAL),
    ),
  );
  return run;
}

/** 搜索书名，返回书名完全相同的书页地址（最多 MAX_CANDIDATES 个）；被限流时等一个间隔再试一次 */
export function searchBooks(site: SiteEntry, name: string, hans: Convert): Promise<string[]> {
  return queued(site.id, async () => {
    try {
      return await searchOnce(site, name, hans);
    } catch (e) {
      if (!(e instanceof RateLimitError)) throw e;
      await sleep(SEARCH_INTERVAL);
      return searchOnce(site, name, hans);
    }
  });
}

async function searchOnce(site: SiteEntry, name: string, hans: Convert): Promise<string[]> {
  const spec = await searchSpec(site);
  const url = fill(spec.url, name, spec.charset);
  let page: FetchedPage;
  try {
    page = await fetchPage(url, spec.body ? { method: 'POST', body: fill(spec.body, name, spec.charset) } : {});
  } catch (e) {
    // 自动识别的搜索地址失效时下次重新识别
    if (!site.search) GM_deleteValue(specKey(site.id));
    throw e;
  }
  const target = nameKey(name, hans);
  const scope = spec.result ? [...page.doc.querySelectorAll(spec.result)] : [page.doc.body];
  const anchors = scope.flatMap((el) => (el instanceof HTMLAnchorElement ? [el] : [...el.querySelectorAll('a')]));
  const hits = [
    ...new Set(
      anchors
        .filter((a) => /^https?:/.test(a.href) && nameKey(cleanText(a.textContent), hans) === target)
        .map((a) => a.href.split('#')[0]),
    ),
  ];
  if (hits.length) return hits.slice(0, MAX_CANDIDATES);
  // 只有一个结果时很多站点直接重定向到书页
  const searchPath = new URL(url).pathname;
  if (new URL(page.url).pathname !== searchPath) return [page.url.split('#')[0]];
  if (RATE_LIMIT_TEXT.test(page.doc.body?.textContent ?? '')) throw new RateLimitError();
  return [];
}

export interface BookSource {
  bookUrl: string;
  name: string;
  author?: string;
  toc: TocItem[];
}

/** 读取对方书页：书名、作者、完整目录 */
export async function inspectBook(site: SiteEntry, bookUrl: string): Promise<BookSource> {
  const page = await fetchPage(bookUrl);
  const info = parseBookInfo(page.doc, site);
  const toc = await loadTocFromBookPage(site, page.url, page.doc);
  return { bookUrl: page.url.split('#')[0], name: info.name, author: info.author, toc };
}
