import { GM_xmlhttpRequest } from '$';

/**
 * 站点要求 Cloudflare 人机验证。脚本不能也不应自动通过验证，
 * 需要用户在新标签页打开 verifyUrl 手动完成，浏览器拿到凭证后再重试。
 */
export class ChallengeError extends Error {
  constructor(readonly verifyUrl: string) {
    super('站点要求 Cloudflare 人机验证，请在新标签页完成验证后重试');
    this.name = 'ChallengeError';
  }
}

const CHALLENGE_MARKERS = ['challenge-platform', 'cf-chl-', '<title>Just a moment', 'cf_chl_opt'];
/** 请求超时：fetch 本身没有超时，站点挂住时会一直停在加载中 */
export const REQUEST_TIMEOUT = 20_000;

/** fetch 的 Response 与跨站请求结果的公共部分 */
interface ResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  text(): Promise<string>;
}

export interface HttpResponse extends ResponseLike {
  /** 重定向后的最终地址 */
  url: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  /** application/x-www-form-urlencoded 请求体 */
  body?: string;
  headers?: Record<string, string>;
  referrer?: string;
  signal?: AbortSignal;
}

function looksLikeChallenge(res: ResponseLike, body: string): boolean {
  return res.headers.get('cf-mitigated') === 'challenge' || CHALLENGE_MARKERS.some((m) => body.includes(m));
}

/**
 * 检查响应：Cloudflare 验证页抛 ChallengeError（verifyUrl 为用户需要打开的页面），其余非 2xx 抛普通错误。
 * 只在出错时读取响应体，正常响应原样返回。
 */
export async function ensureOk<T extends ResponseLike>(res: T, verifyUrl: string): Promise<T> {
  if (res.ok && res.headers.get('cf-mitigated') !== 'challenge') return res;
  const body = await res.text().catch(() => '');
  if (looksLikeChallenge(res, body)) throw new ChallengeError(verifyUrl);
  throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
}

function parseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    try {
      headers.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
    } catch {
      // 个别站点会返回不合法的头部名，忽略即可
    }
  }
  return headers;
}

/** 跨站请求走 GM_xmlhttpRequest（需要 @connect），会带上目标站点的 Cookie */
function crossOrigin(url: string, opts: RequestOptions): Promise<HttpResponse> {
  if (opts.signal?.aborted) {
    return Promise.reject(opts.signal.reason ?? new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const mergedHeaders = {
      ...(opts.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(opts.referrer ? { Referer: opts.referrer } : {}),
      ...(opts.headers ?? {}),
    };
    const headers = Object.keys(mergedHeaders).length ? mergedHeaders : undefined;
    let settled = false;
    let task: { abort?: () => void } | void;
    const cleanup = () => opts.signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      try {
        task?.abort?.();
      } catch {
        // 忽略部分脚本管理器在已结束请求上调用 abort 抛出的异常
      }
      reject(opts.signal!.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    task = GM_xmlhttpRequest({
      url,
      method: opts.method ?? 'GET',
      data: opts.body,
      headers,
      responseType: 'arraybuffer',
      timeout: REQUEST_TIMEOUT,
      onload: (r) => {
        if (settled) return;
        settled = true;
        cleanup();
        const buf = r.response as ArrayBuffer;
        resolve({
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          statusText: r.statusText,
          headers: parseHeaders(r.responseHeaders),
          url: r.finalUrl || url,
          arrayBuffer: async () => buf,
          text: async () => new TextDecoder().decode(buf),
        });
      },
      onerror: () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`网络请求失败：${new URL(url).host}（如果 Tampermonkey 弹出跨域确认，请选择允许）`));
      },
      ontimeout: () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`请求超时：${new URL(url).host}`));
      },
    });
  });
}

function withTimeout(signal?: AbortSignal): { signal: AbortSignal; cleanup(): void } {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT);
  if (!signal) return { signal: timeout, cleanup: () => {} };
  if (typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any([signal, timeout]), cleanup: () => {} };
  }
  const ac = new AbortController();
  const onExt = () => ac.abort(signal.reason);
  const onTimeout = () => ac.abort(timeout.reason);
  if (signal.aborted) ac.abort(signal.reason);
  else {
    signal.addEventListener('abort', onExt, { once: true });
    timeout.addEventListener('abort', onTimeout, { once: true });
  }
  return {
    signal: ac.signal,
    cleanup: () => {
      signal.removeEventListener('abort', onExt);
      timeout.removeEventListener('abort', onTimeout);
    },
  };
}

