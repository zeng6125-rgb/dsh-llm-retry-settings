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
 *    'max-tokens'（输出 token 上限截断）就替用户补一轮续写：等 `agent.whenIdle()`
 *    之后 `agent.followup()`（时机细节见 handleTurnEnd 注释），
 *    每个会话最多连续 maxContinuations 次。默认关闭。
 *    续写指令来自设置页的 `continuationPrompt`：用户可按自己的 provider/model
 *    自定义；为空时使用内置默认文案，并对所有自动续写场景生效。
 *    `agent/status`→idle 是同事件的兜底触发（回看 session.log 取原因），两条路径
 *    按回合号去重，不会双发。
 * 4. 运行诊断写 ~/.dsh/logs/dsh-llm-retry-settings/host.log（低频事件，见 diag）。
 * 5. 只读观测路由（客户端卡片的观测面板拉取，不轮询不推送）：
 *    GET /dsh-llm-retry-settings/stats  内存计数 + 最近记录 + 当前生效配置 + 会话模型
 *    GET /dsh-llm-retry-settings/log?tail=N  host.log 尾部
 *    另外支持 overrides[]（provider/model 通配覆盖）与 continueOnError（瞬时错误也续写）。
 */

import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import zBundled from '@deepseek-ai/schemastery'

export const name = 'dsh-llm-retry-settings'

/**
 * 内核自适应 schemastery（2026-09-22，DSH 0.1.7-alpha.1 双版本适配）。
 *
 * 为什么不能只用 esbuild 打进 lib/index.js 的那份：`.volatile()`（0.1.7 设置表单唯一认的
 * 字段标记，dsh-settings `describe() → volatileForm()`）是 schemastery **3.18.3** 才有的；
 * 0.1.6-alpha.2 装机树里是 3.18.2。打包副本在构建时就固定了，内核升级不会让它变新。
 *
 * 所以优先取「运行时内核目录里的那一份」：
 *   0.1.6 → 3.18.2（无 volatile ⇒ vol() 退化为 no-op，行为与旧版逐字一致）
 *   0.1.7 → 3.18.3（有 volatile ⇒ 设置表单与 live 引用生效）
 * 取不到（本插件是发布到 GitHub 的独立包，用户环境没有 DSH 树时）退回打包副本。
 */
const z: typeof zBundled = (() => {
  try {
    const req = createRequire(import.meta.url)
    const live: any = req('@deepseek-ai/schemastery')
    const cand = live?.default ?? live
    if (cand && typeof cand.object === 'function' && typeof cand.string === 'function') return cand
  } catch {
    /* 运行时没有内核那份 schemastery：用打包副本 */
  }
  return zBundled
})()

/**
 * 0.1.6 的 schemastery 3.18.2 没有 `.volatile()`，硬调会 TypeError ⇒ 守卫成 no-op。
 *
 * ⚠ 必须是 no-op，不能退化成「写 meta.volatile」：0.1.7 的 loader 会因此把该字段判为
 * volatile-only 更新，而 3.18.2 的 resolve 不产生引用对象 ⇒ `_commitVolatile()` 走
 * `refs.length === 0 → return true`，用户的写入被静默吞掉（表单变好看但改不动）。
 */
const vol = <T>(f: T): T => (typeof (f as any).volatile === 'function' ? (f as any).volatile() : f)

/**
 * 0.1.7 的 volatile 字段解析结果是 cosmokit 的引用对象（`Symbol.for('cosmokit.volatile.write')`
 * 协议，可跨 ESM/CJS 副本识别），取值要 `.get()`；0.1.6 是裸值 ⇒ 本函数是恒等变换。
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')
const unvol = <T>(v: T): T =>
  v && typeof v === 'object' && VOLATILE_WRITE in (v as any) && typeof (v as any).get === 'function'
    ? ((v as any).get() as T)
    : v

/** 诊断构建标记：写进 host.log，用来确认运行中的到底是哪一版 lib/index.js。 */
const DIAG_TAG = 'v0.1.12'

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
/** 插件日志目录：DSH_HOME（默认 ~/.dsh）下的 logs/dsh-llm-retry-settings。 */
const LOG_DIR = (() => {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(home, 'logs', 'dsh-llm-retry-settings')
})()
/** host.log 绝对路径：同时由 settings 的 base 层以只读 logPath 暴露给客户端卡片。 */
const LOG_FILE = join(LOG_DIR, 'host.log')
/** 同一模式在这个窗口内重复只记一次（限流风暴里 request-error 会刷屏）。 */
const DIAG_DEDUPE_MS = 5000
/** 已知的日志字节数；-1 = 还没 stat 过。 */
let diagBytes = -1
let diagLastMessage = ''
let diagLastAt = 0
let diagSuppressed = 0
/** 最近一次已知「有没有功能开着」；false 时热路径完全不写盘。 */
let diagActive = true
/** 关闭态下被丢掉的诊断行数，重新开启时补一行说明。 */
let diagDropped = 0

/** 由 apply() 的 current()/syncFromScope 在配置变化时同步（见 setDiagActive）。 */
function setDiagActive(active: boolean): void {
  if (active === diagActive) return
  diagActive = active
  if (active && diagDropped > 0) {
    const dropped = diagDropped
    diagDropped = 0
    diagLastMessage = ''
    diag(`（功能重新开启：此前关闭期间省略了 ${dropped} 行诊断）`)
  }
}

