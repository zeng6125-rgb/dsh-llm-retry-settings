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

/** 默认补充码：400 reasoning_text（INVALID_REQUEST，OpenAI thinking 模式冲突）与
 *  pi-ai 兜底错误（PI_AI_ERROR，覆盖 STREAM_ERROR 等流式失败）。 */
const DEFAULT_RETRYABLE_CODES = ['INVALID_REQUEST', 'PI_AI_ERROR']

/** 全部默认值——schema default、归一化兜底两处共用的唯一事实源（客户端卡片另有镜像）。 */
export const DEFAULTS = {
  enabled: false,
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  jitterRatio: 0.1,
  retryableCodes: [...DEFAULT_RETRYABLE_CODES],
} as const

export interface Config {
  enabled: boolean
  maxRetries: number
  initialDelayMs: number
  maxDelayMs: number
  jitterRatio: number
  /** 补充到重试码列表的额外 code，与 provider 默认值取并集（不覆盖）。空数组=不补充。 */
  retryableCodes: string[]
}

export const Config = z.object({
  enabled: z.boolean().default(DEFAULTS.enabled),
  maxRetries: z.number().step(1).min(0).default(DEFAULTS.maxRetries),
  initialDelayMs: z.number().min(1).default(DEFAULTS.initialDelayMs),
  maxDelayMs: z.number().min(1).default(DEFAULTS.maxDelayMs),
  jitterRatio: z.number().min(0).max(1).default(DEFAULTS.jitterRatio),
  retryableCodes: z.array(z.string()).default([...DEFAULT_RETRYABLE_CODES]),
})

// —— 归一化：schema 之外的第二道防线（settings base 传入的是未校验裸值）——

const normCodes = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string' && c.length > 0) : []

/** 字段收敛器：类型不符返回 undefined，由调用方决定回退到现值还是默认值。 */
const asBool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
const asInt = (v: unknown, min: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.floor(v)) : undefined
const asFloat = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined

/** 裸值收敛成合法 Config：越界夹紧、类型不符回退默认、非法码过滤、退避下限封顶。 */
function normalizeConfig(raw: Partial<Config> | undefined | null): Config {
  const cfg: Config = {
    enabled: asBool(raw?.enabled) ?? DEFAULTS.enabled,
    maxRetries: asInt(raw?.maxRetries, 0) ?? DEFAULTS.maxRetries,
    initialDelayMs: asInt(raw?.initialDelayMs, 1) ?? DEFAULTS.initialDelayMs,
    maxDelayMs: asInt(raw?.maxDelayMs, 1) ?? DEFAULTS.maxDelayMs,
    jitterRatio: asFloat(raw?.jitterRatio, 0, 1) ?? DEFAULTS.jitterRatio,
    retryableCodes: Array.isArray(raw?.retryableCodes) ? normCodes(raw.retryableCodes) : [...DEFAULT_RETRYABLE_CODES],
  }
  if (cfg.initialDelayMs > cfg.maxDelayMs) cfg.initialDelayMs = cfg.maxDelayMs
  return cfg
}

export function apply(ctx: Context, config: Partial<Config> | undefined): void {
  const live: Config = normalizeConfig(config)

  // scope.watch 回调：字段级叠加——给出且类型合法的字段才覆盖，其余保留现值
  const syncFromScope = (next: Partial<Config> | undefined | null): void => {
    if (!next || typeof next !== 'object') return
    Object.assign(
      live,
      normalizeConfig({
        enabled: asBool(next.enabled) ?? live.enabled,
        maxRetries: asInt(next.maxRetries, 0) ?? live.maxRetries,
        initialDelayMs: asInt(next.initialDelayMs, 1) ?? live.initialDelayMs,
        maxDelayMs: asInt(next.maxDelayMs, 1) ?? live.maxDelayMs,
        jitterRatio: asFloat(next.jitterRatio, 0, 1) ?? live.jitterRatio,
        retryableCodes: Array.isArray(next.retryableCodes) ? next.retryableCodes : live.retryableCodes,
      }),
    )
  }

  // 与 dsh-thinking-compact 同款：ctx.inject(['settings']) + settings.register 直连，
  // 服务可用后注册命名空间并开始 live 同步（scope.watch 即时回调）。
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
  // retryableCodes 与 provider 默认值取并集（补充不覆盖），让 INVALID_REQUEST 等自定义码生效。
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
