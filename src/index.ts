/**
 * dsh-llm-retry-settings — 宿主半边
 *
 * 1. 注册设置命名空间 `dsh-llm-retry`（schema 校验 + 持久化 + live 同步），
 *    客户端卡片绑定同一命名空间读写。
 * 2. 用 prepend 在 `agent/request-error` 监听器链最前端改写 retryPolicy：
 *    官方 @deepseek-ai/dsh-llm-retry 的 recover 会拿到覆盖后的策略——
 *    额外 retryableCodes 与 provider 内置列表并集合并，次数/退避/抖动直接覆盖。
 *    enabled=false（默认）时完全旁路，不改任何东西。
 * 3. autoContinue=true 时监听 `session/event` 的 `turn/end`，凡 reason.kind ===
 *    'max-tokens'（输出 token 上限截断）就替用户 `agent.followup()` 补一轮续写，
 *    每个会话最多连续 maxContinuations 次。默认关闭。
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-llm-retry-settings'
// agents：取 session 对应的 Agent 实例下 followup；sessions：接收 session/event 流。
export const inject = ['settings', 'agents', 'sessions']

const NS = 'dsh-llm-retry'

/** 续写指令：作为 user-role 消息进入模型上下文，故措辞要能独立成立。
 *  source.kind='plugin' 让客户端把它渲染成 inject 上下文行（标签 = NS），
 *  而不是伪装成用户气泡。 */
const CONTINUATION_TEXT =
  '上一条回复因达到输出 token 上限被截断。请从中断处直接继续输出，不要重复已经输出的内容，也不要重新开头。'

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
  autoContinue: false,
  maxContinuations: 2,
} as const

export interface Config {
  enabled: boolean
  maxRetries: number
  initialDelayMs: number
  maxDelayMs: number
  jitterRatio: number
  /** 补充到重试码列表的额外 code，与 provider 默认值取并集（不覆盖）。空数组=不补充。 */
  retryableCodes: string[]
  /** 输出被 token 上限截断时自动补一轮续写。 */
  autoContinue: boolean
  /** 单个会话内连续自动续写的次数上限（0 = 永不续写）。 */
  maxContinuations: number
}

export const Config = z.object({
  enabled: z.boolean().default(DEFAULTS.enabled),
  maxRetries: z.number().step(1).min(0).default(DEFAULTS.maxRetries),
  initialDelayMs: z.number().min(1).default(DEFAULTS.initialDelayMs),
  maxDelayMs: z.number().min(1).default(DEFAULTS.maxDelayMs),
  jitterRatio: z.number().min(0).max(1).default(DEFAULTS.jitterRatio),
  retryableCodes: z.array(z.string()).default([...DEFAULT_RETRYABLE_CODES]),
  autoContinue: z.boolean().default(DEFAULTS.autoContinue),
  maxContinuations: z.number().step(1).min(0).default(DEFAULTS.maxContinuations),
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
    autoContinue: asBool(raw?.autoContinue) ?? DEFAULTS.autoContinue,
    maxContinuations: asInt(raw?.maxContinuations, 0) ?? DEFAULTS.maxContinuations,
  }
  if (cfg.initialDelayMs > cfg.maxDelayMs) cfg.initialDelayMs = cfg.maxDelayMs
  return cfg
}

/** 一个会话的自动续写账本。 */
interface ContinueState {
  /** 本轮截断链上已经补了几次续写。 */
  chain: number
  /** 已 followup 但尚未被 loop 认领（防同一次截断叠加两条）。 */
  pending: boolean
  /** 已因触顶拒绝过（只提示一次，不刷屏）。 */
  capped: boolean
}

/**
 * 手工构造续写用的 UserMessage。
 *
 * 不用 `createUserMessage`（@deepseek-ai/dsh-llm）：宿主 bundle 以 `bundle:true`
 * 构建，引入该包会把整个 dsh-llm 打进来（本插件 package.json 无 dependencies，
 * 运行时也无法按裸标识符解析到它）。产物形状与 createUserMessage({content,source})
 * 一致——id/role/content/source 四字段 + 深冻结，Session.append 的 isJsonValue
 * 运行时校验只要求 JSON 可序列化。
 */
