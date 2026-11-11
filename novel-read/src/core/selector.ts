const SAFE_IDENT = /^[a-zA-Z][\w-]*$/;
/** 含长数字串的 id/class 往往是每页不同的动态值，不能用于跨页面匹配 */
const DYNAMIC = /\d{3,}/;

/** 为点选的元素生成一个能在同站其他章节页复用的 CSS 选择器 */
export function buildSelector(el: Element): string {
  const doc = el.ownerDocument;
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== doc.body && cur !== doc.documentElement) {
    if (cur.id && SAFE_IDENT.test(cur.id) && !DYNAMIC.test(cur.id)) {
      parts.unshift(`#${cur.id}`);
      break;
    }
    const tag = cur.tagName.toLowerCase();
    const classes = [...cur.classList].filter((c) => SAFE_IDENT.test(c) && !DYNAMIC.test(c)).slice(0, 2);
    let part = classes.length ? `${tag}.${classes.join('.')}` : tag;
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const sameTag = [...parent.children].filter((c) => c.tagName === cur!.tagName);
      if ([...parent.children].filter((c) => c.matches(part)).length > 1) {
        part += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
      }
    }
    parts.unshift(part);
    cur = parent;
  }
  const selector = parts.join(' > ');
  if (doc.querySelector(selector) !== el) throw new Error(`无法为所选元素生成唯一选择器（${selector}）`);
  return selector;
}
