/** 按链接文字（可选限定选择器范围）定位一个链接 */
export interface LinkLocator {
  /** 在该选择器匹配到的元素内（或其自身为 a）查找；为空则全文查找 */
  selector?: string;
  /** 链接文字完全匹配（去首尾空白后） */
  text?: string;
}

export interface TocConfig {
  /** 完整目录接口，支持 {bookId} 占位，例如 https://twkan.com/ajax_novels/chapterlist/{bookId}.html */
  api?: string;
  /** 从章节 URL 提取 bookId 的正则，第一个捕获组为 bookId */
  bookIdPattern?: string;
}

export interface SearchConfig {
  /** 搜索地址，{name} 为书名占位，例如 https://x.com/search.php?searchkey={name} */
  url: string;
  /** 有值时用 POST 提交该表单体，同样支持 {name} */
  body?: string;
  /** 搜索词编码，默认按搜索页编码（GBK 站点必须用 gbk） */
  charset?: string;
  /** 结果列表里书页链接的选择器；为空时取文字与书名相同的链接 */
  result?: string;
}

/** 站点条目：白名单 + 适配规则 */
export interface SiteEntry {
  id: string;
  name: string;
  /** 域名，匹配自身及其子域名 */
  hosts: string[];
  enabled: boolean;
  builtin?: boolean;
  /** 章节页 URL（pathname）正则；为空则按内容识别判断 */
  chapterPattern?: string;
  /** 正文选择器；为空表示未适配，走自动识别 */
  content?: string;
  title?: string;
  next?: LinkLocator;
  prev?: LinkLocator;
  /** 章节页上的目录页链接 */
  tocLink?: LinkLocator;
  /** 章节页上的书页（详情页）链接，用于获取书名；为空时按「书页/详情」等文字识别 */
  bookLink?: LinkLocator;
  /** 书页上书名、作者的选择器；为空时取 og:novel 元信息或 h1 */
  book?: { name?: string; author?: string };
  /** 换源时的站内搜索；为空则自动识别站点的搜索表单 */
  search?: SearchConfig;
  toc?: TocConfig;
  /** 正文内需要移除的元素 */
  remove?: string[];
  /** 段落过滤正则（命中则整段删除），在通用过滤之外追加 */
  filters?: string[];
  /** 划选加入的过滤文字：只删除这段文字本身，删完为空的段落整段去掉 */
  strip?: string[];
  /** 第一章是否重新请求原始 HTML（站点在前端改写了正文时使用） */
  freshFirst?: boolean;
  /** 内置代码适配器 id：正文需要接口/解密等规则无法表达的站点，由适配器负责加载章节 */
  adapter?: string;
}

export interface Chapter {
  url: string;
  title: string;
  paragraphs: string[];
  nextUrl?: string;
  /** nextUrl 可能是本章的下一页（分页站点），加载时需要探测并合并 */
  nextIsPage?: boolean;
  prevUrl?: string;
  tocUrl?: string;
  bookUrl?: string;
}

export interface BookInfo {
  name: string;
  author?: string;
  bookUrl?: string;
}

/** 书架上一本书在某个站点的来源 */
export interface ShelfSource {
  siteId: string;
  host: string;
  bookKey: string;
  bookUrl?: string;
  /** 上次读到的章节 */
  lastUrl: string;
  lastTitle: string;
  updated: number;
}

export interface ShelfBook {
  id: string;
  name: string;
  author?: string;
  /** 书名 + 作者转成简体后的匹配键，同一本书在不同站点（含繁体站）合并到一起 */
  matchKey: string;
  sources: ShelfSource[];
  added: number;
}

export interface Excerpt {
  id: string;
  text: string;
  book: string;
  bookKey: string;
  chapter: string;
  url: string;
  time: number;
}

export interface TocItem {
  url: string;
  title: string;
}

export type ThemeId = 'gray' | 'white' | 'parchment' | 'green' | 'blue' | 'dark';
export type FontId = 'hei' | 'song' | 'kai';
export type PageMode = 'scroll' | 'chapter';
export type ScriptMode = 'raw' | 'hans' | 'hant';

export interface Settings {
  theme: ThemeId;
  font: FontId;
  fontSize: number;
  /** 0 表示自动 */
  width: number;
  lineHeight: number;
  paragraphSpacing: number;
  pageMode: PageMode;
  script: ScriptMode;
}
