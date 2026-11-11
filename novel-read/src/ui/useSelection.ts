import type { RefObject } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';

export interface SelectionInfo {
  text: string;
  chapterUrl: string;
  x: number;
  y: number;
}

/** 读取阅读器 Shadow DOM 内的选区（优先用标准的 getComposedRanges） */
function readSelection(root: ShadowRoot): { text: string; range: Range } | undefined {
  type ComposedSelection = Selection & { getComposedRanges?(o: { shadowRoots: ShadowRoot[] }): StaticRange[] };
  const composed = (document.getSelection() as ComposedSelection | null)?.getComposedRanges?.({ shadowRoots: [root] })[0];
  if (composed) {
    if (composed.collapsed) return undefined;
    const range = document.createRange();
    range.setStart(composed.startContainer, composed.startOffset);
    range.setEnd(composed.endContainer, composed.endOffset);
    return { text: range.toString(), range };
  }
  // 旧版 Chromium 没有 getComposedRanges，只能用非标准的 ShadowRoot.getSelection
  const legacy = (root as ShadowRoot & { getSelection?(): Selection | null }).getSelection?.();
  if (!legacy || legacy.isCollapsed || !legacy.rangeCount) return undefined;
  return { text: legacy.toString(), range: legacy.getRangeAt(0) };
}

/** 跟踪正文里的划选：返回选中的文字、所在章节和浮层位置，以及清除选区的方法 */
export function useSelection(scrollRef: RefObject<HTMLElement>): [SelectionInfo | undefined, () => void] {
  const [selection, setSelection] = useState<SelectionInfo>();

  useEffect(() => {
    let timer = 0;
    // 鼠标拖选过程中不显示浮层：否则向上拖时指针经过浮层会把选区扩到别处
    let dragging = false;
    const update = () => {
      window.clearTimeout(timer);
      if (dragging) return;
      timer = window.setTimeout(() => {
        const el = scrollRef.current;
        const root = el?.getRootNode();
        if (!el || !(root instanceof ShadowRoot)) return;
        const picked = readSelection(root);
        const text = picked?.text.trim();
        const start = picked?.range.startContainer;
        const startEl = start instanceof Element ? start : start?.parentElement;
        const chapterEl = startEl?.closest<HTMLElement>('.nr-chapter');
        if (!picked || !text || !chapterEl || !el.contains(chapterEl)) return setSelection(undefined);
        const rect = picked.range.getBoundingClientRect();
        setSelection({
          text,
          chapterUrl: chapterEl.dataset.url!,
          x: rect.left + rect.width / 2,
          y: rect.top,
        });
      }, 150);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !scrollRef.current || !e.composedPath().includes(scrollRef.current)) return;
      dragging = true;
      setSelection(undefined);
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      update();
    };
    document.addEventListener('selectionchange', update);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('selectionchange', update);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
    };
  }, [scrollRef]);

  const clear = useCallback(() => {
    document.getSelection()?.removeAllRanges();
    setSelection(undefined);
  }, []);

  return [selection, clear];
}
