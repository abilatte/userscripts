import type { SiteEntry } from '../types';

export const BUILTIN_SITES: SiteEntry[] = [
  {
    id: 'twkan',
    name: '台湾小说网',
    hosts: ['twkan.com'],
    enabled: true,
    builtin: true,
    chapterPattern: '^/txt/\\d+/\\d+',
    content: '#txtcontent0',
    title: '.txtnav h1',
    next: { selector: '.page1' },
    prev: { selector: '.page1' },
    tocLink: { selector: '.page1' },
    toc: {
      api: 'https://twkan.com/ajax_novels/chapterlist/{bookId}.html',
      bookIdPattern: '/txt/(\\d+)/',
    },
    remove: ['.txtad', '.txtcenter', 'script', 'style'],
    // 匹配前会把花体字母（𝕥𝕨𝕜𝕒𝕟、🆃🆆🅺🅰🅽 等）还原成 ASCII
    filters: ['twkan'],
    // 站点 chinese.js 会在前端把正文改成不完整的简体，直接取原始 HTML
    freshFirst: true,
  },
  {
    id: 'deqixss',
    name: '得奇小说网',
    hosts: ['deqixss.com'],
    enabled: true,
    builtin: true,
    // 正文走带 token 的接口，前端分页，见 adapters.ts
    adapter: 'deqixss',
    chapterPattern: '^/books/\\d+/\\d+\\.html$',
  },
  {
    id: 'sudugu',
    name: '速读谷',
    hosts: ['sudugu.cc'],
    enabled: true,
    builtin: true,
    // 一章分多页：/216/209710.html → 209710_2.html → 209710_3.html，标题带「（2 / 3）」，按同标题合并
    chapterPattern: '^/\\d+/\\d+(_\\d+)?\\.html$',
    content: '.con',
    // h1 为「书名链接 > 章节名」，提取时会去掉书名链接
    title: '.submenu h1',
    // 书页 h1 里混有字数脚本，书名只取链接
    book: { name: '.itemtxt h1 a', author: '.itemtxt p a[href*="author"]' },
  },
];
