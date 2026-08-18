/**
 * Prompt 双向桥（system-prompt/assemble waterfall）：
 * 下行（next 前）拉 Langfuse production prompt 替换 DSH persona 段，15s TTL 缓存（含负缓存）；
 * 上行（next 后）把当前 persona 发布到 Langfuse（missing 或内容不同才发布，in-flight 去重），
 * fire-and-forget，不阻塞组装关键路径。
 *
 * @module dsh-langfuse-plus/prompt
 */
import type { ResolvedConfig } from './config.js'
import type { PromptHolder } from './backend.js'

/** installPrompt 需要的 ctx 最小视图：只订阅扩展事件 system-prompt/assemble（不在 cordis Events 类型里，故用宽松接口）。 */
interface PromptContext {
  on(event: string, handler: (assembly: any, context: any, next: () => Promise<any>) => Promise<any> | void): void
}

type PromptFetchResult =
  | { status: 'ok'; prompt: { name: string; version: number; prompt: string } }
  | { status: 'missing' }
  | { status: 'error' }

/** 注册双向桥。config.promptEnabled 为 false 时不注册任何东西。 */
export function installPrompt(ctx: PromptContext, config: ResolvedConfig, promptHolder: PromptHolder): void {
  if (!config.promptEnabled) return

  const authHeader = `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')}`
  const lfFetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
    return fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: authHeader, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(8000),
    })
  }

  const fetchPrompt = async (): Promise<PromptFetchResult> => {
    try {
      const res = await lfFetch(`/api/public/v2/prompts/${config.promptName}?label=${config.promptLabel}`)
      if (res.status === 404) return { status: 'missing' }
      if (!res.ok) return { status: 'error' }
      const p = await res.json()
      if (p?.prompt && typeof p.prompt === 'string' && p.prompt.length > 0) {
        return { status: 'ok', prompt: { name: p.name, version: p.version, prompt: p.prompt } }
      }
      return { status: 'missing' }
    } catch {
      return { status: 'error' }
    }
  }
  const publishPrompt = async (text: string): Promise<boolean> => {
    try {
      const res = await lfFetch('/api/public/v2/prompts', {
        method: 'POST',
        body: JSON.stringify({ name: config.promptName, type: 'text', prompt: text, labels: [config.promptLabel] }),
      })
      return res.ok
    } catch (error) {
      console.error('[dsh-langfuse-plus] publishPrompt failed (ignored):', error)
      return false
    }
  }
  // in-flight 去重：只合并「相同文本」的并发发布（不同文本各自独立发布，
  // 避免第二个 persona 文本被第一个的飞行 Promise 吞掉）。
  let pendingPublish: { text: string; promise: Promise<boolean> } | null = null
  const publishPromptDeduped = (text: string): Promise<boolean> => {
    if (pendingPublish?.text === text) return pendingPublish.promise
    const promise = (async () => {
      try {
        const existing = await fetchPrompt()
        if (existing.status === 'error') return false
        if (existing.status === 'ok' && existing.prompt.prompt === text) return true
        return await publishPrompt(text)
      } finally {
        if (pendingPublish?.text === text) pendingPublish = null
      }
    })()
    pendingPublish = { text, promise }
    return promise
  }

  // 下行缓存（含负缓存）：Langfuse 慢/不可达时，15s 内只阻塞一次。
  let promptCache: { result: PromptFetchResult; at: number } | null = null
  const PROMPT_CACHE_TTL_MS = 15_000
  const getPromptCached = async (): Promise<PromptFetchResult> => {
    const now = Date.now()
    if (promptCache && now - promptCache.at < PROMPT_CACHE_TTL_MS) return promptCache.result
    const result = await fetchPrompt()
    promptCache = { result, at: Date.now() }
    return result
  }

  ctx.on(
    'system-prompt/assemble',
    async (assembly: any, _context: any, next: () => Promise<any>) => {
      // 下行：定位 persona 段并替换为 Langfuse prompt；无可用 prompt 时清空 generation 关联
      let personaIndex = -1
      let originalPersona = ''
      if (Array.isArray(assembly?.sections)) {
        personaIndex = assembly.sections.findIndex((s: any) => s?.name === 'deployment:persona')
        if (personaIndex >= 0) originalPersona = String(assembly.sections[personaIndex].text ?? '')
      }

      const fetched = await getPromptCached()
      const prompt = fetched.status === 'ok' ? fetched.prompt : null
      if (prompt && personaIndex >= 0) {
        promptHolder.current = { name: prompt.name, version: prompt.version }
        assembly.sections[personaIndex].text = prompt.prompt
      } else {
        promptHolder.current = null
      }

      const result = await next()

      if (
        originalPersona &&
        (fetched.status === 'missing' || (fetched.status === 'ok' && fetched.prompt.prompt !== originalPersona))
      ) {
        void publishPromptDeduped(originalPersona)
      }

      return result
    },
  )
}
