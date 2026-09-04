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
 *    `agent/status`→idle 是同事件的兜底触发（回看 session.log 取原因），两条路径
 *    按回合号去重，不会双发。
 * 4. 运行诊断写 ~/.dsh/logs/dsh-llm-retry-settings/host.log（低频事件，见 diag）。
 */

import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-llm-retry-settings'

/** 诊断构建标记：写进 host.log，用来确认运行中的到底是哪一版 lib/index.js。 */
const DIAG_TAG = 'v0.1.7-diag1'

/**
 * 文件诊断日志：`~/.dsh/logs/dsh-llm-retry-settings/host.log`。
 *
 * 为什么不用 ctx.logger：本机 desktop.log 只捕获 agent 进程的 console.* 输出
 * （对照 dsh-session-persistence-jsonl 的 `console.error('[dsh-append-guard] …')`），
 * ctx.logger 的 warn/info 不落任何可读文件，排查时等于黑盒——自动续写不生效时
 * 既看不出监听器有没有收到事件，也看不出在哪一步 bail。dsh-model-picker、
 * dsh-vision-router 等第三方插件同样自己往 ~/.dsh/logs/<name>/ 写。
 *
 * 只记低频事件（激活、配置同步、turn/end、续写投递、各类 bail、异常）。
 * 超过 256 KB 重写一次；任何写盘失败都被吞掉——诊断日志不能拖垮插件本体。
 */
const DIAG_MAX_BYTES = 256 * 1024
let diagDir: string | undefined
function diag(message: string): void {
  try {
    if (!diagDir) {
      const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
        ? process.env.DSH_HOME.trim()
        : join(homedir(), '.dsh')
      diagDir = join(home, 'logs', 'dsh-llm-retry-settings')
      mkdirSync(diagDir, { recursive: true })
    }
    const file = join(diagDir, 'host.log')
    const line = `${new Date().toISOString()} ${message}\n`
    try {
      if (statSync(file).size > DIAG_MAX_BYTES) {
        writeFileSync(file, line)
        return
      }
    } catch {
      /* 文件还不存在：走追加 */
    }
    appendFileSync(file, line)
  } catch {
    /* 诊断失败静默 */
  }
}
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
  /** 已因触顶拒绝过（只提示一次，不刷屏）。 */
  capped: boolean
  /** 已处理过的 turn/end 回合号：session/event 与 agent/status 两条触发路径共用，
   *  保证同一次截断最多续写一轮。回合号单调递增，所以它同时就是“上一次已投递”
   *  的标记——不需要额外的 pending 标志（那玩意在只走兜底路径时会永久卡死：
   *  清它的 turn/start 事件同样收不到）。 */
  lastTurn: number
}

/**
 * 从会话日志尾部找最近一条 `turn/end`。
 *
 * 只给 agent/status 兜底路径用：该钩子不带原因，得自己回看日志。最多回看
 * 400 条事件——turn/end 之后紧跟的事件寥寥，再多就说明这个会话不正常，
 * 宁可不续写也不做全量扫描。
 */
