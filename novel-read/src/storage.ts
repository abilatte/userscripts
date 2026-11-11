import { GM_deleteValue, GM_getValue, GM_setValue } from '$';
import { ADAPTERS } from './sites/adapters';
import { BUILTIN_SITES } from './sites/builtin';
import type { BookInfo, Excerpt, Settings, ShelfBook, ShelfSource, SiteEntry } from './types';

const SETTINGS_KEY = 'settings';
const SITES_KEY = 'sites';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'parchment',
  font: 'hei',
  fontSize: 22,
  width: 640,
  lineHeight: 1.8,
  paragraphSpacing: 1,
  pageMode: 'scroll',
  script: 'hans',
};

export function loadSettings(): Settings {
  const saved = GM_getValue<Partial<Settings>>(SETTINGS_KEY, {});
  return { ...DEFAULT_SETTINGS, ...saved };
}

/**
 * 只把改动的项合并进存储里的设置：多个标签页同时打开时，
 * 不会用本页内存里的旧值覆盖其它标签页改过的项。
 */
export function patchSettings(patch: Partial<Settings>): Settings {
  GM_setValue(SETTINGS_KEY, { ...GM_getValue<Partial<Settings>>(SETTINGS_KEY, {}), ...patch });
  return loadSettings();
}

/**
 * 内置站点的用户改动：只记录与默认值不同的字段，null 表示删掉该字段。
 * 这样脚本更新内置规则时，用户没动过的字段会跟着更新。
 */
interface BuiltinPatch {
  id: string;
  patch: Record<string, unknown>;
}

type StoredSite = SiteEntry | BuiltinPatch;

const isPatch = (s: StoredSite): s is BuiltinPatch => 'patch' in s;

function diffFromBuiltin(def: SiteEntry, site: SiteEntry): Record<string, unknown> {
  const a = def as unknown as Record<string, unknown>;
  const b = site as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === 'id' || key === 'builtin') continue;
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) patch[key] = b[key] ?? null;
  }
  return patch;
}

function applyBuiltinPatch(def: SiteEntry, patch: Record<string, unknown>): SiteEntry {
  const out = { ...def } as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out as unknown as SiteEntry;
}

/**
 * 存储里保存：用户添加的站点（完整规则）+ 内置站点被改动的字段。
 * 旧版本把改过的内置站点整条存下来，读取时按完整规则使用，下次保存时转成只存改动字段。
 */
export function loadSites(): SiteEntry[] {
  const stored = GM_getValue<StoredSite[]>(SITES_KEY, []);
  const byId = new Map(stored.map((s) => [s.id, s]));
  const builtins = BUILTIN_SITES.map((b) => {
    const override = byId.get(b.id);
    if (!override) return b;
    return isPatch(override) ? applyBuiltinPatch(b, override.patch) : { ...override, builtin: true };
  });
  const builtinIds = new Set(BUILTIN_SITES.map((b) => b.id));
  const custom = stored.filter((s): s is SiteEntry => !isPatch(s) && !builtinIds.has(s.id));
  return [...builtins, ...custom];
}

export function saveSites(sites: SiteEntry[]): void {
  const toStore: StoredSite[] = [];
  for (const s of sites) {
    const def = BUILTIN_SITES.find((b) => b.id === s.id);
    if (!def) {
      toStore.push(s);
      continue;
    }
    const patch = diffFromBuiltin(def, s);
    if (Object.keys(patch).length) toStore.push({ id: s.id, patch });
  }
  GM_setValue(SITES_KEY, toStore);
}

/** 需要备份的站点（完整规则）：用户添加的站点 + 改过的内置站点 */
export function loadCustomizedSites(): SiteEntry[] {
  return loadSites().filter((s) => {
    const def = BUILTIN_SITES.find((b) => b.id === s.id);
    return !def || Object.keys(diffFromBuiltin(def, s)).length > 0;
  });
}

/** 导入站点规则：同 id 的以导入的为准，其余保留 */
export function importSites(incoming: SiteEntry[]): SiteEntry[] {
  const merged = loadSites();
  for (const entry of incoming) {
    const idx = merged.findIndex((s) => s.id === entry.id);
    if (idx >= 0) merged[idx] = { ...entry, builtin: merged[idx].builtin };
    else merged.push({ ...entry, builtin: undefined });
  }
  saveSites(merged);
  return loadSites();
}

