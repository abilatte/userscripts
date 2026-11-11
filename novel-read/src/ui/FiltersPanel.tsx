import { useState } from 'preact/hooks';
import { COMMON_FILTERS } from '../core/extract';
import { BUILTIN_SITES } from '../sites/builtin';
import { loadSites, updateSiteFilters, updateSiteStrip } from '../storage';
import type { SiteEntry } from '../types';
import { IconClose } from './icons';

interface Props {
  site: SiteEntry;
  onSiteChange(site: SiteEntry): void;
  showToast(msg: string): void;
}

function AddForm({ placeholder, onAdd }: { placeholder: string; onAdd(value: string): string | undefined }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  return (
    <>
      {/* 用表单提交处理回车：阅读器在捕获阶段拦截了所有按键事件 */}
      <form
        class="nr-add-row"
        style="margin:8px 0 0"
        onSubmit={(e) => {
          e.preventDefault();
          const err = onAdd(value.trim());
          setError(err);
          if (!err) setValue('');
        }}
      >
        <input class="nr-input" placeholder={placeholder} value={value} onInput={(e) => setValue(e.currentTarget.value)} />
        <button type="submit" class="nr-btn" disabled={!value.trim()}>
          添加
        </button>
      </form>
      {error && <div class="nr-error">{error}</div>}
    </>
  );
}

export function FiltersPanel({ site, onSiteChange, showToast }: Props) {
  const [entry, setEntry] = useState(() => loadSites().find((s) => s.id === site.id));
  const builtinFilters = BUILTIN_SITES.find((b) => b.id === site.id)?.filters ?? [];

  const apply = (updated: SiteEntry) => {
    setEntry(updated);
    onSiteChange(updated);
  };

  const addFilter = (pattern: string) => {
    try {
      new RegExp(pattern);
    } catch {
      return `不是合法的正则表达式：${pattern}`;
    }
    if (entry?.filters?.includes(pattern)) return '这条规则已存在';
    apply(updateSiteFilters(site.id, (list) => [...list, pattern]));
    showToast('已添加站点规则');
    return undefined;
  };

  const addStrip = (text: string) => {
    if (entry?.strip?.includes(text)) return '这段文字已在列表中';
    apply(updateSiteStrip(site.id, (list) => [...list, text]));
    showToast('已添加过滤文字');
    return undefined;
  };

  return (
    <>
      <section class="nr-filter-section">
        <div class="nr-filter-title">
          系统规则<span class="nr-chip">所有站点 · 只读</span>
        </div>
        <p class="nr-hint">命中则整段删除。匹配前会把花体字母（𝕥𝕨𝕜𝕒𝕟、🆃🆆🅺🅰🅽、t̴w̴k̴a̴n̴ 等）还原成普通字母。</p>
        <ul class="nr-filter-list">
          {COMMON_FILTERS.map((f) => (
            <li key={f.pattern}>
              <code>{f.pattern}</code>
              <span class="nr-hint">{f.desc}</span>
            </li>
          ))}
        </ul>
      </section>

      {!entry ? (
        <div class="nr-error">本站还不在阅读站点列表中，先在「站点」里添加后才能设置本站的过滤规则。</div>
      ) : (
        <>
          <section class="nr-filter-section">
            <div class="nr-filter-title">
              站点规则<span class="nr-chip">{entry.name}</span>
            </div>
            <p class="nr-hint">正则表达式，命中则整段删除，适合整行的广告。</p>
            {entry.filters?.length ? (
              <ul class="nr-filter-list">
                {entry.filters.map((f) => (
                  <li key={f}>
                    <code>{f}</code>
                    {builtinFilters.includes(f) && <span class="nr-chip">内置</span>}
                    <button
                      class="nr-btn is-ghost nr-icon-btn nr-filter-del"
                      title="删除"
                      onClick={() => apply(updateSiteFilters(site.id, (list) => list.filter((x) => x !== f)))}
                    >
                      <IconClose width={14} height={14} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div class="nr-hint nr-filter-empty">暂无</div>
            )}
            <AddForm placeholder="正则，例如 追.*就上.*小说网" onAdd={addFilter} />
          </section>

          <section class="nr-filter-section">
            <div class="nr-filter-title">
              划选过滤文字<span class="nr-chip">{entry.name}</span>
            </div>
            <p class="nr-hint">按原样匹配显示出来的文字，只删除这段文字本身；删完为空的段落整段去掉。在正文中划选后点「过滤」即可添加。</p>
            {entry.strip?.length ? (
              <ul class="nr-filter-list">
                {entry.strip.map((w) => (
                  <li key={w}>
                    <span class="nr-filter-text">{w}</span>
                    <button
                      class="nr-btn is-ghost nr-icon-btn nr-filter-del"
                      title="删除"
                      onClick={() => apply(updateSiteStrip(site.id, (list) => list.filter((x) => x !== w)))}
                    >
                      <IconClose width={14} height={14} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div class="nr-hint nr-filter-empty">暂无</div>
            )}
            <AddForm placeholder="要删除的文字" onAdd={addStrip} />
          </section>
        </>
      )}
    </>
  );
}