function makeContinuationMessage(): unknown {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text: CONTINUATION_TEXT })]),
    source: Object.freeze({ kind: 'plugin', plugin: NS }),
  })
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
        autoContinue: asBool(next.autoContinue) ?? live.autoContinue,
        maxContinuations: asInt(next.maxContinuations, 0) ?? live.maxContinuations,
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

  // —— 自动续写：输出 token 上限截断的补救 ——
  //
  // 为什么不能走 agent/request-error：max-tokens 根本不是错误。适配器把 stop_reason
  // "length" 映射成 { kind: 'max-tokens' }（dsh-llm-pi-ai/lib/index.js:1371、
  // dsh-llm-deepseek/lib/index.js:1135），agent-loop 只是结束回合
  // （dsh-agent-loop/lib/index.js:698 → :570 → :606 append "turn/end"），
  // 请求本身是成功返回的，所以重试链路永远看不到它。
  //
  // 为什么不在 agent/turn-stopping 里 steer：该钩子 payload 只有 {agent,turn,signal}，
  // 拿不到结束原因，无法区分“正常说完”和“被截断”，steer 会变成无限续写。
  //
  // session/event 是 post-commit 追加流，构造期种子（resume/fork/replay）不发射
  // （dsh-session/lib/index.js:1282 “constructor seeds do not emit”），
  // 因此重新打开一个历史上被截断过的旧会话不会触发续写。
  const states = new Map<string, ContinueState>()
  const stateOf = (id: string): ContinueState => {
    let state = states.get(id)
    if (!state) {
      state = { chain: 0, pending: false, capped: false }
      states.set(id, state)
    }
    return state
  }

  ctx.on(
    'session/event',
    (session: any, event: any) => {
      try {
        if (!live.autoContinue || !session || !event || typeof event.type !== 'string') return
        const state = stateOf(String(session.id))
        switch (event.type) {
          case 'turn/start':
            // 新一轮已开跑：我们的排队意图不再“待认领”。若 followup 被取消丢弃，
            // 不清这个标志会永久卡住该会话的续写能力。
            state.pending = false
            return
          case 'user/message': {
            const source = event.data && event.data.source
            const kind = source && source.kind
            // 真人重新发言 = 旧截断链作废，计数归零
            if (kind === 'user') {
              state.chain = 0
              state.pending = false
              state.capped = false
              return
            }
            if (kind === 'plugin' && source.plugin === NS) state.pending = false
            return
          }
          case 'turn/end': {
            const reason = event.data && event.data.reason
            if (!reason || typeof reason.kind !== 'string') return
            if (reason.kind !== 'max-tokens') {
              state.chain = 0
              state.pending = false
              state.capped = false
              return
            }
            if (state.pending) return
            if (state.chain >= live.maxContinuations) {
              if (!state.capped) {
                state.capped = true
                ctx.logger.info(
                  `[dsh-llm-retry-settings] 会话 ${session.id} 连续续写已达上限（${live.maxContinuations} 次），停止自动续写`,
                )
              }
              return
            }
            const agents: any = (ctx as any).agents
            const agent = agents && typeof agents.get === 'function' ? agents.get(session.id) : undefined
            if (!agent || agent.session !== session || typeof agent.followup !== 'function') return
            // 先投递再记账：followup 抛错时不该白占一个续写名额。
            // JS 单线程，新回合的 turn/start 只会在本回调返回之后到达。
            agent.followup(makeContinuationMessage())
            state.chain += 1
            state.pending = true
            return
          }
          default:
            return
        }
      } catch (error) {
        ctx.logger.warn('[dsh-llm-retry-settings] 自动续写处理失败', error)
      }
    },
  )

  // 会话离场即清账本，避免长跑进程里 Map 无界增长
  ctx.on('session/disposed', (session: any) => {
    if (session) states.delete(String(session.id))
  })
}
