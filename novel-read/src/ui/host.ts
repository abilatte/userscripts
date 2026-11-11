import { render, type VNode } from 'preact';
import css from './styles.css?inline';

export interface Host {
  container: HTMLElement;
  destroy(): void;
}

/** 在 <html> 下挂一个 Shadow DOM 宿主，隔离站点样式 */
export function mountHost(id: string, vnode: VNode): Host {
  document.getElementById(id)?.remove();
  const host = document.createElement('div');
  host.id = id;
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const container = document.createElement('div');
  shadow.append(style, container);
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
