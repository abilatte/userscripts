import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // '$' 是 vite-plugin-monkey 提供的 GM_* 虚拟模块，测试里换成内存实现
    alias: [{ find: /^\$$/, replacement: '/tests/gm.ts' }],
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
});
