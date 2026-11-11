import { useRef, useState } from 'preact/hooks';
import {
  BACKUP_CATEGORIES,
  type BackupCategory,
  type BackupFile,
  type BackupSummary,
  collectBackup,
  currentSummary,
  downloadBackup,
  importBackup,
  parseBackup,
  summarize,
} from '../backup';
import { IconCheck, IconDownload, IconUpload } from './icons';

interface Props {
  /** 导入完成后让阅读器重新读取设置、书架、过滤规则等 */
  onImported(): void;
  showToast(msg: string): void;
}

function describe(id: BackupCategory, s: BackupSummary): string {
  switch (id) {
    case 'settings':
      return s.settings ? '已自定义' : '默认';
    case 'sites':
      return `${s.sites} 个站点`;
    case 'reading':
      return `书架 ${s.books} 本 · 已读 ${s.readChapters} 章`;
    case 'excerpts':
      return `${s.excerpts} 条`;
  }
}

function hasCategory(file: BackupFile, id: BackupCategory): boolean {
  const d = file.data;
  switch (id) {
    case 'settings':
      return !!d.settings;
    case 'sites':
      return !!d.sites;
    case 'reading':
      return !!(d.shelf || d.read || d.readTitles || d.bookInfo);
    case 'excerpts':
      return !!d.excerpts;
  }
}

function CategoryList({
  items,
  checked,
  onToggle,
  summary,
}: {
  items: typeof BACKUP_CATEGORIES;
  checked: Set<BackupCategory>;
  onToggle(id: BackupCategory): void;
  summary: BackupSummary;
}) {
  return (
    <ul class="nr-data-list">
      {items.map((c) => (
        <li key={c.id} class={checked.has(c.id) ? 'is-checked' : ''} onClick={() => onToggle(c.id)}>
          <span class="nr-check">{checked.has(c.id) && <IconCheck width={12} height={12} />}</span>
          <div class="nr-data-main">
            <div class="nr-data-name">
              {c.name}
              <span class="nr-chip">{describe(c.id, summary)}</span>
            </div>
            <div class="nr-hint">{c.desc}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

const toggled = (set: Set<BackupCategory>, id: BackupCategory) => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

export function DataPanel({ onImported, showToast }: Props) {
  const [summary, setSummary] = useState(currentSummary);
  const [exportSel, setExportSel] = useState(() => new Set(BACKUP_CATEGORIES.map((c) => c.id)));
  const [pending, setPending] = useState<{ file: BackupFile; name: string }>();
  const [importSel, setImportSel] = useState<Set<BackupCategory>>(new Set());
  const [error, setError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  const doExport = () => {
    const name = downloadBackup(collectBackup([...exportSel]));
    showToast(`已导出 ${name}`);
  };

  const pickFile = async (input: HTMLInputElement) => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    setError(undefined);
    try {
      const file = parseBackup(await f.text());
      setPending({ file, name: f.name });
      setImportSel(new Set(BACKUP_CATEGORIES.filter((c) => hasCategory(file, c.id)).map((c) => c.id)));
    } catch (e) {
      setPending(undefined);
      setError(`${f.name}：${(e as Error).message}`);
    }
  };

  const doImport = () => {
    if (!pending) return;
    const d = pending.file.data;
    const has = (c: BackupCategory) => importSel.has(c);
    importBackup({
      settings: has('settings') ? d.settings : undefined,
      sites: has('sites') ? d.sites : undefined,
      shelf: has('reading') ? d.shelf : undefined,
      read: has('reading') ? d.read : undefined,
      bookInfo: has('reading') ? d.bookInfo : undefined,
      readTitles: has('reading') ? d.readTitles : undefined,
      excerpts: has('excerpts') ? d.excerpts : undefined,
    });
    setPending(undefined);
    setSummary(currentSummary());
    onImported();
    showToast('导入完成');
  };

  return (
    <>
      <section class="nr-filter-section">
        <div class="nr-filter-title">导出</div>
        <p class="nr-hint">导出为 JSON 文件，可在其它浏览器或重装脚本后导入。</p>
        <CategoryList
          items={BACKUP_CATEGORIES}
          checked={exportSel}
          onToggle={(id) => setExportSel((s) => toggled(s, id))}
          summary={summary}
        />
        <div class="nr-site-actions">
          <button class="nr-btn is-primary" disabled={!exportSel.size} onClick={doExport}>
            <IconDownload width={16} height={16} />
            导出文件
          </button>
        </div>
      </section>

      <section class="nr-filter-section">
        <div class="nr-filter-title">导入</div>
        <p class="nr-hint">
          与本机数据合并，不会删除已有内容：设置和同名站点规则以文件为准，书架按书合并并保留较新的进度，已读章节和摘录取并集。
        </p>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => pickFile(e.currentTarget)}
        />
        {pending ? (
          <>
            <div class="nr-data-file">
              <span class="nr-filter-text">{pending.name}</span>
              <span class="nr-hint">导出于 {new Date(pending.file.exportedAt).toLocaleString()}</span>
            </div>
            <CategoryList
              items={BACKUP_CATEGORIES.filter((c) => hasCategory(pending.file, c.id))}
              checked={importSel}
              onToggle={(id) => setImportSel((s) => toggled(s, id))}
              summary={summarize(pending.file.data)}
            />
            <div class="nr-site-actions">
              <button class="nr-btn is-primary" disabled={!importSel.size} onClick={doImport}>
                导入所选
              </button>
              <button class="nr-btn" onClick={() => setPending(undefined)}>
                取消
              </button>
            </div>
          </>
        ) : (
          <div class="nr-site-actions">
            <button class="nr-btn" onClick={() => fileInput.current?.click()}>
              <IconUpload width={16} height={16} />
              选择备份文件
            </button>
          </div>
        )}
        {error && <div class="nr-error">{error}</div>}
      </section>
    </>
  );
}