export function upsertSite(entry: SiteEntry): SiteEntry[] {
  const sites = loadSites();
  const idx = sites.findIndex((s) => s.id === entry.id);
  if (idx >= 0) sites[idx] = entry;
  else sites.push(entry);
  saveSites(sites);
  return sites;
}

export function removeSite(id: string): SiteEntry[] {
  const sites = loadSites().filter((s) => s.builtin || s.id !== id);
  saveSites(sites);
  return sites;
}

export function resetBuiltinSite(id: string): SiteEntry[] {
  const def = BUILTIN_SITES.find((b) => b.id === id);
  if (!def) throw new Error(`不是内置站点：${id}`);
  const sites = loadSites().map((s) => (s.id === id ? def : s));
  saveSites(sites);
  return sites;
}

/** 输入网址或域名，统一成去掉 www./m. 前缀的主机名 */
export function normalizeHost(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error('请输入网址或域名');
  let host: string;
  try {
    host = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    throw new Error(`无法识别的网址：${raw}`);
  }
  host = host.toLowerCase().replace(/^(www|m|wap)\./, '');
  if (!host.includes('.')) throw new Error(`无法识别的域名：${raw}`);
  return host;
}

export function hostMatches(hostname: string, host: string): boolean {
  const h = hostname.toLowerCase();
  return h === host || h.endsWith(`.${host}`);
}

export function findSite(sites: SiteEntry[], hostname: string): SiteEntry | undefined {
  return sites.find((s) => s.hosts.some((h) => hostMatches(hostname, h)));
}

export function createSite(input: string): SiteEntry {
  const host = normalizeHost(input);
  const sites = loadSites();
  const existing = findSite(sites, host);
  if (existing) throw new Error(`${host} 已在站点列表中（${existing.name}）`);
  const entry: SiteEntry = { id: `site-${host}`, name: host, hosts: [host], enabled: true };
  upsertSite(entry);
  return entry;
}

/** 校验导入/编辑的站点 JSON 结构 */
export function validateSite(raw: unknown): SiteEntry {
  if (!raw || typeof raw !== 'object') throw new Error('站点规则必须是对象');
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== 'string' || !s.id) throw new Error('缺少 id');
  if (typeof s.name !== 'string' || !s.name) throw new Error(`${s.id}：缺少 name`);
  if (!Array.isArray(s.hosts) || !s.hosts.length || !s.hosts.every((h) => typeof h === 'string' && h)) {
    throw new Error(`${s.id}：hosts 必须是非空字符串数组`);
  }
  if (typeof s.enabled !== 'boolean') throw new Error(`${s.id}：enabled 必须是布尔值`);
  const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  for (const key of ['chapterPattern', 'content', 'title']) {
    if (s[key] !== undefined && typeof s[key] !== 'string') throw new Error(`${s.id}：${key} 必须是字符串`);
  }
  for (const key of ['filters', 'strip', 'remove']) {
    const list = s[key];
    if (list !== undefined && !(Array.isArray(list) && list.every((x) => typeof x === 'string' && x))) {
      throw new Error(`${s.id}：${key} 必须是非空字符串组成的数组`);
    }
  }
  const locators = ['next', 'prev', 'tocLink', 'bookLink'] as const;
  for (const key of locators) {
    const loc = s[key];
    if (loc === undefined) continue;
    if (!isObject(loc)) throw new Error(`${s.id}：${key} 必须是对象`);
    for (const field of ['selector', 'text']) {
      if (loc[field] !== undefined && typeof loc[field] !== 'string') throw new Error(`${s.id}：${key}.${field} 必须是字符串`);
    }
  }
  if (s.toc !== undefined) {
    if (!isObject(s.toc)) throw new Error(`${s.id}：toc 必须是对象`);
    for (const field of ['api', 'bookIdPattern']) {
      if (s.toc[field] !== undefined && typeof s.toc[field] !== 'string') throw new Error(`${s.id}：toc.${field} 必须是字符串`);
    }
  }
  const patterns = [s.chapterPattern, (s.toc as Record<string, unknown> | undefined)?.bookIdPattern, ...((s.filters as unknown[]) ?? [])];
  for (const p of patterns) {
    if (p === undefined) continue;
    try {
      new RegExp(p as string);
    } catch {
      throw new Error(`${s.id}：正则不合法：${String(p)}`);
    }
  }
  if (s.adapter !== undefined && !(typeof s.adapter === 'string' && s.adapter in ADAPTERS)) {
    throw new Error(`${s.id}：未知的 adapter：${String(s.adapter)}`);
  }
  if (s.book !== undefined && (!s.book || typeof s.book !== 'object')) throw new Error(`${s.id}：book 必须是对象`);
  if (s.search !== undefined) {
    const search = s.search as Record<string, unknown> | null;
    if (!search || typeof search.url !== 'string') throw new Error(`${s.id}：search.url 必须是字符串`);
    const template = typeof search.body === 'string' ? search.body : search.url;
    if (!template.includes('{name}')) throw new Error(`${s.id}：search 需要用 {name} 标出书名的位置`);
  }
  const book = (s.book ?? {}) as Record<string, unknown>;
  const selectors: [string, unknown][] = [
    ['content', s.content],
    ['title', s.title],
    ['book.name', book.name],
    ['book.author', book.author],
    ['search.result', (s.search as Record<string, unknown> | undefined)?.result],
    ...locators.map((key): [string, unknown] => [`${key}.selector`, (s[key] as Record<string, unknown> | undefined)?.selector]),
    ...((s.remove as string[] | undefined) ?? []).map((sel, i): [string, unknown] => [`remove[${i}]`, sel]),
  ];
  for (const [key, sel] of selectors) {
    if (sel === undefined) continue;
    if (typeof sel !== 'string') throw new Error(`${s.id}：${key} 必须是字符串`);
    try {
      document.createDocumentFragment().querySelector(sel);
    } catch {
      throw new Error(`${s.id}：${key} 不是合法 CSS 选择器`);
    }
  }
  return s as unknown as SiteEntry;
}

