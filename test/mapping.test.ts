/**
 * mapping 层快照测试：喂 record fixture → 断言指令序列。
 * 不依赖 OTel / Langfuse / 网络，纯函数测试。运行：node scripts/test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createState,
  endTurn,
  foldEvent,
  type FoldContext,
  type Instruction,
  type MappingRecord,
} from '../src/mapping.ts'

function ctx(overrides: Partial<FoldContext> = {}): FoldContext {
  return { sessionId: 'session-1', userId: 'user-1', environment: 'development', ...overrides }
}

/** 构造 record fixture（seam record 的最小视图）。 */
function rec(type: string, data: MappingRecord['data'], time = 1000): MappingRecord {
  return { type, time, severity: 'info', data }
}

function foldAll(records: MappingRecord[], c: FoldContext = ctx()): Instruction[] {
  const state = createState()
  const out: Instruction[] = []
  for (const r of records) out.push(...foldEvent(c, state, r))
  return out
}

test('完整 turn 流程：turn/start → user/message → assistant/message → turn/end', () => {
  const records: MappingRecord[] = [
    rec('turn/start', { turn: 1 }, 1000),
    rec('user/message', { message: { role: 'user', content: [{ type: 'text', text: '你好' }] }, source: { kind: 'user' } }, 1100),
    rec('assistant/message', {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '你好！' }],
        source: { kind: 'model', model: 'deepseek-v4-flash', provider: 'deepseek' },
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    }, 1200),
    rec('turn/end', { turn: 1 }, 1300),
  ]

  const instructions = foldAll(records)
  assert.equal(instructions.length, 6)
  assert.equal(instructions[0].kind, 'root:start')
  assert.equal((instructions[0] as { name: string }).name, 'dsh-turn-1')
  assert.equal((instructions[0] as { time: number }).time, 1000)
  assert.equal(instructions[1].kind, 'root:update') // user/message
  assert.equal(instructions[2].kind, 'generation:start')
  assert.equal((instructions[2] as { model: string }).model, 'deepseek-v4-flash')
  assert.equal((instructions[2] as { time: number }).time, 1200)
  // turn/end 的 endTurn：先 end 子观测，再 update+end 根
  assert.equal(instructions[3].kind, 'generation:end')
  assert.equal((instructions[3] as { time: number }).time, 1300)
  assert.equal(instructions[4].kind, 'root:update')
  assert.equal(instructions[5].kind, 'root:end')
})

