import { PageType } from "./config.mjs";
import { COVER_PAGER_ENABLED_KEY, PAGER_SETTINGS_KEY, Settings } from "./core/settings.mjs";
import { DATA_KEY, Storage } from "./core/storage.mjs";
import { Sync } from "./core/sync.mjs";
import { DetailPage } from "./pages/detail.mjs";
import { ListPage } from "./pages/list.mjs";
import { CoverPager } from "./pages/pagination.mjs";
import { Panel } from "./ui/panel.mjs";

export function init() {
    const isListPage = PageType.isList();
    const applyCoverPagerSetting = () => {
        if (!isListPage || document.readyState === "loading") return;
        if (Settings.getCoverPagerEnabled()) CoverPager.mount();
        else CoverPager.unmount();
    };
    const setCoverPagerEnabled = (enabled) => {
        Settings.setCoverPagerEnabled(enabled);
        applyCoverPagerSetting();
        Panel.refreshSettings();
    };
    const toggleAutoPage = () => {
        const state = CoverPager.getState();
        if (state.autoPaging || state.waitingRetry) {
            CoverPager.stopAuto(" · 已手动停止");
            return false;
        }
        if (!Settings.getCoverPagerEnabled()) return false;
        if (!CoverPager.view) CoverPager.mount();
        return CoverPager.startAuto(Settings.getPagerSettings().autoTargetPages);
    };

    CoverPager.configure({ getSettings: Settings.getPagerSettings });
    CoverPager.onStateChange((state) => {
        ListPage.setPagerState(state);
        Panel.refreshSettings();
    });
    Panel.configure({
        isListPage,
        getCoverPagerEnabled: Settings.getCoverPagerEnabled,
        setCoverPagerEnabled,
        getPagerSettings: Settings.getPagerSettings,
        savePagerSettings: Settings.savePagerSettings,
        getPagerState: CoverPager.getState,
        toggleAutoPage
    });

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
        ListPage.mountSummary(() => Panel.open({ tab: "categories" }), toggleAutoPage);
        ListPage.renderSummary();
        Panel.refreshCategories();
        applyCoverPagerSetting();
        ListPage.setPagerState(CoverPager.getState());
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
    Storage.onCategoryRulesChange(() => {
        if (isListPage) ListPage.applyRules();
        Panel.refreshCategories();
    });
    GM_addValueChangeListener(DATA_KEY, (name, oldValue, newValue, remote) => {
        if (remote && newValue) Storage.accept(newValue);
    });
    if (isListPage) {
        GM_addValueChangeListener(COVER_PAGER_ENABLED_KEY, (name, oldValue, newValue, remote) => {
            if (!remote) return;
            applyCoverPagerSetting();
            Panel.refreshSettings();
        });
        GM_addValueChangeListener(PAGER_SETTINGS_KEY, (name, oldValue, newValue, remote) => {
            if (remote) Panel.refreshSettings();
        });
    }
    GM_registerMenuCommand("管理屏蔽与设置", () => Panel.open());

    // 脚本在 document-start 注入：列表页边解析边处理，详情页的按钮区要等解析结束才存在
    if (isListPage) ListPage.watch(refreshListControls, () => CoverPager.view?.list.isConnected === false, Panel.refreshCategories);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyInitialPage);
    else applyInitialPage();

    // 同步：打开页面、切回页面时检查远端；切走页面时把还没上传的改动立即传上去
    Sync.onChange(Panel.refreshSync);
    // 页面刷新或关闭时也会触发 hidden，这时只上传、不为了拉取而发请求
    document.addEventListener("visibilitychange", () => Sync.run({ pushOnly: document.visibilityState === "hidden" }));
    Sync.run();
}
