import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ChallengeError } from '../core/fetcher';
import { createLoader } from '../core/loader';
import {
  type ChapterMatch,
  inspectBook,
  matchChapter,
  nameKey,
  RateLimitError,
  searchBooks,
  searchPageUrl,
} from '../core/source';
import { loadSites, loadSourceCache, saveSourceCache } from '../storage';
import type { ShelfBook, SiteEntry, TocItem } from '../types';
import { IconClose, IconExternal, IconRefresh } from './icons';
import { openVerify } from './verify';

type Convert = (s: string) => string;

/** 一个站点上找到的同名书 */
export interface SourceRow {
  siteId: string;
  origin: 'shelf' | 'search';
  bookUrl: string;
  name: string;
  author?: string;
  toc: TocItem[];
}

type SiteState =
  | { kind: 'loading'; note?: string }
  | { kind: 'verify'; url: string }
  | { kind: 'rate' }
  | { kind: 'error'; message: string }
  | { kind: 'notfound' }
  | { kind: 'done'; rows: SourceRow[] };

/** 只缓存有结论的状态；出错的站点下次打开面板时重新搜索 */
interface SourceCache {
  time: number;
  sites: Record<string, Extract<SiteState, { kind: 'notfound' | 'done' }>>;
}

interface Props {
  site: SiteEntry;
  bookKey: string;
  name: string;
  author?: string;
  infoReady: boolean;
  /** 书架合并、缓存共用的书标识；书名作者确认前为空 */
  matchKey?: string;
  current: { title: string; index: number } | undefined;
  /** 当前站点的完整目录 */
  currentToc: TocItem[] | undefined;
  shelf: ShelfBook[];
  hans: Convert;
  hant: Convert;
  convert: Convert;
  onSwitch(row: SourceRow, match: ChapterMatch): void;
  onClose(): void;
}

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} 小时前` : `${Math.round(h / 24)} 天前`;
}

export function SourcePanel(props: Props) {
  const { site, bookKey, name, author, infoReady, matchKey, current, currentToc, shelf, hans, hant, convert, onSwitch, onClose } = props;
  // 面板打开期间站点列表不会变，不必每次渲染都读一遍存储
  const others = useMemo(() => loadSites().filter((s) => s.enabled && s.id !== site.id), [site.id]);
  const [states, setStates] = useState<Record<string, SiteState>>({});
  const [cacheTime, setCacheTime] = useState<number>();
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const target = nameKey(name, hans);
  const authorKey = author ? nameKey(author, hans) : '';
  const shelfBook = shelf.find((b) => b.sources.some((s) => s.bookKey === bookKey) || b.matchKey === matchKey);

  const setSite = (id: string, state: SiteState) => {
    if (!alive.current) return;
    setStates((prev) => ({ ...prev, [id]: state }));
    if (matchKey && (state.kind === 'done' || state.kind === 'notfound')) {
      const cache = loadSourceCache<SourceCache>(matchKey) ?? { time: Date.now(), sites: {} };
      saveSourceCache(matchKey, { time: Date.now(), sites: { ...cache.sites, [id]: state } });
      setCacheTime(Date.now());
    }
  };

  /** 书架里该站点的来源：用记录的书页，没有就从上次读到的章节页找书页/目录页 */
  const fromShelf = async (s: SiteEntry): Promise<SourceRow[] | undefined> => {
    const src = shelfBook?.sources.find((x) => x.siteId === s.id && x.bookKey !== bookKey);
    if (!src) return undefined;
    let bookUrl = src.bookUrl;
    if (!bookUrl) {
      const ch = await createLoader(s).load(src.lastUrl);
      bookUrl = ch.bookUrl ?? ch.tocUrl;
    }
    if (!bookUrl) throw new Error('书架记录里没有书页地址，章节页上也没找到书页链接');
    const book = await inspectBook(s, bookUrl);
    return [{ siteId: s.id, origin: 'shelf', ...book }];
  };

  /** 依次用原书名、简体、繁体搜索，直到有结果；同一站点的搜索由 searchBooks 排队隔开 */
  const fromSearch = async (s: SiteEntry): Promise<SourceRow[]> => {
    const variants = [...new Set([name, hans(name), hant(name)])];
    for (const [i, v] of variants.entries()) {
      if (i > 0) setSite(s.id, { kind: 'loading', note: `改搜「${v}」，站点限制搜索间隔，稍候…` });
      const urls = await searchBooks(s, v, hans);
      const rows: SourceRow[] = [];
      for (const url of urls) {
        const book = await inspectBook(s, url);
        if (nameKey(book.name, hans) === target) rows.push({ siteId: s.id, origin: 'search', ...book });
      }
      if (rows.length) return rows;
    }
    return [];
  };

  const run = async (s: SiteEntry): Promise<void> => {
    setSite(s.id, { kind: 'loading' });
    try {
      const rows = (await fromShelf(s)) ?? (await fromSearch(s));
      setSite(s.id, rows.length ? { kind: 'done', rows } : { kind: 'notfound' });
    } catch (e) {
      // searchBooks 已经等过一个间隔重试，仍被限流说明站点限制更严或同时在别处搜索
      if (e instanceof RateLimitError) setSite(s.id, { kind: 'rate' });
      else if (e instanceof ChallengeError) setSite(s.id, { kind: 'verify', url: `https://${s.hosts[0]}/` });
      else setSite(s.id, { kind: 'error', message: (e as Error).message });
    }
  };

  // 打开面板：先显示缓存，缓存里没有结论的站点再搜索
  useEffect(() => {
    if (!infoReady || !matchKey) return;
    const cache = loadSourceCache<SourceCache>(matchKey);
    const cached = cache?.sites ?? {};
    setCacheTime(cache?.time);
    setStates(cached);
    for (const s of others) if (!cached[s.id]) void run(s);
  }, [infoReady, matchKey]);

  const refresh = () => others.forEach((s) => void run(s));

  const currentTotal = currentToc?.length;
  const sameAuthor = (row: SourceRow) => (!row.author || !authorKey ? 'unknown' : nameKey(row.author, hans) === authorKey ? 'same' : 'different');

  const rows = others.flatMap((s) => {
    const st = states[s.id];
    return st?.kind === 'done' ? st.rows.map((row) => ({ row, s })) : [];
  });
  // 作者一致的排前面，其次书架来源
  const rank = (row: SourceRow) => (sameAuthor(row) === 'same' ? 0 : 2) + (row.origin === 'shelf' ? 0 : 1);
  rows.sort((a, b) => rank(a.row) - rank(b.row));
  const pending = others.filter((s) => states[s.id] && states[s.id].kind !== 'done' && states[s.id].kind !== 'notfound');
  const notFound = others.filter((s) => states[s.id]?.kind === 'notfound');

  const matchLabel = (m: ChapterMatch) =>
    m.kind === 'title' ? <span class="nr-chip is-accent">有本章</span> : m.kind === 'index' ? <span class="nr-chip">按序号对应</span> : <span class="nr-chip">未找到本章</span>;

  return (
    <section class="nr-panel is-toc">
      <div class="nr-panel-head">
        <h2>换源</h2>
        <button class="nr-btn is-ghost nr-icon-btn" onClick={onClose} title="关闭">
          <IconClose width={18} height={18} />
        </button>
      </div>
      <div class="nr-panel-sub">
        <div class="nr-shelf-current">
          <div class="nr-shelf-name">{convert(name)}</div>
          <div class="nr-hint">
            {author ? convert(author) : infoReady ? '作者未知' : '正在获取书名作者…'}
            {cacheTime && ` · 更新于 ${ago(cacheTime)}`}
          </div>
        </div>
        <button class="nr-btn is-small" disabled={!matchKey} onClick={refresh}>
          <IconRefresh width={14} height={14} />
          刷新
        </button>
      </div>
      <div class="nr-panel-body" style="padding:0 12px 16px">
        {!others.length && <div class="nr-empty">没有其它已启用的站点，可在设置 → 站点里添加</div>}

        <div class="nr-source is-current">
          <div class="nr-source-main">
            <div class="nr-source-line">
              <span class="nr-source-site">{site.name}</span>
              <span class="nr-chip is-accent">当前</span>
            </div>
            <div class="nr-hint">{currentToc ? `共 ${currentTotal} 章 · 最新：${convert(currentToc.at(-1)?.title ?? '')}` : '正在获取目录…'}</div>
          </div>
        </div>

        {rows.map(({ row, s }) => {
          const m = current ? matchChapter(current.title, current.index, row.toc, hans) : ({ kind: 'none' } as const);
          const diff = currentTotal === undefined ? undefined : row.toc.length - currentTotal;
          const authorState = sameAuthor(row);
          return (
            <div key={row.bookUrl} class="nr-source">
              <button class="nr-source-main" onClick={() => onSwitch(row, m)} title={m.kind === 'none' ? '打开书页' : '跳到对应章节'}>
                <div class="nr-source-line">
                  <span class="nr-source-site">{s.name}</span>
                  <span class="nr-chip">{row.origin === 'shelf' ? '书架' : '搜索'}</span>
                  {authorState !== 'same' && (
                    <span class="nr-chip is-warn">{authorState === 'different' ? `作者不同：${convert(row.author!)}` : '作者未知'}</span>
                  )}
                  <span class="nr-source-match">{matchLabel(m)}</span>
                </div>
                <div class="nr-hint">
                  共 {row.toc.length} 章
                  {diff !== undefined && diff !== 0 && <b class={diff > 0 ? 'nr-diff-up' : 'nr-diff-down'}>（{diff > 0 ? `+${diff}` : diff}）</b>}
                  {row.toc.length > 0 && ` · 最新：${convert(row.toc.at(-1)!.title)}`}
                </div>
              </button>
              <button class="nr-btn is-ghost is-small" title="在新标签页打开书页" onClick={() => window.open(row.bookUrl, '_blank', 'noopener')}>
                <IconExternal width={14} height={14} />
                书页
              </button>
            </div>
          );
        })}

        {pending.map((s) => {
          const st = states[s.id];
          return (
            <div key={s.id} class="nr-source is-pending">
              <div class="nr-source-main">
                <div class="nr-source-line">
                  <span class="nr-source-site">{s.name}</span>
                </div>
                <div class="nr-hint">
                  {st.kind === 'loading' && (st.note ?? '搜索中…')}
                  {st.kind === 'verify' && '站点要求人机验证'}
                  {st.kind === 'rate' && '搜索过于频繁'}
                  {st.kind === 'error' && `出错：${st.message}`}
                </div>
              </div>
              {st.kind === 'loading' && <div class="nr-spinner is-small" />}
              {st.kind === 'verify' && (
                <button class="nr-btn is-small is-primary" onClick={() => openVerify(st.url, () => void run(s))}>
                  打开验证
                </button>
              )}
              {(st.kind === 'rate' || st.kind === 'error') && (
                <button class="nr-btn is-small" onClick={() => void run(s)}>
                  {st.kind === 'rate' ? '稍后重试' : '重试'}
                </button>
              )}
            </div>
          );
        })}

        {notFound.map((s) => (
          <div key={s.id} class="nr-source is-missing">
            <div class="nr-source-main">
              <div class="nr-source-line">
                <span class="nr-source-site">{s.name}</span>
              </div>
              <div class="nr-hint">未找到同名书</div>
            </div>
            <button class="nr-btn is-ghost is-small" onClick={() => window.open(searchPageUrl(s, name), '_blank', 'noopener')}>
              去站内搜索
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