test('assistant/chunk 被 seam 投影后忽略（不产生 update/event）', () => {
  const records: MappingRecord[] = [
    rec('turn/start', { turn: 1 }, 1000),
    rec('step/start', { turn: 1, step: 1 }, 1100),
    rec('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '你好！' }], source: { kind: 'model', model: 'm' } } }, 1200),
    rec('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: '你' } }, 1201),
    rec('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: '好' } }, 1202),
  ]

  const instructions = foldAll(records)
  // Instruction 联合类型已无 generation:update（seam 投影后不产出），用宽类型断言确保不存在
  assert.equal(instructions.filter((i) => (i as { kind: string }).kind === 'generation:update').length, 0)
  assert.equal(instructions.filter((i) => i.kind === 'event').length, 0)
  // generation 的完整 output 来自 assistant/message（seam 保证内容完整）
  const gen = instructions.find((i) => i.kind === 'generation:start') as { output: unknown }
  assert.equal(gen.output, '你好！')
})

test('tool 流程：tool/call → tool/result（含 error）', () => {
  const records: MappingRecord[] = [
    rec('turn/start', { turn: 1 }, 1000),
    rec('step/start', { turn: 1, step: 1 }, 1100),
    rec('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: 'ls' }, 1200),
    rec('tool/result', { turn: 1, step: 1, callId: 'c1', error: { name: 'ExitCodeError', code: '1' } }, 1300),
  ]

  const instructions = foldAll(records)
  const toolStart = instructions.find((i) => i.kind === 'tool:start') as { name: string; parentStepKey?: string }
  assert.ok(toolStart)
  assert.equal(toolStart.name, 'bash')
  assert.equal(toolStart.parentStepKey, '1.1')
  const toolUpdate = instructions.find((i) => i.kind === 'tool:update') as { level: string }
  assert.equal(toolUpdate.level, 'ERROR')
  assert.ok(instructions.some((i) => i.kind === 'tool:end'))
})

test('model 解析：assistant/message 用 source.model，无 source 时 fallback header', () => {
  const records: MappingRecord[] = [
    rec('turn/start', { turn: 1 }, 1000),
    rec('request/header', { header: { config: { model: 'header-model', provider: 'p' } } }, 1100),
    rec('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [], source: { kind: 'model' } } }, 1200),
  ]
  const instructions = foldAll(records)
  const gen = instructions.find((i) => i.kind === 'generation:start') as { model: string }
  assert.equal(gen.model, 'header-model')
})

test('noise 事件被忽略', () => {
  const records: MappingRecord[] = [
    rec('turn/start', { turn: 1 }, 1000),
    rec('todo/write', {}, 1100),
    rec('request/context', {}, 1200),
  ]
  const instructions = foldAll(records)
  assert.equal(instructions.filter((i) => i.kind === 'event').length, 0)
})

test('多轮 turn 清空上一轮 inputMessages', () => {
  const records: MappingRecord[] = [
    rec('turn/start', { turn: 1 }, 1000),
    rec('user/message', { message: { role: 'user', content: [{ type: 'text', text: '第一轮' }] }, source: { kind: 'user' } }, 1100),
    rec('turn/end', { turn: 1 }, 1200),
    rec('turn/start', { turn: 2 }, 1300),
    rec('user/message', { message: { role: 'user', content: [{ type: 'text', text: '第二轮' }] }, source: { kind: 'user' } }, 1400),
  ]
  const instructions = foldAll(records)
  const lastRootUpdate = instructions.filter((i) => i.kind === 'root:update').pop() as { input: unknown }
  const input = lastRootUpdate.input as Array<{ content: Array<{ text: string }> }>
  assert.equal(input[0].content[0].text, '第二轮')
})

test('headless：user/message 先于 turn/start 时懒建根', () => {
  const records: MappingRecord[] = [
    rec('user/message', { message: { role: 'user', content: [{ type: 'text', text: 'hi' }] }, source: { kind: 'user' } }, 1000),
  ]
  const instructions = foldAll(records)
  assert.equal(instructions[0].kind, 'root:start')
  assert.equal((instructions[0] as { name: string }).name, 'dsh-session')
})

test('headless：懒建根后补到的 turn/start 不清空已累积输入', () => {
  const records: MappingRecord[] = [
    rec('user/message', { message: { role: 'user', content: [{ type: 'text', text: 'hi' }] }, source: { kind: 'user' } }, 1000),
    rec('turn/start', { turn: 0 }, 1100),
  ]
  const instructions = foldAll(records)
  // root 已懒建（user/message 时），补到的 turn/start 只产生 root:update(turn:0)
  const update = instructions.find((i) => i.kind === 'root:update')
  assert.ok(update)
  const rootStart = instructions.find((i) => i.kind === 'root:start') as { input: unknown }
  const input = rootStart.input as Array<{ content: Array<{ text: string }> }>
  assert.equal(input[0].content[0].text, 'hi')
})

test('endTurn 后 lastAssistantOutput 被清空（tool-only 下一轮不误带旧输出）', () => {
  const records: MappingRecord[] = [
    rec('turn/start', { turn: 1 }, 1000),
    rec('user/message', { message: { role: 'user', content: [{ type: 'text', text: '第一轮' }] }, source: { kind: 'user' } }, 1100),
    rec('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '第一轮回答' }], source: { kind: 'model', model: 'm' } } }, 1200),
    rec('turn/end', { turn: 1 }, 1300),
    // 第二轮：只有 tool 调用，无 assistant 输出
    rec('turn/start', { turn: 2 }, 1400),
    rec('step/start', { turn: 2, step: 1 }, 1500),
    rec('tool/call', { turn: 2, step: 1, callId: 'c2', name: 'bash', arguments: 'ls' }, 1600),
    rec('tool/result', { turn: 2, step: 1, callId: 'c2' }, 1700),
    rec('turn/end', { turn: 2 }, 1800),
  ]
  const instructions = foldAll(records)
  // 第二轮 turn/end 的 root:update output 应为 undefined（不再携带第一轮的回答）
  const turn2End = instructions.filter((i) => i.kind === 'root:update').pop() as { output: unknown }
  assert.equal(turn2End.output, undefined)
})

test('root:start 的 tags 是数组（非 JSON 字符串）', () => {
  const records: MappingRecord[] = [rec('turn/start', { turn: 1 }, 1000)]
  const instructions = foldAll(records)
  const start = instructions[0] as { attributes: Record<string, unknown> }
  assert.ok(Array.isArray(start.attributes['langfuse.trace.tags']))
  assert.deepEqual(start.attributes['langfuse.trace.tags'], ['dsh', 'development'])
})

test('endTurn 兜底：未 end 的 generation/tool/step 全部关闭（shutdown 场景）', () => {
  const records: MappingRecord[] = [
    rec('turn/start', { turn: 1 }, 1000),
    rec('step/start', { turn: 1, step: 1 }, 1100),
    rec('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: 'ls' }, 1200),
    rec('assistant/message', {
      turn: 1, step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], source: { kind: 'model', model: 'm' } },
    }, 1300),
    // 没有 turn/end、没有 step/end、没有 tool/result —— 直接销毁（shutdown marker 到达）
  ]
  const state = createState()
  const out: Instruction[] = []
  for (const r of records) out.push(...foldEvent(ctx(), state, r))
  const endIns = endTurn(state, 9999) // backend 收到 shutdown marker 时的兜底
  out.push(...endIns)

  const kinds = out.map((i) => i.kind)
  assert.ok(kinds.includes('generation:end'), 'generation 被兜底 end')
  assert.ok(kinds.includes('tool:end'), 'tool 被兜底 end')
  assert.ok(kinds.includes('step:end'), 'step 被兜底 end')
  assert.ok(kinds.includes('root:end'), 'root 被兜底 end')
  // endTurn 后状态清空（backend 会据此 delete state）
  assert.equal(state.hasRoot, false)
  assert.equal(state.generations.size, 0)
  assert.equal(state.tools.size, 0)
  assert.equal(state.steps.size, 0)
  assert.equal(state.lastAssistantOutput, undefined)
  // 兜底 end 的时间是 shutdown 时间
  const genEnd = endIns.find((i) => i.kind === 'generation:end') as { time: number }
  assert.equal(genEnd.time, 9999)
})

test('完整会话仿真：多轮 + tool + 多 step + shutdown，trace 指令树闭合', () => {
  const records: MappingRecord[] = [
    // 第 1 轮：user → tool → assistant
    rec('turn/start', { turn: 1 }, 1000),
    rec('user/message', { message: { role: 'user', content: [{ type: 'text', text: '查一下' }] }, source: { kind: 'user' } }, 1100),
    rec('step/start', { turn: 1, step: 1 }, 1200),
    rec('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: 'pwd' }, 1300),
    rec('tool/result', { turn: 1, step: 1, callId: 'c1', message: { content: '/home/user' } }, 1400),
    rec('assistant/message', {
      turn: 1, step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: '目录是 /home/user' }], source: { kind: 'model', model: 'deepseek-v4-flash' } },
      usage: { inputTokens: 10, outputTokens: 5 },
    }, 1500),
    rec('step/end', { turn: 1, step: 1 }, 1600),
    rec('turn/end', { turn: 1 }, 1700),
    // 第 2 轮：只有 assistant（tool-only 上一轮不应带旧输出）
    rec('turn/start', { turn: 2 }, 1800),
    rec('user/message', { message: { role: 'user', content: [{ type: 'text', text: '继续' }] }, source: { kind: 'user' } }, 1900),
    rec('step/start', { turn: 2, step: 1 }, 2000),
    rec('assistant/message', {
      turn: 2, step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: '好的' }], source: { kind: 'model', model: 'deepseek-v4-flash' } },
    }, 2100),
    rec('step/end', { turn: 2, step: 1 }, 2200),
    // 没有 turn/end —— 直接 shutdown
  ]
  const state = createState()
  const out: Instruction[] = []
  for (const r of records) out.push(...foldEvent(ctx(), state, r))
  out.push(...endTurn(state, 2300)) // shutdown 兜底

  const kinds = out.map((i) => i.kind)
  // 两个 root:start；root:end 出现两次（第 1 轮 turn/end + 第 2 轮 shutdown 兜底）
  assert.equal(kinds.filter((k) => k === 'root:start').length, 2)
  assert.equal(kinds.filter((k) => k === 'root:end').length, 2)
  // 两个 generation、全部 end
  assert.equal(kinds.filter((k) => k === 'generation:start').length, 2)
  assert.equal(kinds.filter((k) => k === 'generation:end').length, 2)
  // 一个 tool，已 end（第 1 轮 tool/result 正常 end）
  assert.equal(kinds.filter((k) => k === 'tool:start').length, 1)
  assert.equal(kinds.filter((k) => k === 'tool:end').length, 1)
  // 最后一轮 root:update 的 output 是第 2 轮的回答（shutdown 兜底不误带第 1 轮）
  const lastRootUpdate = [...out].filter((i) => i.kind === 'root:update').pop() as { output: unknown }
  assert.equal(lastRootUpdate.output, '好的')
})

