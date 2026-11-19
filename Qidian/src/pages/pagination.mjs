import { COVER_LAYOUT, COVER_LIST, PageType, SELECTORS } from "../config.mjs";
import { BID_PATTERN } from "../core/blocklist.mjs";
import { ListPage } from "./list.mjs";

const PAGE_LOAD_TIMEOUT = 15 * 1000;
const PAGE_LOAD_MARGIN = 320;
const PAGE_SCROLL_RETRY_DELAY = 1500;
const PAGE_SCROLL_RETRY_LIMIT = 2;

// 图文列表复用原站的「下一页」链接，所有卡片直接追加到原来的 ul。
export const CoverPager = {
    view: null,

    readPage: (root, url) => {
        const pager = root.querySelector(SELECTORS.pagination);
        const number = Number(pager?.dataset.page);
        if (!Number.isInteger(number) || number < 1) return null;

        const href = pager.querySelector(SELECTORS.nextPage)?.getAttribute("href");
        if (!href) return { number, next: null };
        const next = new URL(href, url);
        next.hash = "";
        if (next.origin !== location.origin || !PageType.isList(next.pathname) || next.href === url) {
            throw new Error("起点返回了无效的下一页地址");
        }
        return { number, next: next.href };
    },

    mount: () => {
        const list = document.querySelector(COVER_LIST);
        if (CoverPager.view?.list === list) return;
        const previous = CoverPager.view;
        if (previous) {
            previous.observer.disconnect();
            previous.request?.abort();
            previous.scrollRetry?.abort();
            previous.footer.remove();
            CoverPager.view = null;
        }
        if (!list) return;
        let page;
        try {
            page = CoverPager.readPage(document, location.href);
        } catch (err) {
            console.warn("QidianBlocker Pagination Error:", err);
            return;
        }
        if (!page?.next) return;

        const footer = document.createElement("div");
        footer.className = "qd-list-pager";
        const status = document.createElement("span");
        status.setAttribute("role", "status");
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "qd-list-action";
        retry.textContent = "重试";
        retry.hidden = true;
        const openPage = document.createElement("a");
        openPage.className = "qd-list-action";
        openPage.hidden = true;
        footer.append(status, retry, openPage);
        list.closest(COVER_LAYOUT.root).after(footer);

        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting) && retry.hidden) CoverPager.load(view);
        }, { rootMargin: `0px 0px ${PAGE_LOAD_MARGIN}px` });
        const view = { list, footer, status, retry, openPage, observer, page, request: null, scrollRetry: null, retryCount: 0 };
        CoverPager.view = view;
        retry.onclick = () => CoverPager.load(view);
        CoverPager.showProgress(view);
        observer.observe(footer);
    },

    showProgress: (view, message = "") => {
        view.status.textContent = `已加载到第 ${view.page.number} 页${message}`;
    },

    waitForDownScroll: (view) => {
        const controller = new AbortController();
        view.scrollRetry = controller;
        const readyAt = Date.now() + PAGE_SCROLL_RETRY_DELAY;
        let lastY = window.scrollY;
        const retry = () => {
            if (view.request || CoverPager.view !== view || !view.list.isConnected || Date.now() < readyAt) return;
            const { top, bottom } = view.footer.getBoundingClientRect();
            if (bottom < 0 || top > window.innerHeight + PAGE_LOAD_MARGIN) return;
            view.retryCount++;
            CoverPager.load(view);
        };
        const options = { passive: true, signal: controller.signal };
        // 滚轮到底时不会再改变 scrollY，继续向下滚动仍可触发重试。
        window.addEventListener("wheel", (event) => {
            if (event.deltaY > 0 && !event.ctrlKey) retry();
        }, options);
        window.addEventListener("scroll", () => {
            const y = window.scrollY;
            const down = y > lastY;
            lastY = y;
            if (down) retry();
        }, options);
    },

    failureReason: (status, timedOut) => {
        if (timedOut) return "请求超时";
        if (status === 0) return "起点要求跳转";
        if (status === 200) return "未找到下一页的图文书目";
        if (status === 202) return "起点未返回完整页面（HTTP 202）";
        if (status === 429) return "请求过于频繁（HTTP 429）";
        return status ? `HTTP ${status}` : "网络请求失败";
    },

    append: (list, items, baseUrl) => {
        const getBid = (item) => item.querySelector(COVER_LAYOUT.link)?.dataset.bid;
        const seen = new Set();
        const fragment = document.createDocumentFragment();
        items.forEach((item) => {
            const bid = getBid(item);
            const existing = ListPage.byBid.get(bid);
            if (seen.has(bid) || (existing && Array.from(existing).some(({ item }) => list.contains(item)))) return;
            seen.add(bid);
            const card = document.importNode(item, true);
            card.querySelectorAll("script").forEach((script) => script.remove());
            card.querySelectorAll("a[href], img[src]").forEach((el) => {
                const attr = el.tagName === "A" ? "href" : "src";
                el.setAttribute(attr, new URL(el.getAttribute(attr), baseUrl).href);
            });
            fragment.append(card);
        });
        list.append(fragment);
    },

    load: async (view) => {
        if (CoverPager.view !== view || !view.list.isConnected || view.request || !view.page.next) return;
        view.scrollRetry?.abort();
        view.scrollRetry = null;
        const request = new AbortController();
        const timer = setTimeout(() => request.abort(), PAGE_LOAD_TIMEOUT);
        const url = view.page.next;
        view.request = request;
        view.observer.disconnect();
        view.retry.hidden = true;
        view.openPage.hidden = true;
        CoverPager.showProgress(view, " · 正在加载下一页…");
        let httpStatus;
        try {
            const response = await fetch(url, {
                credentials: "same-origin",
                mode: "same-origin",
                redirect: "manual",
                signal: request.signal
            });
            httpStatus = response.status;
            if (httpStatus !== 200) throw new Error(CoverPager.failureReason(httpStatus, false));
            const source = new DOMParser().parseFromString(await response.text(), "text/html");
            if (CoverPager.view !== view || !view.list.isConnected) return;
            const page = CoverPager.readPage(source, url);
            const items = Array.from(source.querySelectorAll(COVER_LAYOUT.item)).filter((item) =>
                BID_PATTERN.test(item.querySelector(COVER_LAYOUT.link)?.dataset.bid ?? ""));
            if (page?.number !== view.page.number + 1 || !items.length) {
                throw new Error("未找到下一页的图文书目");
            }

            CoverPager.append(view.list, items, url);
            view.page = page;
            view.retryCount = 0;
            CoverPager.showProgress(view, page.next ? "" : " · 已到最后一页");
            // 如果下一页的书全被屏蔽，底部仍在视野内，需要重新观察才能继续加载。
            if (page.next) view.observer.observe(view.footer);
        } catch (err) {
            if (CoverPager.view !== view || !view.list.isConnected) return;
            console.warn("QidianBlocker Pagination Error:", err);
            const mayRetry = httpStatus === undefined || httpStatus === 408 || httpStatus >= 500 || request.signal.aborted;
            const waitForScroll = mayRetry && view.retryCount < PAGE_SCROLL_RETRY_LIMIT;
            const reason = CoverPager.failureReason(httpStatus, request.signal.aborted);
            CoverPager.showProgress(view, ` · 下一页加载失败（${reason}）${waitForScroll ? " · 继续向下滚动可重试" : ""}`);
            view.retry.hidden = false;
            view.openPage.href = url;
            view.openPage.textContent = `打开第 ${view.page.number + 1} 页`;
            view.openPage.hidden = false;
            if (waitForScroll) CoverPager.waitForDownScroll(view);
        } finally {
            clearTimeout(timer);
            view.request = null;
        }
    }
};