function diag(message: string): void {
  // 两个功能都关着时热路径不写盘（启用后会记一行说明，不会让日志看起来断档）
  if (!diagActive) {
    diagDropped += 1
    return
  }
  const now = Date.now()
  if (message === diagLastMessage && now - diagLastAt < DIAG_DEDUPE_MS) {
    diagSuppressed += 1
    return
  }
  const note = diagSuppressed > 0 ? `（${diagSuppressed} 次重复已省略）` : ''
  diagSuppressed = 0
  diagLastMessage = message
  diagLastAt = now
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    const line = `${new Date().toISOString()} ${note}${message}\n`
    const bytes = Buffer.byteLength(line)
    if (diagBytes < 0) {
      try {
        diagBytes = statSync(LOG_FILE).size
      } catch {
        diagBytes = 0
      }
    }
    if (diagBytes > DIAG_MAX_BYTES) {
      writeFileSync(LOG_FILE, line)
      diagBytes = bytes
      return
    }
    appendFileSync(LOG_FILE, line)
    diagBytes += bytes
  } catch {
    /* 诊断失败静默 */
  }
}

/** 配置摘要：host.log 要能看出配置对不对，但不必塞进整段 JSON。 */
const summaryOf = (cfg: Config): string =>
  `enabled=${cfg.enabled} codes=${cfg.retryableCodes.length} maxRetries=${cfg.maxRetries}` +
  ` backoff=${cfg.initialDelayMs}~${cfg.maxDelayMs}ms jitter=${cfg.jitterRatio}` +
  ` autoContinue=${cfg.autoContinue} maxContinuations=${cfg.maxContinuations}` +
  ` continueOnError=${cfg.continueOnError} overrides=${cfg.overrides.length}`

// —— 观测数据（只在内存；HTTP 只读暴露，绝不写回设置文件）——
const STATS_PATH = '/dsh-llm-retry-settings/stats'
const LOG_ROUTE_PATH = '/dsh-llm-retry-settings/log'
/** 最近记录环形缓冲上限。 */
const RECENT_MAX = 50
/** 会话账本/模型缓存上限（防长跑进程无界增长）。 */
const STATE_MAX = 200

interface StatEntry {
  /** 事件时刻（ms）。 */
  t: number
  /** retry=请求失败被重试链路接管；continue=自动续写已投递；cap=续写触顶；skip=因 inbox 忙跳过。 */
  kind: 'retry' | 'continue' | 'cap' | 'skip'
  code?: string
  provider?: string
  model?: string
  turn?: number
  delayMs?: number
}

const stats = {
  startedAt: Date.now(),
  retries: 0,
  continues: 0,
  capped: 0,
  skipped: 0,
  byCode: {} as Record<string, number>,
  byProvider: {} as Record<string, number>,
  recent: [] as StatEntry[],
}

const bump = (bag: Record<string, number>, key: string): void => {
  if (key !== '') bag[key] = (bag[key] ?? 0) + 1
}
const pushStat = (entry: StatEntry): void => {
  stats.recent.push(entry)
  while (stats.recent.length > RECENT_MAX) stats.recent.shift()
}

/** agent.inbox 是否已有待处理消息（用户自己排队/steer 的输入）。 */
const inboxBusy = (agent: any): boolean => {
  const inbox = agent?.inbox
  if (!inbox) return false
  const size = (arr: any): number => (Array.isArray(arr) ? arr.length : 0)
  return size(inbox.nextTurn) > 0 || size(inbox.nextStep) > 0
}

/** continueOnError=true 时值得再补一轮的瞬时错误码；确定性错误（参数/内容/凭证）不补。 */
const TRANSIENT_CONTINUE_CODES = new Set([
  'PI_AI_ERROR',
  'TRANSPORT',
  'TIMEOUT',
  'SERVER',
  'EMPTY_RESPONSE',
  'STREAM_CLOSED',
  'MALFORMED_RESPONSE',
  'INVALID_RESPONSE',
  'PI_AI_NOT_WARMED',
  'UNKNOWN',
])
// agents：取 session 对应的 Agent 实例下 followup；sessions：接收 session/event 流。
export const inject = ['settings', 'agents', 'sessions']

/** 0.1.6 的设置命名空间；0.1.7 起命名空间 = **profile entry id**（见 ENTRY_ID）。 */
const NS = 'dsh-llm-retry'

/** 0.1.7（SettingsForms）下的设置命名空间键 = profile entry id（cordis.patch.yml 的 `id:`）。 */
const ENTRY_ID = 'llm-retry-settings'

/** 默认续写指令：用户可在设置页以 continuationPrompt 覆盖。 */
const DEFAULT_CONTINUATION_PROMPT =
  '上一条回复因达到输出 token 上限被截断。请从中断处直接继续输出，不要重复已经输出的内容，也不要重新开头。'

/** 默认补充码：400 reasoning_text（INVALID_REQUEST，OpenAI thinking 模式冲突）与
 *  pi-ai 兜底错误（PI_AI_ERROR，覆盖 STREAM_ERROR 等流式失败）。 */
const DEFAULT_RETRYABLE_CODES = ['INVALID_REQUEST', 'PI_AI_ERROR']

/** 单条 provider/model 覆盖；数值字段 -1 表示继承全局值（避免 schema 里的可选字段歧义）。 */
export interface PolicyOverride {
  provider: string
  model: string
  maxRetries: number
  initialDelayMs: number
  maxDelayMs: number
  jitterRatio: number
}
/** 覆盖行里「继承全局」的哨兵值。 */
const OVERRIDE_INHERIT = -1
/** 覆盖行数量上限（防手滑粘贴一大坨）。 */
const OVERRIDE_MAX_ROWS = 20