test('用户重试轮（regenerate，本轮无新 user/message）input 兜底最近用户输入（lastUserInput）', () => {
  const records: MappingRecord[] = [
    // 第 1 轮有用户输入
    rec('turn/start', { turn: 1 }, 1000),
    rec('user/message', { message: { role: 'user', content: [{ type: 'text', text: '原始问题' }] }, source: { kind: 'user' } }, 1100),
    rec('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [], source: { kind: 'model', model: 'm' } } }, 1200),
    rec('turn/end', { turn: 1 }, 1300),
    // 第 2 轮（retry/regenerate）：turn/start 后没有 user/message，直接 LLM 调用
    rec('turn/start', { turn: 2 }, 1400),
    rec('assistant/message', { turn: 2, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '重试回答' }], source: { kind: 'model', model: 'm' } } }, 1500),
  ]
  const instructions = foldAll(records)
  const gen = instructions.filter((i) => i.kind === 'generation:start').pop() as { input: unknown }
  const input = gen.input as Array<{ content: Array<{ text: string }> }>
  assert.ok(input, 'retry 轮 generation 的 input 不应为空（lastUserInput 兜底）')
  assert.equal(input[0].content[0].text, '原始问题')
})

test('缺 callId 的 tool/call 被丢弃（不产生 tool:start，无 TOOL + "" 泄漏）', () => {
  const records: MappingRecord[] = [
    rec('turn/start', { turn: 1 }, 1000),
    rec('step/start', { turn: 1, step: 1 }, 1100),
    // 畸形数据：callId 缺失
    rec('tool/call', { turn: 1, step: 1, name: 'bash', arguments: 'ls' }, 1200),
    rec('turn/end', { turn: 1 }, 1300),
  ]
  const instructions = foldAll(records)
  assert.equal(instructions.filter((i) => i.kind === 'tool:start').length, 0, '缺 callId 不产生 tool:start')
  // endTurn 也不应产生 tool:end（没有登记过的 tool）
  assert.equal(instructions.filter((i) => i.kind === 'tool:end').length, 0)
})

