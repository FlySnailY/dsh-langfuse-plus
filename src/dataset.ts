/**
 * /dataset 命令：把最近一轮 trace 一键加入 Langfuse dataset
 * （input=用户输入、expectedOutput=回复、sourceTraceId=最近一轮 trace）。
 * 后续实验运行/evaluator 由 Langfuse UI 原生承担。
 *
 * @module dsh-langfuse-plus/dataset
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ResolvedConfig } from './config.js'
import type { DshLangfuseBackend } from './backend.js'

function extractPlainText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const texts: string[] = []
    for (const b of content as { type?: string; text?: string }[]) {
      if (b && b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    }
    if (texts.length > 0) return texts.join('\n')
  }
  return ''
}

function extractUserInput(state: { inputMessages: { role?: string; sourceKind?: string; content: unknown }[] }): string {
  const userMsgs = state.inputMessages.filter((m) => m.sourceKind === 'user')
  if (userMsgs.length > 0) return extractPlainText(userMsgs[userMsgs.length - 1].content)
  if (state.inputMessages.length > 0) return extractPlainText(state.inputMessages[state.inputMessages.length - 1].content)
  return ''
}

/** 注册 /dataset 命令（惰性获取 commands 服务，缺失则跳过）。 */
export function installDataset(ctx: Context, config: ResolvedConfig, backend: DshLangfuseBackend): void {
  try {
    const commands = ctx.get?.('commands')
    if (typeof commands?.register !== 'function') return
    const authHeader = `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')}`

    commands.register({
      name: 'dataset',
      description: 'add the latest trace to a Langfuse dataset (for evaluation)',
      input: { hint: '[name]' },
      recordInput: false,
      handler: async (invocation: any) => {
        const session = invocation.agent?.session
        if (!session) return { kind: 'error', text: 'No active session.' }
        const sessionId = String(session.id)
        const state = backend.stateFor(sessionId)
        if (!state) return { kind: 'error', text: 'No active session state.' }
        const datasetName = String(invocation.rawInput ?? '').trim() || 'dsh-dataset'

        const input = extractUserInput(state)
        const expectedOutput = extractPlainText(state.lastAssistantOutput)
        if (!input && !expectedOutput) {
          return { kind: 'error', text: 'No completed turn yet. Chat first, then run /dataset.' }
        }
        // input 兜底：本轮无真实用户输入（如 tool-only 轮）时，回退到最近一条用户输入，
        // 避免 dataset item 的 input 为空被服务端拒绝或产生不完整条目。
        const inputForItem = input || extractPlainText(state.lastUserInput) || undefined

        try {
          // 1) 确保 dataset 存在（幂等：name 已存在时返回 409，视为成功；其余失败报错）
          const createRes = await fetch(`${config.baseUrl}/api/public/v2/datasets`, {
            method: 'POST',
            headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: datasetName }),
            signal: AbortSignal.timeout(8000),
          })
          if (createRes.status !== 409 && !createRes.ok) {
            return { kind: 'error', text: `Failed to create dataset: HTTP ${createRes.status}` }
          }
          // 2) 加 item（sourceTraceId 有则关联原始 trace；只查一次，避免重复调用）
          const sourceTraceId = backend.traceIdFor(sessionId)
          const res = await fetch(`${config.baseUrl}/api/public/dataset-items`, {
            method: 'POST',
            headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              datasetName,
              input: inputForItem,
              expectedOutput: expectedOutput || undefined,
              ...(sourceTraceId ? { sourceTraceId } : {}),
            }),
            signal: AbortSignal.timeout(8000),
          })
          if (!res.ok) return { kind: 'error', text: `Failed to add dataset item: HTTP ${res.status}` }
          return { kind: 'success', text: `Added to dataset "${datasetName}".\nInput: ${(inputForItem || '(empty)').slice(0, 80)}` }
        } catch (error) {
          return { kind: 'error', text: `Dataset error: ${(error as Error).message}` }
        }
      },
    })
  } catch (error) {
    console.error('[dsh-langfuse-plus] dataset command registration failed (ignored):', error)
  }
}
