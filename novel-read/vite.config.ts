import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import monkey from 'vite-plugin-monkey';
import openccPkg from './node_modules/opencc-js/package.json' with { type: 'json' };
import pkg from './package.json' with { type: 'json' };

// 字典走 CDN 的 @resource，版本跟随实际安装的 opencc-js，避免和 package.json 各写一份
const opencc = (file: string) => `https://cdn.jsdelivr.net/npm/opencc-js@${openccPkg.version}/dist/umd/${file}.js`;

export default defineConfig({
  plugins: [
    preact(),
    monkey({
      entry: 'src/main.tsx',
      userscript: {
        name: '小说阅读模式',
        namespace: 'novel-reader',
        version: pkg.version,
        description: '在第三方小说站提供起点风格的阅读模式：滚动/章节翻页、目录、简繁转换、站点点选适配',
        author: 'Abilatte',
        homepageURL: 'https://github.com/abilatte/userscripts',
        updateURL: 'https://raw.githubusercontent.com/abilatte/userscripts/main/novel-read/dist/novel-reader.user.js',
        downloadURL: 'https://raw.githubusercontent.com/abilatte/userscripts/main/novel-read/dist/novel-reader.user.js',
        match: ['*://*/*'],
        noframes: true,
        'run-at': 'document-end',
        // 换源要请求其它站点；用户自己添加的站点由 * 覆盖，首次请求时 Tampermonkey 会请用户确认
        connect: ['twkan.com', 'deqixss.com', 'sudugu.cc', '*'],
        // 两个方向的字典分开加载，见 src/core/opencc.ts
        resource: {
          'opencc-t2cn': opencc('t2cn'),
          'opencc-cn2t': opencc('cn2t'),
        },
      },
      build: {
        fileName: 'novel-reader.user.js',
      },
    }),
  ],
});