test('step 闭合：step/start → assistant/message → step/end 产出完整 step 指令序列', () => {
  const records: MappingRecord[] = [
    rec('turn/start', { turn: 1 }, 1000),
    rec('step/start', { turn: 1, step: 1 }, 1100),
    rec('assistant/message', {
      turn: 1, step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: 'step 回答' }], source: { kind: 'model', model: 'm' } },
    }, 1200),
    rec('step/end', { turn: 1, step: 1 }, 1300),
  ]
  const instructions = foldAll(records)
  const start = instructions.find((i) => i.kind === 'step:start') as { key: string; time: number }
  assert.ok(start, 'step/start 产生 step:start')
  assert.equal(start.key, '1.1')
  assert.equal(start.time, 1100)
  // step/end 先 update（output=该 step 的 assistant 输出）再 end
  const update = instructions.find((i) => i.kind === 'step:update') as { key: string; output: unknown }
  assert.ok(update, 'step/end 前产生 step:update')
  assert.equal(update.output, 'step 回答')
  const end = instructions.find((i) => i.kind === 'step:end') as { key: string; time: number }
  assert.ok(end, 'step/end 产生 step:end')
  assert.equal(end.time, 1300)
})

test('reasoning 拆分：assistant content 含 reasoning 块时 output 保持纯文本、思维链进 metadata', () => {
  const records: MappingRecord[] = [
    rec('turn/start', { turn: 1 }, 1000),
    rec('user/message', { message: { role: 'user', content: [{ type: 'text', text: 'hi' }] }, source: { kind: 'user' } }, 1100),
    rec('assistant/message', {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: '第一步思考…' },
          { type: 'text', text: '最终回答' },
          { type: 'reasoning', text: '补充推理…' },
        ],
        source: { kind: 'model', model: 'm' },
      },
    }, 1200),
    rec('turn/end', { turn: 1 }, 1300),
  ]

  const instructions = foldAll(records)
  const gen = instructions.find((i) => i.kind === 'generation:start') as {
    output: unknown
    metadata: { reasoning?: string }
  }
  assert.ok(gen, '产生 generation:start')
  assert.equal(gen.output, '最终回答', 'output 只含 text 正文，不含 reasoning')
  assert.equal(gen.metadata.reasoning, '第一步思考…\n补充推理…', 'reasoning 拼接进 metadata')
})

