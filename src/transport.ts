/**
 * transport 层：消费 mapping 指令，执行真实的 OTel 操作（唯一 import OTel 的模块）。
 * 同时维护 sessionId → traceId 映射（feedback score 关联用）并持有 SDK shutdown。
 *
 * @module dsh-langfuse-plus/transport
 */
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import type { AttributeValue } from '@opentelemetry/api'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import {
  setLangfuseTracerProvider,
  startObservation,
  type LangfuseGeneration,
  type LangfuseSpan,
  type LangfuseTool,
  type ObservationLevel,
} from '@langfuse/tracing'
import type { Instruction } from './mapping.js'

/** transport 初始化所需的 Langfuse 连接配置。 */
export interface TransportConfig {
  publicKey: string
  secretKey: string
  baseUrl: string
  /**
   * 部署环境标签。Langfuse 服务端在子 span 触发 trace-update 时会用该 span 的
   * attributes 重新提取 trace.environment（缺省 fallback 'default' 并覆盖根 span 的值），
   * 因此所有 observation 都必须带 environment，否则 trace.environment 恒为 default。
   */
  environment: string
}

/**
 * observation 的 key 前缀，避免不同类型同名冲突：
 * generation 用 `gen:${turn.step}`，tool 用 `tool:${callId}`，step 用 `step:${turn.step}`。
 */
const GEN = 'gen:'
const TOOL = 'tool:'
const STEP = 'step:'

/**
 * 模块级：@langfuse/tracing 的 provider 是模块级单例。记录「本插件进程内已设置的 provider」，
 * 仅真实二次构造（HMR 重叠/重复安装）才告警——不能依赖 getLangfuseTracerProvider() 判断
 * （未 set 时返回全局 ProxyTracerProvider，恒非空，会导致单实例也误报）。
 */
let installedProvider: BasicTracerProvider | null = null

export class ObservationTransport {
  private readonly provider: BasicTracerProvider
  private readonly environment: string
  private readonly roots = new Map<string, LangfuseSpan>()
  /** 嵌套结构 sessionId → (key → span)，会话销毁时可按 sessionId 整组清理。 */
  private readonly observations = new Map<string, Map<string, LangfuseSpan>>()
  private readonly traceIds = new Map<string, string>()

  constructor(config: TransportConfig) {
    this.environment = config.environment
    // 用隔离 provider（不注册全局，避免抢占宿主进程其它 OTel 使用），经
    // setLangfuseTracerProvider 让 @langfuse/tracing 的 startObservation 使用它。
    if (installedProvider) {
      // 真实多实例/HMR 重叠：先建实例的 span 将路由到新 provider 且其 shutdown 关不到
      // 它——fail-loud 暴露。
      console.warn(
        '[dsh-langfuse-plus] another backend instance already owns the Langfuse tracer provider — ' +
          'its subsequent spans will route to this new provider (HMR overlap or duplicate install?)',
      )
    }
    this.provider = new BasicTracerProvider({
      spanProcessors: [
        new LangfuseSpanProcessor({
          publicKey: config.publicKey,
          secretKey: config.secretKey,
          baseUrl: config.baseUrl,
        }),
      ],
    })
    setLangfuseTracerProvider(this.provider)
    installedProvider = this.provider
  }

  /** 执行一批指令（backend 在 emit 热路径上调用，必须非阻塞）。 */
  apply(sessionId: string, instructions: Instruction[]): void {
    for (const ins of instructions) this.execute(sessionId, ins)
  }

  traceIdFor(sessionId: string): string | undefined {
    return this.traceIds.get(sessionId)
  }

  /** 会话销毁时清理该会话全部状态（root span、observations、traceId 映射，防无界泄漏）。 */
  clearSession(sessionId: string): void {
    this.roots.delete(sessionId)
    this.observations.delete(sessionId)
    this.traceIds.delete(sessionId)
  }

  /** 排空 SDK（backend 的 shutdown 转发到这里）。 */
  async shutdown(): Promise<void> {
    try {
      await this.provider.shutdown()
    } finally {
      // 无论 flush 是否抛错都要释放 installedProvider，否则异常路径残留旧引用，
      // 后续实例会被误判为「二次构造」。
      if (installedProvider === this.provider) {
        installedProvider = null
        // 撤销 @langfuse/tracing 的 isolated provider（支持 null 清除），避免全部实例
        // dispose 后进程内残留指向已关闭 provider 的引用；仅自己是「最后一个」时执行。
        setLangfuseTracerProvider(null)
      }
    }
  }

  /** 获取（或创建）某会话的 observation 子 map（嵌套结构按会话隔离）。 */
  private obsFor(sessionId: string): Map<string, LangfuseSpan> {
    let m = this.observations.get(sessionId)
    if (!m) {
      m = new Map()
      this.observations.set(sessionId, m)
    }
    return m
  }

