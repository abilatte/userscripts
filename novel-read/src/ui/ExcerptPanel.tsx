import { GM_setClipboard } from '$';
import { useState } from 'preact/hooks';
import { loadExcerpts, saveExcerpts } from '../storage';
import type { Excerpt } from '../types';
import { IconCheck, IconClose, IconCopy, IconTrash } from './icons';

type CopyFormat = 'numbered' | 'lines' | 'joined';

const FORMATS: { id: CopyFormat; name: string; render(items: Excerpt[]): string }[] = [
  { id: 'numbered', name: '1. 编号', render: (items) => items.map((e, i) => `${i + 1}. ${e.text}`).join('\n') },
  { id: 'lines', name: '每行一条', render: (items) => items.map((e) => e.text).join('\n') },
  { id: 'joined', name: '顿号连接', render: (items) => items.map((e) => e.text).join('、') },
];

interface Props {
  bookKey: string;
  onClose(): void;
  showToast(msg: string): void;
}

function formatTime(t: number): string {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function ExcerptPanel({ bookKey, onClose, showToast }: Props) {
  const [all, setAll] = useState(loadExcerpts);
  const [scope, setScope] = useState<'book' | 'all'>('book');
  const [format, setFormat] = useState<CopyFormat>('numbered');
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const items = scope === 'book' ? all.filter((e) => e.bookKey === bookKey) : all;
  const picked = items.filter((e) => checked.has(e.id));
  const allChecked = items.length > 0 && picked.length === items.length;

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copy = () => {
    // 没勾选时复制当前列表全部
    const target = picked.length ? picked : items;
    GM_setClipboard(FORMATS.find((f) => f.id === format)!.render(target), 'text');
    showToast(`已复制 ${target.length} 条摘录`);
  };

  const remove = (ids: Set<string>) => {
    const next = all.filter((e) => !ids.has(e.id));
    saveExcerpts(next);
    setAll(next);
    setChecked((prev) => new Set([...prev].filter((id) => !ids.has(id))));
  };

  return (
    <section class="nr-panel is-toc">
      <div class="nr-panel-head">
        <h2>摘录</h2>
        <button class="nr-btn is-ghost nr-icon-btn" onClick={onClose} title="关闭">
          <IconClose width={18} height={18} />
        </button>
      </div>
      <div class="nr-panel-sub">
        <div class="nr-segment">
          <button class={scope === 'book' ? 'is-active' : ''} onClick={() => setScope('book')}>
            本书
          </button>
          <button class={scope === 'all' ? 'is-active' : ''} onClick={() => setScope('all')}>
            全部
          </button>
        </div>
        <span class="nr-hint">
          {picked.length ? `已选 ${picked.length} / ` : ''}
          {items.length} 条
        </span>
      </div>
      <div class="nr-panel-body" style="padding:0 10px">
        {!items.length ? (
          <div class="nr-empty">在正文中划选文字，点「摘录」即可保存到这里</div>
        ) : (
          <ul class="nr-excerpts">
            {items.map((e) => (
              <li key={e.id} class={`nr-excerpt${checked.has(e.id) ? ' is-checked' : ''}`} onClick={() => toggle(e.id)}>
                <span class="nr-check">{checked.has(e.id) && <IconCheck width={12} height={12} />}</span>
                <div class="nr-excerpt-main">
                  <div class="nr-excerpt-text">{e.text}</div>
                  <div class="nr-excerpt-meta">
                    {scope === 'all' && `《${e.book}》`}
                    {e.chapter} · {formatTime(e.time)}
                  </div>
                </div>
                <button
                  class="nr-btn is-ghost nr-icon-btn nr-excerpt-del"
                  title="删除"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    remove(new Set([e.id]));
                  }}
                >
                  <IconClose width={14} height={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div class="nr-panel-foot">
        <div class="nr-options is-compact">
          {FORMATS.map((f) => (
            <button key={f.id} class={`nr-btn is-small${format === f.id ? ' is-active' : ''}`} onClick={() => setFormat(f.id)}>
              {f.name}
            </button>
          ))}
        </div>
        <div class="nr-site-actions" style="margin-top:10px">
          <button
            class="nr-btn is-small"
            disabled={!items.length}
            onClick={() => setChecked(allChecked ? new Set() : new Set(items.map((e) => e.id)))}
          >
            {allChecked ? '取消全选' : '全选'}
          </button>
          <button
            class="nr-btn is-small is-ghost is-danger"
            disabled={!picked.length}
            onClick={() => confirm(`删除选中的 ${picked.length} 条摘录？`) && remove(new Set(picked.map((e) => e.id)))}
          >
            <IconTrash width={14} height={14} />
            删除
          </button>
          <span style="flex:1" />
          <button class="nr-btn is-small is-primary" disabled={!items.length} onClick={copy}>
            <IconCopy width={14} height={14} />
            {picked.length ? `复制 ${picked.length} 条` : '复制全部'}
          </button>
        </div>
      </div>
    </section>
  );
}
