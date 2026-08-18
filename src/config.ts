/**
 * 配置层：schemastery schema（Cordis 校验 + 默认值）+ resolveConfig 规范化。
 * env 覆盖在 cordis.patch.yml 的 `!!js process.env.X` 层完成，schema 只负责校验与默认值。
 *
 * @module dsh-langfuse-plus/config
 */
import z from '@deepseek-ai/schemastery'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 插件配置（schema 校验后字段完整）。 */
export interface Config {
  enabled: boolean
  baseUrl: string
  publicKey: string
  secretKey: string
  environment: string
  promptName: string
  promptEnabled: boolean
  promptLabel: string
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  baseUrl: z.string().default('http://localhost:3000'),
  publicKey: z.string().default(''),
  secretKey: z.string().default(''),
  environment: z.string().default('development'),
  promptName: z.string().default('dsh-system-prompt'),
  promptEnabled: z.boolean().default(true),
  promptLabel: z.string().default('production'),
})

/** 解析后的运行配置（含匿名用户 id）。 */
export interface ResolvedConfig extends Config {
  userId: string
}

/** 读取匿名用户 id（与 DSH 的 harness home 解析一致：$DSH_HOME > ~/.dsh）。 */
export function readAnonymousUserId(): string {
  try {
    const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
    const file = join(home, '.anonymous-user-id')
    return existsSync(file) ? readFileSync(file, 'utf8').trim() : 'dsh-anonymous'
  } catch {
    return 'dsh-anonymous'
  }
}

export function resolveConfig(config: Config): ResolvedConfig {
  return {
    ...config,
    baseUrl: config.baseUrl.replace(/\/$/, ''),
    userId: readAnonymousUserId(),
  }
}