/** 一本书的标识：章节 URL 去掉最后一段（/txt/81780/、/books/996/ 这类目录） */
export function bookKeyOf(url: string): string {
  const u = new URL(url);
  return u.origin + u.pathname.replace(/[^/]*$/, '');
}

const readKey = (bookKey: string) => `read:${bookKey}`;

export function loadReadChapters(bookKey: string): string[] {
  return GM_getValue<string[]>(readKey(bookKey), []);
}

export function markChaptersRead(bookKey: string, urls: string[]): string[] {
  const read = loadReadChapters(bookKey);
  const added = urls.filter((u) => !read.includes(u));
  if (!added.length) return read;
  const next = [...read, ...added];
  GM_setValue(readKey(bookKey), next);
  return next;
}

const EXCERPTS_KEY = 'excerpts';

export function loadExcerpts(): Excerpt[] {
  return GM_getValue<Excerpt[]>(EXCERPTS_KEY, []);
}

export function saveExcerpts(list: Excerpt[]): void {
  GM_setValue(EXCERPTS_KEY, list);
}

/** 修改站点规则里的过滤列表；站点必须已在列表中 */
function updateSiteList(siteId: string, key: 'strip' | 'filters', change: (list: string[]) => string[]): SiteEntry {
  const site = loadSites().find((s) => s.id === siteId);
  if (!site) throw new Error('本站还不在阅读站点列表中，请先在设置 → 站点里添加');
  const list = change(site[key] ?? []);
  const updated = { ...site, [key]: list.length ? list : undefined };
  upsertSite(updated);
  return updated;
}

/** 划选过滤文字：只删除这段文字本身 */
export function updateSiteStrip(siteId: string, change: (strip: string[]) => string[]): SiteEntry {
  return updateSiteList(siteId, 'strip', change);
}

/** 段落过滤正则：命中则整段删除 */
export function updateSiteFilters(siteId: string, change: (filters: string[]) => string[]): SiteEntry {
  return updateSiteList(siteId, 'filters', change);
}

const bookInfoKey = (bookKey: string) => `bookInfo:${bookKey}`;

export function loadBookInfo(bookKey: string): BookInfo | undefined {
  return GM_getValue<BookInfo | undefined>(bookInfoKey(bookKey), undefined);
}

export function saveBookInfo(bookKey: string, info: BookInfo): void {
  GM_setValue(bookInfoKey(bookKey), info);
}

const SHELF_KEY = 'shelf';

export function loadShelf(): ShelfBook[] {
  return GM_getValue<ShelfBook[]>(SHELF_KEY, []);
}

export function saveShelf(shelf: ShelfBook[]): void {
  GM_setValue(SHELF_KEY, shelf);
}

/** 加入书架：同 matchKey 的书合并为一个条目，同站点来源只保留一份 */
export function addToShelf(book: Omit<ShelfBook, 'id' | 'sources' | 'added'>, source: ShelfSource): ShelfBook[] {
  const shelf = loadShelf();
  const existing = shelf.find((b) => b.matchKey === book.matchKey);
  if (existing) {
    existing.sources = [...existing.sources.filter((s) => s.bookKey !== source.bookKey), source];
    existing.author ??= book.author;
  } else {
    shelf.unshift({ ...book, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, sources: [source], added: Date.now() });
  }
  saveShelf(shelf);
  return shelf;
}

