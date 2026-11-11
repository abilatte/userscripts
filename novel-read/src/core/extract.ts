import type { Chapter, LinkLocator, SiteEntry } from '../types';

const NEXT_TEXT = /^[\s[【<«‹]*(下一[章页頁节節回]|下[章页頁])[\s\]】>»›→]*$/;
const PREV_TEXT = /^[\s[【<«‹←]*(上一[章页頁节節回]|上[章页頁])[\s\]】>»›]*$/;
const BOOK_TEXT = /^[\s[【]*(返回)?(书页|書頁|书籍详情|書籍詳情|小说详情|小說詳情|详情|詳情|简介|簡介)[\s\]】]*$/;
const TOC_TEXT = /^[\s[【]*(返回)?(章[节節])?目[录錄](列表)?[\s\]】]*$/;

/** 所有站点通用的段落过滤（广告、水印、章节尾标），命中则整段删除 */
export const COMMON_FILTERS: { pattern: string; desc: string }[] = [
  { pattern: '^[（(]?本章完[)）]?$', desc: '章节结尾的「(本章完)」' },
  { pattern: '全[网網]首[发發]', desc: '「全网首发」水印' },
  { pattern: '首[发發]域名', desc: '「首发域名」推广' },
  { pattern: '最新章[节節].*(请|請)?(访问|訪問|阅读|閱讀)', desc: '「最新章节请访问…」' },
  { pattern: '(手机|手機)(版|用户|用戶).*(阅读|閱讀|访问|訪問)', desc: '「手机版阅读…」' },
  { pattern: '(请|請)(记住|記住|收藏)本(书|書|站)', desc: '「请记住本书/本站…」' },
  { pattern: '天才一秒(记住|記住)', desc: '「天才一秒记住…」' },
  { pattern: '(记住|記住|认准|認準).{0,12}(域名|网址|網址)', desc: '「记住本站域名 / 网址」' },
];

const MIN_CONTENT_LENGTH = 100;

export interface DetectResult {
  content: Element;
  next?: HTMLAnchorElement;
}

function cleanText(s: string | null | undefined): string {
  return (s ?? '').replace(/[\s　 ]+/g, ' ').trim();
}

/** 自动识别正文块：直接文本（文本节点 + 子 p）最多的元素 */
export function detectContent(doc: Document): Element | undefined {
  let best: Element | undefined;
  let bestScore = 0;
  for (const el of doc.body.querySelectorAll('div, article, section, td, main')) {
    let score = 0;
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) score += cleanText(node.textContent).length;
      else if (node instanceof Element && node.tagName === 'P') score += cleanText(node.textContent).length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return bestScore >= MIN_CONTENT_LENGTH ? best : undefined;
}

function isUsableHref(a: HTMLAnchorElement): boolean {
  const raw = a.getAttribute('href');
  return !!raw && !raw.startsWith('javascript:') && !raw.startsWith('#');
}

export function findLink(doc: Document, locator: LinkLocator | undefined, fallback: RegExp): HTMLAnchorElement | undefined {
  const scopes = locator?.selector ? [...doc.querySelectorAll(locator.selector)] : [doc.body];
  const anchors = scopes.flatMap((s) => (s instanceof HTMLAnchorElement ? [s] : [...s.querySelectorAll('a')]));
  const match = (a: HTMLAnchorElement) =>
    locator?.text ? cleanText(a.textContent) === locator.text : fallback.test(cleanText(a.textContent));
  return anchors.find((a) => isUsableHref(a) && match(a));
}

export function findContent(doc: Document, site: SiteEntry): Element | undefined {
  if (!site.content) return detectContent(doc);
  const el = doc.querySelector(site.content);
  return el && cleanText(el.textContent).length >= MIN_CONTENT_LENGTH ? el : undefined;
}

export function detectPage(doc: Document, site: SiteEntry, url: string): DetectResult | undefined {
  if (site.chapterPattern && !new RegExp(site.chapterPattern).test(new URL(url).pathname)) return undefined;
  // 适配器站点的正文由脚本异步渲染，只按 URL 判断章节页
  if (site.adapter) {
    if (!site.chapterPattern) throw new Error(`${site.name}：使用 adapter 时必须配置 chapterPattern`);
    return { content: doc.body };
  }
  const content = findContent(doc, site);
  if (!content) return undefined;
  const next = findLink(doc, site.next, NEXT_TEXT);
  // 已适配站点只要正文在即可；自动识别还要求有下一章链接，避免在非章节页误显示
  if (!site.content && !next) return undefined;
  return { content, next };
}