export async function request(url: string, opts: RequestOptions = {}): Promise<HttpResponse> {
  if (new URL(url, location.href).origin !== location.origin) return crossOrigin(url, opts);
  const mergedHeaders = {
    ...(opts.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    ...(opts.headers ?? {}),
  };
  const { signal, cleanup } = withTimeout(opts.signal);
  try {
    return await fetch(url, {
      credentials: 'include',
      method: opts.method ?? 'GET',
      body: opts.body,
      headers: Object.keys(mergedHeaders).length ? mergedHeaders : undefined,
      referrer: opts.referrer,
      signal,
    });
  } catch (e) {
    if (opts.signal?.aborted || (e as Error).name === 'AbortError') throw e;
    if ((e as Error).name === 'TimeoutError') throw new Error(`请求超时：${new URL(url, location.href).host}`);
    throw new Error(`网络请求失败：${(e as Error).message}`);
  } finally {
    cleanup();
  }
}

export interface FetchedPage {
  doc: Document;
  /** 重定向后的最终地址 */
  url: string;
  charset: string;
  /** 解码后的页面源码 */
  html: string;
}

/** 请求页面并按正确编码解码（笔趣阁类站点常见 GBK）；相对链接按最终地址解析 */
export async function fetchPage(url: string, opts: RequestOptions = {}): Promise<FetchedPage> {
  const res = await ensureOk(await request(url, opts), url);
  const buf = await res.arrayBuffer();
  const charset = detectCharset(res.headers.get('content-type'), buf);
  let html: string;
  try {
    html = new TextDecoder(charset).decode(buf);
  } catch {
    throw new Error(`不支持的页面编码：${charset}`);
  }
  // 少数情况下验证页以 200 返回
  if (looksLikeChallenge(res, html.slice(0, 4096))) throw new ChallengeError(url);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const finalUrl = res.url || url;
  const base = doc.createElement('base');
  base.href = finalUrl;
  doc.head.prepend(base);
  return { doc, url: finalUrl, charset, html };
}

export async function fetchDocument(url: string, opts?: RequestOptions): Promise<Document> {
  return (await fetchPage(url, opts)).doc;
}

export function detectCharset(contentType: string | null, buf: ArrayBuffer): string {
  const fromHeader = contentType?.match(/charset=["']?([\w-]+)/i)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const head = new TextDecoder('latin1').decode(buf.slice(0, 4096));
  const fromMeta = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  return (fromMeta ?? 'utf-8').toLowerCase();
}

let gbkTable: Map<string, string> | undefined;

/** 按页面编码对表单值做百分号编码：GBK 站点的搜索词必须用 GBK 编码 */
export function encodeFormValue(value: string, charset: string): string {
  if (!/^(gbk|gb2312|gb18030)$/i.test(charset)) return encodeURIComponent(value);
  // 浏览器没有 GBK 编码器，用单次批量解码反查建表
  if (!gbkTable) {
    gbkTable = new Map();
    const total = (0xfe - 0x81 + 1) * (0xfe - 0x40);
    const buf = new Uint8Array(total * 3);
    const pairs: [number, number][] = [];
    let offset = 0;
    for (let hi = 0x81; hi <= 0xfe; hi++) {
      for (let lo = 0x40; lo <= 0xfe; lo++) {
        if (lo === 0x7f) continue;
        buf[offset++] = hi;
        buf[offset++] = lo;
        buf[offset++] = 0x0a;
        pairs.push([hi, lo]);
      }
    }
    const chars = new TextDecoder('gbk').decode(buf).split('\n');
    for (let i = 0; i < pairs.length; i++) {
      const ch = chars[i];
      if (ch && ch.length === 1 && ch !== '\uFFFD' && !gbkTable.has(ch)) {
        const [hi, lo] = pairs[i];
        gbkTable.set(ch, `%${hi.toString(16).toUpperCase()}%${lo.toString(16).toUpperCase().padStart(2, '0')}`);
      }
    }
  }
  return [...value]
    .map((ch) => {
      if (ch.charCodeAt(0) < 0x80) return encodeURIComponent(ch);
      const code = gbkTable!.get(ch);
      if (!code) throw new Error(`「${ch}」无法用 GBK 编码，该站点搜不了这个书名`);
      return code;
    })
    .join('');
}
