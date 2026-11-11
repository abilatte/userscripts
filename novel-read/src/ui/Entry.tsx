import { IconBook, IconClose, IconWand } from './icons';

export interface EntryProps {
  kind: 'read' | 'adapt';
  onClick(): void;
  onDismiss(): void;
}

export function Entry({ kind, onClick, onDismiss }: EntryProps) {
  return (
    <div class="nr-ui nr-entry" data-theme="dark">
      <button class="nr-entry-main" onClick={onClick} title={kind === 'read' ? '进入阅读模式' : '点选正文和下一章来适配本站'}>
        {kind === 'read' ? <IconBook width={18} height={18} /> : <IconWand width={18} height={18} />}
        {kind === 'read' ? '阅读模式' : '适配本站'}
      </button>
      <button class="nr-entry-close" onClick={onDismiss} title="本页隐藏">
        <IconClose />
      </button>
    </div>
  );
}
