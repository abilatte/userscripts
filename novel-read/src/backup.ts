import { GM_getValue, GM_listValues, GM_setValue } from '$';
import { DEFAULT_SETTINGS, importSites, loadCustomizedSites, READ_TITLES_PREFIX, validateSite } from './storage';
import type { BookInfo, Excerpt, Settings, ShelfBook, SiteEntry } from './types';

/**
 * 配置备份：把脚本存储导出为一个 JSON 文件，导入时与现有数据合并（不会删除本机已有的内容）。
 * 存储键见 storage.ts；autoOpen 是一次性跳转标记，不导出。
 */

export type BackupCategory = 'settings' | 'sites' | 'reading' | 'excerpts';

export const BACKUP_CATEGORIES: { id: BackupCategory; name: string; desc: string }[] = [
  { id: 'settings', name: '阅读设置', desc: '主题、字体、字号、宽度、间距、翻页、简繁' },
  { id: 'sites', name: '站点与过滤', desc: '站点规则、站点过滤正则、划选过滤文字' },
  { id: 'reading', name: '阅读记录', desc: '书架、阅读进度、已读章节、书名作者' },
  { id: 'excerpts', name: '摘录', desc: '所有书的摘录' },
];

const FORMAT = 'novel-reader-backup';
const VERSION = 1;
const READ_PREFIX = 'read:';
const BOOK_INFO_PREFIX = 'bookInfo:';

export interface BackupData {
  settings?: Partial<Settings>;
  /** 完整站点规则：用户站点 + 改过的内置站点 */
  sites?: SiteEntry[];
  shelf?: ShelfBook[];
  read?: Record<string, string[]>;
  /** 按书记录的已读章节标题，跨站点同步已读用 */
  readTitles?: Record<string, string[]>;
  bookInfo?: Record<string, BookInfo>;
  excerpts?: Excerpt[];
}

export interface BackupFile {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  data: BackupData;
}

function prefixed<T>(prefix: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of GM_listValues()) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = GM_getValue<T>(key);
  }
  return out;
}

export function collectBackup(categories: BackupCategory[]): BackupFile {
  const data: BackupData = {};
  const has = (c: BackupCategory) => categories.includes(c);
  if (has('settings')) data.settings = GM_getValue<Partial<Settings>>('settings', {});
  if (has('sites')) data.sites = loadCustomizedSites();
  if (has('reading')) {
    data.shelf = GM_getValue<ShelfBook[]>('shelf', []);
    data.read = prefixed<string[]>(READ_PREFIX);
    data.readTitles = prefixed<string[]>(READ_TITLES_PREFIX);
    data.bookInfo = prefixed<BookInfo>(BOOK_INFO_PREFIX);
  }
  if (has('excerpts')) data.excerpts = GM_getValue<Excerpt[]>('excerpts', []);
  return { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), data };
}

export interface BackupSummary {
  settings: boolean;
  sites: number;
  books: number;
  readBooks: number;
  readChapters: number;
  excerpts: number;
}

export function summarize(data: BackupData): BackupSummary {
  const read = Object.values(data.read ?? {});
  return {
    settings: !!data.settings && Object.keys(data.settings).length > 0,
    sites: data.sites?.length ?? 0,
    books: data.shelf?.length ?? 0,
    readBooks: read.length,
    readChapters: read.reduce((n, list) => n + list.length, 0),
    excerpts: data.excerpts?.length ?? 0,
  };
}

/** 本机当前数据的统计，用于导出前展示 */
export function currentSummary(): BackupSummary {
  return summarize(collectBackup(BACKUP_CATEGORIES.map((c) => c.id)).data);
}

