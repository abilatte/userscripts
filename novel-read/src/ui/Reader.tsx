import { Component } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { GM_addValueChangeListener, GM_removeValueChangeListener } from '$';
import { cleanText, foldFancyLetters, mergeBrokenParagraphs } from '../core/extract';
import { fetchBookInfo } from '../core/book';
import { ChallengeError } from '../core/fetcher';
import { createLoader } from '../core/loader';
import { getConverter } from '../core/opencc';
import { loadFullToc } from '../core/toc';
import { bookMatchKey, type ChapterMatch, titleKey, tocTitleKeys } from '../core/source';
import {
  addReadTitles,
  addShelfSource,
  addToShelf,
  type Arrival,
  bookKeyOf,
  DEFAULT_SETTINGS,
  loadBookInfo,
  loadExcerpts,
  loadReadChapters,
  loadReadingPosition,
  loadReadTitles,
  loadSettings,
  loadShelf,
  loadSites,
  markChaptersRead,
  patchSettings,
  removeShelfSource,
  requestAutoOpen,
  saveBookInfo,
  saveExcerpts,
  saveReadingPosition,
  SETTINGS_KEY,
  SHELF_KEY,
  SITES_KEY,
  updateShelfProgress,
  updateSiteStrip,
} from '../storage';
import type { BookInfo, Chapter, ReplaceRule, Settings, ShelfBook, ShelfSource, SiteEntry, ThemeId, TocItem } from '../types';
import { ExcerptPanel } from './ExcerptPanel';
import { ShelfPanel } from './ShelfPanel';
import { SourcePanel, type SourceRow } from './SourcePanel';
import { SearchPanel } from './SearchPanel';
import { openVerify } from './verify';
import {
  IconArrowUp,
  IconBookmark,
  IconChevronLeft,
  IconChevronRight,
  IconExit,
  IconFilter,
  IconList,
  IconRefresh,
  IconSearch,
  IconShelf,
  IconSliders,
  IconSwap,
} from './icons';
import { FONT_SIZE, readerVars } from './options';
import { SettingsPanel } from './SettingsPanel';
import { TocPanel, type FullTocState } from './TocPanel';
import { type KeyPanel, useReaderKeys } from './useReaderKeys';
import { useSelection } from './useSelection';

type Convert = (s: string) => string;
type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string; retry: () => void; /** Cloudflare 验证时需要用户打开的页面 */ verifyUrl?: string }
  | { kind: 'end' };
type Panel = 'none' | KeyPanel;

interface CompiledReplace {
  re: RegExp;
  to: string;
}

export interface ReaderProps {
  site: SiteEntry;
  startUrl: string;
  /** 首章使用的文档；为空则重新请求 */
  firstDoc?: Document;
  /** 从网页标题猜出的书名，书页获取失败时使用 */
  guessedBookName: string;
  /** 从书架或换源跳转过来时附带的信息 */
  arrival?: Arrival;
  onExit(currentUrl: string): void;
  onReadapt(): void;
}

const CURRENT_LINE = 80;
const PRELOAD_SCREENS = 1.5;
/** 章节底部进入视口（留一点余量）即视为读到末尾 */
const READ_END_SLACK = 40;
/** 滚动模式下，当前章之前最多保留的章节数；更早的从页面上移除，避免连读很久后段落越堆越多 */
const KEEP_BEHIND = 2;

/**
 * 显示前应用当前站点的过滤与替换：
 * - filters（正则）命中原文、显示文字或花体还原后的文字，整段删除；
 * - replace（正则替换）和 strip（划选文字）在显示文字上生效，删完为空的段落整段去掉。
 */
function renderParagraphs(
  paragraphs: string[],
  convert: Convert,
  filters: RegExp[],
  strip: string[],
  replace: CompiledReplace[],
  mergeParagraphs: boolean,
): string[] {
  const words = [...new Set(strip.flatMap((w) => [w, convert(w)]))];
  const out: string[] = [];
  for (const raw of paragraphs) {
    let folded: string | undefined;
    const getFolded = () => (folded ??= foldFancyLetters(raw));
    if (filters.some((f) => f.test(raw) || f.test(getFolded()))) continue;
    let text = convert(raw);
    if (filters.some((f) => f.test(text))) continue;
    for (const r of replace) text = text.replace(r.re, r.to);
    if (words.length) text = cleanText(words.reduce((s, w) => s.split(w).join(''), text));
    if (text) out.push(text);
  }
  return mergeParagraphs ? mergeBrokenParagraphs(out) : out;
}

interface ChapterViewProps {
  chapter: Chapter;
  convert: Convert;
  filters: RegExp[];
  strip: string[];
  replace: CompiledReplace[];
  mergeParagraphs: boolean;
}

