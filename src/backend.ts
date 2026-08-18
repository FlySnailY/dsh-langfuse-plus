/**
 * dsh-langfuse-plus backend：实现官方 telemetry seam 的 SessionTelemetryBackend。
 *
 * 经 SessionTelemetryCoordinator 捕获会话事件（consent / chunk 投影 / HMR cursor /
 * shutdown 兜底；redaction 是可选的 record waterfall 扩展点，未挂规则时原样透传），
 * 交由 mapping → transport 折叠成 OTel span 树；feedback/record 单独走 REST 推 score；
 * Prompt 双向桥 / /dataset 经 install 函数挂载。
 *
 * @module dsh-langfuse-plus/backend
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  SessionTelemetryBackend,
  SessionTelemetryCoordinator,
  type SessionTelemetryRecord,
  type SessionTelemetrySharingStatus,
} from '@deepseek-ai/dsh-session-telemetry'
import { createState, endTurn, foldEvent, type FoldContext, type MappingState, type MappingRecord } from './mapping.js'
import { ObservationTransport } from './transport.js'
import { Config, resolveConfig, type Config as PluginConfig, type ResolvedConfig } from './config.js'
import { installPrompt } from './prompt.js'
import { installDataset } from './dataset.js'

/** 当前 Langfuse prompt（prompt.ts 更新，mapping 读取以关联 generation）。 */
export interface PromptHolder {
  current: { name: string; version: number } | null
}

function toMappingRecord(r: SessionTelemetryRecord): MappingRecord {
  return {
    type: String(r.attributes['event.type'] ?? ''),
    time: r.time,
    severity: r.severity,
    data: r.body as MappingRecord['data'],
  }
}

export class DshLangfuseBackend extends SessionTelemetryBackend {
  static inject = ['sessions']
  static Config = Config

  readonly sharing: SessionTelemetrySharingStatus
  private readonly transport?: ObservationTransport
  private readonly states = new Map<string, MappingState>()
  private readonly config: ResolvedConfig
  private readonly promptHolder: PromptHolder = { current: null }
  private readonly authHeader: string

  constructor(ctx: Context, rawConfig: PluginConfig) {
    super(ctx)
    this.config = resolveConfig(rawConfig)
    this.authHeader = `Basic ${Buffer.from(`${this.config.publicKey}:${this.config.secretKey}`).toString('base64')}`
    // sharing 披露必须与实际行为一致：缺凭据时不上报，披露为 disabled，避免
    // /feedback 确认文本谎称「完整共享」
    this.sharing = this.config.enabled && this.config.publicKey && this.config.secretKey ? 'full' : 'disabled'

    if (!this.config.enabled || !this.config.publicKey || !this.config.secretKey) {
      // fail-loud：明确告知用户插件被禁用及原因，绝不静默
      const missing = [this.config.enabled ? '' : 'enabled=false', !this.config.publicKey ? 'publicKey' : '', !this.config.secretKey ? 'secretKey' : '']
        .filter(Boolean)
        .join(', ')
      console.error(
        `[dsh-langfuse-plus] plugin DISABLED — missing/invalid: ${missing}. ` +
          'Set DSH_LANGFUSE_PUBLIC_KEY / DSH_LANGFUSE_SECRET_KEY (or enabled: true) in cordis.patch.yml / env. Traces will NOT be sent.',
      )
      return
    }

    this.transport = new ObservationTransport({
      publicKey: this.config.publicKey,
      secretKey: this.config.secretKey,
      baseUrl: this.config.baseUrl,
      environment: this.config.environment,
    })

    // live 捕获：Coordinator 直接以本 backend 为 sink（emit/shutdown 是 seam 抽象实现），
    // 自动注册 session/created、session/event、agent/error，自动 sweep 已活会话（HMR），
    // 并在 dispose 时捕获 shutdown marker + 转发 shutdown。
    new SessionTelemetryCoordinator(ctx, this, 'live')

    installPrompt(ctx, this.config, this.promptHolder)
    installDataset(ctx, this.config, this)
    this.selfCheck()
  }

  /** /dataset 命令读取会话映射状态。 */
  stateFor(sessionId: string): MappingState | undefined {
    return this.states.get(sessionId)
  }

  /** feedback score 关联最近一轮 trace 用。 */
  traceIdFor(sessionId: string): string | undefined {
    return this.transport?.traceIdFor(sessionId)
  }

  /** seam 的 emit 入口（Coordinator 在热路径上同步调用，必须非阻塞）。 */
  emit(record: SessionTelemetryRecord): void {
    this.onRecord(record)
  }

