/**
 * transport 层离线行为测试（构造真实 ObservationTransport）。
 *
 * 关键设计：所有 span 只 start 不 end——BatchSpanProcessor 只入队已 end 的 span，
 * shutdown 时队列为空、零网络 flush（不依赖端口拒绝，绕开 exporter 重试退避，整轮 <1s）。
 * 验证：traceId 记录/clearSession、各类型 start 分支、provider 覆盖警告（单实例不报/二次才报）。
 * 运行：node scripts/test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ObservationTransport } from '../src/transport.ts'

const cfg = { publicKey: 'lf_pk_test', secretKey: 'lf_sk_test', baseUrl: 'http://127.0.0.1:1', environment: 'development' }

test('root:start 记录 traceId + clearSession 清理（不 end span，shutdown 不触网）', async () => {
  const t = new ObservationTransport(cfg)
  t.apply('s1', [
    { kind: 'root:start', turn: 1, name: 'dsh-turn-1', time: 1000, input: 'hi', metadata: { sessionId: 's1' }, attributes: { 'langfuse.session.id': 's1', 'langfuse.trace.tags': ['dsh', 'development'] } },
  ])

  const traceId = t.traceIdFor('s1')
  assert.ok(traceId, 'root:start 应记录 traceId')
  assert.match(traceId!, /^[0-9a-f]{32}$/)

  // root:end 不清 traceId（feedback 关联用），clearSession 才清
  assert.ok(t.traceIdFor('s1'))
  t.clearSession('s1')
  assert.equal(t.traceIdFor('s1'), undefined)

  // 队列空 → shutdown 无网络请求
  await t.shutdown().catch(() => {})
})

test('各类型观测 start 分支可执行（step/tool/generation 挂父 span，不抛错）', async () => {
  const t = new ObservationTransport(cfg)
  t.apply('s2', [
    { kind: 'root:start', turn: 1, name: 'dsh-turn-1', time: 1000, attributes: { 'langfuse.session.id': 's2' } },
    { kind: 'step:start', key: '1.1', time: 1050, metadata: { turn: 1, step: 1 } },
    { kind: 'tool:start', callId: 'c1', name: 'bash', time: 1100, input: 'ls', parentStepKey: '1.1' },
    { kind: 'tool:update', callId: 'c1', output: 'file.txt', level: 'ERROR', statusMessage: 'exit 1' },
    { kind: 'generation:start', key: '1.1', model: 'm', time: 1300, input: 'hi', usageDetails: { input: 1, output: 1 }, parentStepKey: '1.1' },
  ])
  // 无异常即通过；traceId 仍可查
  assert.match(t.traceIdFor('s2')!, /^[0-9a-f]{32}$/)
  await t.shutdown().catch(() => {})
})

test('provider 覆盖警告：单实例不告警，二次构造才告警（#2/#9）', async () => {
  const warns: string[] = []
  const origWarn = console.warn
  console.warn = (...args: unknown[]) => warns.push(args.join(' '))
  try {
    const t1 = new ObservationTransport(cfg)
    assert.equal(warns.length, 0, '单实例首次构造不应告警（全局 ProxyTracerProvider 恒非空，不能作为判断依据）')

    const t2 = new ObservationTransport(cfg)
    assert.equal(warns.length, 1, '二次构造（真实多实例/HMR 重叠）应告警')
    assert.ok(warns[0].includes('another backend instance'))

    // 无 span → shutdown 队列空，快速；先 t1 后 t2（t2 是最后实例，撤销 isolated provider）
    await t1.shutdown().catch(() => {})
    await t2.shutdown().catch(() => {})
  } finally {
    console.warn = origWarn
  }
})

test('完整生命周期：update/end/event 分支执行 + observation 登记/移除（最后执行，不 shutdown）', () => {
  const t = new ObservationTransport(cfg)
  t.apply('s3', [
    { kind: 'root:start', turn: 1, name: 'dsh-turn-1', time: 1000, attributes: { 'langfuse.session.id': 's3' } },
    { kind: 'step:start', key: '1.1', time: 1050, metadata: { turn: 1, step: 1 } },
    { kind: 'tool:start', callId: 'c1', name: 'bash', time: 1100, input: 'ls', parentStepKey: '1.1' },
    { kind: 'generation:start', key: '1.1', model: 'm', time: 1300, input: 'hi', usageDetails: { input: 1, output: 1 }, parentStepKey: '1.1' },
  ])
  // 类型断言访问私有 map（不为测试给生产类加 API）；observations 是 sessionId → key 嵌套
  const obs = (t as unknown as { observations: Map<string, Map<string, unknown>> }).observations
  const roots = (t as unknown as { roots: Map<string, unknown> }).roots
  assert.ok(roots.has('s3'), 'root:start 登记 roots')
  assert.ok(obs.get('s3')?.has('step:1.1'), 'step:start 登记 observations')
  assert.ok(obs.get('s3')?.has('tool:c1'), 'tool:start 登记 observations')
  assert.ok(obs.get('s3')?.has('gen:1.1'), 'generation:start 登记 observations')

  t.apply('s3', [
    { kind: 'tool:update', callId: 'c1', output: 'file.txt', level: 'ERROR', statusMessage: 'exit 1' },
    { kind: 'tool:end', callId: 'c1', time: 1200 },
    { kind: 'generation:end', key: '1.1', time: 1400 },
    { kind: 'step:update', key: '1.1', output: 'ok' },
    { kind: 'step:end', key: '1.1', time: 1500 },
    { kind: 'event', name: 'event.foo', time: 1600, input: { k: 'v' } },
    { kind: 'root:update', input: 'hi', output: 'ok' },
    { kind: 'root:end', time: 1700 },
  ])
  // end 后对应条目移除（无泄漏）；clearSession 后整组嵌套 map 也移除
  assert.ok(!obs.get('s3')?.has('tool:c1'), 'tool:end 后移除')
  assert.ok(!obs.get('s3')?.has('gen:1.1'), 'generation:end 后移除')
  assert.ok(!obs.get('s3')?.has('step:1.1'), 'step:end 后移除')
  assert.ok(!roots.has('s3'), 'root:end 后移除')
  t.clearSession('s3')
  assert.ok(!obs.has('s3'), 'clearSession 移除该会话全部 observations（防泄漏）')

  // 刻意不 shutdown：已 end span 在队列，5s 定时 flush 不会在本测试（<1s）内触发，
  // 进程退出直接丢弃（零网络）；声明在文件末尾，installedProvider 残留不影响后续测试。
  // 完整导出链路（end → flush → OTLP）无法离线验证，仅经真实环境冒烟。
})