/** 通配匹配：空串与 * 都是「任意」，其余支持 *（大小写不敏感）。编译结果缓存复用。 */
const globCache = new Map<string, RegExp>()
const globMatch = (pattern: string, value: string): boolean => {
  const p = (pattern ?? '').trim().toLowerCase()
  if (p === '' || p === '*') return true
  const v = (value ?? '').toLowerCase()
  if (!p.includes('*')) return p === v
  let rx = globCache.get(p)
  if (rx === undefined) {
    const escaped = p
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')
    rx = new RegExp(`^${escaped}$`)
    if (globCache.size > 64) globCache.clear()
    globCache.set(p, rx)
  }
  return rx.test(v)
}

/**
 * 第一条命中的覆盖行。model 未知（宿主还没见到 request/context）时只匹配 provider ——
 * 写了具体 model 的行不会「盲中」，宁可回退全局值也不猜。
 */
const matchOverride = (rows: PolicyOverride[], provider: string, model: string): PolicyOverride | undefined =>
  rows.find((row) => {
    if (!row) return false
    const rowModel = (row.model ?? '').trim()
    if (!globMatch(row.provider, provider)) return false
    if (rowModel === '' || rowModel === '*') return true
    return model !== '' && globMatch(rowModel, model)
  })

/** 覆盖行收敛：丢掉空行、trim、哨兵值兜底、数量封顶。 */
const normOverrides = (raw: unknown, fallback: PolicyOverride[]): PolicyOverride[] => {
  if (!Array.isArray(raw)) return fallback.map((row) => ({ ...row }))
  const out: PolicyOverride[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Partial<PolicyOverride>
    const provider = typeof row.provider === 'string' ? row.provider.trim() : ''
    const model = typeof row.model === 'string' ? row.model.trim() : ''
    if (provider === '' && model === '') continue
    out.push({
      provider: provider === '' ? '*' : provider,
      model: model === '' ? '*' : model,
      maxRetries: asInt(row.maxRetries, OVERRIDE_INHERIT) ?? OVERRIDE_INHERIT,
      initialDelayMs: asInt(row.initialDelayMs, OVERRIDE_INHERIT) ?? OVERRIDE_INHERIT,
      maxDelayMs: asInt(row.maxDelayMs, OVERRIDE_INHERIT) ?? OVERRIDE_INHERIT,
      jitterRatio: asFloat(row.jitterRatio, OVERRIDE_INHERIT, 1) ?? OVERRIDE_INHERIT,
    })
  }
  return out.slice(0, OVERRIDE_MAX_ROWS)
}

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
  continuationPrompt: '',
  /** 瞬时错误（重试彻底失败）也自动续写一轮；默认关闭。 */
  continueOnError: false,
  /** provider/model 级策略覆盖；空数组 = 全部沿用全局值。 */
  overrides: [] as PolicyOverride[],
  /** 只读：宿主日志绝对路径。0.1.7 configure 分支不再有 base 注入 → 默认值直接给真实路径（卡片 hostStale 判据 = 它非空）。 */
  logPath: LOG_FILE,
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
  /** 自动续写发送给模型的提示词；空字符串表示使用 DEFAULT_CONTINUATION_PROMPT。 */
  continuationPrompt: string
  /** 会话因瞬时错误结束时也自动续写一轮（确定性错误不续写）。 */
  continueOnError: boolean
  /** provider/model 级策略覆盖，按顺序取第一条命中；数值 -1 = 继承全局值。 */
  overrides: PolicyOverride[]
  /** 只读：宿主日志的绝对路径（base 层注入，UI 用它打开日志）。 */
  logPath: string
}

/**
 * Config：0.1.7 的设置表单只渲染 `.volatile()` 过的字段（`volatileForm()` 过滤，
 * 一个 volatile 字段都没有 ⇒ describe() 里本 entry 0 行 ⇒ 设置分区空白）。
 *
 * volatile 的粒度注意：schemastery 校验「volatile 字段须是固定对象路径、不能嵌套在另一个
 * volatile 字段内」，且 `volatileForm` 只下钻 z.object（数组节点不下钻）——所以：
 *   - 顶层标量逐个 vol()；
 *   - overrides 整块作为**一个** volatile 字段（不逐项 vol，避免嵌套叠加）。
 * 0.1.6 走 vol() 的 no-op 分支，schema 与旧版完全一致。
 */
export const Config = z.object({
  enabled: vol(z.boolean().default(DEFAULTS.enabled)),
  maxRetries: vol(z.number().step(1).min(0).default(DEFAULTS.maxRetries)),
  initialDelayMs: vol(z.number().min(1).default(DEFAULTS.initialDelayMs)),
  maxDelayMs: vol(z.number().min(1).default(DEFAULTS.maxDelayMs)),
  jitterRatio: vol(z.number().min(0).max(1).default(DEFAULTS.jitterRatio)),
  retryableCodes: vol(z.array(z.string()).default([...DEFAULT_RETRYABLE_CODES])),
  autoContinue: vol(z.boolean().default(DEFAULTS.autoContinue)),
  maxContinuations: vol(z.number().step(1).min(0).default(DEFAULTS.maxContinuations)),
  continuationPrompt: vol(z.string().default(DEFAULTS.continuationPrompt)),
  continueOnError: vol(z.boolean().default(DEFAULTS.continueOnError)),
  overrides: vol(
    z
      .array(
        z.object({
          provider: z.string().default('*'),
          model: z.string().default('*'),
          maxRetries: z.number().step(1).min(OVERRIDE_INHERIT).default(OVERRIDE_INHERIT),
          initialDelayMs: z.number().step(1).min(OVERRIDE_INHERIT).default(OVERRIDE_INHERIT),
          maxDelayMs: z.number().step(1).min(OVERRIDE_INHERIT).default(OVERRIDE_INHERIT),
          jitterRatio: z.number().min(OVERRIDE_INHERIT).max(1).default(OVERRIDE_INHERIT),
        }),
      )
      .default([]),
  ),
  logPath: vol(z.string().default(DEFAULTS.logPath)),
})

