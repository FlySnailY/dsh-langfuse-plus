/**
 * mapping 层：把 DSH telemetry record 流折叠成「对 Langfuse 模型的操作指令」。
 * 纯函数、零 OTel/网络依赖，可脱离 SDK 单独快照测试（喂 fixture → 断言指令序列）。
 *
 * record.time 作为 span 的 start/end 时间，保证 live 捕获与 canonical-log 重放
 * 产出完全一致的 trace 树。指令由 transport 层消费；状态（纯数据）由调用方持有回传。
 *
 * @module dsh-langfuse-plus/mapping
 */

/** seam record 的最小视图（按需取字段，不含 DSH/OTel 类型）。 */
export interface MappingRecord {
  type: string
  time: number
  severity: string
  data?: Record<string, unknown> & {
    turn?: number
    step?: number
    callId?: string
    name?: string
    arguments?: string
    reason?: string
    message?: { content?: unknown; role?: string; source?: { kind?: string; model?: string; provider?: string } }
    usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number }
    header?: { config?: { model?: string; provider?: string } }
    error?: { name?: string; code?: string }
    text?: string
  }
}

/** fold 上下文（身份/环境信息，不参与状态机）。 */
export interface FoldContext {
  sessionId: string
  userId: string
  environment: string
  workspace?: string
  /** 当前 Langfuse prompt（generation 关联用）。 */
  currentPrompt?: { name: string; version: number }
}

/** usage 汇总（驼峰键与 Langfuse usageDetails 一致）。 */
export interface UsageDetails {
  input?: number
  output?: number
  total?: number
  output_reasoning?: number
}

/** 纯数据的映射状态（只记录「是否存在」与纯值，不含 OTel 对象）。 */
export interface MappingState {
  hasRoot: boolean
  rootTurn?: number
  generations: Set<string>
  tools: Set<string>
  steps: Set<string>
  inputMessages: { role?: string; sourceKind?: string; content: unknown }[]
  header: { model?: string; provider?: string }
  lastAssistantOutput?: unknown
  /** 最近一条真实用户输入（buildInput 空时的兜底，覆盖 retry/regenerate 等本轮无新输入的轮次）。 */
  lastUserInput?: unknown
}

export function createState(): MappingState {
  return {
    hasRoot: false,
    generations: new Set(),
    tools: new Set(),
    steps: new Set(),
    inputMessages: [],
    header: {},
  }
}

/** transport 层消费的一条操作指令。 */
export type Instruction =
  | { kind: 'root:start'; turn?: number; name: string; time: number; input?: unknown; metadata?: Record<string, unknown>; attributes: Record<string, string | string[]> }
  | { kind: 'root:update'; input?: unknown; output?: unknown; metadata?: Record<string, unknown> }
  | { kind: 'root:end'; time: number }
  | { kind: 'generation:start'; key: string; model: string; time: number; input?: unknown; output?: unknown; usageDetails?: UsageDetails; prompt?: { name: string; version: number }; metadata?: Record<string, unknown>; parentStepKey?: string }
  | { kind: 'generation:end'; key: string; time: number }
  | { kind: 'tool:start'; callId: string; name: string; time: number; input?: unknown; metadata?: Record<string, unknown>; parentStepKey?: string }
  | { kind: 'tool:update'; callId: string; output?: unknown; level?: string; statusMessage?: string }
  | { kind: 'tool:end'; callId: string; time: number }
  | { kind: 'step:start'; key: string; time: number; metadata?: Record<string, unknown> }
  | { kind: 'step:update'; key: string; output?: unknown }
  | { kind: 'step:end'; key: string; time: number }
  | { kind: 'event'; name: string; time: number; input?: unknown; metadata?: Record<string, unknown> }

/** 纯 UI 状态/内部噪音事件：不产生 event observation。DSH 升级时需 review 此列表是否过时。 */
const NOISE_EVENT_TYPES = new Set([
  'todo/write',
  'request/context',
  'session/end-seed',
  'session/title',
  'session/title-llm-request',
  'agent-preset/selected',
  'plan/mode',
  'permission/preset',
  'sandbox/mode',
  'schedule/change',
])

const stepKey = (turn: number | undefined, step: number | undefined): string => `${turn ?? 0}.${step ?? 0}`