/** URL 形状：数字替换为 #，并忽略分页后缀，用于判断下一章链接是否仍是章节页 */
function urlShape(url: string): string {
  const u = new URL(url);
  return u.host + u.pathname.replace(/\d+/g, '#').replace(/[_-]#/g, '');
}

export function isChapterUrl(site: SiteEntry, url: string, currentUrl: string): boolean {
  if (site.chapterPattern) return new RegExp(site.chapterPattern).test(new URL(url).pathname);
  return urlShape(url) === urlShape(currentUrl);
}

/** 标题文字；「书名 > 章节名」这类面包屑去掉链接部分，只留章节名 */
function titleText(el: Element | null): string {
  if (!el) return '';
  const full = cleanText(el.textContent);
  if (!el.querySelector('a')) return full;
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('a').forEach((a) => a.remove());
  const rest = cleanText(clone.textContent).replace(/^[\s>›»/|－—-]+/, '');
  return rest || full;
}

function extractTitle(doc: Document, site: SiteEntry, content: Element): string {
  const fromRule = site.title ? titleText(doc.querySelector(site.title)) : '';
  if (fromRule) return fromRule;
  const h1 = titleText(doc.querySelector('h1'));
  if (h1) return h1;
  const inContent = cleanText(content.querySelector('h1, h2, h3')?.textContent);
  if (inContent) return inContent;
  return cleanText(doc.title.split(/[-_|－—]/)[0]);
}

function compileFilters(site: SiteEntry): RegExp[] {
  return [...COMMON_FILTERS.map((c) => c.pattern), ...(site.filters ?? [])].map((f) => {
    try {
      return new RegExp(f, 'i');
    } catch {
      throw new Error(`段落过滤正则无效：${f}`);
    }
  });
}

/**
 * 形近字母：广告用亚美尼亚、西里尔、希腊、国际音标里长得像拉丁字母的字符拼域名（էաҟąղ.çօʍ），
 * 这些字符没有 Unicode 兼容分解，只能按字形手动对照。只收录形状明显像拉丁字母的。
 */
const LOOKALIKES: Record<string, string> = {
  a: 'аɑα',
  b: 'ЬьƅɓВв',
  c: 'сϲςƈ',
  d: 'ԁժɗ',
  e: 'еєεҽɛ',
  g: 'ցɡǥ',
  h: 'һհɦ',
  i: 'іɩι',
  j: 'јʝ',
  k: 'кκҟҝҡƙ',
  l: 'ӏɭ',
  m: 'мʍɱ',
  n: 'ղոռηпɲŋ',
  o: 'оօοσөɵ',
  p: 'рρþƥ',
  q: 'ԛզ',
  r: 'гɾʀ',
  s: 'ѕʂ',
  t: 'тτէƫʈ',
  u: 'սυμц',
  v: 'νѵʋ',
  w: 'աѡԝωɯ',
  x: 'хχ',
  y: 'уүγʏ',
  z: 'ʐƶ',
};
const LOOKALIKE_MAP = new Map(Object.entries(LOOKALIKES).flatMap(([ascii, chars]) => [...chars].map((c) => [c, ascii])));
const LOOKALIKE_RE = new RegExp(`[${[...LOOKALIKE_MAP.keys()].join('')}]`, 'gu');

/**
 * 把广告常用的变形字母还原为 ASCII，让 "twkan" 这类过滤规则覆盖所有变体：
 * 花体（𝕥𝕨𝕜𝕒𝕟）、负方框（🆃🆆🅺🅰🅽）、圆圈（ⓣⓦⓚⓐⓝ）、叠加符号（t̴w̴k̴a̴n̴）、形近字母（էաҟąղ）。
 * 只用于匹配，不影响显示。
 */
export function foldFancyLetters(s: string): string {
  return (
    s
      // 负方框/负圆圈字母没有兼容分解，需手动映射
      .replace(/[\u{1F150}-\u{1F169}\u{1F170}-\u{1F189}]/gu, (ch) => {
        const cp = ch.codePointAt(0)!;
        return String.fromCharCode(65 + (cp >= 0x1f170 ? cp - 0x1f170 : cp - 0x1f150));
      })
      .replace(LOOKALIKE_RE, (ch) => LOOKALIKE_MAP.get(ch)!)
      .normalize('NFKD')
      // 去掉叠加在字母上的组合符号（删除线、下划线、变音符；ą、ç 也在这一步还原）
      .replace(/\p{M}/gu, '')
  );
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE']);

export function extractParagraphs(content: Element, site: SiteEntry, title: string): string[] {
  const root = content.cloneNode(true) as Element;
  for (const sel of ['script', 'style', 'noscript', 'iframe', 'ins', ...(site.remove ?? [])]) {
    root.querySelectorAll(sel).forEach((n) => n.remove());
  }
  const doc = root.ownerDocument;
  root.querySelectorAll('br').forEach((br) => br.replaceWith(doc.createTextNode('\n')));
  root.querySelectorAll('*').forEach((el) => {
    if (BLOCK_TAGS.has(el.tagName)) el.append(doc.createTextNode('\n'));
  });
  const filters = compileFilters(site);
  const lines = (root.textContent ?? '')
    .split('\n')
    .map(cleanText)
    .filter((line) => {
      if (!line) return false;
      const folded = foldFancyLetters(line);
      return !filters.some((f) => f.test(line) || f.test(folded));
    });
  // 去掉正文开头重复的章节标题
  const norm = (s: string) => s.replace(/\s+/g, '');
  if (lines.length && norm(lines[0]) === norm(title)) lines.shift();
  return lines;
}

const PAGE_LINK_TEXT = /下一?[页頁]/;

/** 去掉地址末尾的分页后缀：/216/209710_2.html → /216/209710.html，并忽略查询参数 */
function pageGroup(url: string): string {
  const u = new URL(url);
  return u.origin + u.pathname.replace(/[_-]\d+(?=(\.\w+)?\/?$)/, '');
}

/**
 * 「下一章」链接是否可能指向本章的下一页。只有出现分页迹象才值得先把下一个地址请求回来比较标题：
 * 标题带「（1 / 3）」这类分页标记、链接文字是「下一页」、或两个地址只差分页后缀/查询参数。
 * 没有任何迹象的站点直接当作下一章，打开章节时不必多等一次请求。
 */
export function looksPaged(title: string, nextText: string, url: string, nextUrl: string): boolean {
  if (stripPageMark(title) !== title || PAGE_LINK_TEXT.test(nextText)) return true;
  const strip = (u: string) => u.split(/[?#]/)[0];
  return strip(url) === strip(nextUrl) || pageGroup(url) === strip(nextUrl) || pageGroup(nextUrl) === strip(url);
}

export function extractChapter(doc: Document, site: SiteEntry, url: string): Chapter {
  const content = findContent(doc, site);
  if (!content) throw new Error(site.content ? `找不到正文（选择器 ${site.content}）` : '自动识别不到正文');
  const title = extractTitle(doc, site, content);
  const paragraphs = extractParagraphs(content, site, title);
  if (!paragraphs.length) throw new Error('正文清洗后为空');
  const next = findLink(doc, site.next, NEXT_TEXT);
  const prev = findLink(doc, site.prev, PREV_TEXT);
  const toc = findLink(doc, site.tocLink, TOC_TEXT);
  const book = findLink(doc, site.bookLink, BOOK_TEXT);
  const chapterOrNone = (a?: HTMLAnchorElement) =>
    a && a.href !== url && isChapterUrl(site, a.href, url) ? a.href : undefined;
  const nextUrl = chapterOrNone(next);
  return {
    url,
    title,
    paragraphs,
    nextUrl,
    nextIsPage: !!nextUrl && looksPaged(title, cleanText(next?.textContent), url, nextUrl),
    prevUrl: chapterOrNone(prev),
    tocUrl: toc?.href,
    bookUrl: book?.href,
  };
}

/** 去掉分页标记后比较，用于把"同一章的第 2 页"合并到上一页 */
export function sameChapterTitle(a: string, b: string): boolean {
  const norm = (s: string) => stripPageMark(s).replace(/\s+/g, '');
  return norm(a) === norm(b);
}

/** 去掉标题里的分页标记：「（1 / 3）」「(第2页)」「第2页」 */
export function stripPageMark(title: string): string {
  return title.replace(/[（(]\s*\d+\s*\/\s*\d+\s*[)）]|[（(]?第?\s*\d+\s*[页頁][)）]?/g, '').trim();
}

export { NEXT_TEXT, PREV_TEXT, TOC_TEXT, cleanText, urlShape };
