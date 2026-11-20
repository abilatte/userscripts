// ==UserScript==
// @name         小说阅读模式
// @namespace    novel-reader
// @version      0.2.1
// @author       Abilatte
// @description  在第三方小说站提供起点风格的阅读模式：滚动/章节翻页、目录、简繁转换、站点点选适配
// @homepageURL  https://github.com/abilatte/userscripts
// @downloadURL  https://raw.githubusercontent.com/abilatte/userscripts/main/novel-read/dist/novel-reader.user.js
// @updateURL    https://raw.githubusercontent.com/abilatte/userscripts/main/novel-read/dist/novel-reader.user.js
// @match        *://*/*
// @resource     opencc-cn2t  https://cdn.jsdelivr.net/npm/opencc-js@1.4.2/dist/umd/cn2t.js
// @resource     opencc-t2cn  https://cdn.jsdelivr.net/npm/opencc-js@1.4.2/dist/umd/t2cn.js
// @connect      twkan.com
// @connect      deqixss.com
// @connect      sudugu.cc
// @connect      *
// @grant        GM_addStyle
// @grant        GM_addValueChangeListener
// @grant        GM_deleteValue
// @grant        GM_getResourceText
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        GM_removeValueChangeListener
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// @noframes
// ==/UserScript==

(function() {
	"use strict";
	var _GM_addStyle = (() => typeof GM_addStyle != "undefined" ? GM_addStyle : void 0)();
	var _GM_addValueChangeListener = (() => typeof GM_addValueChangeListener != "undefined" ? GM_addValueChangeListener : void 0)();
	var _GM_deleteValue = (() => typeof GM_deleteValue != "undefined" ? GM_deleteValue : void 0)();
	var _GM_getResourceText = (() => typeof GM_getResourceText != "undefined" ? GM_getResourceText : void 0)();
	var _GM_getValue = (() => typeof GM_getValue != "undefined" ? GM_getValue : void 0)();
	var _GM_listValues = (() => typeof GM_listValues != "undefined" ? GM_listValues : void 0)();
	var _GM_registerMenuCommand = (() => typeof GM_registerMenuCommand != "undefined" ? GM_registerMenuCommand : void 0)();
	var _GM_removeValueChangeListener = (() => typeof GM_removeValueChangeListener != "undefined" ? GM_removeValueChangeListener : void 0)();
	var _GM_setClipboard = (() => typeof GM_setClipboard != "undefined" ? GM_setClipboard : void 0)();
	var _GM_setValue = (() => typeof GM_setValue != "undefined" ? GM_setValue : void 0)();
	var _GM_xmlhttpRequest = (() => typeof GM_xmlhttpRequest != "undefined" ? GM_xmlhttpRequest : void 0)();
	var NEXT_TEXT = /^[\s[【<«‹]*(下一[章页頁节節回]|下[章页頁])[\s\]】>»›→]*$/;
	var PREV_TEXT = /^[\s[【<«‹←]*(上一[章页頁节節回]|上[章页頁])[\s\]】>»›]*$/;
	var BOOK_TEXT = /^[\s[【]*(返回)?(书页|書頁|书籍详情|書籍詳情|小说详情|小說詳情|详情|詳情|简介|簡介)[\s\]】]*$/;
	var TOC_TEXT = /^[\s[【]*(返回)?(章[节節])?目[录錄](列表)?[\s\]】]*$/;
	var COMMON_FILTERS = [
		{
			pattern: "^[（(]?本章完[)）]?$",
			desc: "章节结尾的「(本章完)」"
		},
		{
			pattern: "全[网網]首[发發]",
			desc: "「全网首发」水印"
		},
		{
			pattern: "首[发發]域名",
			desc: "「首发域名」推广"
		},
		{
			pattern: "最新章[节節].*(请|請)?(访问|訪問|阅读|閱讀)",
			desc: "「最新章节请访问…」"
		},
		{
			pattern: "(手机|手機)(版|用户|用戶).*(阅读|閱讀|访问|訪問)",
			desc: "「手机版阅读…」"
		},
		{
			pattern: "(请|請)(记住|記住|收藏)本(书|書|站)",
			desc: "「请记住本书/本站…」"
		},
		{
			pattern: "天才一秒(记住|記住)",
			desc: "「天才一秒记住…」"
		},
		{
			pattern: "(记住|記住|认准|認準).{0,12}(域名|网址|網址)",
			desc: "「记住本站域名 / 网址」"
		}
	];
	var COMMON_FILTER_REGEXES = COMMON_FILTERS.map((c) => new RegExp(c.pattern, "i"));
	var MIN_CONTENT_LENGTH = 100;
	function cleanText(s) {
		return (s ?? "").replace(/[\s　 ]+/g, " ").trim();
	}
	function detectContent(doc) {
		if (!doc.body) return void 0;
		let best;
		let bestScore = 0;
		for (const el of doc.body.querySelectorAll("div, article, section, td, main")) {
			let score = 0;
			for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE) score += cleanText(node.textContent).length;
			else if (node instanceof Element && node.tagName === "P") score += cleanText(node.textContent).length;
			if (score > bestScore) {
				bestScore = score;
				best = el;
			}
		}
		return bestScore >= MIN_CONTENT_LENGTH ? best : void 0;
	}
	function isUsableHref(a) {
		const raw = a.getAttribute("href");
		return !!raw && !raw.startsWith("javascript:") && !raw.startsWith("#");
	}
	function findLink(doc, locator, fallback) {
		const anchors = (locator?.selector ? [...doc.querySelectorAll(locator.selector)] : doc.body ? [doc.body] : []).flatMap((s) => s instanceof HTMLAnchorElement ? [s] : [...s.querySelectorAll("a")]);
		const match = (a) => locator?.text ? cleanText(a.textContent) === locator.text : fallback.test(cleanText(a.textContent));
		return anchors.find((a) => isUsableHref(a) && match(a));
	}
	function findContent(doc, site) {
		if (!site.content) return detectContent(doc);
		const el = doc.querySelector(site.content);
		return el && cleanText(el.textContent).length >= MIN_CONTENT_LENGTH ? el : void 0;
	}
	function detectPage(doc, site, url) {
		if (site.chapterPattern && !new RegExp(site.chapterPattern).test(new URL(url).pathname)) return void 0;
		if (site.adapter) {
			if (!site.chapterPattern) throw new Error(`${site.name}：使用 adapter 时必须配置 chapterPattern`);
			return { content: doc.body };
		}
		const content = findContent(doc, site);
		if (!content) return void 0;
		const next = findLink(doc, site.next, NEXT_TEXT);
		if (!site.content && !next) return void 0;
		return {
			content,
			next
		};
	}
	function urlShape(url) {
		const u = new URL(url);
		return u.host + u.pathname.replace(/\d+/g, "#").replace(/[_-]#/g, "");
	}
	function isChapterUrl(site, url, currentUrl) {
		if (site.chapterPattern) return new RegExp(site.chapterPattern).test(new URL(url).pathname);
		return urlShape(url) === urlShape(currentUrl);
	}
	function titleText(el) {
		if (!el) return "";
		const full = cleanText(el.textContent);
		if (!el.querySelector("a")) return full;
		const clone = el.cloneNode(true);
		clone.querySelectorAll("a").forEach((a) => a.remove());
		return cleanText(clone.textContent).replace(/^[\s>›»/|－—-]+/, "") || full;
	}
	function extractTitle(doc, site, content) {
		const fromRule = site.title ? titleText(doc.querySelector(site.title)) : "";
		if (fromRule) return fromRule;
		const h1 = titleText(doc.querySelector("h1"));
		if (h1) return h1;
		const inContent = cleanText(content.querySelector("h1, h2, h3")?.textContent);
		if (inContent) return inContent;
		return cleanText(doc.title.split(/[-_|｜–—－]/)[0]);
	}
	function compileFilters(site) {
		return [...COMMON_FILTER_REGEXES, ...(site.filters ?? []).map((f) => {
			try {
				return new RegExp(f, "i");
			} catch {
				throw new Error(`段落过滤正则无效：${f}`);
			}
		})];
	}
	var LOOKALIKE_MAP = new Map(Object.entries({
		a: "аɑα",
		b: "ЬьƅɓВв",
		c: "сϲςƈ",
		d: "ԁժɗ",
		e: "еєεҽɛ",
		g: "ցɡǥ",
		h: "һհɦ",
		i: "іɩι",
		j: "јʝ",
		k: "кκҟҝҡƙ",
		l: "ӏɭ",
		m: "мʍɱ",
		n: "ղոռηпɲŋ",
		o: "оօοσөɵ",
		p: "рρþƥ",
		q: "ԛզ",
		r: "гɾʀ",
		s: "ѕʂ",
		t: "тτէƫʈ",
		u: "սυμц",
		v: "νѵʋ",
		w: "աѡԝωɯ",
		x: "хχ",
		y: "уүγʏ",
		z: "ʐƶ"
	}).flatMap(([ascii, chars]) => [...chars].map((c) => [c, ascii])));
	var LOOKALIKE_RE = new RegExp(`[${[...LOOKALIKE_MAP.keys()].join("")}]`, "gu");
	function foldFancyLetters(s) {
		return s.replace(/[\u{1F150}-\u{1F169}\u{1F170}-\u{1F189}]/gu, (ch) => {
			const cp = ch.codePointAt(0);
			return String.fromCharCode(65 + (cp >= 127344 ? cp - 127344 : cp - 127312));
		}).replace(LOOKALIKE_RE, (ch) => LOOKALIKE_MAP.get(ch)).normalize("NFKD").replace(/\p{M}/gu, "");
	}
	var BLOCK_TAGS = new Set([
		"P",
		"DIV",
		"SECTION",
		"ARTICLE",
		"LI",
		"H1",
		"H2",
		"H3",
		"H4",
		"H5",
		"H6",
		"BLOCKQUOTE"
	]);
	var BLOCK_SELECTOR = "p,div,section,article,li,h1,h2,h3,h4,h5,h6,blockquote";
	function extractParagraphs(content, site, title) {
		const root = content.cloneNode(true);
		const doc = root.ownerDocument;
		for (const sel of [
			"script",
			"style",
			"noscript",
			"iframe",
			"ins",
			...site.remove ?? []
		]) root.querySelectorAll(sel).forEach((n) => {
			if (BLOCK_TAGS.has(n.tagName)) n.replaceWith(doc.createTextNode("\n"));
			else n.remove();
		});
		root.querySelectorAll("br").forEach((br) => br.replaceWith(doc.createTextNode("\n")));
		root.querySelectorAll(BLOCK_SELECTOR).forEach((el) => el.append(doc.createTextNode("\n")));
		const filters = compileFilters(site);
		const lines = (root.textContent ?? "").split("\n").flatMap((raw) => raw.trim().split(/[\u2002\u2003\u3000]{2,}/)).map(cleanText).filter((line) => {
			if (!line) return false;
			const folded = foldFancyLetters(line);
			return !filters.some((f) => f.test(line) || f.test(folded));
		});
		const norm = (s) => s.replace(/\s+/g, "");
		if (lines.length && norm(lines[0]) === norm(title)) lines.shift();
		return lines;
	}
	var TERMINAL_PUNCT = /[。！？!?；;：:”"’'」』》）)\]】…—~～.]$/;
	var HEADING_OR_DIALOGUE_START = /^[“"‘'「『（(【[《第]|^(楔子|序[章言]?|引子|尾声|番外|ps[:：])/i;
	var HEADING_LINE = /^(第[\d零〇一二两三四五六七八九十百千万]+[章节回卷集部篇话話]|楔子|序[章言]?|引子|尾声|番外)(\s|$)/;
	function mergeBrokenParagraphs(lines) {
		if (lines.length < 2) return lines;
		const out = [];
		for (const line of lines) {
			const prev = out[out.length - 1];
			if (prev && prev.length >= 6 && !TERMINAL_PUNCT.test(prev) && !HEADING_LINE.test(prev) && !HEADING_OR_DIALOGUE_START.test(line)) out[out.length - 1] = prev + line;
			else out.push(line);
		}
		return out;
	}
	var PAGE_LINK_TEXT = /下一?[页頁]/;
	function pageGroup(url) {
		const u = new URL(url);
		return u.origin + u.pathname.replace(/[_-]\d+(?=(\.\w+)?\/?$)/, "");
	}
	function looksPaged(title, nextText, url, nextUrl) {
		if (stripPageMark(title) !== title || PAGE_LINK_TEXT.test(nextText)) return true;
		const strip = (u) => u.split(/[?#]/)[0];
		return strip(url) === strip(nextUrl) || pageGroup(url) === strip(nextUrl) || pageGroup(nextUrl) === strip(url);
	}
	function extractChapter(doc, site, url) {
		const content = findContent(doc, site);
		if (!content) throw new Error(site.content ? `找不到正文（选择器 ${site.content}）` : "自动识别不到正文");
		const title = extractTitle(doc, site, content);
		const paragraphs = extractParagraphs(content, site, title);
		if (!paragraphs.length) throw new Error("正文清洗后为空");
		const next = findLink(doc, site.next, NEXT_TEXT);
		const prev = findLink(doc, site.prev, PREV_TEXT);
		const toc = findLink(doc, site.tocLink, TOC_TEXT);
		const book = findLink(doc, site.bookLink, BOOK_TEXT);
		const chapterOrNone = (a) => a && a.href.split("#")[0] !== url.split("#")[0] && isChapterUrl(site, a.href, url) ? a.href : void 0;
		const nextUrl = chapterOrNone(next);
		return {
			url,
			title,
			paragraphs,
			nextUrl,
			nextIsPage: !!nextUrl && looksPaged(title, cleanText(next?.textContent), url, nextUrl),
			prevUrl: chapterOrNone(prev),
			tocUrl: toc?.href,
			bookUrl: book?.href
		};
	}
	function parsePageMark(title) {
		const m = title.match(/[（(]\s*(\d+)\s*\/\s*(\d+)\s*[)）]|[（(]?第\s*(\d+)\s*\/\s*(\d+)\s*[页頁][)）]?/);
		if (!m) return void 0;
		const page = Number(m[1] ?? m[3]);
		const total = Number(m[2] ?? m[4]);
		return page >= 1 && total >= page ? {
			page,
			total
		} : void 0;
	}
	function sameChapterTitle(a, b) {
		const norm = (s) => stripPageMark(s).replace(/\s+/g, "");
		return norm(a) === norm(b);
	}
	function stripPageMark(title) {
		return title.replace(/[（(]\s*\d+\s*\/\s*\d+\s*[)）]|[（(]?第?\s*\d+\s*[页頁][)）]?/g, "").trim();
	}
	var ChallengeError = class extends Error {
		verifyUrl;
		constructor(verifyUrl) {
			super("站点要求 Cloudflare 人机验证，请在新标签页完成验证后重试");
			this.verifyUrl = verifyUrl;
			this.name = "ChallengeError";
		}
	};
	var CHALLENGE_MARKERS = [
		"challenge-platform",
		"cf-chl-",
		"<title>Just a moment",
		"cf_chl_opt"
	];
	var REQUEST_TIMEOUT = 2e4;
	function looksLikeChallenge(res, body) {
		return res.headers.get("cf-mitigated") === "challenge" || CHALLENGE_MARKERS.some((m) => body.includes(m));
	}
	async function ensureOk(res, verifyUrl) {
		if (res.ok && res.headers.get("cf-mitigated") !== "challenge") return res;
		if (looksLikeChallenge(res, await res.text().catch(() => ""))) throw new ChallengeError(verifyUrl);
		throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
	}
	function parseHeaders(raw) {
		const headers = new Headers();
		for (const line of raw.split(/\r?\n/)) {
			const i = line.indexOf(":");
			if (i <= 0) continue;
			try {
				headers.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
			} catch {}
		}
		return headers;
	}
	function crossOrigin(url, opts) {
		if (opts.signal?.aborted) return Promise.reject(opts.signal.reason ?? new DOMException("Aborted", "AbortError"));
		return new Promise((resolve, reject) => {
			const mergedHeaders = {
				...opts.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {},
				...opts.referrer ? { Referer: opts.referrer } : {},
				...opts.headers ?? {}
			};
			const headers = Object.keys(mergedHeaders).length ? mergedHeaders : void 0;
			let settled = false;
			let task;
			const cleanup = () => opts.signal?.removeEventListener("abort", onAbort);
			const onAbort = () => {
				if (settled) return;
				settled = true;
				try {
					task?.abort?.();
				} catch {}
				reject(opts.signal.reason ?? new DOMException("Aborted", "AbortError"));
			};
			opts.signal?.addEventListener("abort", onAbort, { once: true });
			task = _GM_xmlhttpRequest({
				url,
				method: opts.method ?? "GET",
				data: opts.body,
				headers,
				responseType: "arraybuffer",
				timeout: REQUEST_TIMEOUT,
				onload: (r) => {
					if (settled) return;
					settled = true;
					cleanup();
					const buf = r.response;
					resolve({
						ok: r.status >= 200 && r.status < 300,
						status: r.status,
						statusText: r.statusText,
						headers: parseHeaders(r.responseHeaders),
						url: r.finalUrl || url,
						arrayBuffer: async () => buf,
						text: async () => new TextDecoder().decode(buf)
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
				}
			});
		});
	}
	function withTimeout(signal) {
		const timeout = AbortSignal.timeout(REQUEST_TIMEOUT);
		if (!signal) return {
			signal: timeout,
			cleanup: () => {}
		};
		if (typeof AbortSignal.any === "function") return {
			signal: AbortSignal.any([signal, timeout]),
			cleanup: () => {}
		};
		const ac = new AbortController();
		const onExt = () => ac.abort(signal.reason);
		const onTimeout = () => ac.abort(timeout.reason);
		if (signal.aborted) ac.abort(signal.reason);
		else {
			signal.addEventListener("abort", onExt, { once: true });
			timeout.addEventListener("abort", onTimeout, { once: true });
		}
		return {
			signal: ac.signal,
			cleanup: () => {
				signal.removeEventListener("abort", onExt);
				timeout.removeEventListener("abort", onTimeout);
			}
		};
	}
	async function request(url, opts = {}) {
		if (new URL(url, location.href).origin !== location.origin) return crossOrigin(url, opts);
		const mergedHeaders = {
			...opts.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {},
			...opts.headers ?? {}
		};
		const { signal, cleanup } = withTimeout(opts.signal);
		try {
			return await fetch(url, {
				credentials: "include",
				method: opts.method ?? "GET",
				body: opts.body,
				headers: Object.keys(mergedHeaders).length ? mergedHeaders : void 0,
				referrer: opts.referrer,
				signal
			});
		} catch (e) {
			if (opts.signal?.aborted || e.name === "AbortError") throw e;
			if (e.name === "TimeoutError") throw new Error(`请求超时：${new URL(url, location.href).host}`);
			throw new Error(`网络请求失败：${e.message}`);
		} finally {
			cleanup();
		}
	}
	async function fetchPage(url, opts = {}) {
		const res = await ensureOk(await request(url, opts), url);
		const buf = await res.arrayBuffer();
		const charset = detectCharset(res.headers.get("content-type"), buf);
		let html;
		try {
			html = new TextDecoder(charset).decode(buf);
		} catch {
			throw new Error(`不支持的页面编码：${charset}`);
		}
		if (looksLikeChallenge(res, html.slice(0, 4096))) throw new ChallengeError(url);
		const doc = new DOMParser().parseFromString(html, "text/html");
		const finalUrl = res.url || url;
		const base = doc.createElement("base");
		base.href = finalUrl;
		doc.head.prepend(base);
		return {
			doc,
			url: finalUrl,
			charset,
			html
		};
	}
	async function fetchDocument(url, opts) {
		return (await fetchPage(url, opts)).doc;
	}
	function detectCharset(contentType, buf) {
		const fromHeader = contentType?.match(/charset=["']?([\w-]+)/i)?.[1];
		if (fromHeader) return fromHeader.toLowerCase();
		return (new TextDecoder("latin1").decode(buf.slice(0, 4096)).match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? "utf-8").toLowerCase();
	}
	var gbkTable;
	function encodeFormValue(value, charset) {
		if (!/^(gbk|gb2312|gb18030)$/i.test(charset)) return encodeURIComponent(value);
		if (!gbkTable) {
			gbkTable = new Map();
			const buf = new Uint8Array(71820);
			const pairs = [];
			let offset = 0;
			for (let hi = 129; hi <= 254; hi++) for (let lo = 64; lo <= 254; lo++) {
				if (lo === 127) continue;
				buf[offset++] = hi;
				buf[offset++] = lo;
				buf[offset++] = 10;
				pairs.push([hi, lo]);
			}
			const chars = new TextDecoder("gbk").decode(buf).split("\n");
			for (let i = 0; i < pairs.length; i++) {
				const ch = chars[i];
				if (ch && ch.length === 1 && ch !== "�" && !gbkTable.has(ch)) {
					const [hi, lo] = pairs[i];
					gbkTable.set(ch, `%${hi.toString(16).toUpperCase()}%${lo.toString(16).toUpperCase().padStart(2, "0")}`);
				}
			}
		}
		return [...value].map((ch) => {
			if (ch.charCodeAt(0) < 128) return encodeURIComponent(ch);
			const code = gbkTable.get(ch);
			if (!code) throw new Error(`「${ch}」无法用 GBK 编码，该站点搜不了这个书名`);
			return code;
		}).join("");
	}
	var DEQIXSS_SPAM = [
		/更新不易.+?(看最新章节|看最新无错章节|最新小说章节)！/g,
		/最后一批邀请码1900人发放，官方反馈群1104270100/g,
		/看最新完整章節，就上速讀谷/g,
		/本章节未完.+?请订阅/g,
		/速.?读.?谷|速 读 谷|shudugu\.org/g,
		/当&前@章#节.+?退&出%阅#读\|模\*式！/g,
		/如果章节内容不全或者空章节.+?刷新页面即可！/g
	];
	var ADAPTERS = { deqixss: { async load(url, site, firstDoc) {
		const m = new URL(url).pathname.match(/^\/books\/(\d+)\/(\d+)\.html$/);
		if (!m) throw new Error(`不是章节地址：${url}`);
		const [, aid, cid] = m;
		const doc = firstDoc ?? await fetchDocument(url);
		const scriptText = [...doc.querySelectorAll("script")].map((s) => s.textContent ?? "").join("\n") || doc.documentElement.innerHTML;
		const title = cleanText(doc.querySelector("h1")?.textContent).replace(/[（(]第[\d/]*页[)）]$/, "").trim();
		const linkIn = (branch) => scriptText.match(branch)?.[1] || void 0;
		const prev = linkIn(/direction === 'prev'\) \{\s*chapterUrl = '([^']*)'/);
		const next = linkIn(/\} else \{\s*chapterUrl = '([^']*)'/);
		const toc = doc.querySelector(".page-index")?.getAttribute("data-href");
		const tokenUrl = new URL(`/scripts/chapter.js.php?aid=${aid}&cid=${cid}&referrer=${encodeURIComponent(url)}`, url).href;
		const tokenJs = await (await ensureOk(await request(tokenUrl, { referrer: url }), url)).text();
		const value = (name) => {
			const v = tokenJs.match(new RegExp(`var ${name} = '?([^';]+)'?;`))?.[1];
			if (!v) throw new Error(`章节 token 中缺少 ${name}`);
			return v;
		};
		const query = new URLSearchParams({
			aid,
			cid,
			token: value("chapterToken"),
			timestamp: value("timestamp"),
			nonce: value("nonce")
		});
		const ajaxUrl = new URL(`/modules/article/ajax2.php?${query}`, url).href;
		const res = await ensureOk(await request(ajaxUrl, {
			headers: { "X-Requested-With": "XMLHttpRequest" },
			referrer: url
		}), url);
		const buf = await res.arrayBuffer();
		const ct = res.headers.get("content-type") ?? "";
		const charset = /utf-?8/i.test(ct) ? "utf-8" : "gbk";
		const json = JSON.parse(new TextDecoder(charset).decode(buf));
		if (json.status !== 1 || !json.data?.content) throw new Error(`获取正文失败：${json.message ?? "未知错误"}`);
		const raw = DEQIXSS_SPAM.reduce((s, re) => s.replace(re, ""), json.data.content);
		const content = new DOMParser().parseFromString(`<div>${raw}</div>`, "text/html").body.firstElementChild;
		const paragraphs = extractParagraphs(content, site, title);
		if (!paragraphs.length) throw new Error("正文清洗后为空");
		const chapter = (u) => u && u !== "#" && isChapterUrl(site, u, url) ? new URL(u, url).href : void 0;
		return {
			url,
			title,
			paragraphs,
			nextUrl: chapter(next),
			prevUrl: chapter(prev),
			tocUrl: toc ? new URL(toc, url).href : void 0,
			bookUrl: toc ? new URL(toc, url).href : void 0
		};
	} } };
	function getAdapter(id) {
		const adapter = ADAPTERS[id];
		if (!adapter) throw new Error(`未知的站点适配器：${id}`);
		return adapter;
	}
	var BOOK_SEARCH = {
		twkan: {
			bookPath: /^\/book\/(\d+)\.html$/,
			chapterRoot: "/txt/",
			startDirectory: "/book/{id}/index.html",
			script: "hant",
			search: {
				url: "https://twkan.com/search",
				body: "searchkey={name}&searchtype=all",
				charset: "utf-8",
				result: "#article_list_content h3 a, .newbox h3 a",
				author: ".newnav .labelbox label:first-child"
			}
		},
		deqixss: {
			bookPath: /^\/books\/(\d+)\/?$/,
			chapterRoot: "/books/",
			script: "hans",
			search: {
				url: "https://www.deqixss.com/modules/article/search.php",
				body: "searchkey={name}&action=login&searchtype=all",
				charset: "utf-8"
			}
		},
		sudugu: {
			bookPath: /^\/(\d+)\/$/,
			chapterRoot: "/",
			script: "hans",
			search: {
				url: "https://www.sudugu.cc/modules/article/search.php",
				body: "searchkey={name}&searchtype=articlename",
				charset: "utf-8"
			}
		}
	};
	var BUILTIN_SITES = [
		{
			id: "twkan",
			name: "台湾小说网",
			hosts: ["twkan.com"],
			enabled: true,
			builtin: true,
			chapterPattern: "^/txt/\\d+/\\d+",
			content: "#txtcontent0",
			title: ".txtnav h1",
			next: { selector: ".page1" },
			prev: { selector: ".page1" },
			tocLink: { selector: ".page1" },
			toc: {
				api: "https://twkan.com/ajax_novels/chapterlist/{bookId}.html",
				bookIdPattern: "/(?:txt|book)/(\\d+)"
			},
			remove: [
				".txtad",
				".txtcenter",
				"script",
				"style"
			],
			filters: ["twkan"],
			freshFirst: true
		},
		{
			id: "deqixss",
			name: "得奇小说网",
			hosts: ["deqixss.com"],
			enabled: true,
			builtin: true,
			adapter: "deqixss",
			chapterPattern: "^/books/\\d+/\\d+\\.html$"
		},
		{
			id: "sudugu",
			name: "速读谷",
			hosts: ["sudugu.cc"],
			enabled: true,
			builtin: true,
			chapterPattern: "^/\\d+/\\d+(_\\d+)?\\.html$",
			content: ".con",
			title: ".submenu h1",
			book: {
				name: ".itemtxt h1 a",
				author: ".itemtxt p a[href*=\"author\"]"
			}
		}
	];
	var SETTINGS_KEY = "settings";
	var SITES_KEY = "sites";
	var DEFAULT_SETTINGS = {
		theme: "parchment",
		font: "hei",
		customFont: "",
		fontSize: 22,
		width: 640,
		lineHeight: 1.8,
		paragraphSpacing: 1,
		indent: true,
		justify: true,
		mergeParagraphs: true,
		statusBar: true,
		pageMode: "scroll",
		script: "hans"
	};
	var isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
	function formatAgo(t) {
		const m = Math.round((Date.now() - t) / 6e4);
		if (m < 1) return "刚刚";
		if (m < 60) return `${m} 分钟前`;
		const h = Math.round(m / 60);
		if (h < 24) return `${h} 小时前`;
		return `${Math.round(h / 24)} 天前`;
	}
	function loadSettings() {
		const saved = _GM_getValue(SETTINGS_KEY, {});
		return {
			...DEFAULT_SETTINGS,
			...saved
		};
	}
	function patchSettings(patch) {
		_GM_setValue(SETTINGS_KEY, {
			..._GM_getValue(SETTINGS_KEY, {}),
			...patch
		});
		return loadSettings();
	}
	var isPatch = (s) => "patch" in s;
	function stableJson(v) {
		if (Array.isArray(v)) return `[${v.map((x) => x === void 0 ? "null" : stableJson(x)).join(",")}]`;
		if (isObject(v)) return `{${Object.keys(v).filter((k) => v[k] !== void 0).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(",")}}`;
		return JSON.stringify(v);
	}
	function diffFromBuiltin(def, site) {
		const a = def;
		const b = site;
		const patch = {};
		for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
			if (key === "id" || key === "builtin") continue;
			if (stableJson(a[key]) !== stableJson(b[key])) patch[key] = b[key] ?? null;
		}
		return patch;
	}
	function applyBuiltinPatch(def, patch) {
		const out = { ...def };
		for (const [key, value] of Object.entries(patch)) if (value === null) delete out[key];
		else out[key] = value;
		return out;
	}
	function loadSites() {
		const stored = _GM_getValue(SITES_KEY, []);
		const byId = new Map(stored.map((s) => [s.id, s]));
		const builtins = BUILTIN_SITES.map((b) => {
			const override = byId.get(b.id);
			if (!override) return b;
			return isPatch(override) ? applyBuiltinPatch(b, override.patch) : {
				...override,
				builtin: true
			};
		});
		const builtinIds = new Set(BUILTIN_SITES.map((b) => b.id));
		const custom = stored.filter((s) => !isPatch(s) && !builtinIds.has(s.id));
		return [...builtins, ...custom];
	}
	function saveSites(sites) {
		const toStore = [];
		for (const s of sites) {
			const def = BUILTIN_SITES.find((b) => b.id === s.id);
			if (!def) {
				toStore.push(s);
				continue;
			}
			const patch = diffFromBuiltin(def, s);
			if (Object.keys(patch).length) toStore.push({
				id: s.id,
				patch
			});
		}
		_GM_setValue(SITES_KEY, toStore);
	}
	function loadCustomizedSites() {
		return loadSites().filter((s) => {
			const def = BUILTIN_SITES.find((b) => b.id === s.id);
			return !def || Object.keys(diffFromBuiltin(def, s)).length > 0;
		});
	}
	function importSites(incoming) {
		const merged = loadSites();
		for (const entry of incoming) {
			const idx = merged.findIndex((s) => s.id === entry.id);
			if (idx >= 0) merged[idx] = {
				...entry,
				builtin: merged[idx].builtin
			};
			else merged.push({
				...entry,
				builtin: void 0
			});
		}
		saveSites(merged);
		return loadSites();
	}
	function upsertSite(entry) {
		const sites = loadSites();
		const idx = sites.findIndex((s) => s.id === entry.id);
		if (idx >= 0) sites[idx] = entry;
		else sites.push(entry);
		saveSites(sites);
		return sites;
	}
	function removeSite(id) {
		const sites = loadSites().filter((s) => s.builtin || s.id !== id);
		saveSites(sites);
		return sites;
	}
	function resetBuiltinSite(id) {
		const def = BUILTIN_SITES.find((b) => b.id === id);
		if (!def) throw new Error(`不是内置站点：${id}`);
		const sites = loadSites().map((s) => s.id === id ? def : s);
		saveSites(sites);
		return sites;
	}
	function normalizeHost(input) {
		const raw = input.trim();
		if (!raw) throw new Error("请输入网址或域名");
		let host;
		try {
			host = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
		} catch {
			throw new Error(`无法识别的网址：${raw}`);
		}
		host = host.toLowerCase().replace(/^(www|m|wap)\./, "");
		if (!host.includes(".")) throw new Error(`无法识别的域名：${raw}`);
		return host;
	}
	function hostMatches(hostname, host) {
		const h = hostname.toLowerCase();
		return h === host || h.endsWith(`.${host}`);
	}
	function findSite(sites, hostname) {
		return sites.find((s) => s.hosts.some((h) => hostMatches(hostname, h)));
	}
	function createSite(input) {
		const host = normalizeHost(input);
		const existing = findSite(loadSites(), host);
		if (existing) throw new Error(`${host} 已在站点列表中（${existing.name}）`);
		const entry = {
			id: `site-${host}`,
			name: host,
			hosts: [host],
			enabled: true
		};
		upsertSite(entry);
		return entry;
	}
	function validateSite(raw) {
		if (!raw || typeof raw !== "object") throw new Error("站点规则必须是对象");
		const s = raw;
		if (typeof s.id !== "string" || !s.id) throw new Error("缺少 id");
		if (typeof s.name !== "string" || !s.name) throw new Error(`${s.id}：缺少 name`);
		if (!Array.isArray(s.hosts) || !s.hosts.length || !s.hosts.every((h) => typeof h === "string" && h)) throw new Error(`${s.id}：hosts 必须是非空字符串数组`);
		if (typeof s.enabled !== "boolean") throw new Error(`${s.id}：enabled 必须是布尔值`);
		const isSiteObj = isObject;
		for (const key of [
			"chapterPattern",
			"content",
			"title"
		]) if (s[key] !== void 0 && typeof s[key] !== "string") throw new Error(`${s.id}：${key} 必须是字符串`);
		for (const key of [
			"filters",
			"strip",
			"remove"
		]) {
			const list = s[key];
			if (list !== void 0 && !(Array.isArray(list) && list.every((x) => typeof x === "string" && x))) throw new Error(`${s.id}：${key} 必须是非空字符串组成的数组`);
		}
		if (s.replace !== void 0) {
			if (!Array.isArray(s.replace)) throw new Error(`${s.id}：replace 必须是数组`);
			for (const r of s.replace) {
				if (!isSiteObj(r) || typeof r.from !== "string" || !r.from || typeof r.to !== "string") throw new Error(`${s.id}：replace 条目必须是 { from, to }，且 from 不能为空`);
				try {
					new RegExp(r.from, "g");
				} catch {
					throw new Error(`${s.id}：replace 正则不合法：${r.from}`);
				}
			}
		}
		const locators = [
			"next",
			"prev",
			"tocLink",
			"bookLink"
		];
		for (const key of locators) {
			const loc = s[key];
			if (loc === void 0) continue;
			if (!isSiteObj(loc)) throw new Error(`${s.id}：${key} 必须是对象`);
			for (const field of ["selector", "text"]) if (loc[field] !== void 0 && typeof loc[field] !== "string") throw new Error(`${s.id}：${key}.${field} 必须是字符串`);
		}
		if (s.toc !== void 0) {
			if (!isSiteObj(s.toc)) throw new Error(`${s.id}：toc 必须是对象`);
			for (const field of ["api", "bookIdPattern"]) if (s.toc[field] !== void 0 && typeof s.toc[field] !== "string") throw new Error(`${s.id}：toc.${field} 必须是字符串`);
		}
		const patterns = [
			s.chapterPattern,
			s.toc?.bookIdPattern,
			...s.filters ?? []
		];
		for (const p of patterns) {
			if (p === void 0) continue;
			try {
				new RegExp(p);
			} catch {
				throw new Error(`${s.id}：正则不合法：${String(p)}`);
			}
		}
		if (s.adapter !== void 0 && !(typeof s.adapter === "string" && s.adapter in ADAPTERS)) throw new Error(`${s.id}：未知的 adapter：${String(s.adapter)}`);
		if (s.book !== void 0 && !isSiteObj(s.book)) throw new Error(`${s.id}：book 必须是对象`);
		if (s.search !== void 0) {
			const search = s.search;
			if (!isSiteObj(search) || typeof search.url !== "string" || !/^https?:\/\//i.test(search.url)) throw new Error(`${s.id}：search.url 必须是 http(s) 地址`);
			if (!(typeof search.body === "string" ? search.body : search.url).includes("{name}")) throw new Error(`${s.id}：search 需要用 {name} 标出书名的位置`);
			if (search.bookPath !== void 0) {
				if (typeof search.bookPath !== "string") throw new Error(`${s.id}：search.bookPath 必须是字符串`);
				try {
					new RegExp(search.bookPath);
				} catch {
					throw new Error(`${s.id}：正则不合法：${search.bookPath}`);
				}
			}
			for (const field of [
				"body",
				"charset",
				"result",
				"author",
				"chapterRoot",
				"startDirectory"
			]) if (search[field] !== void 0 && typeof search[field] !== "string") throw new Error(`${s.id}：search.${field} 必须是字符串`);
			if (search.script !== void 0 && search.script !== "hans" && search.script !== "hant") throw new Error(`${s.id}：search.script 必须是 hans 或 hant`);
		}
		const book = s.book ?? {};
		const selectors = [
			["content", s.content],
			["title", s.title],
			["book.name", book.name],
			["book.author", book.author],
			["search.result", s.search?.result],
			["search.author", s.search?.author],
			...locators.map((key) => [`${key}.selector`, s[key]?.selector]),
			...(s.remove ?? []).map((sel, i) => [`remove[${i}]`, sel])
		];
		for (const [key, sel] of selectors) {
			if (sel === void 0) continue;
			if (typeof sel !== "string") throw new Error(`${s.id}：${key} 必须是字符串`);
			try {
				document.createDocumentFragment().querySelector(sel);
			} catch {
				throw new Error(`${s.id}：${key} 不是合法 CSS 选择器`);
			}
		}
		return s;
	}
	function bookKeyOf(url) {
		const u = new URL(url);
		const dir = u.pathname.replace(/[^/]*$/, "");
		if (dir === "/") {
			const m = u.pathname.match(/^\/(\d+)[_-]\d+\.html$/i);
			if (m) return `${u.origin}/${m[1]}/`;
		}
		return u.origin + dir;
	}
	var READ_PREFIX = "read:";
	var readKey = (bookKey) => READ_PREFIX + bookKey;
	function loadReadChapters(bookKey) {
		const local = _GM_getValue(readKey(bookKey), []);
		let rootKey;
		try {
			rootKey = `${new URL(bookKey).origin}/`;
		} catch {
			return local;
		}
		if (rootKey === bookKey) return local;
		const rootList = _GM_getValue(readKey(rootKey), []);
		if (!rootList.length) return local;
		const mine = rootList.filter((u) => {
			try {
				return bookKeyOf(u) === bookKey;
			} catch {
				return false;
			}
		});
		if (!mine.length) return local;
		return [...local, ...mine.filter((u) => !local.includes(u))];
	}
	function markChaptersRead(bookKey, urls) {
		const read = loadReadChapters(bookKey);
		const added = urls.filter((u) => !read.includes(u));
		if (!added.length) return read;
		const local = _GM_getValue(readKey(bookKey), []);
		const next = [...local, ...added.filter((u) => !local.includes(u))];
		_GM_setValue(readKey(bookKey), next);
		return loadReadChapters(bookKey);
	}
	var EXCERPTS_KEY = "excerpts";
	function loadExcerpts() {
		return _GM_getValue(EXCERPTS_KEY, []).map((e) => {
			try {
				const originRoot = `${new URL(e.url).origin}/`;
				const actualKey = bookKeyOf(e.url);
				if (e.bookKey === originRoot && actualKey !== e.bookKey) return {
					...e,
					bookKey: actualKey
				};
			} catch {}
			return e;
		});
	}
	function saveExcerpts(list) {
		_GM_setValue(EXCERPTS_KEY, list);
	}
	function ensureEditableSite(siteId) {
		const sites = loadSites();
		const found = sites.find((s) => s.id === siteId);
		if (found) return found;
		if (siteId === "temp" && typeof location !== "undefined" && location.hostname) return findSite(sites, normalizeHost(location.hostname)) ?? createSite(location.hostname);
		throw new Error("本站还不在阅读站点列表中，请先在设置 → 站点里添加");
	}
	function updateSiteList(siteId, key, change) {
		const site = ensureEditableSite(siteId);
		const list = change(site[key] ?? []);
		const updated = {
			...site,
			[key]: list.length ? list : void 0
		};
		upsertSite(updated);
		return updated;
	}
	function updateSiteStrip(siteId, change) {
		return updateSiteList(siteId, "strip", change);
	}
	function updateSiteFilters(siteId, change) {
		return updateSiteList(siteId, "filters", change);
	}
	function updateSiteReplace(siteId, change) {
		return updateSiteList(siteId, "replace", change);
	}
	var BOOK_INFO_PREFIX = "bookInfo:";
	var bookInfoKey = (bookKey) => BOOK_INFO_PREFIX + bookKey;
	function loadBookInfo(bookKey) {
		return _GM_getValue(bookInfoKey(bookKey), void 0);
	}
	function saveBookInfo(bookKey, info) {
		_GM_setValue(bookInfoKey(bookKey), info);
	}
	var SHELF_KEY = "shelf";
	function loadShelf() {
		const shelf = _GM_getValue(SHELF_KEY, []);
		for (const book of shelf) {
			const byKey = new Map();
			for (const s of book.sources) {
				try {
					const originRoot = `${new URL(s.lastUrl).origin}/`;
					const actualKey = bookKeyOf(s.lastUrl);
					if (s.bookKey === originRoot && actualKey !== s.bookKey) s.bookKey = actualKey;
				} catch {}
				const prev = byKey.get(s.bookKey);
				if (!prev || s.updated > prev.updated) byKey.set(s.bookKey, s);
			}
			if (byKey.size !== book.sources.length) book.sources = [...byKey.values()];
		}
		return shelf;
	}
	function saveShelf(shelf) {
		_GM_setValue(SHELF_KEY, shelf);
	}
	function addToShelf(book, source) {
		const shelf = loadShelf();
		const existing = shelf.find((b) => b.matchKey === book.matchKey);
		if (existing) {
			existing.sources = [...existing.sources.filter((s) => s.bookKey !== source.bookKey), source];
			existing.author ??= book.author;
		} else shelf.unshift({
			...book,
			id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
			sources: [source],
			added: Date.now()
		});
		saveShelf(shelf);
		return shelf;
	}
	function updateShelfProgress(bookKey, lastUrl, lastTitle) {
		const shelf = loadShelf();
		const source = shelf.flatMap((b) => b.sources).find((s) => s.bookKey === bookKey);
		if (!source || source.lastUrl === lastUrl) return void 0;
		Object.assign(source, {
			lastUrl,
			lastTitle,
			updated: Date.now()
		});
		saveShelf(shelf);
		return shelf;
	}
	function removeShelfSource(bookId, bookKey) {
		const shelf = loadShelf().map((b) => b.id === bookId ? {
			...b,
			sources: b.sources.filter((s) => s.bookKey !== bookKey)
		} : b).filter((b) => b.sources.length);
		saveShelf(shelf);
		return shelf;
	}
	function addShelfSource(bookId, source) {
		const shelf = loadShelf();
		const book = shelf.find((b) => b.id === bookId);
		if (!book || book.sources.some((s) => s.bookKey === source.bookKey)) return void 0;
		book.sources.push(source);
		saveShelf(shelf);
		return shelf;
	}
	var AUTO_OPEN_KEY = "autoOpen";
	var AUTO_OPEN_TTL = 6e4;
	function loadAutoOpenQueue() {
		const raw = _GM_getValue(AUTO_OPEN_KEY, void 0);
		const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
		const now = Date.now();
		return list.filter((it) => it && typeof it.url === "string" && now - it.time < AUTO_OPEN_TTL);
	}
	function requestAutoOpen(url, arrival = {}) {
		const strip = (u) => u.split("#")[0];
		const target = strip(url);
		const queue = loadAutoOpenQueue().filter((it) => strip(it.url) !== target);
		queue.push({
			url,
			time: Date.now(),
			arrival
		});
		_GM_setValue(AUTO_OPEN_KEY, queue);
	}
	function consumeAutoOpen(href) {
		const strip = (u) => u.split("#")[0];
		const target = strip(href);
		const queue = loadAutoOpenQueue();
		const idx = queue.findIndex((it) => strip(it.url) === target);
		if (idx < 0) {
			if (!queue.length) _GM_deleteValue(AUTO_OPEN_KEY);
			return;
		}
		const [matched] = queue.splice(idx, 1);
		if (queue.length) _GM_setValue(AUTO_OPEN_KEY, queue);
		else _GM_deleteValue(AUTO_OPEN_KEY);
		return matched.arrival ?? {};
	}
	var posKey = (bookKey) => `pos:${bookKey}`;
	function loadReadingPosition(bookKey) {
		return _GM_getValue(posKey(bookKey), void 0);
	}
	function saveReadingPosition(bookKey, pos) {
		_GM_setValue(posKey(bookKey), pos);
	}
	var READ_TITLES_PREFIX = "readTitles:";
	function loadReadTitles(matchKey) {
		return _GM_getValue(READ_TITLES_PREFIX + matchKey, []);
	}
	function addReadTitles(matchKey, keys) {
		const list = loadReadTitles(matchKey);
		const added = [...new Set(keys)].filter((k) => k && !list.includes(k));
		if (!added.length) return list;
		const next = [...list, ...added];
		_GM_setValue(READ_TITLES_PREFIX + matchKey, next);
		return next;
	}
	var SOURCES_PREFIX = "sources:";
	var SOURCES_INDEX_KEY = "sourcesIndex";
	var SOURCES_CACHE_LIMIT = 30;
	function loadSourceCache(matchKey) {
		return _GM_getValue(SOURCES_PREFIX + matchKey, void 0);
	}
	function saveSourceCache(matchKey, data) {
		_GM_setValue(SOURCES_PREFIX + matchKey, data);
		const index = [matchKey, ..._GM_getValue(SOURCES_INDEX_KEY, []).filter((k) => k !== matchKey)];
		for (const old of index.splice(SOURCES_CACHE_LIMIT)) _GM_deleteValue(SOURCES_PREFIX + old);
		_GM_setValue(SOURCES_INDEX_KEY, index);
	}
	var n;
	var l$1;
	var u$2;
	var i$2;
	var r$1;
	var o$1;
	var e$1;
	var f$2;
	var c$1;
	var a$1;
	var s$1;
	var h$1;
	var p$1;
	var v$1;
	var d$1 = {};
	var w$1 = [];
	var _$1 = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
	var g = Array.isArray;
	function m$1(n, l) {
		for (var u in l) n[u] = l[u];
		return n;
	}
	function b(n) {
		n && n.parentNode && n.parentNode.removeChild(n);
	}
	function k$1(l, u, t) {
		var i, r, o, e = {};
		for (o in u) "key" == o ? i = u[o] : "ref" == o ? r = u[o] : e[o] = u[o];
		if (arguments.length > 2 && (e.children = arguments.length > 3 ? n.call(arguments, 2) : t), "function" == typeof l && null != l.defaultProps) for (o in l.defaultProps) void 0 === e[o] && (e[o] = l.defaultProps[o]);
		return x(l, e, i, r, null);
	}
	function x(n, t, i, r, o) {
		var e = {
			type: n,
			props: t,
			key: i,
			ref: r,
			__k: null,
			__: null,
			__b: 0,
			__e: null,
			__c: null,
			constructor: void 0,
			__v: null == o ? ++u$2 : o,
			__i: -1,
			__u: 0
		};
		return null == o && null != l$1.vnode && l$1.vnode(e), e;
	}
	function S(n) {
		return n.children;
	}
	function C$1(n, l) {
		this.props = n, this.context = l;
	}
	function $(n, l) {
		if (null == l) return n.__ ? $(n.__, n.__i + 1) : null;
		for (var u; l < n.__k.length; l++) if (null != (u = n.__k[l]) && null != u.__e) return u.__e;
		return "function" == typeof n.type ? $(n) : null;
	}
	function I(n) {
		if (n.__P && n.__d) {
			var u = n.__v, t = u.__e, i = [], r = [], o = m$1({}, u);
			o.__v = u.__v + 1, l$1.vnode && l$1.vnode(o), q$1(n.__P, o, u, n.__n, n.__P.namespaceURI, 32 & u.__u ? [t] : null, i, null == t ? $(u) : t, !!(32 & u.__u), r), o.__v = u.__v, o.__.__k[o.__i] = o, D$1(i, o, r), u.__e = u.__ = null, o.__e != t && P(o);
		}
	}
	function P(n) {
		if (null != (n = n.__) && null != n.__c) return n.__e = n.__c.base = null, n.__k.some(function(l) {
			if (null != l && null != l.__e) return n.__e = n.__c.base = l.__e;
		}), P(n);
	}
	function A$1(n) {
		(!n.__d && (n.__d = !0) && i$2.push(n) && !H.__r++ || r$1 != l$1.debounceRendering) && ((r$1 = l$1.debounceRendering) || o$1)(H);
	}
	function H() {
		try {
			for (var n, l = 1; i$2.length;) i$2.length > l && i$2.sort(e$1), n = i$2.shift(), l = i$2.length, I(n);
		} finally {
			i$2.length = H.__r = 0;
		}
	}
	function L(n, l, u, t, i, r, o, e, f, c, a) {
		var s, h, p, v, y, _, g = t && t.__k || w$1, m = l.length;
		for (f = T$1(u, l, g, f, m), s = 0; s < m; s++) null != (p = u.__k[s]) && (h = -1 != p.__i && g[p.__i] || d$1, p.__i = s, _ = q$1(n, p, h, i, r, o, e, f, c, a), v = p.__e, p.ref && h.ref != p.ref && (h.ref && J(h.ref, null, p), a.push(p.ref, p.__c || v, p)), null == y && null != v && (y = v), 4 & p.__u ? (f = j$1(p, f, n), h.__e && (h.__e = null)) : "function" == typeof p.type && void 0 !== _ ? f = _ : v && (f = v.nextSibling), p.__u &= -7);
		return u.__e = y, f;
	}
	function T$1(n, l, u, t, i) {
		var r, o, e, f, c, a = u.length, s = a, h = 0;
		for (n.__k = new Array(i), r = 0; r < i; r++) null != (o = l[r]) && "boolean" != typeof o && "function" != typeof o ? ("string" == typeof o || "number" == typeof o || "bigint" == typeof o || o.constructor == String ? o = n.__k[r] = x(null, o, null, null, null) : g(o) ? o = n.__k[r] = x(S, { children: o }, null, null, null) : void 0 === o.constructor && o.__b > 0 ? o = n.__k[r] = x(o.type, o.props, o.key, o.ref ? o.ref : null, o.__v) : n.__k[r] = o, f = r + h, o.__ = n, o.__b = n.__b + 1, e = null, -1 != (c = o.__i = O(o, u, f, s)) && (s--, (e = u[c]) && (e.__u |= 2)), null == e || null == e.__v ? (-1 == c && (i > a ? h-- : i < a && h++), "function" != typeof o.type && (o.__u |= 4)) : c != f && (c == f - 1 ? h-- : c == f + 1 ? h++ : (c > f ? h-- : h++, o.__u |= 4))) : n.__k[r] = null;
		if (s) for (r = 0; r < a; r++) null != (e = u[r]) && 0 == (2 & e.__u) && (e.__e == t && (t = $(e)), K(e, e));
		return t;
	}
	function j$1(n, l, u) {
		var t, i;
		if ("function" == typeof n.type) {
			for (t = n.__k, i = 0; t && i < t.length; i++) t[i] && (t[i].__ = n, l = j$1(t[i], l, u));
			return l;
		}
		n.__e != l && (l && n.type && !l.parentNode && (l = $(n)), l = u.insertBefore(n.__e, l || null));
		do
			l = l && l.nextSibling;
		while (null != l && 8 == l.nodeType);
		return l;
	}
	function O(n, l, u, t) {
		var i, r, o, e = n.key, f = n.type, c = l[u], a = null != c && 0 == (2 & c.__u);
		if (null === c && null == e || a && e == c.key && f == c.type) return u;
		if (t > (a ? 1 : 0)) {
			for (i = u - 1, r = u + 1; i >= 0 || r < l.length;) if (null != (c = l[o = i >= 0 ? i-- : r++]) && 0 == (2 & c.__u) && e == c.key && f == c.type) return o;
		}
		return -1;
	}
	function z$1(n, l, u) {
		"-" == l[0] ? n.setProperty(l, null == u ? "" : u) : n[l] = null == u ? "" : "number" != typeof u || _$1.test(l) ? u : u + "px";
	}
	function N(n, l, u, t, i) {
		var r, o;
		n: if ("style" == l) if ("string" == typeof u) n.style.cssText = u;
		else {
			if ("string" == typeof t && (n.style.cssText = t = ""), t) for (l in t) u && l in u || z$1(n.style, l, "");
			if (u) for (l in u) t && u[l] == t[l] || z$1(n.style, l, u[l]);
		}
		else if ("o" == l[0] && "n" == l[1]) r = l != (l = l.replace(s$1, "$1")), o = l.toLowerCase(), l = o in n || "onFocusOut" == l || "onFocusIn" == l ? o.slice(2) : l.slice(2), n.l || (n.l = {}), n.l[l + r] = u, u ? t ? u[a$1] = t[a$1] : (u[a$1] = h$1, n.addEventListener(l, r ? v$1 : p$1, r)) : n.removeEventListener(l, r ? v$1 : p$1, r);
		else {
			if ("http://www.w3.org/2000/svg" == i) l = l.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
			else if ("width" != l && "height" != l && "href" != l && "list" != l && "form" != l && "tabIndex" != l && "download" != l && "rowSpan" != l && "colSpan" != l && "role" != l && "popover" != l && l in n) try {
				n[l] = null == u ? "" : u;
				break n;
			} catch (n) {}
			"function" == typeof u || (null == u || !1 === u && "-" != l[4] ? n.removeAttribute(l) : n.setAttribute(l, "popover" == l && 1 == u ? "" : u));
		}
	}
	function V(n) {
		return function(u) {
			if (this.l) {
				var t = this.l[u.type + n];
				if (null == u[c$1]) u[c$1] = h$1++;
				else if (u[c$1] < t[a$1]) return;
				return t(l$1.event ? l$1.event(u) : u);
			}
		};
	}
	function q$1(n, u, t, i, r, o, e, f, c, a) {
		var s, h, p, v, y, d, _, k, x, M, I, P, A, H, T, j, F = u.type;
		if (void 0 !== u.constructor) return null;
		128 & t.__u && (c = !!(32 & t.__u), o = [f = u.__e = t.__e]), (s = l$1.__b) && s(u);
		n: if ("function" == typeof F) {
			h = e.length;
			try {
				if (x = u.props, M = F.prototype && F.prototype.render, I = (s = F.contextType) && i[s.__c], P = s ? I ? I.props.value : s.__ : i, t.__c ? k = (p = u.__c = t.__c).__ = p.__E : (M ? u.__c = p = new F(x, P) : (u.__c = p = new C$1(x, P), p.constructor = F, p.render = Q), I && I.sub(p), p.state || (p.state = {}), p.__n = i, v = p.__d = !0, p.__h = [], p._sb = []), M && null == p.__s && (p.__s = p.state), M && null != F.getDerivedStateFromProps && (p.__s == p.state && (p.__s = m$1({}, p.__s)), m$1(p.__s, F.getDerivedStateFromProps(x, p.__s))), y = p.props, d = p.state, p.__v = u, v) M && null == F.getDerivedStateFromProps && null != p.componentWillMount && p.componentWillMount(), M && null != p.componentDidMount && p.__h.push(p.componentDidMount);
				else {
					if (M && null == F.getDerivedStateFromProps && x !== y && null != p.componentWillReceiveProps && p.componentWillReceiveProps(x, P), u.__v == t.__v || !p.__e && null != p.shouldComponentUpdate && !1 === p.shouldComponentUpdate(x, p.__s, P)) {
						u.__v != t.__v && (p.props = x, p.state = p.__s, p.__d = !1), u.__e = t.__e, u.__k = t.__k, u.__k.some(function(n) {
							n && (n.__ = u);
						}), w$1.push.apply(p.__h, p._sb), p._sb = [], p.__h.length && e.push(p), f = $(t);
						break n;
					}
					null != p.componentWillUpdate && p.componentWillUpdate(x, p.__s, P), M && null != p.componentDidUpdate && p.__h.push(function() {
						p.componentDidUpdate(y, d, _);
					});
				}
				if (p.context = P, p.props = x, p.__P = n, p.__e = !1, A = l$1.__r, H = 0, M) p.state = p.__s, p.__d = !1, A && A(u), s = p.render(p.props, p.state, p.context), w$1.push.apply(p.__h, p._sb), p._sb = [];
				else do
					p.__d = !1, A && A(u), s = p.render(p.props, p.state, p.context), p.state = p.__s;
				while (p.__d && ++H < 25);
				p.state = p.__s, null != p.getChildContext && (i = m$1(m$1({}, i), p.getChildContext())), M && !v && null != p.getSnapshotBeforeUpdate && (_ = p.getSnapshotBeforeUpdate(y, d)), T = null != s && s.type === S && null == s.key ? E(s.props.children) : s, f = L(n, g(T) ? T : [T], u, t, i, r, o, e, f, c, a), p.base = u.__e, u.__u &= -161, p.__h.length && e.push(p), k && (p.__E = p.__ = null);
			} catch (n) {
				if (e.length = h, u.__v = null, c || null != o) {
					if (n.then) {
						for (u.__u |= c ? 160 : 128; f && 8 == f.nodeType && f.nextSibling;) f = f.nextSibling;
						null != o && (o[o.indexOf(f)] = null), u.__e = f;
					} else if (null != o) for (j = o.length; j--;) b(o[j]);
				} else u.__e = t.__e;
				u.__k ??= t.__k || [], n.then || B$1(u), l$1.__e(n, u, t);
			}
		} else null == o && u.__v == t.__v ? (u.__k = t.__k, u.__e = t.__e) : f = u.__e = G(t.__e, u, t, i, r, o, e, c, a);
		return (s = l$1.diffed) && s(u), 128 & u.__u ? void 0 : f;
	}
	function B$1(n) {
		n && (n.__c && (n.__c.__e = !0), n.__k && n.__k.some(B$1));
	}
	function D$1(n, u, t) {
		for (var i = 0; i < t.length; i++) J(t[i], t[++i], t[++i]);
		l$1.__c && l$1.__c(u, n), n.some(function(u) {
			try {
				n = u.__h, u.__h = [], n.some(function(n) {
					n.call(u);
				});
			} catch (n) {
				l$1.__e(n, u.__v);
			}
		});
	}
	function E(n) {
		return "object" != typeof n || null == n || n.__b > 0 ? n : g(n) ? n.map(E) : void 0 !== n.constructor ? null : m$1({}, n);
	}
	function G(u, t, i, r, o, e, f, c, a) {
		var s, h, p, v, y, w, _, m = i.props || d$1, k = t.props, x = t.type;
		if ("svg" == x ? o = "http://www.w3.org/2000/svg" : "math" == x ? o = "http://www.w3.org/1998/Math/MathML" : o || (o = "http://www.w3.org/1999/xhtml"), null != e) {
			for (s = 0; s < e.length; s++) if ((y = e[s]) && "setAttribute" in y == !!x && (x ? y.localName == x : 3 == y.nodeType)) {
				u = y, e[s] = null;
				break;
			}
		}
		if (null == u) {
			if (null == x) return document.createTextNode(k);
			u = document.createElementNS(o, x, k.is && k), c && (l$1.__m && l$1.__m(t, e), c = !1), e = null;
		}
		if (null == x) m === k || c && u.data == k || (u.data = k);
		else {
			if (e = "textarea" == x && null != k.defaultValue ? null : e && n.call(u.childNodes), !c && null != e) for (m = {}, s = 0; s < u.attributes.length; s++) m[(y = u.attributes[s]).name] = y.value;
			for (s in m) y = m[s], "dangerouslySetInnerHTML" == s ? p = y : "children" == s || s in k || "value" == s && "defaultValue" in k || "checked" == s && "defaultChecked" in k || N(u, s, null, y, o);
			for (s in k) y = k[s], "children" == s ? v = y : "dangerouslySetInnerHTML" == s ? h = y : "value" == s ? w = y : "checked" == s ? _ = y : c && "function" != typeof y || m[s] === y || N(u, s, y, m[s], o);
			if (h) c || p && (h.__html == p.__html || h.__html == u.innerHTML) || (u.innerHTML = h.__html), t.__k = [];
			else if (p && (u.innerHTML = ""), L("template" == t.type ? u.content : u, g(v) ? v : [v], t, i, r, "foreignObject" == x ? "http://www.w3.org/1999/xhtml" : o, e, f, e ? e[0] : i.__k && $(i, 0), c, a), null != e) for (s = e.length; s--;) b(e[s]);
			c && "textarea" != x || (s = "value", "progress" == x && null == w ? u.removeAttribute("value") : null != w && (w !== u[s] || "progress" == x && !w || "option" == x && w != m[s]) && N(u, s, w, m[s], o), s = "checked", null != _ && _ != u[s] && N(u, s, _, m[s], o));
		}
		return u;
	}
	function J(n, u, t) {
		try {
			if ("function" == typeof n) {
				var i = "function" == typeof n.__u;
				i && n.__u(), i && null == u || (n.__u = n(u));
			} else n.current = u;
		} catch (n) {
			l$1.__e(n, t);
		}
	}
	function K(n, u, t) {
		var i, r;
		if (l$1.unmount && l$1.unmount(n), (i = n.ref) && (i.current && i.current != n.__e || J(i, null, u)), null != (i = n.__c)) {
			if (i.componentWillUnmount) try {
				i.componentWillUnmount();
			} catch (n) {
				l$1.__e(n, u);
			}
			i.base = i.__P = i.__n = null;
		}
		if (i = n.__k) for (r = 0; r < i.length; r++) i[r] && K(i[r], u, t || "function" != typeof n.type);
		t || b(n.__e), n.__c = n.__ = n.__e = void 0;
	}
	function Q(n, l, u) {
		return this.constructor(n, u);
	}
	function R(u, t, i) {
		var r, o, e, f;
		t == document && (t = document.documentElement), l$1.__ && l$1.__(u, t), o = (r = "function" == typeof i) ? null : i && i.__k || t.__k, e = [], f = [], q$1(t, u = (!r && i || t).__k = k$1(S, null, [u]), o || d$1, d$1, t.namespaceURI, !r && i ? [i] : o ? null : t.firstChild ? n.call(t.childNodes) : null, e, !r && i ? i : o ? o.__e : t.firstChild, r, f), D$1(e, u, f), u.props.children = null;
	}
	n = w$1.slice, l$1 = { __e: function(n, l, u, t) {
		for (var i, r, o; l = l.__;) if ((i = l.__c) && !i.__) try {
			if ((r = i.constructor) && null != r.getDerivedStateFromError && (i.setState(r.getDerivedStateFromError(n)), o = i.__d), null != i.componentDidCatch && (i.componentDidCatch(n, t || {}), o = i.__d), o) return i.__E = i;
		} catch (l) {
			n = l;
		}
		throw n;
	} }, u$2 = 0, C$1.prototype.setState = function(n, l) {
		var u = null != this.__s && this.__s != this.state ? this.__s : this.__s = m$1({}, this.state);
		"function" == typeof n && (n = n(m$1({}, u), this.props)), n && m$1(u, n), null != n && this.__v && (l && this._sb.push(l), A$1(this));
	}, C$1.prototype.forceUpdate = function(n) {
		this.__v && (this.__e = !0, n && this.__h.push(n), A$1(this));
	}, C$1.prototype.render = S, i$2 = [], o$1 = "function" == typeof Promise ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, e$1 = function(n, l) {
		return n.__v.__b - l.__v.__b;
	}, H.__r = 0, f$2 = Math.random().toString(8), c$1 = "__d" + f$2, a$1 = "__a" + f$2, s$1 = /(PointerCapture)$|Capture$/i, h$1 = 0, p$1 = V(!1), v$1 = V(!0);
	var f$1 = 0;
	Array.isArray;
	function u$1(e, t, n, o, i, u) {
		t || (t = {});
		var a, c, p = t;
		if ("ref" in p) for (c in p = {}, t) "ref" == c ? a = t[c] : p[c] = t[c];
		var l = {
			type: e,
			props: p,
			key: n,
			ref: a,
			__k: null,
			__: null,
			__b: 0,
			__e: null,
			__c: null,
			constructor: void 0,
			__v: --f$1,
			__i: -1,
			__u: 0,
			__source: i,
			__self: u
		};
		if ("function" == typeof e && (a = e.defaultProps)) for (c in a) void 0 === p[c] && (p[c] = a[c]);
		return l$1.vnode && l$1.vnode(l), l;
	}
	function Svg(props) {
		return u$1("svg", {
			viewBox: "0 0 24 24",
			width: "20",
			height: "20",
			fill: "none",
			stroke: "currentColor",
			"stroke-width": "1.7",
			"stroke-linecap": "round",
			"stroke-linejoin": "round",
			"aria-hidden": "true",
			...props
		});
	}
	var IconList = (p) => u$1(Svg, {
		...p,
		children: [
			u$1("path", { d: "M9 6h11M9 12h11M9 18h11" }),
			u$1("circle", {
				cx: "4.5",
				cy: "6",
				r: "1",
				fill: "currentColor",
				stroke: "none"
			}),
			u$1("circle", {
				cx: "4.5",
				cy: "12",
				r: "1",
				fill: "currentColor",
				stroke: "none"
			}),
			u$1("circle", {
				cx: "4.5",
				cy: "18",
				r: "1",
				fill: "currentColor",
				stroke: "none"
			})
		]
	});
	var IconSliders = (p) => u$1(Svg, {
		...p,
		children: [
			u$1("path", { d: "M4 7h9M17 7h3M4 17h3M11 17h9" }),
			u$1("circle", {
				cx: "15",
				cy: "7",
				r: "2"
			}),
			u$1("circle", {
				cx: "9",
				cy: "17",
				r: "2"
			})
		]
	});
	var IconArrowUp = (p) => u$1(Svg, {
		...p,
		children: u$1("path", { d: "M12 19V5M6 11l6-6 6 6" })
	});
	var IconExit = (p) => u$1(Svg, {
		...p,
		children: [u$1("path", { d: "M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" }), u$1("path", { d: "M10 16l-4-4 4-4M6 12h10" })]
	});
	var IconBook = (p) => u$1(Svg, {
		...p,
		children: [u$1("path", { d: "M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2z" }), u$1("path", { d: "M12 6.5v13" })]
	});
	var IconWand = (p) => u$1(Svg, {
		...p,
		children: [u$1("path", { d: "M15 4V2M15 10V8M11 6h2M17 6h2M4 20l10-10" }), u$1("path", { d: "M18.5 9.5l1 1M18.5 2.5l1-1M11.5 2.5l-1-1" })]
	});
	var IconCheck = (p) => u$1(Svg, {
		...p,
		children: u$1("path", { d: "M5 12.5l4.5 4.5L19 7.5" })
	});
	var IconMoon = (p) => u$1(Svg, {
		...p,
		children: u$1("path", { d: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" })
	});
	var IconClose = (p) => u$1(Svg, {
		...p,
		children: u$1("path", { d: "M6 6l12 12M18 6L6 18" })
	});
	var IconChevronLeft = (p) => u$1(Svg, {
		...p,
		children: u$1("path", { d: "M15 5l-7 7 7 7" })
	});
	var IconChevronRight = (p) => u$1(Svg, {
		...p,
		children: u$1("path", { d: "M9 5l7 7-7 7" })
	});
	var IconRefresh = (p) => u$1(Svg, {
		...p,
		children: u$1("path", { d: "M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4" })
	});
	var IconLocate = (p) => u$1(Svg, {
		...p,
		children: [u$1("circle", {
			cx: "12",
			cy: "12",
			r: "3"
		}), u$1("path", { d: "M12 2v3M12 19v3M2 12h3M19 12h3" })]
	});
	var IconBookmark = (p) => u$1(Svg, {
		...p,
		children: u$1("path", { d: "M6.5 4.5h11a1 1 0 0 1 1 1V20l-6.5-4-6.5 4V5.5a1 1 0 0 1 1-1z" })
	});
	var IconFilter = (p) => u$1(Svg, {
		...p,
		children: u$1("path", { d: "M4 5h16l-6 7.5V19l-4-2v-4.5z" })
	});
	var IconCopy = (p) => u$1(Svg, {
		...p,
		children: [u$1("rect", {
			x: "8.5",
			y: "8.5",
			width: "11",
			height: "11",
			rx: "2"
		}), u$1("path", { d: "M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" })]
	});
	var IconTrash = (p) => u$1(Svg, {
		...p,
		children: u$1("path", { d: "M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-12M9.5 7V4.5h5V7" })
	});
	var IconShelf = (p) => u$1(Svg, {
		...p,
		children: u$1("path", { d: "M5 4.5v15M9 4.5v15M13.5 5.2l4.6 13.8M3.5 19.5h17" })
	});
	var IconSwap = (p) => u$1(Svg, {
		...p,
		children: u$1("path", { d: "M5 8.5h13M14.5 5 18 8.5 14.5 12M19 15.5H6M9.5 12 6 15.5 9.5 19" })
	});
	var IconExternal = (p) => u$1(Svg, {
		...p,
		children: u$1("path", { d: "M13.5 5H19v5.5M19 5l-8 8M17 14v4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V8.5A1.5 1.5 0 0 1 6.5 7H10" })
	});
	var IconSearch = (p) => u$1(Svg, {
		...p,
		children: [u$1("circle", {
			cx: "10.5",
			cy: "10.5",
			r: "5.5"
		}), u$1("path", { d: "m14.5 14.5 4.5 4.5" })]
	});
	var IconDownload = (p) => u$1(Svg, {
		...p,
		children: u$1("path", { d: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" })
	});
	var IconUpload = (p) => u$1(Svg, {
		...p,
		children: u$1("path", { d: "M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14" })
	});
	function Entry({ kind, onClick, onDismiss }) {
		return u$1("div", {
			class: "nr-ui nr-entry",
			"data-theme": "dark",
			children: [u$1("button", {
				class: "nr-entry-main",
				onClick,
				title: kind === "read" ? "进入阅读模式" : "点选正文和下一章来适配本站",
				children: [kind === "read" ? u$1(IconBook, {
					width: 18,
					height: 18
				}) : u$1(IconWand, {
					width: 18,
					height: 18
				}), kind === "read" ? "阅读模式" : "适配本站"]
			}), u$1("button", {
				class: "nr-entry-close",
				onClick: onDismiss,
				title: "本页隐藏",
				children: u$1(IconClose, {})
			})]
		});
	}
	var styles_default = ":host{all:initial}*{box-sizing:border-box}.nr-ui{--accent:#e5484d;--accent-soft:#e5484d1a;--ui-font:-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", \"Noto Sans CJK SC\", sans-serif;--ease:cubic-bezier(.2, .8, .2, 1);font-family:var(--ui-font);color:var(--text);-webkit-font-smoothing:antialiased;font-size:14px;line-height:1.5}.nr-ui[data-theme=parchment]{--bg:#e4d3a8;--paper:#efe3c2;--text:#2b2418;--surface:#f5ecd3;--ctl:#5c461e14;--ctl-hover:#5c461e24;--line:#5c461e24;--muted:#2b24188c;--shadow:0 1px 2px #503c1414, 0 8px 24px #503c141a}.nr-ui[data-theme=gray]{--bg:#d8d8d8;--paper:#ececec;--text:#222;--surface:#f4f4f4;--ctl:#0000000f;--ctl-hover:#0000001a;--line:#0000001a;--muted:#00000080;--shadow:0 1px 2px #0000000f, 0 8px 24px #00000014}.nr-ui[data-theme=white]{--bg:#ebe7e0;--paper:#faf8f4;--text:#222;--surface:#fffefb;--ctl:#3c2d140f;--ctl-hover:#3c2d141a;--line:#3c2d141a;--muted:#00000080;--shadow:0 1px 2px #3c2d140f, 0 8px 24px #3c2d1414}.nr-ui[data-theme=green]{--bg:#cde3cf;--paper:#e2efe2;--text:#1f2b21;--surface:#eaf5ea;--ctl:#1e462812;--ctl-hover:#1e46281f;--line:#1e46281f;--muted:#1f2b218c;--shadow:0 1px 2px #1e46280f, 0 8px 24px #1e462817}.nr-ui[data-theme=blue]{--bg:#cddde6;--paper:#e2edf3;--text:#1b2830;--surface:#ebf3f7;--ctl:#193c5512;--ctl-hover:#193c551f;--line:#193c551f;--muted:#1b28308c;--shadow:0 1px 2px #193c550f, 0 8px 24px #193c5517}.nr-ui[data-theme=dark]{--accent:#f2555a;--accent-soft:#f2555a24;--bg:#0e0e10;--paper:#18181b;--text:#b4b4b8;--surface:#222226;--ctl:#ffffff0f;--ctl-hover:#ffffff1a;--line:#ffffff14;--muted:#ffffff6b;--shadow:0 1px 2px #0006, 0 10px 30px #00000073}.nr-reader{z-index:2147483646;background:var(--bg);transition:background-color .3s var(--ease);position:fixed;inset:0}.nr-reader:not([data-theme=dark]):before{content:\"\";pointer-events:none;opacity:.35;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .4 0 0 0 0 .32 0 0 0 0 .2 0 0 0 .09 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\");position:absolute;inset:0}.nr-progress{background:var(--accent);z-index:3;transform-origin:0;opacity:.85;pointer-events:none;width:100%;height:2px;transition:transform .15s linear;position:fixed;top:0;left:0;transform:scaleX(0)}.nr-scroll{scrollbar-width:thin;scrollbar-color:var(--line) transparent;outline:none;position:absolute;inset:0;overflow:hidden auto}.nr-paper{width:var(--pw);background:var(--paper);min-height:100%;box-shadow:0 0 0 1px var(--line), 0 0 40px #0000000a;transition:background-color .3s var(--ease), width .25s var(--ease);margin:0 auto;padding:56px 64px 40px;position:relative}.nr-chapter{font-family:var(--read-font);font-size:var(--fs);line-height:var(--lh);color:var(--text);word-break:break-word;animation:nr-fade-in .35s var(--ease)}.nr-chapter+.nr-chapter{border-top:1px dashed var(--line);margin-top:72px;padding-top:56px}.nr-chapter h1{margin:8px 0 calc(var(--fs) * 1.6);font-size:calc(var(--fs) * 1.36);letter-spacing:.02em;font-weight:700;line-height:1.4}.nr-chapter p{margin:0 0 var(--ps);text-indent:var(--indent,2em);text-align:var(--align,justify)}@keyframes nr-fade-in{0%{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.nr-status{color:var(--muted);text-align:center;flex-direction:column;align-items:center;gap:14px;padding:56px 0 72px;font-size:14px;display:flex}.nr-status .nr-status-title{color:var(--text);font-size:15px;font-weight:600}.nr-status .nr-status-msg{word-break:break-all;max-width:420px}.nr-status.is-full{justify-content:center;min-height:70vh}.nr-spinner{border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;width:22px;height:22px;animation:.8s linear infinite nr-spin}@keyframes nr-spin{to{transform:rotate(360deg)}}.nr-pager{grid-template-columns:1fr auto 1fr;gap:12px;margin-top:56px;padding-bottom:24px;display:grid}.nr-pager .nr-btn{height:44px;font-size:15px}.nr-btn{background:var(--ctl);height:36px;color:var(--text);font:inherit;cursor:pointer;white-space:nowrap;-webkit-user-select:none;user-select:none;border:1px solid #0000;border-radius:10px;justify-content:center;align-items:center;gap:6px;padding:0 14px;transition:background-color .15s,border-color .15s,color .15s,transform .1s;display:inline-flex}.nr-btn:hover:not(:disabled){background:var(--ctl-hover)}.nr-btn:active:not(:disabled){transform:scale(.97)}.nr-btn:disabled{opacity:.4;cursor:default}.nr-btn.is-active{border-color:var(--accent);background:var(--accent-soft);color:var(--accent)}.nr-btn.is-primary{background:var(--accent);color:#fff}.nr-btn.is-primary:hover:not(:disabled){background:var(--accent);filter:brightness(1.06)}.nr-btn.is-ghost{background:0 0}.nr-btn.is-ghost:hover:not(:disabled){background:var(--ctl)}.nr-btn.is-danger{color:var(--accent)}.nr-btn.is-small{border-radius:8px;height:30px;padding:0 10px;font-size:13px}.nr-icon-btn{border-radius:8px;width:32px;height:32px;padding:0}.nr-input,.nr-textarea{border:1px solid var(--line);background:var(--surface);width:100%;color:var(--text);font:inherit;border-radius:10px;outline:none;transition:border-color .15s,box-shadow .15s}.nr-input{height:36px;padding:0 12px}.nr-textarea{resize:vertical;min-height:180px;padding:10px 12px;font-family:ui-monospace,Cascadia Code,Consolas,monospace;font-size:12px;line-height:1.55}.nr-input:focus,.nr-textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}.nr-segment{background:var(--ctl);border-radius:10px;padding:3px;display:inline-flex}.nr-segment button{height:30px;color:var(--muted);font:inherit;cursor:pointer;background:0 0;border:0;border-radius:8px;padding:0 16px;font-size:13px;transition:background-color .2s,color .2s,box-shadow .2s}.nr-segment button.is-active{background:var(--surface);color:var(--text);font-weight:600;box-shadow:0 1px 3px #0000001a}.nr-switch{background:var(--ctl-hover);cursor:pointer;border:0;border-radius:999px;flex:none;width:36px;height:20px;transition:background-color .2s;position:relative}.nr-switch:after{content:\"\";width:16px;height:16px;transition:transform .2s var(--ease);background:#fff;border-radius:50%;position:absolute;top:2px;left:2px;box-shadow:0 1px 2px #00000040}.nr-switch.is-on{background:var(--accent)}.nr-switch.is-on:after{transform:translate(16px)}.nr-chip{background:var(--ctl);height:20px;color:var(--muted);border-radius:6px;align-items:center;padding:0 7px;font-size:11px;font-weight:500;display:inline-flex}.nr-chip.is-accent{background:var(--accent-soft);color:var(--accent)}.nr-toolbar{z-index:4;left:min(calc(50% + var(--pw) / 2 + 14px), calc(100vw - 80px));flex-direction:column;gap:8px;display:flex;position:fixed;bottom:12vh}.nr-tool{background:var(--paper);width:60px;height:60px;color:var(--muted);font:inherit;cursor:pointer;box-shadow:var(--shadow);transition:color .15s, transform .15s var(--ease), background-color .3s;border:0;border-radius:12px;flex-direction:column;justify-content:center;align-items:center;gap:3px;font-size:12px;display:flex}.nr-tool:hover{color:var(--text);transform:translateY(-1px)}.nr-tool.is-active{color:var(--accent)}.nr-backdrop{z-index:5;position:fixed;inset:0}.nr-panel{--panel-w:460px;z-index:6;top:50%;left:clamp(12px, calc(50% + var(--pw,640px) / 2 - var(--panel-w) + 2px), calc(100vw - var(--panel-w) - 90px));width:min(var(--panel-w), calc(100vw - 24px));background:var(--surface);max-height:min(760px,100vh - 48px);color:var(--text);box-shadow:0 0 0 1px var(--line), 0 24px 64px #0000002e, 0 4px 12px #0000000f;animation:nr-panel-in .24s var(--ease);border-radius:16px;flex-direction:column;display:flex;position:fixed;overflow:hidden;transform:translateY(-50%)}.nr-panel.is-toc{--panel-w:380px;height:min(760px,100vh - 48px)}@keyframes nr-panel-in{0%{opacity:0;transform:translateY(calc(10px - 50%))scale(.985)}to{opacity:1;transform:translateY(-50%)}}.nr-panel-head{justify-content:space-between;align-items:center;gap:12px;padding:20px 20px 14px;display:flex}.nr-panel-head h2{letter-spacing:.02em;margin:0;font-size:20px;font-weight:650}.nr-panel-body{scrollbar-width:thin;scrollbar-color:var(--line) transparent;flex:1;min-height:0;padding:4px 20px 20px;overflow-y:auto}.nr-panel-sub{justify-content:space-between;align-items:center;gap:8px;padding:0 20px 12px;display:flex}.nr-book-search .nr-input{flex:1;min-width:0}.nr-book-search .nr-btn{flex:none}.nr-search-group+.nr-search-group{margin-top:16px}.nr-search-group h3{color:var(--muted);margin:6px 0;font-size:13px}.nr-search-group .nr-btn+.nr-btn{margin-left:6px}.nr-search-book{border-bottom:1px solid var(--line);padding:10px 0}.nr-search-book-row,.nr-search-book-link{align-items:center;gap:8px;display:flex}.nr-search-book-row{justify-content:space-between}.nr-search-book-link{min-width:0;color:var(--text);overflow-wrap:anywhere;text-decoration:none}.nr-search-book-link:hover{color:var(--accent)}.nr-search-book-link svg,.nr-search-book-row>button{flex:none}.nr-search-book>p{margin:6px 0 0}.nr-search-book small{color:var(--muted);display:block}@media (width>=761px) and (height<=680px),(height<=460px){.nr-reader .nr-toolbar{--tool-size:clamp(28px, 9vh, 46px);gap:4px}.nr-toolbar .nr-tool{width:var(--tool-size);height:var(--tool-size);gap:0;font-size:0}}.nr-row{grid-template-columns:64px 1fr;align-items:center;gap:12px;padding:10px 0;display:grid}.nr-row-label{color:var(--muted);font-size:13px}.nr-options{flex-wrap:wrap;gap:8px;display:flex}.nr-options .nr-btn{flex:1 1 0;min-width:0;padding:0 8px}.nr-options.is-compact .nr-btn{flex:auto}.nr-swatches{flex-wrap:wrap;gap:12px;display:flex}.nr-swatch{cursor:pointer;width:38px;height:38px;color:var(--accent);transition:transform .15s var(--ease), box-shadow .15s;border:1px solid #0000001a;border-radius:50%;place-items:center;display:grid;position:relative}.nr-swatch:hover{transform:scale(1.06)}.nr-swatch.is-active{box-shadow:0 0 0 2px var(--surface), 0 0 0 3.5px var(--accent)}.nr-swatch[data-swatch=dark]{color:#ddd}.nr-stepper{background:var(--ctl);border-radius:10px;grid-template-columns:1fr 1fr 1fr;align-items:center;height:36px;display:grid;overflow:hidden}.nr-stepper button{height:100%;color:var(--text);font:inherit;cursor:pointer;background:0 0;border:0;font-size:16px;font-weight:600;transition:background-color .15s}.nr-stepper button:hover:not(:disabled){background:var(--ctl-hover)}.nr-stepper button:disabled{opacity:.35;cursor:default}.nr-stepper span{text-align:center;font-variant-numeric:tabular-nums;color:var(--muted);font-size:15px}.nr-toc-tools{align-items:center;gap:8px;padding:0 20px 10px;display:flex}.nr-toc-tools .nr-input{flex:1;min-width:0;height:32px;font-size:13px}.nr-toc-list{margin:0;padding:0 10px 16px;list-style:none}.nr-toc-list>li{content-visibility:auto;contain-intrinsic-size:auto 38px}.nr-toc-item{width:100%;height:38px;color:var(--text);font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:8px;align-items:center;gap:8px;padding:0 10px;font-size:14px;transition:background-color .12s;display:flex}.nr-toc-item:hover{background:var(--ctl)}.nr-toc-item .nr-toc-title{text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;overflow:hidden}.nr-toc-item.is-read{color:var(--muted)}.nr-toc-item.is-current{background:var(--accent-soft);color:var(--accent);font-weight:600}.nr-empty{text-align:center;color:var(--muted);padding:40px 20px}.nr-site{border:1px solid var(--line);background:var(--paper);border-radius:12px;margin-bottom:10px;padding:12px 14px}.nr-site.is-current{border-color:var(--accent)}.nr-site-head{align-items:center;gap:8px;display:flex}.nr-site-name{text-overflow:ellipsis;white-space:nowrap;font-weight:600;overflow:hidden}.nr-site-hosts{color:var(--muted);margin-top:2px;font-size:12px}.nr-site-actions{flex-wrap:wrap;gap:6px;margin-top:10px;display:flex}.nr-site-editor{margin-top:10px}.nr-error{background:var(--accent-soft);color:var(--accent);word-break:break-all;border-radius:8px;margin-top:8px;padding:8px 10px;font-size:12px}.nr-hint{color:var(--muted);font-size:12px}.nr-add-row{gap:8px;margin-bottom:14px;display:flex}.nr-add-row .nr-input{flex:1}.nr-toast{z-index:8;color:#fff;max-width:min(560px,100vw - 32px);animation:nr-fade-in .25s var(--ease);background:#1e1e20eb;border-radius:12px;padding:10px 16px;font-size:13px;position:fixed;bottom:40px;left:50%;transform:translate(-50%);box-shadow:0 8px 24px #00000040}.nr-entry{z-index:2147483645;-webkit-backdrop-filter:blur(12px);animation:nr-fade-in .3s var(--ease);background:#1c1c1ee0;border-radius:999px;align-items:center;gap:2px;padding:4px;display:flex;position:fixed;bottom:24px;right:24px;box-shadow:0 8px 28px #00000040,inset 0 0 0 1px #ffffff14}.nr-entry-main{color:#fff;height:40px;font:inherit;cursor:pointer;background:0 0;border:0;border-radius:999px;align-items:center;gap:8px;padding:0 16px 0 14px;font-size:14px;font-weight:600;transition:background-color .15s;display:flex}.nr-entry-main:hover{background:#ffffff1a}.nr-entry-main svg{color:#ff7a7e}.nr-entry-close{color:#ffffff80;cursor:pointer;background:0 0;border:0;border-radius:50%;place-items:center;width:30px;height:30px;display:grid}.nr-entry-close:hover{color:#fff;background:#ffffff1a}.nr-entry-close svg{width:14px;height:14px}.nr-pick-box{z-index:2147483644;pointer-events:none;border-radius:4px;transition:all 80ms linear;position:fixed}.nr-pick-box.is-hover{background:#e5484d14;outline:2px dashed #e5484d}.nr-pick-box.is-chosen{background:#16a34a14;outline:2px solid #16a34a}.nr-pick-tag{color:#fff;white-space:nowrap;background:#16a34a;border-radius:6px 6px 6px 0;padding:1px 8px;font-size:12px;position:absolute;top:-22px;left:-2px}.nr-pick-bar{z-index:2147483646;background:var(--surface);width:min(620px,100vw - 24px);max-height:calc(100vh - 32px);color:var(--text);box-shadow:0 0 0 1px var(--line), 0 24px 64px #00000040;animation:nr-fade-in .25s var(--ease);border-radius:16px;padding:16px 18px;position:fixed;top:16px;left:50%;overflow-y:auto;transform:translate(-50%)}.nr-pick-steps{gap:6px;margin-bottom:12px;display:flex}.nr-pick-step{background:var(--ctl-hover);border-radius:2px;flex:1;height:4px}.nr-pick-step.is-done{background:#16a34a}.nr-pick-step.is-active{background:var(--accent)}.nr-pick-title{font-size:16px;font-weight:650}.nr-pick-desc{color:var(--muted);margin-top:4px;font-size:13px}.nr-pick-current{background:var(--ctl);word-break:break-all;border-radius:10px;margin-top:10px;padding:8px 10px;font-size:12px}.nr-pick-current code{font-family:ui-monospace,Consolas,monospace}.nr-pick-actions{flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:12px;display:flex}.nr-pick-actions .nr-spacer{flex:1}.nr-preview{background:var(--paper);border-radius:10px;max-height:240px;margin-top:10px;padding:12px 14px;font-size:14px;line-height:1.8;overflow-y:auto}.nr-preview h4{margin:0 0 6px;font-size:15px}.nr-preview p{text-indent:2em;margin:0 0 6px}.nr-kv{grid-template-columns:72px 1fr;gap:4px 10px;margin-top:10px;font-size:12px;display:grid}.nr-kv dt{color:var(--muted)}.nr-kv dd{word-break:break-all;margin:0}.nr-toc-badge{background:var(--ctl);color:var(--muted);border-radius:5px;flex:none;padding:0 6px;font-size:11px;font-weight:500;line-height:18px}.nr-selpop{-webkit-user-select:none;user-select:none;z-index:7;-webkit-backdrop-filter:blur(12px);animation:nr-pop-in .16s var(--ease);white-space:nowrap;background:#1c1c1eeb;border-radius:12px;align-items:center;padding:4px;display:flex;position:fixed;transform:translate(-50%,calc(-100% - 10px));box-shadow:0 8px 24px #00000040}@keyframes nr-pop-in{0%{opacity:0;transform:translate(-50%,calc(-100% - 4px))}to{opacity:1;transform:translate(-50%,calc(-100% - 10px))}}.nr-selpop:after{content:\"\";background:inherit;border-radius:2px;width:10px;height:10px;position:absolute;bottom:-5px;left:50%;transform:translate(-50%)rotate(45deg)}.nr-selpop.is-below{animation:nr-pop-in-below .16s var(--ease);transform:translate(-50%,10px)}@keyframes nr-pop-in-below{0%{opacity:0;transform:translate(-50%,4px)}to{opacity:1;transform:translate(-50%,10px)}}.nr-selpop.is-below:after{top:-5px;bottom:auto}.nr-selpop button{z-index:1;color:#fff;height:32px;font:inherit;cursor:pointer;background:0 0;border:0;border-radius:8px;align-items:center;gap:5px;padding:0 12px;font-size:13px;display:inline-flex;position:relative}.nr-selpop button:hover{background:#ffffff1f}.nr-selpop-sep{background:#ffffff2e;width:1px;height:16px}.nr-excerpts{margin:0;padding:0 0 12px;list-style:none}.nr-excerpt{cursor:pointer;border-radius:10px;align-items:flex-start;gap:10px;padding:10px;transition:background-color .12s;display:flex}.nr-excerpt:hover{background:var(--ctl)}.nr-excerpt.is-checked{background:var(--accent-soft)}.nr-check{border:1.5px solid var(--line);background:var(--surface);color:#fff;border-radius:5px;flex:none;place-items:center;width:18px;height:18px;margin-top:2px;transition:background-color .12s,border-color .12s;display:grid}.nr-excerpt.is-checked .nr-check{border-color:var(--accent);background:var(--accent)}.nr-excerpt-main{flex:1;min-width:0}.nr-excerpt-text{word-break:break-word;font-size:15px;line-height:1.6}.nr-excerpt-meta{color:var(--muted);margin-top:2px;font-size:12px}.nr-excerpt-del{opacity:0;flex:none;width:26px;height:26px;transition:opacity .12s}.nr-excerpt:hover .nr-excerpt-del,.nr-excerpt:focus-within .nr-excerpt-del,.nr-excerpt-del:focus-visible{opacity:1}.nr-panel-foot{border-top:1px solid var(--line);padding:12px 16px 16px}.nr-strips{flex-wrap:wrap;gap:6px;margin-top:10px;display:flex}.nr-strip{background:var(--ctl);border-radius:6px;align-items:center;gap:2px;max-width:100%;padding:2px 4px 2px 8px;font-size:12px;display:inline-flex}.nr-strip span{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.nr-strip button{width:18px;height:18px;color:var(--muted);cursor:pointer;background:0 0;border:0;border-radius:4px;place-items:center;padding:0;display:grid}.nr-strip button:hover{background:var(--ctl-hover);color:var(--accent)}.nr-shelf-current{flex:1;min-width:0}.nr-shelf-name{text-overflow:ellipsis;white-space:nowrap;font-weight:650;overflow:hidden}.nr-shelf-book{border:1px solid var(--line);background:var(--paper);border-radius:12px;margin-bottom:10px;padding:12px}.nr-shelf-title{align-items:baseline;gap:8px;margin-bottom:6px;display:flex}.nr-shelf-source{border-radius:8px;align-items:center;gap:4px;display:flex}.nr-shelf-source.is-current .nr-chip{background:var(--accent-soft);color:var(--accent)}.nr-shelf-open{min-width:0;color:var(--text);font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:8px;flex:1;align-items:center;gap:8px;padding:7px 8px;font-size:13px;transition:background-color .12s;display:flex}.nr-shelf-open:hover{background:var(--ctl)}.nr-shelf-last{text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;overflow:hidden}.nr-shelf-del{opacity:0;width:26px;height:26px;transition:opacity .12s}.nr-shelf-source:hover .nr-shelf-del,.nr-shelf-source:focus-within .nr-shelf-del,.nr-shelf-del:focus-visible{opacity:1}.nr-empty svg{margin:0 auto 10px;display:block}.nr-filter-section+.nr-filter-section,.nr-filter-section+.nr-error{margin-top:18px}.nr-filter-title{align-items:center;gap:8px;font-weight:650;display:flex}.nr-filter-section>.nr-hint{margin:4px 0 8px;line-height:1.6}.nr-filter-list{border:1px solid var(--line);background:var(--paper);border-radius:10px;margin:0;padding:0;list-style:none;overflow:hidden}.nr-filter-list li{align-items:center;gap:8px;min-height:36px;padding:6px 6px 6px 12px;display:flex}.nr-filter-list li+li{border-top:1px solid var(--line)}.nr-filter-list code{word-break:break-all;flex:none;max-width:60%;font-family:ui-monospace,Cascadia Code,Consolas,monospace;font-size:12px}.nr-filter-list li>.nr-hint{text-align:right;flex:1}.nr-filter-text{word-break:break-all;flex:1;min-width:0;font-size:13px}.nr-filter-list li:has(code) .nr-filter-del{margin-left:auto}.nr-filter-del{flex:none;width:26px;height:26px}.nr-filter-empty{padding:4px 0}@media (width<=760px){.nr-paper{box-shadow:none;padding:32px 20px 24px}.nr-toolbar{bottom:16px;left:auto;right:10px}.nr-tool{gap:0;width:46px;height:46px;font-size:0}.nr-panel,.nr-panel.is-toc{left:12px}.nr-reader{--pw:100vw!important}}.nr-data-list{border:1px solid var(--line);background:var(--paper);border-radius:10px;margin:0;padding:0;list-style:none;overflow:hidden}.nr-data-list li{cursor:pointer;gap:10px;padding:10px 12px;transition:background-color .12s;display:flex}.nr-data-list li+li{border-top:1px solid var(--line)}.nr-data-list li:hover{background:var(--ctl)}.nr-data-list li.is-checked .nr-check{border-color:var(--accent);background:var(--accent)}.nr-data-main{flex:1;min-width:0}.nr-data-name{flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:2px;font-size:14px;font-weight:550;display:flex}.nr-data-file{flex-wrap:wrap;align-items:baseline;gap:4px 10px;margin-bottom:8px;display:flex}.nr-source{border:1px solid var(--line);background:var(--paper);border-radius:12px;align-items:center;gap:8px;margin-top:8px;padding:4px 8px 4px 4px;display:flex}.nr-source.is-current{border-color:var(--accent);background:var(--accent-soft)}.nr-source.is-missing{opacity:.6}.nr-source-main{min-width:0;color:inherit;font:inherit;text-align:left;background:0 0;border:0;border-radius:9px;flex:1;padding:8px 10px}button.nr-source-main{cursor:pointer;transition:background-color .12s}button.nr-source-main:hover{background:var(--ctl)}.nr-source-line{flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:4px;display:flex}.nr-source-site{font-weight:650}.nr-source-match{margin-left:auto}.nr-source .nr-hint{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.nr-chip.is-warn{color:#b26b00;background:#d68c1e29}.nr-diff-up{color:#2f8f4e;font-weight:600}.nr-diff-down{color:#c0392b;font-weight:600}.nr-spinner.is-small{flex:none;width:16px;height:16px;margin-right:8px}.nr-statusbar{z-index:3;max-width:min(var(--pw,640px), calc(100vw - 180px));background:var(--surface);border:1px solid var(--line);color:var(--muted);pointer-events:none;opacity:.85;font-variant-numeric:tabular-nums;white-space:nowrap;border-radius:999px;align-items:center;gap:12px;padding:3px 12px;font-size:11px;display:flex;position:fixed;bottom:8px;left:50%;transform:translate(-50%)}.nr-statusbar-title{text-overflow:ellipsis;overflow:hidden}";
	var sharedSheet;
	function getStyleSheet() {
		if (sharedSheet) return sharedSheet;
		try {
			if (typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype) {
				const sheet = new CSSStyleSheet();
				sheet.replaceSync(styles_default);
				sharedSheet = sheet;
				return sheet;
			}
		} catch {}
	}
	var STOP_EVENTS = [
		"click",
		"dblclick",
		"mousedown",
		"mouseup",
		"auxclick",
		"pointerdown",
		"pointerup",
		"contextmenu"
	];
	function mountHost(id, vnode) {
		document.getElementById(id)?.remove();
		const host = document.createElement("div");
		host.id = id;
		for (const type of STOP_EVENTS) host.addEventListener(type, (e) => e.stopPropagation());
		const shadow = host.attachShadow({ mode: "open" });
		const container = document.createElement("div");
		const sheet = getStyleSheet();
		if (sheet && "adoptedStyleSheets" in shadow) {
			shadow.adoptedStyleSheets = [sheet];
			shadow.append(container);
		} else {
			const style = document.createElement("style");
			style.textContent = styles_default;
			shadow.append(style, container);
		}
		document.documentElement.append(host);
		R(vnode, container);
		return {
			container,
			destroy() {
				R(null, container);
				host.remove();
			}
		};
	}
	var t;
	var r;
	var u;
	var i;
	var o = 0;
	var f = [];
	var c = l$1;
	var e = c.__b;
	var a = c.__r;
	var v = c.diffed;
	var l = c.__c;
	var m = c.unmount;
	var p = c.__;
	function s(n, t) {
		c.__h && c.__h(r, n, o || t), o = 0;
		var u = r.__H || (r.__H = {
			__: [],
			__h: []
		});
		return n >= u.__.length && u.__.push({}), u.__[n];
	}
	function d(n) {
		return o = 1, y(D, n);
	}
	function y(n, u, i) {
		var o = s(t++, 2);
		if (o.t = n, !o.__c && (o.__ = [i ? i(u) : D(void 0, u), function(n) {
			var t = o.__N ? o.__N[0] : o.__[0], r = o.t(t, n);
			t !== r && (o.__N = [r, o.__[1]], o.__c.setState({}));
		}], o.__c = r, !r.__f)) {
			var f = function(n, t, r) {
				if (!o.__c.__H) return !0;
				var u = !1, i = o.__c.props !== n;
				if (o.__c.__H.__.some(function(n) {
					if (n.__N) {
						u = !0;
						var t = n.__[0];
						n.__ = n.__N, n.__N = void 0, t !== n.__[0] && (i = !0);
					}
				}), c) {
					var f = c.call(this, n, t, r);
					return u ? f || i : f;
				}
				return !u || i;
			};
			r.__f = !0;
			var c = r.shouldComponentUpdate, e = r.componentWillUpdate;
			r.componentWillUpdate = function(n, t, r) {
				if (this.__e) {
					var u = c;
					c = void 0, f(n, t, r), c = u;
				}
				e && e.call(this, n, t, r);
			}, r.shouldComponentUpdate = f;
		}
		return o.__N || o.__;
	}
	function h(n, u) {
		var i = s(t++, 3);
		!c.__s && C(i.__H, u) && (i.__ = n, i.u = u, r.__H.__h.push(i));
	}
	function _(n, u) {
		var i = s(t++, 4);
		!c.__s && C(i.__H, u) && (i.__ = n, i.u = u, r.__h.push(i));
	}
	function A(n) {
		return o = 5, T(function() {
			return { current: n };
		}, []);
	}
	function T(n, r) {
		var u = s(t++, 7);
		return C(u.__H, r) && (u.__ = n(), u.__H = r, u.__h = n), u.__;
	}
	function q(n, t) {
		return o = 8, T(function() {
			return n;
		}, t);
	}
	function j() {
		for (var n; n = f.shift();) {
			var t = n.__H;
			if (n.__P && t) try {
				t.__h.some(z), t.__h.some(B), t.__h = [];
			} catch (r) {
				t.__h = [], c.__e(r, n.__v);
			}
		}
	}
	c.__b = function(n) {
		r = null, e && e(n);
	}, c.__ = function(n, t) {
		n && t.__k && t.__k.__m && (n.__m = t.__k.__m), p && p(n, t);
	}, c.__r = function(n) {
		a && a(n), t = 0;
		var i = (r = n.__c).__H;
		i && (u === r ? (i.__h = [], r.__h = [], i.__.some(function(n) {
			n.__N && (n.__ = n.__N), n.u = n.__N = void 0;
		})) : (i.__h.some(z), i.__h.some(B), i.__h = [], t = 0)), u = r;
	}, c.diffed = function(n) {
		v && v(n);
		var t = n.__c;
		t && t.__H && (t.__H.__h.length && (1 !== f.push(t) && i === c.requestAnimationFrame || ((i = c.requestAnimationFrame) || w)(j)), t.__H.__.some(function(n) {
			n.u && (n.__H = n.u, n.u = void 0);
		})), u = r = null;
	}, c.__c = function(n, t) {
		t.some(function(n) {
			try {
				n.__h.some(z), n.__h = n.__h.filter(function(n) {
					return !n.__ || B(n);
				});
			} catch (r) {
				t.some(function(n) {
					n.__h && (n.__h = []);
				}), t = [], c.__e(r, n.__v);
			}
		}), l && l(n, t);
	}, c.unmount = function(n) {
		m && m(n);
		var t, r = n.__c;
		r && r.__H && (r.__H.__.some(function(n) {
			try {
				z(n);
			} catch (n) {
				t = n;
			}
		}), r.__H = void 0, t && c.__e(t, r.__v));
	};
	var k = "function" == typeof requestAnimationFrame;
	function w(n) {
		var t, r = function() {
			clearTimeout(u), k && cancelAnimationFrame(t), setTimeout(n);
		}, u = setTimeout(r, 35);
		k && (t = requestAnimationFrame(r));
	}
	function z(n) {
		var t = r, u = n.__c;
		"function" == typeof u && (n.__c = void 0, u()), r = t;
	}
	function B(n) {
		var t = r;
		n.__c = n.__(), r = t;
	}
	function C(n, t) {
		return !n || n.length !== t.length || t.some(function(t, r) {
			return t !== n[r];
		});
	}
	function D(n, t) {
		return "function" == typeof t ? t(n) : t;
	}
	var SAFE_IDENT = /^[a-zA-Z][\w-]*$/;
	var DYNAMIC = /\d{3,}/;
	function buildSelector(el) {
		const doc = el.ownerDocument;
		const parts = [];
		let cur = el;
		while (cur && cur !== doc.body && cur !== doc.documentElement) {
			if (cur.id && SAFE_IDENT.test(cur.id) && !DYNAMIC.test(cur.id)) {
				parts.unshift(`#${cur.id}`);
				break;
			}
			const tag = cur.tagName.toLowerCase();
			const classes = [...cur.classList].filter((c) => SAFE_IDENT.test(c) && !DYNAMIC.test(c)).slice(0, 2);
			let part = classes.length ? `${tag}.${classes.join(".")}` : tag;
			const parent = cur.parentElement;
			if (parent) {
				const sameTag = [...parent.children].filter((c) => c.tagName === cur.tagName);
				if ([...parent.children].filter((c) => c.matches(part)).length > 1) part += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
			}
			parts.unshift(part);
			cur = parent;
		}
		const selector = parts.join(" > ");
		if (doc.querySelector(selector) !== el) throw new Error(`无法为所选元素生成唯一选择器（${selector}）`);
		return selector;
	}
	var STEPS = [
		{
			id: "content",
			title: "点选正文区域",
			desc: "在页面上点击小说正文所在的区域；选小了可以点「扩大范围」。"
		},
		{
			id: "next",
			title: "点选「下一章」链接",
			desc: "点击页面上的下一章按钮（不会跳转）。",
			link: true
		},
		{
			id: "title",
			title: "点选章节标题（可跳过）",
			desc: "不选则自动使用页面的 h1 或网页标题。",
			optional: true
		},
		{
			id: "toc",
			title: "点选「目录」链接（可跳过）",
			desc: "用于在没有目录接口时获取全部章节。",
			optional: true,
			link: true
		},
		{
			id: "remove",
			title: "点选要移除的广告块（可跳过）",
			desc: "在正文里点选要移除的广告/干扰元素，可连选多个。",
			optional: true,
			multi: true
		}
	];
	function useRect(el) {
		const [rect, setRect] = d();
		h(() => {
			if (!el) return setRect(void 0);
			const update = () => setRect(el.getBoundingClientRect());
			update();
			window.addEventListener("scroll", update, true);
			window.addEventListener("resize", update);
			return () => {
				window.removeEventListener("scroll", update, true);
				window.removeEventListener("resize", update);
			};
		}, [el]);
		return rect;
	}
	function Box({ el, kind, tag }) {
		const r = useRect(el);
		if (!r) return null;
		return u$1("div", {
			class: `nr-pick-box is-${kind}`,
			style: {
				top: r.top,
				left: r.left,
				width: r.width,
				height: r.height
			},
			children: tag && u$1("span", {
				class: "nr-pick-tag",
				children: tag
			})
		});
	}
	function describe$1(el) {
		return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${[...el.classList].slice(0, 2).map((c) => `.${c}`).join("")}`;
	}
	function Picker({ site, onSave, onCancel }) {
		const [step, setStep] = d(0);
		const [hover, setHover] = d();
		const [picked, setPicked] = d(() => ({
			content: detectContent(document),
			next: findLink(document, void 0, NEXT_TEXT),
			toc: findLink(document, void 0, TOC_TEXT)
		}));
		const [removeEls, setRemoveEls] = d([]);
		const [error, setError] = d();
		const current = STEPS[step];
		const previewing = step >= STEPS.length;
		h(() => {
			if (previewing) return;
			const isOurs = (e) => e.composedPath().some((n) => n instanceof Element && n.id === "nr-picker");
			const target = (e) => {
				const el = e.target;
				return current.link ? el.closest("a") : el;
			};
			const onMove = (e) => {
				if (isOurs(e)) return setHover(void 0);
				setHover(target(e) ?? void 0);
			};
			const onClick = (e) => {
				if (isOurs(e)) return;
				e.preventDefault();
				e.stopImmediatePropagation();
				const el = target(e);
				if (!el) return setError("请点击一个链接");
				setError(void 0);
				if (current.id === "remove") setRemoveEls((prev) => prev.includes(el) ? prev.filter((x) => x !== el) : [...prev, el]);
				else setPicked((p) => ({
					...p,
					[current.id]: el
				}));
			};
			const block = (e) => {
				if (!isOurs(e)) {
					e.preventDefault();
					e.stopImmediatePropagation();
				}
			};
			window.addEventListener("mousemove", onMove, true);
			window.addEventListener("click", onClick, true);
			for (const t of [
				"mousedown",
				"mouseup",
				"auxclick",
				"pointerdown",
				"pointerup"
			]) window.addEventListener(t, block, true);
			return () => {
				window.removeEventListener("mousemove", onMove, true);
				window.removeEventListener("click", onClick, true);
				for (const t of [
					"mousedown",
					"mouseup",
					"auxclick",
					"pointerdown",
					"pointerup"
				]) window.removeEventListener(t, block, true);
			};
		}, [step, previewing]);
		const candidate = T(() => {
			if (!previewing) return {};
			try {
				const { content, next, title, toc } = picked;
				if (!content) throw new Error("还没有选择正文区域");
				if (!next) throw new Error("还没有选择下一章链接");
				const linkLocator = (el) => {
					if (!el) return void 0;
					const text = cleanText(el.textContent);
					const dup = text ? [...document.querySelectorAll("a")].filter((a) => cleanText(a.textContent) === text).length > 1 : false;
					let selector;
					if (!text || dup) try {
						selector = buildSelector(el);
					} catch (e) {
						if (!text) throw e;
					}
					return {
						...text ? { text } : {},
						...selector ? { selector } : {}
					};
				};
				const removeSelectors = removeEls.flatMap((el) => {
					try {
						return [buildSelector(el)];
					} catch {
						return [];
					}
				});
				const entry = {
					...site,
					adapter: void 0,
					freshFirst: void 0,
					chapterPattern: void 0,
					content: buildSelector(content),
					title: title ? buildSelector(title) : void 0,
					next: linkLocator(next),
					prev: void 0,
					tocLink: linkLocator(toc),
					remove: removeSelectors.length ? [...new Set([...site.remove ?? [], ...removeSelectors])] : site.remove
				};
				return {
					entry,
					chapter: extractChapter(document, entry, location.href)
				};
			} catch (e) {
				return { error: e.message };
			}
		}, [
			previewing,
			picked,
			removeEls,
			site
		]);
		const chosen = current && current.id !== "remove" ? picked[current.id] : void 0;
		const expand = () => {
			const parent = chosen?.parentElement;
			if (parent && parent !== document.body && current.id !== "remove") setPicked((p) => ({
				...p,
				[current.id]: parent
			}));
		};
		return u$1("div", {
			class: "nr-ui",
			"data-theme": "white",
			children: [
				!previewing && hover && hover !== chosen && u$1(Box, {
					el: hover,
					kind: "hover"
				}),
				!previewing && chosen && u$1(Box, {
					el: chosen,
					kind: "chosen",
					tag: current.title.replace(/^点选|（可跳过）$/g, "")
				}),
				!previewing && current.id === "remove" && removeEls.map((el, i) => u$1(Box, {
					el,
					kind: "chosen",
					tag: `移除 ${i + 1}`
				}, i)),
				u$1("div", {
					class: "nr-pick-bar",
					children: [
						u$1("div", {
							class: "nr-pick-steps",
							children: [...STEPS, { id: "preview" }].map((s, i) => u$1("div", { class: `nr-pick-step${i < step ? " is-done" : i === step ? " is-active" : ""}` }, s.id))
						}),
						u$1("div", {
							style: "display:flex;align-items:flex-start;gap:8px",
							children: [u$1("div", {
								style: "flex:1",
								children: [u$1("div", {
									class: "nr-pick-title",
									children: previewing ? "预览适配效果" : `${step + 1}. ${current.title}`
								}), u$1("div", {
									class: "nr-pick-desc",
									children: previewing ? `站点：${site.name}。确认无误后保存，之后该站章节页会出现「阅读模式」按钮。` : current.desc
								})]
							}), u$1("button", {
								class: "nr-btn is-ghost nr-icon-btn",
								onClick: onCancel,
								title: "取消适配",
								children: u$1(IconClose, {
									width: 18,
									height: 18
								})
							})]
						}),
						!previewing && u$1("div", {
							class: "nr-pick-current",
							children: current.id === "remove" ? removeEls.length ? u$1("div", {
								class: "nr-strips",
								style: "margin-top:0",
								children: removeEls.map((el, i) => u$1("span", {
									class: "nr-strip",
									children: [u$1("span", { children: describe$1(el) }), u$1("button", {
										title: "移除",
										onClick: () => setRemoveEls((prev) => prev.filter((x) => x !== el)),
										children: u$1(IconClose, {
											width: 12,
											height: 12
										})
									})]
								}, i))
							}) : "尚未选择要移除的广告块" : chosen ? u$1(S, { children: [
								"已选：",
								u$1("code", { children: describe$1(chosen) }),
								current.id === "content" && `（约 ${cleanText(chosen.textContent).length} 字）`,
								current.link && `「${cleanText(chosen.textContent)}」 → ${chosen.href}`
							] }) : "尚未选择"
						}),
						error && u$1("div", {
							class: "nr-error",
							children: error
						}),
						previewing && candidate.error && u$1("div", {
							class: "nr-error",
							children: candidate.error
						}),
						previewing && candidate.chapter && u$1(S, { children: [u$1("div", {
							class: "nr-preview",
							children: [u$1("h4", { children: candidate.chapter.title }), candidate.chapter.paragraphs.slice(0, 4).map((p, i) => u$1("p", { children: p }, i))]
						}), u$1("dl", {
							class: "nr-kv",
							children: [
								u$1("dt", { children: "段落数" }),
								u$1("dd", { children: candidate.chapter.paragraphs.length }),
								u$1("dt", { children: "下一章" }),
								u$1("dd", { children: candidate.chapter.nextUrl ?? "未识别（链接不像章节页）" }),
								u$1("dt", { children: "目录页" }),
								u$1("dd", { children: candidate.chapter.tocUrl ?? "未指定" }),
								u$1("dt", { children: "正文选择器" }),
								u$1("dd", { children: u$1("code", { children: candidate.entry.content }) })
							]
						})] }),
						u$1("div", {
							class: "nr-pick-actions",
							children: [
								step > 0 && u$1("button", {
									class: "nr-btn is-ghost",
									onClick: () => setStep(step - 1),
									children: "上一步"
								}),
								u$1("span", { class: "nr-spacer" }),
								!previewing && current.id === "content" && u$1("button", {
									class: "nr-btn",
									disabled: !chosen,
									onClick: expand,
									children: "扩大范围"
								}),
								!previewing && current.optional && u$1("button", {
									class: "nr-btn",
									onClick: () => {
										if (current.id === "remove") setRemoveEls([]);
										else setPicked((p) => ({
											...p,
											[current.id]: void 0
										}));
										setStep(step + 1);
									},
									children: "跳过"
								}),
								!previewing ? u$1("button", {
									class: "nr-btn is-primary",
									disabled: !current.optional && !chosen,
									onClick: () => setStep(step + 1),
									children: "下一步"
								}) : u$1("button", {
									class: "nr-btn is-primary",
									disabled: !candidate.entry || !candidate.chapter,
									onClick: () => onSave(candidate.entry),
									children: "保存并启用"
								})
							]
						})
					]
				})
			]
		});
	}
	var SOURCES = {
		hans: {
			resource: "opencc-t2cn",
			from: "tw",
			to: "cn"
		},
		hant: {
			resource: "opencc-cn2t",
			from: "cn",
			to: "tw"
		}
	};
	var converters = {};
	function load(mode) {
		const cached = converters[mode];
		if (cached) return cached;
		const { resource, from, to } = SOURCES[mode];
		const p = (async () => {
			const code = _GM_getResourceText(resource);
			if (!code) throw new Error(`简繁转换字典未加载（@resource ${resource} 为空）`);
			const module = { exports: {} };
			new Function("exports", "module", code)(module.exports, module);
			const OpenCC = module.exports;
			if (typeof OpenCC.Converter !== "function") throw new Error("简繁转换字典格式异常");
			return OpenCC.Converter({
				from,
				to
			});
		})();
		converters[mode] = p;
		p.catch(() => delete converters[mode]);
		return p;
	}
	async function getConverter(mode) {
		if (mode === "raw") return (s) => s;
		return load(mode);
	}
	var FULL_TOC_TEXT = /^[\s[【]*(查看|进入|點擊|点击)?(全部|完整|全文)?(章[节節])?目[录錄](列表)?[\s\]】]*$|^(全部|所有)章[节節]$/;
	var NEXT_PAGE_TEXT = /^[\s[【<«‹]*(下一?[页頁]|next(\s*page)?)[\s\]】>»›→]*$/i;
	var MAX_TOC_PAGES = 50;
	var TOC_CONCURRENCY = 4;
	var http = (href) => /^https?:/.test(href);
	function anchorUrl(a) {
		if (a.getAttribute("href") && http(a.href)) return a.href;
		for (const attr of ["data-href", "data-url"]) {
			const v = a.getAttribute(attr);
			if (v) return new URL(v, a.baseURI).href;
		}
		const enc = a.getAttribute("data-enc");
		if (enc) try {
			const decoded = atob(enc);
			if (http(decoded)) return decoded;
		} catch {}
		return "";
	}
	function docAnchors(doc) {
		return [...doc.querySelectorAll("a")].map((a) => ({
			a,
			url: anchorUrl(a),
			title: cleanText(a.textContent)
		}));
	}
	function resolveFilter(parsedDocs, keep) {
		if (keep) return keep;
		const counts = new Map();
		for (const { anchors } of parsedDocs) for (const { url, title } of anchors) if (url && title) {
			const s = urlShape(url);
			counts.set(s, (counts.get(s) ?? 0) + 1);
		}
		const best = [...counts].sort((x, y) => y[1] - x[1])[0]?.[0];
		return (url) => urlShape(url) === best;
	}
	var LIST_SHARE = .8;
	var LIST_MAX_DEPTH = 6;
	function listContainer(doc, chapterAnchors) {
		const counts = new Map();
		for (const a of chapterAnchors) {
			let el = a.parentElement;
			for (let i = 0; el && i < LIST_MAX_DEPTH; i++, el = el.parentElement) {
				const c = counts.get(el) ?? {
					count: 0,
					depth: 0
				};
				c.count++;
				counts.set(el, c);
			}
		}
		for (const el of counts.keys()) {
			let depth = 0;
			for (let p = el.parentElement; p; p = p.parentElement) depth++;
			counts.get(el).depth = depth;
		}
		let best = doc.body;
		let bestDepth = -1;
		for (const [el, c] of counts) if (c.count >= chapterAnchors.length * LIST_SHARE && c.depth > bestDepth) {
			best = el;
			bestDepth = c.depth;
		}
		return best;
	}
	function collectToc(docs, keep) {
		const parsed = docs.map((doc) => ({
			doc,
			anchors: docAnchors(doc)
		}));
		const filter = resolveFilter(parsed, keep);
		const usable = (url) => !!url && filter(url);
		const urlByTitle = new Map();
		for (const { anchors } of parsed) for (const { title, url } of anchors) if (title && usable(url) && !urlByTitle.has(title)) urlByTitle.set(title, url);
		const items = [];
		for (const { doc, anchors } of parsed) {
			const byEl = new Map(anchors.map((info) => [info.a, info]));
			const container = listContainer(doc, anchors.filter((info) => usable(info.url)).map((info) => info.a));
			for (const a of container.querySelectorAll("a")) {
				const info = byEl.get(a);
				if (!info || !info.title) continue;
				const url = usable(info.url) ? info.url : urlByTitle.get(info.title);
				if (url) items.push({
					url: url.split("#")[0],
					title: info.title
				});
			}
		}
		const lastIndex = new Map(items.map((it, i) => [it.url, i]));
		return items.filter((it, i) => lastIndex.get(it.url) === i);
	}
	function nextTocPages(doc, host, isChapter, visited) {
		const candidate = (url) => !!url && http(url) && new URL(url).host === host && !isChapter(url) && !visited.has(url.split("#")[0]);
		const options = [...doc.querySelectorAll("select option[value]")].map((o) => {
			try {
				return new URL(o.getAttribute("value"), doc.baseURI).href;
			} catch {
				return "";
			}
		}).filter(candidate);
		if (options.length) return options;
		const next = [...doc.querySelectorAll("a")].find((a) => NEXT_PAGE_TEXT.test(cleanText(a.textContent)) && candidate(anchorUrl(a)));
		return next ? [anchorUrl(next)] : [];
	}
	async function loadTocPages(firstUrl, firstDoc, keep) {
		const docs = [firstDoc];
		const isChapter = resolveFilter([{ anchors: docAnchors(firstDoc) }], keep);
		const host = new URL(firstUrl).host;
		const visited = new Set([firstUrl.split("#")[0]]);
		const firstItems = collectToc(docs, isChapter);
		const seen = new Set(firstItems.map((it) => it.url));
		const queue = [];
		const enqueue = (urls) => {
			for (const raw of urls) {
				const clean = raw.split("#")[0];
				if (!visited.has(clean) && !queue.includes(clean)) queue.push(clean);
			}
		};
		enqueue(nextTocPages(firstDoc, host, isChapter, visited));
		while (queue.length && docs.length < MAX_TOC_PAGES) {
			const remaining = MAX_TOC_PAGES - docs.length;
			const batch = queue.splice(0, Math.min(TOC_CONCURRENCY, remaining));
			batch.forEach((u) => visited.add(u));
			const tasks = batch.map((u) => {
				const p = fetchDocument(u);
				p.catch(() => void 0);
				return p;
			});
			let stopped = false;
			for (const task of tasks) {
				const doc = await task;
				const items = collectToc([doc], isChapter);
				let added = false;
				for (const it of items) if (!seen.has(it.url)) {
					seen.add(it.url);
					added = true;
				}
				if (!added) {
					stopped = true;
					break;
				}
				docs.push(doc);
				enqueue(nextTocPages(doc, host, isChapter, visited));
			}
			if (stopped) break;
		}
		return docs.length === 1 ? firstItems : collectToc(docs, isChapter);
	}
	function chapterFilter(site, refChapterUrl) {
		if (site.chapterPattern) {
			const pattern = new RegExp(site.chapterPattern);
			return (url) => pattern.test(new URL(url).pathname);
		}
		return refChapterUrl ? (url) => urlShape(url) === urlShape(refChapterUrl) : void 0;
	}
	function tocApiUrl(site, refUrls) {
		if (!site.toc?.api) return void 0;
		if (!site.toc.api.includes("{bookId}")) return site.toc.api;
		const re = site.toc.bookIdPattern ? new RegExp(site.toc.bookIdPattern) : void 0;
		const bookId = re && refUrls.map((u) => u.match(re)?.[1]).find(Boolean);
		if (!bookId) throw new Error("无法从地址中提取 bookId");
		return site.toc.api.replace("{bookId}", bookId);
	}
	async function loadFullToc(site, chapterUrl, tocUrl) {
		const source = tocApiUrl(site, [chapterUrl]) ?? tocUrl;
		if (!source) throw new Error("当前页面没有找到目录链接，可在站点适配中指定");
		const items = await loadTocPages(source, await fetchDocument(source), chapterFilter(site, chapterUrl));
		if (!items.length) throw new Error("目录页中没有找到章节链接");
		return items;
	}
	async function loadTocFromBookPage(site, bookUrl, bookDoc) {
		const filter = chapterFilter(site);
		let api;
		try {
			api = tocApiUrl(site, [bookUrl]);
		} catch {
			api = void 0;
		}
		if (api) return loadTocPages(api, await fetchDocument(api), filter);
		const items = await loadTocPages(bookUrl, bookDoc, filter);
		if (items.length >= 20) return items;
		const link = [...bookDoc.querySelectorAll("a")].find((a) => FULL_TOC_TEXT.test(cleanText(a.textContent)) && http(anchorUrl(a)));
		if (!link || anchorUrl(link).split("#")[0] === bookUrl.split("#")[0]) return items;
		const fullUrl = anchorUrl(link);
		const full = await loadTocPages(fullUrl, await fetchDocument(fullUrl), filter);
		return full.length > items.length ? full : items;
	}
	var START_READING = /^(开始阅读|開始閱讀)$/;
	async function loadFirstChapter(site, bookUrl) {
		const rule = BOOK_SEARCH[site.id];
		const onSite = (u) => /^https?:$/.test(u.protocol) && site.hosts.some((host) => hostMatches(u.hostname, host));
		const book = new URL(bookUrl);
		if (!onSite(book)) throw new Error("不是本站可识别的书页");
		const chapterPattern = site.chapterPattern && new RegExp(site.chapterPattern);
		if (rule) {
			const id = rule.bookPath.exec(book.pathname)?.[1];
			if (!id) throw new Error("不是本站可识别的书页");
			const chapterRoot = `${rule.chapterRoot}${id}/`;
			const isChapter = (href) => {
				const u = new URL(href);
				return onSite(u) && u.pathname.startsWith(chapterRoot) && /^\d+(?:\.html)?$/.test(u.pathname.slice(chapterRoot.length)) && (!chapterPattern || chapterPattern.test(u.pathname));
			};
			const page = await fetchPage(bookUrl);
			const current = new URL(page.url);
			if (!onSite(current) || rule.bookPath.exec(current.pathname)?.[1] !== id) throw new Error("书页跳转到了意外的地址");
			for (const a of page.doc.querySelectorAll("a[href]")) {
				if (!START_READING.test(cleanText(a.textContent).replace(/\s/g, ""))) continue;
				const url = new URL(a.href, page.url);
				if (isChapter(url.href)) return url.href;
				if (onSite(url) && url.pathname === rule.startDirectory?.replace("{id}", id)) {
					const directory = await fetchPage(url.href);
					const final = new URL(directory.url);
					if (onSite(final) && final.pathname === url.pathname) {
						const first = collectToc([directory.doc], isChapter)[0];
						if (first) return first.url;
					}
				}
			}
			throw new Error("未找到第一章，请点书名到书页查看");
		}
		const bookId = (site.search?.bookPath ? new RegExp(site.search.bookPath) : void 0)?.exec(book.pathname)?.[1];
		const chapterRoot = site.search?.chapterRoot && bookId ? `${site.search.chapterRoot}${bookId}/` : void 0;
		const isCustomChapter = (href) => {
			const u = new URL(href);
			if (!onSite(u)) return false;
			if (chapterPattern) return chapterPattern.test(u.pathname);
			if (chapterRoot) return u.pathname.startsWith(chapterRoot);
			return u.href.split("#")[0] !== book.href.split("#")[0];
		};
		const page = await fetchPage(bookUrl);
		for (const a of page.doc.querySelectorAll("a[href]")) {
			if (!START_READING.test(cleanText(a.textContent).replace(/\s/g, ""))) continue;
			const url = new URL(a.href, page.url);
			if (isCustomChapter(url.href)) return url.href;
		}
		const toc = await loadTocFromBookPage(site, page.url, page.doc);
		if (toc[0]) return toc[0].url;
		throw new Error("未找到第一章，请点书名到书页查看");
	}
	function parseBookInfo(doc, site) {
		const meta = (p) => cleanText(doc.querySelector(`meta[property="${p}"]`)?.getAttribute("content"));
		const text = (sel) => sel ? cleanText(doc.querySelector(sel)?.textContent) : "";
		return {
			name: text(site.book?.name) || meta("og:novel:book_name") || meta("og:title") || text("h1"),
			author: (text(site.book?.author) || meta("og:novel:author")).replace(/^作者[:：]\s*/, "") || void 0
		};
	}
	async function fetchBookInfo(candidates, site) {
		const errors = [];
		for (const url of [...new Set(candidates)]) try {
			const { name, author } = parseBookInfo(await fetchDocument(url), site);
			if (name) return {
				name,
				author,
				bookUrl: url
			};
			errors.push(`${url}：页面里没有书名`);
		} catch (e) {
			errors.push(`${url}：${e.message}`);
		}
		throw new Error(errors.length ? errors.join("；") : "没有可用的书页地址");
	}
	var RateLimitError = class extends Error {
		constructor() {
			super("搜索过于频繁");
			this.name = "RateLimitError";
		}
	};
	var RATE_LIMIT_TEXT = /间隔时间|过于频繁|搜索太快|太频繁/;
	var SEARCH_INTERVAL = 5500;
	var sleep = (ms, signal) => new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
		const timer = window.setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			window.clearTimeout(timer);
			reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
	var SEARCH_LINK_TEXT = /^[\s[【]*(搜索|搜書|搜书|找书|找書|站内搜索)/;
	var MAX_CANDIDATES = 3;
	function nameKey(name, hans) {
		return hans(name).replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
	}
	function bookMatchKey(name, author, hans) {
		const norm = (s) => hans(s ?? "").replace(/\s+/g, "");
		return `${norm(name)}|${norm(author)}`;
	}
	var CN_DIGITS = {
		零: 0,
		〇: 0,
		一: 1,
		二: 2,
		两: 2,
		三: 3,
		四: 4,
		五: 5,
		六: 6,
		七: 7,
		八: 8,
		九: 9
	};
	var CN_UNITS = {
		十: 10,
		百: 100,
		千: 1e3,
		万: 1e4
	};
	function cnToNumber(s) {
		if (/^\d+$/.test(s)) return Number(s);
		if (!/[十百千万]/.test(s)) {
			const digits = [...s].map((ch) => CN_DIGITS[ch] ?? "").join("");
			return Number(digits) || 0;
		}
		let total = 0;
		let section = 0;
		let digit = 0;
		for (const ch of s) if (ch in CN_DIGITS) digit = CN_DIGITS[ch];
		else if (ch === "万") {
			total += (section + digit) * 1e4;
			section = 0;
			digit = 0;
		} else if (ch in CN_UNITS) {
			section += (digit || 1) * CN_UNITS[ch];
			digit = 0;
		}
		return total + section + digit;
	}
	function titleKey(title, hans) {
		return hans(stripPageMark(title)).replace(/第([\d零〇一二两三四五六七八九十百千万]+)([章节回])/g, (_, n, unit) => `第${cnToNumber(n)}${unit}`).replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
	}
	function titleName(key) {
		return key.replace(/^第\d+[章节回]/, "");
	}
	var tocKeyCache = new WeakMap();
	function tocTitleKeys(toc, hans) {
		const cached = tocKeyCache.get(toc);
		if (cached?.hans === hans) return cached.keys;
		const keys = toc.map((t) => titleKey(t.title, hans));
		tocKeyCache.set(toc, {
			hans,
			keys
		});
		return keys;
	}
	function matchChapter(title, index, toc, hans) {
		const key = titleKey(title, hans);
		const keys = tocTitleKeys(toc, hans);
		const exact = keys.indexOf(key);
		if (exact >= 0) return {
			kind: "title",
			url: toc[exact].url
		};
		const name = titleName(key);
		if (name.length >= 2) {
			const hits = keys.flatMap((k, i) => titleName(k) === name ? [i] : []);
			if (hits.length === 1) return {
				kind: "title",
				url: toc[hits[0]].url
			};
		}
		if (index >= 0 && index < toc.length) return {
			kind: "index",
			url: toc[index].url
		};
		return { kind: "none" };
	}
	var specKey = (siteId) => `searchSpec:${siteId}`;
	function siteHome(site) {
		return `https://${site.hosts[0]}/`;
	}
	function specFromForm(page) {
		for (const form of page.doc.querySelectorAll("form")) {
			const inputs = [...form.querySelectorAll("input[name], select[name]")];
			const keyInput = inputs.find((i) => i instanceof HTMLInputElement && /^(text|search|)$/.test(i.getAttribute("type") ?? ""));
			if (!keyInput) continue;
			const fields = inputs.filter((i) => i !== keyInput && !(i instanceof HTMLInputElement && /^(submit|button|image|reset)$/.test(i.type))).map((i) => `${encodeURIComponent(i.name)}=${encodeURIComponent(i.value)}`);
			const query = [`${encodeURIComponent(keyInput.name)}={name}`, ...fields].join("&");
			const action = new URL(form.getAttribute("action") || page.url, page.url);
			const charset = form.getAttribute("accept-charset")?.split(/[\s,]/)[0]?.toLowerCase() || page.charset;
			if ((form.getAttribute("method") ?? "get").toLowerCase() === "post") return {
				url: action.href,
				body: query,
				charset
			};
			action.search = "";
			return {
				url: `${action.href}?${query}`,
				charset
			};
		}
	}
	async function detectSearch(site, signal) {
		const home = await fetchPage(siteHome(site), { signal });
		const fromHome = specFromForm(home);
		if (fromHome) return fromHome;
		const link = [...home.doc.querySelectorAll("a")].find((a) => SEARCH_LINK_TEXT.test(cleanText(a.textContent)) && /^https?:/.test(a.href));
		if (link) {
			const fromPage = specFromForm(await fetchPage(link.href, { signal }));
			if (fromPage) return fromPage;
		}
		throw new Error("没有识别到搜索框，可在站点规则里配置 search");
	}
	async function searchSpec(site, signal) {
		const configured = site.search ?? BOOK_SEARCH[site.id]?.search;
		if (configured) {
			const charset = configured.charset ?? (await fetchPage(siteHome(site), { signal })).charset;
			return {
				url: configured.url,
				body: configured.body,
				charset,
				result: configured.result,
				author: configured.author
			};
		}
		const cached = _GM_getValue(specKey(site.id), void 0);
		if (cached) return cached;
		const spec = await detectSearch(site, signal);
		_GM_setValue(specKey(site.id), spec);
		return spec;
	}
	function fill(template, name, charset) {
		return template.replace("{name}", encodeFormValue(name, charset));
	}
	function searchPageUrl(site, name) {
		if (site.id === "twkan" && !site.search) return `https://twkan.com/search/${encodeURIComponent(name)}/1.html`;
		const spec = site.search ?? BOOK_SEARCH[site.id]?.search ?? _GM_getValue(specKey(site.id), void 0);
		if (!spec || spec.body) return siteHome(site);
		try {
			return fill(spec.url, name, spec.charset ?? "utf-8");
		} catch {
			return siteHome(site);
		}
	}
	var searchQueues = new Map();
	function queued(siteId, task, signal) {
		if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
		const prev = searchQueues.get(siteId) ?? Promise.resolve();
		let ran = false;
		const run = prev.then(() => {
			signal?.throwIfAborted();
			ran = true;
			return task();
		});
		searchQueues.set(siteId, run.then(() => ran ? sleep(SEARCH_INTERVAL) : void 0, () => ran ? sleep(SEARCH_INTERVAL) : void 0));
		return run;
	}
	function searchBooks(site, name, hans, signal) {
		return queued(site.id, async () => {
			try {
				return await searchOnce(site, name, hans, signal);
			} catch (e) {
				if (!(e instanceof RateLimitError)) throw e;
				signal?.throwIfAborted();
				await sleep(SEARCH_INTERVAL, signal);
				return searchOnce(site, name, hans, signal);
			}
		}, signal);
	}
	async function searchOnce(site, name, hans, signal) {
		const { spec, page, url } = await fetchSearch(site, name, signal);
		const target = nameKey(name, hans);
		const hits = [...new Set(resultAnchors(page, spec).filter((a) => /^https?:/.test(a.href) && nameKey(cleanText(a.textContent), hans) === target).map((a) => a.href.split("#")[0]))];
		if (hits.length) return hits.slice(0, MAX_CANDIDATES);
		const searchPath = new URL(url).pathname.replace(/\/$/, "");
		const finalPath = new URL(page.url).pathname;
		const bookPath = BOOK_SEARCH[site.id]?.bookPath ?? (site.search?.bookPath ? new RegExp(site.search.bookPath) : void 0);
		if (bookPath ? bookPath.test(finalPath) : finalPath !== searchPath && !finalPath.startsWith(`${searchPath}/`)) return [page.url.split("#")[0]];
		if (RATE_LIMIT_TEXT.test(page.doc.body?.textContent ?? "")) throw new RateLimitError();
		return [];
	}
	async function fetchSearch(site, name, signal) {
		const spec = await searchSpec(site, signal);
		const url = fill(spec.url, name, spec.charset);
		try {
			return {
				spec,
				page: await fetchPage(url, spec.body ? {
					method: "POST",
					body: fill(spec.body, name, spec.charset),
					signal
				} : { signal }),
				url
			};
		} catch (e) {
			if (!site.search && !signal?.aborted) _GM_deleteValue(specKey(site.id));
			throw e;
		}
	}
	function resultAnchors(page, spec) {
		return (spec.result ? [...page.doc.querySelectorAll(spec.result)] : [page.doc.body]).flatMap((el) => el instanceof HTMLAnchorElement ? [el] : [...el.querySelectorAll("a")]);
	}
	function findBooks(site, keyword, bookPath, hans, signal) {
		return queued(site.id, async () => {
			signal.throwIfAborted();
			const target = nameKey(keyword, hans);
			if (!target) return [];
			const { spec, page } = await fetchSearch(site, keyword, signal);
			const asBookUrl = (href) => {
				const u = new URL(href);
				if (u.protocol !== "https:" && u.protocol !== "http:") return;
				if (!site.hosts.some((host) => hostMatches(u.hostname, host))) return;
				if (!bookPath.test(u.pathname)) return;
				u.hash = "";
				return u.href;
			};
			const bookUrl = asBookUrl(page.url);
			if (bookUrl) {
				const book = parseBookInfo(page.doc, site);
				return nameKey(book.name, hans).includes(target) ? [{
					...book,
					bookUrl
				}] : [];
			}
			if (RATE_LIMIT_TEXT.test(page.doc.body?.textContent ?? "")) throw new RateLimitError();
			const authorSel = spec.author ?? BOOK_SEARCH[site.id]?.search.author;
			const hits = new Map();
			for (const a of resultAnchors(page, spec)) {
				if (!/^https?:/.test(a.href)) continue;
				const hitUrl = asBookUrl(a.href);
				const name = cleanText(a.querySelector("h3")?.textContent ?? a.textContent);
				if (hitUrl && nameKey(name, hans).includes(target) && !hits.has(hitUrl)) {
					const row = authorSel ? a.closest("li, tr, .bookbox, .result-item, div") : null;
					const rawAuthor = authorSel && row ? cleanText(row.querySelector(authorSel)?.textContent).replace(/^作者[:：]\s*/, "") : "";
					hits.set(hitUrl, rawAuthor ? {
						name,
						bookUrl: hitUrl,
						author: rawAuthor
					} : {
						name,
						bookUrl: hitUrl
					});
				}
			}
			return [...hits.values()].slice(0, 20);
		}, signal);
	}
	async function inspectBook(site, bookUrl, signal) {
		const page = await fetchPage(bookUrl, { signal });
		const info = parseBookInfo(page.doc, site);
		const toc = await loadTocFromBookPage(site, page.url, page.doc);
		return {
			bookUrl: page.url.split("#")[0],
			name: info.name,
			author: info.author,
			toc
		};
	}
	var activeHandler;
	function openVerify(url, retry) {
		if (activeHandler) {
			document.removeEventListener("visibilitychange", activeHandler);
			activeHandler = void 0;
		}
		if (!window.open(url, "_blank", "noopener")) return () => {};
		const onBack = () => {
			if (document.visibilityState !== "visible") return;
			document.removeEventListener("visibilitychange", onBack);
			if (activeHandler === onBack) activeHandler = void 0;
			retry();
		};
		activeHandler = onBack;
		document.addEventListener("visibilitychange", onBack);
		return () => {
			document.removeEventListener("visibilitychange", onBack);
			if (activeHandler === onBack) activeHandler = void 0;
		};
	}
	function SearchBookRow({ site, book, convert }) {
		const [loading, setLoading] = d(false);
		const [error, setError] = d();
		const start = async () => {
			if (loading) return;
			const tab = window.open("about:blank", "_blank");
			if (!tab) {
				setError({ message: "浏览器拦截了新标签页，请允许弹窗后重试" });
				return;
			}
			tab.opener = null;
			tab.document.title = "正在查找第一章…";
			tab.document.body.textContent = "正在查找第一章…";
			setLoading(true);
			setError(void 0);
			try {
				const url = await loadFirstChapter(site, book.bookUrl);
				if (tab.closed) return;
				requestAutoOpen(url);
				tab.location.replace(url);
			} catch (e) {
				tab.close();
				setError({
					message: e.message,
					verifyUrl: e instanceof ChallengeError ? e.verifyUrl : void 0
				});
			} finally {
				setLoading(false);
			}
		};
		return u$1("div", {
			class: "nr-search-book",
			children: [u$1("div", {
				class: "nr-search-book-row",
				children: [u$1("a", {
					class: "nr-search-book-link",
					href: book.bookUrl,
					title: "打开书页",
					target: "_blank",
					rel: "noopener noreferrer",
					children: [u$1("span", { children: [convert(book.name), book.author && u$1("small", { children: convert(book.author) })] }), u$1(IconExternal, {
						width: 14,
						height: 14
					})]
				}), u$1("button", {
					class: "nr-btn is-primary is-small",
					onClick: start,
					disabled: loading,
					children: loading ? "查找首章…" : "开始阅读"
				})]
			}), error && u$1("p", {
				class: "nr-hint",
				role: "status",
				children: [error.message, error.verifyUrl && u$1(S, { children: [
					" ",
					"·",
					" ",
					u$1("button", {
						class: "nr-btn is-ghost is-small",
						onClick: () => openVerify(error.verifyUrl, () => void start()),
						children: "打开验证"
					})
				] })]
			})]
		});
	}
	function SearchPanel({ convert, onClose, tabs }) {
		const [sites] = d(() => loadSites().filter((site) => site.enabled && (Object.hasOwn(BOOK_SEARCH, site.id) || !!site.search)));
		const [input, setInput] = d("");
		const [query, setQuery] = d("");
		const [results, setResults] = d({});
		const active = A();
		h(() => () => active.current?.abort(), []);
		const run = async (site, keyword, signal) => {
			const update = (result) => {
				if (!signal.aborted) setResults((prev) => ({
					...prev,
					[site.id]: result
				}));
			};
			update({ kind: "loading" });
			try {
				const config = BOOK_SEARCH[site.id];
				const identity = (s) => s;
				const scriptMode = site.search?.script ?? config?.script ?? "hans";
				const [hans, native] = await Promise.all([getConverter("hans").catch(() => identity), getConverter(scriptMode).catch(() => identity)]);
				signal.throwIfAborted();
				const searchCfg = site.search ?? config?.search;
				if (!searchCfg) throw new Error("站点未配置搜索规则");
				const searchable = {
					...site,
					search: searchCfg
				};
				const bookPath = config?.bookPath ?? (site.search?.bookPath ? new RegExp(site.search.bookPath) : /^\/.+/);
				let books = [];
				for (const term of new Set([native(keyword), keyword])) {
					books = await findBooks(searchable, term, bookPath, hans, signal);
					if (books.length) break;
				}
				update({
					kind: "done",
					books
				});
			} catch (e) {
				update({
					kind: "error",
					message: e instanceof RateLimitError ? "搜索过于频繁，请稍后重试" : e.message,
					verifyUrl: e instanceof ChallengeError ? `${new URL(e.verifyUrl).origin}/` : void 0
				});
			}
		};
		return u$1("section", {
			class: "nr-panel",
			role: "dialog",
			"aria-label": "搜书",
			children: [
				u$1("div", {
					class: "nr-panel-head",
					children: [tabs ?? u$1("h2", { children: "搜书" }), u$1("button", {
						class: "nr-btn is-ghost nr-icon-btn",
						onClick: onClose,
						title: "关闭",
						children: u$1(IconClose, {
							width: 18,
							height: 18
						})
					})]
				}),
				u$1("form", {
					class: "nr-panel-sub nr-book-search",
					onSubmit: (e) => {
						e.preventDefault();
						const keyword = input.trim();
						if (!keyword || !sites.length || keyword === query && sites.some((s) => results[s.id]?.kind === "loading")) return;
						active.current?.abort();
						const controller = new AbortController();
						active.current = controller;
						setQuery(keyword);
						setResults({});
						sites.forEach((site) => void run(site, keyword, controller.signal));
					},
					children: [u$1("input", {
						class: "nr-input",
						type: "search",
						"aria-label": "书名",
						placeholder: "输入书名",
						value: input,
						onInput: (e) => setInput(e.currentTarget.value)
					}), u$1("button", {
						class: "nr-btn is-primary",
						type: "submit",
						disabled: !input.trim() || !sites.length,
						children: "搜索"
					})]
				}),
				u$1("div", {
					class: "nr-panel-body",
					children: [!query && u$1("p", {
						class: "nr-hint",
						children: sites.length ? `同时搜索：${sites.map((s) => s.name).join("、")}` : "请先在设置 → 站点中启用内置书源。"
					}), query && sites.map((site) => {
						const result = results[site.id];
						if (!result) return null;
						return u$1("section", {
							class: "nr-search-group",
							"aria-live": "polite",
							children: [
								u$1("h3", { children: site.name }),
								result.kind === "loading" && u$1("p", {
									class: "nr-hint",
									children: "搜索中…"
								}),
								result.kind === "error" && u$1(S, { children: [
									u$1("p", {
										class: "nr-hint",
										children: result.message
									}),
									result.verifyUrl && u$1("button", {
										class: "nr-btn is-small is-primary",
										onClick: () => openVerify(result.verifyUrl, () => active.current && void run(site, query, active.current.signal)),
										children: "打开验证"
									}),
									u$1("button", {
										class: "nr-btn is-small",
										onClick: () => active.current && void run(site, query, active.current.signal),
										children: "重试"
									})
								] }),
								result.kind === "done" && (result.books.length ? result.books.map((book) => u$1(SearchBookRow, {
									site,
									book,
									convert
								}, book.bookUrl)) : u$1("p", {
									class: "nr-hint",
									children: "未找到相关书籍，试试完整书名。"
								}))
							]
						}, site.id);
					})]
				})
			]
		});
	}
	var MAX_PAGES_PER_CHAPTER = 30;
	var MAX_CACHE_SIZE = 30;
	var PREFETCH_CONCURRENCY = 4;
	function pagedUrls(firstUrl, secondUrl, total) {
		const u = new URL(firstUrl);
		const nu = new URL(secondUrl);
		if (u.origin !== nu.origin || u.search !== nu.search) return [];
		const m = u.pathname.match(/^(.*?)(\.\w+)?$/);
		if (!m) return [];
		const [, base, ext = ""] = m;
		const sep = nu.pathname === `${base}_2${ext}` ? "_" : nu.pathname === `${base}-2${ext}` ? "-" : "";
		if (!sep) return [];
		const limit = Math.min(total, MAX_PAGES_PER_CHAPTER);
		const urls = [];
		for (let k = 2; k <= limit; k++) urls.push(`${u.origin}${base}${sep}${k}${ext}${u.search}`);
		return urls;
	}
	function createLoader(site) {
		const pages = new Map();
		const chapters = new Map();
		function memo(map, url, make) {
			let p = map.get(url);
			if (p) {
				map.delete(url);
				map.set(url, p);
				return p;
			}
			p = make();
			map.set(url, p);
			if (map.size > MAX_CACHE_SIZE) {
				const oldest = map.keys().next().value;
				if (oldest !== void 0) map.delete(oldest);
			}
			p.catch(() => map.delete(url));
			return p;
		}
		function loadPage(url, doc) {
			if (site.adapter) {
				const adapter = getAdapter(site.adapter);
				return memo(pages, url, () => adapter.load(url, site, doc));
			}
			return memo(pages, url, async () => extractChapter(doc ?? await fetchDocument(url), site, url));
		}
		function load(url, doc) {
			return memo(chapters, url, async () => {
				let ch = await loadPage(url, doc);
				const mark = parsePageMark(ch.title);
				const queue = mark && mark.page === 1 && mark.total > 2 && ch.nextUrl ? pagedUrls(url, ch.nextUrl, mark.total) : [];
				let stopped = false;
				if (queue.length) {
					const workerCount = Math.min(PREFETCH_CONCURRENCY, queue.length);
					for (let i = 0; i < workerCount; i++) (async () => {
						while (!stopped && queue.length) await loadPage(queue.shift()).catch(() => void 0);
					})();
				}
				try {
					for (let i = 0; i < MAX_PAGES_PER_CHAPTER && ch.nextUrl && (i > 0 || ch.nextIsPage); i++) {
						const next = await loadPage(ch.nextUrl).catch(() => void 0);
						if (!next || !sameChapterTitle(ch.title, next.title)) break;
						ch = {
							...ch,
							title: stripPageMark(ch.title) || ch.title,
							paragraphs: [...ch.paragraphs, ...next.paragraphs],
							nextUrl: next.nextUrl,
							nextIsPage: next.nextIsPage,
							tocUrl: ch.tocUrl ?? next.tocUrl,
							bookUrl: ch.bookUrl ?? next.bookUrl
						};
					}
				} finally {
					stopped = true;
				}
				return ch;
			});
		}
		return { load };
	}
	function ShelfPanel({ shelf, bookKey, info, infoReady, convert, onAdd, onOpen, onRemove, onClose, standalone, tabs }) {
		const onShelf = !standalone && shelf.some((b) => b.sources.some((s) => s.bookKey === bookKey));
		const [checking, setChecking] = d(false);
		const [updates, setUpdates] = d({});
		const alive = A(true);
		h(() => () => void (alive.current = false), []);
		const sorted = T(() => [...shelf].sort((a, b) => Math.max(...b.sources.map((s) => s.updated), b.added) - Math.max(...a.sources.map((s) => s.updated), a.added)), [shelf]);
		const checkUpdates = async () => {
			if (checking || !shelf.length) return;
			setChecking(true);
			const sites = loadSites();
			const hans = await getConverter("hans").catch(() => (s) => s);
			const tasks = shelf.flatMap((b) => b.sources);
			setUpdates(Object.fromEntries(tasks.map((s) => [s.bookKey, { status: "loading" }])));
			let cursor = 0;
			const worker = async () => {
				while (alive.current && cursor < tasks.length) {
					const src = tasks[cursor++];
					try {
						const site = sites.find((x) => x.id === src.siteId);
						if (!site) throw new Error("站点不存在");
						let toc;
						if (src.bookUrl) toc = (await inspectBook(site, src.bookUrl)).toc;
						else if (site.toc?.api) toc = await loadFullToc(site, src.lastUrl, void 0);
						else {
							const ch = await createLoader(site).load(src.lastUrl);
							if (ch.bookUrl) toc = (await inspectBook(site, ch.bookUrl)).toc;
							else toc = await loadFullToc(site, src.lastUrl, ch.tocUrl);
						}
						let idx = toc.findIndex((it) => it.url === src.lastUrl);
						if (idx < 0 && src.lastTitle) {
							const m = matchChapter(src.lastTitle, -1, toc, hans);
							if (m.kind === "title") idx = toc.findIndex((it) => it.url === m.url);
						}
						const unread = idx >= 0 ? Math.max(0, toc.length - 1 - idx) : void 0;
						const latest = toc.at(-1)?.title ?? "";
						if (alive.current) setUpdates((prev) => ({
							...prev,
							[src.bookKey]: {
								status: "done",
								latest,
								unread
							}
						}));
					} catch (e) {
						if (alive.current) setUpdates((prev) => ({
							...prev,
							[src.bookKey]: {
								status: "error",
								message: e.message
							}
						}));
					}
				}
			};
			await Promise.all(Array.from({ length: Math.min(3, tasks.length) }, worker));
			if (alive.current) setChecking(false);
		};
		return u$1("section", {
			class: "nr-panel is-toc",
			role: "dialog",
			"aria-label": "书架",
			children: [
				u$1("div", {
					class: "nr-panel-head",
					children: [tabs ?? u$1("h2", { children: "书架" }), u$1("div", {
						style: "display:flex;align-items:center;gap:6px",
						children: [!!shelf.length && u$1("button", {
							class: "nr-btn is-small",
							disabled: checking,
							onClick: checkUpdates,
							title: "检查书架书籍是否有新章节",
							children: [u$1(IconRefresh, {
								width: 14,
								height: 14
							}), checking ? "检查中…" : "检查更新"]
						}), u$1("button", {
							class: "nr-btn is-ghost nr-icon-btn",
							onClick: onClose,
							title: "关闭",
							children: u$1(IconClose, {
								width: 18,
								height: 18
							})
						})]
					})]
				}),
				!standalone && u$1("div", {
					class: "nr-panel-sub",
					children: [u$1("div", {
						class: "nr-shelf-current",
						children: [u$1("div", {
							class: "nr-shelf-name",
							children: convert(info.name)
						}), u$1("div", {
							class: "nr-hint",
							children: info.author ? convert(info.author) : infoReady ? "作者未知" : "正在获取作者…"
						})]
					}), u$1("button", {
						class: `nr-btn is-small${onShelf ? "" : " is-primary"}`,
						disabled: onShelf,
						onClick: onAdd,
						children: onShelf ? "已在书架" : "加入书架"
					})]
				}),
				u$1("div", {
					class: "nr-panel-body",
					style: "padding:0 12px 16px",
					children: !sorted.length ? u$1("div", {
						class: "nr-empty",
						children: [u$1(IconShelf, {
							width: 28,
							height: 28,
							style: "opacity:.4"
						}), u$1("div", { children: standalone ? "书架还是空的，可在阅读页面点「加入书架」" : "书架还是空的，点上方「加入书架」" })]
					}) : sorted.map((book) => u$1("div", {
						class: "nr-shelf-book",
						children: [u$1("div", {
							class: "nr-shelf-title",
							children: [u$1("span", {
								class: "nr-shelf-name",
								children: convert(book.name)
							}), book.author && u$1("span", {
								class: "nr-hint",
								children: convert(book.author)
							})]
						}), book.sources.map((s) => {
							const up = updates[s.bookKey];
							return u$1("div", {
								class: `nr-shelf-source${s.bookKey === bookKey ? " is-current" : ""}`,
								children: [u$1("button", {
									class: "nr-shelf-open",
									onClick: () => onOpen(s),
									title: `继续阅读：${s.lastUrl}`,
									children: [
										u$1("span", {
											class: "nr-chip",
											children: s.host
										}),
										u$1("span", {
											class: "nr-shelf-last",
											children: convert(s.lastTitle)
										}),
										up?.status === "loading" && u$1("span", {
											class: "nr-hint",
											children: "检查中"
										}),
										up?.status === "done" && u$1("span", {
											class: `nr-chip${up.unread ? " is-accent" : ""}`,
											title: up.latest ? `最新：${convert(up.latest)}` : void 0,
											children: up.unread ? `+${up.unread}章` : up.unread === 0 ? "已最新" : convert(up.latest)
										}),
										up?.status === "error" && u$1("span", {
											class: "nr-chip is-warn",
											title: up.message,
											children: "失败"
										}),
										!up && u$1("span", {
											class: "nr-hint",
											children: formatAgo(s.updated)
										})
									]
								}), u$1("button", {
									class: "nr-btn is-ghost nr-icon-btn nr-shelf-del",
									title: "从书架移除这个站点",
									onClick: () => confirm(`从书架移除「${book.name}」在 ${s.host} 的来源？`) && onRemove(book.id, s.bookKey),
									children: u$1(IconClose, {
										width: 14,
										height: 14
									})
								})]
							}, s.bookKey);
						})]
					}, book.id))
				})
			]
		});
	}
	function QuickHub({ onClose }) {
		const [tab, setTab] = d("shelf");
		const [shelf, setShelf] = d(loadShelf);
		const [settings] = d(loadSettings);
		const [convert, setConvert] = d({ fn: (s) => s });
		h(() => {
			let alive = true;
			getConverter(settings.script).then((fn) => alive && setConvert({ fn }), () => void 0);
			return () => {
				alive = false;
			};
		}, [settings.script]);
		h(() => {
			const onKey = (e) => {
				if (e.key !== "Escape") return;
				e.preventDefault();
				e.stopImmediatePropagation();
				onClose();
			};
			window.addEventListener("keydown", onKey, true);
			return () => window.removeEventListener("keydown", onKey, true);
		}, [onClose]);
		const tabs = u$1("div", {
			class: "nr-segment",
			children: [u$1("button", {
				class: tab === "shelf" ? "is-active" : "",
				onClick: () => setTab("shelf"),
				children: "书架"
			}), u$1("button", {
				class: tab === "search" ? "is-active" : "",
				onClick: () => setTab("search"),
				children: "搜书"
			})]
		});
		const openSource = (source) => {
			requestAutoOpen(source.lastUrl);
			location.href = source.lastUrl;
		};
		return u$1("div", {
			class: "nr-ui",
			"data-theme": settings.theme,
			style: "--pw:640px",
			children: [u$1("div", {
				class: "nr-backdrop",
				style: "background:rgba(0,0,0,.35)",
				onClick: onClose
			}), tab === "shelf" ? u$1(ShelfPanel, {
				standalone: true,
				tabs,
				shelf,
				bookKey: "",
				info: { name: "" },
				infoReady: true,
				convert: convert.fn,
				onAdd: () => {},
				onOpen: openSource,
				onRemove: (id, key) => setShelf(removeShelfSource(id, key)),
				onClose
			}) : u$1(SearchPanel, {
				tabs,
				convert: convert.fn,
				onClose
			})]
		});
	}
	var FORMATS = [
		{
			id: "numbered",
			name: "1. 编号",
			render: (items) => items.map((e, i) => `${i + 1}. ${e.text}`).join("\n")
		},
		{
			id: "lines",
			name: "每行一条",
			render: (items) => items.map((e) => e.text).join("\n")
		},
		{
			id: "joined",
			name: "顿号连接",
			render: (items) => items.map((e) => e.text).join("、")
		}
	];
	function formatTime(t) {
		const d = new Date(t);
		return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	}
	function ExcerptPanel({ bookKey, onClose, showToast }) {
		const [all, setAll] = d(loadExcerpts);
		const [scope, setScope] = d("book");
		const [format, setFormat] = d("numbered");
		const [checked, setChecked] = d(new Set());
		const items = scope === "book" ? all.filter((e) => e.bookKey === bookKey) : all;
		const picked = items.filter((e) => checked.has(e.id));
		const allChecked = items.length > 0 && picked.length === items.length;
		const toggle = (id) => setChecked((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
		const copy = () => {
			const target = picked.length ? picked : items;
			_GM_setClipboard(FORMATS.find((f) => f.id === format).render(target), "text");
			showToast(`已复制 ${target.length} 条摘录`);
		};
		const remove = (ids) => {
			const next = loadExcerpts().filter((e) => !ids.has(e.id));
			saveExcerpts(next);
			setAll(next);
			setChecked((prev) => new Set([...prev].filter((id) => !ids.has(id))));
		};
		return u$1("section", {
			class: "nr-panel is-toc",
			role: "dialog",
			"aria-label": "摘录",
			children: [
				u$1("div", {
					class: "nr-panel-head",
					children: [u$1("h2", { children: "摘录" }), u$1("button", {
						class: "nr-btn is-ghost nr-icon-btn",
						onClick: onClose,
						title: "关闭",
						children: u$1(IconClose, {
							width: 18,
							height: 18
						})
					})]
				}),
				u$1("div", {
					class: "nr-panel-sub",
					children: [u$1("div", {
						class: "nr-segment",
						children: [u$1("button", {
							class: scope === "book" ? "is-active" : "",
							onClick: () => setScope("book"),
							children: "本书"
						}), u$1("button", {
							class: scope === "all" ? "is-active" : "",
							onClick: () => setScope("all"),
							children: "全部"
						})]
					}), u$1("span", {
						class: "nr-hint",
						children: [
							picked.length ? `已选 ${picked.length} / ` : "",
							items.length,
							" 条"
						]
					})]
				}),
				u$1("div", {
					class: "nr-panel-body",
					style: "padding:0 10px",
					children: !items.length ? u$1("div", {
						class: "nr-empty",
						children: "在正文中划选文字，点「摘录」即可保存到这里"
					}) : u$1("ul", {
						class: "nr-excerpts",
						children: items.map((e) => u$1("li", {
							class: `nr-excerpt${checked.has(e.id) ? " is-checked" : ""}`,
							onClick: () => toggle(e.id),
							children: [
								u$1("span", {
									class: "nr-check",
									children: checked.has(e.id) && u$1(IconCheck, {
										width: 12,
										height: 12
									})
								}),
								u$1("div", {
									class: "nr-excerpt-main",
									children: [u$1("div", {
										class: "nr-excerpt-text",
										children: e.text
									}), u$1("div", {
										class: "nr-excerpt-meta",
										children: [
											scope === "all" && `《${e.book}》`,
											e.chapter,
											" · ",
											formatTime(e.time)
										]
									})]
								}),
								u$1("button", {
									class: "nr-btn is-ghost nr-icon-btn nr-excerpt-del",
									title: "删除",
									onClick: (ev) => {
										ev.stopPropagation();
										remove(new Set([e.id]));
									},
									children: u$1(IconClose, {
										width: 14,
										height: 14
									})
								})
							]
						}, e.id))
					})
				}),
				u$1("div", {
					class: "nr-panel-foot",
					children: [u$1("div", {
						class: "nr-options is-compact",
						children: FORMATS.map((f) => u$1("button", {
							class: `nr-btn is-small${format === f.id ? " is-active" : ""}`,
							onClick: () => setFormat(f.id),
							children: f.name
						}, f.id))
					}), u$1("div", {
						class: "nr-site-actions",
						style: "margin-top:10px",
						children: [
							u$1("button", {
								class: "nr-btn is-small",
								disabled: !items.length,
								onClick: () => setChecked(allChecked ? new Set() : new Set(items.map((e) => e.id))),
								children: allChecked ? "取消全选" : "全选"
							}),
							u$1("button", {
								class: "nr-btn is-small is-ghost is-danger",
								disabled: !picked.length,
								onClick: () => confirm(`删除选中的 ${picked.length} 条摘录？`) && remove(new Set(picked.map((e) => e.id))),
								children: [u$1(IconTrash, {
									width: 14,
									height: 14
								}), "删除"]
							}),
							u$1("span", { style: "flex:1" }),
							u$1("button", {
								class: "nr-btn is-small is-primary",
								disabled: !items.length,
								onClick: copy,
								children: [u$1(IconCopy, {
									width: 14,
									height: 14
								}), picked.length ? `复制 ${picked.length} 条` : "复制全部"]
							})
						]
					})]
				})
			]
		});
	}
	var CACHE_TTL = 432e5;
	function SourcePanel(props) {
		const { site, bookKey, name, author, infoReady, matchKey, current, currentToc, shelf, hans, hant, convert, onSwitch, onClose } = props;
		const others = T(() => loadSites().filter((s) => s.enabled && s.id !== site.id), [site.id]);
		const [states, setStates] = d({});
		const [cacheTime, setCacheTime] = d();
		const alive = A(true);
		const runToken = A(0);
		const controllers = A(new Map());
		const abortAll = () => {
			for (const ac of controllers.current.values()) ac.abort();
			controllers.current.clear();
		};
		h(() => {
			alive.current = true;
			return () => {
				alive.current = false;
				abortAll();
			};
		}, []);
		const target = hans ? nameKey(name, hans) : "";
		const authorKey = author && hans ? nameKey(author, hans) : "";
		const shelfBook = shelf.find((b) => b.sources.some((s) => s.bookKey === bookKey) || b.matchKey === matchKey);
		const setSite = (id, state, token) => {
			if (!alive.current || token !== runToken.current) return;
			setStates((prev) => ({
				...prev,
				[id]: state
			}));
			if (matchKey && (state.kind === "done" || state.kind === "notfound")) {
				const now = Date.now();
				const cache = loadSourceCache(matchKey) ?? {
					time: now,
					sites: {}
				};
				saveSourceCache(matchKey, {
					time: now,
					sites: {
						...cache.sites,
						[id]: state
					}
				});
				setCacheTime(now);
			}
		};
		const fromShelf = async (s, signal) => {
			const src = shelfBook?.sources.find((x) => x.siteId === s.id && x.bookKey !== bookKey);
			if (!src) return void 0;
			let bookUrl = src.bookUrl;
			if (!bookUrl) {
				const ch = await createLoader(s).load(src.lastUrl);
				signal.throwIfAborted();
				bookUrl = ch.bookUrl ?? ch.tocUrl;
			}
			if (!bookUrl) throw new Error("书架记录里没有书页地址，章节页上也没找到书页链接");
			const book = await inspectBook(s, bookUrl, signal);
			return [{
				siteId: s.id,
				origin: "shelf",
				...book
			}];
		};
		const fromSearch = async (s, token, signal, silent) => {
			if (!hans || !hant) return [];
			const variants = [...new Set([
				name,
				hans(name),
				hant(name)
			])];
			for (const [i, v] of variants.entries()) {
				if (!alive.current || token !== runToken.current || signal.aborted) return [];
				if (i > 0 && !silent) setSite(s.id, {
					kind: "loading",
					note: `改搜「${v}」，站点限制搜索间隔，稍候…`
				}, token);
				const urls = await searchBooks(s, v, hans, signal);
				const rows = [];
				for (const url of urls) {
					if (!alive.current || token !== runToken.current || signal.aborted) return [];
					const book = await inspectBook(s, url, signal);
					if (nameKey(book.name, hans) === target) rows.push({
						siteId: s.id,
						origin: "search",
						...book
					});
				}
				if (rows.length) return rows;
			}
			return [];
		};
		const run = async (s, token = runToken.current, silent = false) => {
			controllers.current.get(s.id)?.abort();
			const ac = new AbortController();
			controllers.current.set(s.id, ac);
			if (!silent) setSite(s.id, { kind: "loading" }, token);
			try {
				const rows = await fromShelf(s, ac.signal) ?? await fromSearch(s, token, ac.signal, silent);
				if (!alive.current || token !== runToken.current || ac.signal.aborted) return;
				setSite(s.id, rows.length ? {
					kind: "done",
					rows
				} : { kind: "notfound" }, token);
			} catch (e) {
				if (e.name === "AbortError" || ac.signal.aborted || !alive.current || token !== runToken.current) return;
				if (silent) return;
				if (e instanceof RateLimitError) setSite(s.id, { kind: "rate" }, token);
				else if (e instanceof ChallengeError) setSite(s.id, {
					kind: "verify",
					url: `https://${s.hosts[0]}/`
				}, token);
				else setSite(s.id, {
					kind: "error",
					message: e.message
				}, token);
			}
		};
		h(() => {
			if (!infoReady || !matchKey || !hans || !hant) return;
			abortAll();
			const t = ++runToken.current;
			const cache = loadSourceCache(matchKey);
			const cached = cache?.sites ?? {};
			setCacheTime(cache?.time);
			setStates(cached);
			const stale = !!cache && Date.now() - cache.time > CACHE_TTL;
			for (const s of others) if (!cached[s.id]) run(s, t, false);
			else if (stale) run(s, t, true);
		}, [
			infoReady,
			matchKey,
			hans,
			hant
		]);
		const refresh = () => {
			if (!hans || !hant) return;
			abortAll();
			const t = ++runToken.current;
			others.forEach((s) => void run(s, t, false));
		};
		const currentTotal = currentToc?.length;
		const sameAuthor = (row) => !hans || !row.author || !authorKey ? "unknown" : nameKey(row.author, hans) === authorKey ? "same" : "different";
		const rows = others.flatMap((s) => {
			const st = states[s.id];
			return st?.kind === "done" ? st.rows.map((row) => ({
				row,
				s
			})) : [];
		});
		const rank = (row) => (sameAuthor(row) === "same" ? 0 : 2) + (row.origin === "shelf" ? 0 : 1);
		rows.sort((a, b) => rank(a.row) - rank(b.row));
		const pending = others.filter((s) => states[s.id] && states[s.id].kind !== "done" && states[s.id].kind !== "notfound");
		const notFound = others.filter((s) => states[s.id]?.kind === "notfound");
		const matchLabel = (m) => m.kind === "title" ? u$1("span", {
			class: "nr-chip is-accent",
			children: "有本章"
		}) : m.kind === "index" ? u$1("span", {
			class: "nr-chip",
			children: "按序号对应"
		}) : u$1("span", {
			class: "nr-chip",
			children: "未找到本章"
		});
		return u$1("section", {
			class: "nr-panel is-toc",
			role: "dialog",
			"aria-label": "换源",
			children: [
				u$1("div", {
					class: "nr-panel-head",
					children: [u$1("h2", { children: "换源" }), u$1("button", {
						class: "nr-btn is-ghost nr-icon-btn",
						onClick: onClose,
						title: "关闭",
						children: u$1(IconClose, {
							width: 18,
							height: 18
						})
					})]
				}),
				u$1("div", {
					class: "nr-panel-sub",
					children: [u$1("div", {
						class: "nr-shelf-current",
						children: [u$1("div", {
							class: "nr-shelf-name",
							children: convert(name)
						}), u$1("div", {
							class: "nr-hint",
							children: [author ? convert(author) : infoReady ? "作者未知" : "正在获取书名作者…", cacheTime && ` · 更新于 ${formatAgo(cacheTime)}`]
						})]
					}), u$1("button", {
						class: "nr-btn is-small",
						disabled: !matchKey || !hans || !hant,
						onClick: refresh,
						children: [u$1(IconRefresh, {
							width: 14,
							height: 14
						}), "刷新"]
					})]
				}),
				u$1("div", {
					class: "nr-panel-body",
					style: "padding:0 12px 16px",
					children: [(!hans || !hant) && u$1("div", {
						class: "nr-status",
						children: [u$1("div", { class: "nr-spinner" }), u$1("span", { children: "正在加载简繁转换字典…" })]
					}), hans && hant && u$1(S, { children: [
						!others.length && u$1("div", {
							class: "nr-empty",
							children: "没有其它已启用的站点，可在设置 → 站点里添加"
						}),
						u$1("div", {
							class: "nr-source is-current",
							children: u$1("div", {
								class: "nr-source-main",
								children: [u$1("div", {
									class: "nr-source-line",
									children: [u$1("span", {
										class: "nr-source-site",
										children: site.name
									}), u$1("span", {
										class: "nr-chip is-accent",
										children: "当前"
									})]
								}), u$1("div", {
									class: "nr-hint",
									children: currentToc ? `共 ${currentTotal} 章 · 最新：${convert(currentToc.at(-1)?.title ?? "")}` : "正在获取目录…"
								})]
							})
						}),
						rows.map(({ row, s }) => {
							const m = current ? matchChapter(current.title, current.index, row.toc, hans) : { kind: "none" };
							const diff = currentTotal === void 0 ? void 0 : row.toc.length - currentTotal;
							const authorState = sameAuthor(row);
							return u$1("div", {
								class: "nr-source",
								children: [u$1("button", {
									class: "nr-source-main",
									onClick: () => onSwitch(row, m),
									title: m.kind === "none" ? "打开书页" : "跳到对应章节",
									children: [u$1("div", {
										class: "nr-source-line",
										children: [
											u$1("span", {
												class: "nr-source-site",
												children: s.name
											}),
											u$1("span", {
												class: "nr-chip",
												children: row.origin === "shelf" ? "书架" : "搜索"
											}),
											authorState !== "same" && u$1("span", {
												class: "nr-chip is-warn",
												children: authorState === "different" ? `作者不同：${convert(row.author)}` : "作者未知"
											}),
											u$1("span", {
												class: "nr-source-match",
												children: matchLabel(m)
											})
										]
									}), u$1("div", {
										class: "nr-hint",
										children: [
											"共 ",
											row.toc.length,
											" 章",
											diff !== void 0 && diff !== 0 && u$1("b", {
												class: diff > 0 ? "nr-diff-up" : "nr-diff-down",
												children: [
													"（",
													diff > 0 ? `+${diff}` : diff,
													"）"
												]
											}),
											row.toc.length > 0 && ` · 最新：${convert(row.toc.at(-1).title)}`
										]
									})]
								}), u$1("button", {
									class: "nr-btn is-ghost is-small",
									title: "在新标签页打开书页",
									onClick: () => window.open(row.bookUrl, "_blank", "noopener"),
									children: [u$1(IconExternal, {
										width: 14,
										height: 14
									}), "书页"]
								})]
							}, row.bookUrl);
						}),
						pending.map((s) => {
							const st = states[s.id];
							return u$1("div", {
								class: "nr-source is-pending",
								children: [
									u$1("div", {
										class: "nr-source-main",
										children: [u$1("div", {
											class: "nr-source-line",
											children: u$1("span", {
												class: "nr-source-site",
												children: s.name
											})
										}), u$1("div", {
											class: "nr-hint",
											children: [
												st.kind === "loading" && (st.note ?? "搜索中…"),
												st.kind === "verify" && "站点要求人机验证",
												st.kind === "rate" && "搜索过于频繁",
												st.kind === "error" && `出错：${st.message}`
											]
										})]
									}),
									st.kind === "loading" && u$1("div", { class: "nr-spinner is-small" }),
									st.kind === "verify" && u$1("button", {
										class: "nr-btn is-small is-primary",
										onClick: () => openVerify(st.url, () => void run(s)),
										children: "打开验证"
									}),
									(st.kind === "rate" || st.kind === "error") && u$1("button", {
										class: "nr-btn is-small",
										onClick: () => void run(s),
										children: st.kind === "rate" ? "稍后重试" : "重试"
									})
								]
							}, s.id);
						}),
						notFound.map((s) => u$1("div", {
							class: "nr-source is-missing",
							children: [u$1("div", {
								class: "nr-source-main",
								children: [u$1("div", {
									class: "nr-source-line",
									children: u$1("span", {
										class: "nr-source-site",
										children: s.name
									})
								}), u$1("div", {
									class: "nr-hint",
									children: "未找到同名书"
								})]
							}), u$1("button", {
								class: "nr-btn is-ghost is-small",
								onClick: () => window.open(searchPageUrl(s, name), "_blank", "noopener"),
								children: "去站内搜索"
							})]
						}, s.id))
					] })]
				})
			]
		});
	}
	var THEMES = [
		{
			id: "gray",
			name: "浅灰",
			swatch: "#e2e2e2"
		},
		{
			id: "white",
			name: "米白",
			swatch: "#f6f3ec"
		},
		{
			id: "parchment",
			name: "羊皮纸",
			swatch: "#efe3c2"
		},
		{
			id: "green",
			name: "护眼绿",
			swatch: "#d7ecd8"
		},
		{
			id: "blue",
			name: "浅蓝",
			swatch: "#d6e6ee"
		},
		{
			id: "dark",
			name: "夜间",
			swatch: "#1b1b1d"
		}
	];
	var FONTS = [
		{
			id: "hei",
			name: "黑体",
			stack: "'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Source Han Sans SC', sans-serif"
		},
		{
			id: "song",
			name: "宋体",
			stack: "'Songti SC', STSong, SimSun, 'Noto Serif CJK SC', 'Source Han Serif SC', serif"
		},
		{
			id: "kai",
			name: "楷体",
			stack: "'Kaiti SC', STKaiti, KaiTi, BiauKai, serif"
		}
	];
	var FONT_SIZE = {
		min: 12,
		max: 40,
		step: 2
	};
	var WIDTHS = [
		0,
		640,
		800,
		900,
		1e3,
		1280
	];
	var LINE_HEIGHTS = [
		1.5,
		1.8,
		2,
		2.2
	];
	var PARAGRAPH_SPACINGS = [
		.5,
		1,
		1.5,
		2
	];
	var PAGE_MODES = [{
		id: "chapter",
		name: "章节翻页"
	}, {
		id: "scroll",
		name: "滚动翻页"
	}];
	var SCRIPT_MODES = [
		{
			id: "raw",
			name: "原文"
		},
		{
			id: "hans",
			name: "简体"
		},
		{
			id: "hant",
			name: "繁体"
		}
	];
	function readerVars(s) {
		const font = FONTS.find((f) => f.id === s.font) ?? FONTS[0];
		const custom = s.customFont?.trim();
		const fontStack = custom ? `'${custom.replace(/['\\]/g, "")}', ${font.stack}` : font.stack;
		return [
			`--pw:${s.width ? `min(${s.width}px, calc(100vw - 180px))` : "min(1600px, calc(100vw - 180px))"}`,
			`--fs:${s.fontSize}px`,
			`--lh:${s.lineHeight}`,
			`--ps:${s.paragraphSpacing}em`,
			`--indent:${s.indent === false ? "0" : "2em"}`,
			`--align:${s.justify === false ? "left" : "justify"}`,
			`--read-font:${fontStack}`
		].join(";");
	}
	var BACKUP_CATEGORIES = [
		{
			id: "settings",
			name: "阅读设置",
			desc: "主题、字体、字号、宽度、间距、翻页、简繁"
		},
		{
			id: "sites",
			name: "站点与过滤",
			desc: "站点规则、站点过滤正则、划选过滤文字、正文替换"
		},
		{
			id: "reading",
			name: "阅读记录",
			desc: "书架、阅读进度、已读章节、书名作者"
		},
		{
			id: "excerpts",
			name: "摘录",
			desc: "所有书的摘录"
		}
	];
	var FORMAT = "novel-reader-backup";
	var VERSION = 1;
	function prefixed(prefix) {
		const out = {};
		for (const key of _GM_listValues()) if (key.startsWith(prefix)) out[key.slice(prefix.length)] = _GM_getValue(key);
		return out;
	}
	function collectBackup(categories) {
		const data = {};
		const has = (c) => categories.includes(c);
		if (has("settings")) data.settings = _GM_getValue(SETTINGS_KEY, {});
		if (has("sites")) data.sites = loadCustomizedSites();
		if (has("reading")) {
			data.shelf = _GM_getValue(SHELF_KEY, []);
			data.read = prefixed(READ_PREFIX);
			data.readTitles = prefixed(READ_TITLES_PREFIX);
			data.bookInfo = prefixed(BOOK_INFO_PREFIX);
		}
		if (has("excerpts")) data.excerpts = _GM_getValue(EXCERPTS_KEY, []);
		return {
			format: FORMAT,
			version: VERSION,
			exportedAt: new Date().toISOString(),
			data
		};
	}
	function summarize(data) {
		const read = Object.values(data.read ?? {});
		return {
			settings: !!data.settings && Object.keys(data.settings).length > 0,
			sites: data.sites?.length ?? 0,
			books: data.shelf?.length ?? 0,
			readBooks: read.length,
			readChapters: read.reduce((n, list) => n + list.length, 0),
			excerpts: data.excerpts?.length ?? 0
		};
	}
	function currentSummary() {
		return summarize(collectBackup(BACKUP_CATEGORIES.map((c) => c.id)).data);
	}
	function downloadBackup(file) {
		const name = `novel-reader-backup-${file.exportedAt.slice(0, 10).replace(/-/g, "")}.json`;
		const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = name;
		document.body.append(a);
		a.click();
		a.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 1e3);
		return name;
	}
	var isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
	var isHttpUrl = (v) => typeof v === "string" && /^https?:\/\//i.test(v);
	function parseBackup(text) {
		let raw;
		try {
			raw = JSON.parse(text);
		} catch {
			throw new Error("不是合法的 JSON 文件");
		}
		if (!isObject(raw) || raw.format !== FORMAT) throw new Error("不是小说阅读模式导出的备份文件");
		if (typeof raw.version !== "number" || raw.version > VERSION) throw new Error(`备份文件版本 ${String(raw.version)} 比当前脚本新，请先更新脚本`);
		const d = raw.data;
		if (!isObject(d)) throw new Error("备份文件缺少 data");
		if (d.settings !== void 0 && !isObject(d.settings)) throw new Error("settings 必须是对象");
		if (d.sites !== void 0) {
			if (!Array.isArray(d.sites)) throw new Error("sites 必须是数组");
			d.sites.forEach(validateSite);
		}
		if (d.shelf !== void 0) {
			if (!Array.isArray(d.shelf)) throw new Error("shelf 必须是数组");
			for (const b of d.shelf) {
				if (!isObject(b) || typeof b.name !== "string" || typeof b.matchKey !== "string" || !Array.isArray(b.sources)) throw new Error("书架条目格式不正确");
				for (const src of b.sources) if (!isObject(src) || typeof src.bookKey !== "string" || !isHttpUrl(src.lastUrl) || src.bookUrl !== void 0 && !isHttpUrl(src.bookUrl)) throw new Error("书架来源格式或链接地址不正确");
			}
		}
		if (d.read !== void 0 && !(isObject(d.read) && Object.values(d.read).every(isStringArray))) throw new Error("read 必须是「书 → 章节地址数组」");
		if (d.readTitles !== void 0 && !(isObject(d.readTitles) && Object.values(d.readTitles).every(isStringArray))) throw new Error("readTitles 必须是「书 → 章节标题数组」");
		if (d.bookInfo !== void 0 && !(isObject(d.bookInfo) && Object.values(d.bookInfo).every((i) => isObject(i) && typeof i.name === "string"))) throw new Error("bookInfo 格式不正确");
		if (d.excerpts !== void 0) {
			if (!Array.isArray(d.excerpts)) throw new Error("excerpts 必须是数组");
			for (const e of d.excerpts) if (!isObject(e) || typeof e.id !== "string" || typeof e.text !== "string") throw new Error("摘录条目格式不正确");
		}
		return raw;
	}
	function mergeShelf(local, incoming) {
		const shelf = local.map((b) => ({
			...b,
			sources: [...b.sources]
		}));
		for (const book of incoming) {
			const existing = shelf.find((b) => b.matchKey === book.matchKey);
			if (!existing) {
				shelf.push(book);
				continue;
			}
			existing.author ??= book.author;
			for (const src of book.sources) {
				const idx = existing.sources.findIndex((s) => s.bookKey === src.bookKey);
				if (idx < 0) existing.sources.push(src);
				else if (src.updated > existing.sources[idx].updated) existing.sources[idx] = src;
			}
		}
		return shelf;
	}
	function importBackup(data) {
		if (data.settings) {
			const defaults = DEFAULT_SETTINGS;
			const known = Object.fromEntries(Object.entries(data.settings).filter(([k, v]) => k in defaults && typeof v === typeof defaults[k]));
			_GM_setValue(SETTINGS_KEY, {
				..._GM_getValue(SETTINGS_KEY, {}),
				...known
			});
		}
		if (data.sites) importSites(data.sites);
		if (data.shelf) _GM_setValue(SHELF_KEY, mergeShelf(_GM_getValue(SHELF_KEY, []), data.shelf));
		const union = (prefix, lists) => {
			for (const [id, values] of Object.entries(lists ?? {})) {
				const local = _GM_getValue(prefix + id, []);
				_GM_setValue(prefix + id, [...local, ...values.filter((v) => !local.includes(v))]);
			}
		};
		union(READ_PREFIX, data.read);
		union(READ_TITLES_PREFIX, data.readTitles);
		for (const [bookKey, info] of Object.entries(data.bookInfo ?? {})) _GM_setValue(BOOK_INFO_PREFIX + bookKey, info);
		if (data.excerpts) {
			const local = _GM_getValue(EXCERPTS_KEY, []);
			const ids = new Set(local.map((e) => e.id));
			_GM_setValue(EXCERPTS_KEY, [...local, ...data.excerpts.filter((e) => !ids.has(e.id))].sort((a, b) => a.time - b.time));
		}
	}
	function describe(id, s) {
		switch (id) {
			case "settings": return s.settings ? "已自定义" : "默认";
			case "sites": return `${s.sites} 个站点`;
			case "reading": return `书架 ${s.books} 本 · 已读 ${s.readChapters} 章`;
			case "excerpts": return `${s.excerpts} 条`;
		}
	}
	function hasCategory(file, id) {
		const d = file.data;
		switch (id) {
			case "settings": return !!d.settings;
			case "sites": return !!d.sites;
			case "reading": return !!(d.shelf || d.read || d.readTitles || d.bookInfo);
			case "excerpts": return !!d.excerpts;
		}
	}
	function CategoryList({ items, checked, onToggle, summary }) {
		return u$1("ul", {
			class: "nr-data-list",
			children: items.map((c) => u$1("li", {
				class: checked.has(c.id) ? "is-checked" : "",
				onClick: () => onToggle(c.id),
				children: [u$1("span", {
					class: "nr-check",
					children: checked.has(c.id) && u$1(IconCheck, {
						width: 12,
						height: 12
					})
				}), u$1("div", {
					class: "nr-data-main",
					children: [u$1("div", {
						class: "nr-data-name",
						children: [c.name, u$1("span", {
							class: "nr-chip",
							children: describe(c.id, summary)
						})]
					}), u$1("div", {
						class: "nr-hint",
						children: c.desc
					})]
				})]
			}, c.id))
		});
	}
	var toggled = (set, id) => {
		const next = new Set(set);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		return next;
	};
	function DataPanel({ onImported, showToast }) {
		const [summary, setSummary] = d(currentSummary);
		const [exportSel, setExportSel] = d(() => new Set(BACKUP_CATEGORIES.map((c) => c.id)));
		const [pending, setPending] = d();
		const [importSel, setImportSel] = d(new Set());
		const [error, setError] = d();
		const fileInput = A(null);
		const doExport = () => {
			showToast(`已导出 ${downloadBackup(collectBackup([...exportSel]))}`);
		};
		const pickFile = async (input) => {
			const f = input.files?.[0];
			input.value = "";
			if (!f) return;
			setError(void 0);
			try {
				const file = parseBackup(await f.text());
				setPending({
					file,
					name: f.name
				});
				setImportSel(new Set(BACKUP_CATEGORIES.filter((c) => hasCategory(file, c.id)).map((c) => c.id)));
			} catch (e) {
				setPending(void 0);
				setError(`${f.name}：${e.message}`);
			}
		};
		const doImport = () => {
			if (!pending) return;
			const d = pending.file.data;
			const has = (c) => importSel.has(c);
			importBackup({
				settings: has("settings") ? d.settings : void 0,
				sites: has("sites") ? d.sites : void 0,
				shelf: has("reading") ? d.shelf : void 0,
				read: has("reading") ? d.read : void 0,
				bookInfo: has("reading") ? d.bookInfo : void 0,
				readTitles: has("reading") ? d.readTitles : void 0,
				excerpts: has("excerpts") ? d.excerpts : void 0
			});
			setPending(void 0);
			setSummary(currentSummary());
			onImported();
			showToast("导入完成");
		};
		return u$1(S, { children: [u$1("section", {
			class: "nr-filter-section",
			children: [
				u$1("div", {
					class: "nr-filter-title",
					children: "导出"
				}),
				u$1("p", {
					class: "nr-hint",
					children: "导出为 JSON 文件，可在其它浏览器或重装脚本后导入。"
				}),
				u$1(CategoryList, {
					items: BACKUP_CATEGORIES,
					checked: exportSel,
					onToggle: (id) => setExportSel((s) => toggled(s, id)),
					summary
				}),
				u$1("div", {
					class: "nr-site-actions",
					children: u$1("button", {
						class: "nr-btn is-primary",
						disabled: !exportSel.size,
						onClick: doExport,
						children: [u$1(IconDownload, {
							width: 16,
							height: 16
						}), "导出文件"]
					})
				})
			]
		}), u$1("section", {
			class: "nr-filter-section",
			children: [
				u$1("div", {
					class: "nr-filter-title",
					children: "导入"
				}),
				u$1("p", {
					class: "nr-hint",
					children: "与本机数据合并，不会删除已有内容：设置和同名站点规则以文件为准，书架按书合并并保留较新的进度，已读章节和摘录取并集。"
				}),
				u$1("input", {
					ref: fileInput,
					type: "file",
					accept: ".json,application/json",
					hidden: true,
					onChange: (e) => pickFile(e.currentTarget)
				}),
				pending ? u$1(S, { children: [
					u$1("div", {
						class: "nr-data-file",
						children: [u$1("span", {
							class: "nr-filter-text",
							children: pending.name
						}), u$1("span", {
							class: "nr-hint",
							children: ["导出于 ", new Date(pending.file.exportedAt).toLocaleString()]
						})]
					}),
					u$1(CategoryList, {
						items: BACKUP_CATEGORIES.filter((c) => hasCategory(pending.file, c.id)),
						checked: importSel,
						onToggle: (id) => setImportSel((s) => toggled(s, id)),
						summary: summarize(pending.file.data)
					}),
					u$1("div", {
						class: "nr-site-actions",
						children: [u$1("button", {
							class: "nr-btn is-primary",
							disabled: !importSel.size,
							onClick: doImport,
							children: "导入所选"
						}), u$1("button", {
							class: "nr-btn",
							onClick: () => setPending(void 0),
							children: "取消"
						})]
					})
				] }) : u$1("div", {
					class: "nr-site-actions",
					children: u$1("button", {
						class: "nr-btn",
						onClick: () => fileInput.current?.click(),
						children: [u$1(IconUpload, {
							width: 16,
							height: 16
						}), "选择备份文件"]
					})
				}),
				error && u$1("div", {
					class: "nr-error",
					children: error
				})
			]
		})] });
	}
	function AddForm({ placeholder, onAdd }) {
		const [value, setValue] = d("");
		const [error, setError] = d();
		return u$1(S, { children: [u$1("form", {
			class: "nr-add-row",
			style: "margin:8px 0 0",
			onSubmit: (e) => {
				e.preventDefault();
				const err = onAdd(value.trim());
				setError(err);
				if (!err) setValue("");
			},
			children: [u$1("input", {
				class: "nr-input",
				placeholder,
				value,
				onInput: (e) => setValue(e.currentTarget.value)
			}), u$1("button", {
				type: "submit",
				class: "nr-btn",
				disabled: !value.trim(),
				children: "添加"
			})]
		}), error && u$1("div", {
			class: "nr-error",
			children: error
		})] });
	}
	function ReplaceForm({ onAdd }) {
		const [from, setFrom] = d("");
		const [to, setTo] = d("");
		const [error, setError] = d();
		return u$1(S, { children: [u$1("form", {
			class: "nr-add-row",
			style: "margin:8px 0 0",
			onSubmit: (e) => {
				e.preventDefault();
				const err = onAdd(from.trim(), to);
				setError(err);
				if (!err) {
					setFrom("");
					setTo("");
				}
			},
			children: [
				u$1("input", {
					class: "nr-input",
					placeholder: "查找正则或文字，例如 什幺",
					value: from,
					onInput: (e) => setFrom(e.currentTarget.value)
				}),
				u$1("input", {
					class: "nr-input",
					placeholder: "替换为（可留空）",
					value: to,
					onInput: (e) => setTo(e.currentTarget.value)
				}),
				u$1("button", {
					type: "submit",
					class: "nr-btn",
					disabled: !from.trim(),
					children: "添加"
				})
			]
		}), error && u$1("div", {
			class: "nr-error",
			children: error
		})] });
	}
	function FiltersPanel({ site, onSiteChange, showToast }) {
		const [entry, setEntry] = d(() => loadSites().find((s) => s.id === site.id));
		const builtinFilters = BUILTIN_SITES.find((b) => b.id === site.id)?.filters ?? [];
		const apply = (updated) => {
			setEntry(updated);
			onSiteChange(updated);
		};
		const addFilter = (pattern) => {
			try {
				new RegExp(pattern);
			} catch {
				return `不是合法的正则表达式：${pattern}`;
			}
			if (entry?.filters?.includes(pattern)) return "这条规则已存在";
			apply(updateSiteFilters(site.id, (list) => [...list, pattern]));
			showToast("已添加站点规则");
		};
		const addStrip = (text) => {
			if (entry?.strip?.includes(text)) return "这段文字已在列表中";
			apply(updateSiteStrip(site.id, (list) => [...list, text]));
			showToast("已添加过滤文字");
		};
		const addReplace = (from, to) => {
			try {
				new RegExp(from, "g");
			} catch {
				return `不是合法的正则表达式：${from}`;
			}
			if (entry?.replace?.some((r) => r.from === from)) return "这条替换规则已存在";
			apply(updateSiteReplace(site.id, (list) => [...list, {
				from,
				to
			}]));
			showToast("已添加替换规则");
		};
		return u$1(S, { children: [u$1("section", {
			class: "nr-filter-section",
			children: [
				u$1("div", {
					class: "nr-filter-title",
					children: ["系统规则", u$1("span", {
						class: "nr-chip",
						children: "所有站点 · 只读"
					})]
				}),
				u$1("p", {
					class: "nr-hint",
					children: "命中则整段删除。匹配前会把花体字母（𝕥𝕨𝕜𝕒𝕟、🆃🆆🅺🅰🅽、t̴w̴k̴a̴n̴ 等）还原成普通字母。"
				}),
				u$1("ul", {
					class: "nr-filter-list",
					children: COMMON_FILTERS.map((f) => u$1("li", { children: [u$1("code", { children: f.pattern }), u$1("span", {
						class: "nr-hint",
						children: f.desc
					})] }, f.pattern))
				})
			]
		}), !entry ? u$1("div", {
			class: "nr-error",
			children: "本站还不在阅读站点列表中，先在「站点」里添加后才能设置本站的过滤规则。"
		}) : u$1(S, { children: [
			u$1("section", {
				class: "nr-filter-section",
				children: [
					u$1("div", {
						class: "nr-filter-title",
						children: ["站点规则", u$1("span", {
							class: "nr-chip",
							children: entry.name
						})]
					}),
					u$1("p", {
						class: "nr-hint",
						children: "正则表达式，命中则整段删除，适合整行的广告。"
					}),
					entry.filters?.length ? u$1("ul", {
						class: "nr-filter-list",
						children: entry.filters.map((f) => u$1("li", { children: [
							u$1("code", { children: f }),
							builtinFilters.includes(f) && u$1("span", {
								class: "nr-chip",
								children: "内置"
							}),
							u$1("button", {
								class: "nr-btn is-ghost nr-icon-btn nr-filter-del",
								title: "删除",
								onClick: () => apply(updateSiteFilters(site.id, (list) => list.filter((x) => x !== f))),
								children: u$1(IconClose, {
									width: 14,
									height: 14
								})
							})
						] }, f))
					}) : u$1("div", {
						class: "nr-hint nr-filter-empty",
						children: "暂无"
					}),
					u$1(AddForm, {
						placeholder: "正则，例如 追.*就上.*小说网",
						onAdd: addFilter
					})
				]
			}),
			u$1("section", {
				class: "nr-filter-section",
				children: [
					u$1("div", {
						class: "nr-filter-title",
						children: ["划选过滤文字", u$1("span", {
							class: "nr-chip",
							children: entry.name
						})]
					}),
					u$1("p", {
						class: "nr-hint",
						children: "按原样匹配显示出来的文字，只删除这段文字本身；删完为空的段落整段去掉。在正文中划选后点「过滤」即可添加。"
					}),
					entry.strip?.length ? u$1("ul", {
						class: "nr-filter-list",
						children: entry.strip.map((w) => u$1("li", { children: [u$1("span", {
							class: "nr-filter-text",
							children: w
						}), u$1("button", {
							class: "nr-btn is-ghost nr-icon-btn nr-filter-del",
							title: "删除",
							onClick: () => apply(updateSiteStrip(site.id, (list) => list.filter((x) => x !== w))),
							children: u$1(IconClose, {
								width: 14,
								height: 14
							})
						})] }, w))
					}) : u$1("div", {
						class: "nr-hint nr-filter-empty",
						children: "暂无"
					}),
					u$1(AddForm, {
						placeholder: "要删除的文字",
						onAdd: addStrip
					})
				]
			}),
			u$1("section", {
				class: "nr-filter-section",
				children: [
					u$1("div", {
						class: "nr-filter-title",
						children: ["正文替换", u$1("span", {
							class: "nr-chip",
							children: entry.name
						})]
					}),
					u$1("p", {
						class: "nr-hint",
						children: "按正则表达式全局替换显示正文中的错别字或替代词，改动立即生效。"
					}),
					entry.replace?.length ? u$1("ul", {
						class: "nr-filter-list",
						children: entry.replace.map((r) => u$1("li", { children: [
							u$1("code", { children: r.from }),
							u$1("span", {
								class: "nr-hint",
								style: "text-align:left",
								children: ["→ ", r.to || "（删除）"]
							}),
							u$1("button", {
								class: "nr-btn is-ghost nr-icon-btn nr-filter-del",
								title: "删除",
								onClick: () => apply(updateSiteReplace(site.id, (list) => list.filter((x) => x.from !== r.from))),
								children: u$1(IconClose, {
									width: 14,
									height: 14
								})
							})
						] }, r.from))
					}) : u$1("div", {
						class: "nr-hint nr-filter-empty",
						children: "暂无"
					}),
					u$1(ReplaceForm, { onAdd: addReplace })
				]
			})
		] })] });
	}
	function SiteCard({ site, isCurrent, onChange, onReadapt, showToast }) {
		const [editing, setEditing] = d(false);
		const [draft, setDraft] = d("");
		const [error, setError] = d();
		const openEditor = () => {
			setDraft(JSON.stringify(site, null, 2));
			setError(void 0);
			setEditing(!editing);
		};
		const save = () => {
			try {
				const entry = validateSite(JSON.parse(draft));
				if (entry.id !== site.id) throw new Error("不能修改 id");
				onChange(upsertSite({
					...entry,
					builtin: site.builtin
				}));
				setEditing(false);
				showToast("规则已保存，重新进入阅读模式后生效");
			} catch (e) {
				setError(e.message);
			}
		};
		return u$1("div", {
			class: `nr-site${isCurrent ? " is-current" : ""}`,
			children: [
				u$1("div", {
					class: "nr-site-head",
					children: [u$1("div", {
						style: "flex:1;min-width:0",
						children: [u$1("div", {
							style: "display:flex;align-items:center;gap:6px",
							children: [
								u$1("span", {
									class: "nr-site-name",
									children: site.name
								}),
								isCurrent && u$1("span", {
									class: "nr-chip is-accent",
									children: "当前"
								}),
								site.builtin && u$1("span", {
									class: "nr-chip",
									children: "内置"
								}),
								u$1("span", {
									class: "nr-chip",
									children: site.content || site.adapter ? "已适配" : "自动识别"
								})
							]
						}), u$1("div", {
							class: "nr-site-hosts",
							children: site.hosts.join("、")
						})]
					}), u$1("button", {
						class: `nr-switch${site.enabled ? " is-on" : ""}`,
						role: "switch",
						"aria-checked": site.enabled,
						title: site.enabled ? "已启用" : "已禁用",
						onClick: () => onChange(upsertSite({
							...site,
							enabled: !site.enabled
						}))
					})]
				}),
				!!site.strip?.length && u$1("div", {
					class: "nr-strips",
					title: "划选加入的过滤文字",
					children: site.strip.map((word) => u$1("span", {
						class: "nr-strip",
						children: [u$1("span", { children: word }), u$1("button", {
							title: "移除",
							onClick: () => {
								updateSiteStrip(site.id, (list) => list.filter((w) => w !== word));
								onChange(loadSites());
							},
							children: u$1(IconClose, {
								width: 12,
								height: 12
							})
						})]
					}, word))
				}),
				u$1("div", {
					class: "nr-site-actions",
					children: [
						isCurrent && u$1("button", {
							class: "nr-btn is-small",
							onClick: onReadapt,
							children: "重新适配本站"
						}),
						u$1("button", {
							class: `nr-btn is-small${editing ? " is-active" : ""}`,
							onClick: openEditor,
							children: "编辑规则"
						}),
						site.builtin ? u$1("button", {
							class: "nr-btn is-small is-ghost",
							onClick: () => {
								onChange(resetBuiltinSite(site.id));
								showToast(`${site.name} 已恢复默认规则`);
							},
							children: "恢复默认"
						}) : u$1("button", {
							class: "nr-btn is-small is-ghost is-danger",
							onClick: () => {
								if (confirm(`确定删除站点「${site.name}」及其适配规则？`)) onChange(removeSite(site.id));
							},
							children: "删除"
						})
					]
				}),
				editing && u$1("div", {
					class: "nr-site-editor",
					children: [
						u$1("textarea", {
							class: "nr-textarea",
							value: draft,
							onInput: (e) => setDraft(e.currentTarget.value),
							spellcheck: false
						}),
						error && u$1("div", {
							class: "nr-error",
							children: error
						}),
						u$1("div", {
							class: "nr-site-actions",
							style: "justify-content:flex-end",
							children: [u$1("button", {
								class: "nr-btn is-small is-ghost",
								onClick: () => setEditing(false),
								children: "取消"
							}), u$1("button", {
								class: "nr-btn is-small is-primary",
								onClick: save,
								children: "保存"
							})]
						})
					]
				})
			]
		});
	}
	function SitesPanel({ currentSite, onReadapt, onSiteChange, showToast }) {
		const [sites, setSitesState] = d(loadSites);
		const setSites = (next) => {
			setSitesState(next);
			const cur = next.find((s) => s.id === currentSite.id);
			if (cur) onSiteChange(cur);
		};
		const [input, setInput] = d("");
		const [error, setError] = d();
		const [importing, setImporting] = d(false);
		const [importText, setImportText] = d("");
		const add = () => {
			try {
				const entry = createSite(input);
				setSites(loadSites());
				setInput("");
				setError(void 0);
				showToast(`已添加 ${entry.hosts[0]}，打开该站章节页即可使用`);
			} catch (e) {
				setError(e.message);
			}
		};
		const exportAll = () => {
			_GM_setClipboard(JSON.stringify(sites, null, 2), "text");
			showToast(`已复制 ${sites.length} 个站点规则到剪贴板`);
		};
		const doImport = () => {
			try {
				const parsed = JSON.parse(importText);
				const incoming = (Array.isArray(parsed) ? parsed : [parsed]).map(validateSite);
				setSites(importSites(incoming));
				setImporting(false);
				setImportText("");
				setError(void 0);
				showToast(`已导入 ${incoming.length} 个站点规则`);
			} catch (e) {
				setError(`导入失败：${e.message}`);
			}
		};
		return u$1(S, { children: [
			u$1("form", {
				class: "nr-add-row",
				onSubmit: (e) => {
					e.preventDefault();
					add();
				},
				children: [u$1("input", {
					class: "nr-input",
					placeholder: "输入网址或域名，例如 www.example.com",
					value: input,
					onInput: (e) => setInput(e.currentTarget.value)
				}), u$1("button", {
					type: "submit",
					class: "nr-btn is-primary",
					disabled: !input.trim(),
					children: "添加"
				})]
			}),
			error && u$1("div", {
				class: "nr-error",
				style: "margin:-6px 0 12px",
				children: error
			}),
			sites.map((site) => u$1(SiteCard, {
				site,
				isCurrent: site.id === currentSite.id,
				onChange: setSites,
				onReadapt,
				showToast
			}, site.id)),
			u$1("div", {
				class: "nr-site-actions",
				style: "margin-top:4px",
				children: [u$1("button", {
					class: "nr-btn is-small",
					onClick: exportAll,
					children: "导出全部规则"
				}), u$1("button", {
					class: `nr-btn is-small${importing ? " is-active" : ""}`,
					onClick: () => setImporting(!importing),
					children: "导入规则"
				})]
			}),
			importing && u$1("div", {
				class: "nr-site-editor",
				children: [u$1("textarea", {
					class: "nr-textarea",
					placeholder: "粘贴导出的 JSON（单个站点对象或数组）",
					value: importText,
					onInput: (e) => setImportText(e.currentTarget.value),
					spellcheck: false
				}), u$1("div", {
					class: "nr-site-actions",
					style: "justify-content:flex-end",
					children: u$1("button", {
						class: "nr-btn is-small is-primary",
						onClick: doImport,
						disabled: !importText.trim(),
						children: "导入"
					})
				})]
			}),
			u$1("p", {
				class: "nr-hint",
				style: "margin:14px 0 0",
				children: "在列表中的站点上，识别到章节页时右下角会出现「阅读模式」按钮；未适配的站点识别失败时会出现「适配本站」按钮。"
			})
		] });
	}
	function Row({ label, children }) {
		return u$1("div", {
			class: "nr-row",
			children: [u$1("span", {
				class: "nr-row-label",
				children: label
			}), u$1("div", { children })]
		});
	}
	function Options({ items, value, onChange, label, compact }) {
		return u$1("div", {
			class: `nr-options${compact ? " is-compact" : ""}`,
			children: items.map((it) => u$1("button", {
				class: `nr-btn${it === value ? " is-active" : ""}`,
				onClick: () => onChange(it),
				children: label(it)
			}, String(it)))
		});
	}
	function SettingsPanel({ settings: s, update, setPageMode, site, onReadapt, onSiteChange, onImported, onClose, showToast }) {
		const [tab, setTab] = d("read");
		return u$1("section", {
			class: "nr-panel",
			role: "dialog",
			"aria-label": "设置",
			children: [u$1("div", {
				class: "nr-panel-head",
				children: [u$1("h2", { children: "设置" }), u$1("div", {
					style: "display:flex;align-items:center;gap:8px",
					children: [u$1("div", {
						class: "nr-segment",
						children: [
							u$1("button", {
								class: tab === "read" ? "is-active" : "",
								onClick: () => setTab("read"),
								children: "阅读"
							}),
							u$1("button", {
								class: tab === "filters" ? "is-active" : "",
								onClick: () => setTab("filters"),
								children: "过滤"
							}),
							u$1("button", {
								class: tab === "sites" ? "is-active" : "",
								onClick: () => setTab("sites"),
								children: "站点"
							}),
							u$1("button", {
								class: tab === "data" ? "is-active" : "",
								onClick: () => setTab("data"),
								children: "数据"
							})
						]
					}), u$1("button", {
						class: "nr-btn is-ghost nr-icon-btn",
						onClick: onClose,
						title: "关闭",
						children: u$1(IconClose, {
							width: 18,
							height: 18
						})
					})]
				})]
			}), u$1("div", {
				class: "nr-panel-body",
				children: [
					tab === "read" && u$1(S, { children: [
						u$1(Row, {
							label: "阅读主题",
							children: u$1("div", {
								class: "nr-swatches",
								children: THEMES.map((t) => u$1("button", {
									class: `nr-swatch${s.theme === t.id ? " is-active" : ""}`,
									"data-swatch": t.id,
									style: { background: t.swatch },
									title: t.name,
									onClick: () => update({ theme: t.id }),
									children: s.theme === t.id ? u$1(IconCheck, {
										width: 18,
										height: 18
									}) : t.id === "dark" && u$1(IconMoon, {
										width: 16,
										height: 16,
										style: "color:#888"
									})
								}, t.id))
							})
						}),
						u$1(Row, {
							label: "正文字体",
							children: [u$1("div", {
								class: "nr-options",
								children: FONTS.map((f) => u$1("button", {
									class: `nr-btn${s.font === f.id ? " is-active" : ""}`,
									style: { fontFamily: f.stack },
									onClick: () => update({ font: f.id }),
									children: f.name
								}, f.id))
							}), u$1("input", {
								class: "nr-input",
								style: "margin-top:8px",
								placeholder: "可选：输入本机字体名，如 霞鹜文楷",
								value: s.customFont,
								onInput: (e) => update({ customFont: e.currentTarget.value })
							})]
						}),
						u$1(Row, {
							label: "字体大小",
							children: u$1("div", {
								class: "nr-stepper",
								children: [
									u$1("button", {
										disabled: s.fontSize <= FONT_SIZE.min,
										onClick: () => update({ fontSize: s.fontSize - FONT_SIZE.step }),
										children: "A-"
									}),
									u$1("span", { children: s.fontSize }),
									u$1("button", {
										disabled: s.fontSize >= FONT_SIZE.max,
										onClick: () => update({ fontSize: s.fontSize + FONT_SIZE.step }),
										children: "A+"
									})
								]
							})
						}),
						u$1(Row, {
							label: "页面宽度",
							children: u$1(Options, {
								compact: true,
								items: WIDTHS,
								value: s.width,
								onChange: (width) => update({ width }),
								label: (w) => w ? String(w) : "自动"
							})
						}),
						u$1(Row, {
							label: "行间距",
							children: u$1(Options, {
								items: LINE_HEIGHTS,
								value: s.lineHeight,
								onChange: (lineHeight) => update({ lineHeight }),
								label: (v) => v.toFixed(1)
							})
						}),
						u$1(Row, {
							label: "段间距",
							children: u$1(Options, {
								items: PARAGRAPH_SPACINGS,
								value: s.paragraphSpacing,
								onChange: (paragraphSpacing) => update({ paragraphSpacing }),
								label: (v) => `${v}em`
							})
						}),
						u$1(Row, {
							label: "翻页模式",
							children: u$1(Options, {
								items: PAGE_MODES.map((m) => m.id),
								value: s.pageMode,
								onChange: setPageMode,
								label: (id) => PAGE_MODES.find((m) => m.id === id).name
							})
						}),
						u$1(Row, {
							label: "简繁",
							children: u$1(Options, {
								items: SCRIPT_MODES.map((m) => m.id),
								value: s.script,
								onChange: (script) => update({ script }),
								label: (id) => SCRIPT_MODES.find((m) => m.id === id).name
							})
						}),
						u$1(Row, {
							label: "排版辅助",
							children: u$1("div", {
								class: "nr-options is-compact",
								children: [
									u$1("button", {
										class: `nr-btn${s.indent !== false ? " is-active" : ""}`,
										onClick: () => update({ indent: s.indent === false }),
										children: "段首缩进"
									}),
									u$1("button", {
										class: `nr-btn${s.justify !== false ? " is-active" : ""}`,
										onClick: () => update({ justify: s.justify === false }),
										children: "两端对齐"
									}),
									u$1("button", {
										class: `nr-btn${s.mergeParagraphs !== false ? " is-active" : ""}`,
										onClick: () => update({ mergeParagraphs: s.mergeParagraphs === false }),
										title: "自动拼接句中被空行切断的段落",
										children: "断段合并"
									}),
									u$1("button", {
										class: `nr-btn${s.statusBar !== false ? " is-active" : ""}`,
										onClick: () => update({ statusBar: s.statusBar === false }),
										children: "信息底栏"
									})
								]
							})
						})
					] }),
					tab === "filters" && u$1(FiltersPanel, {
						site,
						onSiteChange,
						showToast
					}),
					tab === "sites" && u$1(SitesPanel, {
						currentSite: site,
						onReadapt,
						onSiteChange,
						showToast
					}),
					tab === "data" && u$1(DataPanel, {
						onImported,
						showToast
					})
				]
			})]
		});
	}
	var ROW_HEIGHT = 38;
	var VIRTUAL_THRESHOLD = 200;
	var OVERSCAN = 15;
	function TocPanel({ current, session, isRead, fullToc, reloadToc, convert, onJump, onClose }) {
		const [tab, setTab] = d("session");
		const [search, setSearch] = d("");
		const [reversed, setReversed] = d(false);
		const [scrollTop, setScrollTop] = d(0);
		const [viewportH, setViewportH] = d(600);
		const bodyRef = A(null);
		const listRef = A(null);
		const items = tab === "session" ? session : fullToc.kind === "ready" ? fullToc.items : [];
		const converted = T(() => items.map((it) => ({
			it,
			title: convert(it.title)
		})), [items, convert]);
		const rows = T(() => converted.map((r) => ({
			...r,
			read: isRead(r.it)
		})), [converted, isRead]);
		const displayRows = T(() => {
			const q = search.trim().toLowerCase();
			const filtered = q ? rows.filter((r) => r.title.toLowerCase().includes(q) || r.it.title.toLowerCase().includes(q)) : rows;
			return reversed ? [...filtered].reverse() : filtered;
		}, [
			rows,
			search,
			reversed
		]);
		const readCount = T(() => fullToc.kind === "ready" ? fullToc.items.filter(isRead).length : 0, [fullToc, isRead]);
		const virtual = displayRows.length > VIRTUAL_THRESHOLD;
		const start = virtual ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
		const visibleCount = virtual ? Math.ceil((viewportH || 600) / ROW_HEIGHT) + 30 : displayRows.length;
		const end = virtual ? Math.min(displayRows.length, start + visibleCount) : displayRows.length;
		const visibleRows = virtual ? displayRows.slice(start, end) : displayRows;
		const padTop = virtual ? start * ROW_HEIGHT : 0;
		const padBottom = virtual ? (displayRows.length - end) * ROW_HEIGHT : 0;
		const locate = (behavior = "smooth") => {
			if (virtual) {
				const idx = displayRows.findIndex((r) => r.it.url === current);
				const body = bodyRef.current;
				if (idx >= 0 && body) {
					const top = Math.max(0, idx * ROW_HEIGHT - body.clientHeight / 2 + ROW_HEIGHT / 2);
					body.scrollTo({
						top,
						behavior
					});
					setScrollTop(top);
				}
				return;
			}
			(listRef.current?.querySelector(".is-current"))?.scrollIntoView({
				block: "center",
				behavior
			});
		};
		h(() => {
			if (bodyRef.current) setViewportH(bodyRef.current.clientHeight || 600);
			locate("auto");
		}, [tab, fullToc.kind]);
		return u$1("section", {
			class: "nr-panel is-toc",
			role: "dialog",
			"aria-label": "目录",
			children: [
				u$1("div", {
					class: "nr-panel-head",
					children: [u$1("h2", { children: "目录" }), u$1("button", {
						class: "nr-btn is-ghost nr-icon-btn",
						onClick: onClose,
						title: "关闭",
						children: u$1(IconClose, {
							width: 18,
							height: 18
						})
					})]
				}),
				u$1("div", {
					class: "nr-panel-sub",
					children: [u$1("div", {
						class: "nr-segment",
						children: [u$1("button", {
							class: tab === "session" ? "is-active" : "",
							onClick: () => setTab("session"),
							children: "本次阅读"
						}), u$1("button", {
							class: tab === "full" ? "is-active" : "",
							onClick: () => setTab("full"),
							children: "全部章节"
						})]
					}), u$1("span", {
						class: "nr-hint",
						children: [tab === "session" ? `${session.length} 章` : fullToc.kind === "ready" ? `已读 ${readCount} / ${fullToc.items.length}` : "", u$1("button", {
							class: "nr-btn is-ghost nr-icon-btn",
							onClick: () => locate(),
							title: "定位当前章节",
							style: "vertical-align:middle",
							children: u$1(IconLocate, {
								width: 16,
								height: 16
							})
						})]
					})]
				}),
				!!items.length && u$1("div", {
					class: "nr-toc-tools",
					children: [u$1("input", {
						class: "nr-input",
						type: "search",
						placeholder: "筛选章节…",
						value: search,
						onInput: (e) => {
							setSearch(e.currentTarget.value);
							bodyRef.current?.scrollTo({ top: 0 });
							setScrollTop(0);
						}
					}), u$1("button", {
						class: `nr-btn is-small${reversed ? " is-active" : ""}`,
						onClick: () => {
							setReversed((r) => !r);
							bodyRef.current?.scrollTo({ top: 0 });
							setScrollTop(0);
						},
						title: "切换正序/倒序",
						children: reversed ? "倒序" : "正序"
					})]
				}),
				u$1("div", {
					class: "nr-panel-body",
					style: "padding:0",
					ref: bodyRef,
					onScroll: (e) => {
						if (virtual) setScrollTop(e.currentTarget.scrollTop);
					},
					children: [
						tab === "full" && (fullToc.kind === "loading" || fullToc.kind === "idle") && u$1("div", {
							class: "nr-status",
							children: [u$1("div", { class: "nr-spinner" }), u$1("span", { children: "正在获取完整目录…" })]
						}),
						tab === "full" && fullToc.kind === "error" && u$1("div", {
							class: "nr-status",
							children: [
								u$1("div", {
									class: "nr-status-title",
									children: fullToc.verifyUrl ? "需要人机验证" : "目录获取失败"
								}),
								u$1("div", {
									class: "nr-status-msg",
									children: fullToc.message
								}),
								u$1("div", {
									style: "display:flex;gap:8px",
									children: [fullToc.verifyUrl && u$1("button", {
										class: "nr-btn is-primary",
										onClick: () => openVerify(fullToc.verifyUrl, reloadToc),
										children: "打开验证页面"
									}), u$1("button", {
										class: `nr-btn${fullToc.verifyUrl ? "" : " is-primary"}`,
										onClick: reloadToc,
										children: [u$1(IconRefresh, {
											width: 16,
											height: 16
										}), fullToc.verifyUrl ? "已完成，重试" : "点击重试"]
									})]
								})
							]
						}),
						tab === "session" && !session.length && u$1("div", {
							class: "nr-empty",
							children: "还没有阅读记录"
						}),
						!!items.length && !displayRows.length && u$1("div", {
							class: "nr-empty",
							children: "没有匹配的章节"
						}),
						!!displayRows.length && u$1("ul", {
							class: "nr-toc-list",
							ref: listRef,
							style: virtual ? {
								paddingTop: `${padTop}px`,
								paddingBottom: `${padBottom + 16}px`
							} : void 0,
							children: visibleRows.map(({ it, title, read }) => {
								return u$1("li", { children: u$1("button", {
									class: `nr-toc-item${it.url === current ? " is-current" : tab === "full" && read ? " is-read" : ""}`,
									onClick: () => onJump(it.url),
									title,
									children: [u$1("span", {
										class: "nr-toc-title",
										children: title
									}), tab === "full" && read && u$1("span", {
										class: "nr-toc-badge",
										children: "已读"
									})]
								}) }, it.url);
							})
						})
					]
				})
			]
		});
	}
	function useReaderKeys(scrollRef, handlers) {
		const latest = A(handlers);
		latest.current = handlers;
		h(() => {
			const onKey = (e) => {
				e.stopImmediatePropagation();
				if (e.type !== "keydown") return;
				const h = latest.current;
				const origin = e.composedPath()[0];
				const typing = !!origin && /^(INPUT|TEXTAREA|SELECT)$/.test(origin.tagName);
				if (e.key === "Escape") {
					e.preventDefault();
					if (typing) origin.blur();
					else if (h.hasSelection) h.onClearSelection?.();
					else h.onEscape();
					return;
				}
				if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
				const el = scrollRef.current;
				if (!el) return;
				const page = el.clientHeight * .9;
				const scroll = (top) => {
					e.preventDefault();
					el.scrollBy({
						top,
						behavior: "smooth"
					});
				};
				switch (e.key) {
					case " ": return scroll(e.shiftKey ? -page : page);
					case "PageDown": return scroll(page);
					case "PageUp": return scroll(-page);
					case "ArrowDown": return scroll(80);
					case "ArrowUp": return scroll(-80);
					case "Home":
						e.preventDefault();
						return el.scrollTo({
							top: 0,
							behavior: "smooth"
						});
					case "End":
						e.preventDefault();
						return el.scrollTo({
							top: el.scrollHeight,
							behavior: "smooth"
						});
					case "ArrowRight":
						if (h.chapterMode) {
							e.preventDefault();
							h.onNext();
						}
						return;
					case "ArrowLeft":
						if (h.chapterMode) {
							e.preventDefault();
							h.onPrev();
						}
						return;
					case "]":
						e.preventDefault();
						return h.onNext();
					case "[":
						e.preventDefault();
						return h.onPrev();
					case "t":
					case "T":
						e.preventDefault();
						return h.onTogglePanel("toc");
					case "s":
					case "S":
						e.preventDefault();
						return h.onTogglePanel("source");
					case "b":
					case "B":
						e.preventDefault();
						return h.onTogglePanel("shelf");
					case "f":
					case "F":
					case "/":
						e.preventDefault();
						return h.onTogglePanel("search");
					case "e":
					case "E":
						e.preventDefault();
						return h.onTogglePanel("excerpts");
					case "d":
					case "D":
						e.preventDefault();
						return h.onToggleDark?.();
					case "-":
					case "_":
						e.preventDefault();
						return h.onFontSize?.(-2);
					case "=":
					case "+":
						e.preventDefault();
						return h.onFontSize?.(2);
				}
			};
			const types = [
				"keydown",
				"keyup",
				"keypress"
			];
			types.forEach((t) => window.addEventListener(t, onKey, true));
			scrollRef.current?.focus();
			return () => types.forEach((t) => window.removeEventListener(t, onKey, true));
		}, [scrollRef]);
	}
	function readSelection(root) {
		const composed = document.getSelection()?.getComposedRanges?.({ shadowRoots: [root] })[0];
		if (composed) {
			if (composed.collapsed) return void 0;
			const range = document.createRange();
			range.setStart(composed.startContainer, composed.startOffset);
			range.setEnd(composed.endContainer, composed.endOffset);
			return {
				text: range.toString(),
				range
			};
		}
		const legacy = root.getSelection?.();
		if (!legacy || legacy.isCollapsed || !legacy.rangeCount) return void 0;
		return {
			text: legacy.toString(),
			range: legacy.getRangeAt(0)
		};
	}
	function useSelection(scrollRef) {
		const [selection, setSelection] = d();
		h(() => {
			let timer = 0;
			let dragging = false;
			const update = () => {
				window.clearTimeout(timer);
				if (dragging) return;
				timer = window.setTimeout(() => {
					const el = scrollRef.current;
					const root = el?.getRootNode();
					if (!el || !(root instanceof ShadowRoot)) return;
					const picked = readSelection(root);
					const text = picked?.text.trim();
					const start = picked?.range.startContainer;
					const chapterEl = (start instanceof Element ? start : start?.parentElement)?.closest(".nr-chapter");
					if (!picked || !text || !chapterEl || !el.contains(chapterEl)) return setSelection(void 0);
					const rect = picked.range.getBoundingClientRect();
					const x = Math.max(76, Math.min(window.innerWidth - 76, rect.left + rect.width / 2));
					const below = rect.top < 56;
					const y = below ? rect.bottom : rect.top;
					setSelection({
						text,
						chapterUrl: chapterEl.dataset.url,
						x,
						y,
						below
					});
				}, 150);
			};
			const onDown = (e) => {
				if (e.button !== 0 || !scrollRef.current || !e.composedPath().includes(scrollRef.current)) return;
				dragging = true;
				setSelection(void 0);
			};
			const onUp = () => {
				if (!dragging) return;
				dragging = false;
				update();
			};
			const onScroll = () => setSelection((prev) => prev ? void 0 : prev);
			const scrollEl = scrollRef.current;
			document.addEventListener("selectionchange", update);
			window.addEventListener("pointerdown", onDown, true);
			window.addEventListener("pointerup", onUp, true);
			scrollEl?.addEventListener("scroll", onScroll, { passive: true });
			return () => {
				window.clearTimeout(timer);
				document.removeEventListener("selectionchange", update);
				window.removeEventListener("pointerdown", onDown, true);
				window.removeEventListener("pointerup", onUp, true);
				scrollEl?.removeEventListener("scroll", onScroll);
			};
		}, [scrollRef]);
		return [selection, q(() => {
			document.getSelection()?.removeAllRanges();
			setSelection(void 0);
		}, [])];
	}
	var CURRENT_LINE = 80;
	var PRELOAD_SCREENS = 1.5;
	var READ_END_SLACK = 40;
	var KEEP_BEHIND = 2;
	function renderParagraphs(paragraphs, convert, filters, strip, replace, mergeParagraphs) {
		const words = [...new Set(strip.flatMap((w) => [w, convert(w)]))];
		const out = [];
		for (const raw of paragraphs) {
			let folded;
			const getFolded = () => folded ??= foldFancyLetters(raw);
			if (filters.some((f) => f.test(raw) || f.test(getFolded()))) continue;
			let text = convert(raw);
			if (filters.some((f) => f.test(text))) continue;
			for (const r of replace) text = text.replace(r.re, r.to);
			if (words.length) text = cleanText(words.reduce((s, w) => s.split(w).join(""), text));
			if (text) out.push(text);
		}
		return mergeParagraphs ? mergeBrokenParagraphs(out) : out;
	}
	var ChapterView = class extends C$1 {
		shouldComponentUpdate(next) {
			const p = this.props;
			return p.chapter !== next.chapter || p.convert !== next.convert || p.filters !== next.filters || p.strip !== next.strip || p.replace !== next.replace || p.mergeParagraphs !== next.mergeParagraphs;
		}
		render({ chapter, convert, filters, strip, replace, mergeParagraphs }) {
			const paragraphs = renderParagraphs(chapter.paragraphs, convert, filters, strip, replace, mergeParagraphs);
			return u$1("article", {
				class: "nr-chapter",
				"data-url": chapter.url,
				children: [u$1("h1", { children: convert(chapter.title) }), paragraphs.map((p, i) => u$1("p", { children: p }, i))]
			});
		}
	};
	function StatusView({ status, full, onReadapt }) {
		const cls = `nr-status${full ? " is-full" : ""}`;
		if (status.kind === "loading") return u$1("div", {
			class: cls,
			children: [u$1("div", { class: "nr-spinner" }), u$1("span", { children: full ? "正在加载…" : "正在加载下一章…" })]
		});
		if (status.kind === "error" && status.verifyUrl) {
			const { verifyUrl, retry } = status;
			return u$1("div", {
				class: cls,
				children: [
					u$1("div", {
						class: "nr-status-title",
						children: "需要人机验证"
					}),
					u$1("div", {
						class: "nr-status-msg",
						children: "站点开启了 Cloudflare 验证，后台加载被拦截。请在新标签页完成验证，切回这里会自动重试。"
					}),
					u$1("div", {
						style: "display:flex;gap:8px",
						children: [u$1("button", {
							class: "nr-btn is-primary",
							onClick: () => openVerify(verifyUrl, retry),
							children: "打开验证页面"
						}), u$1("button", {
							class: "nr-btn",
							onClick: retry,
							children: [u$1(IconRefresh, {
								width: 16,
								height: 16
							}), "已完成，重试"]
						})]
					})
				]
			});
		}
		if (status.kind === "error") return u$1("div", {
			class: cls,
			children: [
				u$1("div", {
					class: "nr-status-title",
					children: "加载失败"
				}),
				u$1("div", {
					class: "nr-status-msg",
					children: status.message
				}),
				u$1("div", {
					style: "display:flex;gap:8px",
					children: [u$1("button", {
						class: "nr-btn is-primary",
						onClick: status.retry,
						children: [u$1(IconRefresh, {
							width: 16,
							height: 16
						}), "点击重试"]
					}), onReadapt && u$1("button", {
						class: "nr-btn",
						onClick: onReadapt,
						children: "重新适配本站"
					})]
				})
			]
		});
		if (status.kind === "end") return u$1("div", {
			class: cls,
			children: [u$1("div", {
				class: "nr-status-title",
				children: "已是最新章节"
			}), u$1("span", { children: "没有找到下一章链接" })]
		});
		return null;
	}
	var formatClock = () => {
		const d = new Date();
		return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	};
	function Reader({ site, startUrl, firstDoc, guessedBookName, arrival, onExit, onReadapt }) {
		const [activeSite, setActiveSite] = d(site);
		const bookKey = T(() => bookKeyOf(startUrl), [startUrl]);
		const [cachedInfo] = d(() => loadBookInfo(bookKey));
		const [bookInfo, setBookInfo] = d(cachedInfo ?? { name: guessedBookName });
		const [infoReady, setInfoReady] = d(!!cachedInfo);
		const [shelf, setShelf] = d(loadShelf);
		const bookName = bookInfo.name;
		const [settings, setSettings] = d(loadSettings);
		const lastLightTheme = A(settings.theme === "dark" ? "parchment" : settings.theme);
		if (settings.theme !== "dark") lastLightTheme.current = settings.theme;
		const [convert, setConvert] = d();
		const [stream, setStream] = d([]);
		const [status, setStatus] = d({ kind: "loading" });
		const [current, setCurrent] = d(startUrl);
		const [session, setSession] = d([]);
		const [read, setRead] = d(() => loadReadChapters(bookKey));
		const readSet = T(() => new Set(read), [read]);
		const [scripts, setScripts] = d();
		const [hant, setHant] = d();
		const matchKey = T(() => scripts && infoReady ? bookMatchKey(bookInfo.name, bookInfo.author, scripts.hans) : void 0, [
			scripts,
			infoReady,
			bookInfo
		]);
		const [readTitles, setReadTitles] = d([]);
		const [fullToc, setFullToc] = d({ kind: "idle" });
		const [panel, setPanel] = d("none");
		const [toast, setToast] = d();
		const [clock, setClock] = d(formatClock);
		const [strip, setStrip] = d(site.strip ?? []);
		const [siteFilters, setSiteFilters] = d(site.filters ?? []);
		const [siteReplace, setSiteReplace] = d(site.replace ?? []);
		const compiledFilters = T(() => siteFilters.flatMap((f) => {
			try {
				return [new RegExp(f, "i")];
			} catch {
				return [];
			}
		}), [siteFilters]);
		const compiledReplace = T(() => siteReplace.flatMap((r) => {
			try {
				return [{
					re: new RegExp(r.from, "g"),
					to: r.to
				}];
			} catch {
				return [];
			}
		}), [siteReplace]);
		const loader = T(() => createLoader(activeSite), [activeSite]);
		const scrollRef = A(null);
		const progressRef = A(null);
		const [selection, clearSelection] = useSelection(scrollRef);
		const token = A(0);
		const mounted = A(true);
		const toastTimer = A(0);
		const frame = A(0);
		const posTimer = A(0);
		const pendingPos = A();
		const live = A({
			stream,
			status,
			settings,
			current,
			readSet,
			matchKey,
			scripts
		});
		live.current = {
			stream,
			status,
			settings,
			current,
			readSet,
			matchKey,
			scripts
		};
		h(() => {
			mounted.current = true;
			return () => {
				mounted.current = false;
				window.clearTimeout(toastTimer.current);
				window.cancelAnimationFrame(frame.current);
				window.clearTimeout(posTimer.current);
				if (pendingPos.current) saveReadingPosition(bookKey, pendingPos.current);
			};
		}, [bookKey]);
		const showToast = q((msg) => {
			window.clearTimeout(toastTimer.current);
			setToast(msg);
			toastTimer.current = window.setTimeout(() => {
				if (mounted.current) setToast(void 0);
			}, 4e3);
		}, []);
		h(() => {
			if (typeof _GM_addValueChangeListener !== "function") return;
			const ids = [
				_GM_addValueChangeListener(SETTINGS_KEY, (_k, _old, val, remote) => {
					if (remote && val) setSettings({
						...DEFAULT_SETTINGS,
						...val
					});
				}),
				_GM_addValueChangeListener(SHELF_KEY, (_k, _old, val, remote) => {
					if (remote && Array.isArray(val)) setShelf(val);
				}),
				_GM_addValueChangeListener(SITES_KEY, (_k, _old, _val, remote) => {
					if (!remote) return;
					const entry = loadSites().find((s) => s.id === activeSite.id);
					if (entry) {
						setActiveSite(entry);
						setStrip(entry.strip ?? []);
						setSiteFilters(entry.filters ?? []);
						setSiteReplace(entry.replace ?? []);
					}
				})
			];
			return () => {
				if (typeof _GM_removeValueChangeListener === "function") ids.forEach((id) => _GM_removeValueChangeListener(id));
			};
		}, [activeSite.id]);
		h(() => {
			if (settings.statusBar === false) return;
			setClock(formatClock());
			const id = window.setInterval(() => setClock(formatClock()), 3e4);
			return () => window.clearInterval(id);
		}, [settings.statusBar]);
		h(() => {
			let alive = true;
			getConverter(settings.script).then((fn) => alive && setConvert({ fn }), (e) => {
				if (!alive) return;
				showToast(`简繁转换不可用，已显示原文：${e.message}`);
				setConvert({ fn: (s) => s });
			});
			return () => {
				alive = false;
			};
		}, [settings.script, showToast]);
		h(() => {
			let alive = true;
			getConverter("hans").then((hans) => alive && setScripts({ hans }), (e) => {
				if (!alive) return;
				console.warn(`[小说阅读模式] 简繁转换不可用，换源按原文比较：${e.message}`);
				setScripts({ hans: (s) => s });
			});
			return () => {
				alive = false;
			};
		}, []);
		h(() => {
			if (panel !== "source" || hant) return;
			let alive = true;
			getConverter("hant").then((fn) => alive && setHant({ fn }), (e) => {
				if (!alive) return;
				console.warn(`[小说阅读模式] 繁体字典不可用，换源只用原书名和简体书名搜索：${e.message}`);
				setHant({ fn: (s) => s });
			});
			return () => {
				alive = false;
			};
		}, [panel, hant]);
		h(() => {
			if (matchKey) setReadTitles(loadReadTitles(matchKey));
		}, [matchKey]);
		const updateSettings = q((patch) => {
			setSettings(patchSettings(patch));
		}, []);
		const showChapter = q((url, doc) => {
			const t = ++token.current;
			setStream([]);
			setStatus({ kind: "loading" });
			scrollRef.current?.scrollTo({ top: 0 });
			loader.load(url, doc).then((ch) => {
				if (!mounted.current || t !== token.current) return;
				setStream([ch]);
				setCurrent(ch.url);
				setStatus(ch.nextUrl ? { kind: "idle" } : { kind: "end" });
			}, (e) => {
				if (!mounted.current || t !== token.current) return;
				setStatus({
					kind: "error",
					message: e.message,
					retry: () => showChapter(url),
					verifyUrl: e instanceof ChallengeError ? e.verifyUrl : void 0
				});
			});
		}, [loader]);
		const loadMore = q((force = false) => {
			const { stream: s, status: st } = live.current;
			const last = s[s.length - 1];
			if (!last || !force && st.kind !== "idle") return;
			if (!last.nextUrl) {
				setStatus({ kind: "end" });
				return;
			}
			const t = token.current;
			setStatus({ kind: "loading" });
			loader.load(last.nextUrl).then((ch) => {
				if (!mounted.current || t !== token.current) return;
				if (live.current.stream.some((c) => c.url === ch.url)) {
					setStatus({ kind: "end" });
					return;
				}
				setStream((prev) => prev.some((c) => c.url === ch.url) ? prev : [...prev, ch]);
				setStatus(ch.nextUrl ? { kind: "idle" } : { kind: "end" });
			}, (e) => {
				if (!mounted.current || t !== token.current) return;
				setStatus({
					kind: "error",
					message: e.message,
					retry: () => loadMore(true),
					verifyUrl: e instanceof ChallengeError ? e.verifyUrl : void 0
				});
			});
		}, [loader]);
		h(() => {
			showChapter(startUrl, firstDoc);
		}, []);
		const restoredPos = A(false);
		h(() => {
			if (restoredPos.current || !convert || !stream.length) return;
			restoredPos.current = true;
			const savedPos = loadReadingPosition(bookKey);
			if (savedPos && savedPos.url === startUrl && savedPos.ratio > .02) requestAnimationFrame(() => {
				const el = scrollRef.current;
				if (!el) return;
				const maxScroll = el.scrollHeight - el.clientHeight;
				if (maxScroll > 0) el.scrollTop = Math.min(maxScroll, maxScroll * savedPos.ratio);
			});
		}, [
			convert,
			stream.length,
			bookKey,
			startUrl
		]);
		const shown = stream[stream.length - 1];
		h(() => {
			if (settings.pageMode === "chapter" && shown?.nextUrl) loader.load(shown.nextUrl).catch(() => void 0);
		}, [
			settings.pageMode,
			shown,
			loader
		]);
		const head = stream[0];
		const tocUrl = head?.tocUrl;
		const loadToc = q(() => {
			setFullToc({ kind: "loading" });
			loadFullToc(activeSite, live.current.current, tocUrl).then((items) => mounted.current && setFullToc({
				kind: "ready",
				items
			}), (e) => mounted.current && setFullToc({
				kind: "error",
				message: e.message,
				verifyUrl: e instanceof ChallengeError ? e.verifyUrl : void 0
			}));
		}, [activeSite, tocUrl]);
		h(() => {
			if (head && fullToc.kind === "idle") loadToc();
		}, [
			head,
			fullToc.kind,
			loadToc
		]);
		h(() => {
			if (!matchKey || !scripts || fullToc.kind !== "ready") return;
			const keys = tocTitleKeys(fullToc.items, scripts.hans);
			setReadTitles(addReadTitles(matchKey, fullToc.items.flatMap((it, i) => readSet.has(it.url) ? [keys[i]] : [])));
		}, [
			matchKey,
			scripts,
			fullToc
		]);
		const infoTried = A();
		const infoLoaded = A(!!cachedInfo);
		h(() => {
			if (!head || infoLoaded.current) return;
			const candidates = [head.bookUrl, head.tocUrl].filter((u) => !!u);
			const tried = candidates.join("\n");
			if (infoTried.current === tried) return;
			infoTried.current = tried;
			fetchBookInfo(candidates, activeSite).then((info) => {
				if (!mounted.current) return;
				infoLoaded.current = true;
				saveBookInfo(bookKey, info);
				setBookInfo(info);
				setInfoReady(true);
			}, (e) => {
				if (!mounted.current) return;
				console.warn(`[小说阅读模式] 获取书名失败，使用「${guessedBookName}」：${e.message}`);
				setInfoReady(true);
			});
		}, [head?.url]);
		const enterPageMode = (mode) => {
			if (mode !== "chapter") return;
			const ch = live.current.stream.find((c) => c.url === live.current.current);
			if (ch) {
				token.current++;
				setStream([ch]);
				setStatus(ch.nextUrl ? { kind: "idle" } : { kind: "end" });
				scrollRef.current?.scrollTo({ top: 0 });
			}
		};
		const setPageMode = q((mode) => {
			enterPageMode(mode);
			updateSettings({ pageMode: mode });
		}, [updateSettings]);
		const reloadStored = () => {
			const saved = loadSettings();
			enterPageMode(saved.pageMode);
			setSettings(saved);
			setShelf(loadShelf());
			setRead(loadReadChapters(bookKey));
			if (matchKey) setReadTitles(loadReadTitles(matchKey));
			const info = loadBookInfo(bookKey);
			if (info) {
				setBookInfo(info);
				setInfoReady(true);
			}
			const entry = loadSites().find((s) => s.id === activeSite.id);
			if (entry) {
				setActiveSite(entry);
				setStrip(entry.strip ?? []);
				setSiteFilters(entry.filters ?? []);
				setSiteReplace(entry.replace ?? []);
			}
		};
		const anchor = A();
		const onScroll = q(() => {
			if (frame.current) return;
			frame.current = requestAnimationFrame(() => {
				frame.current = 0;
				const el = scrollRef.current;
				if (!el) return;
				const scrollTop = el.scrollTop;
				const clientHeight = el.clientHeight;
				const scrollHeight = el.scrollHeight;
				const metrics = [...el.querySelectorAll(".nr-chapter")].map((n) => ({
					node: n,
					url: n.dataset.url,
					top: n.offsetTop,
					height: n.offsetHeight
				}));
				const line = scrollTop + CURRENT_LINE;
				const currentMetric = metrics.filter((m) => m.top <= line).pop() ?? metrics[0];
				const currentIdx = currentMetric ? metrics.indexOf(currentMetric) : -1;
				let trimFromUrl;
				let anchorTop;
				if (currentMetric && live.current.settings.pageMode === "scroll" && currentIdx > 3) {
					const candidateUrl = metrics[currentIdx - KEEP_BEHIND].url;
					if (live.current.stream.findIndex((c) => c.url === candidateUrl) > 0) {
						trimFromUrl = candidateUrl;
						anchorTop = currentMetric.node.getBoundingClientRect().top;
					}
				}
				const viewBottom = scrollTop + clientHeight + READ_END_SLACK;
				const finished = metrics.filter((m) => m.top + m.height <= viewBottom).map((m) => m.url).filter((u) => !live.current.readSet.has(u));
				const remain = scrollHeight - scrollTop - clientHeight;
				if (currentMetric) {
					if (currentMetric.url !== live.current.current) setCurrent(currentMetric.url);
					const p = currentMetric.height ? (scrollTop + clientHeight - currentMetric.top) / currentMetric.height : 0;
					const progress = Math.max(0, Math.min(1, p));
					if (progressRef.current) progressRef.current.style.transform = `scaleX(${progress})`;
					const scrollable = currentMetric.height - clientHeight;
					const ratio = scrollable > 0 ? Math.max(0, Math.min(1, (scrollTop - currentMetric.top) / scrollable)) : 0;
					pendingPos.current = {
						url: currentMetric.url,
						ratio
					};
					if (!posTimer.current) posTimer.current = window.setTimeout(() => {
						posTimer.current = 0;
						if (pendingPos.current) saveReadingPosition(bookKey, pendingPos.current);
					}, 600);
				}
				if (trimFromUrl && anchorTop !== void 0 && currentMetric) {
					anchor.current = {
						url: currentMetric.url,
						top: anchorTop
					};
					setStream((prev) => {
						const fromIdx = prev.findIndex((c) => c.url === trimFromUrl);
						return fromIdx > 0 ? prev.slice(fromIdx) : prev;
					});
				}
				if (finished.length) {
					setRead(markChaptersRead(bookKey, finished));
					const { matchKey: key, scripts: sc, stream: chapters } = live.current;
					if (key && sc) {
						const titles = finished.flatMap((u) => chapters.find((c) => c.url === u)?.title ?? []);
						setReadTitles(addReadTitles(key, titles.map((t) => titleKey(t, sc.hans))));
					}
				}
				if (live.current.settings.pageMode === "scroll" && remain < clientHeight * PRELOAD_SCREENS) loadMore();
			});
		}, [loadMore, bookKey]);
		_(() => {
			const a = anchor.current;
			const el = scrollRef.current;
			if (!a || !el) return;
			anchor.current = void 0;
			const node = [...el.querySelectorAll(".nr-chapter")].find((n) => n.dataset.url === a.url);
			if (node) el.scrollTop += node.getBoundingClientRect().top - a.top;
		}, [stream]);
		h(onScroll, [
			stream,
			status,
			settings,
			onScroll
		]);
		const currentChapter = stream.find((c) => c.url === current);
		h(() => {
			if (!currentChapter) return;
			const { url, title } = currentChapter;
			if (new URL(url).origin === location.origin && location.href !== url) history.replaceState(history.state, "", url);
			document.title = convert ? convert.fn(title) : title;
			setSession((s) => s.some((i) => i.url === url) ? s : [...s, {
				url,
				title
			}]);
			const updated = updateShelfProgress(bookKey, url, title);
			if (updated) setShelf(updated);
		}, [currentChapter, convert]);
		const addExcerpt = () => {
			if (!selection) return;
			const text = cleanText(selection.text);
			const list = loadExcerpts();
			if (list.some((e) => e.bookKey === bookKey && e.text === text)) showToast("已在摘录中");
			else {
				const chapter = live.current.stream.find((c) => c.url === selection.chapterUrl);
				const fn = convert?.fn ?? ((s) => s);
				saveExcerpts([...list, {
					id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
					text,
					book: fn(bookName),
					bookKey,
					chapter: chapter ? fn(chapter.title) : "",
					url: selection.chapterUrl,
					time: Date.now()
				}]);
				showToast(`已摘录：${text.length > 24 ? `${text.slice(0, 24)}…` : text}`);
			}
			clearSelection();
		};
		const addStrip = () => {
			if (!selection) return;
			const text = selection.text.trim();
			if (/\n/.test(text)) {
				showToast("过滤文字只能在同一段内划选");
				return;
			}
			try {
				const updated = updateSiteStrip(activeSite.id, (list) => list.includes(text) ? list : [...list, text]);
				setActiveSite(updated);
				setStrip(updated.strip ?? []);
				showToast(`已加入本站过滤：${text}`);
			} catch (e) {
				showToast(e.message);
			}
			clearSelection();
		};
		const shelfSource = (chapter) => ({
			siteId: activeSite.id,
			host: new URL(chapter.url).hostname.replace(/^www\./, ""),
			bookKey,
			bookUrl: bookInfo.bookUrl,
			lastUrl: chapter.url,
			lastTitle: chapter.title,
			updated: Date.now()
		});
		const addCurrentToShelf = () => {
			const chapter = currentChapter ?? head;
			if (!chapter) return;
			if (!matchKey) {
				showToast("正在获取书名和作者，请稍候再加入");
				return;
			}
			setShelf(addToShelf({
				name: bookInfo.name,
				author: bookInfo.author,
				matchKey
			}, shelfSource(chapter)));
			showToast(`已加入书架：${bookInfo.name}`);
		};
		const arrived = A(false);
		h(() => {
			if (arrival?.toast) showToast(arrival.toast);
		}, []);
		h(() => {
			if (arrived.current || !arrival?.shelfBookId || !head || !infoReady) return;
			arrived.current = true;
			const updated = addShelfSource(arrival.shelfBookId, shelfSource(head));
			if (updated) setShelf(updated);
		}, [head, infoReady]);
		const switchSource = (row, match) => {
			if (match.kind === "none") {
				location.href = row.bookUrl;
				return;
			}
			const book = shelf.find((b) => b.sources.some((s) => s.bookKey === bookKey));
			requestAutoOpen(match.url, {
				toast: match.kind === "index" ? "没有找到标题相同的章节，已按目录序号对应，可能有偏差" : void 0,
				shelfBookId: book?.id
			});
			location.href = match.url;
		};
		const openShelfSource = (source) => {
			if (source.bookKey === bookKey) {
				jumpTo(source.lastUrl);
				return;
			}
			requestAutoOpen(source.lastUrl);
			location.href = source.lastUrl;
		};
		const jumpTo = q((url) => {
			setPanel("none");
			if (url === live.current.current && live.current.settings.pageMode === "chapter") return;
			showChapter(url);
		}, [showChapter]);
		const exit = q(() => {
			if (pendingPos.current) saveReadingPosition(bookKey, pendingPos.current);
			onExit(live.current.current);
		}, [bookKey, onExit]);
		const goNext = q(() => {
			const ch = live.current.stream.find((c) => c.url === live.current.current) ?? live.current.stream.at(-1);
			if (ch?.nextUrl) showChapter(ch.nextUrl);
			else showToast("已是最新章节");
		}, [showChapter, showToast]);
		const goPrev = q(() => {
			const ch = live.current.stream.find((c) => c.url === live.current.current) ?? live.current.stream[0];
			if (ch?.prevUrl) showChapter(ch.prevUrl);
			else showToast("没有上一章了");
		}, [showChapter, showToast]);
		const isChapterMode = settings.pageMode === "chapter";
		useReaderKeys(scrollRef, {
			chapterMode: isChapterMode,
			hasSelection: !!selection && panel === "none",
			onClearSelection: clearSelection,
			onEscape: () => panel !== "none" ? setPanel("none") : exit(),
			onNext: goNext,
			onPrev: goPrev,
			onTogglePanel: (p) => setPanel((cur) => cur === p ? "none" : p),
			onToggleDark: () => updateSettings({ theme: live.current.settings.theme === "dark" ? lastLightTheme.current : "dark" }),
			onFontSize: (delta) => updateSettings({ fontSize: Math.max(FONT_SIZE.min, Math.min(FONT_SIZE.max, live.current.settings.fontSize + delta)) })
		});
		const fn = convert?.fn;
		const sourceChapter = currentChapter ?? head;
		const currentForSource = sourceChapter && {
			title: sourceChapter.title,
			index: fullToc.kind === "ready" ? fullToc.items.findIndex((i) => i.url === sourceChapter.url) : -1
		};
		const readTitleSet = T(() => new Set(readTitles), [readTitles]);
		const tocKeyByUrl = T(() => {
			if (!scripts || fullToc.kind !== "ready") return void 0;
			const keys = tocTitleKeys(fullToc.items, scripts.hans);
			return new Map(fullToc.items.map((it, i) => [it.url, keys[i]]));
		}, [scripts, fullToc]);
		const isRead = q((item) => {
			if (readSet.has(item.url)) return true;
			if (!scripts) return false;
			return readTitleSet.has(tocKeyByUrl?.get(item.url) ?? titleKey(item.title, scripts.hans));
		}, [
			readSet,
			readTitleSet,
			tocKeyByUrl,
			scripts
		]);
		const togglePanel = (p) => setPanel(panel === p ? "none" : p);
		const tocIndex = T(() => {
			if (fullToc.kind !== "ready" || !currentChapter) return -1;
			return fullToc.items.findIndex((i) => i.url === currentChapter.url);
		}, [fullToc, currentChapter]);
		return u$1("div", {
			class: "nr-ui nr-reader",
			"data-theme": settings.theme,
			style: readerVars(settings),
			children: [
				u$1("div", {
					class: "nr-progress",
					ref: progressRef,
					style: "transform:scaleX(0)"
				}),
				u$1("div", {
					class: "nr-scroll",
					ref: scrollRef,
					tabIndex: -1,
					onScroll,
					children: u$1("div", {
						class: "nr-paper",
						children: !fn || !stream.length ? u$1(StatusView, {
							status: fn ? status : { kind: "loading" },
							full: true,
							onReadapt
						}) : u$1(S, { children: [stream.map((ch) => u$1(ChapterView, {
							chapter: ch,
							convert: fn,
							filters: compiledFilters,
							strip,
							replace: compiledReplace,
							mergeParagraphs: settings.mergeParagraphs !== false
						}, ch.url)), isChapterMode ? u$1("div", {
							class: "nr-pager",
							children: [
								u$1("button", {
									class: "nr-btn",
									disabled: !head?.prevUrl,
									onClick: goPrev,
									children: [u$1(IconChevronLeft, {
										width: 18,
										height: 18
									}), "上一章"]
								}),
								u$1("button", {
									class: "nr-btn",
									onClick: () => setPanel("toc"),
									children: [u$1(IconList, {
										width: 18,
										height: 18
									}), "目录"]
								}),
								u$1("button", {
									class: "nr-btn is-primary",
									disabled: !head?.nextUrl,
									onClick: goNext,
									children: [head?.nextUrl ? "下一章" : "已是最新章节", u$1(IconChevronRight, {
										width: 18,
										height: 18
									})]
								})
							]
						}) : u$1(StatusView, { status })] })
					})
				}),
				settings.statusBar !== false && currentChapter && u$1("div", {
					class: "nr-statusbar",
					children: [
						u$1("span", {
							class: "nr-statusbar-title",
							children: fn ? fn(currentChapter.title) : currentChapter.title
						}),
						fullToc.kind === "ready" && tocIndex >= 0 && u$1("span", { children: [
							tocIndex + 1,
							" / ",
							fullToc.items.length,
							" (",
							Math.round((tocIndex + 1) / fullToc.items.length * 100),
							"%)"
						] }),
						u$1("span", { children: clock })
					]
				}),
				selection && panel === "none" && u$1("div", {
					class: `nr-selpop${selection.below ? " is-below" : ""}`,
					style: {
						left: `${selection.x}px`,
						top: `${selection.y}px`
					},
					onMouseDown: (e) => e.preventDefault(),
					children: [
						u$1("button", {
							onClick: addExcerpt,
							children: [u$1(IconBookmark, {
								width: 16,
								height: 16
							}), "摘录"]
						}),
						u$1("span", { class: "nr-selpop-sep" }),
						u$1("button", {
							onClick: addStrip,
							children: [u$1(IconFilter, {
								width: 16,
								height: 16
							}), "过滤"]
						})
					]
				}),
				u$1("nav", {
					class: "nr-toolbar",
					children: [
						u$1("button", {
							class: `nr-tool${panel === "toc" ? " is-active" : ""}`,
							onClick: () => togglePanel("toc"),
							title: "目录 (T)",
							children: [u$1(IconList, {}), "目录"]
						}),
						u$1("button", {
							class: `nr-tool${panel === "shelf" ? " is-active" : ""}`,
							onClick: () => togglePanel("shelf"),
							title: "书架 (B)",
							children: [u$1(IconShelf, {}), "书架"]
						}),
						u$1("button", {
							class: `nr-tool${panel === "source" ? " is-active" : ""}`,
							onClick: () => togglePanel("source"),
							title: "换源 (S)",
							children: [u$1(IconSwap, {}), "换源"]
						}),
						u$1("button", {
							class: `nr-tool${panel === "search" ? " is-active" : ""}`,
							onClick: () => togglePanel("search"),
							title: "搜书 (F)",
							children: [u$1(IconSearch, {}), "搜书"]
						}),
						u$1("button", {
							class: `nr-tool${panel === "excerpts" ? " is-active" : ""}`,
							onClick: () => togglePanel("excerpts"),
							title: "摘录 (E)",
							children: [u$1(IconBookmark, {}), "摘录"]
						}),
						u$1("button", {
							class: `nr-tool${panel === "settings" ? " is-active" : ""}`,
							onClick: () => togglePanel("settings"),
							children: [u$1(IconSliders, {}), "设置"]
						}),
						u$1("button", {
							class: "nr-tool",
							onClick: () => scrollRef.current?.scrollTo({
								top: 0,
								behavior: "smooth"
							}),
							children: [u$1(IconArrowUp, {}), "顶部"]
						}),
						u$1("button", {
							class: "nr-tool",
							onClick: exit,
							title: "退出 (Esc)",
							children: [u$1(IconExit, {}), "退出"]
						})
					]
				}),
				panel !== "none" && u$1("div", {
					class: "nr-backdrop",
					onClick: () => setPanel("none")
				}),
				panel === "toc" && u$1(TocPanel, {
					current,
					session,
					isRead,
					fullToc,
					reloadToc: loadToc,
					convert: fn ?? ((s) => s),
					onJump: jumpTo,
					onClose: () => setPanel("none")
				}),
				panel === "shelf" && u$1(ShelfPanel, {
					shelf,
					bookKey,
					info: bookInfo,
					infoReady,
					convert: fn ?? ((s) => s),
					onAdd: addCurrentToShelf,
					onOpen: openShelfSource,
					onRemove: (id, key) => setShelf(removeShelfSource(id, key)),
					onClose: () => setPanel("none")
				}),
				panel === "source" && u$1(SourcePanel, {
					site: activeSite,
					bookKey,
					name: bookInfo.name,
					author: bookInfo.author,
					infoReady,
					matchKey,
					current: currentForSource,
					currentToc: fullToc.kind === "ready" ? fullToc.items : void 0,
					shelf,
					hans: scripts?.hans,
					hant: hant?.fn,
					convert: fn ?? ((s) => s),
					onSwitch: switchSource,
					onClose: () => setPanel("none")
				}),
				panel === "excerpts" && u$1(ExcerptPanel, {
					bookKey,
					onClose: () => setPanel("none"),
					showToast
				}),
				panel === "search" && u$1(SearchPanel, {
					convert: fn ?? ((s) => s),
					onClose: () => setPanel("none")
				}),
				panel === "settings" && u$1(SettingsPanel, {
					settings,
					update: updateSettings,
					setPageMode,
					site: activeSite,
					onReadapt,
					onSiteChange: (s) => {
						setActiveSite(s);
						setStrip(s.strip ?? []);
						setSiteFilters(s.filters ?? []);
						setSiteReplace(s.replace ?? []);
					},
					onImported: reloadStored,
					onClose: () => setPanel("none"),
					showToast
				}),
				toast && u$1("div", {
					class: "nr-toast",
					children: toast
				})
			]
		});
	}
	var ENTRY_ID = "nr-entry";
	var READER_ID = "nr-reader";
	var PICKER_ID = "nr-picker";
	var HUB_ID = "nr-hub";
	var TEMP_ID = "temp";
	var entry;
	var reader;
	var picker;
	var hub;
	var styleInjected = false;
	function hideEntry() {
		entry?.destroy();
		entry = void 0;
	}
	function hideHub() {
		hub?.destroy();
		hub = void 0;
	}
	function openHub() {
		if (hub) {
			hideHub();
			return;
		}
		hub = mountHost(HUB_ID, u$1(QuickHub, { onClose: hideHub }));
	}
	function showEntry(site, kind) {
		hideEntry();
		entry = mountHost(ENTRY_ID, u$1(Entry, {
			kind,
			onClick: () => kind === "read" ? openReader(site) : startPicker(site),
			onDismiss: hideEntry
		}));
	}
	function openReader(site, arrival) {
		if (reader) return;
		hideEntry();
		hideHub();
		if (!styleInjected) {
			_GM_addStyle(`
      html.nr-active > :not(#${READER_ID}):not(head) { display: none !important; }
      html.nr-active { overflow: hidden !important; }
    `);
			styleInjected = true;
		}
		const originalUrl = location.href;
		const originalTitle = document.title;
		document.documentElement.classList.add("nr-active");
		let viewport;
		if (!document.querySelector("meta[name=\"viewport\"]")) {
			viewport = document.createElement("meta");
			viewport.name = "viewport";
			viewport.content = "width=device-width, initial-scale=1";
			document.head.append(viewport);
		}
		const close = () => {
			reader?.destroy();
			reader = void 0;
			viewport?.remove();
			document.documentElement.classList.remove("nr-active");
		};
		reader = mountHost(READER_ID, u$1(Reader, {
			site,
			startUrl: originalUrl,
			firstDoc: site.freshFirst ? void 0 : document,
			guessedBookName: guessBookName(),
			arrival,
			onExit: (currentUrl) => {
				close();
				if (currentUrl === originalUrl) {
					if (location.href !== originalUrl) history.replaceState(history.state, "", originalUrl);
					document.title = originalTitle;
					boot();
				} else if (location.href === currentUrl) location.reload();
				else location.href = currentUrl;
			},
			onReadapt: () => {
				close();
				history.replaceState(history.state, "", originalUrl);
				document.title = originalTitle;
				startPicker(site);
			}
		}));
	}
	function guessBookName() {
		const norm = (s) => s.replace(/\s+/g, "");
		const h1 = norm(document.querySelector("h1")?.textContent ?? "");
		return document.title.split(/[-_|｜–—]/).map((s) => s.trim()).filter(Boolean).find((seg) => {
			const n = norm(seg);
			return !/第[\d零一二三四五六七八九十百千万]+[章节回卷]/.test(seg) && !(h1 && (h1.includes(n) || n.includes(h1)));
		}) ?? location.hostname;
	}
	function startPicker(site) {
		if (picker) return;
		hideEntry();
		hideHub();
		const stop = () => {
			picker?.destroy();
			picker = void 0;
		};
		picker = mountHost(PICKER_ID, u$1(Picker, {
			site,
			onSave: (updated) => {
				stop();
				upsertSite(updated.id === TEMP_ID ? {
					...updated,
					id: `site-${updated.hosts[0]}`
				} : updated);
				boot();
			},
			onCancel: () => {
				stop();
				boot();
			}
		}));
	}
	function tempSite() {
		const host = normalizeHost(location.hostname);
		return {
			id: TEMP_ID,
			name: host,
			hosts: [host],
			enabled: true
		};
	}
	function boot(site = findSite(loadSites(), location.hostname)) {
		hideEntry();
		if (!site || !site.enabled) return false;
		if (detectPage(document, site, location.href)) {
			const arrival = consumeAutoOpen(location.href);
			if (arrival) openReader(site, arrival);
			else showEntry(site, "read");
			return true;
		}
		if (!site.content && !site.adapter) {
			showEntry(site, "adapt");
			return true;
		}
		return false;
	}
	function registerMenus(site) {
		if (!site) _GM_registerMenuCommand("将本站加入阅读站点", () => {
			try {
				boot(createSite(location.hostname));
			} catch (e) {
				alert(e.message);
			}
		});
		else _GM_registerMenuCommand("适配本站（点选正文）", () => startPicker(findSite(loadSites(), location.hostname) ?? site));
		_GM_registerMenuCommand("强制在此页打开阅读模式", () => openReader(findSite(loadSites(), location.hostname) ?? tempSite()));
		_GM_registerMenuCommand("打开书架 / 搜书", openHub);
	}
	var LATE_BOOT_DEBOUNCE = 400;
	var LATE_BOOT_WINDOW = 1e4;
	function bootLater(site) {
		const idle = () => !reader && !picker;
		if (!idle() || boot(site)) return;
		let timer = 0;
		const observer = new MutationObserver(() => {
			window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				if (!idle() || boot(site)) stop();
			}, LATE_BOOT_DEBOUNCE);
		});
		const stop = () => {
			observer.disconnect();
			window.clearTimeout(timer);
			window.clearTimeout(deadline);
		};
		const deadline = window.setTimeout(stop, LATE_BOOT_WINDOW);
		observer.observe(document.body, {
			childList: true,
			subtree: true
		});
	}
	var initialSite = findSite(loadSites(), location.hostname);
	registerMenus(initialSite);
	if (initialSite?.enabled && !boot(initialSite)) {
		if (document.readyState === "complete") bootLater(initialSite);
		else window.addEventListener("load", () => bootLater(initialSite), { once: true });
	}
})();
