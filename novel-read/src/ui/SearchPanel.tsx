import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ChallengeError } from '../core/fetcher';
import { loadFirstChapter } from '../core/firstChapter';
import { getConverter } from '../core/opencc';
import { findBooks, RateLimitError, type BookSearchHit } from '../core/source';
import { BOOK_SEARCH } from '../sites/builtin';
import { loadSites, requestAutoOpen } from '../storage';
import type { SiteEntry } from '../types';
import { IconClose, IconExternal } from './icons';
import { openVerify } from './verify';

type Result =
  | { kind: 'loading' }
  | { kind: 'done'; books: BookSearchHit[] }
  | { kind: 'error'; message: string; verifyUrl?: string };

function SearchBookRow({ site, book, convert }: { site: SiteEntry; book: BookSearchHit; convert(s: string): string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; verifyUrl?: string }>();
  const start = async () => {
    if (loading) return;
    // 必须在点击事件内打开标签页，找到首章后的异步导航才不会被弹窗拦截。
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      setError({ message: '浏览器拦截了新标签页，请允许弹窗后重试' });
      return;
    }
    tab.opener = null;
    tab.document.title = '正在查找第一章…';
    tab.document.body.textContent = '正在查找第一章…';
    setLoading(true);
    setError(undefined);
    try {
      const url = await loadFirstChapter(site, book.bookUrl);
      if (tab.closed) return;
      requestAutoOpen(url);
      tab.location.replace(url);
    } catch (e) {
      tab.close();
      setError({ message: (e as Error).message, verifyUrl: e instanceof ChallengeError ? e.verifyUrl : undefined });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="nr-search-book">
      <div class="nr-search-book-row">
        <a class="nr-search-book-link" href={book.bookUrl} title="打开书页" target="_blank" rel="noopener noreferrer">
          <span>{convert(book.name)}{book.author && <small>{convert(book.author)}</small>}</span>
          <IconExternal width={14} height={14} />
        </a>
        <button class="nr-btn is-primary is-small" onClick={start} disabled={loading}>
          {loading ? '查找首章…' : '开始阅读'}
        </button>
      </div>
      {error && (
        <p class="nr-hint" role="status">
          {error.message}
          {error.verifyUrl && (
            <>
              {' '}
              ·{' '}
              <button class="nr-btn is-ghost is-small" onClick={() => openVerify(error.verifyUrl!, () => void start())}>
                打开验证
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}

export function SearchPanel({
  convert,
  onClose,
  tabs,
}: {
  convert(s: string): string;
  onClose(): void;
  tabs?: ComponentChildren;
}) {
  const [sites] = useState(() => loadSites().filter((site) => site.enabled && (Object.hasOwn(BOOK_SEARCH, site.id) || !!site.search)));
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Record<string, Result>>({});
  const active = useRef<AbortController>();

  useEffect(() => () => active.current?.abort(), []);

  const run = async (site: SiteEntry, keyword: string, signal: AbortSignal) => {
    const update = (result: Result) => {
      if (!signal.aborted) setResults((prev) => ({ ...prev, [site.id]: result }));
    };
    update({ kind: 'loading' });
    try {
      const config = BOOK_SEARCH[site.id];
      const identity = (s: string) => s;
      const scriptMode = site.search?.script ?? config?.script ?? 'hans';
      const [hans, native] = await Promise.all([
        getConverter('hans').catch(() => identity),
        getConverter(scriptMode).catch(() => identity),
      ]);
      signal.throwIfAborted();
      const searchCfg = site.search ?? config?.search;
      if (!searchCfg) throw new Error('站点未配置搜索规则');
      const searchable = { ...site, search: searchCfg };
      const bookPath = config?.bookPath ?? (site.search?.bookPath ? new RegExp(site.search.bookPath) : /^\/.+/);
      let books: BookSearchHit[] = [];
      for (const term of new Set([native(keyword), keyword])) {
        books = await findBooks(searchable, term, bookPath, hans, signal);
        if (books.length) break;
      }
      update({ kind: 'done', books });
    } catch (e) {
      update({
        kind: 'error',
        message: e instanceof RateLimitError ? '搜索过于频繁，请稍后重试' : (e as Error).message,
        verifyUrl: e instanceof ChallengeError ? `${new URL(e.verifyUrl).origin}/` : undefined,
      });
    }
  };

  return (
    <section class="nr-panel" role="dialog" aria-label="搜书">
      <div class="nr-panel-head">
        {tabs ?? <h2>搜书</h2>}
        <button class="nr-btn is-ghost nr-icon-btn" onClick={onClose} title="关闭">
          <IconClose width={18} height={18} />
        </button>
      </div>
      <form
        class="nr-panel-sub nr-book-search"
        onSubmit={(e) => {
          e.preventDefault();
          const keyword = input.trim();
          if (!keyword || !sites.length || (keyword === query && sites.some((s) => results[s.id]?.kind === 'loading'))) return;
          active.current?.abort();
          const controller = new AbortController();
          active.current = controller;
          setQuery(keyword);
          setResults({});
          sites.forEach((site) => void run(site, keyword, controller.signal));
        }}
      >
        <input
          class="nr-input"
          type="search"
          aria-label="书名"
          placeholder="输入书名"
          value={input}
          onInput={(e) => setInput(e.currentTarget.value)}
        />
        <button class="nr-btn is-primary" type="submit" disabled={!input.trim() || !sites.length}>搜索</button>
      </form>
      <div class="nr-panel-body">
        {!query && <p class="nr-hint">{sites.length ? `同时搜索：${sites.map((s) => s.name).join('、')}` : '请先在设置 → 站点中启用内置书源。'}</p>}
        {query && sites.map((site) => {
          const result = results[site.id];
          if (!result) return null;
          return (
            <section class="nr-search-group" key={site.id} aria-live="polite">
              <h3>{site.name}</h3>
              {result.kind === 'loading' && <p class="nr-hint">搜索中…</p>}
              {result.kind === 'error' && (
                <>
                  <p class="nr-hint">{result.message}</p>
                  {result.verifyUrl && (
                    <button
                      class="nr-btn is-small is-primary"
                      onClick={() => openVerify(result.verifyUrl!, () => active.current && void run(site, query, active.current.signal))}
                    >
                      打开验证
                    </button>
                  )}
                  <button class="nr-btn is-small" onClick={() => active.current && void run(site, query, active.current.signal)}>重试</button>
                </>
              )}
              {result.kind === 'done' && (result.books.length ? result.books.map((book) => (
                <SearchBookRow key={book.bookUrl} site={site} book={book} convert={convert} />
              )) : <p class="nr-hint">未找到相关书籍，试试完整书名。</p>)}
            </section>
          );
        })}
      </div>
    </section>
  );
}
