import { cleanText, extractParagraphs, isChapterUrl } from '../core/extract';
import { ensureOk, fetchDocument, REQUEST_TIMEOUT } from '../core/fetcher';
import type { Chapter, SiteEntry } from '../types';

/** 规则表达不了的站点（正文走带 token 的接口、前端分页等）用代码加载章节 */
export interface SiteAdapter {
  load(url: string, site: SiteEntry): Promise<Chapter>;
}

/**
 * deqixss.com：章节页 HTML 不含正文。
 * 正文 = /scripts/chapter.js.php 取 token → /modules/article/ajax2.php（GBK JSON，需 XHR 头）；
 * 页面上的"下一页"是前端分页，上/下一章地址写在内联脚本 loadChapter() 里。
 */
const DEQIXSS_SPAM = [
  /更新不易.+?(看最新章节|看最新无错章节|最新小说章节)！/g,
  /最后一批邀请码1900人发放，官方反馈群1104270100/g,
  /看最新完整章節，就上速讀谷/g,
  /本章节未完.+?请订阅/g,
  /速.?读.?谷|速 读 谷|shudugu\.org/g,
];

const deqixss: SiteAdapter = {
  async load(url, site) {
    const m = new URL(url).pathname.match(/^\/books\/(\d+)\/(\d+)\.html$/);
    if (!m) throw new Error(`不是章节地址：${url}`);
    const [, aid, cid] = m;

    const doc = await fetchDocument(url);
    const html = doc.documentElement.innerHTML;
    const title = cleanText(doc.querySelector('h1')?.textContent).replace(/[（(]第[\d/]*页[)）]$/, '').trim();
    const linkIn = (branch: RegExp) => html.match(branch)?.[1] || undefined;
    const prev = linkIn(/direction === 'prev'\) \{\s*chapterUrl = '([^']*)'/);
    const next = linkIn(/\} else \{\s*chapterUrl = '([^']*)'/);
    const toc = doc.querySelector('.page-index')?.getAttribute('data-href');

    // 服务端校验 Referer 必须是 token 对应的章节页
    const tokenRes = await fetch(`/scripts/chapter.js.php?aid=${aid}&cid=${cid}&referrer=${encodeURIComponent(url)}`, {
      referrer: url,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    const tokenJs = await (await ensureOk(tokenRes, url)).text();
    const value = (name: string) => {
      const v = tokenJs.match(new RegExp(`var ${name} = '?([^';]+)'?;`))?.[1];
      if (!v) throw new Error(`章节 token 中缺少 ${name}`);
      return v;
    };
    const query = new URLSearchParams({
      aid,
      cid,
      token: value('chapterToken'),
      timestamp: value('timestamp'),
      nonce: value('nonce'),
    });
    const res = await fetch(`/modules/article/ajax2.php?${query}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      referrer: url,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    await ensureOk(res, url);
    const json = JSON.parse(new TextDecoder('gbk').decode(await res.arrayBuffer()));
    if (json.status !== 1 || !json.data?.content) throw new Error(`获取正文失败：${json.message ?? '未知错误'}`);

    // 接口正文里夹带的推广语是嵌在段落中的，按站点自己的规则整句删除而不是丢弃整段
    const raw = DEQIXSS_SPAM.reduce((s: string, re) => s.replace(re, ''), json.data.content);
    const content = new DOMParser().parseFromString(`<div>${raw}</div>`, 'text/html').body.firstElementChild!;
    const paragraphs = extractParagraphs(content, site, title);
    if (!paragraphs.length) throw new Error('正文清洗后为空');
    const chapter = (u?: string) => (u && u !== '#' && isChapterUrl(site, u, url) ? new URL(u, url).href : undefined);
    return {
      url,
      title,
      paragraphs,
      nextUrl: chapter(next),
      prevUrl: chapter(prev),
      tocUrl: toc ? new URL(toc, url).href : undefined,
      // 目录页同时也是书页
      bookUrl: toc ? new URL(toc, url).href : undefined,
    };
  },
};

export const ADAPTERS: Record<string, SiteAdapter> = { deqixss };

export function getAdapter(id: string): SiteAdapter {
  const adapter = ADAPTERS[id];
  if (!adapter) throw new Error(`未知的站点适配器：${id}`);
  return adapter;
}
