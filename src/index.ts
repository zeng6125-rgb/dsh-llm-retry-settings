/**
 * dsh-llm-retry-settings — 宿主半边
 *
 * 1. 注册设置命名空间 `dsh-llm-retry`（schema 校验 + 持久化 + live 同步），
 *    客户端卡片绑定同一命名空间读写。
 * 2. 用 prepend 在 `agent/request-error` 监听器链最前端改写 retryPolicy：
 *    官方 @deepseek-ai/dsh-llm-retry 的 recover 会拿到覆盖后的策略——
 *    额外 retryableCodes 与 provider 内置列表并集合并，次数/退避/抖动直接覆盖。
 *    enabled=false（默认）时完全旁路，不改任何东西。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-llm-retry-settings'
export const inject = ['settings']

const NS = 'dsh-llm-retry'

export interface Config {
  enabled: boolean
  maxRetries: number
  initialDelayMs: number
  maxDelayMs: number
  jitterRatio: number
  /** 补充到重试码列表的额外 code,与 provider 默认值合并(不去重覆盖)。空数组=不补充。 */
  retryableCodes: string[]
}

export const Config = z.object({
  enabled: z.boolean().default(false),
  maxRetries: z.number().step(1).min(0).default(2),
  initialDelayMs: z.number().min(1).default(500),
  maxDelayMs: z.number().min(1).default(10000),
  jitterRatio: z.number().min(0).max(1).default(0.1),
  // 内置默认补充码：400 reasoning_text（INVALID_REQUEST）与 pi-ai 兜底错误
  // （PI_AI_ERROR，覆盖 STREAM_ERROR 等流式失败）。开启 enabled 即自动拦截重试，
  // 用户可在设置卡片追加/清空。
  retryableCodes: z.array(z.string()).default(['INVALID_REQUEST', 'PI_AI_ERROR']),
})

function resolveConfig(config: Partial<Config> | undefined): Config {
  const rc = config?.retryableCodes
  return {
    enabled: config?.enabled ?? false,
    maxRetries: Math.max(0, Math.floor(config?.maxRetries ?? 2)),
    initialDelayMs: Math.max(1, Math.floor(config?.initialDelayMs ?? 500)),
    maxDelayMs: Math.max(1, Math.floor(config?.maxDelayMs ?? 10000)),
    jitterRatio: Math.min(1, Math.max(0, config?.jitterRatio ?? 0.1)),
    retryableCodes: Array.isArray(rc) ? rc.filter((c) => typeof c === 'string' && c.length > 0) : ['INVALID_REQUEST', 'PI_AI_ERROR'],
  }
}

export function apply(ctx: Context, config: Partial<Config> | undefined): void {
  const live: Config = resolveConfig(config)

  const syncFromScope = (next: Partial<Config> | undefined | null): void => {
    if (!next || typeof next !== 'object') return
    if (typeof next.enabled === 'boolean') live.enabled = next.enabled
    if (typeof next.maxRetries === 'number') live.maxRetries = Math.max(0, Math.floor(next.maxRetries))
    if (typeof next.initialDelayMs === 'number') live.initialDelayMs = Math.max(1, Math.floor(next.initialDelayMs))
    if (typeof next.maxDelayMs === 'number') live.maxDelayMs = Math.max(1, Math.floor(next.maxDelayMs))
    if (typeof next.jitterRatio === 'number') live.jitterRatio = Math.min(1, Math.max(0, next.jitterRatio))
    if (Array.isArray(next.retryableCodes)) {
      live.retryableCodes = next.retryableCodes.filter((c: unknown) => typeof c === 'string' && c.length > 0) as string[]
    }
    if (live.initialDelayMs > live.maxDelayMs) live.initialDelayMs = live.maxDelayMs
  }

  // 与 dsh-thinking-compact 同款：ctx.inject(['settings']) + settings.register 直连。
  // settings 服务可用后注册命名空间并开始 live 同步（scope.watch 即时回调）。
  ctx.inject(['settings'], (sctx: any) => {
    try {
      const scope = sctx.settings.register(NS, Config, { base: config || {} })
      syncFromScope(scope.get())
      scope.watch(() => {
        try {
          syncFromScope(scope.get())
        } catch (error) {
          ctx.logger.warn('[dsh-llm-retry-settings] 设置同步失败', error)
        }
      })
    } catch (error) {
      ctx.logger.warn('[dsh-llm-retry-settings] settings 注册失败', error)
    }
  })

  // prepend：抢在官方 llm-retry 之前改写 retryPolicy，官方 recover 直接消费覆盖值。
  ctx.on(
    'agent/request-error',
    (payload: { retryPolicy?: any } | undefined, next: (() => Promise<unknown>) | undefined) => {
      if (live.enabled && payload && payload.retryPolicy && typeof payload.retryPolicy === 'object') {
        const p = payload.retryPolicy
        const mergedCodes = live.retryableCodes.length > 0
          ? [...new Set([...(p.retryableCodes ?? []), ...live.retryableCodes])]
          : p.retryableCodes
        payload.retryPolicy = {
          ...p,
          ...(p.mode === 'normal' ? { maxRetries: live.maxRetries } : {}),
          ...(mergedCodes ? { retryableCodes: mergedCodes } : {}),
          initialDelayMs: live.initialDelayMs,
          maxDelayMs: live.maxDelayMs,
          jitterRatio: live.jitterRatio,
        }
      }
      return next ? next() : undefined
    },
    { prepend: true },
  )
}