export function downloadBackup(file: BackupFile): string {
  const date = file.exportedAt.slice(0, 10).replace(/-/g, '');
  const name = `novel-reader-backup-${date}.json`;
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** 解析并校验备份文件；结构不对时抛出说明具体位置的错误 */
export function parseBackup(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('不是合法的 JSON 文件');
  }
  if (!isObject(raw) || raw.format !== FORMAT) throw new Error('不是小说阅读模式导出的备份文件');
  if (typeof raw.version !== 'number' || raw.version > VERSION) {
    throw new Error(`备份文件版本 ${String(raw.version)} 比当前脚本新，请先更新脚本`);
  }
  const d = raw.data;
  if (!isObject(d)) throw new Error('备份文件缺少 data');
  if (d.settings !== undefined && !isObject(d.settings)) throw new Error('settings 必须是对象');
  if (d.sites !== undefined) {
    if (!Array.isArray(d.sites)) throw new Error('sites 必须是数组');
    d.sites.forEach(validateSite);
  }
  if (d.shelf !== undefined) {
    if (!Array.isArray(d.shelf)) throw new Error('shelf 必须是数组');
    for (const b of d.shelf as unknown[]) {
      if (!isObject(b) || typeof b.name !== 'string' || typeof b.matchKey !== 'string' || !Array.isArray(b.sources)) {
        throw new Error('书架条目格式不正确');
      }
    }
  }
  if (d.read !== undefined && !(isObject(d.read) && Object.values(d.read).every(isStringArray))) {
    throw new Error('read 必须是「书 → 章节地址数组」');
  }
  if (d.readTitles !== undefined && !(isObject(d.readTitles) && Object.values(d.readTitles).every(isStringArray))) {
    throw new Error('readTitles 必须是「书 → 章节标题数组」');
  }
  if (d.bookInfo !== undefined && !(isObject(d.bookInfo) && Object.values(d.bookInfo).every((i) => isObject(i) && typeof i.name === 'string'))) {
    throw new Error('bookInfo 格式不正确');
  }
  if (d.excerpts !== undefined) {
    if (!Array.isArray(d.excerpts)) throw new Error('excerpts 必须是数组');
    for (const e of d.excerpts as unknown[]) {
      if (!isObject(e) || typeof e.id !== 'string' || typeof e.text !== 'string') throw new Error('摘录条目格式不正确');
    }
  }
  return raw as unknown as BackupFile;
}

function mergeShelf(local: ShelfBook[], incoming: ShelfBook[]): ShelfBook[] {
  const shelf = local.map((b) => ({ ...b, sources: [...b.sources] }));
  for (const book of incoming) {
    const existing = shelf.find((b) => b.matchKey === book.matchKey);
    if (!existing) {
      shelf.push(book);
      continue;
    }
    existing.author ??= book.author;
    for (const src of book.sources) {
      const idx = existing.sources.findIndex((s) => s.bookKey === src.bookKey);
      // 同一来源保留进度更新的那份
      if (idx < 0) existing.sources.push(src);
      else if (src.updated > existing.sources[idx].updated) existing.sources[idx] = src;
    }
  }
  return shelf;
}

/**
 * 把备份合并进本机存储：
 * 设置与站点规则按项覆盖；书架按书合并、进度取较新；已读章节取并集；摘录按 id 去重。
 */
export function importBackup(data: BackupData): void {
  if (data.settings) {
    const known = Object.fromEntries(Object.entries(data.settings).filter(([k]) => k in DEFAULT_SETTINGS));
    GM_setValue('settings', { ...GM_getValue<Partial<Settings>>('settings', {}), ...known });
  }
  if (data.sites) importSites(data.sites);
  if (data.shelf) GM_setValue('shelf', mergeShelf(GM_getValue<ShelfBook[]>('shelf', []), data.shelf));
  const union = (prefix: string, lists: Record<string, string[]> | undefined) => {
    for (const [id, values] of Object.entries(lists ?? {})) {
      const local = GM_getValue<string[]>(prefix + id, []);
      GM_setValue(prefix + id, [...local, ...values.filter((v) => !local.includes(v))]);
    }
  };
  union(READ_PREFIX, data.read);
  union(READ_TITLES_PREFIX, data.readTitles);
  for (const [bookKey, info] of Object.entries(data.bookInfo ?? {})) {
    GM_setValue(BOOK_INFO_PREFIX + bookKey, info);
  }
  if (data.excerpts) {
    const local = GM_getValue<Excerpt[]>('excerpts', []);
    const ids = new Set(local.map((e) => e.id));
    const merged = [...local, ...data.excerpts.filter((e) => !ids.has(e.id))].sort((a, b) => a.time - b.time);
    GM_setValue('excerpts', merged);
  }
}
