import { PageType } from "./config.mjs";
import { DATA_KEY, Storage } from "./core/storage.mjs";
import { Sync } from "./core/sync.mjs";
import { DetailPage } from "./pages/detail.mjs";
import { ListPage } from "./pages/list.mjs";
import { CoverPager } from "./pages/pagination.mjs";
import { CategoryPanel } from "./ui/category-panel.mjs";
import { Panel } from "./ui/panel.mjs";

const COVER_PAGER_ENABLED_KEY = "qidian_cover_pager_enabled";

export function init() {
    const isListPage = PageType.isList();
    const coverPagerEnabled = isListPage && GM_getValue(COVER_PAGER_ENABLED_KEY, true);
    const detailBid = PageType.detailBid();
    const applyDetail = () => {
        if (!detailBid || document.readyState === "loading") return;
        try {
            DetailPage.apply(detailBid);
        } catch (err) {
            console.error("QidianBlocker Error:", err);
        }
    };
    const refreshListControls = () => {
        if (document.readyState === "loading") return;
        ListPage.mountSummary(CategoryPanel.open);
        ListPage.renderSummary();
        CategoryPanel.refresh();
        if (coverPagerEnabled) CoverPager.mount();
    };
    const applyInitialPage = () => {
        if (isListPage) {
            ListPage.applyNew(document.querySelectorAll(ListPage.itemSelector));
            refreshListControls();
        } else {
            applyDetail();
        }
    };

    Storage.onSnapshot(Sync.onDataChange);
    Storage.onLocalChange(Sync.schedule);
    Storage.onChange(isListPage ? ListPage.applyChanges : applyDetail);
    Storage.onChange(Panel.refresh);
    GM_addValueChangeListener(DATA_KEY, (name, oldValue, newValue, remote) => {
        if (remote && newValue) Storage.accept(newValue);
    });
    GM_registerMenuCommand("⚙️ 管理屏蔽列表", Panel.open);
    if (isListPage) {
        Storage.onChange(CategoryPanel.refresh);
        Storage.onCategoryRulesChange(() => {
            ListPage.applyRules();
            CategoryPanel.refresh();
        });
        GM_registerMenuCommand("按分类屏蔽", CategoryPanel.open);
        GM_registerMenuCommand(`${coverPagerEnabled ? "关闭" : "开启"}内置无缝翻页`, () => {
            GM_setValue(COVER_PAGER_ENABLED_KEY, !coverPagerEnabled);
            location.reload();
        });
    }

    // 脚本在 document-start 注入：列表页边解析边处理，详情页的按钮区要等解析结束才存在
    if (isListPage) ListPage.watch(refreshListControls, () => CoverPager.view?.list.isConnected === false);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyInitialPage);
    else applyInitialPage();

    // 同步：打开页面、切回页面时检查远端；切走页面时把还没上传的改动立即传上去
    Sync.onChange(Panel.refreshSync);
    // 页面刷新或关闭时也会触发 hidden，这时只上传、不为了拉取而发请求
    document.addEventListener("visibilitychange", () => Sync.run({ pushOnly: document.visibilityState === "hidden" }));
    Sync.run();
}
