/**
 * 测试运行器：用 esbuild 把 test/*.test.ts 编译成 .tmp-test/*.mjs，
 * 再用 node:test 运行（零额外测试依赖）。
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const outdir = '.tmp-test'
rmSync(outdir, { recursive: true, force: true })
mkdirSync(outdir, { recursive: true })

const tests = readdirSync('test').filter((f) => f.endsWith('.test.ts'))
if (tests.length === 0) {
  console.error('没有找到 test/*.test.ts')
  process.exit(1)
}

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
