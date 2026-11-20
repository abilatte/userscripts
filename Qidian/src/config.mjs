// 起点改版时只需要调整这里的选择器
export const COVER_LIST = "#book-img-text .all-img-list";
export const COVER_LAYOUT = {
    root: "#book-img-text",
    list: COVER_LIST,
    item: `${COVER_LIST} > li`,
    link: ".book-mid-info h2 > a[data-bid]",
    category: "p.author a:not(.name):not(.go-sub-type)",
    subCategory: "a.go-sub-type",
    modeName: "图文模式"
};
export const SELECTORS = {
    listLayouts: [
        // 图文模式，两列
        COVER_LAYOUT,
        // 文字模式
        {
            root: "#book-text",
            list: "#book-text .rank-table-list > tbody",
            item: "#book-text .rank-table-list > tbody > tr",
            link: "a.name[data-bid]",
            category: "a.type",
            subCategory: "a.go-sub-type",
            modeName: "文字模式"
        }
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
