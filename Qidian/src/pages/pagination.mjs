import { COVER_LAYOUT, PageType, SELECTORS } from "../config.mjs";
import { BID_PATTERN } from "../core/blocklist.mjs";
import { DEFAULT_PAGER_SETTINGS, normalizePagerSettings } from "../core/settings.mjs";
import { ListPage } from "./list.mjs";

const PAGE_LOAD_TIMEOUT = 15 * 1000;
const PAGE_LOAD_MARGIN = 320;
const PAGE_SCROLL_RETRY_DELAY = 1500;
const PAGE_SCROLL_RETRY_LIMIT = 2;
const RATE_LIMIT_RETRY_LIMIT = 5;
const RATE_LIMIT_STATUSES = new Set([429, 404]);

const resolveUrl = (raw, baseUrl) => {
    try {
        return new URL(raw, baseUrl).href;
    } catch {
        return raw;
    }
};

function clearTimers(view) {
    if (!view) return;
    clearTimeout(view.observeTimer);
    clearTimeout(view.autoTimer);
    clearTimeout(view.rateLimitTimer);
    clearTimeout(view.rateLimitCountdownTimer);
    view.observeTimer = 0;
    view.autoTimer = 0;
    view.rateLimitTimer = 0;
    view.rateLimitCountdownTimer = 0;
}

function syncStopButton(view) {
    if (!view?.stopBtn) return;
    const active = Boolean(view.autoPaging || view.rateLimitTimer);
    view.stopBtn.hidden = !active;
    view.stopBtn.textContent = view.autoPaging ? "停止翻页" : "取消重试";
}

function readRetryAfterSec(response) {
    const raw = response?.headers?.get?.("Retry-After")?.trim();
    if (!raw || !/^\d+$/.test(raw)) return 0;
    return Math.min(600, Number(raw));
}