// —— 归一化：schema 之外的第二道防线（settings base 传入的是未校验裸值）——

const normCodes = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string' && c.length > 0) : []

/** 字段收敛器：类型不符返回 undefined，由调用方决定回退到现值还是默认值。
 *  0.1.7 的 volatile 字段是引用对象，先 unvol 解引用（0.1.6 是恒等变换）。 */
const asBool = (v: unknown): boolean | undefined => {
  const x = unvol(v)
  return typeof x === 'boolean' ? x : undefined
}
const asInt = (v: unknown, min: number): number | undefined => {
  const x = unvol(v)
  return typeof x === 'number' && Number.isFinite(x) ? Math.max(min, Math.floor(x)) : undefined
}
const asFloat = (v: unknown, min: number, max: number): number | undefined => {
  const x = unvol(v)
  return typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : undefined
}

/** DEFAULTS 的 Config 视图：DEFAULTS 是 as const，数组需先解掉 readonly 才能当回退值。 */
const DEFAULTS_CONFIG: Config = { ...DEFAULTS, retryableCodes: [...DEFAULTS.retryableCodes] }

/**
 * 字段级收敛的唯一实现：raw 中类型合法的字段覆盖 fallback，其余保留 fallback。
 *
 * 两个调用点共用这一张字段表，新增字段只改这里一处，不会再出现「改了
 * normalizeConfig 忘了 syncFromScope」的漏改（v0.1.7 首发版正是这么漏的）。
 * 越界夹紧、类型不符回退、非法码过滤、退避下限封顶都在此统一完成。
 */
function coerceConfig(raw: Partial<Config> | undefined | null, fallback: Config): Config {
  // 非 asBool/asInt/asFloat 覆盖的字段同样要先解引用（0.1.7 volatile 引用对象）。
  const codes = unvol(raw?.retryableCodes)
  const prompt = unvol(raw?.continuationPrompt)
  const overridesRaw = unvol(raw?.overrides)
  const logPath = unvol(raw?.logPath)
  const cfg: Config = {
    enabled: asBool(raw?.enabled) ?? fallback.enabled,
    maxRetries: asInt(raw?.maxRetries, 0) ?? fallback.maxRetries,
    initialDelayMs: asInt(raw?.initialDelayMs, 1) ?? fallback.initialDelayMs,
    maxDelayMs: asInt(raw?.maxDelayMs, 1) ?? fallback.maxDelayMs,
    jitterRatio: asFloat(raw?.jitterRatio, 0, 1) ?? fallback.jitterRatio,
    retryableCodes: Array.isArray(codes) ? normCodes(codes) : [...fallback.retryableCodes],
    autoContinue: asBool(raw?.autoContinue) ?? fallback.autoContinue,
    maxContinuations: asInt(raw?.maxContinuations, 0) ?? fallback.maxContinuations,
    continuationPrompt: typeof prompt === 'string' ? prompt : fallback.continuationPrompt,
    continueOnError: asBool(raw?.continueOnError) ?? fallback.continueOnError,
    overrides: normOverrides(overridesRaw, fallback.overrides),
    logPath: typeof logPath === 'string' && logPath !== '' ? logPath : fallback.logPath,
  }
  if (cfg.initialDelayMs > cfg.maxDelayMs) cfg.initialDelayMs = cfg.maxDelayMs
  return cfg
}

