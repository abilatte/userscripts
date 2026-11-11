import type { RefObject } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export interface ReaderKeyHandlers {
  /** 是否为章节翻页模式：左右方向键只在这个模式下翻章 */
  chapterMode: boolean;
  /** Esc：关闭面板或退出阅读模式 */
  onEscape(): void;
  onNext(): void;
  onPrev(): void;
  onTogglePanel(panel: 'toc' | 'source'): void;
}

/** 阅读器键盘操作；在捕获阶段拦截全部按键事件，避免触发站点自身的快捷键 */
export function useReaderKeys(scrollRef: RefObject<HTMLElement>, handlers: ReaderKeyHandlers): void {
  // 监听只注册一次，回调始终取最近一次渲染的
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.type !== 'keydown') return;
      const h = latest.current;
      const origin = e.composedPath()[0] as HTMLElement | undefined;
      const typing = !!origin && /^(INPUT|TEXTAREA|SELECT)$/.test(origin.tagName);
      if (e.key === 'Escape') {
        e.preventDefault();
        if (typing) origin!.blur();
        else h.onEscape();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = scrollRef.current;
      if (!el) return;
      const page = el.clientHeight * 0.9;
      const scroll = (top: number) => {
        e.preventDefault();
        el.scrollBy({ top, behavior: 'smooth' });
      };
      switch (e.key) {
        case ' ':
          return scroll(e.shiftKey ? -page : page);
        case 'PageDown':
          return scroll(page);
        case 'PageUp':
          return scroll(-page);
        case 'ArrowDown':
          return scroll(80);
        case 'ArrowUp':
          return scroll(-80);
        case 'Home':
          e.preventDefault();
          return el.scrollTo({ top: 0, behavior: 'smooth' });
        case 'End':
          e.preventDefault();
          return el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        case 'ArrowRight':
          if (h.chapterMode) {
            e.preventDefault();
            h.onNext();
          }
          return;
        case 'ArrowLeft':
          if (h.chapterMode) {
            e.preventDefault();
            h.onPrev();
          }
          return;
        case 't':
        case 'T':
          e.preventDefault();
          return h.onTogglePanel('toc');
        case 's':
        case 'S':
          e.preventDefault();
          return h.onTogglePanel('source');
      }
    };
    const types = ['keydown', 'keyup', 'keypress'] as const;
    types.forEach((t) => window.addEventListener(t, onKey, true));
    scrollRef.current?.focus();
    return () => types.forEach((t) => window.removeEventListener(t, onKey, true));
  }, [scrollRef]);
}
