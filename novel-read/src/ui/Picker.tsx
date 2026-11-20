import { useEffect, useMemo, useState } from 'preact/hooks';
import { cleanText, detectContent, extractChapter, findLink, NEXT_TEXT, TOC_TEXT } from '../core/extract';
import { buildSelector } from '../core/selector';
import type { Chapter, LinkLocator, SiteEntry } from '../types';
import { IconClose } from './icons';

type StepId = 'content' | 'next' | 'title' | 'toc' | 'remove';

const STEPS: { id: StepId; title: string; desc: string; optional?: boolean; link?: boolean; multi?: boolean }[] = [
  { id: 'content', title: '点选正文区域', desc: '在页面上点击小说正文所在的区域；选小了可以点「扩大范围」。' },
  { id: 'next', title: '点选「下一章」链接', desc: '点击页面上的下一章按钮（不会跳转）。', link: true },
  { id: 'title', title: '点选章节标题（可跳过）', desc: '不选则自动使用页面的 h1 或网页标题。', optional: true },
  { id: 'toc', title: '点选「目录」链接（可跳过）', desc: '用于在没有目录接口时获取全部章节。', optional: true, link: true },
  { id: 'remove', title: '点选要移除的广告块（可跳过）', desc: '在正文里点选要移除的广告/干扰元素，可连选多个。', optional: true, multi: true },
];

export interface PickerProps {
  site: SiteEntry;
  onSave(entry: SiteEntry): void;
  onCancel(): void;
}

function useRect(el: Element | undefined) {
  const [rect, setRect] = useState<DOMRect>();
  useEffect(() => {
    if (!el) return setRect(undefined);
    const update = () => setRect(el.getBoundingClientRect());
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [el]);
  return rect;
}

function Box({ el, kind, tag }: { el?: Element; kind: 'hover' | 'chosen'; tag?: string }) {
  const r = useRect(el);
  if (!r) return null;
  return (
    <div class={`nr-pick-box is-${kind}`} style={{ top: r.top, left: r.left, width: r.width, height: r.height }}>
      {tag && <span class="nr-pick-tag">{tag}</span>}
    </div>
  );
}

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = [...el.classList].slice(0, 2).map((c) => `.${c}`).join('');
  return `${tag}${id}${cls}`;
}

