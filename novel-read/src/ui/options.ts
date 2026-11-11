import type { FontId, PageMode, ScriptMode, Settings, ThemeId } from '../types';

export const THEMES: { id: ThemeId; name: string; swatch: string }[] = [
  { id: 'gray', name: '浅灰', swatch: '#e2e2e2' },
  { id: 'white', name: '米白', swatch: '#f6f3ec' },
  { id: 'parchment', name: '羊皮纸', swatch: '#efe3c2' },
  { id: 'green', name: '护眼绿', swatch: '#d7ecd8' },
  { id: 'blue', name: '浅蓝', swatch: '#d6e6ee' },
  { id: 'dark', name: '夜间', swatch: '#1b1b1d' },
];

export const FONTS: { id: FontId; name: string; stack: string }[] = [
  {
    id: 'hei',
    name: '黑体',
    stack: "'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Source Han Sans SC', sans-serif",
  },
  {
    id: 'song',
    name: '宋体',
    stack: "'Songti SC', STSong, SimSun, 'Noto Serif CJK SC', 'Source Han Serif SC', serif",
  },
  { id: 'kai', name: '楷体', stack: "'Kaiti SC', STKaiti, KaiTi, BiauKai, serif" },
];

export const FONT_SIZE = { min: 12, max: 40, step: 2 };
export const WIDTHS = [0, 640, 800, 900, 1000, 1280];
export const LINE_HEIGHTS = [1.5, 1.8, 2.0, 2.2];
export const PARAGRAPH_SPACINGS = [0.5, 1, 1.5, 2];
export const PAGE_MODES: { id: PageMode; name: string }[] = [
  { id: 'chapter', name: '章节翻页' },
  { id: 'scroll', name: '滚动翻页' },
];
export const SCRIPT_MODES: { id: ScriptMode; name: string }[] = [
  { id: 'raw', name: '原文' },
  { id: 'hans', name: '简体' },
  { id: 'hant', name: '繁体' },
];

/** 阅读器根节点上的 CSS 变量 */
export function readerVars(s: Settings): string {
  const font = FONTS.find((f) => f.id === s.font) ?? FONTS[0];
  const pw = s.width ? `min(${s.width}px, calc(100vw - 180px))` : 'min(1600px, calc(100vw - 180px))';
  return [
    `--pw:${pw}`,
    `--fs:${s.fontSize}px`,
    `--lh:${s.lineHeight}`,
    `--ps:${s.paragraphSpacing}em`,
    `--read-font:${font.stack}`,
  ].join(';');
}
