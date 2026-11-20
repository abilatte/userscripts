import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createLoader } from '../core/loader';
import { getConverter } from '../core/opencc';
import { inspectBook, matchChapter } from '../core/source';
import { loadFullToc } from '../core/toc';
import { formatAgo, loadSites } from '../storage';
import type { BookInfo, ShelfBook, ShelfSource, TocItem } from '../types';
import { IconClose, IconRefresh, IconShelf } from './icons';

interface Props {
  shelf: ShelfBook[];
  bookKey: string;
  info: BookInfo;
  /** 书名、作者是否已从书页确认（否则只是从网页标题猜的） */
  infoReady: boolean;
  convert(s: string): string;
  onAdd(): void;
  onOpen(source: ShelfSource): void;
  onRemove(bookId: string, bookKey: string): void;
  onClose(): void;
  standalone?: boolean;
  tabs?: ComponentChildren;
}

type UpdateState =
  | { status: 'loading' }
  | { status: 'done'; latest: string; unread?: number }
  | { status: 'error'; message: string };

export function ShelfPanel({
  shelf,
  bookKey,
  info,
  infoReady,
  convert,
  onAdd,
  onOpen,
  onRemove,
  onClose,
  standalone,
  tabs,
}: Props) {
  const onShelf = !standalone && shelf.some((b) => b.sources.some((s) => s.bookKey === bookKey));
  const [checking, setChecking] = useState(false);
  const [updates, setUpdates] = useState<Record<string, UpdateState>>({});
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const sorted = useMemo(
    () =>
      [...shelf].sort(
        (a, b) =>
          Math.max(...b.sources.map((s) => s.updated), b.added) -
          Math.max(...a.sources.map((s) => s.updated), a.added),
      ),
    [shelf],
  );

  const checkUpdates = async () => {
    if (checking || !shelf.length) return;
    setChecking(true);
    const sites = loadSites();
    const hans = await getConverter('hans').catch(() => (s: string) => s);
    const tasks = shelf.flatMap((b) => b.sources);
    setUpdates(Object.fromEntries(tasks.map((s) => [s.bookKey, { status: 'loading' }])));

    let cursor = 0;
    const worker = async () => {
      while (alive.current && cursor < tasks.length) {
        const src = tasks[cursor++];
        try {
          const site = sites.find((x) => x.id === src.siteId);
          if (!site) throw new Error('站点不存在');
          let toc: TocItem[];
          if (src.bookUrl) {
            toc = (await inspectBook(site, src.bookUrl)).toc;
          } else if (site.toc?.api) {
            toc = await loadFullToc(site, src.lastUrl, undefined);
          } else {
            const ch = await createLoader(site).load(src.lastUrl);
            if (ch.bookUrl) toc = (await inspectBook(site, ch.bookUrl)).toc;
            else toc = await loadFullToc(site, src.lastUrl, ch.tocUrl);
          }
          let idx = toc.findIndex((it) => it.url === src.lastUrl);
          if (idx < 0 && src.lastTitle) {
            const m = matchChapter(src.lastTitle, -1, toc, hans);
            if (m.kind === 'title') idx = toc.findIndex((it) => it.url === m.url);
          }
          const unread = idx >= 0 ? Math.max(0, toc.length - 1 - idx) : undefined;
          const latest = toc.at(-1)?.title ?? '';
          if (alive.current) setUpdates((prev) => ({ ...prev, [src.bookKey]: { status: 'done', latest, unread } }));
        } catch (e) {
          if (alive.current) {
            setUpdates((prev) => ({ ...prev, [src.bookKey]: { status: 'error', message: (e as Error).message } }));
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, tasks.length) }, worker));
    if (alive.current) setChecking(false);
  };

  return (
    <section class="nr-panel is-toc" role="dialog" aria-label="书架">
      <div class="nr-panel-head">
        {tabs ?? <h2>书架</h2>}
        <div style="display:flex;align-items:center;gap:6px">
          {!!shelf.length && (
            <button class="nr-btn is-small" disabled={checking} onClick={checkUpdates} title="检查书架书籍是否有新章节">
              <IconRefresh width={14} height={14} />
              {checking ? '检查中…' : '检查更新'}
            </button>
          )}
          <button class="nr-btn is-ghost nr-icon-btn" onClick={onClose} title="关闭">
            <IconClose width={18} height={18} />
          </button>
        </div>
      </div>
      {!standalone && (
        <div class="nr-panel-sub">
          <div class="nr-shelf-current">
            <div class="nr-shelf-name">{convert(info.name)}</div>
            <div class="nr-hint">{info.author ? convert(info.author) : infoReady ? '作者未知' : '正在获取作者…'}</div>
          </div>
          <button class={`nr-btn is-small${onShelf ? '' : ' is-primary'}`} disabled={onShelf} onClick={onAdd}>
            {onShelf ? '已在书架' : '加入书架'}
          </button>
        </div>
      )}
      <div class="nr-panel-body" style="padding:0 12px 16px">
        {!sorted.length ? (
          <div class="nr-empty">
            <IconShelf width={28} height={28} style="opacity:.4" />
            <div>{standalone ? '书架还是空的，可在阅读页面点「加入书架」' : '书架还是空的，点上方「加入书架」'}</div>
          </div>
        ) : (
          sorted.map((book) => (
            <div key={book.id} class="nr-shelf-book">
              <div class="nr-shelf-title">
                <span class="nr-shelf-name">{convert(book.name)}</span>
                {book.author && <span class="nr-hint">{convert(book.author)}</span>}
              </div>
              {book.sources.map((s) => {
                const up = updates[s.bookKey];
                return (
                  <div key={s.bookKey} class={`nr-shelf-source${s.bookKey === bookKey ? ' is-current' : ''}`}>
                    <button class="nr-shelf-open" onClick={() => onOpen(s)} title={`继续阅读：${s.lastUrl}`}>
                      <span class="nr-chip">{s.host}</span>
                      <span class="nr-shelf-last">{convert(s.lastTitle)}</span>
                      {up?.status === 'loading' && <span class="nr-hint">检查中</span>}
                      {up?.status === 'done' && (
                        <span
                          class={`nr-chip${up.unread ? ' is-accent' : ''}`}
                          title={up.latest ? `最新：${convert(up.latest)}` : undefined}
                        >
                          {up.unread ? `+${up.unread}章` : up.unread === 0 ? '已最新' : convert(up.latest)}
                        </span>
                      )}
                      {up?.status === 'error' && (
                        <span class="nr-chip is-warn" title={up.message}>
                          失败
                        </span>
                      )}
                      {!up && <span class="nr-hint">{formatAgo(s.updated)}</span>}
                    </button>
                    <button
                      class="nr-btn is-ghost nr-icon-btn nr-shelf-del"
                      title="从书架移除这个站点"
                      onClick={() => confirm(`从书架移除「${book.name}」在 ${s.host} 的来源？`) && onRemove(book.id, s.bookKey)}
                    >
                      <IconClose width={14} height={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