/** 在原页面上点选正文、下一章等元素，生成站点规则 */
export function Picker({ site, onSave, onCancel }: PickerProps) {
  const [step, setStep] = useState(0);
  const [hover, setHover] = useState<Element>();
  const [picked, setPicked] = useState<Partial<Record<Exclude<StepId, 'remove'>, Element>>>(() => ({
    content: detectContent(document),
    next: findLink(document, undefined, NEXT_TEXT),
    toc: findLink(document, undefined, TOC_TEXT),
  }));
  const [removeEls, setRemoveEls] = useState<Element[]>([]);
  const [error, setError] = useState<string>();

  const current = STEPS[step];
  const previewing = step >= STEPS.length;

  useEffect(() => {
    if (previewing) return;
    const isOurs = (e: Event) => e.composedPath().some((n) => n instanceof Element && n.id === 'nr-picker');
    const target = (e: Event) => {
      const el = e.target as Element;
      return current.link ? el.closest('a') : el;
    };
    const onMove = (e: MouseEvent) => {
      if (isOurs(e)) return setHover(undefined);
      setHover(target(e) ?? undefined);
    };
    const onClick = (e: MouseEvent) => {
      if (isOurs(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const el = target(e);
      if (!el) return setError('请点击一个链接');
      setError(undefined);
      if (current.id === 'remove') {
        setRemoveEls((prev) => (prev.includes(el) ? prev.filter((x) => x !== el) : [...prev, el]));
      } else {
        setPicked((p) => ({ ...p, [current.id]: el }));
      }
    };
    // 阻止站点在按下时触发跳转或其它脚本
    const block = (e: Event) => {
      if (!isOurs(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onClick, true);
    for (const t of ['mousedown', 'mouseup', 'auxclick', 'pointerdown', 'pointerup']) window.addEventListener(t, block, true);
    return () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
      for (const t of ['mousedown', 'mouseup', 'auxclick', 'pointerdown', 'pointerup']) window.removeEventListener(t, block, true);
    };
  }, [step, previewing]);

  const candidate = useMemo((): { entry?: SiteEntry; chapter?: Chapter; error?: string } => {
    if (!previewing) return {};
    try {
      const { content, next, title, toc } = picked;
      if (!content) throw new Error('还没有选择正文区域');
      if (!next) throw new Error('还没有选择下一章链接');
      const linkLocator = (el?: Element): LinkLocator | undefined => {
        if (!el) return undefined;
        const text = cleanText(el.textContent);
        const dup = text ? [...document.querySelectorAll('a')].filter((a) => cleanText(a.textContent) === text).length > 1 : false;
        let selector: string | undefined;
        if (!text || dup) {
          try {
            selector = buildSelector(el);
          } catch (e) {
            if (!text) throw e;
          }
        }
        return { ...(text ? { text } : {}), ...(selector ? { selector } : {}) };
      };
      const removeSelectors = removeEls.flatMap((el) => {
        try {
          return [buildSelector(el)];
        } catch {
          return [];
        }
      });
      const entry: SiteEntry = {
        ...site,
        adapter: undefined,
        freshFirst: undefined,
        chapterPattern: undefined,
        content: buildSelector(content),
        title: title ? buildSelector(title) : undefined,
        next: linkLocator(next),
        prev: undefined,
        tocLink: linkLocator(toc),
        remove: removeSelectors.length ? [...new Set([...(site.remove ?? []), ...removeSelectors])] : site.remove,
      };
      return { entry, chapter: extractChapter(document, entry, location.href) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [previewing, picked, removeEls, site]);

  const chosen = current && current.id !== 'remove' ? picked[current.id] : undefined;
  const expand = () => {
    const parent = chosen?.parentElement;
    if (parent && parent !== document.body && current.id !== 'remove') {
      setPicked((p) => ({ ...p, [current.id]: parent }));
    }
  };

  return (
    <div class="nr-ui" data-theme="white">
      {!previewing && hover && hover !== chosen && <Box el={hover} kind="hover" />}
      {!previewing && chosen && <Box el={chosen} kind="chosen" tag={current.title.replace(/^点选|（可跳过）$/g, '')} />}
      {!previewing && current.id === 'remove' && removeEls.map((el, i) => <Box key={i} el={el} kind="chosen" tag={`移除 ${i + 1}`} />)}
      <div class="nr-pick-bar">
        <div class="nr-pick-steps">
          {[...STEPS, { id: 'preview' }].map((s, i) => (
            <div key={s.id} class={`nr-pick-step${i < step ? ' is-done' : i === step ? ' is-active' : ''}`} />
          ))}
        </div>
        <div style="display:flex;align-items:flex-start;gap:8px">
          <div style="flex:1">
            <div class="nr-pick-title">{previewing ? '预览适配效果' : `${step + 1}. ${current.title}`}</div>
            <div class="nr-pick-desc">
              {previewing ? `站点：${site.name}。确认无误后保存，之后该站章节页会出现「阅读模式」按钮。` : current.desc}
            </div>
          </div>
          <button class="nr-btn is-ghost nr-icon-btn" onClick={onCancel} title="取消适配">
            <IconClose width={18} height={18} />
          </button>
        </div>

        {!previewing && (
          <div class="nr-pick-current">
            {current.id === 'remove' ? (
              removeEls.length ? (
                <div class="nr-strips" style="margin-top:0">
                  {removeEls.map((el, i) => (
                    <span key={i} class="nr-strip">
                      <span>{describe(el)}</span>
                      <button title="移除" onClick={() => setRemoveEls((prev) => prev.filter((x) => x !== el))}>
                        <IconClose width={12} height={12} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                '尚未选择要移除的广告块'
              )
            ) : chosen ? (
              <>
                已选：<code>{describe(chosen)}</code>
                {current.id === 'content' && `（约 ${cleanText(chosen.textContent).length} 字）`}
                {current.link && `「${cleanText(chosen.textContent)}」 → ${(chosen as HTMLAnchorElement).href}`}
              </>
            ) : (
              '尚未选择'
            )}
          </div>
        )}
        {error && <div class="nr-error">{error}</div>}

        {previewing && candidate.error && <div class="nr-error">{candidate.error}</div>}
        {previewing && candidate.chapter && (
          <>
            <div class="nr-preview">
              <h4>{candidate.chapter.title}</h4>
              {candidate.chapter.paragraphs.slice(0, 4).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            <dl class="nr-kv">
              <dt>段落数</dt>
              <dd>{candidate.chapter.paragraphs.length}</dd>
              <dt>下一章</dt>
              <dd>{candidate.chapter.nextUrl ?? '未识别（链接不像章节页）'}</dd>
              <dt>目录页</dt>
              <dd>{candidate.chapter.tocUrl ?? '未指定'}</dd>
              <dt>正文选择器</dt>
              <dd>
                <code>{candidate.entry!.content}</code>
              </dd>
            </dl>
          </>
        )}

        <div class="nr-pick-actions">
          {step > 0 && (
            <button class="nr-btn is-ghost" onClick={() => setStep(step - 1)}>
              上一步
            </button>
          )}
          <span class="nr-spacer" />
          {!previewing && current.id === 'content' && (
            <button class="nr-btn" disabled={!chosen} onClick={expand}>
              扩大范围
            </button>
          )}
          {!previewing && current.optional && (
            <button
              class="nr-btn"
              onClick={() => {
                if (current.id === 'remove') setRemoveEls([]);
                else setPicked((p) => ({ ...p, [current.id]: undefined }));
                setStep(step + 1);
              }}
            >
              跳过
            </button>
          )}
          {!previewing ? (
            <button class="nr-btn is-primary" disabled={!current.optional && !chosen} onClick={() => setStep(step + 1)}>
              下一步
            </button>
          ) : (
            <button class="nr-btn is-primary" disabled={!candidate.entry || !candidate.chapter} onClick={() => onSave(candidate.entry!)}>
              保存并启用
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
