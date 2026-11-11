import type { BookInfo, SiteEntry } from '../types';
import { cleanText } from './extract';
import { fetchDocument } from './fetcher';

/**
 * 从书页读取书名、作者：书名取站点规则 → og:novel:book_name → og:title → h1，
 * 作者取站点规则 → og:novel:author（去掉「作者：」前缀）
 */
export function parseBookInfo(doc: Document, site: SiteEntry): { name: string; author?: string } {
  const meta = (p: string) => cleanText(doc.querySelector(`meta[property="${p}"]`)?.getAttribute('content'));
  const text = (sel?: string) => (sel ? cleanText(doc.querySelector(sel)?.textContent) : '');
  const name = text(site.book?.name) || meta('og:novel:book_name') || meta('og:title') || text('h1');
  const author = (text(site.book?.author) || meta('og:novel:author')).replace(/^作者[:：]\s*/, '');
  return { name, author: author || undefined };
}

/** 依次尝试书页候选地址 */
export async function fetchBookInfo(candidates: string[], site: SiteEntry): Promise<BookInfo> {
  const errors: string[] = [];
  for (const url of [...new Set(candidates)]) {
    try {
      const { name, author } = parseBookInfo(await fetchDocument(url), site);
      if (name) return { name, author, bookUrl: url };
      errors.push(`${url}：页面里没有书名`);
    } catch (e) {
      errors.push(`${url}：${(e as Error).message}`);
    }
  }
  throw new Error(errors.length ? errors.join('；') : '没有可用的书页地址');
}
