import { render, type VNode } from 'preact';
import css from './styles.css?inline';

export interface Host {
  container: HTMLElement;
  destroy(): void;
}

let sharedSheet: CSSStyleSheet | undefined;
function getStyleSheet(): CSSStyleSheet | undefined {
  if (sharedSheet) return sharedSheet;
  try {
    if (typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      sharedSheet = sheet;
      return sheet;
    }
  } catch {
    // 测试或旧环境回退 <style> 标签
  }
  return undefined;
}

const STOP_EVENTS = ['click', 'dblclick', 'mousedown', 'mouseup', 'auxclick', 'pointerdown', 'pointerup', 'contextmenu'] as const;

/** 在 <html> 下挂一个 Shadow DOM 宿主，隔离站点样式并阻止点击冒泡触发原站劫持 */
export function mountHost(id: string, vnode: VNode): Host {
  document.getElementById(id)?.remove();
  const host = document.createElement('div');
  host.id = id;
  for (const type of STOP_EVENTS) {
    host.addEventListener(type, (e) => e.stopPropagation());
  }
  const shadow = host.attachShadow({ mode: 'open' });
  const container = document.createElement('div');
  const sheet = getStyleSheet();
  if (sheet && 'adoptedStyleSheets' in shadow) {
    shadow.adoptedStyleSheets = [sheet];
    shadow.append(container);
  } else {
    const style = document.createElement('style');
    style.textContent = css;
    shadow.append(style, container);
  }
  document.documentElement.append(host);
  render(vnode, container);
  return {
    container,
    destroy() {
      render(null, container);
      host.remove();
    },
  };
}