  private execute(sessionId: string, ins: Instruction): void {
    switch (ins.kind) {
      case 'root:start': {
        const root = startObservation(
          ins.name,
          { input: ins.input, metadata: ins.metadata, environment: this.environment },
          { asType: 'span', startTime: new Date(ins.time) },
        ) as LangfuseSpan
        for (const [k, v] of Object.entries(ins.attributes)) {
          // tags 等数组值直接作为 OTel 数组 attribute（服务端按数组解析），
          // 不能 JSON.stringify——字符串会被按逗号错误拆分。
          root.otelSpan.setAttribute(k, v as AttributeValue)
        }
        this.roots.set(sessionId, root)
        const tc = root.otelSpan.spanContext()
        if (tc?.traceId) this.traceIds.set(sessionId, tc.traceId)
        return
      }
      case 'root:update': {
        const root = this.roots.get(sessionId)
        root?.update({ input: ins.input, output: ins.output, metadata: ins.metadata })
        return
      }
      case 'root:end': {
        const root = this.roots.get(sessionId)
        root?.end(ins.time)
        this.roots.delete(sessionId)
        return
      }
      case 'generation:start': {
        const owner = this.parentSpan(sessionId, ins.parentStepKey)
        if (!owner) return
        // 用模块级 startObservation + parentSpanContext（实例方法的 options 不含 startTime），
        // 保证 record.time 作为子观测的 start 时间（重放时间正确）。
        const gen = startObservation(
          `llm.${ins.model}`,
          {
            model: ins.model,
            input: ins.input,
            output: ins.output,
            // 所有 observation 都带 environment（原因见 TransportConfig.environment）
            environment: this.environment,
            // mapping 的 UsageDetails 是无索引签名的具名可选字段，需断言成
            // Langfuse 期望的 `{ [key: string]: number }`（值均为 number，断言安全）
            usageDetails: ins.usageDetails as { [key: string]: number } | undefined,
            // Langfuse prompt 字段要求 isFallback（必填）
            prompt: ins.prompt ? { ...ins.prompt, isFallback: false } : undefined,
            metadata: ins.metadata,
          },
          {
            asType: 'generation',
            startTime: new Date(ins.time),
            parentSpanContext: owner.otelSpan.spanContext(),
          },
        ) as LangfuseGeneration
        this.obsFor(sessionId).set(GEN + ins.key, gen)
        return
      }
      case 'generation:end': {
        const gen = this.observations.get(sessionId)?.get(GEN + ins.key)
        gen?.end(ins.time)
        this.observations.get(sessionId)?.delete(GEN + ins.key)
        return
      }
      case 'tool:start': {
        const owner = this.parentSpan(sessionId, ins.parentStepKey)
        if (!owner) return
        const tool = startObservation(
          `tool.${ins.name}`,
          // LangfuseToolAttributes 无 name 字段（tool 名通过 observation 名称体现），放入 metadata
          { input: ins.input, metadata: { ...ins.metadata, name: ins.name }, environment: this.environment },
          {
            asType: 'tool',
            startTime: new Date(ins.time),
            parentSpanContext: owner.otelSpan.spanContext(),
          },
        ) as LangfuseTool
        this.obsFor(sessionId).set(TOOL + ins.callId, tool)
        return
      }
      case 'tool:update': {
        const tool = this.observations.get(sessionId)?.get(TOOL + ins.callId)
        tool?.update({ output: ins.output, level: ins.level as ObservationLevel, statusMessage: ins.statusMessage })
        return
      }
      case 'tool:end': {
        const tool = this.observations.get(sessionId)?.get(TOOL + ins.callId)
        tool?.end(ins.time)
        this.observations.get(sessionId)?.delete(TOOL + ins.callId)
        return
      }
      case 'step:start': {
        const root = this.roots.get(sessionId)
        if (!root) return
        const span = startObservation(
          `step-${ins.key}`,
          { metadata: ins.metadata, environment: this.environment },
          {
            asType: 'span',
            startTime: new Date(ins.time),
            parentSpanContext: root.otelSpan.spanContext(),
          },
        ) as LangfuseSpan
        this.obsFor(sessionId).set(STEP + ins.key, span)
        return
      }
      case 'step:update': {
        const span = this.observations.get(sessionId)?.get(STEP + ins.key)
        span?.update({ output: ins.output })
        return
      }
      case 'step:end': {
        const span = this.observations.get(sessionId)?.get(STEP + ins.key)
        span?.end(ins.time)
        this.observations.get(sessionId)?.delete(STEP + ins.key)
        return
      }
      case 'event': {
        const root = this.roots.get(sessionId)
        if (!root) return
        startObservation(
          ins.name,
          { input: ins.input, metadata: ins.metadata, environment: this.environment },
          {
            asType: 'event',
            startTime: new Date(ins.time),
            parentSpanContext: root.otelSpan.spanContext(),
          },
        )
        return
      }
    }
  }

  /** generation/tool 的父 span：有 step 挂 step，否则挂根。 */
  private parentSpan(sessionId: string, parentStepKey?: string): LangfuseSpan | undefined {
    if (parentStepKey !== undefined) {
      const step = this.observations.get(sessionId)?.get(STEP + parentStepKey)
      if (step) return step
    }
    return this.roots.get(sessionId)
  }
}
