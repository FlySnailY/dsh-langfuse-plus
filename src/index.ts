/**
 * dsh-langfuse-plus：把 DeepSeek Harness 会话观测接入 Langfuse。
 *
 * 默认导出是 cordis 后端插件（实现官方 telemetry seam 的 SessionTelemetryBackend）；
 * named exports 覆盖各层模块供组合与测试；client 半经 exports["./client"] 由 DSH 前端加载。
 *
 * @module dsh-langfuse-plus
 */
export { DshLangfuseBackend, type PromptHolder } from './backend.js'
export { resolveConfig, readAnonymousUserId, type Config, type ResolvedConfig } from './config.js'
export {
  createState,
  endTurn,
  foldEvent,
  type FoldContext,
  type Instruction,
  type MappingRecord,
  type MappingState,
  type UsageDetails,
} from './mapping.js'
export { ObservationTransport, type TransportConfig } from './transport.js'

import { DshLangfuseBackend } from './backend.js'
export default DshLangfuseBackend
