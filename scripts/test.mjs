/**
 * 测试运行器：用 esbuild 把 test/*.test.ts 编译成 .tmp-test/*.mjs，
 * 再用 node:test 运行（零额外测试依赖）。
 * 支持过滤：pnpm test -- mapping（只跑 mapping.test.ts）
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const filter = process.argv[2] ?? ''
const outdir = '.tmp-test'
rmSync(outdir, { recursive: true, force: true })
mkdirSync(outdir, { recursive: true })

const tests = readdirSync('test').filter(
  (f) => f.endsWith('.test.ts') && (!filter || f.includes(filter)),
)
if (tests.length === 0) {
  console.error(filter ? `没有找到包含 "${filter}" 的 test/*.test.ts` : '没有找到 test/*.test.ts')
  process.exit(1)
}
if (filter) console.log(`test: 过滤 "${filter}" → ${tests.join(', ')}`)

for (const t of tests) {
  await build({
    entryPoints: [`test/${t}`],
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: [
      'node:test',
      'node:assert',
      'node:assert/strict',
      // transport 层的第三方依赖：运行时从 node_modules 解析（不打包进测试产物）
      '@langfuse/tracing',
      '@langfuse/otel',
      '@opentelemetry/api',
      '@opentelemetry/sdk-trace-base',
      '@opentelemetry/core',
    ],
    outfile: join(outdir, t.replace('.ts', '.mjs')),
    logLevel: 'silent',
  })
}

const files = tests.map((t) => join(outdir, t.replace('.ts', '.mjs')))
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(result.status ?? 1)