/** 从消息类 record 的 data 里尽力取文本内容（兼容多结构）。 */
function pickContent(record: MappingRecord): unknown {
  const d = record.data ?? {}
  const msg = d.message as { content?: unknown; text?: unknown } | undefined
  if (msg && msg.content !== undefined) return msg.content
  if (msg && msg.text !== undefined) return msg.text
  if (d.text !== undefined) return d.text
  if (d.content !== undefined) return d.content
  return undefined
}

/** 提取输出文本与推理链：output 保持纯文本；reasoning 单独返回供 metadata 展示（思维链可追踪）。 */
function extractOutput(content: unknown): { output: unknown; reasoning?: string } {
  if (Array.isArray(content) && content.length > 0) {
    const texts: string[] = []
    const reasonings: string[] = []
    for (const b of content as { type?: string; text?: string }[]) {
      if (b && typeof b.text === 'string') {
        if (b.type === 'text') texts.push(b.text)
        else if (b.type === 'reasoning' || b.type === 'thinking') reasonings.push(b.text)
      }
    }
    if (texts.length > 0) {
      return { output: texts.join('\n'), reasoning: reasonings.length > 0 ? reasonings.join('\n') : undefined }
    }
    if (reasonings.length > 0) return { output: reasonings.join('\n') }
    return { output: content }
  }
  return { output: content }
}

/** 组装本轮完整输入为消息数组（含分类标签 name）；本轮无输入时兜底最近一条用户输入。 */
function buildInput(state: MappingState): unknown {
  const msgs = state.inputMessages.length > 0 ? state.inputMessages : state.lastUserInput !== undefined ? [{ role: 'user', sourceKind: 'user', content: state.lastUserInput }] : []
  if (msgs.length === 0) return undefined
  return msgs.map((m) => {
    const role = m.role === 'system' ? 'system' : 'user'
    let name: string | undefined
    switch (m.sourceKind) {
      case 'user': name = undefined; break
      case 'agent-instructions': name = 'System'; break
      case 'plugin': name = 'context'; break
      case 'session-reference': name = 'recall'; break
      case 'skill-invocation': name = 'skill'; break
      default: name = m.sourceKind || undefined
    }
    return name ? { role, content: m.content, name } : { role, content: m.content }
  })
}

/** DSH 的 TokenUsage 视图。 */
type TokenUsage = NonNullable<MappingRecord['data']>['usage']