class ChapterView extends Component<ChapterViewProps> {
  shouldComponentUpdate(next: ChapterViewProps) {
    const p = this.props;
    return (
      p.chapter !== next.chapter ||
      p.convert !== next.convert ||
      p.filters !== next.filters ||
      p.strip !== next.strip ||
      p.replace !== next.replace ||
      p.mergeParagraphs !== next.mergeParagraphs
    );
  }

  render({ chapter, convert, filters, strip, replace, mergeParagraphs }: ChapterViewProps) {
    const paragraphs = renderParagraphs(chapter.paragraphs, convert, filters, strip, replace, mergeParagraphs);
    return (
      <article class="nr-chapter" data-url={chapter.url}>
        <h1>{convert(chapter.title)}</h1>
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </article>
    );
  }
}

function StatusView({ status, full, onReadapt }: { status: Status; full?: boolean; onReadapt?: () => void }) {
  const cls = `nr-status${full ? ' is-full' : ''}`;
  if (status.kind === 'loading') {
    return (
      <div class={cls}>
        <div class="nr-spinner" />
        <span>{full ? '正在加载…' : '正在加载下一章…'}</span>
      </div>
    );
  }
  if (status.kind === 'error' && status.verifyUrl) {
    const { verifyUrl, retry } = status;
    return (
      <div class={cls}>
        <div class="nr-status-title">需要人机验证</div>
        <div class="nr-status-msg">
          站点开启了 Cloudflare 验证，后台加载被拦截。请在新标签页完成验证，切回这里会自动重试。
        </div>
        <div style="display:flex;gap:8px">
          <button class="nr-btn is-primary" onClick={() => openVerify(verifyUrl, retry)}>
            打开验证页面
          </button>
          <button class="nr-btn" onClick={retry}>
            <IconRefresh width={16} height={16} />
            已完成，重试
          </button>
        </div>
      </div>
    );
  }
  if (status.kind === 'error') {
    return (
      <div class={cls}>
        <div class="nr-status-title">加载失败</div>
        <div class="nr-status-msg">{status.message}</div>
        <div style="display:flex;gap:8px">
          <button class="nr-btn is-primary" onClick={status.retry}>
            <IconRefresh width={16} height={16} />
            点击重试
          </button>
          {onReadapt && (
            <button class="nr-btn" onClick={onReadapt}>
              重新适配本站
            </button>
          )}
        </div>
      </div>
    );
  }
  if (status.kind === 'end') {
    return (
      <div class={cls}>
        <div class="nr-status-title">已是最新章节</div>
        <span>没有找到下一章链接</span>
      </div>
    );
  }
  return null;
}

