import { useEffect, useState } from 'preact/hooks';
import { getConverter } from '../core/opencc';
import { loadSettings, loadShelf, removeShelfSource, requestAutoOpen } from '../storage';
import type { ShelfBook, ShelfSource } from '../types';
import { SearchPanel } from './SearchPanel';
import { ShelfPanel } from './ShelfPanel';

export function QuickHub({ onClose }: { onClose(): void }) {
  const [tab, setTab] = useState<'shelf' | 'search'>('shelf');
  const [shelf, setShelf] = useState<ShelfBook[]>(loadShelf);
  const [settings] = useState(loadSettings);
  const [convert, setConvert] = useState<{ fn: (s: string) => string }>({ fn: (s) => s });

  useEffect(() => {
    let alive = true;
    getConverter(settings.script).then(
      (fn) => alive && setConvert({ fn }),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [settings.script]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const tabs = (
    <div class="nr-segment">
      <button class={tab === 'shelf' ? 'is-active' : ''} onClick={() => setTab('shelf')}>
        书架
      </button>
      <button class={tab === 'search' ? 'is-active' : ''} onClick={() => setTab('search')}>
        搜书
      </button>
    </div>
  );

  const openSource = (source: ShelfSource) => {
    requestAutoOpen(source.lastUrl);
    location.href = source.lastUrl;
  };

  return (
    <div class="nr-ui" data-theme={settings.theme} style="--pw:640px">
      <div class="nr-backdrop" style="background:rgba(0,0,0,.35)" onClick={onClose} />
      {tab === 'shelf' ? (
        <ShelfPanel
          standalone
          tabs={tabs}
          shelf={shelf}
          bookKey=""
          info={{ name: '' }}
          infoReady
          convert={convert.fn}
          onAdd={() => {}}
          onOpen={openSource}
          onRemove={(id, key) => setShelf(removeShelfSource(id, key))}
          onClose={onClose}
        />
      ) : (
        <SearchPanel tabs={tabs} convert={convert.fn} onClose={onClose} />
      )}
    </div>
  );
}