function lastTurnEnd(session: any): { turn: number; kind: string } | undefined {
  const log = session?.log
  if (!Array.isArray(log)) return undefined
  for (let i = log.length - 1, floor = Math.max(-1, log.length - 400); i > floor; i -= 1) {
    const event = log[i]
    if (event?.type !== 'turn/end') continue
    return {
      turn: typeof event.data?.turn === 'number' ? event.data.turn : -1,
      kind: typeof event.data?.reason?.kind === 'string' ? event.data.reason.kind : '',
    }
  }
  return undefined
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
  diag(`activate ${DIAG_TAG} inject=[${inject.join(',')}] pid=${process.pid} raw=${JSON.stringify(config ?? null)} live=${JSON.stringify(live)}`)

  /** settings scope 句柄；服务未就绪时为 undefined。事件时刻用它重读现值，
   *  这样即使 scope.watch 因任何原因没回调，配置也不会停留在激活时的旧值。 */
  let scopeRef: { get: () => Partial<Config> } | undefined

  /** 事件/请求时刻的有效配置：优先直接问 settings，失败退回 live 快照。 */
  const current = (): Config => {
    if (scopeRef) {
      try {
        syncFromScope(scopeRef.get())
      } catch (error) {
        diag(`scope.get 失败，沿用 live：${String(error)}`)
      }
    }
    return live
  }

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
      if (!sctx?.settings || typeof sctx.settings.register !== 'function') {
        diag('settings 服务缺少 register，跳过命名空间注册')
        return
      }
      const scope = sctx.settings.register(NS, Config, { base: config || {} })
      scopeRef = scope
      syncFromScope(scope.get())
      diag(`settings registered; resolved=${JSON.stringify(scope.get())}`)
      scope.watch((next: Partial<Config> | undefined) => {
        try {
          syncFromScope(next ?? scope.get())
          diag(`settings sync: autoContinue=${live.autoContinue} maxContinuations=${live.maxContinuations} enabled=${live.enabled}`)
        } catch (error) {
          diag(`settings sync 失败：${String(error)}`)
          ctx.logger.warn('[dsh-llm-retry-settings] 设置同步失败', error)
        }
      })
    } catch (error) {
      diag(`settings register 失败：${String(error)}`)
      ctx.logger.warn('[dsh-llm-retry-settings] settings 注册失败', error)
    }
  })

  // prepend：抢在官方 llm-retry 之前改写 retryPolicy，官方 recover 直接消费覆盖值。
  // retryableCodes 与 provider 默认值取并集（补充不覆盖），让 INVALID_REQUEST 等自定义码生效。
  ctx.on(
    'agent/request-error',
    (payload: { retryPolicy?: any; code?: string; failure?: { code?: string } } | undefined, next: (() => Promise<unknown>) | undefined) => {
      // 事件时刻重读：不依赖 scope.watch 是否回调过（v0.1.7 首发版曾因配置停留在
      // 激活时的旧值而整条链路静默失效，这里连同自动续写一起改成 pull 式）。
      const cfg = current()
      // 诊断锚点：agent/* 钩子能不能到达本插件（本插件的核心功能全靠它）。
      // 若 host.log 里只见这条不见 turn/end 那条，说明 session/event 派发不到我们；
      // 两条都没有则是整个 agent/* 链路的问题（重试覆盖同样失效）。
      diag(`request-error enabled=${cfg.enabled} code=${payload?.code ?? payload?.failure?.code ?? '(n/a)'} keys=${Object.keys(payload ?? {}).join('|')}`)
      if (cfg.enabled && payload && payload.retryPolicy && typeof payload.retryPolicy === 'object') {
        const p = payload.retryPolicy
        const mergedCodes = cfg.retryableCodes.length > 0
          ? [...new Set([...(p.retryableCodes ?? []), ...cfg.retryableCodes])]
          : p.retryableCodes
        payload.retryPolicy = {
          ...p,
          ...(p.mode === 'normal' ? { maxRetries: cfg.maxRetries } : {}),
          ...(mergedCodes ? { retryableCodes: mergedCodes } : {}),
          initialDelayMs: cfg.initialDelayMs,
          maxDelayMs: cfg.maxDelayMs,
          jitterRatio: cfg.jitterRatio,
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
      state = { chain: 0, capped: false, lastTurn: -1 }
      states.set(id, state)
    }
    return state
  }

  /**
   * 一次 turn/end 的唯一处理入口，两条触发路径共用：
   *  - `session/event`（主路径，带原因）
   *  - `agent/status` → idle（兜底路径，回看 session.log 找原因）
   * 兜底路径的存在理由：本插件是 profile 插件，而 session/event 的派发上下文是
   * sessions 服务自己的 ctx（dsh-session/lib/index.js `emitCtx: this.ctx`）；
   * agent/* 系列钩子则走 agent 的 carrier（`agent/request-error` 已验证可达）。
   * 万一 session/event 到不了本插件，idle 这条还能补上，靠 lastTurn 去重不会双发。
   */
  const handleTurnEnd = (session: any, turn: number, kind: string, via: string, agentHint?: any): void => {
    const cfg = current()
    const state = stateOf(String(session.id))
    if (state.lastTurn === turn) return
    state.lastTurn = turn
    if (kind !== 'max-tokens') {
      state.chain = 0
      state.capped = false
      return
    }
    diag(`turn/end via=${via} session=${session.id} turn=${turn} autoContinue=${cfg.autoContinue} maxContinuations=${cfg.maxContinuations} chain=${state.chain}`)
    if (!cfg.autoContinue) return
    if (state.chain >= cfg.maxContinuations) {
      if (!state.capped) {
        state.capped = true
        diag(`bail via=${via}: 连续续写触顶（${state.chain}/${cfg.maxContinuations}）session=${session.id}`)
        ctx.logger.info(
          `[dsh-llm-retry-settings] 会话 ${session.id} 连续续写已达上限（${cfg.maxContinuations} 次），停止自动续写`,
        )
      }
      return
    }
    // agentHint：agent/status 兜底路径已经拿到实例，不必再问注册表，
    // 也就不会被 ctx.agents 是否可用卡住。
    let agent: any = agentHint
    if (!agent) {
      const agents: any = (ctx as any).agents
      if (!agents || typeof agents.get !== 'function') {
        diag(`bail via=${via}: ctx.agents 不可用（inject 未满足？）`)
        return
      }
      agent = agents.get(session.id)
      if (!agent) {
        diag(`bail via=${via}: agents.get(${session.id}) 无实例`)
        return
      }
    }
    // 按 id 比对而非对象引用：resume/fork 之后 store 可能给出同 id 的另一个
    // Session 实例，引用相等会误判成“不是同一个会话”而静默放弃。
    if (agent.session?.id !== session.id) {
      diag(`bail via=${via}: agent.session.id=${agent.session?.id} 与事件 session.id=${session.id} 不符`)
      return
    }
    if (typeof agent.followup !== 'function') {
      diag(`bail via=${via}: agent.followup 不是函数（type=${typeof agent.followup}）`)
      return
    }
    // 先投递再记账：followup 抛错时不该白占一个续写名额。
    // JS 单线程，新回合的 turn/start 只会在本回调返回之后到达。
    agent.followup(makeContinuationMessage())
    state.chain += 1
    diag(`续写已投递 via=${via} session=${session.id} turn=${turn} chain=${state.chain}/${cfg.maxContinuations}`)
  }

  ctx.on(
    'session/event',
    (session: any, event: any) => {
      try {
        if (!session || !event || typeof event.type !== 'string') return
        switch (event.type) {
          case 'user/message': {
            const state = stateOf(String(session.id))
            const source = event.data && event.data.source
            const kind = source && source.kind
            // 真人重新发言 = 旧截断链作废，计数归零
            if (kind === 'user') {
              if (state.chain > 0) diag(`人工发言，重置续写链 session=${session.id} chain=${state.chain}`)
              state.chain = 0
              state.capped = false
              return
            }
            if (kind === 'plugin' && source.plugin === NS) {
              diag(`续写消息已入会话 session=${session.id}`)
            }
            return
          }
          case 'turn/end': {
            const reason = event.data && event.data.reason
            if (!reason || typeof reason.kind !== 'string') return
            handleTurnEnd(session, typeof event.data.turn === 'number' ? event.data.turn : -1, reason.kind, 'session/event')
            return
          }
          default:
            return
        }
      } catch (error) {
        diag(`自动续写处理异常（session/event）：${error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)}`)
        ctx.logger.warn('[dsh-llm-retry-settings] 自动续写处理失败', error)
      }
    },
  )

  // 兜底触发：回合结束且没有后续工作时 agent 转 idle，此时 turn/end 已落日志。
  // 若主路径（session/event）正常，lastTurn 去重会让这里直接 return。
  ctx.on('agent/status', (payload: any) => {
    try {
      if (!payload || payload.status !== 'idle') return
      const session = payload.agent?.session
      if (!session || session.id === undefined) return
      const end = lastTurnEnd(session)
      if (!end) return
      handleTurnEnd(session, end.turn, end.kind, 'agent/status', payload.agent)
    } catch (error) {
      diag(`自动续写处理异常（agent/status）：${String(error)}`)
    }
  })

  // 会话离场即清账本，避免长跑进程里 Map 无界增长
  ctx.on('session/disposed', (session: any) => {
    if (session) states.delete(String(session.id))
  })
}
