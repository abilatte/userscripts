import { SELECTORS } from "../config.mjs";
import { Category } from "../core/blocklist.mjs";
import { Storage } from "../core/storage.mjs";

export const DetailPage = {
    apply: (bid) => {
        let btn = document.getElementById("qd-detail-btn");
        if (!btn) {
            const group = document.querySelector(SELECTORS.detailBtnGroup);
            if (!group) {
                console.warn("QidianBlocker: 未找到详情页按钮区域", SELECTORS.detailBtnGroup);
                return;
            }
            btn = document.createElement("button");
            btn.id = "qd-detail-btn";
            btn.type = "button";
            btn.className = "qd-detail-btn";
            btn.addEventListener("click", () => DetailPage.toggle(bid).catch(Storage.reportError));
            group.appendChild(btn);
        }

        const blocked = Storage.has(bid);
        btn.textContent = blocked ? "🚫" : "🛡️";
        btn.title = blocked ? "已屏蔽，点击取消" : "屏蔽此书";
        btn.classList.toggle("is-blocked", blocked);
        if (blocked && Category.isMissing(Storage.getMap()[bid])) {
            Storage.fillCategories({ [bid]: Category.fromElements(document, SELECTORS.detailCategory) });
        }
    },
    toggle: (bid) => Storage.toggle(bid, () => {
        const titleEl = document.querySelector(SELECTORS.detailTitle);
        const title = titleEl ? titleEl.textContent.trim() : "";
        if (!title) throw new Error("未能读取书名");
        return { title, time: Date.now(), ...Category.fromElements(document, SELECTORS.detailCategory) };
    })
};
