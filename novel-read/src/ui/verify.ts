/** 在新标签页打开验证页；用户完成验证切回本页时自动重试一次 */
export function openVerify(url: string, retry: () => void) {
  window.open(url, '_blank', 'noopener');
  const onBack = () => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', onBack);
    retry();
  };
  document.addEventListener('visibilitychange', onBack);
}
