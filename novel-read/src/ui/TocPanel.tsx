import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TocItem } from '../types';
import { IconClose, IconLocate, IconRefresh } from './icons';
import { openVerify } from './verify';

export type FullTocState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; items: TocItem[] }
  | { kind: 'error'; message: string; verifyUrl?: string };

interface Props {
  current: string;
  session: TocItem[];
  /** 是否已读完：本站按地址记录，或其它站点读过同名章节 */
  isRead(item: TocItem): boolean;
  fullToc: FullTocState;
  reloadToc(): void;
  convert(s: string): string;
  onJump(url: string): void;
  onClose(): void;
}

const ROW_HEIGHT = 38;
const VIRTUAL_THRESHOLD = 200;
const OVERSCAN = 15;

export function TocPanel({ current, session, isRead, fullToc, reloadToc, convert, onJump, onClose }: Props) {
  const [tab, setTab] = useState<'session' | 'full'>('session');
  const [search, setSearch] = useState('');
  const [reversed, setReversed] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const bodyRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const items = tab === 'session' ? session : fullToc.kind === 'ready' ? fullToc.items : [];
  // 标题简繁转换与已读状态分开缓存，翻章标记已读时不重跑几千章的 OpenCC 转换
  const converted = useMemo(() => items.map((it) => ({ it, title: convert(it.title) })), [items, convert]);
  const rows = useMemo(() => converted.map((r) => ({ ...r, read: isRead(r.it) })), [converted, isRead]);
  const displayRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => r.title.toLowerCase().includes(q) || r.it.title.toLowerCase().includes(q)) : rows;
    return reversed ? [...filtered].reverse() : filtered;
  }, [rows, search, reversed]);

  const readCount = useMemo(
    () => (fullToc.kind === 'ready' ? fullToc.items.filter(isRead).length : 0),
    [fullToc, isRead],
  );

  const virtual = displayRows.length > VIRTUAL_THRESHOLD;
  const start = virtual ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
  const visibleCount = virtual ? Math.ceil((viewportH || 600) / ROW_HEIGHT) + OVERSCAN * 2 : displayRows.length;
  const end = virtual ? Math.min(displayRows.length, start + visibleCount) : displayRows.length;
  const visibleRows = virtual ? displayRows.slice(start, end) : displayRows;
  const padTop = virtual ? start * ROW_HEIGHT : 0;
  const padBottom = virtual ? (displayRows.length - end) * ROW_HEIGHT : 0;

  const locate = (behavior: ScrollBehavior = 'smooth') => {
    if (virtual) {
      const idx = displayRows.findIndex((r) => r.it.url === current);
      const body = bodyRef.current;
      if (idx >= 0 && body) {
        const top = Math.max(0, idx * ROW_HEIGHT - body.clientHeight / 2 + ROW_HEIGHT / 2);
        body.scrollTo({ top, behavior });
        setScrollTop(top);
      }
      return;
    }
    const el = listRef.current?.querySelector<HTMLElement>('.is-current');
    el?.scrollIntoView({ block: 'center', behavior });
  };

  useEffect(() => {
    if (bodyRef.current) setViewportH(bodyRef.current.clientHeight || 600);
    locate('auto');
  }, [tab, fullToc.kind]);

  return (
    <section class="nr-panel is-toc" role="dialog" aria-label="目录">
      <div class="nr-panel-head">
        <h2>目录</h2>
        <button class="nr-btn is-ghost nr-icon-btn" onClick={onClose} title="关闭">
          <IconClose width={18} height={18} />
        </button>
      </div>
      <div class="nr-panel-sub">
        <div class="nr-segment">
          <button class={tab === 'session' ? 'is-active' : ''} onClick={() => setTab('session')}>
            本次阅读
          </button>
          <button class={tab === 'full' ? 'is-active' : ''} onClick={() => setTab('full')}>
            全部章节
          </button>
        </div>
        <span class="nr-hint">
          {tab === 'session'
            ? `${session.length} 章`
            : fullToc.kind === 'ready'
              ? `已读 ${readCount} / ${fullToc.items.length}`
              : ''}
          <button class="nr-btn is-ghost nr-icon-btn" onClick={() => locate()} title="定位当前章节" style="vertical-align:middle">
            <IconLocate width={16} height={16} />
          </button>
        </span>
      </div>
      {!!items.length && (
        <div class="nr-toc-tools">
          <input
            class="nr-input"
            type="search"
            placeholder="筛选章节…"
            value={search}
            onInput={(e) => {
              setSearch(e.currentTarget.value);
              bodyRef.current?.scrollTo({ top: 0 });
              setScrollTop(0);
            }}
          />
          <button
            class={`nr-btn is-small${reversed ? ' is-active' : ''}`}
            onClick={() => {
              setReversed((r) => !r);
              bodyRef.current?.scrollTo({ top: 0 });
              setScrollTop(0);
            }}
            title="切换正序/倒序"
          >
            {reversed ? '倒序' : '正序'}
          </button>
        </div>
      )}
      <div
        class="nr-panel-body"
        style="padding:0"
        ref={bodyRef}
        onScroll={(e) => {
          if (virtual) setScrollTop(e.currentTarget.scrollTop);
        }}
      >
        {tab === 'full' && (fullToc.kind === 'loading' || fullToc.kind === 'idle') && (
          <div class="nr-status">
            <div class="nr-spinner" />
            <span>正在获取完整目录…</span>
          </div>
        )}
        {tab === 'full' && fullToc.kind === 'error' && (
          <div class="nr-status">
            <div class="nr-status-title">{fullToc.verifyUrl ? '需要人机验证' : '目录获取失败'}</div>
            <div class="nr-status-msg">{fullToc.message}</div>
            <div style="display:flex;gap:8px">
              {fullToc.verifyUrl && (
                <button class="nr-btn is-primary" onClick={() => openVerify(fullToc.verifyUrl!, reloadToc)}>
                  打开验证页面
                </button>
              )}
              <button class={`nr-btn${fullToc.verifyUrl ? '' : ' is-primary'}`} onClick={reloadToc}>
                <IconRefresh width={16} height={16} />
                {fullToc.verifyUrl ? '已完成，重试' : '点击重试'}
              </button>
            </div>
          </div>
        )}
        {tab === 'session' && !session.length && <div class="nr-empty">还没有阅读记录</div>}
        {!!items.length && !displayRows.length && <div class="nr-empty">没有匹配的章节</div>}
        {!!displayRows.length && (
          <ul
            class="nr-toc-list"
            ref={listRef}
            style={virtual ? { paddingTop: `${padTop}px`, paddingBottom: `${padBottom + 16}px` } : undefined}
          >
            {visibleRows.map(({ it, title, read }) => {
              const cls = it.url === current ? ' is-current' : tab === 'full' && read ? ' is-read' : '';
              return (
                <li key={it.url}>
                  <button class={`nr-toc-item${cls}`} onClick={() => onJump(it.url)} title={title}>
                    <span class="nr-toc-title">{title}</span>
                    {tab === 'full' && read && <span class="nr-toc-badge">已读</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