  /** 排空 SDK（Coordinator dispose 时转发到这里）。 */
  async shutdown(): Promise<void> {
    await this.transport?.shutdown()
  }

  private onRecord(record: SessionTelemetryRecord): void {
    const sessionId = String(record.attributes['session.id'] ?? '')
    // 归因守卫：无 session.id 的 record 无法挂到任何 trace，丢弃
    if (!sessionId) return

    // ops 通道：只处理 shutdown marker——会话销毁（重启/HMR/异常退出）时兜底 end 该
    // 会话的 root span（若未随 turn/end 结束），并**无条件清理该会话的状态与 trace 映射**
    // （否则正常结束的会话 hasRoot=false 时不会被清理，states Map 无界泄漏）。
    if (record.channel !== 'ledger') {
      if (record.attributes['telemetry.op'] === 'shutdown') {
        const state = this.states.get(sessionId)
        if (state) {
          if (state.hasRoot) this.transport?.apply(sessionId, endTurn(state, record.time))
          this.states.delete(sessionId)
        }
        this.transport?.clearSession(sessionId)
      }
      return
    }

    // feedback/record：REST 推 score（副作用，非 span 映射），不经过 mapping 层
    if (String(record.attributes['event.type']) === 'feedback/record') {
      this.onFeedback(sessionId, record)
      return
    }

    const state = this.states.get(sessionId) ?? createState()
    const foldCtx: FoldContext = {
      sessionId,
      userId: this.config.userId,
      environment: this.config.environment,
      workspace:
        typeof record.attributes['session.cwd'] === 'string' ? record.attributes['session.cwd'] : undefined,
      currentPrompt: this.promptHolder.current ?? undefined,
    }
    const instructions = foldEvent(foldCtx, state, toMappingRecord(record))
    this.transport?.apply(sessionId, instructions)
    this.states.set(sessionId, state)
  }

  private onFeedback(sessionId: string, record: SessionTelemetryRecord): void {
    const text = String((record.body as { text?: unknown })?.text ?? '').trim()
    if (!text) return
    const traceId = this.transport?.traceIdFor(sessionId)
    // 幂等 id：sessionId + event.seq 确定性生成。Coordinator 在 adopt/重放历史时会再次
    // 投递历史的 feedback/record（cursor 后所有事件类型都重放），带同 id 的重复 POST
    // 会被 Langfuse upsert（score id 为唯一键，同 id 不产生重复 score）。
    const seq = record.attributes['event.seq']
    // 优先关联最近一轮 trace；无 traceId（重启后）降级挂 sessionId。
    fetch(`${this.config.baseUrl}/api/public/scores`, {
      method: 'POST',
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `dsh-feedback-${sessionId}-${String(seq ?? Date.now())}`,
        name: 'user_feedback',
        value: 1,
        dataType: 'NUMERIC',
        ...(traceId ? { traceId } : { sessionId }),
        comment: text,
      }),
      // 超时纪律与其余 fetch 一致（selfCheck / prompt / dataset 均有限时）
      signal: AbortSignal.timeout(8000),
    })
      .then((res) => {
        if (!res.ok) console.error(`[dsh-langfuse-plus] score POST failed: HTTP ${res.status}`)
      })
      .catch((error) => console.error('[dsh-langfuse-plus] score POST error:', error))
  }

  /** 启动自检：key 格式校验 + 一次连通性探测。fail-loud 一次，不阻断观测。 */
  private selfCheck(): void {
    const { publicKey, secretKey, baseUrl } = this.config
    if (!publicKey.startsWith('lf_pk_') || !secretKey.startsWith('lf_sk_')) {
      console.error(
        '[dsh-langfuse-plus] WARNING: 凭据格式异常（应为 lf_pk_ / lf_sk_ 开头），trace 上报很可能失败；请检查 DSH_LANGFUSE_PUBLIC_KEY / DSH_LANGFUSE_SECRET_KEY',
      )
    }
    fetch(`${baseUrl}/api/public/health`, {
      headers: { Authorization: this.authHeader },
      signal: AbortSignal.timeout(5000),
    })
      .then((res) => {
        if (!res.ok) console.error(`[dsh-langfuse-plus] Langfuse health check failed: HTTP ${res.status}`)
        else console.log('[dsh-langfuse-plus] Langfuse connectivity OK')
      })
      .catch((error) => console.error(`[dsh-langfuse-plus] Langfuse connectivity check failed: ${(error as Error).message}`))
  }
}