test('reasoning 拆分：thinking 类型块同样进 reasoning，且与 reasoning 块按序拼接', () => {
  const records: MappingRecord[] = [
    rec('turn/start', { turn: 1 }, 1000),
    rec('user/message', { message: { role: 'user', content: [{ type: 'text', text: 'hi' }] }, source: { kind: 'user' } }, 1100),
    rec('assistant/message', {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', text: '思考A' },
          { type: 'text', text: '回答' },
          { type: 'reasoning', text: '推理B' },
        ],
        source: { kind: 'model', model: 'm' },
      },
    }, 1200),
  ]

  const instructions = foldAll(records)
  const gen = instructions.find((i) => i.kind === 'generation:start') as {
    output: unknown
    metadata: { reasoning?: string }
  }
  assert.ok(gen, '产生 generation:start')
  assert.equal(gen.output, '回答', 'output 只含 text 正文')
  assert.equal(gen.metadata.reasoning, '思考A\n推理B', 'thinking 与 reasoning 按序拼接进 metadata')
})

test('usage 边界：缺 usage 时 generation:start 无 usageDetails', () => {
  const records: MappingRecord[] = [
    rec('turn/start', { turn: 1 }, 1000),
    rec('user/message', { message: { role: 'user', content: [{ type: 'text', text: 'hi' }] }, source: { kind: 'user' } }, 1100),
    rec('assistant/message', {
      turn: 1,
      step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: '回答' }], source: { kind: 'model', model: 'm' } },
      // 无 usage 字段
    }, 1200),
  ]

  const instructions = foldAll(records)
  const gen = instructions.find((i) => i.kind === 'generation:start') as { usageDetails?: unknown }
  assert.ok(gen, '产生 generation:start')
  assert.equal(gen.usageDetails, undefined, '缺 usage 时不产出 usageDetails')
})

test('usage 边界：空 usage 对象产出全零 usageDetails（无 output_reasoning）', () => {
  const records: MappingRecord[] = [
    rec('turn/start', { turn: 1 }, 1000),
    rec('user/message', { message: { role: 'user', content: [{ type: 'text', text: 'hi' }] }, source: { kind: 'user' } }, 1100),
    rec('assistant/message', {
      turn: 1,
      step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: '回答' }], source: { kind: 'model', model: 'm' } },
      usage: {},
    }, 1200),
  ]

  const instructions = foldAll(records)
  const gen = instructions.find((i) => i.kind === 'generation:start') as {
    usageDetails?: { input: number; output: number; total: number; output_reasoning?: number }
  }
  assert.ok(gen, '产生 generation:start')
  assert.deepEqual(gen.usageDetails, { input: 0, output: 0, total: 0 }, '空 usage → 全零 usageDetails')
})
