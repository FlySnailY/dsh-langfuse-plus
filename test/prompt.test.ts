/**
 * prompt.ts（双向桥）的 publishPromptDeduped 行为测试。
 * 用可控的 fetch mock 验证：相同文本合并、不同文本各自发布、error 不发布。
 * 运行：node scripts/test.mjs（自动编译并执行 test/*.test.ts）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installPrompt } from '../src/prompt.ts'

/** 可编程 fetch mock：记录调用，支持预设响应队列或手动 resolve。 */
class FetchMock {
  calls: { url: string; init: RequestInit }[] = []
  private resolvers: ((r: Response) => void)[] = []
  responses: Response[] = []

  fn = (url: unknown, init?: RequestInit): Promise<Response> => {
    this.calls.push({ url: String(url), init: init ?? {} })
    if (this.responses.length > 0) return Promise.resolve(this.responses.shift()!)
    return new Promise((resolve) => this.resolvers.push(resolve))
  }

  resolveNext(response: Response): void {
    this.resolvers.shift()?.(response)
  }

  reset(): void {
    this.calls = []
    this.resolvers = []
    this.responses = []
  }
}

/** 构造一个简单的 Response 形状（prompt.ts 只用 ok/status/json）。 */
function resp(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

/** 构造 installPrompt 所需的最小 ctx（只收集 handler）。 */
function makeCtx() {
  const handlers = new Map<string, Function>()
  return {
    on: (name: string, fn: Function) => {
      handlers.set(name, fn)
    },
    handlers,
  }
}

function makeConfig(promptEnabled = true) {
  return {
    enabled: true,
    baseUrl: 'http://lf.test',
    publicKey: 'lf_pk_x',
    secretKey: 'lf_sk_y',
    environment: 'development',
    promptName: 'dsh-system-prompt',
    promptEnabled,
    promptLabel: 'production',
    userId: 'user-1',
  }
}

/** 触发一次 system-prompt/assemble，模拟 DSH 组装系统提示词。 */
function fireAssemble(handler: Function, personaText: string): void {
  const assembly = {
    sections: [{ name: 'deployment:persona', text: personaText }],
  }
  const next = async () => ({ sections: assembly.sections })
  void handler(assembly, {}, next)
}

test('相同 persona 文本的并发发布被合并（只 POST 一次）', async () => {
  const fetchMock = new FetchMock()
  const originalFetch = globalThis.fetch
  ;(globalThis as any).fetch = fetchMock.fn
  try {
    const ctx = makeCtx()
    installPrompt(ctx as any, makeConfig() as any, { current: null })
    const handler = ctx.handlers.get('system-prompt/assemble')!

    // 预置足量 404（下行 GET + dedup 内部 GET + POST 都消费队列）
    fetchMock.reset()
    for (let i = 0; i < 8; i++) fetchMock.responses.push(resp(404, {}))

    // 两次 assemble 几乎同时触发，文本相同 → 上行发布应合并为一次 POST
    fireAssemble(handler, 'persona-A')
    fireAssemble(handler, 'persona-A')
    await new Promise((r) => setTimeout(r, 40))

    const posts = fetchMock.calls.filter((c) => c.init.method === 'POST')
    assert.equal(posts.length, 1, `期望 1 次 POST，实际 ${posts.length}（调用序列: ${fetchMock.calls.map((c) => c.init.method ?? 'GET').join(',')}）`)
    assert.equal(JSON.parse(String(posts[0].init.body)).prompt, 'persona-A')
  } finally {
    ;(globalThis as any).fetch = originalFetch
  }
})

test('不同 persona 文本各自独立发布（不被吞掉）', async () => {
  const fetchMock = new FetchMock()
  const originalFetch = globalThis.fetch
  ;(globalThis as any).fetch = fetchMock.fn
  try {
    const ctx = makeCtx()
    installPrompt(ctx as any, makeConfig() as any, { current: null })
    const handler = ctx.handlers.get('system-prompt/assemble')!

    // 预置足量 404，让两个 assemble 各自的下行 GET + dedup 内部 GET 都自动完成
    fetchMock.reset()
    for (let i = 0; i < 8; i++) fetchMock.responses.push(resp(404, {}))

    // 两个 assemble 文本不同 → 各自独立发布（各一次 POST）
    fireAssemble(handler, 'persona-A')
    fireAssemble(handler, 'persona-B')
    await new Promise((r) => setTimeout(r, 40))

    const posts = fetchMock.calls.filter((c) => c.init.method === 'POST')
    assert.equal(posts.length, 2, `期望 2 次 POST，实际 ${posts.length}（调用序列: ${fetchMock.calls.map((c) => c.init.method ?? 'GET').join(',')}）`)
    const bodies = posts.map((c) => JSON.parse(String(c.init.body)).prompt).sort()
    assert.deepEqual(bodies, ['persona-A', 'persona-B'])
  } finally {
    ;(globalThis as any).fetch = originalFetch
  }
})

test('Langfuse 不可达（500）时不发布、不抛错', async () => {
  const fetchMock = new FetchMock()
  const originalFetch = globalThis.fetch
  ;(globalThis as any).fetch = fetchMock.fn
  try {
    const ctx = makeCtx()
    installPrompt(ctx as any, makeConfig() as any, { current: null })

    fetchMock.reset()
    // 预置 fetchPrompt 返回 500（error）
    fetchMock.responses.push(resp(500, {}))
    fireAssemble(ctx.handlers.get('system-prompt/assemble')!, 'persona-X')
    await new Promise((r) => setTimeout(r, 20))

    // 只有 1 个 GET，无 POST（error 不触发发布）
    assert.equal(fetchMock.calls.length, 1)
    assert.equal(fetchMock.calls.filter((c) => c.init.method === 'POST').length, 0)
  } finally {
    ;(globalThis as any).fetch = originalFetch
  }
})
