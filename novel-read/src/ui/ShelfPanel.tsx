import type { BookInfo, ShelfBook, ShelfSource } from '../types';
import { IconClose, IconShelf } from './icons';

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
}

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

export function ShelfPanel({ shelf, bookKey, info, infoReady, convert, onAdd, onOpen, onRemove, onClose }: Props) {
  const onShelf = shelf.some((b) => b.sources.some((s) => s.bookKey === bookKey));

  return (
    <section class="nr-panel is-toc">
      <div class="nr-panel-head">
        <h2>书架</h2>
        <button class="nr-btn is-ghost nr-icon-btn" onClick={onClose} title="关闭">
          <IconClose width={18} height={18} />
        </button>
      </div>
      <div class="nr-panel-sub">
        <div class="nr-shelf-current">
          <div class="nr-shelf-name">{convert(info.name)}</div>
          <div class="nr-hint">{info.author ? convert(info.author) : infoReady ? '作者未知' : '正在获取作者…'}</div>
        </div>
        <button class={`nr-btn is-small${onShelf ? '' : ' is-primary'}`} disabled={onShelf} onClick={onAdd}>
          {onShelf ? '已在书架' : '加入书架'}
        </button>
      </div>
      <div class="nr-panel-body" style="padding:0 12px 16px">
        {!shelf.length ? (
          <div class="nr-empty">
            <IconShelf width={28} height={28} style="opacity:.4" />
            <div>书架还是空的，点上方「加入书架」</div>
          </div>
        ) : (
          shelf.map((book) => (
            <div key={book.id} class="nr-shelf-book">
              <div class="nr-shelf-title">
                <span class="nr-shelf-name">{convert(book.name)}</span>
                {book.author && <span class="nr-hint">{convert(book.author)}</span>}
              </div>
              {book.sources.map((s) => (
                <div key={s.bookKey} class={`nr-shelf-source${s.bookKey === bookKey ? ' is-current' : ''}`}>
                  <button class="nr-shelf-open" onClick={() => onOpen(s)} title={`继续阅读：${s.lastUrl}`}>
                    <span class="nr-chip">{s.host}</span>
                    <span class="nr-shelf-last">{convert(s.lastTitle)}</span>
                    <span class="nr-hint">{ago(s.updated)}</span>
                  </button>
                  <button
                    class="nr-btn is-ghost nr-icon-btn nr-shelf-del"
                    title="从书架移除这个站点"
                    onClick={() => confirm(`从书架移除「${book.name}」在 ${s.host} 的来源？`) && onRemove(book.id, s.bookKey)}
                  >
                    <IconClose width={14} height={14} />
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
