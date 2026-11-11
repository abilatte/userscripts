import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TocItem } from '../types';
import { IconClose, IconLocate, IconRefresh } from './icons';

export type FullTocState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; items: TocItem[] }
  | { kind: 'error'; message: string };

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

export function TocPanel({ current, session, isRead, fullToc, reloadToc, convert, onJump, onClose }: Props) {
  const [tab, setTab] = useState<'session' | 'full'>('session');
  const listRef = useRef<HTMLUListElement>(null);

  const items = tab === 'session' ? session : fullToc.kind === 'ready' ? fullToc.items : [];
  // 长篇有几千章：已读判断和标题转换只在数据变化时算一次，不随每次渲染重算
  const rows = useMemo(() => items.map((it) => ({ it, title: convert(it.title), read: isRead(it) })), [items, convert, isRead]);
  const readCount = useMemo(
    () => (fullToc.kind === 'ready' ? fullToc.items.filter(isRead).length : 0),
    [fullToc, isRead],
  );

  const locate = (behavior: ScrollBehavior = 'smooth') => {
    const el = listRef.current?.querySelector<HTMLElement>('.is-current');
    el?.scrollIntoView({ block: 'center', behavior });
  };
  useEffect(() => locate('auto'), [tab, fullToc.kind]);

  return (
    <section class="nr-panel is-toc">
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
      <div class="nr-panel-body" style="padding:0">
        {tab === 'full' && (fullToc.kind === 'loading' || fullToc.kind === 'idle') && (
          <div class="nr-status">
            <div class="nr-spinner" />
            <span>正在获取完整目录…</span>
          </div>
        )}
        {tab === 'full' && fullToc.kind === 'error' && (
          <div class="nr-status">
            <div class="nr-status-title">目录获取失败</div>
            <div class="nr-status-msg">{fullToc.message}</div>
            <button class="nr-btn is-primary" onClick={reloadToc}>
              <IconRefresh width={16} height={16} />
              点击重试
            </button>
          </div>
        )}
        {tab === 'session' && !session.length && <div class="nr-empty">还没有阅读记录</div>}
        {!!items.length && (
          <ul class="nr-toc-list" ref={listRef}>
            {rows.map(({ it, title, read }) => {
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