/** 更新书架里某个来源的阅读进度；不在书架上则不处理 */
export function updateShelfProgress(bookKey: string, lastUrl: string, lastTitle: string): ShelfBook[] | undefined {
  const shelf = loadShelf();
  const source = shelf.flatMap((b) => b.sources).find((s) => s.bookKey === bookKey);
  if (!source || source.lastUrl === lastUrl) return undefined;
  Object.assign(source, { lastUrl, lastTitle, updated: Date.now() });
  saveShelf(shelf);
  return shelf;
}

export function removeShelfSource(bookId: string, bookKey: string): ShelfBook[] {
  const shelf = loadShelf()
    .map((b) => (b.id === bookId ? { ...b, sources: b.sources.filter((s) => s.bookKey !== bookKey) } : b))
    .filter((b) => b.sources.length);
  saveShelf(shelf);
  return shelf;
}

/** 给书架上已有的书追加一个来源（换源后使用）；书已不在书架或来源已存在则不处理 */
export function addShelfSource(bookId: string, source: ShelfSource): ShelfBook[] | undefined {
  const shelf = loadShelf();
  const book = shelf.find((b) => b.id === bookId);
  if (!book || book.sources.some((s) => s.bookKey === source.bookKey)) return undefined;
  book.sources.push(source);
  saveShelf(shelf);
  return shelf;
}

const AUTO_OPEN_KEY = 'autoOpen';
/** 书架跳转后自动进入阅读模式的有效期 */
const AUTO_OPEN_TTL = 60_000;

/** 跳转到其它页面后，阅读器打开时要做的事 */
export interface Arrival {
  /** 打开后显示的提示 */
  toast?: string;
  /** 换源前所读的书在书架上的 id：到达后把新站点加为来源 */
  shelfBookId?: string;
}

export function requestAutoOpen(url: string, arrival: Arrival = {}): void {
  GM_setValue(AUTO_OPEN_KEY, { url, time: Date.now(), arrival });
}

/** 取出并清除自动打开请求；只有地址匹配且未过期时返回到达信息 */
export function consumeAutoOpen(href: string): Arrival | undefined {
  const req = GM_getValue<{ url: string; time: number; arrival?: Arrival } | undefined>(AUTO_OPEN_KEY, undefined);
  if (!req) return undefined;
  const strip = (u: string) => u.split('#')[0];
  if (strip(req.url) !== strip(href)) return undefined;
  GM_deleteValue(AUTO_OPEN_KEY);
  return Date.now() - req.time < AUTO_OPEN_TTL ? (req.arrival ?? {}) : undefined;
}

export const READ_TITLES_PREFIX = 'readTitles:';

/** 按书（bookMatchKey）记录的已读章节标题（titleKey），用于跨站点显示已读 */
export function loadReadTitles(matchKey: string): string[] {
  return GM_getValue<string[]>(READ_TITLES_PREFIX + matchKey, []);
}

export function addReadTitles(matchKey: string, keys: string[]): string[] {
  const list = loadReadTitles(matchKey);
  const added = [...new Set(keys)].filter((k) => k && !list.includes(k));
  if (!added.length) return list;
  const next = [...list, ...added];
  GM_setValue(READ_TITLES_PREFIX + matchKey, next);
  return next;
}

const SOURCES_PREFIX = 'sources:';
const SOURCES_INDEX_KEY = 'sourcesIndex';
/** 换源结果缓存（含对方完整目录）最多保留的书数，超出时删除最久未用的 */
const SOURCES_CACHE_LIMIT = 30;

export function loadSourceCache<T>(matchKey: string): T | undefined {
  return GM_getValue<T | undefined>(SOURCES_PREFIX + matchKey, undefined);
}

export function saveSourceCache<T>(matchKey: string, data: T): void {
  GM_setValue(SOURCES_PREFIX + matchKey, data);
  const index = [matchKey, ...GM_getValue<string[]>(SOURCES_INDEX_KEY, []).filter((k) => k !== matchKey)];
  for (const old of index.splice(SOURCES_CACHE_LIMIT)) GM_deleteValue(SOURCES_PREFIX + old);
  GM_setValue(SOURCES_INDEX_KEY, index);
}