/** 把 DSH TokenUsage 汇总成 Langfuse usageDetails（驼峰键）。 */
function toUsage(usage: TokenUsage): UsageDetails | undefined {
  if (!usage) return undefined
  const input = (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  const output = usage.outputTokens ?? 0
  return {
    input,
    output,
    total: input + output,
    ...(usage.reasoningTokens !== undefined ? { output_reasoning: usage.reasoningTokens } : {}),
  }
}

/** 构造根（trace）的 start 指令。 */
function rootStart(ctx: FoldContext, state: MappingState, turn: number | undefined, time: number): Instruction {
  const workspace = ctx.workspace
  return {
    kind: 'root:start',
    turn,
    name: turn !== undefined ? `dsh-turn-${turn}` : 'dsh-session',
    time,
    input: buildInput(state),
    metadata: {
      sessionId: ctx.sessionId,
      workspace,
      tags: workspace ? [workspace] : undefined,
      turn,
    },
    attributes: {
      'langfuse.session.id': ctx.sessionId,
      'langfuse.user.id': ctx.userId,
      'langfuse.environment': ctx.environment,
      // tags 必须是数组（不能 JSON.stringify，原因见 transport 的 setAttribute）
      'langfuse.trace.tags': ['dsh', ctx.environment, workspace].filter(Boolean) as string[],
    },
  }
}

/** 结束一轮：end 所有子观测 + 根，清空状态。 */
export function endTurn(state: MappingState, time: number): Instruction[] {
  const out: Instruction[] = []
  for (const key of state.generations) out.push({ kind: 'generation:end', key, time })
  for (const callId of state.tools) out.push({ kind: 'tool:end', callId, time })
  for (const key of state.steps) out.push({ kind: 'step:end', key, time })
  if (state.hasRoot) {
    out.push({ kind: 'root:update', input: buildInput(state), output: state.lastAssistantOutput })
    out.push({ kind: 'root:end', time })
  }
  state.generations.clear()
  state.tools.clear()
  state.steps.clear()
  state.hasRoot = false
  state.rootTurn = undefined
  // 一轮结束后清掉最后的 assistant 输出，避免下一轮（tool-only turn）误带旧输出
  state.lastAssistantOutput = undefined
  return out
}

/** 把任意事件 data 裁剪成 event observation 的轻量 payload（避免整包塞入产生噪音）。 */
function slimEventData(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data || typeof data !== 'object') return data
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    // 跳过体积大户：消息内容块、chunk 流、usage 明细等
    if (['message', 'content', 'chunk', 'usage', 'arguments', 'output'].includes(k)) continue
    if (v === null || v === undefined) continue
    if (typeof v === 'object') {
      // 嵌套对象只保留一层的标量摘要（error/turn/step 等）
      const nested: Record<string, unknown> = {}
      for (const [nk, nv] of Object.entries(v as Record<string, unknown>)) {
        if (nv !== null && nv !== undefined && (typeof nv === 'string' || typeof nv === 'number' || typeof nv === 'boolean')) {
          nested[nk] = nv
        }
      }
      if (Object.keys(nested).length > 0) out[k] = nested
    } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 折叠一个 record 为指令序列。纯函数：不产生任何副作用，只读 ctx/state/record，
 * 原地更新 state 并返回指令。调用方负责持有 state 并执行指令。
 */
export function foldEvent(ctx: FoldContext, state: MappingState, record: MappingRecord): Instruction[] {
  const { turn, step } = record.data ?? {}

  switch (record.type) {
    case 'turn/start': {
      const out: Instruction[] = []
      if (!state.hasRoot) {
        // 全新一轮（或上一轮已 endTurn）：清掉上一轮残留输入，再建根
        state.inputMessages = []
        out.push(rootStart(ctx, state, turn, record.time))
        state.hasRoot = true
        state.rootTurn = turn
      } else if (turn !== undefined && state.rootTurn !== turn) {
        // 根已存在且轮到新 turn：只有「上一轮已消费过 turn 流」（rootTurn 有值）时才清
        // inputMessages——此时它是上一轮的残留；rootTurn 为 undefined 说明根是 headless
        // 懒建的（user/message 先到），inputMessages 是本轮已累积的输入，不能误清。
        if (state.rootTurn !== undefined) state.inputMessages = []
        out.push({ kind: 'root:update', metadata: { turn } })
        state.rootTurn = turn
      }
      return out
    }
    case 'user/message': {
      const d = record.data ?? {}
      const content = pickContent(record)
      const msg = d.message as { role?: string } | undefined
      const sourceKind = (d as { source?: { kind?: string } }).source?.kind
      if (content !== undefined) {
        state.inputMessages.push({ role: msg?.role ?? 'user', sourceKind, content })
        // 记录最近一条真实用户输入（buildInput 兜底用；plugin/context 等非用户消息不算）
        if (!sourceKind || sourceKind === 'user') state.lastUserInput = content
      }
      if (state.hasRoot) {
        return [{ kind: 'root:update', input: buildInput(state) }]
      }
      // turn/start 尚未到达（headless）：懒建根。rootStart 的 input 已含本条消息。
      state.hasRoot = true
      state.rootTurn = turn
      return [rootStart(ctx, state, turn, record.time)]
    }
    case 'assistant/message': {
      const out: Instruction[] = []
      if (!state.hasRoot) {
        out.push(rootStart(ctx, state, turn, record.time))
        state.hasRoot = true
        state.rootTurn = turn
      }
      out.push(...assistantMessage(state, record, turn, step, ctx))
      return out
    }
    case 'assistant/chunk': {
      // seam 的 Coordinator 已做 chunk 投影（只传每个 (turn,step) 的第一个 chunk 作为
      // 流启动信号，内容完整性由 step 的 assistant/message 保证）——这里无需累积，
      // 直接忽略，避免产生噪音 event observation。
      return []
    }
    case 'tool/call': {
      const out: Instruction[] = []
      if (!state.hasRoot) {
        out.push(rootStart(ctx, state, turn, record.time))
        state.hasRoot = true
        state.rootTurn = turn
      }
      const callId = record.data?.callId ? String(record.data.callId) : undefined
      // 畸形数据防御：DSH 规范数据 callId 必填。缺 callId 时无法与 tool/result 关联、
      // 也无法在 endTurn 中登记兜底，强行发出 tool:start 会留下永不 end 的子观测
      // （transport 侧 TOOL + '' 泄漏）——直接丢弃。
      if (!callId) return []
      const toolName = record.data?.name ?? 'tool'
      const key = stepKey(turn, step)
      out.push({
        kind: 'tool:start',
        callId,
        name: toolName,
        time: record.time,
        input: record.data?.arguments,
        metadata: { turn, step, callId },
        parentStepKey: step !== undefined ? key : undefined,
      })
      state.tools.add(callId)
      return out
    }
    case 'tool/result': {
      const callId = record.data?.callId ? String(record.data.callId) : undefined
      if (!callId || !state.tools.has(callId)) return []
      const content = pickContent(record)
      const out: Instruction[] = []
      if (record.data?.error) {
        out.push({
          kind: 'tool:update',
          callId,
          output: content,
          level: 'ERROR',
          statusMessage: `${record.data.error.name} (${record.data.error.code})`,
        })
      } else {
        out.push({ kind: 'tool:update', callId, output: content })
      }
      out.push({ kind: 'tool:end', callId, time: record.time })
      state.tools.delete(callId)
      return out
    }
    case 'step/start': {
      const out: Instruction[] = []
      if (!state.hasRoot) {
        out.push(rootStart(ctx, state, turn, record.time))
        state.hasRoot = true
        state.rootTurn = turn
      }
      const key = stepKey(turn, step)
      out.push({ kind: 'step:start', key, time: record.time, metadata: { turn, step } })
      state.steps.add(key)
      return out
    }
    case 'step/end': {
      const key = stepKey(turn, step)
      if (!state.steps.has(key)) return []
      state.steps.delete(key)
      return [
        { kind: 'step:update', key, output: state.lastAssistantOutput },
        { kind: 'step:end', key, time: record.time },
      ]
    }
    case 'request/header': {
      state.header = {
        model: record.data?.header?.config?.model,
        provider: record.data?.header?.config?.provider,
      }
      return []
    }
    case 'turn/end': {
      return endTurn(state, record.time)
    }
    default: {
      // 其余扩展事件 → event observation；纯 UI 状态类事件忽略。
      if (!state.hasRoot) return []
      if (NOISE_EVENT_TYPES.has(record.type)) return []
      return [
        {
          kind: 'event',
          name: `event.${record.type}`,
          time: record.time,
          input: slimEventData(record.data),
          metadata: { turn, step },
        },
      ]
    }
  }
}

/** assistant/message 的核心映射（假设 root 已存在）。 */
function assistantMessage(
  state: MappingState,
  record: MappingRecord,
  turn: number | undefined,
  step: number | undefined,
  ctx: FoldContext,
): Instruction[] {
  const key = stepKey(turn, step)
  const message = record.data?.message
  const usage = record.data?.usage
  const model = message?.source?.model ?? state.header?.model ?? 'unknown'
  const provider = message?.source?.provider ?? state.header?.provider
  const { output, reasoning } = extractOutput(pickContent(record))

  const out: Instruction[] = []
  // 同 step 多次 LLM 调用（llm/retry）：先 end 旧 generation，避免永不导出
  if (state.generations.has(key)) {
    out.push({ kind: 'generation:end', key, time: record.time })
  }
  const stepKeyStr = step !== undefined ? key : undefined
  out.push({
    kind: 'generation:start',
    key,
    model,
    time: record.time,
    input: buildInput(state),
    output,
    usageDetails: toUsage(usage),
    prompt: ctx.currentPrompt,
    // reasoning（思维链）单独放 metadata，不污染 output 纯文本
    metadata: { turn, step, ...(provider ? { provider } : {}), ...(reasoning ? { reasoning } : {}) },
    parentStepKey: stepKeyStr,
  })
  state.generations.add(key)
  state.lastAssistantOutput = output
  return out
}
