let activeHandler: (() => void) | undefined;

/** 在新标签页打开验证页；用户完成验证切回本页时自动重试一次，返回取消监听函数 */
export function openVerify(url: string, retry: () => void): () => void {
  if (activeHandler) {
    document.removeEventListener('visibilitychange', activeHandler);
    activeHandler = undefined;
  }
  const win = window.open(url, '_blank', 'noopener');
  if (!win) return () => {};
  const onBack = () => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', onBack);
    if (activeHandler === onBack) activeHandler = undefined;
    retry();
  };
  activeHandler = onBack;
  document.addEventListener('visibilitychange', onBack);
  return () => {
    document.removeEventListener('visibilitychange', onBack);
    if (activeHandler === onBack) activeHandler = undefined;
  };
}
