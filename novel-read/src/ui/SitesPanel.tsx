import { GM_setClipboard } from '$';
import { useState } from 'preact/hooks';
import {
  createSite,
  importSites,
  loadSites,
  removeSite,
  resetBuiltinSite,
  updateSiteStrip,
  upsertSite,
  validateSite,
} from '../storage';
import type { SiteEntry } from '../types';
import { IconClose } from './icons';

interface Props {
  currentSite: SiteEntry;
  onReadapt(): void;
  onSiteChange(site: SiteEntry): void;
  showToast(msg: string): void;
}

function SiteCard({
  site,
  isCurrent,
  onChange,
  onReadapt,
  showToast,
}: {
  site: SiteEntry;
  isCurrent: boolean;
  onChange(sites: SiteEntry[]): void;
  onReadapt(): void;
  showToast(msg: string): void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();

  const openEditor = () => {
    setDraft(JSON.stringify(site, null, 2));
    setError(undefined);
    setEditing(!editing);
  };

  const save = () => {
    try {
      const entry = validateSite(JSON.parse(draft));
      if (entry.id !== site.id) throw new Error('不能修改 id');
      onChange(upsertSite({ ...entry, builtin: site.builtin }));
      setEditing(false);
      showToast('规则已保存，重新进入阅读模式后生效');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div class={`nr-site${isCurrent ? ' is-current' : ''}`}>
      <div class="nr-site-head">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="nr-site-name">{site.name}</span>
            {isCurrent && <span class="nr-chip is-accent">当前</span>}
            {site.builtin && <span class="nr-chip">内置</span>}
            <span class="nr-chip">{site.content ? '已适配' : '自动识别'}</span>
          </div>
          <div class="nr-site-hosts">{site.hosts.join('、')}</div>
        </div>
        <button
          class={`nr-switch${site.enabled ? ' is-on' : ''}`}
          title={site.enabled ? '已启用' : '已禁用'}
          onClick={() => onChange(upsertSite({ ...site, enabled: !site.enabled }))}
        />
      </div>
      {!!site.strip?.length && (
        <div class="nr-strips" title="划选加入的过滤文字">
          {site.strip.map((word) => (
            <span key={word} class="nr-strip">
              <span>{word}</span>
              <button
                title="移除"
                onClick={() => {
                  updateSiteStrip(site.id, (list) => list.filter((w) => w !== word));
                  onChange(loadSites());
                }}
              >
                <IconClose width={12} height={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div class="nr-site-actions">
        {isCurrent && (
          <button class="nr-btn is-small" onClick={onReadapt}>
            重新适配本站
          </button>
        )}
        <button class={`nr-btn is-small${editing ? ' is-active' : ''}`} onClick={openEditor}>
          编辑规则
        </button>
        {site.builtin ? (
          <button
            class="nr-btn is-small is-ghost"
            onClick={() => {
              onChange(resetBuiltinSite(site.id));
              showToast(`${site.name} 已恢复默认规则`);
            }}
          >
            恢复默认
          </button>
        ) : (
          <button
            class="nr-btn is-small is-ghost is-danger"
            onClick={() => {
              if (confirm(`确定删除站点「${site.name}」及其适配规则？`)) onChange(removeSite(site.id));
            }}
          >
            删除
          </button>
        )}
      </div>
      {editing && (
        <div class="nr-site-editor">
          <textarea class="nr-textarea" value={draft} onInput={(e) => setDraft(e.currentTarget.value)} spellcheck={false} />
          {error && <div class="nr-error">{error}</div>}
          <div class="nr-site-actions" style="justify-content:flex-end">
            <button class="nr-btn is-small is-ghost" onClick={() => setEditing(false)}>
              取消
            </button>
            <button class="nr-btn is-small is-primary" onClick={save}>
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function SitesPanel({ currentSite, onReadapt, onSiteChange, showToast }: Props) {
  const [sites, setSitesState] = useState(loadSites);
  const setSites = (next: SiteEntry[]) => {
    setSitesState(next);
    const cur = next.find((s) => s.id === currentSite.id);
    if (cur) onSiteChange(cur);
  };
  const [input, setInput] = useState('');
  const [error, setError] = useState<string>();
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');

  const add = () => {
    try {
      const entry = createSite(input);
      setSites(loadSites());
      setInput('');
      setError(undefined);
      showToast(`已添加 ${entry.hosts[0]}，打开该站章节页即可使用`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const exportAll = () => {
    GM_setClipboard(JSON.stringify(sites, null, 2), 'text');
    showToast(`已复制 ${sites.length} 个站点规则到剪贴板`);
  };

  const doImport = () => {
    try {
      const parsed = JSON.parse(importText);
      const incoming = (Array.isArray(parsed) ? parsed : [parsed]).map(validateSite);
      setSites(importSites(incoming));
      setImporting(false);
      setImportText('');
      setError(undefined);
      showToast(`已导入 ${incoming.length} 个站点规则`);
    } catch (e) {
      setError(`导入失败：${(e as Error).message}`);
    }
  };

  return (
    <>
      {/* 用表单提交处理回车：阅读器在捕获阶段拦截了所有按键事件 */}
      <form
        class="nr-add-row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          class="nr-input"
          placeholder="输入网址或域名，例如 www.example.com"
          value={input}
          onInput={(e) => setInput(e.currentTarget.value)}
        />
        <button type="submit" class="nr-btn is-primary" disabled={!input.trim()}>
          添加
        </button>
      </form>
      {error && <div class="nr-error" style="margin:-6px 0 12px">{error}</div>}
      {sites.map((site) => (
        <SiteCard
          key={site.id}
          site={site}
          isCurrent={site.id === currentSite.id}
          onChange={setSites}
          onReadapt={onReadapt}
          showToast={showToast}
        />
      ))}
      <div class="nr-site-actions" style="margin-top:4px">
        <button class="nr-btn is-small" onClick={exportAll}>
          导出全部规则
        </button>
        <button class={`nr-btn is-small${importing ? ' is-active' : ''}`} onClick={() => setImporting(!importing)}>
          导入规则
        </button>
      </div>
      {importing && (
        <div class="nr-site-editor">
          <textarea
            class="nr-textarea"
            placeholder="粘贴导出的 JSON（单个站点对象或数组）"
            value={importText}
            onInput={(e) => setImportText(e.currentTarget.value)}
            spellcheck={false}
          />
          <div class="nr-site-actions" style="justify-content:flex-end">
            <button class="nr-btn is-small is-primary" onClick={doImport} disabled={!importText.trim()}>
              导入
            </button>
          </div>
        </div>
      )}
      <p class="nr-hint" style="margin:14px 0 0">
        在列表中的站点上，识别到章节页时右下角会出现「阅读模式」按钮；未适配的站点识别失败时会出现「适配本站」按钮。
      </p>
    </>
  );
}