/** 裸值收敛成合法 Config（回退值取内置默认）。 */
function normalizeConfig(raw: Partial<Config> | undefined | null): Config {
  return coerceConfig(raw, DEFAULTS_CONFIG)
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
function lastTurnEnd(session: any): { turn: number; kind: string; code?: string } | undefined {
  const log = session?.log
  if (!Array.isArray(log)) return undefined
  const read = (index: number): { turn: number; kind: string; code?: string } | undefined => {
    const event = log[index]
    if (event?.type !== 'turn/end') return undefined
    const reason = event.data?.reason
    const code = reason?.error?.code ?? reason?.error?.failure?.code ?? reason?.failure?.code
    return {
      turn: typeof event.data?.turn === 'number' ? event.data.turn : -1,
      kind: typeof reason?.kind === 'string' ? reason.kind : '',
      code: typeof code === 'string' ? code : undefined,
    }
  }
  // 兜底路径每次 idle 都会调用：turn/end 几乎总在尾部，先扫 24 条，未命中才放宽到 400。
  const near = Math.max(0, log.length - 24)
  for (let i = log.length - 1; i >= near; i -= 1) {
    const hit = read(i)
    if (hit) return hit
  }
  const far = Math.max(0, log.length - 400)
  for (let i = near - 1; i >= far; i -= 1) {
    const hit = read(i)
    if (hit) return hit
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
function makeContinuationMessage(text: string): unknown {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    // 2026-09-23 第 65 轮：V4 写入校验拒绝 kind:'plugin'（V3 旧语法）——
  // 第三方生产者必须写 'plugin:<NS>'，否则续写投递时 SessionFormatError:
  // format v4 message requires a producer-owned source kind（用户可见为「本轮运行失败」）。
  source: Object.freeze({ kind: 'plugin:' + NS }),
  })
}

/**
 * 回合内模型有没有输出过可见正文（text 块非空）——**仅供诊断**。
 *
 * max-tokens 的截断点有两种（实测 session.v2 日志两类都出现过）：
 *  - 正文被截断（text 有内容）→ 历史里有可见的「中断处」；
 *  - 思考被截断（只有 reasoning 块，text 全程为空）→ 可见中断处不存在。
 *
 * 曾据此发两种不同的续写指令，**已废弃**：全量对比 75 个手动停止样本，其中
 * 45 个同样没有正文，却照样能接上；真正决定能否接上的是 provider/model 中转
 * 是否回显上一段思考，与本函数无关。故这里只把 text=yes/no 写进 host.log，
 * 供用户自定义续写提示词时判断措辞。
 *
 * 在 session.log 里按 seq 倒序找：从 turn/end 往回到同回合的 turn/start 为止，
 * 检查 assistant/message 的 content。找不到 turn/start 就继续往前扫（最多 800
 * 条）。拿不到 log（非数组）时返回 true——诊断字段宁可信其有。
 * 事件对象来自内存 session.log，不落盘解析，无性能顾虑。
 */
function visibleTextBeforeTurnEnd(session: any, turn: number): boolean {
  const log = session?.log
  if (!Array.isArray(log)) return true
  const hasText = (content: any): boolean =>
    Array.isArray(content) && content.some((part: any) => part?.type === 'text' && typeof part.text === 'string' && part.text.trim() !== '')
  for (let i = log.length - 1, floor = Math.max(-1, log.length - 120); i > floor; i -= 1) {
    const event = log[i]
    if (!event || typeof event.type !== 'string') continue
    if (event.type === 'turn/start' && event.data?.turn === turn) return false
    if (event.type === 'assistant/message' && hasText(event.data?.message?.content ?? event.data?.content)) return true
  }
  return false
}

export function apply(ctx: Context, config: Partial<Config> | undefined): void {
  const live: Config = normalizeConfig(config)
  diag(`activate ${DIAG_TAG} pid=${process.pid} inject=[${inject.join(',')}] ${summaryOf(live)}`)

  /** settings scope 句柄；服务未就绪时为 undefined。事件时刻用它重读现值，
   *  这样即使 scope.watch 因任何原因没回调，配置也不会停留在激活时的旧值。 */
  let scopeRef: { get: () => Partial<Config> } | undefined

  /** 上一次收敛过的原始 resolved 引用：settings 只在 commit 时换对象，
   *  引用没变就跳过整表收敛（事件热路径上零分配）。 */
  let lastRaw: Partial<Config> | null = null

  /** 事件/请求时刻的有效配置：优先直接问 settings，失败退回 live 快照。 */
  const current = (): Config => {
    if (scopeRef) {
      try {
        const raw = scopeRef.get()
        if (raw !== lastRaw) syncFromScope(raw)
      } catch (error) {
        diag(`scope.get 失败，沿用 live：${String(error)}`)
      }
    }
    return live
  }

  // scope.watch 回调 / 事件时刻重读：字段级叠加——给出且类型合法的字段才覆盖，其余保留现值
  const syncFromScope = (next: Partial<Config> | undefined | null): void => {
    if (!next || typeof next !== 'object') return
    lastRaw = next
    Object.assign(live, coerceConfig(next, live))
    // 两个功能都关着 → 诊断日志静默（热路径零 I/O）；任一开启 → 正常记录。
    setDiagActive(live.enabled || live.autoContinue)
  }

  /** 会话 → 最近一次请求的 provider/model（request/context、request/header 携带），
   *  给 overrides 的 model 匹配用：宿主侧 payload 里只有 provider，没有 model。 */
  const models = new Map<string, { provider: string; model: string }>()

  // 与 dsh-thinking-compact 同款：ctx.inject(['settings']) + settings.register 直连，
  // 服务可用后注册命名空间并开始 live 同步（scope.watch 即时回调）。
  // 0.1.7 起 register/installSection 都不存在（设置服务 = SettingsForms），改 configure()。
  ctx.inject(['settings'], (sctx: any) => {
    try {
      const settings = sctx?.settings
      if (!settings) {
        diag('settings 服务不可用，跳过命名空间注册')
        return
      }
      if (typeof settings.configure === 'function' && typeof settings.register !== 'function') {
        // 0.1.7（SettingsForms）：命名空间 = profile entry id（ENTRY_ID），表单字段来自
        // Config 里 .volatile() 过的字段。auto:false ⇒ 不自动生成本 entry 的表单页，
        // 交给插件自己的 settings.section 卡片。同一 fiber 重复 configure 会抛，忽略即可。
        try {
          sctx.effect(() => settings.configure({ auto: false }, ctx.fiber))
        } catch (error) {
          diag(`settings.configure 失败（可能已配置过同一 fiber）：${String(error)}`)
        }
        // 0.1.7 的 volatile 写入不重挂插件，只原地更新引用 ⇒ 传给 apply 的 config 对象
        // 引用不变、字段值变。靠 loader/volatile-update 事件作废 lastRaw 缓存并重读。
        scopeRef = { get: () => config as Partial<Config> }
        lastRaw = null
        syncFromScope(config as Partial<Config>)
        try {
          // ctx + { global: true }，两个条件缺一不可（2026-10-04 在真实 _commitVolatile()
          // 路径上实测，非推断）：
          //   · 挂 sctx 不行——sctx 是 ctx.inject() 新建的子 fiber。
          //   · 光挂 ctx 也不行——loader 的发射点自带身份过滤：
          //       const self = Object.create(fiber.ctx)
          //       self[Context.filter] = (owner) => owner.fiber === fiber
          //       fiber.ctx.emit(self, 'loader/volatile-update', paths)
          //     而 cordis registry.plugin() 返回的是 Object.create(rawFiber) 包装体
          //     （实测：entry.fiber own `then`=true / own `ctx`=false / 原型才是裸 fiber），
          //     任何 context 的 `.fiber` 却是**裸 fiber** ⇒ `owner.fiber === fiber`
          //     恒 false ⇒ 不带 global 的监听器永不回调，设置改动静默不生效。
          //   · global 绕过 filter（events.ts dispatch：`hook.global || filter(...)`），
          //     实测同一个回调：不带 global 收 0 次，带 global 每次 volatile 更新都收到。
          //     代价：别的 entry 改设置也会触发本回调——回调只重读自己的 config，幂等。
          // 附注：官方插件（dsh-llm-deepseek / dsh-llm-pi-ai 等）只写 ctx.on，
          // 在本内核上同样收不到此事件——是内核侧包装体/裸 fiber 的身份错配，非本插件问题。
          ctx.on('loader/volatile-update', () => {
            lastRaw = null
            syncFromScope(config as Partial<Config>)
            diag(`settings sync(volatile): autoContinue=${live.autoContinue} maxContinuations=${live.maxContinuations} enabled=${live.enabled}`)
          }, { global: true })
        } catch (error) {
          diag(`loader/volatile-update 监听失败（设置改动需重挂才生效）：${String(error)}`)
        }
        diag(`settings presentation configured (0.1.7 SettingsForms, ns=${ENTRY_ID}) ${summaryOf(live)}`)
        return
      }
      if (typeof settings.register !== 'function') {
        diag('settings 服务缺少 register/configure，跳过命名空间注册')
        return
      }
      const scope = sctx.settings.register(NS, Config, { base: { ...(config || {}), logPath: LOG_FILE } })
      scopeRef = scope
      syncFromScope(scope.get())
      diag(`settings registered ${summaryOf(live)}`)
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
    (
      payload: {
        retryPolicy?: any
        code?: string
        failure?: { code?: string }
        provider?: string
        turn?: number
        agent?: any
      } | undefined,
      next: (() => Promise<unknown>) | undefined,
    ) => {
      // 事件时刻重读：不依赖 scope.watch 是否回调过（v0.1.7 首发版曾因配置停留在
      // 激活时的旧值而整条链路静默失效，这里连同自动续写一起改成 pull 式）。
      const cfg = current()
      // 诊断锚点：agent/* 钩子能不能到达本插件（本插件的核心功能全靠它）。
      // 若 host.log 里只见这条不见 turn/end 那条，说明 session/event 派发不到我们；
      // 两条都没有则是整个 agent/* 链路的问题（重试覆盖同样失效）。
      const code = payload?.code ?? payload?.failure?.code ?? ''
      const provider = typeof payload?.provider === 'string' ? payload.provider : ''
      const model = models.get(String(payload?.agent?.session?.id ?? ''))?.model ?? ''
      // provider/model 覆盖：按配置顺序取第一条命中；-1 的字段继承全局值。
      const override = matchOverride(cfg.overrides, provider, model)
      const eff = {
        maxRetries: override && override.maxRetries >= 0 ? override.maxRetries : cfg.maxRetries,
        initialDelayMs: override && override.initialDelayMs >= 0 ? override.initialDelayMs : cfg.initialDelayMs,
        maxDelayMs: override && override.maxDelayMs >= 0 ? override.maxDelayMs : cfg.maxDelayMs,
        jitterRatio: override && override.jitterRatio >= 0 ? override.jitterRatio : cfg.jitterRatio,
      }
      diag(
        `request-error enabled=${cfg.enabled} code=${code || '(n/a)'} provider=${provider || '(n/a)'}` +
          ` model=${model || '(n/a)'}${override ? ` override=${override.provider}/${override.model}` : ''}`,
      )
      if (cfg.enabled) {
        stats.retries += 1
        bump(stats.byCode, code)
        bump(stats.byProvider, provider)
        pushStat({ t: Date.now(), kind: 'retry', code, provider, model, turn: payload?.turn, delayMs: eff.initialDelayMs })
      }
      if (cfg.enabled && payload && payload.retryPolicy && typeof payload.retryPolicy === 'object') {
        const p = payload.retryPolicy
        const mergedCodes = cfg.retryableCodes.length > 0
          ? [...new Set([...(p.retryableCodes ?? []), ...cfg.retryableCodes])]
          : p.retryableCodes
        payload.retryPolicy = {
          ...p,
          ...(p.mode === 'normal' ? { maxRetries: eff.maxRetries } : {}),
          ...(mergedCodes ? { retryableCodes: mergedCodes } : {}),
          initialDelayMs: eff.initialDelayMs,
          maxDelayMs: eff.maxDelayMs,
          jitterRatio: eff.jitterRatio,
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
      // 长跑进程里会话只增不减：超上限丢最早插入的账本（谁被丢谁下次重新计数）
      while (states.size > STATE_MAX) {
        const oldest = states.keys().next().value
        if (typeof oldest !== 'string') break
        states.delete(oldest)
      }
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
  const handleTurnEnd = (
    session: any,
    turn: number,
    kind: string,
    via: string,
    agentHint?: any,
    errorCode?: string,
  ): void => {
    const cfg = current()
    const state = stateOf(String(session.id))
    if (state.lastTurn === turn) return
    state.lastTurn = turn
    // 两种值得补一轮的结束原因：输出被 token 上限截断；或瞬时错误把重试耗光了
    // （后者要用户显式打开 continueOnError，且只认 TRANSIENT_CONTINUE_CODES）。
    const truncation = kind === 'max-tokens'
    const transientFailure = kind === 'error' && cfg.continueOnError && TRANSIENT_CONTINUE_CODES.has(errorCode ?? '')
    if (!truncation && !transientFailure) {
      state.chain = 0
      state.capped = false
      return
    }
    diag(
      `turn/end via=${via} session=${session.id} turn=${turn} kind=${kind}` +
        `${transientFailure ? ` code=${errorCode}` : ''} autoContinue=${cfg.autoContinue}` +
        ` maxContinuations=${cfg.maxContinuations} chain=${state.chain}`,
    )
    if (!cfg.autoContinue) return
    if (state.chain >= cfg.maxContinuations) {
      if (!state.capped) {
        state.capped = true
        stats.capped += 1
        pushStat({ t: Date.now(), kind: 'cap', turn })
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
    // 用户自己排了消息（或 steer）时不再补续写：那条消息本身就是「继续」，
    // 我们再加一条只会让模型连着答两次。
    if (inboxBusy(agent)) {
      stats.skipped += 1
      pushStat({ t: Date.now(), kind: 'skip', turn })
      diag(`bail via=${via}: inbox 已有待处理消息，跳过自动续写 session=${session.id}`)
      return
    }
    // —— 关键：必须等 agent 真正空闲后再投递 ——
    //
    // 两道坑，v0.1.7 的两个版本各踩一道（host.log 全记下来了）：
    //
    // (1) session/event 是在 Session.append() 内部**同步**派发的
    //     （dsh-session/lib/index.js:1462 → invokeContainedSessionObservers），
    //     而 append 有重入保护：:1451 置 entry.appending=true，:1442 见已置位即抛
    //     "session append cannot reenter while another append is being published"。
    //     followup → send → Inbox.splice → Inbox.mutate（dsh-agent/lib/index.js:148）
    //     做的第一件事就是 session.append("agent/inbox/spliced")，
    //     所以在监听器里同步 followup 必然自撞（diag1 版的死法）。
    //
    // (2) 挪进微任务之后死在第二道：turn/end 时驱动还在收尾，phase.kind 仍是
    //     "running"，而 wakeDriver 只在 maintenance / wakeAfterAbort 时才 latch
    //     wakeRequested（dsh-agent-loop/lib/index.js:458-462），否则直接 return
    //     ——消息确实插进了 next-turn 队列，唤醒却被丢弃；kick() 收尾时
    //     :502 的 `if (wakeRequested && this.inbox.hasPending) this.wakeDriver()`
    //     因此不成立。表现就是「进了排队但永远发不出去」（diag2 版的死法）。
    //
    // 正解是官方给的 whenIdle()：`await this.activityDone` 直到驱动边界 settle
    // （dsh-agent-loop/lib/index.js:474-479）。kick 的 finally 先 setPhase(idle)
    // （:498）再 resolve driver，所以那时 phase 已是 idle，这一发
    // send(wakeup=true) 才会真的开新驱动。
    // 截断点分型只用于诊断（text=yes/no）：截断发生在正文之后还是思考阶段，
    // 直接决定「继续输出」这类措辞能不能成立，是自定义提示词时最该看的一项。
    // 判定必须发生在投递前、且用当前 session.log（两处都满足：主路径同步收到
    // turn/end 时该回合全部事件已入 log；兜底路径 idle 时更齐）。
    const hasVisibleText = visibleTextBeforeTurnEnd(session, turn)
    state.chain += 1
    const expectedChain = state.chain
    const sessionId = String(session.id)
    const attempt = (round: number): void => {
      void (async () => {
        try {
          if (typeof agent.whenIdle === 'function') await agent.whenIdle()
          else await new Promise((resolve) => setTimeout(resolve, 0))
          // 等待期间情况可能已经变了：跑了新回合、人工重新发言（chain 被重置）、
          // 或会话已 dispose。任何一种都放弃，绝不补一发过期的续写。
          if (state.lastTurn !== turn || state.chain !== expectedChain || !states.has(sessionId)) {
            diag(`放弃投递 round=${round} via=${via} session=${sessionId} turn=${turn} lastTurn=${state.lastTurn} chain=${state.chain}`)
            return
          }
          // 等待 whenIdle 期间用户可能已经自己发言/排队：让位给用户，不再补续写。
          if (inboxBusy(agent)) {
            stats.skipped += 1
            pushStat({ t: Date.now(), kind: 'skip', turn })
            diag(`放弃投递 round=${round} via=${via} session=${sessionId}：等待期间 inbox 已有新消息`)
            return
          }
          const fresh = current()
          const custom = fresh.continuationPrompt.trim()
          const prompt = custom || DEFAULT_CONTINUATION_PROMPT
          agent.followup(makeContinuationMessage(prompt))
          stats.continues += 1
          const known = models.get(sessionId)
          pushStat({ t: Date.now(), kind: 'continue', turn, provider: known?.provider, model: known?.model })
          diag(`续写已投递 round=${round} via=${via} session=${sessionId} turn=${turn} prompt=${custom ? 'custom' : 'default'} text=${hasVisibleText ? 'yes' : 'no'} chain=${state.chain}/${fresh.maxContinuations}`)
        } catch (error) {
          diag(`续写投递失败 round=${round} via=${via} session=${sessionId} turn=${turn}：${String(error)}`)
          // Inbox.mutate 是先 append 后改本地数组（:148 → :149），重入抛错即未入队，
          // 只有这一种错误可以重试而不会双插。
          if (round === 1 && String(error).includes('reenter')) setTimeout(() => attempt(2), 0)
        }
      })()
    }
    attempt(1)
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
            // 识别自己的续写消息：v4 形态 kind='plugin:'+NS（历史会话迁移后也是它），
            // v3 旧形态 kind='plugin'+plugin 字段保留兼容（老内核/未迁移文件）。
            if ((kind === 'plugin' && source.plugin === NS) || kind === 'plugin:' + NS) {
              diag(`续写消息已入会话 session=${session.id}`)
            }
            return
          }
          // 模型名只在请求元数据里：payload 里只有 provider，overrides 的 model 匹配全靠这里
          case 'request/context':
          case 'request/header': {
            const meta = event.type === 'request/context' ? event.data : event.data?.header?.config
            const model = meta?.model
            if (typeof model === 'string' && model !== '') {
              models.set(String(session.id), {
                provider: typeof meta?.provider === 'string' ? meta.provider : '',
                model,
              })
              while (models.size > STATE_MAX) {
                const oldest = models.keys().next().value
                if (typeof oldest !== 'string') break
                models.delete(oldest)
              }
            }
            return
          }
          case 'turn/end': {
            const reason = event.data && event.data.reason
            if (!reason || typeof reason.kind !== 'string') return
            const code = reason.error?.code ?? reason.error?.failure?.code ?? reason.failure?.code
            handleTurnEnd(
              session,
              typeof event.data.turn === 'number' ? event.data.turn : -1,
              reason.kind,
              'session/event',
              undefined,
              typeof code === 'string' ? code : undefined,
            )
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
      // 关闭自动续写时不必回看日志：每次 idle 扫 400 条事件是白工
      if (!current().autoContinue) return
      const session = payload.agent?.session
      if (!session || session.id === undefined) return
      const end = lastTurnEnd(session)
      if (!end) return
      handleTurnEnd(session, end.turn, end.kind, 'agent/status', payload.agent, end.code)
    } catch (error) {
      diag(`自动续写处理异常（agent/status）：${String(error)}`)
    }
  })

  // 会话离场即清账本，避免长跑进程里 Map 无界增长
  ctx.on('session/disposed', (session: any) => {
    if (!session) return
    const id = String(session.id)
    states.delete(id)
    models.delete(id)
  })

  // —— 只读观测路由 ——
  // 客户端卡片的观测面板用同源 fetch 拉取（打开卡片/点刷新时各一次，不轮询、不推送：
  // 内核把 host→client 事件通道限制在硬编码白名单里，第三方插件拿不到推送通道，
  // 而 webServer.register 是公开的宿主服务，正好用来暴露只读快照）。
  ctx.inject(['webServer'], (wctx: any) => {
    try {
      const ws = wctx?.webServer
      if (!ws || typeof ws.register !== 'function') {
        diag('webServer 不可用：观测路由未注册（观测面板将显示占位）')
        return
      }
      const json = (res: any, code: number, body: unknown): void => {
        try {
          const text = JSON.stringify(body)
          res.writeHead(code, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'content-length': Buffer.byteLength(text),
          })
          res.end(text)
        } catch {
          /* 客户端已断开：忽略 */
        }
      }
      const routes: Array<(() => void) | undefined> = [
        ws.register({
          kind: 'exact',
          path: STATS_PATH,
          handler: (req: any, res: any) => {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              json(res, 405, { error: 'method not allowed' })
              return
            }
            const cfg = current()
            json(res, 200, {
              plugin: name,
              diagTag: DIAG_TAG,
              pid: process.pid,
              now: Date.now(),
              config: {
                ...cfg,
                continuationPrompt: cfg.continuationPrompt.trim() === '' ? '(内置默认)' : '(自定义)',
              },
              stats,
              models: Object.fromEntries(models),
            })
          },
        }),
        ws.register({
          kind: 'exact',
          path: LOG_ROUTE_PATH,
          handler: (req: any, res: any) => {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              json(res, 405, { error: 'method not allowed' })
              return
            }
            const url = new URL(String(req.url ?? LOG_ROUTE_PATH), 'http://localhost')
            const asked = Number(url.searchParams.get('tail') ?? '80')
            const tail = Math.min(Math.max(Number.isFinite(asked) ? asked : 80, 1), 500)
            try {
              const all = readFileSync(LOG_FILE, 'utf8').split('\n')
              json(res, 200, {
                path: LOG_FILE,
                tail,
                lines: all.slice(Math.max(0, all.length - 1 - tail), all.length - 1),
              })
            } catch (error) {
              json(res, 200, { path: LOG_FILE, tail: 0, lines: [], error: String(error) })
            }
          },
        }),
      ]
      const disposeAll = (): void => {
        for (const dispose of routes) {
          try {
            dispose?.()
          } catch {
            /* 已释放 */
          }
        }
      }
      if (typeof wctx.effect === 'function') {
        wctx.effect(() => disposeAll, 'dsh-llm-retry-settings: observation routes')
      }
      diag(`观测路由已注册：${STATS_PATH} / ${LOG_ROUTE_PATH}`)
    } catch (error) {
      diag(`观测路由注册失败：${String(error)}`)
    }
  })
}