const formatClock = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function Reader({ site, startUrl, firstDoc, guessedBookName, arrival, onExit, onReadapt }: ReaderProps) {
  const [activeSite, setActiveSite] = useState<SiteEntry>(site);
  const bookKey = useMemo(() => bookKeyOf(startUrl), [startUrl]);
  const [cachedInfo] = useState(() => loadBookInfo(bookKey));
  const [bookInfo, setBookInfo] = useState<BookInfo>(cachedInfo ?? { name: guessedBookName });
  const [infoReady, setInfoReady] = useState(!!cachedInfo);
  const [shelf, setShelf] = useState<ShelfBook[]>(loadShelf);
  const bookName = bookInfo.name;
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const lastLightTheme = useRef<ThemeId>(settings.theme === 'dark' ? 'parchment' : settings.theme);
  if (settings.theme !== 'dark') lastLightTheme.current = settings.theme;
  const [convert, setConvert] = useState<{ fn: Convert } | undefined>();
  const [stream, setStream] = useState<Chapter[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [current, setCurrent] = useState<string>(startUrl);
  const [session, setSession] = useState<TocItem[]>([]);
  const [read, setRead] = useState<string[]>(() => loadReadChapters(bookKey));
  const readSet = useMemo(() => new Set(read), [read]);
  // 书名比较、跨站已读同步固定按简体进行，与显示用的简繁设置无关
  const [scripts, setScripts] = useState<{ hans: Convert }>();
  // 简→繁字典较大，只在换源面板要用繁体书名搜索时才加载
  const [hant, setHant] = useState<{ fn: Convert }>();
  const matchKey = useMemo(
    () => (scripts && infoReady ? bookMatchKey(bookInfo.name, bookInfo.author, scripts.hans) : undefined),
    [scripts, infoReady, bookInfo],
  );
  const [readTitles, setReadTitles] = useState<string[]>([]);
  const [fullToc, setFullToc] = useState<FullTocState>({ kind: 'idle' });
  const [panel, setPanel] = useState<Panel>('none');
  const [toast, setToast] = useState<string>();
  const [clock, setClock] = useState(formatClock);
  const [strip, setStrip] = useState<string[]>(site.strip ?? []);
  const [siteFilters, setSiteFilters] = useState<string[]>(site.filters ?? []);
  const [siteReplace, setSiteReplace] = useState<ReplaceRule[]>(site.replace ?? []);
  // 规则在保存时已校验过；这里仍逐条编译，单条写错不影响其它规则
  const compiledFilters = useMemo(
    () =>
      siteFilters.flatMap((f) => {
        try {
          return [new RegExp(f, 'i')];
        } catch {
          return [];
        }
      }),
    [siteFilters],
  );
  const compiledReplace = useMemo<CompiledReplace[]>(
    () =>
      siteReplace.flatMap((r) => {
        try {
          return [{ re: new RegExp(r.from, 'g'), to: r.to }];
        } catch {
          return [];
        }
      }),
    [siteReplace],
  );

  const loader = useMemo(() => createLoader(activeSite), [activeSite]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [selection, clearSelection] = useSelection(scrollRef);
  const token = useRef(0);
  const mounted = useRef(true);
  const toastTimer = useRef(0);
  const frame = useRef(0);
  const posTimer = useRef(0);
  const pendingPos = useRef<{ url: string; ratio: number }>();
  const live = useRef({ stream, status, settings, current, readSet, matchKey, scripts });
  live.current = { stream, status, settings, current, readSet, matchKey, scripts };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(toastTimer.current);
      window.cancelAnimationFrame(frame.current);
      window.clearTimeout(posTimer.current);
      if (pendingPos.current) saveReadingPosition(bookKey, pendingPos.current);
    };
  }, [bookKey]);

  const showToast = useCallback((msg: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => {
      if (mounted.current) setToast(undefined);
    }, 4000);
  }, []);

  // ---------- 跨标签页同步 ----------
  useEffect(() => {
    if (typeof GM_addValueChangeListener !== 'function') return;
    const ids = [
      GM_addValueChangeListener(SETTINGS_KEY, (_k, _old, val, remote) => {
        if (remote && val) setSettings({ ...DEFAULT_SETTINGS, ...(val as Partial<Settings>) });
      }),
      GM_addValueChangeListener(SHELF_KEY, (_k, _old, val, remote) => {
        if (remote && Array.isArray(val)) setShelf(val as ShelfBook[]);
      }),
      GM_addValueChangeListener(SITES_KEY, (_k, _old, _val, remote) => {
        if (!remote) return;
        const entry = loadSites().find((s) => s.id === activeSite.id);
        if (entry) {
          setActiveSite(entry);
          setStrip(entry.strip ?? []);
          setSiteFilters(entry.filters ?? []);
          setSiteReplace(entry.replace ?? []);
        }
      }),
    ];
    return () => {
      if (typeof GM_removeValueChangeListener === 'function') {
        ids.forEach((id) => GM_removeValueChangeListener(id));
      }
    };
  }, [activeSite.id]);

  // ---------- 状态栏时钟 ----------
  useEffect(() => {
    if (settings.statusBar === false) return;
    setClock(formatClock());
    const id = window.setInterval(() => setClock(formatClock()), 30_000);
    return () => window.clearInterval(id);
  }, [settings.statusBar]);

  // ---------- 简繁转换 ----------
  useEffect(() => {
    let alive = true;
    getConverter(settings.script).then(
      (fn) => alive && setConvert({ fn }),
      (e: Error) => {
        if (!alive) return;
        showToast(`简繁转换不可用，已显示原文：${e.message}`);
        setConvert({ fn: (s) => s });
      },
    );
    return () => {
      alive = false;
    };
  }, [settings.script, showToast]);

  useEffect(() => {
    let alive = true;
    getConverter('hans').then(
      (hans) => alive && setScripts({ hans }),
      // 转换库加载失败时退化为原文比较：跨站匹配可能漏掉简繁不同的书名
      (e: Error) => {
        if (!alive) return;
        console.warn(`[小说阅读模式] 简繁转换不可用，换源按原文比较：${e.message}`);
        setScripts({ hans: (s) => s });
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (panel !== 'source' || hant) return;
    let alive = true;
    getConverter('hant').then(
      (fn) => alive && setHant({ fn }),
      (e: Error) => {
        if (!alive) return;
        console.warn(`[小说阅读模式] 繁体字典不可用，换源只用原书名和简体书名搜索：${e.message}`);
        setHant({ fn: (s) => s });
      },
    );
    return () => {
      alive = false;
    };
  }, [panel, hant]);

  useEffect(() => {
    if (matchKey) setReadTitles(loadReadTitles(matchKey));
  }, [matchKey]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings(patchSettings(patch));
  }, []);

  // ---------- 章节加载 ----------
  const showChapter = useCallback(
    (url: string, doc?: Document) => {
      const t = ++token.current;
      setStream([]);
      setStatus({ kind: 'loading' });
      scrollRef.current?.scrollTo({ top: 0 });
      loader.load(url, doc).then(
        (ch) => {
          if (!mounted.current || t !== token.current) return;
          setStream([ch]);
          setCurrent(ch.url);
          setStatus(ch.nextUrl ? { kind: 'idle' } : { kind: 'end' });
        },
        (e: Error) => {
          if (!mounted.current || t !== token.current) return;
          setStatus({
            kind: 'error',
            message: e.message,
            retry: () => showChapter(url),
            verifyUrl: e instanceof ChallengeError ? e.verifyUrl : undefined,
          });
        },
      );
    },
    [loader],
  );

  /** force：从出错状态重试时跳过「空闲才加载」的判断 */
  const loadMore = useCallback((force = false) => {
    const { stream: s, status: st } = live.current;
    const last = s[s.length - 1];
    if (!last || (!force && st.kind !== 'idle')) return;
    if (!last.nextUrl) {
      setStatus({ kind: 'end' });
      return;
    }
    const t = token.current;
    setStatus({ kind: 'loading' });
    loader.load(last.nextUrl).then(
      (ch) => {
        if (!mounted.current || t !== token.current) return;
        if (live.current.stream.some((c) => c.url === ch.url)) {
          setStatus({ kind: 'end' });
          return;
        }
        setStream((prev) => (prev.some((c) => c.url === ch.url) ? prev : [...prev, ch]));
        setStatus(ch.nextUrl ? { kind: 'idle' } : { kind: 'end' });
      },
      (e: Error) => {
        if (!mounted.current || t !== token.current) return;
        setStatus({
          kind: 'error',
          message: e.message,
          retry: () => loadMore(true),
          verifyUrl: e instanceof ChallengeError ? e.verifyUrl : undefined,
        });
      },
    );
  }, [loader]);

  useEffect(() => {
    showChapter(startUrl, firstDoc);
    // 只在打开时加载一次首章
  }, []);

  // 首章渲染后恢复上次章内阅读位置
  const restoredPos = useRef(false);
  useEffect(() => {
    if (restoredPos.current || !convert || !stream.length) return;
    restoredPos.current = true;
    const savedPos = loadReadingPosition(bookKey);
    if (savedPos && savedPos.url === startUrl && savedPos.ratio > 0.02) {
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        const maxScroll = el.scrollHeight - el.clientHeight;
        if (maxScroll > 0) el.scrollTop = Math.min(maxScroll, maxScroll * savedPos.ratio);
      });
    }
  }, [convert, stream.length, bookKey, startUrl]);

  // 章节翻页模式：后台预加载下一章（失败时真正翻页会重新请求并报错）
  const shown = stream[stream.length - 1];
  useEffect(() => {
    if (settings.pageMode === 'chapter' && shown?.nextUrl) loader.load(shown.nextUrl).catch(() => undefined);
  }, [settings.pageMode, shown, loader]);

  // ---------- 完整目录：首章加载后即在后台获取 ----------
  const head = stream[0];
  const tocUrl = head?.tocUrl;
  const loadToc = useCallback(() => {
    setFullToc({ kind: 'loading' });
    loadFullToc(activeSite, live.current.current, tocUrl).then(
      (items) => mounted.current && setFullToc({ kind: 'ready', items }),
      (e: Error) =>
        mounted.current &&
        setFullToc({
          kind: 'error',
          message: e.message,
          verifyUrl: e instanceof ChallengeError ? e.verifyUrl : undefined,
        }),
    );
  }, [activeSite, tocUrl]);
  useEffect(() => {
    if (head && fullToc.kind === 'idle') loadToc();
  }, [head, fullToc.kind, loadToc]);

  // 本站按地址记录的已读章节，同步一份标题到按书记录里，换到其它站点也能显示已读
  useEffect(() => {
    if (!matchKey || !scripts || fullToc.kind !== 'ready') return;
    const keys = tocTitleKeys(fullToc.items, scripts.hans);
    setReadTitles(addReadTitles(matchKey, fullToc.items.flatMap((it, i) => (readSet.has(it.url) ? [keys[i]] : []))));
  }, [matchKey, scripts, fullToc]);

  // ---------- 书名、作者：从书页读取，按书缓存 ----------
  // 同一组书页地址只请求一次：翻章、裁剪旧章节都会让 head 变化，不能每次都重新抓书页
  const infoTried = useRef<string>();
  const infoLoaded = useRef(!!cachedInfo);
  useEffect(() => {
    if (!head || infoLoaded.current) return;
    const candidates = [head.bookUrl, head.tocUrl].filter((u): u is string => !!u);
    const tried = candidates.join('\n');
    if (infoTried.current === tried) return;
    infoTried.current = tried;
    fetchBookInfo(candidates, activeSite).then(
      (info) => {
        if (!mounted.current) return;
        infoLoaded.current = true;
        saveBookInfo(bookKey, info);
        setBookInfo(info);
        setInfoReady(true);
      },
      // 书名用于摘录出处和书架，取不到时沿用网页标题里猜出的书名
      (e: Error) => {
        if (!mounted.current) return;
        console.warn(`[小说阅读模式] 获取书名失败，使用「${guessedBookName}」：${e.message}`);
        setInfoReady(true);
      },
    );
  }, [head?.url]);

  /** 切到分章模式时只保留当前章 */
  const enterPageMode = (mode: Settings['pageMode']) => {
    if (mode !== 'chapter') return;
    const ch = live.current.stream.find((c) => c.url === live.current.current);
    if (ch) {
      token.current++;
      setStream([ch]);
      setStatus(ch.nextUrl ? { kind: 'idle' } : { kind: 'end' });
      scrollRef.current?.scrollTo({ top: 0 });
    }
  };

  const setPageMode = useCallback(
    (mode: Settings['pageMode']) => {
      enterPageMode(mode);
      updateSettings({ pageMode: mode });
    },
    [updateSettings],
  );

  /** 导入备份后重新读取存储（只读不写，避免用内存里的旧设置覆盖刚导入的数据） */
  const reloadStored = () => {
    const saved = loadSettings();
    enterPageMode(saved.pageMode);
    setSettings(saved);
    setShelf(loadShelf());
    setRead(loadReadChapters(bookKey));
    if (matchKey) setReadTitles(loadReadTitles(matchKey));
    const info = loadBookInfo(bookKey);
    if (info) {
      setBookInfo(info);
      setInfoReady(true);
    }
    const entry = loadSites().find((s) => s.id === activeSite.id);
    if (entry) {
      setActiveSite(entry);
      setStrip(entry.strip ?? []);
      setSiteFilters(entry.filters ?? []);
      setSiteReplace(entry.replace ?? []);
    }
  };

  // ---------- 滚动跟踪 ----------
  /** 裁剪旧章节前记下当前章在视口里的位置，裁剪后按它把滚动位置对回去 */
  const anchor = useRef<{ url: string; top: number }>();
  const onScroll = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = scrollRef.current;
      if (!el) return;

      // 阶段 1：统一读取全部几何信息，避免读写交叉触发强制回流
      const scrollTop = el.scrollTop;
      const clientHeight = el.clientHeight;
      const scrollHeight = el.scrollHeight;
      const nodes = [...el.querySelectorAll<HTMLElement>('.nr-chapter')];
      const metrics = nodes.map((n) => ({
        node: n,
        url: n.dataset.url!,
        top: n.offsetTop,
        height: n.offsetHeight,
      }));
      const line = scrollTop + CURRENT_LINE;
      const currentMetric = metrics.filter((m) => m.top <= line).pop() ?? metrics[0];
      const currentIdx = currentMetric ? metrics.indexOf(currentMetric) : -1;
      let trimFromUrl: string | undefined;
      let anchorTop: number | undefined;
      if (currentMetric && live.current.settings.pageMode === 'scroll' && currentIdx > KEEP_BEHIND + 1) {
        const candidateUrl = metrics[currentIdx - KEEP_BEHIND].url;
        if (live.current.stream.findIndex((c) => c.url === candidateUrl) > 0) {
          trimFromUrl = candidateUrl;
          anchorTop = currentMetric.node.getBoundingClientRect().top;
        }
      }
      const viewBottom = scrollTop + clientHeight + READ_END_SLACK;
      const finished = metrics
        .filter((m) => m.top + m.height <= viewBottom)
        .map((m) => m.url)
        .filter((u) => !live.current.readSet.has(u));
      const remain = scrollHeight - scrollTop - clientHeight;

      // 阶段 2：统一执行写入与状态更新
      if (currentMetric) {
        if (currentMetric.url !== live.current.current) setCurrent(currentMetric.url);
        const p = currentMetric.height ? (scrollTop + clientHeight - currentMetric.top) / currentMetric.height : 0;
        const progress = Math.max(0, Math.min(1, p));
        if (progressRef.current) progressRef.current.style.transform = `scaleX(${progress})`;
        const scrollable = currentMetric.height - clientHeight;
        const ratio = scrollable > 0 ? Math.max(0, Math.min(1, (scrollTop - currentMetric.top) / scrollable)) : 0;
        pendingPos.current = { url: currentMetric.url, ratio };
        if (!posTimer.current) {
          posTimer.current = window.setTimeout(() => {
            posTimer.current = 0;
            if (pendingPos.current) saveReadingPosition(bookKey, pendingPos.current);
          }, 600);
        }
      }
      if (trimFromUrl && anchorTop !== undefined && currentMetric) {
        anchor.current = { url: currentMetric.url, top: anchorTop };
        setStream((prev) => {
          const fromIdx = prev.findIndex((c) => c.url === trimFromUrl);
          return fromIdx > 0 ? prev.slice(fromIdx) : prev;
        });
      }
      if (finished.length) {
        setRead(markChaptersRead(bookKey, finished));
        const { matchKey: key, scripts: sc, stream: chapters } = live.current;
        if (key && sc) {
          const titles = finished.flatMap((u) => chapters.find((c) => c.url === u)?.title ?? []);
          setReadTitles(addReadTitles(key, titles.map((t) => titleKey(t, sc.hans))));
        }
      }
      if (live.current.settings.pageMode === 'scroll' && remain < clientHeight * PRELOAD_SCREENS) loadMore();
    });
  }, [loadMore, bookKey]);

  useLayoutEffect(() => {
    const a = anchor.current;
    const el = scrollRef.current;
    if (!a || !el) return;
    anchor.current = undefined;
    const node = [...el.querySelectorAll<HTMLElement>('.nr-chapter')].find((n) => n.dataset.url === a.url);
    if (node) el.scrollTop += node.getBoundingClientRect().top - a.top;
  }, [stream]);

  // 内容变化后重新检查：章节很短时需要继续加载
  useEffect(onScroll, [stream, status, settings, onScroll]);

  // ---------- 当前章节同步 ----------
  const currentChapter = stream.find((c) => c.url === current);
  useEffect(() => {
    if (!currentChapter) return;
    const { url, title } = currentChapter;
    if (new URL(url).origin === location.origin && location.href !== url) history.replaceState(history.state, '', url);
    document.title = convert ? convert.fn(title) : title;
    setSession((s) => (s.some((i) => i.url === url) ? s : [...s, { url, title }]));
    const updated = updateShelfProgress(bookKey, url, title);
    if (updated) setShelf(updated);
  }, [currentChapter, convert]);

  // ---------- 划选：摘录 / 过滤 ----------
  const addExcerpt = () => {
    if (!selection) return;
    const text = cleanText(selection.text);
    const list = loadExcerpts();
    if (list.some((e) => e.bookKey === bookKey && e.text === text)) {
      showToast('已在摘录中');
    } else {
      const chapter = live.current.stream.find((c) => c.url === selection.chapterUrl);
      const fn = convert?.fn ?? ((s: string) => s);
      saveExcerpts([
        ...list,
        {
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          text,
          book: fn(bookName),
          bookKey,
          chapter: chapter ? fn(chapter.title) : '',
          url: selection.chapterUrl,
          time: Date.now(),
        },
      ]);
      showToast(`已摘录：${text.length > 24 ? `${text.slice(0, 24)}…` : text}`);
    }
    clearSelection();
  };

  const addStrip = () => {
    if (!selection) return;
    const text = selection.text.trim();
    if (/\n/.test(text)) {
      showToast('过滤文字只能在同一段内划选');
      return;
    }
    try {
      const updated = updateSiteStrip(activeSite.id, (list) => (list.includes(text) ? list : [...list, text]));
      setActiveSite(updated);
      setStrip(updated.strip ?? []);
      showToast(`已加入本站过滤：${text}`);
    } catch (e) {
      showToast((e as Error).message);
    }
    clearSelection();
  };

  // ---------- 书架 ----------
  const shelfSource = (chapter: Chapter): ShelfSource => ({
    siteId: activeSite.id,
    host: new URL(chapter.url).hostname.replace(/^www\./, ''),
    bookKey,
    bookUrl: bookInfo.bookUrl,
    lastUrl: chapter.url,
    lastTitle: chapter.title,
    updated: Date.now(),
  });

  const addCurrentToShelf = () => {
    const chapter = currentChapter ?? head;
    if (!chapter) return;
    if (!matchKey) {
      showToast('正在获取书名和作者，请稍候再加入');
      return;
    }
    // 繁体站和简体站的同一本书按简体书名 + 作者合并
    setShelf(addToShelf({ name: bookInfo.name, author: bookInfo.author, matchKey }, shelfSource(chapter)));
    showToast(`已加入书架：${bookInfo.name}`);
  };

  // 从书架/换源跳转过来：显示提示；换源前的书在书架上时，把本站加为它的来源
  const arrived = useRef(false);
  useEffect(() => {
    if (arrival?.toast) showToast(arrival.toast);
  }, []);
  useEffect(() => {
    if (arrived.current || !arrival?.shelfBookId || !head || !infoReady) return;
    arrived.current = true;
    const updated = addShelfSource(arrival.shelfBookId, shelfSource(head));
    if (updated) setShelf(updated);
  }, [head, infoReady]);

  /** 换源：跳到对方站点的对应章节并直接进入阅读模式；没有对应章节时打开书页 */
  const switchSource = (row: SourceRow, match: ChapterMatch) => {
    if (match.kind === 'none') {
      location.href = row.bookUrl;
      return;
    }
    const book = shelf.find((b) => b.sources.some((s) => s.bookKey === bookKey));
    requestAutoOpen(match.url, {
      toast: match.kind === 'index' ? '没有找到标题相同的章节，已按目录序号对应，可能有偏差' : undefined,
      shelfBookId: book?.id,
    });
    location.href = match.url;
  };

  const openShelfSource = (source: ShelfSource) => {
    if (source.bookKey === bookKey) {
      jumpTo(source.lastUrl);
      return;
    }
    // 跳到其他书或其他站点：整页跳转，到达后由入口脚本直接进入阅读模式
    requestAutoOpen(source.lastUrl);
    location.href = source.lastUrl;
  };

  // ---------- 操作 ----------
  const jumpTo = useCallback(
    (url: string) => {
      setPanel('none');
      if (url === live.current.current && live.current.settings.pageMode === 'chapter') return;
      showChapter(url);
    },
    [showChapter],
  );

  const exit = useCallback(() => {
    if (pendingPos.current) saveReadingPosition(bookKey, pendingPos.current);
    onExit(live.current.current);
  }, [bookKey, onExit]);

  const goNext = useCallback(() => {
    const ch = live.current.stream.find((c) => c.url === live.current.current) ?? live.current.stream.at(-1);
    if (ch?.nextUrl) showChapter(ch.nextUrl);
    else showToast('已是最新章节');
  }, [showChapter, showToast]);
  const goPrev = useCallback(() => {
    const ch = live.current.stream.find((c) => c.url === live.current.current) ?? live.current.stream[0];
    if (ch?.prevUrl) showChapter(ch.prevUrl);
    else showToast('没有上一章了');
  }, [showChapter, showToast]);

  const isChapterMode = settings.pageMode === 'chapter';
  useReaderKeys(scrollRef, {
    chapterMode: isChapterMode,
    hasSelection: !!selection && panel === 'none',
    onClearSelection: clearSelection,
    onEscape: () => (panel !== 'none' ? setPanel('none') : exit()),
    onNext: goNext,
    onPrev: goPrev,
    onTogglePanel: (p) => setPanel((cur) => (cur === p ? 'none' : p)),
    onToggleDark: () => updateSettings({ theme: live.current.settings.theme === 'dark' ? lastLightTheme.current : 'dark' }),
    onFontSize: (delta) =>
      updateSettings({ fontSize: Math.max(FONT_SIZE.min, Math.min(FONT_SIZE.max, live.current.settings.fontSize + delta)) }),
  });

  const fn = convert?.fn;
  const sourceChapter = currentChapter ?? head;
  const currentForSource = sourceChapter && {
    title: sourceChapter.title,
    index: fullToc.kind === 'ready' ? fullToc.items.findIndex((i) => i.url === sourceChapter.url) : -1,
  };
  const readTitleSet = useMemo(() => new Set(readTitles), [readTitles]);
  // 整本目录的标题键只算一次；目录面板每次渲染都要对全部章节判断已读
  const tocKeyByUrl = useMemo(() => {
    if (!scripts || fullToc.kind !== 'ready') return undefined;
    const keys = tocTitleKeys(fullToc.items, scripts.hans);
    return new Map(fullToc.items.map((it, i) => [it.url, keys[i]]));
  }, [scripts, fullToc]);
  const isRead = useCallback(
    (item: TocItem) => {
      if (readSet.has(item.url)) return true;
      if (!scripts) return false;
      return readTitleSet.has(tocKeyByUrl?.get(item.url) ?? titleKey(item.title, scripts.hans));
    },
    [readSet, readTitleSet, tocKeyByUrl, scripts],
  );
  const togglePanel = (p: Panel) => setPanel(panel === p ? 'none' : p);

  const tocIndex = useMemo(() => {
    if (fullToc.kind !== 'ready' || !currentChapter) return -1;
    return fullToc.items.findIndex((i) => i.url === currentChapter.url);
  }, [fullToc, currentChapter]);

  return (
    <div class="nr-ui nr-reader" data-theme={settings.theme} style={readerVars(settings)}>
      <div class="nr-progress" ref={progressRef} style="transform:scaleX(0)" />
      <div class="nr-scroll" ref={scrollRef} tabIndex={-1} onScroll={onScroll}>
        <div class="nr-paper">
          {!fn || !stream.length ? (
            <StatusView status={fn ? status : { kind: 'loading' }} full onReadapt={onReadapt} />
          ) : (
            <>
              {stream.map((ch) => (
                <ChapterView
                  key={ch.url}
                  chapter={ch}
                  convert={fn}
                  filters={compiledFilters}
                  strip={strip}
                  replace={compiledReplace}
                  mergeParagraphs={settings.mergeParagraphs !== false}
                />
              ))}
              {isChapterMode ? (
                <div class="nr-pager">
                  <button class="nr-btn" disabled={!head?.prevUrl} onClick={goPrev}>
                    <IconChevronLeft width={18} height={18} />
                    上一章
                  </button>
                  <button class="nr-btn" onClick={() => setPanel('toc')}>
                    <IconList width={18} height={18} />
                    目录
                  </button>
                  <button class="nr-btn is-primary" disabled={!head?.nextUrl} onClick={goNext}>
                    {head?.nextUrl ? '下一章' : '已是最新章节'}
                    <IconChevronRight width={18} height={18} />
                  </button>
                </div>
              ) : (
                <StatusView status={status} />
              )}
            </>
          )}
        </div>
      </div>

      {settings.statusBar !== false && currentChapter && (
        <div class="nr-statusbar">
          <span class="nr-statusbar-title">{fn ? fn(currentChapter.title) : currentChapter.title}</span>
          {fullToc.kind === 'ready' && tocIndex >= 0 && (
            <span>
              {tocIndex + 1} / {fullToc.items.length} ({Math.round(((tocIndex + 1) / fullToc.items.length) * 100)}%)
            </span>
          )}
          <span>{clock}</span>
        </div>
      )}

      {selection && panel === 'none' && (
        <div
          class={`nr-selpop${selection.below ? ' is-below' : ''}`}
          style={{ left: `${selection.x}px`, top: `${selection.y}px` }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button onClick={addExcerpt}>
            <IconBookmark width={16} height={16} />
            摘录
          </button>
          <span class="nr-selpop-sep" />
          <button onClick={addStrip}>
            <IconFilter width={16} height={16} />
            过滤
          </button>
        </div>
      )}

      <nav class="nr-toolbar">
        <button class={`nr-tool${panel === 'toc' ? ' is-active' : ''}`} onClick={() => togglePanel('toc')} title="目录 (T)">
          <IconList />
          目录
        </button>
        <button class={`nr-tool${panel === 'shelf' ? ' is-active' : ''}`} onClick={() => togglePanel('shelf')} title="书架 (B)">
          <IconShelf />
          书架
        </button>
        <button class={`nr-tool${panel === 'source' ? ' is-active' : ''}`} onClick={() => togglePanel('source')} title="换源 (S)">
          <IconSwap />
          换源
        </button>
        <button class={`nr-tool${panel === 'search' ? ' is-active' : ''}`} onClick={() => togglePanel('search')} title="搜书 (F)">
          <IconSearch />
          搜书
        </button>
        <button class={`nr-tool${panel === 'excerpts' ? ' is-active' : ''}`} onClick={() => togglePanel('excerpts')} title="摘录 (E)">
          <IconBookmark />
          摘录
        </button>
        <button class={`nr-tool${panel === 'settings' ? ' is-active' : ''}`} onClick={() => togglePanel('settings')}>
          <IconSliders />
          设置
        </button>
        <button class="nr-tool" onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
          <IconArrowUp />
          顶部
        </button>
        <button class="nr-tool" onClick={exit} title="退出 (Esc)">
          <IconExit />
          退出
        </button>
      </nav>

      {panel !== 'none' && <div class="nr-backdrop" onClick={() => setPanel('none')} />}
      {panel === 'toc' && (
        <TocPanel
          current={current}
          session={session}
          isRead={isRead}
          fullToc={fullToc}
          reloadToc={loadToc}
          convert={fn ?? ((s) => s)}
          onJump={jumpTo}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'shelf' && (
        <ShelfPanel
          shelf={shelf}
          bookKey={bookKey}
          info={bookInfo}
          infoReady={infoReady}
          convert={fn ?? ((s) => s)}
          onAdd={addCurrentToShelf}
          onOpen={openShelfSource}
          onRemove={(id, key) => setShelf(removeShelfSource(id, key))}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'source' && (
        <SourcePanel
          site={activeSite}
          bookKey={bookKey}
          name={bookInfo.name}
          author={bookInfo.author}
          infoReady={infoReady}
          matchKey={matchKey}
          current={currentForSource}
          currentToc={fullToc.kind === 'ready' ? fullToc.items : undefined}
          shelf={shelf}
          hans={scripts?.hans}
          hant={hant?.fn}
          convert={fn ?? ((s) => s)}
          onSwitch={switchSource}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'excerpts' && (
        <ExcerptPanel
          bookKey={bookKey}
          onClose={() => setPanel('none')}
          showToast={showToast}
        />
      )}
      {panel === 'search' && <SearchPanel convert={fn ?? ((s) => s)} onClose={() => setPanel('none')} />}
      {panel === 'settings' && (
        <SettingsPanel
          settings={settings}
          update={updateSettings}
          setPageMode={setPageMode}
          site={activeSite}
          onReadapt={onReadapt}
          onSiteChange={(s) => {
            setActiveSite(s);
            setStrip(s.strip ?? []);
            setSiteFilters(s.filters ?? []);
            setSiteReplace(s.replace ?? []);
          }}
          onImported={reloadStored}
          onClose={() => setPanel('none')}
          showToast={showToast}
        />
      )}
      {toast && <div class="nr-toast">{toast}</div>}
    </div>
  );
}
