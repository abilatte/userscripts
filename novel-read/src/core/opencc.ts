import { GM_getResourceText } from '$';
import type { ScriptMode } from '../types';

type Convert = (text: string) => string;
type Mode = Exclude<ScriptMode, 'raw'>;

interface OpenCCModule {
  Converter(options: { from: string; to: string }): Convert;
}

/**
 * 两个方向的字典分开打包、分别按需加载：
 * 繁→简（约 110KB）每次进入阅读模式都要用（书名比较、已读同步固定按简体），
 * 简→繁（约 1.1MB）只在显示繁体或换源搜索时才加载。
 * 台湾站原文多为繁体，只转字形不做地区用词替换。
 */
const SOURCES: Record<Mode, { resource: string; from: string; to: string }> = {
  hans: { resource: 'opencc-t2cn', from: 'tw', to: 'cn' },
  hant: { resource: 'opencc-cn2t', from: 'cn', to: 'tw' },
};

const converters: Partial<Record<Mode, Promise<Convert>>> = {};

function load(mode: Mode): Promise<Convert> {
  const cached = converters[mode];
  if (cached) return cached;
  const { resource, from, to } = SOURCES[mode];
  const p = (async () => {
    const code = GM_getResourceText(resource);
    if (!code) throw new Error(`简繁转换字典未加载（@resource ${resource} 为空）`);
    const module = { exports: {} as Record<string, unknown> };
    new Function('exports', 'module', code)(module.exports, module);
    const OpenCC = module.exports as unknown as OpenCCModule;
    if (typeof OpenCC.Converter !== 'function') throw new Error('简繁转换字典格式异常');
    return OpenCC.Converter({ from, to });
  })();
  converters[mode] = p;
  p.catch(() => delete converters[mode]);
  return p;
}

export async function getConverter(mode: ScriptMode): Promise<Convert> {
  if (mode === 'raw') return (s) => s;
  return load(mode);
}
