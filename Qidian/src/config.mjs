// 起点改版时只需要调整这里的选择器
export const COVER_LIST = "#book-img-text .all-img-list";
export const COVER_LAYOUT = {
    root: "#book-img-text",
    item: `${COVER_LIST} > li`,
    link: ".book-mid-info h2 > a[data-bid]",
    category: "p.author a:not(.name):not(.go-sub-type)",
    subCategory: "a.go-sub-type"
};
export const SELECTORS = {
    listLayouts: [
        // 图文模式，两列
        COVER_LAYOUT,
        // 文字模式
        { root: "#book-text", item: "#book-text .rank-table-list > tbody > tr", link: "a.name[data-bid]", category: "a.type", subCategory: "a.go-sub-type" }
    ],
    pagination: "#page-container",
    nextPage: ".lbf-pagination-next:not(.lbf-pagination-disabled)[href]",
    detailBtnGroup: ".normal-btn",
    detailTitle: "#bookName",
    detailCategory: { category: ".book-attribute a:not([href*='subCateId'])", subCategory: ".book-attribute a[href*='subCateId']" }
};

export const PageType = {
    isList: (pathname = location.pathname) => /^\/all(\/|$)/.test(pathname),
    detailBid: () => {
        const match = location.pathname.match(/^\/book\/(\d+)/);
        return match ? match[1] : null;
    }
};