// 复用原站的「下一页」链接，将后续条目直接追加到列表容器（图文与文字模式通用）。
export const CoverPager = {
    view: null,
    _getSettings: () => DEFAULT_PAGER_SETTINGS,
    _stateListeners: [],

    configure: ({ getSettings } = {}) => {
        if (typeof getSettings === "function") CoverPager._getSettings = getSettings;
    },
    onStateChange: (fn) => CoverPager._stateListeners.push(fn),
    _emitState: () => {
        const state = CoverPager.getState();
        CoverPager._stateListeners.forEach((fn) => fn(state));
    },
    getState: () => ({
        available: Boolean(CoverPager.view?.page?.next),
        autoPaging: Boolean(CoverPager.view?.autoPaging),
        waitingRetry: Boolean(CoverPager.view?.rateLimitTimer)
    }),
    _readSettings: () => normalizePagerSettings(CoverPager._getSettings()),

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

    unmount: () => {
        const previous = CoverPager.view;
        if (!previous) return;
        previous.observer.disconnect();
        clearTimers(previous);
        previous.request?.abort();
        previous.scrollRetry?.abort();
        previous.footer.remove();
        CoverPager.view = null;
        CoverPager._emitState();
    },

    mount: () => {
        let layout = null;
        let list = null;
        for (const candidate of SELECTORS.listLayouts) {
            const el = document.querySelector(candidate.list);
            if (el) {
                layout = candidate;
                list = el;
                break;
            }
        }
        if (CoverPager.view?.list === list) return;
        CoverPager.unmount();
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
        const stopBtn = document.createElement("button");
        stopBtn.type = "button";
        stopBtn.className = "qd-list-action";
        stopBtn.textContent = "停止翻页";
        stopBtn.hidden = true;
        stopBtn.onclick = () => CoverPager.stopAuto(" · 已停止");
        const openPage = document.createElement("a");
        openPage.className = "qd-list-action";
        openPage.hidden = true;
        const topBtn = document.createElement("button");
        topBtn.type = "button";
        topBtn.className = "qd-list-action";
        topBtn.textContent = "回到顶部";
        topBtn.hidden = true;
        topBtn.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
        footer.append(status, retry, stopBtn, openPage, topBtn);
        list.closest(layout.root).after(footer);

        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting) && retry.hidden) CoverPager.load(view);
        }, { rootMargin: `0px 0px ${PAGE_LOAD_MARGIN}px` });
        const view = {
            layout,
            list,
            footer,
            status,
            retry,
            stopBtn,
            openPage,
            topBtn,
            observer,
            page,
            request: null,
            scrollRetry: null,
            observeTimer: 0,
            autoPaging: false,
            autoTarget: 0,
            autoLoaded: 0,
            autoTimer: 0,
            retryCount: 0,
            rateLimitRetryCount: 0,
            rateLimitTimer: 0,
            rateLimitCountdownTimer: 0
        };
        CoverPager.view = view;
        retry.onclick = () => {
            view.rateLimitRetryCount = 0;
            CoverPager.load(view);
        };
        CoverPager.showProgress(view);
        observer.observe(footer);
        const settings = CoverPager._readSettings();
        if (settings.autoStart) CoverPager.startAuto(settings.autoTargetPages);
        else CoverPager._emitState();
    },

    startAuto: (targetPages) => {
        const view = CoverPager.view;
        if (!view || !view.list.isConnected || !view.page.next) return false;
        clearTimers(view);
        const raw = targetPages === undefined ? CoverPager._readSettings().autoTargetPages : Number(targetPages);
        const target = Number.isFinite(raw) ? Math.max(0, Math.min(999, Math.trunc(raw))) : 0;
        view.autoPaging = true;
        view.autoTarget = target;
        view.autoLoaded = 0;
        view.rateLimitRetryCount = 0;
        syncStopButton(view);
        CoverPager._emitState();
        if (!view.request) CoverPager.load(view);
        return true;
    },

    stopAuto: (message = "") => {
        const view = CoverPager.view;
        if (!view) return;
        clearTimers(view);
        view.autoPaging = false;
        syncStopButton(view);
        if (!view.request) {
            if (view.page.next && view.retry.hidden) view.observer.observe(view.footer);
            if (message) CoverPager.showProgress(view, message);
        }
        CoverPager._emitState();
    },

    showProgress: (view, message = "") => {
        view.status.textContent = `已加载到第 ${view.page.number} 页${message}`;
        if (view.topBtn) view.topBtn.hidden = view.page.number <= 1;
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
        // 滚轮到底时不会再改变 scrollY，继续向下滚动仍可触发重试；忽略弹窗内部的滚轮事件。
        window.addEventListener("wheel", (event) => {
            if (event.deltaY > 0 && !event.ctrlKey &&
                !event.target?.closest?.(".qd-modal-dialog, .qd-category-dialog, .qd-modal-overlay")) {
                retry();
            }
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

    append: (list, items, baseUrl, layout = COVER_LAYOUT) => {
        const getBid = (item) => item.querySelector(layout.link)?.dataset.bid;
        const seen = new Set();
        const fragment = document.createDocumentFragment();
        const cards = [];
        items.forEach((item) => {
            const bid = getBid(item);
            const existing = ListPage.byBid.get(bid);
            if (!bid || seen.has(bid) || (existing && Array.from(existing).some(({ item }) => list.contains(item)))) return;
            seen.add(bid);
            const card = document.importNode(item, true);
            card.querySelectorAll("script").forEach((script) => script.remove());
            card.querySelectorAll("img").forEach((img) => { img.loading = "lazy"; });
            card.querySelectorAll("a[href], img[src]").forEach((el) => {
                const attr = el.tagName === "A" ? "href" : "src";
                el.setAttribute(attr, resolveUrl(el.getAttribute(attr), baseUrl));
            });
            fragment.append(card);
            cards.push(card);
        });
        list.append(fragment);
        return cards;
    },

    load: async (view) => {
        if (CoverPager.view !== view || !view.list.isConnected || view.request || !view.page.next) return;
        const layout = view.layout ?? COVER_LAYOUT;
        clearTimers(view);
        view.scrollRetry?.abort();
        view.scrollRetry = null;
        const request = new AbortController();
        const timer = setTimeout(() => request.abort(), PAGE_LOAD_TIMEOUT);
        const url = view.page.next;
        view.request = request;
        view.observer.disconnect();
        view.retry.hidden = true;
        view.openPage.hidden = true;
        syncStopButton(view);
        CoverPager.showProgress(view, " · 正在加载下一页…");
        let httpStatus;
        let retryAfterSec = 0;
        try {
            const response = await fetch(url, {
                credentials: "same-origin",
                mode: "same-origin",
                redirect: "manual",
                signal: request.signal
            });
            httpStatus = response.status;
            if (RATE_LIMIT_STATUSES.has(httpStatus)) retryAfterSec = readRetryAfterSec(response);
            if (httpStatus !== 200) throw new Error(CoverPager.failureReason(httpStatus, false));
            const source = new DOMParser().parseFromString(await response.text(), "text/html");
            if (CoverPager.view !== view || !view.list.isConnected) return;
            const page = CoverPager.readPage(source, url);
            const items = Array.from(source.querySelectorAll(layout.item)).filter((item) =>
                BID_PATTERN.test(item.querySelector(layout.link)?.dataset.bid ?? ""));
            if (page?.number !== view.page.number + 1 || !items.length) {
                const switched = !items.length && SELECTORS.listLayouts.find((other) =>
                    other !== layout && source.querySelector(other.root));
                throw new Error(switched
                    ? `当前已切换为${switched.modeName}，请刷新页面或切回${layout.modeName}`
                    : (layout === COVER_LAYOUT ? "未找到下一页的图文书目" : "未找到下一页的书目"));
            }

            const cards = CoverPager.append(view.list, items, url, layout);
            if (Array.isArray(cards) && cards.length > 0) ListPage.applyNew(cards);
            view.page = page;
            view.retryCount = 0;
            view.rateLimitRetryCount = 0;
            const { delayMs } = CoverPager._readSettings();

            if (view.autoPaging) {
                view.autoLoaded = (view.autoLoaded ?? 0) + 1;
                if (!page.next) {
                    view.autoPaging = false;
                    CoverPager.showProgress(view, " · 已到最后一页");
                } else if (view.autoTarget > 0 && view.autoLoaded >= view.autoTarget) {
                    view.autoPaging = false;
                    CoverPager.showProgress(view, ` · 自动翻页已完成（共翻 ${view.autoLoaded} 页）`);
                    view.observeTimer = setTimeout(() => {
                        view.observeTimer = 0;
                        if (CoverPager.view === view && view.list.isConnected && !view.request && view.page.next && view.retry.hidden) {
                            view.observer.observe(view.footer);
                        }
                    }, delayMs);
                } else {
                    const progress = view.autoTarget > 0 ? `${view.autoLoaded}/${view.autoTarget} 页` : `已翻 ${view.autoLoaded} 页，至结尾`;
                    CoverPager.showProgress(view, ` · 自动翻页中（${progress}）`);
                    view.autoTimer = setTimeout(() => {
                        view.autoTimer = 0;
                        CoverPager.load(view);
                    }, delayMs);
                }
            } else {
                CoverPager.showProgress(view, page.next ? "" : " · 已到最后一页");
                // 按配置的翻页延迟节流后再恢复观察，避免连续快速请求。
                if (page.next) {
                    view.observeTimer = setTimeout(() => {
                        view.observeTimer = 0;
                        if (CoverPager.view === view && view.list.isConnected && !view.request && view.page.next && view.retry.hidden) {
                            view.observer.observe(view.footer);
                        }
                    }, delayMs);
                }
            }
            syncStopButton(view);
            CoverPager._emitState();
        } catch (err) {
            if (CoverPager.view !== view || !view.list.isConnected) return;
            console.warn("QidianBlocker Pagination Error:", err);
            const { rateLimitRetrySec } = CoverPager._readSettings();
            if (RATE_LIMIT_STATUSES.has(httpStatus) && rateLimitRetrySec > 0 && !request.signal.aborted) {
                if ((view.rateLimitRetryCount ?? 0) < RATE_LIMIT_RETRY_LIMIT) {
                    view.rateLimitRetryCount = (view.rateLimitRetryCount ?? 0) + 1;
                    const waitSec = Math.min(600, Math.max(rateLimitRetrySec, retryAfterSec));
                    const retryAt = Date.now() + waitSec * 1000;
                    const attemptText = `（第 ${view.rateLimitRetryCount}/${RATE_LIMIT_RETRY_LIMIT} 次）`;
                    CoverPager.showProgress(view, ` · 触发限流（HTTP ${httpStatus}），${waitSec} 秒后自动重试${attemptText}`);
                    view.retry.hidden = false;
                    view.openPage.href = url;
                    view.openPage.textContent = `打开第 ${view.page.number + 1} 页`;
                    view.openPage.hidden = false;
                    view.rateLimitTimer = setTimeout(() => {
                        view.rateLimitTimer = 0;
                        clearTimeout(view.rateLimitCountdownTimer);
                        view.rateLimitCountdownTimer = 0;
                        CoverPager.load(view);
                    }, waitSec * 1000);
                    const tickCountdown = () => {
                        view.rateLimitCountdownTimer = 0;
                        if (CoverPager.view !== view || !view.rateLimitTimer) return;
                        const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
                        CoverPager.showProgress(view, ` · 触发限流（HTTP ${httpStatus}），${remaining} 秒后自动重试${attemptText}`);
                        if (remaining > 1) view.rateLimitCountdownTimer = setTimeout(tickCountdown, 1000);
                    };
                    if (waitSec > 1) view.rateLimitCountdownTimer = setTimeout(tickCountdown, 1000);
                    syncStopButton(view);
                    CoverPager._emitState();
                    return;
                }
                view.autoPaging = false;
                CoverPager.showProgress(view, ` · 连续触发限流（HTTP ${httpStatus}），已停止自动重试`);
                view.retry.hidden = false;
                view.openPage.href = url;
                view.openPage.textContent = `打开第 ${view.page.number + 1} 页`;
                view.openPage.hidden = false;
                syncStopButton(view);
                CoverPager._emitState();
                return;
            }

            view.autoPaging = false;
            const mayRetry = httpStatus === undefined || httpStatus === 408 || httpStatus >= 500 || request.signal.aborted;
            const waitForScroll = mayRetry && view.retryCount < PAGE_SCROLL_RETRY_LIMIT;
            const reason = (httpStatus === 200 && !request.signal.aborted && err?.message)
                ? err.message
                : CoverPager.failureReason(httpStatus, request.signal.aborted);
            CoverPager.showProgress(view, ` · 下一页加载失败（${reason}）${waitForScroll ? " · 继续向下滚动可重试" : ""}`);
            view.retry.hidden = false;
            view.openPage.href = url;
            view.openPage.textContent = `打开第 ${view.page.number + 1} 页`;
            view.openPage.hidden = false;
            syncStopButton(view);
            CoverPager._emitState();
            if (waitForScroll) CoverPager.waitForDownScroll(view);
        } finally {
            clearTimeout(timer);
            view.request = null;
        }
    }
};
