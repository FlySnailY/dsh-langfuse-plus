/**
 * 构建 dsh-langfuse-plus 的 client 半（浏览器侧）。
 *
 * 产出 lib/client.js，格式为 DSH 前端的「闭包工厂」契约：
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ... return module.exports } })
 * externals（react / @deepseek-ai/dsh-client-* 等 platform modules）由 DSH 前端
 * 的 module table 在运行时提供，不打包进本文件——这是 DSH client 插件的加载约定。
 */
import { build } from 'esbuild'

/** DSH 前端 module table 的 platform 种子（与 packages/client/web/src/platform.ts 一致）。 */
const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]

const ID = 'dsh-langfuse-plus'

// 构建期注入跳转地址（避免硬编码在 client 源码）：DSH_LANGFUSE_BASE_URL / PROJECT_ID，
// 缺省 localhost:3000 + dsh-prod（与 host 半默认一致）。
const langfuseBaseUrl = (process.env.DSH_LANGFUSE_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
const langfuseProjectId = process.env.DSH_LANGFUSE_PROJECT_ID || 'dsh-prod'
const langfuseUrl = `${langfuseBaseUrl}/project/${langfuseProjectId}/traces`

await build({
  entryPoints: ['client/index.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  external: EXTERNALS,
  define: {
    'process.env.NODE_ENV': '"production"',
    __LANGFUSE_URL__: JSON.stringify(langfuseUrl),
  },
  // inline sourcemap：侧栏问题可定位到 client/index.tsx 源码
  sourcemap: 'inline',
  // 闭包工厂外壳（DSH client 插件加载契约）。
  // esbuild 无 intro 选项，故把 module/exports 的初始化合并进 banner。
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {
var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: {
    js: 'return module.exports; } });',
  },
  minify: false,
  logLevel: 'info',
})

console.log(`✅ client 半已构建 → lib/client.js (id=${ID})`)
