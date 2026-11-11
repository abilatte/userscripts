import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { Settings, SiteEntry } from '../types';
import { IconCheck, IconClose, IconMoon } from './icons';
import {
  FONT_SIZE,
  FONTS,
  LINE_HEIGHTS,
  PAGE_MODES,
  PARAGRAPH_SPACINGS,
  SCRIPT_MODES,
  THEMES,
  WIDTHS,
} from './options';
import { DataPanel } from './DataPanel';
import { FiltersPanel } from './FiltersPanel';
import { SitesPanel } from './SitesPanel';

interface Props {
  settings: Settings;
  update(patch: Partial<Settings>): void;
  setPageMode(mode: Settings['pageMode']): void;
  site: SiteEntry;
  onReadapt(): void;
  /** 当前站点规则被修改（例如删除过滤文字）时通知阅读器 */
  onSiteChange(site: SiteEntry): void;
  onImported(): void;
  onClose(): void;
  showToast(msg: string): void;
}

function Row({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="nr-row">
      <span class="nr-row-label">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function Options<T>({
  items,
  value,
  onChange,
  label,
  compact,
}: {
  items: T[];
  value: T;
  onChange(v: T): void;
  label(v: T): string;
  compact?: boolean;
}) {
  return (
    <div class={`nr-options${compact ? ' is-compact' : ''}`}>
      {items.map((it) => (
        <button key={String(it)} class={`nr-btn${it === value ? ' is-active' : ''}`} onClick={() => onChange(it)}>
          {label(it)}
        </button>
      ))}
    </div>
  );
}

export function SettingsPanel({
  settings: s,
  update,
  setPageMode,
  site,
  onReadapt,
  onSiteChange,
  onImported,
  onClose,
  showToast,
}: Props) {
  const [tab, setTab] = useState<'read' | 'filters' | 'sites' | 'data'>('read');

  return (
    <section class="nr-panel">
      <div class="nr-panel-head">
        <h2>设置</h2>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="nr-segment">
            <button class={tab === 'read' ? 'is-active' : ''} onClick={() => setTab('read')}>
              阅读
            </button>
            <button class={tab === 'filters' ? 'is-active' : ''} onClick={() => setTab('filters')}>
              过滤
            </button>
            <button class={tab === 'sites' ? 'is-active' : ''} onClick={() => setTab('sites')}>
              站点
            </button>
            <button class={tab === 'data' ? 'is-active' : ''} onClick={() => setTab('data')}>
              数据
            </button>
          </div>
          <button class="nr-btn is-ghost nr-icon-btn" onClick={onClose} title="关闭">
            <IconClose width={18} height={18} />
          </button>
        </div>
      </div>
      <div class="nr-panel-body">
        {tab === 'read' && (
          <>
            <Row label="阅读主题">
              <div class="nr-swatches">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    class={`nr-swatch${s.theme === t.id ? ' is-active' : ''}`}
                    data-swatch={t.id}
                    style={{ background: t.swatch }}
                    title={t.name}
                    onClick={() => update({ theme: t.id })}
                  >
                    {s.theme === t.id ? (
                      <IconCheck width={18} height={18} />
                    ) : (
                      t.id === 'dark' && <IconMoon width={16} height={16} style="color:#888" />
                    )}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="正文字体">
              <div class="nr-options">
                {FONTS.map((f) => (
                  <button
                    key={f.id}
                    class={`nr-btn${s.font === f.id ? ' is-active' : ''}`}
                    style={{ fontFamily: f.stack }}
                    onClick={() => update({ font: f.id })}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="字体大小">
              <div class="nr-stepper">
                <button
                  disabled={s.fontSize <= FONT_SIZE.min}
                  onClick={() => update({ fontSize: s.fontSize - FONT_SIZE.step })}
                >
                  A-
                </button>
                <span>{s.fontSize}</span>
                <button
                  disabled={s.fontSize >= FONT_SIZE.max}
                  onClick={() => update({ fontSize: s.fontSize + FONT_SIZE.step })}
                >
                  A+
                </button>
              </div>
            </Row>
            <Row label="页面宽度">
              <Options
                compact
                items={WIDTHS}
                value={s.width}
                onChange={(width) => update({ width })}
                label={(w) => (w ? String(w) : '自动')}
              />
            </Row>
            <Row label="行间距">
              <Options
                items={LINE_HEIGHTS}
                value={s.lineHeight}
                onChange={(lineHeight) => update({ lineHeight })}
                label={(v) => v.toFixed(1)}
              />
            </Row>
            <Row label="段间距">
              <Options
                items={PARAGRAPH_SPACINGS}
                value={s.paragraphSpacing}
                onChange={(paragraphSpacing) => update({ paragraphSpacing })}
                label={(v) => `${v}em`}
              />
            </Row>
            <Row label="翻页模式">
              <Options
                items={PAGE_MODES.map((m) => m.id)}
                value={s.pageMode}
                onChange={setPageMode}
                label={(id) => PAGE_MODES.find((m) => m.id === id)!.name}
              />
            </Row>
            <Row label="简繁">
              <Options
                items={SCRIPT_MODES.map((m) => m.id)}
                value={s.script}
                onChange={(script) => update({ script })}
                label={(id) => SCRIPT_MODES.find((m) => m.id === id)!.name}
              />
            </Row>
          </>
        )}
        {tab === 'filters' && <FiltersPanel site={site} onSiteChange={onSiteChange} showToast={showToast} />}
        {tab === 'sites' && (
          <SitesPanel currentSite={site} onReadapt={onReadapt} onSiteChange={onSiteChange} showToast={showToast} />
        )}
        {tab === 'data' && <DataPanel onImported={onImported} showToast={showToast} />}
      </div>
    </section>
  );
}
