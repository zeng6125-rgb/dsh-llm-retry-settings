/**
 * dsh-llm-retry-settings — 客户端设置 UI（设置 → 独立分区「LLM 自动重试」）
 *
 * 绑定本插件宿主半边（src/index.ts）注册的 `dsh-llm-retry` 命名空间：
 *  - ctx.settingsScope.bind({ namespace: 'dsh-llm-retry' })
 *  - 在 settings.section 槽位注册独立分区（设置页左侧导航项「LLM 自动重试」）
 *  - inject: ["slots", "settingsScope"]，运行时由客户端 runner 注入
 *
 * 布局（v0.2 重构）：
 *  - 头部：标题 + 开关状态徽标 + 描述 + 实时摘要行
 *  - 「重试行为」2×2 卡片网格（次数 / 初始退避 / 最大退避 / 抖动）
 *  - 「补充可重试错误码」chip 多选：错误码集合可枚举，勾选即合并进
 *    provider 内置列表（并集不覆盖）；未知自定义码以虚线 chip 展示同样可取消
 *
 * 交互模型（草稿 + 显式保存）：
 *  - 输入只改本地草稿，标脏；「保存」批量提交变更字段并对账快照验证
 *  - 「放弃」回滚草稿；外部变更在未编辑时自动跟随
 */

const NS = 'dsh-llm-retry'
const PLUGIN_ID = 'dsh-llm-retry-settings'
const CSS_TAG = PLUGIN_ID + '/client.css'

/**
 * 设置通道的双键（2026-09-22，DSH 0.1.7-alpha.1 适配）——只用于设置，不动 locale/CSS：
 *   0.1.6 = 宿主 settings.register(NS) 注册的插件 NS；
 *   0.1.7 = profile entry id（cordis.patch.yml 的 `id: llm-retry-settings`）——
 *           SettingsForms.describe() 回的 ns 就是 `entry.options.id`，且
 *           update()/mutate() 也按 entry id 找条目，用 NS 写会抛 No configurable plugin entry。
 */
const ENTRY_ID = 'llm-retry-settings'
const NS_KEYS = [NS, ENTRY_ID]

import { useState, useCallback, useEffect, useRef, useSyncExternalStore, memo } from 'react'

// [rc.8 compat] dsh-client-web-react 移除了静态模块导出；
// bindSnapshotSelector 本是 uSES selector bridge，这里用 useSyncExternalStore 内联等价实现。
/** 宿主 OS 用户目录 + 插件日志子路径 → 绝对路径（Windows 用反斜杠）。 */
const LOG_SUBPATH = ['.dsh', 'logs', 'dsh-llm-retry-settings', 'host.log']
const logPathFromHome = (home) => {
  if (typeof home !== 'string' || home === '') return ''
  const sep = home.indexOf('\\') >= 0 ? '\\' : '/'
  return [home.replace(/[\\/]+$/, ''), ...LOG_SUBPATH].join(sep)
}

function bindSnapshotSelector(scope) {
  const subscribe = (fn) => scope.subscribe(fn)
  const getSnapshot = () => scope.getSnapshot()
  return function useSelector(sel) {
    return sel(useSyncExternalStore(subscribe, getSnapshot))
  }
}

// 与宿主 src/index.ts 的 DEFAULTS 镜像（客户端拿不到宿主导出，此处手抄，改动需两处同步）
const DEFAULTS = {
  enabled: false,
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  jitterRatio: 0.1,
  retryableCodes: ['INVALID_REQUEST', 'PI_AI_ERROR'],
  autoContinue: false,
  maxContinuations: 2,
  continuationPrompt: '',
  continueOnError: false,
  overrides: [],
}

// 已知错误码全集：核心 dsh-llm 规范码 + pi-ai/deepseek 两个适配器可能产出的全部
// failure.code（扫自 node_modules 实际源码）。每条带 cat 分类（见 CODE_CATEGORIES），
// 客户端按组渲染；warn=true 的码重试基本无意义（琥珀色），仅特殊场景手动勾选；
// 列表之外的码（provider 手工配置）以「自定义」虚线 chip 出现。
// 刻意不列（在 agent/request-error 之前抛出，勾选也永远命中不了）：dsh-llm 注册期码
// NO_ADAPTER / INVALID_ADAPTER / DUPLICATE_ADAPTER / INVALID_CATALOG / *_DIRECTORY /
// *_DISCOVERY / INVALID_MODEL_* / INVALID_PREPARED_CALL / REGISTRATION_DISPOSED /
// INVARIANT，以及凭证与发现期码 NO_CREDENTIAL_STORE / UNSTORABLE_PROVIDER_ID /
// DISCOVERY_FAILED / DISCOVERY_UNSUPPORTED。
// 同样不列 LLM_STREAM_IDLE_TIMEOUT / DEEPSEEK_FILES_API_TIMEOUT：它们只是 dsh-timeout
// TimeoutReason 的 code，从不作为 failure.code 出现——卡流被适配器改写为
// LlmError(..., "TIMEOUT")（pi-ai:1883、deepseek:1627），Files API 超时则回退 base64
// 继续发请求（deepseek:1732），根本不报错。
// 判据：只有 `new LlmError(msg, CODE)`（或 HarnessError.code）才算错误码，
// TimeoutReason / 注册期抛出的码都不算。宿主升级后按此口径重新扫一遍即可。
// 分类口径：按「重试有没有恢复价值」分六组，从上到下递减。
// transient 组是官方默认列表覆盖的瞬时故障；warn=true 的码一律落在后面四组。
// 文案（分组名/说明、每个码的 tooltip）全部走字典 L.catLabel / L.catNote / L.codeDesc：
// 这里只留结构与判据 —— 硬编码中文会让英文界面里 25 条码说明与 6 个分组标题全不可读。
const CODE_CATEGORIES = ['transient', 'quota', 'request', 'content', 'auth', 'misc']

const KNOWN_CODES = [
  // —— 瞬时故障 ——
  { code: 'SERVER', cat: 'transient' },
  { code: 'TIMEOUT', cat: 'transient' },
  { code: 'TRANSPORT', cat: 'transient' },
  { code: 'EMPTY_RESPONSE', cat: 'transient' },
  { code: 'STREAM_CLOSED', cat: 'transient' },
  { code: 'MALFORMED_RESPONSE', cat: 'transient' },
  { code: 'INVALID_RESPONSE', cat: 'transient' },
  { code: 'PI_AI_ERROR', cat: 'transient' },
  { code: 'PI_AI_NOT_WARMED', cat: 'transient' },
  // —— 限流与配额 ——
  { code: 'RATE_LIMIT', cat: 'quota' },
  { code: 'QUOTA', cat: 'quota', warn: true },
  // —— 请求与参数 ——
  { code: 'INVALID_REQUEST', cat: 'request' },
  { code: 'CONTEXT_WINDOW_EXCEEDED', cat: 'request', warn: true },
  { code: 'UNSUPPORTED_OPTION', cat: 'request', warn: true },
  { code: 'UNKNOWN_MODEL', cat: 'request', warn: true },
  { code: 'REQUEST_EXTENSION', cat: 'request', warn: true },
  { code: 'INVALID_REPLAY_STATE', cat: 'request', warn: true },
  // —— 内容与能力 ——
  { code: 'UNSUPPORTED_CONTENT', cat: 'content', warn: true },
  { code: 'UNSUPPORTED_REASONING_EFFORT', cat: 'content', warn: true },
  { code: 'FILES_API', cat: 'content', warn: true },
  // —— 凭证与鉴权 ——
  { code: 'AUTH', cat: 'auth', warn: true },
  { code: 'INVALID_CREDENTIAL', cat: 'auth', warn: true },
  { code: 'MISSING_CREDENTIAL', cat: 'auth', warn: true },
  // —— 取消与兜底 ——
  { code: 'ABORTED', cat: 'misc', warn: true },
  { code: 'UNKNOWN', cat: 'misc', warn: true },
]

const KNOWN_CODE_SET = new Set(KNOWN_CODES.map((k) => k.code))
// 自定义码白名单：宿主错误码是全大写标识符；输入侧同样放行 . 与 -（provider 侧可能带点）。
const CODE_RE = /^[A-Z0-9_][A-Z0-9_.-]*$/

const ZH = {
  title: 'LLM 自动重试',
  desc: '模型请求失败时的自动恢复策略，以及输出被 token 上限截断时的自动续写。开启重试后以本卡片值为准覆盖各 provider 的重试次数与退避时间。',
  badgeOn: '覆盖已开启',
  badgeOff: '未开启',
  statusOff: '沿用各 provider 自带的重试策略',
  statusOn: (n, init, max, j, c) => `最多重试 ${n} 次 · 退避 ${init}ms→${max}ms · 抖动 ${j} · 补充 ${c} 个错误码`,
  continueOn: (n) => `截断自动续写 ≤${n} 次`,
  continueOff: '截断不自动续写',
  groupBehavior: '重试行为',
  fieldRetries: '最大重试次数',
  fieldRetriesHint: '失败后最多重试几次；0 = 不重试',
  fieldInitial: '初始退避',
  fieldInitialHint: '第一次重试前等待的毫秒数，此后按指数增长',
  fieldMax: '最大退避',
  fieldMaxHint: '退避时间封顶的毫秒数',
  fieldJitter: '抖动比例',
  fieldJitterHint: '0~1，给退避加随机抖动避免同时重试',
  groupCodes: '补充可重试的错误码',
  fieldCodesHint: '按“重试有没有恢复价值”分六组列出，组内已选中的码自动靠前并计数。勾选的码与 provider 内置列表取并集（不覆盖已有码）。琥珀色 = 重试通常无意义，慎选；STREAM_ERROR 流式失败归入 PI_AI_ERROR，SSE 卡流归入 TIMEOUT。provider 配置里手工加入、不在清单内的码会以虚线“自定义”组出现。',
  codesNone: '未勾选任何补充码——仅按 provider 内置码重试',
  codesCount: (n) => `将补充 ${n} 个错误码`,
  codesClear: '清空',
  codesCustom: '自定义',
  codesCustomHint: '不在已知清单内（provider 配置手工加的，或在此输入后保存）',
  codesCustomChip: '自定义错误码，点击取消勾选',
  codesAddPlaceholder: '输入自定义错误码，如 MY_PROVIDER_BUSY',
  codesAddBtn: '添加',
  codesAddDup: (c) => `已勾选或已存在：${c}`,
  codesAddBad: (c) => `${c} 含空白或非法字符（仅限 A-Z 0-9 _ - .）`,
  groupContinue: '输出截断自动续写',
  switchOn: '开启',
  switchOff: '关闭',
  continueHint: '回答被输出 token 上限截断时（宿主会显示「已达到输出 token 上限」），自动替你发一条「继续」，'
    + '模型接着上文往下写。这不是请求失败，上面的重试策略管不到它；两者互不影响。',
  continueLog: '宿主半边把日志写进 ~/.dsh/logs/dsh-llm-retry-settings/host.log。',
  logTitle: '排错日志',
  logFile: '~/.dsh/logs/dsh-llm-retry-settings/host.log',
  logOpen: '打开日志',
  logCopied: '已复制日志路径，粘贴到资源管理器地址栏即可。',
  logManual: '当前环境拿不到日志路径也复制不了，请手动访问上面的路径。',
  continueZero: '次数为 0：开关虽开，实际不会补写任何一轮。',
  fieldMaxContinue: '最多连续续写',
  fieldMaxContinueHint: '同一次截断后连续补写的次数上限；模型正常说完或你重新发言即重新计数',
  fieldPrompt: '续写提示词',
  fieldPromptHint: '截断后自动发给模型的文案。留空用内置默认文案（「请从中断处直接继续输出…」）。',
  fieldPromptPlaceholder: '留空 = 使用内置默认文案',
  fieldPromptDefault: '当前使用内置默认文案',
  fieldPromptCustom: '当前使用自定义文案',
  suffixTimes: '次',
  suffixMs: 'ms',
  save: '保存',
  revert: '放弃',
  saving: '保存中…',
  saved: '已保存 ✓',
  saveFailed: '保存失败 ✗（重试或刷新页面；宿主日志见 settings-rejected）',
  dirtyHint: '有未保存的修改',
  hostStale: '宿主半边还是旧版（内核未重启）：覆盖规则 / 续写增强 / 观测面板可以看，但保存不生效、观测路由会 404。',
  // —— 退避可视化 + 预算 ——
  groupBackoff: '退避与预算',
  backoffEmpty: '重试次数为 0：不会产生任何等待。',
  backoffBudget: (best, worst, n) => `预算：${n} 次重试累计等待 ${best}~${worst}（含抖动区间）`,
  backoffSeq: (seq, n) => `序列：${seq}（共 ${n} 档）`,
  backoffHint: (p) => `每次 ×2 递增并在「最大退避」处封顶；抖动给每一档 ±${p}% 的随机偏移。`,
  // —— provider/model 覆盖 ——
  groupOverrides: '按 provider / model 的策略',
  overridesHint: '按顺序取第一条命中的规则：provider / model 支持 * 通配，留空或 * = 任意。数值留空即继承上面的全局值。model 匹配依赖宿主看到的最近一次请求元数据。',
  overridesNone: '没有覆盖规则：所有 provider 都用上面的全局值。',
  overrideProviderPlaceholder: '如 jyld2 或 *',
  overrideModelPlaceholder: '如 qwen3.8-flash 或 *',
  overrideAdd: '＋ 添加一条',
  overrideRemove: '删除',
  overrideShortRetries: '次数',
  overrideShortInitial: '初始',
  overrideShortMax: '封顶',
  overrideShortJitter: '抖动%',
  // —— 观测面板 ——
  groupStats: '重试观测（本进程累计）',
  statsRefresh: '↻ 刷新',
  statsLoading: '读取中…',
  statsUnavailable: (msg) => `拿不到宿主数据：${msg}。宿主半边的观测路由需要重启内核后才注册。`,
  statsRetries: '请求失败重试',
  statsContinues: '自动续写',
  statsCapped: '续写触顶',
  statsSkipped: '让位用户',
  statsByCode: '按错误码',
  statsByProvider: '按 provider',
  statsRecent: '最近记录',
  statsEmpty: '暂无记录',
  statsStale: '宿主半边未重载（内核未重启）：观测路由还没注册，重启后这里就有数据了。',
  statsKindRetry: '重试',
  statsKindContinue: '续写',
  statsKindCap: '触顶',
  statsKindSkip: '跳过',
  statsUptime: (mins) => {
    const m = Math.max(0, Math.round(mins))
    if (m < 60) return `已运行 ${m} 分钟`
    if (m < 1440) return `已运行 ${Math.floor(m / 60)} 小时 ${m % 60} 分`
    return `已运行 ${Math.floor(m / 1440)} 天 ${Math.floor((m % 1440) / 60)} 小时`
  },
  statsModels: '当前会话模型（覆盖规则按它匹配）',
  statsDiag: (tag) => `宿主构建 ${tag}`,
  statsLogTail: '查看日志尾部',
  statsLogHide: '收起日志',
  statsLogEmpty: '（暂无日志）',
  // —— 续写增强 ——
  continueOnError: '重试彻底失败后也续写',
  continueOnErrorHint: '请求把重试次数用尽后，若结束原因是瞬时错误（超时 / 传输 / 服务端 / 流中断 / 空响应），也补一轮续写；确定性错误（参数、内容、凭证）不补。',
  fieldPromptTemplate: '提示词模板',
  promptTemplateHint: '选模板只是把文案填进下面的输入框，仍可自由修改；选「内置默认」等于清空输入框。',
  promptTemplatePick: '插入模板…',
  fieldPromptTemplateState: (name) => `当前使用模板：${name}`,

  // —— 错误码分组与逐码说明（原先硬编码在 CODE_CATEGORIES / KNOWN_CODES 里，
  //    导致英文界面下 25 条 tooltip 与 6 个分组标题全是中文）——
  catLabel: {
    transient: '瞬时故障',
    quota: '限流与配额',
    request: '请求与参数',
    content: '内容与能力',
    auth: '凭证与鉴权',
    misc: '取消与兜底',
  },
  catNote: {
    transient: '重试通常能恢复',
    quota: '退避后可能恢复',
    request: '多为确定性错误',
    content: '模型不支持，重试无意义',
    auth: '先修配置',
    misc: '慎选',
  },
  codeDesc: {
    SERVER: 'HTTP 5xx 服务端错误',
    TIMEOUT: '请求超时：整次请求未在时限内返回；SSE 卡流（stream idle 看门狗）也以此码上报',
    TRANSPORT: '网络中断、连接重置、流提前结束',
    EMPTY_RESPONSE: '流正常结束但零内容块；重试安全',
    STREAM_CLOSED: 'deepseek SSE 流未收到 [DONE] 就断开',
    MALFORMED_RESPONSE: 'SSE 数据帧格式损坏',
    INVALID_RESPONSE: '响应结构不符合预期（偶发可试）',
    PI_AI_ERROR: 'pi-ai 兜底未知错误；STREAM_ERROR 流式失败归此类',
    PI_AI_NOT_WARMED: 'pi-ai 适配器尚未预热完成就被调用（启动竞态）；退避后重试通常能成',
    RATE_LIMIT: '429 限流',
    QUOTA: '配额/余额耗尽（规范字面值就是 QUOTA）；重试无意义',
    INVALID_REQUEST: '400 类请求被拒（如 thinking 模式 reasoning_text 冲突、payload 超限）',
    CONTEXT_WINDOW_EXCEEDED: '上下文超窗；重试同样失败，应压缩上下文',
    UNSUPPORTED_OPTION: '适配器不支持该生成参数（如 stop）；改参数而非重试',
    UNKNOWN_MODEL: '请求的模型不在目录；重试同样失败，应改模型选择',
    REQUEST_EXTENSION: 'deepseek 请求扩展（图片/搜索等）准备或受理失败；多为确定性错误',
    INVALID_REPLAY_STATE: 'pi-ai 重放状态损坏（内部管线错误）',
    UNSUPPORTED_CONTENT: '该模型不支持此类内容（如图片）',
    UNSUPPORTED_REASONING_EFFORT: '该模型不支持所选推理档位',
    FILES_API: 'deepseek 文件服务 HTTP 失败',
    AUTH: '401/403 认证被拒；修密钥而非重试',
    INVALID_CREDENTIAL: '凭证格式非法；修正存储值',
    MISSING_CREDENTIAL: '缺少 API Key；先去模型页配置',
    ABORTED: '调用方主动取消；绝不应重试',
    UNKNOWN: '非 LlmError 的通用兜底；勾选=广撒网',
  },
}

const EN = {
  title: 'LLM auto-retry',
  desc: 'Automatic recovery for failed model requests, plus auto-continue when a reply is cut off by the output token limit. While enabled, this card overrides each provider\'s retry count and backoff.',
  badgeOn: 'override on',
  badgeOff: 'off',
  statusOff: 'Using each provider\'s built-in retry policy',
  statusOn: (n, init, max, j, c) => `up to ${n} retries · backoff ${init}ms→${max}ms · jitter ${j} · ${c} extra codes`,
  continueOn: (n) => `auto-continue ≤${n}`,
  continueOff: 'no auto-continue',
  groupBehavior: 'Retry behavior',
  fieldRetries: 'Max retries',
  fieldRetriesHint: 'How many times to retry after a failure; 0 = no retry',
  fieldInitial: 'Initial backoff',
  fieldInitialHint: 'Wait before the first retry, then grows exponentially',
  fieldMax: 'Max backoff',
  fieldMaxHint: 'Upper bound for the backoff wait',
  fieldJitter: 'Jitter ratio',
  fieldJitterHint: '0~1, randomizes each backoff to avoid synchronized retries',
  groupCodes: 'Extra retryable error codes',
  fieldCodesHint: 'Grouped into six buckets by "is retrying worth it"; picked codes float to the front of their group and are counted. Your picks are unioned with the provider\'s built-in list (never replacing it). Amber = retrying usually does not help. STREAM_ERROR folds into PI_AI_ERROR, SSE stalls into TIMEOUT. Codes added by hand in a provider config show up in a dashed "custom" group.',
  codesNone: 'No extra codes — retry only the provider built-ins',
  codesCount: (n) => `Adding ${n} error codes`,
  codesClear: 'Clear',
  codesCustom: 'Custom',
  codesCustomHint: 'Not in the known list (added by hand in a provider config, or typed here and saved)',
  codesCustomChip: 'Custom code — click to unselect',
  codesAddPlaceholder: 'Type a code, e.g. MY_PROVIDER_BUSY',
  codesAddBtn: 'Add',
  codesAddDup: (c) => `Already selected or listed: ${c}`,
  codesAddBad: (c) => `${c} contains spaces or illegal characters (A-Z 0-9 _ - . only)`,
  groupContinue: 'Auto-continue on truncation',
  switchOn: 'on',
  switchOff: 'off',
  continueHint: 'When a reply is cut off by the output token limit (the host shows "Output token limit reached"), a "continue" turn is sent automatically so the model resumes. This is not a request failure, so the retry policy above never sees it; the two are independent.',
  continueLog: 'The host half writes its log to ~/.dsh/logs/dsh-llm-retry-settings/host.log.',
  logTitle: 'Troubleshooting log',
  logFile: '~/.dsh/logs/dsh-llm-retry-settings/host.log',
  logOpen: 'Open log',
  logCopied: 'Log path copied — paste it into Explorer\'s address bar.',
  logManual: 'This environment exposes neither the log path nor the clipboard; open the path above manually.',
  continueZero: 'Zero rounds: the switch is on but nothing will be sent.',
  fieldMaxContinue: 'Max consecutive continuations',
  fieldMaxContinueHint: 'Upper bound per truncation chain; resets once the model finishes or you speak again',
  fieldPrompt: 'Continuation prompt',
  fieldPromptHint: 'The text sent to the model after a truncation. Leave empty for the built-in default ("resume from where it stopped…").',
  fieldPromptPlaceholder: 'Empty = built-in default',
  fieldPromptDefault: 'Currently using the built-in default text',
  fieldPromptCustom: 'Currently using a custom text',
  suffixTimes: '×',
  suffixMs: 'ms',
  save: 'Save',
  revert: 'Discard',
  saving: 'Saving…',
  saved: 'Saved ✓',
  saveFailed: 'Save failed ✗ (retry or refresh; host log: settings-rejected)',
  dirtyHint: 'Unsaved changes',
  hostStale: 'The host half is still the old build (kernel not restarted): the override rules, continuation extras and observation panel render, but saving has no effect and the stats route returns 404.',
  groupBackoff: 'Backoff & budget',
  backoffEmpty: 'Zero retries: no waiting at all.',
  backoffBudget: (best, worst, n) => `Budget: ${n} retries wait ${best}–${worst} in total (jitter range)`,
  backoffSeq: (seq, n) => `Curve: ${seq} (${n} steps)`,
  backoffHint: (p) => `Doubles each time, capped at Max backoff; jitter adds ±${p}% per step.`,
  groupOverrides: 'Per provider / model policy',
  overridesHint: 'First matching rule wins: provider / model accept * wildcards; empty or * = any. Empty numbers inherit the global values above. Model matching depends on the latest request metadata the host has seen.',
  overridesNone: 'No override rules: every provider uses the global values above.',
  overrideProviderPlaceholder: 'e.g. jyld2 or *',
  overrideModelPlaceholder: 'e.g. qwen3.8-flash or *',
  overrideAdd: '+ Add a rule',
  overrideRemove: 'Delete',
  overrideShortRetries: 'retries',
  overrideShortInitial: 'initial',
  overrideShortMax: 'cap',
  overrideShortJitter: 'jitter%',
  groupStats: 'Retry observation (this kernel run)',
  statsRefresh: '↻ Refresh',
  statsLoading: 'Loading…',
  statsUnavailable: (msg) => `Host data unavailable: ${msg}. The host half registers these routes only after a kernel restart.`,
  statsRetries: 'Retried failures',
  statsContinues: 'Auto-continues',
  statsCapped: 'Hit the cap',
  statsSkipped: 'Yielded to user',
  statsByCode: 'By error code',
  statsByProvider: 'By provider',
  statsRecent: 'Recent events',
  statsEmpty: 'No events yet',
  statsStale: 'The host half is not reloaded yet (kernel not restarted): the stats route is not registered. Restart and this panel fills up.',
  statsKindRetry: 'retry',
  statsKindContinue: 'continue',
  statsKindCap: 'cap',
  statsKindSkip: 'skip',
  statsUptime: (mins) => {
    const m = Math.max(0, Math.round(mins))
    if (m < 60) return `up ${m} min`
    if (m < 1440) return `up ${Math.floor(m / 60)}h ${m % 60}m`
    return `up ${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`
  },
  statsModels: 'Live session models (what the override rules match)',
  statsDiag: (tag) => `host build ${tag}`,
  statsLogTail: 'Show log tail',
  statsLogHide: 'Hide log',
  statsLogEmpty: '(no log yet)',
  continueOnError: 'Continue after retries are exhausted',
  continueOnErrorHint: 'Once the request has used up all retries, a transient failure (timeout / transport / server / stream break / empty response) also gets one continuation round; deterministic failures (params, content, credentials) do not.',
  fieldPromptTemplate: 'Prompt template',
  promptTemplateHint: 'Picking a template only fills the text box below — you can still edit it. "Built-in default" clears the box.',
  promptTemplatePick: 'Insert template…',
  fieldPromptTemplateState: (name) => `Template: ${name}`,

  // —— error-code groups and per-code descriptions (previously hardcoded Chinese) ——
  catLabel: {
    transient: 'Transient',
    quota: 'Rate limit & quota',
    request: 'Request & params',
    content: 'Content & capability',
    auth: 'Credentials & auth',
    misc: 'Cancel & fallback',
  },
  catNote: {
    transient: 'Retrying usually recovers',
    quota: 'May recover after backoff',
    request: 'Mostly deterministic errors',
    content: 'Unsupported by the model — retrying is pointless',
    auth: 'Fix the configuration first',
    misc: 'Pick with care',
  },
  codeDesc: {
    SERVER: 'HTTP 5xx server error',
    TIMEOUT: 'Request timed out before returning; the SSE stream-idle watchdog reports this code too',
    TRANSPORT: 'Connection dropped, reset, or the stream ended early',
    EMPTY_RESPONSE: 'Stream ended cleanly with zero content blocks; safe to retry',
    STREAM_CLOSED: 'deepseek SSE stream closed before [DONE]',
    MALFORMED_RESPONSE: 'Corrupted SSE frame',
    INVALID_RESPONSE: 'Response shape did not match expectations (worth a try when rare)',
    PI_AI_ERROR: 'pi-ai catch-all; STREAM_ERROR stream failures land here',
    PI_AI_NOT_WARMED: 'pi-ai adapter called before warm-up (startup race); usually succeeds after backoff',
    RATE_LIMIT: '429 rate limited',
    QUOTA: 'Quota/balance exhausted; retrying is pointless',
    INVALID_REQUEST: '400-class rejection (e.g. thinking/reasoning_text conflict, oversized payload)',
    CONTEXT_WINDOW_EXCEEDED: 'Context window exceeded; a retry fails too — compact instead',
    UNSUPPORTED_OPTION: 'Adapter rejects this generation option (e.g. stop); change it rather than retry',
    UNKNOWN_MODEL: 'Model not in the catalog; switch models instead of retrying',
    REQUEST_EXTENSION: 'deepseek request extension (image/search) failed to prepare or accept; usually deterministic',
    INVALID_REPLAY_STATE: 'pi-ai replay state corrupted (internal pipeline error)',
    UNSUPPORTED_CONTENT: 'The model does not support this content type (e.g. images)',
    UNSUPPORTED_REASONING_EFFORT: 'The model does not support the selected reasoning effort',
    FILES_API: 'deepseek file service HTTP failure',
    AUTH: '401/403 rejected; fix the key rather than retry',
    INVALID_CREDENTIAL: 'Credential format is invalid; fix the stored value',
    MISSING_CREDENTIAL: 'API key missing; configure it on the model page first',
    ABORTED: 'Cancelled by the caller; never retry',
    UNKNOWN: 'Generic non-LlmError fallback; selecting it casts a wide net',
  },
}

const STR = { zh: ZH, en: EN }
/** 语言来源优先级：内核 locale 设置（apply 里订阅）> <html lang> > 浏览器语言。 */
const LANG_OVERRIDE = { value: '' }
const normalizeLang = (raw) => (String(raw || '').toLowerCase().startsWith('en') ? 'en' : 'zh')
const detectLang = () => {
  if (LANG_OVERRIDE.value !== '') return LANG_OVERRIDE.value
  const html = typeof document !== 'undefined' && document.documentElement ? document.documentElement.lang : ''
  if (html) return normalizeLang(html)
  return normalizeLang(typeof navigator !== 'undefined' ? navigator.language : '')
}
const setLangOf = (raw) => { LANG_OVERRIDE.value = normalizeLang(raw) }
/** 当前语言字典。组件在渲染期读模块级 L，切语言时整棵树重渲染即可换词。 */
let L = ZH
const useL = () => {
  const next = STR[detectLang()] || ZH
  if (L !== next) L = next
  return L
}

const CSS = [
  '.dlr-card{border-bottom:1px solid var(--dsw-alias-border-l2);padding:0 0 20px;display:flex;flex-direction:column;gap:16px}',
  // 顶栏吸顶（2026-10-05）：保存/撤销从卡片底部搬到标题行右侧，整条顶栏 sticky 在滚动容器顶部。
  // 卡片高约 2400px，滚到中段时底部按钮早已不可见——这是用户提的诉求。
  // 背景必须用设置页内容区同款 token（宿主 .VOzbGW_content 就是 --dsw-alias-bg-base），
  // 否则吸顶后下面的块会从半透明栏下透出来。
  //
  // top:-24px 而不是 0：sticky 的偏移是相对滚动容器的**内容盒**，而宿主
  // `.VOzbGW_options{padding:24px}` 有 24px 内边距 ⇒ 用 0 会在栏顶上方留一条 24px 的缝，
  // 滚上去的 chips 正好从缝里露出来（用户截图实测）。负偏移让栏顶贴到 padding 盒顶，
  // 缝就没了；宿主内边距若变小，最多把栏自身 14px 的上内边距吃掉一点，文字不会丢。
  // 未吸顶时 top 不生效，所以不会在卡片上方多画东西。
  '.dlr-head{position:sticky;top:-24px;z-index:3;display:flex;flex-direction:column;gap:6px;padding:14px 0 12px;background:var(--dsw-alias-bg-base,#fff);border-bottom:1px solid var(--dsw-alias-border-l2)}',
  // 顶栏分两层：上层「标题/描述 + 总开关」，下层「状态行 + 保存控件」。
  // 保存控件必须放在**整行宽**的状态行里，才能 margin-left:auto 顶到卡片右边缘、与开关同一条竖线；
  // 留在文字列内的话右边界会被开关列挤掉 68px（用户实测反馈「不对」）。
  '.dlr-headTop{display:flex;align-items:flex-start;gap:12px}',
  '.dlr-headActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;flex:none;margin-left:auto}',
  '.dlr-headText{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}',
  '.dlr-titleRow{display:flex;align-items:center;gap:8px}',
  // 标题显式深色（先给非 light-dark 浏览器一个纯深色回退）；字号提到 16 加粗
  '.dlr-title{color:#101418;color:light-dark(#0f1216,#eef1f4);font-size:16px;line-height:24px;font-weight:700}',
  '.dlr-badge{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 10px;border-radius:999px;font-size:12px;line-height:20px;white-space:nowrap}',
  '.dlr-badge i{width:6px;height:6px;border-radius:50%;flex:none}',
  '.dlr-badge.on{background:rgba(46,158,91,.14);color:var(--dsw-alias-state-success,#2e9e5b)}',
  '.dlr-badge.on i{background:var(--dsw-alias-state-success,#2e9e5b)}',
  '.dlr-badge.off{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary)}',
  '.dlr-badge.off i{background:var(--dsw-alias-label-caption)}',
  '.dlr-desc{color:#24292f;color:light-dark(#24292f,#ccd3da);font-size:13px;line-height:19px}',
  '.dlr-status{color:var(--dsw-alias-label-caption);font-size:12px;line-height:17px}',
  // 状态行 + 右侧保存控件：整行宽，保存控件右对齐到卡片右边缘（与总开关同一竖线）
  '.dlr-statusRow{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:22px}',
  '.dlr-switch{width:44px;height:26px;flex:none;background:var(--dsw-alias-interactive-bg-hover);border:none;border-radius:999px;position:relative;cursor:pointer;transition:background .15s;padding:0;margin-top:2px}',
  '.dlr-switch[aria-checked=true]{background:var(--dsw-alias-state-business-primary)}',
  '.dlr-switch:disabled{opacity:.5;cursor:default}',
  '.dlr-knob{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform .15s}',
  '.dlr-switch[aria-checked=true] .dlr-knob{transform:translateX(18px)}',

  '.dlr-body{display:flex;flex-direction:column;gap:12px}',
  // 「按块分类」（2026-10-05）：一个主题一个 .dlr-block（统一边框/圆角/内边距），
  // 块头 = 标题 + 右侧操作，块体 = 内容。此前字段、错误码、覆盖规则、退避曲线全挤在
  // 同一个 .dlr-section 里，彼此没有视觉边界；分块后所有块左边界与间距一致，才对得齐。
  // contain 从卡片挪到各块：卡片自己要当吸顶顶栏的容器（顶栏是卡片直接子元素），
  // 祖先上的 contain:paint 有把 sticky 的参照物变成自身盒子的风险；放到块上既保留
  // 「隔离布局/绘制」的收益（当初实测：卡片无 contain 时滚动超标帧 15 → 47~58），
  // 又不会碰到顶栏。块内部是 flex+gap，不靠外边距折叠，隔离后无副作用。
  '.dlr-block{display:flex;flex-direction:column;gap:12px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;contain:layout paint}',
  '.dlr-blockHead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
  // 块头里的操作控件（刷新/开关/打开日志）统一靠右，标题永远贴左边界
  '.dlr-blockHead .dlr-miniBtn,.dlr-blockHead .dlr-switch{margin-left:auto}',
  '.dlr-blockNote{color:var(--dsw-alias-label-caption);font-size:12px;line-height:17px}',
  '.dlr-blockBody{display:flex;flex-direction:column;gap:12px}',
  '.dlr-disabled{opacity:.55;pointer-events:none}',
  '.dlr-switchRow{display:flex;align-items:flex-start;gap:10px}',
  '.dlr-switchText{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
  '.dlr-note{color:var(--dsw-alias-label-caption);font-size:12px;line-height:17px}',
  '.dlr-groupTitle{color:#14181d;color:light-dark(#14181d,#e2e7ec);font-size:13px;font-weight:600;letter-spacing:.4px}',
  '.dlr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}',
  '.dlr-cell{display:flex;flex-direction:column;gap:4px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;transition:border-color .12s}',
  '.dlr-cell.dirty{border-color:var(--dsw-alias-state-business-primary)}',
  '.dlr-cellHead{display:flex;align-items:baseline;justify-content:space-between;gap:6px}',
  '.dlr-cellLabel{color:var(--dsw-alias-label-primary);font-size:13px;line-height:19px}',
  '.dlr-cellSuffix{color:var(--dsw-alias-label-caption);font-size:12px}',
  '.dlr-cellHint{color:var(--dsw-alias-label-caption);font-size:12px;line-height:17px}',
  '.dlr-input{width:100%;box-sizing:border-box;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;outline:none}',
  '.dlr-input:focus{border-color:var(--dsw-alias-state-business-primary)}',
  '.dlr-input:disabled{opacity:.5}',
  // 多行文本框（续写提示词）：继承 .dlr-input 的配色，只改高度与内边距
  '.dlr-textarea{width:100%;box-sizing:border-box;min-height:72px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;line-height:19px;font-family:inherit;resize:vertical;outline:none}',
  '.dlr-textarea:focus{border-color:var(--dsw-alias-state-business-primary)}',
  '.dlr-textarea:disabled{opacity:.5}',

  '.dlr-chipsWrap{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}',
  '.dlr-chipOuter{display:flex;flex-direction:column;gap:6px}',
  '.dlr-addRow{display:flex;gap:6px;align-items:center;max-width:420px}',
  '.dlr-addRow .dlr-input{flex:1;min-width:0}',
  '.dlr-addBtn{flex:none;height:32px;padding:0 14px;border:none;border-radius:6px;cursor:pointer;background:var(--dsw-alias-state-business-primary);color:#fff;font-size:13px}',
  '.dlr-addBtn:disabled{opacity:.5;cursor:default}',
  '.dlr-addWarn{color:var(--dsw-alias-label-critical, #d05a5a)}',
  '.dlr-addBtn:not(:disabled):hover{filter:brightness(1.08)}',
  '.dlr-chipHint{color:var(--dsw-alias-label-caption);font-size:12px;line-height:17px}',
  '.dlr-chips{display:flex;flex-wrap:wrap;gap:6px}',
  '.dlr-chipGroup{display:flex;flex-direction:column;gap:6px}',
  '.dlr-chipGroupLabel{display:flex;align-items:baseline;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}',
  '.dlr-chipGroupLabel em{color:var(--dsw-alias-label-caption);font-size:11px;font-weight:400;font-style:normal}',
  '.dlr-chipGroupLabel b{min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-state-business-primary);color:#fff;font-size:10px;line-height:16px;text-align:center;font-weight:600}',
  '.dlr-chip{height:27px;padding:0 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;transition:all .12s;line-height:25px}',
  '.dlr-chip:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}',
  '.dlr-chip.on{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);color:#fff}',
  '.dlr-chip.unknown{border-style:dashed;border-color:var(--dsw-alias-state-warn,#c78421);color:var(--dsw-alias-state-warn,#c78421)}',
  '.dlr-chip.unknown.on{background:var(--dsw-alias-state-warn,#c78421);border-color:var(--dsw-alias-state-warn,#c78421);color:#fff}',
  '.dlr-chip.warn{border-color:rgba(199,132,33,.45);color:var(--dsw-alias-state-warn,#c78421)}',
  '.dlr-chip.warn.on{background:var(--dsw-alias-state-warn,#c78421);border-color:var(--dsw-alias-state-warn,#c78421);color:#fff}',
  '.dlr-chip:disabled{opacity:.45;cursor:default}',
  '.dlr-chipMeta{display:flex;align-items:center;gap:10px;color:var(--dsw-alias-label-caption);font-size:12px}',
  '.dlr-chipClear{height:auto;padding:0;border:none;background:transparent;color:var(--dsw-alias-state-danger,#d54545);font-size:12px;cursor:pointer}',
  '.dlr-chipClear:hover{text-decoration:underline}',

  '.dlr-logPath{color:var(--dsw-alias-label-caption);font-size:12px;line-height:17px;font-family:ui-monospace,Consolas,monospace;word-break:break-all}',
  '.dlr-saveBtn{height:30px;padding:0 18px;border:none;border-radius:6px;background:var(--dsw-alias-state-business-primary);color:#fff;font-size:13px;cursor:pointer}',
  '.dlr-saveBtn:disabled{opacity:.5;cursor:default}',
  '.dlr-revertBtn{height:30px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer}',
  '.dlr-ok{color:var(--dsw-alias-state-success,#2e9e5b);font-size:13px}',
  '.dlr-fail{color:var(--dsw-alias-state-danger,#d54545);font-size:13px}',
  '.dlr-dirtyHint{color:var(--dsw-alias-state-business-primary);font-size:12px}',
  '.dlr-vizBox{display:flex;flex-direction:column;gap:6px;margin-top:6px}',
  '.dlr-curve{display:block;width:100%;height:auto}',
  '.dlr-curveArea{fill:rgba(75,123,236,.14);stroke:none}',
  '.dlr-curveLine{fill:none;stroke:#3867d6;stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round}',
  '.dlr-curveDot{fill:#3867d6}',
  '.dlr-curveCap{stroke:var(--dsw-alias-label-secondary,#8a8a8a);stroke-width:1;stroke-dasharray:3 3;opacity:.6}',
  '.dlr-curveAxis{fill:var(--dsw-alias-label-secondary,#8a8a8a);font-size:9px;font-variant-numeric:tabular-nums}',
  '.dlr-ovBox{display:flex;flex-direction:column;gap:6px}',
  '.dlr-ovRow{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
  '.dlr-ovRow .dlr-input{flex:1 1 110px;min-width:88px}',
  '.dlr-ovRow .dlr-ovNum{flex:0 0 72px;width:72px;min-width:72px}',
  '.dlr-ovDel{background:transparent;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.15));color:inherit;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px}',
  '.dlr-ovDel:disabled{opacity:.5;cursor:default}',
  '.dlr-ovDel:not(:disabled):hover{border-color:var(--dsw-alias-label-critical,#d05a5a);color:var(--dsw-alias-label-critical,#d05a5a)}',
  // —— 重试观测面板（2026-10-05 UI 优化）——
  // 面板整体就是一个 .dlr-block（与上面各块同一套边框/内边距/左边界），块头右侧是操作按钮。
  '.dlr-miniBtn{flex:none;background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:6px;padding:3px 10px;cursor:pointer;font-size:12px;transition:border-color .12s,color .12s}',
  '.dlr-miniBtn:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}',
  '.dlr-statsGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px}',
  '.dlr-statCell{display:flex;flex-direction:column;gap:2px;padding:9px 11px;border-radius:8px;background:var(--dsw-alias-fill-secondary,rgba(0,0,0,.04))}',
  '.dlr-statVal{font-size:19px;line-height:24px;font-weight:600;font-variant-numeric:tabular-nums}',
  '.dlr-statLabel{font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary,#8a8a8a)}',
  // 计数按语义上色：续写=业务蓝，触顶/让位=提醒色与弱化色
  '.dlr-statCell.isInfo .dlr-statVal{color:var(--dsw-alias-state-business-primary)}',
  '.dlr-statCell.isWarn .dlr-statVal{color:var(--dsw-alias-state-warn,#c78421)}',
  '.dlr-statCell.isMuted .dlr-statVal{color:var(--dsw-alias-label-tertiary,#a8a8a8)}',
  // 当前会话模型：一行长句改成可换行的 chip，长名省略号 + title 看全，双击可整段选中复制
  '.dlr-modelBox{display:flex;flex-direction:column;gap:6px}',
  '.dlr-modelChips{display:flex;flex-wrap:wrap;gap:6px}',
  '.dlr-modelChip{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-secondary,rgba(0,0,0,.04));font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:18px;user-select:all}',
  '.dlr-modelChip.more{color:var(--dsw-alias-label-secondary);font-family:inherit}',
  '.dlr-statsCols{display:flex;gap:18px;flex-wrap:wrap}',
  '.dlr-statsCols > .dlr-statsCol{display:flex;flex-direction:column;gap:3px;min-width:160px;flex:1 1 200px}',
  '.dlr-colTitle{color:var(--dsw-alias-label-caption);font-size:11px;line-height:15px;letter-spacing:.3px;text-transform:uppercase}',
  // 占比条：行内绝对定位的浅色块，文字层压在它上面（各子元素 position:relative）
  '.dlr-barRow{position:relative;display:flex;align-items:center;gap:8px;padding:2px 6px;border-radius:4px;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}',
  '.dlr-barRow > *{position:relative}',
  '.dlr-bar{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:var(--dsw-alias-state-business-primary);opacity:.12;pointer-events:none}',
  '.dlr-barKey{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dlr-barVal{flex:none;color:var(--dsw-alias-label-secondary,#8a8a8a)}',
  // 最近记录：定宽网格对齐（时刻 | 类型 | 错误码 | provider/model | 退避），行间细分隔线。
  // 列宽必须**定宽**：每行是各自独立的 grid，用 auto/minmax 会因内容不同逐行错位
  // （实测「10-04 12:04」那行把后面所有列推右 40px）。时间列按跨天格式 MM-DD HH:MM 留宽。
  '.dlr-recent{display:flex;flex-direction:column;gap:1px}',
  '.dlr-recentRow{display:grid;grid-template-columns:78px 62px 110px minmax(0,1fr) 46px;gap:8px;align-items:center;padding:3px 6px;border-radius:4px;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}',
  '.dlr-recentRow + .dlr-recentRow{border-top:1px solid var(--dsw-alias-border-l2)}',
  '.dlr-recentRow > span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dlr-kind{display:block;padding:0 7px;border-radius:999px;background:var(--dsw-alias-fill-secondary,rgba(0,0,0,.05));color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dlr-kind.retry{background:rgba(199,132,33,.14);color:var(--dsw-alias-state-warn,#c78421)}',
  '.dlr-kind.continue{background:rgba(59,130,246,.14);color:var(--dsw-alias-state-business-primary)}',
  '.dlr-kind.cap{background:rgba(199,132,33,.14);color:var(--dsw-alias-state-warn,#c78421)}',
  '.dlr-time{color:var(--dsw-alias-label-secondary,#8a8a8a)}',
  '.dlr-statsFoot{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
  '.dlr-logTail{max-height:220px;overflow:auto;overscroll-behavior:contain;contain:content;margin:0;padding:8px;border-radius:6px;background:var(--dsw-alias-fill-secondary,rgba(0,0,0,.04));font-family:ui-monospace,Consolas,monospace;font-size:11px;white-space:pre-wrap;word-break:break-all}',
].join('')

function ensureCss() {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG) + ']')) return
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.dataset.pluginCss = CSS_TAG
  tag.textContent = CSS
  document.head.appendChild(tag)
}

function Switch({ checked, disabled, label, title, onClick }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      className="dlr-switch"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="dlr-knob" />
    </button>
  )
}

function Badge({ on, label }) {
  return (
    <span className={'dlr-badge ' + (on ? 'on' : 'off')}>
      <i />
      {label}
    </span>
  )
}

const clampNum = (n, min, max) => (Number.isFinite(n) ? Math.min(max ?? Infinity, Math.max(min, n)) : min)
const clampInt = (n, min) => (Number.isFinite(n) ? Math.max(min, Math.floor(n)) : min)

function NumberField({ label, hint, value, min, max, step, disabled, dirty, onChange, onEnter, suffix, float }) {
  return (
    <div className={'dlr-cell' + (dirty ? ' dirty' : '')}>
      <div className="dlr-cellHead">
        <span className="dlr-cellLabel">{label}</span>
        {suffix ? <span className="dlr-cellSuffix">{suffix}</span> : null}
      </div>
      <input
        type="number"
        className="dlr-input"
        // 控件可访问名：label 是纯 span，不关联的话读屏只念「编辑框 N」
        aria-label={label}
        min={min}
        max={float ? max : undefined}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value)
          // float=true 用于 jitterRatio 这类小数字段：保留小数并夹到 [min,max]；
          // 此前统一 floor 会把 0.1 变成 0（bug fix）
          onChange(float ? clampNum(n, min, max) : clampInt(n, min))
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') onEnter() }}
      />
      <span className="dlr-cellHint">{hint}</span>
    </div>
  )
}

function PromptField({ label, hint, value, placeholder, disabled, dirty, onChange }) {
  return (
    <div className={'dlr-cell' + (dirty ? ' dirty' : '')}>
      <div className="dlr-cellHead">
        <span className="dlr-cellLabel">{label}</span>
      </div>
      <textarea
        className="dlr-textarea"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="dlr-cellHint">{hint}</span>
    </div>
  )
}

function Chip({ code, title, warn, unknown, on, disabled, onClick }) {
  return (
    <button
      type="button"
      title={title}
      // 选中态不能只靠 CSS class：读屏软件要靠 aria-pressed 才能念出「已按下/未按下」
      aria-pressed={!!on}
      className={
        'dlr-chip' + (warn ? ' warn' : '') + (unknown ? ' unknown' : '') + (on ? ' on' : '')
      }
      disabled={disabled}
      onClick={onClick}
    >
      {code}
    </button>
  )
}

function CodeChips({ selected, disabled, onToggle, onClear, onAdd }) {
  const [input, setInput] = useState('')
  const commit = () => {
    const value = input.trim()
    if (value === '') return
    // 只有真的加进去才清空输入框：被 CODE_RE 拒绝或与已有码重复时保留原文，
    // 用户不必照着提示重敲一遍（onAdd 明确返回 false 才算失败）
    if (onAdd(value) !== false) setInput('')
  }
  const selSet = new Set(selected)
  const custom = selected.filter((c) => !KNOWN_CODE_SET.has(c))
  const chip = ({ code, warn }) => (
    <Chip key={code} code={code} title={L.codeDesc[code] || code} warn={warn} on={selSet.has(code)}
      disabled={disabled} onClick={() => onToggle(code)} />
  )
  return (
    <div className="dlr-chipsWrap">
      {(onAdd || custom.length > 0) && (
        <div className="dlr-chipGroup">
          <span className="dlr-chipGroupLabel">
            {L.codesCustom}
            <em>{L.codesCustomHint}</em>
          </span>
          <div className="dlr-chips">
            {custom.map((code) => (
              <Chip key={code} code={code} title={L.codesCustomChip}
                unknown on disabled={disabled} onClick={() => onToggle(code)} />
            ))}
          </div>
          {onAdd && (
            <div className="dlr-addRow">
              <input
                className="dlr-input"
                value={input}
                placeholder={L.codesAddPlaceholder}
                spellCheck={false}
                disabled={disabled}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commit()
                  }
                }}
              />
              <button
                type="button"
                className="dlr-addBtn"
                disabled={disabled || input.trim() === ''}
                onClick={commit}
              >
                {L.codesAddBtn}
              </button>
            </div>
          )}
        </div>
      )}
      {CODE_CATEGORIES.map((cat) => {
        const items = KNOWN_CODES.filter((k) => k.cat === cat)
        if (items.length === 0) return null
        // 组内仍是「已选靠前」+ 其余按 KNOWN_CODES 规范顺序（v0.1.5 行为），
        // 分组只决定行归属，勾选不会让 chip 跳到别的组去。
        const picked = items.filter((k) => selSet.has(k.code))
        const others = items.filter((k) => !selSet.has(k.code))
        return (
          <div className="dlr-chipGroup" key={cat}>
            <span className="dlr-chipGroupLabel">
              {L.catLabel[cat] || cat}
              {L.catNote[cat] ? <em>{L.catNote[cat]}</em> : null}
              {picked.length > 0 ? <b>{picked.length}</b> : null}
            </span>
            <div className="dlr-chips">
              {picked.map(chip)}
              {others.map(chip)}
            </div>
          </div>
        )
      })}
      <div className="dlr-chipMeta">
        <span>{selected.length === 0 ? L.codesNone : L.codesCount(selected.length)}</span>
        {selected.length > 0 && (
          <button type="button" className="dlr-chipClear" disabled={disabled} onClick={onClear}>
            {L.codesClear}
          </button>
        )}
      </div>
    </div>
  )
}

/** 覆盖行：数值 -1 = 继承全局（与宿主 DEFAULT/coerce 的哨兵一致）。 */
const OVERRIDE_INHERIT = -1
const blankOverride = () => ({
  provider: '',
  model: '',
  maxRetries: OVERRIDE_INHERIT,
  initialDelayMs: OVERRIDE_INHERIT,
  maxDelayMs: OVERRIDE_INHERIT,
  jitterRatio: OVERRIDE_INHERIT,
})
const numKeep = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : OVERRIDE_INHERIT)
/** 宿主来的覆盖行 → 草稿形状（缺字段一律按「继承」）。 */
const normOverrides = (v) =>
  (Array.isArray(v) ? v : [])
    .filter((row) => row && typeof row === 'object')
    .map((row) => ({
      provider: strOr(row.provider, '*'),
      model: strOr(row.model, '*'),
      maxRetries: numKeep(row.maxRetries),
      initialDelayMs: numKeep(row.initialDelayMs),
      maxDelayMs: numKeep(row.maxDelayMs),
      jitterRatio: numKeep(row.jitterRatio),
    }))

const strOr = (v, d) => (typeof v === 'string' ? v : d)
const numOr = (v, d) => (typeof v === 'number' ? v : d)
const normCodes = (v) => (Array.isArray(v) ? v : []).filter((c) => typeof c === 'string' && c.length > 0)

function projectValue(value) {
  return {
    // enabled 用严格真值判定，与宿主默认 false 对齐（旧写法 !== false 会把缺字段当开启）
    enabled: value.enabled === true,
    maxRetries: numOr(value.maxRetries, DEFAULTS.maxRetries),
    initialDelayMs: numOr(value.initialDelayMs, DEFAULTS.initialDelayMs),
    maxDelayMs: numOr(value.maxDelayMs, DEFAULTS.maxDelayMs),
    jitterRatio: numOr(value.jitterRatio, DEFAULTS.jitterRatio),
    retryableCodes: normCodes(value.retryableCodes),
    autoContinue: value.autoContinue === true,
    maxContinuations: numOr(value.maxContinuations, DEFAULTS.maxContinuations),
    continuationPrompt: strOr(value.continuationPrompt, DEFAULTS.continuationPrompt),
    continueOnError: value.continueOnError === true,
    overrides: normOverrides(value.overrides),
  }
}

/** 续写提示词模板：id 稳定，文案随语言；text 就是写进 continuationPrompt 的值。 */
const PROMPT_TEMPLATES = {
  zh: [
    { id: 'default', label: '内置默认', text: '' },
    { id: 'keep', label: '直接续写', text: '继续。从中断处往下写，不要重复已经输出的内容，也不要重新开头。' },
    { id: 'answer', label: '先给结论', text: '上一条回复被输出长度上限截断。请先直接给出最终答案，再补最关键的论证；不要重复已经输出的内容。' },
    { id: 'think', label: '压缩思考', text: '上一条回复在思考阶段就达到输出上限。请压缩推理：直接给出最终答案，只在必要处给一行理由，不要展开长篇思考。' },
  ],
  en: [
    { id: 'default', label: 'Built-in default', text: '' },
    { id: 'keep', label: 'Resume', text: 'Continue. Resume from where you stopped, without repeating what you already wrote or starting over.' },
    { id: 'answer', label: 'Answer first', text: 'The previous reply was cut off by the output length limit. Give the final answer first, then only the most essential argument; do not repeat what you already wrote.' },
    { id: 'think', label: 'Compress thinking', text: 'The previous reply hit the output limit while still thinking. Compress your reasoning: give the final answer directly, with at most one line of justification per step.' },
  ],
}
const templatesOf = (lang) => PROMPT_TEMPLATES[lang] || PROMPT_TEMPLATES.zh

/** 观测路由（宿主 webServer 注册，同源同路径）。 */
const STATS_ROUTE = '/dsh-llm-retry-settings/stats'
const LOG_ROUTE = '/dsh-llm-retry-settings/log'

const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s` : `${Math.round(ms)}ms`)
/**
 * 时间格式化器只建一次（面板每次重渲染最多 8 行，别再逐行走 toLocaleTimeString）。
 * 必须显式给「时:分:秒」——`new Intl.DateTimeFormat()` 的默认选项只有年月日，
 * 最近记录里几行会显示成同一个日期，等于没有时间信息（2026-10-05 修）。
 */
const CLOCK_FMT = typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function'
  ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  : null
const CLOCK_MIN_FMT = typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function'
  ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  : null
const DAY_FMT = typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function'
  ? new Intl.DateTimeFormat(undefined, { month: '2-digit', day: '2-digit' })
  : null
const fmtClock = (t) => {
  try {
    const date = new Date(t)
    if (!CLOCK_FMT) return date.toLocaleTimeString()
    const today = new Date()
    const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()
    // 当天只给「时:分:秒」；跨天的记录补「月-日 时:分」（列宽按这个更长的情况留）
    if (sameDay || !DAY_FMT) return CLOCK_FMT.format(date)
    return DAY_FMT.format(date) + ' ' + (CLOCK_MIN_FMT ? CLOCK_MIN_FMT.format(date) : '')
  } catch (error) {
    return '-'
  }
}
/**
 * 「按 provider」的显示名：某 provider 在最近记录里只出现过唯一 model 时显示
 * provider/model（否则只显示 provider，避免歧义）。
 */
const providerLabels = (recent) => {
  const map = new Map()
  for (const entry of Array.isArray(recent) ? recent : []) {
    if (!entry || typeof entry.provider !== 'string' || entry.provider === '') continue
    const models = map.get(entry.provider) || new Set()
    if (typeof entry.model === 'string' && entry.model !== '') models.add(entry.model)
    map.set(entry.provider, models)
  }
  const labels = new Map()
  for (const [provider, models] of map) {
    labels.set(provider, models.size === 1 ? provider + '/' + [...models][0] : provider)
  }
  return labels
}

/** 一条记录的 provider/model 标签（宿主旧版拿不到 model 时就只有 provider）。 */
const entryTarget = (entry) => {
  if (!entry || typeof entry.provider !== 'string' || entry.provider === '') return ''
  return typeof entry.model === 'string' && entry.model !== '' ? entry.provider + '/' + entry.model : entry.provider
}

const topEntries = (bag, n) =>
  Object.entries(bag && typeof bag === 'object' ? bag : {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)

/** 当前文案状态：内置默认 / 命中某个模板 / 自定义。 */
const promptStateLabel = (L, text) => {
  if (String(text || '').trim() === '') return L.fieldPromptDefault
  const hit = templatesOf(detectLang()).find((tpl) => tpl.text === text)
  return hit ? L.fieldPromptTemplateState(hit.label) : L.fieldPromptCustom
}

/**
 * 退避曲线 + 等待预算：横轴是第几次重试，纵轴是这一档的等待时长。
 * 口径与宿主/官方重试链一致：delay 从 initialDelayMs 起每次 ×2，到 maxDelayMs 封顶；
 * 抖动不改变曲线点，只在预算里给出 ±jitter 的区间。
 */
function BackoffViz({ maxRetries, initialDelayMs, maxDelayMs, jitterRatio }) {
  const L = useL()
  const steps = []
  const rounds = Math.max(0, Math.min(Math.floor(Number(maxRetries) || 0), 12))
  let delay = Math.max(1, Number(initialDelayMs) || 1)
  const capMs = Math.max(1, Number(maxDelayMs) || 1)
  for (let i = 0; i < rounds; i += 1) {
    const wait = Math.min(delay, capMs)
    steps.push(wait)
    delay = Math.min(wait * 2, capMs)
  }
  const total = steps.reduce((a, b) => a + b, 0)
  const jitter = Math.max(0, Math.min(1, Number(jitterRatio) || 0))
  if (steps.length === 0) {
    return (
      <div className="dlr-vizBox">
        <span className="dlr-groupTitle">{L.groupBackoff}</span>
        <span className="dlr-note">{L.backoffEmpty}</span>
      </div>
    )
  }
  // 曲线含原点（第 0 次 = 不等待），形状才是「指数爬升到封顶」而不是一串柱子
  const series = [0, ...steps]
  const maxV = Math.max(capMs, ...steps, 1)
  // 宽高比贴合卡片实际宽度（~600px）：320:96 配合 max-height 会被 letterbox 成
  // 居中一小条、两侧各留 ~100px 空白；640:112 整行铺开，无侧边留白。
  const W = 640
  const H = 112
  const padL = 34
  const padR = 10
  const padT = 10
  const padB = 18
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const px = (i) => padL + (series.length <= 1 ? 0 : (i / (series.length - 1)) * plotW)
  const py = (v) => padT + plotH - (v / maxV) * plotH
  const line = series.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ')
  const baseY = (padT + plotH).toFixed(1)
  const area = `${padL},${baseY} ${line} ${(padL + plotW).toFixed(1)},${baseY}`
  const yCap = py(capMs).toFixed(1)
  return (
    <div className="dlr-vizBox">
      <span className="dlr-groupTitle">{L.groupBackoff}</span>
      <svg className="dlr-curve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={L.groupBackoff}>
        <line className="dlr-curveCap" x1={padL} y1={yCap} x2={padL + plotW} y2={yCap} />
        <text className="dlr-curveAxis" x={2} y={Number(yCap) + 3}>{fmtMs(capMs)}</text>
        <line className="dlr-curveCap" x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} />
        <text className="dlr-curveAxis" x={2} y={padT + plotH + 3}>0</text>
        <polygon className="dlr-curveArea" points={area} />
        <polyline className="dlr-curveLine" points={line} />
        {series.map((v, i) => (
          <circle className="dlr-curveDot" key={i} cx={px(i)} cy={py(v)} r={i === 0 ? 1.6 : 2.6} />
        ))}
        {steps.map((v, i) => (
          <text className="dlr-curveAxis" key={'x' + i} x={px(i + 1)} y={H - 5} textAnchor="middle">
            {i + 1}
          </text>
        ))}
      </svg>
      <span className="dlr-note">{L.backoffSeq(steps.map((v) => fmtMs(v)).join(' → '), steps.length)}</span>
      <span className="dlr-note">{L.backoffBudget(fmtMs(total * (1 - jitter)), fmtMs(total * (1 + jitter)), steps.length)}</span>
      <span className="dlr-note">{L.backoffHint(Math.round(jitter * 100))}</span>
    </div>
  )
}

/** provider/model 覆盖表：provider、model 文本框 + 四档数值（空 = 继承全局）。 */
function OverridesEditor({ rows, disabled, onChange }) {
  const L = useL()
  const setField = (i, key, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)))
  const numText = (r, key) => (typeof r[key] === 'number' && r[key] >= 0 ? String(r[key]) : '')
  const numValue = (r, key, scale) => {
    const raw = r[key]
    if (typeof raw !== 'number' || raw < 0) return ''
    // 保留一位小数：抖动按 % 显示时，0.5% 直接 Math.round 会显示成 1（与实际存储值不符）
    return String(scale === undefined ? raw : Math.round(raw * scale * 10) / 10)
  }
  const input = (i, key, r, placeholder, width, scale) => (
    <input
      className={'dlr-input' + (width ? ' dlr-ovNum' : '')}
      value={scale === undefined ? numText(r, key) : numValue(r, key, scale)}
      placeholder={placeholder}
      inputMode="numeric"
      spellCheck={false}
      disabled={disabled}
      onChange={(e) => {
        const text = e.target.value.trim()
        if (text === '') return setField(i, key, OVERRIDE_INHERIT)
        const parsed = Number(text)
        if (!Number.isFinite(parsed)) return
        setField(i, key, scale === undefined ? Math.max(0, Math.floor(parsed)) : Math.max(0, Math.min(1, parsed / scale)))
      }}
    />
  )
  return (
    <div className="dlr-ovBox">
      {rows.length === 0 && <span className="dlr-note">{L.overridesNone}</span>}
      {rows.map((r, i) => (
        <div className="dlr-ovRow" key={i}>
          <input
            className="dlr-input"
            value={r.provider}
            placeholder={L.overrideProviderPlaceholder}
            spellCheck={false}
            disabled={disabled}
            onChange={(e) => setField(i, 'provider', e.target.value)}
          />
          <input
            className="dlr-input"
            value={r.model}
            placeholder={L.overrideModelPlaceholder}
            spellCheck={false}
            disabled={disabled}
            onChange={(e) => setField(i, 'model', e.target.value)}
          />
          {input(i, 'maxRetries', r, L.overrideShortRetries, true)}
          {input(i, 'initialDelayMs', r, L.overrideShortInitial, true)}
          {input(i, 'maxDelayMs', r, L.overrideShortMax, true)}
          {input(i, 'jitterRatio', r, L.overrideShortJitter, true, 100)}
          <button type="button" className="dlr-ovDel" disabled={disabled} onClick={() => onChange(rows.filter((row, j) => j !== i))}>
            {L.overrideRemove}
          </button>
        </div>
      ))}
      <div className="dlr-ovRow">
        <button type="button" className="dlr-addBtn" disabled={disabled} onClick={() => onChange([...rows, blankOverride()])}>
          {L.overrideAdd}
        </button>
        <span className="dlr-note">{L.overridesHint}</span>
      </div>
    </div>
  )
}

/** 观测面板：只读路由 + 手动刷新（不轮询：慢变数据只在挂载/点击时拉一次）。 */
const StatsPanel = memo(function StatsPanel({ logPath, live, lang }) {
  // 语言走 prop 而不是内部 detectLang()：memo 只做浅比较，logPath/live 不变就不会重渲染，
  // 面板会停留在切换前的语言。lang 变化即重渲染。
  const L = STR[lang] || ZH
  const [state, setState] = useState({ status: live ? 'idle' : 'stale', data: null, error: '' })
  const [tail, setTail] = useState(null)
  const load = useCallback(async () => {
    // 宿主半边还没重载时路由根本不在：不白跑一次 404 请求
    if (!live) {
      setState({ status: 'stale', data: null, error: '' })
      return
    }
    setState((prev) => ({ ...prev, status: 'loading' }))
    try {
      const res = await fetch(STATS_ROUTE, { cache: 'no-store' })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const data = await res.json()
      setState({ status: 'ready', data, error: '' })
    } catch (error) {
      setState({ status: 'error', data: null, error: String((error && error.message) || error) })
    }
  }, [live])
  useEffect(() => {
    void load()
  }, [load])
  const toggleTail = () => {
    if (tail !== null) {
      setTail(null)
      return
    }
    void (async () => {
      try {
        const res = await fetch(LOG_ROUTE + '?tail=60', { cache: 'no-store' })
        const data = await res.json()
        setTail(Array.isArray(data.lines) ? data.lines.join('\n') : '')
      } catch (error) {
        setTail('')
      }
    })()
  }
  const stats = state.data && state.data.stats ? state.data.stats : null
  const kinds = { retry: L.statsKindRetry, continue: L.statsKindContinue, cap: L.statsKindCap, skip: L.statsKindSkip }
  const codes = stats ? topEntries(stats.byCode, 6) : []
  const providers = stats ? topEntries(stats.byProvider, 6) : []
  const providerNames = stats ? providerLabels(stats.recent) : new Map()
  // 覆盖规则的 model 必须精确匹配：把宿主当前认识的 provider/model 直接列出来照抄
  const liveModels = (() => {
    const map = state.data && state.data.models
    if (!map || typeof map !== 'object') return []
    const seen = new Set()
    for (const value of Object.values(map)) {
      if (!value || typeof value.provider !== 'string' || typeof value.model !== 'string') continue
      if (value.model === '') continue
      seen.add((value.provider ? value.provider + '/' : '') + value.model)
    }
    return [...seen]
  })()
  // 一条事件都没有时不铺两列空表和空记录区，整个面板收成 4 个计数 + 一行提示
  const idle = !!stats && stats.recent.length === 0 && stats.retries === 0 && stats.continues === 0
    && stats.capped === 0 && stats.skipped === 0
  // 占比条：以本列最大值为满格；极小值也留 3% 宽度，避免「有 1 次却看不见条」
  const maxCode = codes.length > 0 ? codes[0][1] : 0
  const maxProvider = providers.length > 0 ? providers[0][1] : 0
  const pct = (value, max) => (max > 0 ? Math.max(3, Math.round((value / max) * 100)) + '%' : '0%')
  const recent = stats ? stats.recent.slice(-8).reverse() : []
  return (
    <div className="dlr-block">
      <div className="dlr-blockHead">
        <span className="dlr-groupTitle">{L.groupStats}</span>
        <button type="button" className="dlr-miniBtn" onClick={() => void load()}>
          {state.status === 'loading' ? L.statsLoading : L.statsRefresh}
        </button>
      </div>
      {state.status === 'stale' && <span className="dlr-fail">{L.statsStale}</span>}
      {state.status === 'error' && <span className="dlr-fail">{L.statsUnavailable(state.error)}</span>}
      {stats && (
        <div className="dlr-statsGrid">
          <div className="dlr-statCell"><span className="dlr-statVal">{stats.retries}</span><span className="dlr-statLabel">{L.statsRetries}</span></div>
          <div className="dlr-statCell isInfo"><span className="dlr-statVal">{stats.continues}</span><span className="dlr-statLabel">{L.statsContinues}</span></div>
          <div className="dlr-statCell isWarn"><span className="dlr-statVal">{stats.capped}</span><span className="dlr-statLabel">{L.statsCapped}</span></div>
          <div className="dlr-statCell isMuted"><span className="dlr-statVal">{stats.skipped}</span><span className="dlr-statLabel">{L.statsSkipped}</span></div>
        </div>
      )}
      {liveModels.length > 0 && (
        <div className="dlr-modelBox">
          <span className="dlr-note">{L.statsModels}</span>
          <div className="dlr-modelChips">
            {liveModels.slice(0, 6).map((model) => (
              <span className="dlr-modelChip" key={model} title={model}>{model}</span>
            ))}
            {liveModels.length > 6 && (
              <span className="dlr-modelChip more" title={liveModels.slice(6).join('、')}>+{liveModels.length - 6}</span>
            )}
          </div>
        </div>
      )}
      {idle && <span className="dlr-note">{L.statsEmpty}</span>}
      {stats && !idle && (
        <div className="dlr-statsCols">
          <div className="dlr-statsCol">
            <span className="dlr-colTitle">{L.statsByCode}</span>
            {codes.length === 0 && <span className="dlr-note">{L.statsEmpty}</span>}
            {codes.map(([key, count]) => (
              <span className="dlr-barRow" key={key}>
                <span className="dlr-bar" style={{ width: pct(count, maxCode) }} aria-hidden="true" />
                <code className="dlr-barKey">{key}</code>
                <span className="dlr-barVal">{count}</span>
              </span>
            ))}
          </div>
          <div className="dlr-statsCol">
            <span className="dlr-colTitle">{L.statsByProvider}</span>
            {providers.length === 0 && <span className="dlr-note">{L.statsEmpty}</span>}
            {providers.map(([key, count]) => {
              const label = providerNames.get(key) || key
              return (
                <span className="dlr-barRow" key={key}>
                  <span className="dlr-bar" style={{ width: pct(count, maxProvider) }} aria-hidden="true" />
                  <span className="dlr-barKey" title={label}>{label}</span>
                  <span className="dlr-barVal">{count}</span>
                </span>
              )
            })}
          </div>
        </div>
      )}
      {stats && !idle && (
        <div className="dlr-recent">
          <span className="dlr-colTitle">{L.statsRecent}</span>
          {recent.length === 0 && <span className="dlr-note">{L.statsEmpty}</span>}
          {recent.map((entry, i) => (
            <span className="dlr-recentRow" key={i}>
              <span className="dlr-time">{fmtClock(entry.t)}</span>
              <span className={'dlr-kind ' + entry.kind}>{kinds[entry.kind] || entry.kind}</span>
              {entry.code ? <code>{entry.code}</code> : <span />}
              <span title={entryTarget(entry)}>{entryTarget(entry)}</span>
              <span className="dlr-time">{typeof entry.delayMs === 'number' ? fmtMs(entry.delayMs) : ''}</span>
            </span>
          ))}
        </div>
      )}
      <div className="dlr-statsFoot">
        <span className="dlr-note">
          {state.data
            ? L.statsDiag(state.data.diagTag) + (stats ? ' · ' + L.statsUptime((state.data.now - stats.startedAt) / 60000) : '')
            : logPath || L.logFile}
        </span>
        <button type="button" className="dlr-miniBtn" onClick={toggleTail}>
          {tail !== null ? L.statsLogHide : L.statsLogTail}
        </button>
      </div>
      {tail !== null && <pre className="dlr-logTail">{tail === '' ? L.statsLogEmpty : tail}</pre>}
    </div>
  )
})

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function RetrySettingsRow({ useScope, scope, hostHome }) {
  const snap = useScope((s) => s)
  useL()
  const ready = snap && snap.status === 'ready'
  // 宿主半边是否已重载：新版会在 settings base 层注入只读 logPath（旧版没有）。
  const hostFresh = !!(ready && snap.value && typeof snap.value.logPath === 'string' && snap.value.logPath !== '')
  const current = projectValue((ready && snap.value) || {})
  const writable = !!(ready && snap.writable)

  const [draft, setDraft] = useState(current)
  const [saveState, setSaveState] = useState(null) // null | 'saving' | 'ok' | 'fail'
  const [addMsg, setAddMsg] = useState(null) // 自定义码输入反馈 null | {kind:'dup'|'bad', code}
  const [logMsg, setLogMsg] = useState(null) // 打开日志失败提示 null | 'nobridge'
  /** 根节点引用：滚动优化要在挂载后沿祖先链找「真正在滚的那个容器」。 */
  const cardRef = useRef(null)

  // 外部变更跟随（渲染期调整，无 effect 竞态）：快照变化时，草稿若仍是旧快照的
  // 原样（用户没改过）就跟随更新；用户改过则保留草稿（dirty）
  const currentKey = JSON.stringify(current)
  const [prevKey, setPrevKey] = useState(currentKey)
  if (currentKey !== prevKey) {
    setPrevKey(currentKey)
    if (JSON.stringify(draft) === prevKey) setDraft(current)
  }

  const dirty = JSON.stringify(draft) !== currentKey
  // 与宿主 coerceConfig 的收尾夹取保持一致（src/index.ts: `if (cfg.initialDelayMs > cfg.maxDelayMs)`）：
  // 官方 localDelay 也以 maxDelayMs 封顶，所以初始退避大于最大退避时每档实际都等 maxDelayMs。
  // 草稿里不镜像这一步的话，摘要行会写「退避 10000ms→5000ms」，与正下方的曲线/预算自相矛盾。
  const update = (field, v) => setDraft((d) => {
    const next = { ...d, [field]: v }
    if (next.initialDelayMs > next.maxDelayMs) next.initialDelayMs = next.maxDelayMs
    return next
  })
  const codesOf = (d) => (Array.isArray(d.retryableCodes) ? d.retryableCodes : [])
  const toggleCode = (code) => {
    const cur = codesOf(draft)
    update('retryableCodes', cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code])
  }
  // 自定义错误码：归一化为宿主风格（大写），只放行合理的标识符字符。
  // KNOWN 码也允许手输（等于勾选）；已存在时给一次性反馈，不重复追加。
  // 反馈写在 updater 外：updater 在并发渲染下可能被跑多次，不适合带副作用。
  const addCode = (raw) => {
    const code = String(raw ?? '').trim().toUpperCase()
    // 返回值 = 是否真的加入：CodeChips 只在成功时清空输入框（失败保留原文，不必重敲）
    if (code === '') return false
    if (!CODE_RE.test(code)) { setAddMsg({ kind: 'bad', code }); return false }
    const cur = codesOf(draft)
    if (cur.includes(code)) { setAddMsg({ kind: 'dup', code }); return false }
    setAddMsg(null)
    update('retryableCodes', [...cur, code])
    return true
  }

  const save = useCallback(async () => {
    setSaveState('saving')
    try {
      for (const [k, v] of Object.entries(draft)) {
        if (!sameJson(current[k], v)) await scope.set(k, v)
      }
    } catch { setSaveState('fail'); return }
    // 验证写入确实生效（controller 会静默吞失败——这里用快照对账）
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 200))
      let latest = null
      try { latest = projectValue(scope.getSnapshot().value || {}) } catch { latest = null }
      if (latest && sameJson(latest, draft)) {
        setSaveState('ok')
        setTimeout(() => setSaveState((s) => (s === 'ok' ? null : s)), 2500)
        return
      }
    }
    setSaveState('fail')
  }, [draft, current, scope])

  const revert = () => { setDraft(current); setSaveState(null) }

  // 宿主日志的绝对路径由宿主半边经 settings base 层注入（只读 logPath）。
  // 壳层桥 window.dshDesktop.openPath(绝对路径) 走 Rust file_open → explorer。
  // 注意不要用 bridge.recovery.openLogs()：那是「桌面壳自己的日志」
  // （%APPDATA%\DSH Desktop\logs），不是内核 home 下的 ~/.dsh/logs。
  // 绝对路径三级来源：① 宿主半边经 settings 注入的只读 logPath（权威，尊重 DSH_HOME）；
  // ② remote.$host.home + .dsh/logs/…（宿主半边未重载时也能用，无需重启内核）；③ 空 → 退化为复制路径。
  const logAbsolute = () => {
    for (const layer of [snap && snap.value, snap && snap.base]) {
      if (layer && typeof layer.logPath === 'string' && layer.logPath !== '') return layer.logPath
    }
    return logPathFromHome(hostHome ? hostHome() : '')
  }

  const copyLogPath = () => {
    const absolute = logAbsolute()
    const text = absolute !== '' ? absolute : L.logFile
    const bridge = typeof window === 'undefined' ? undefined : window.dshDesktop
    if (bridge && typeof bridge.copyText === 'function') {
      try { bridge.copyText(text); setLogMsg('copied'); return } catch (error) { /* 落到浏览器剪贴板 */ }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(
        () => setLogMsg('copied'),
        () => setLogMsg('manual'),
      )
      return
    }
    setLogMsg('manual')
  }

  // 宿主路径还没到位（宿主半边未重载 / 浏览器环境）时退化为复制路径，
  // 而不是跳到错误的目录去。
  const openLog = () => {
    const bridge = typeof window === 'undefined' ? undefined : window.dshDesktop
    const absolute = logAbsolute()
    if (bridge && absolute !== '' && typeof bridge.openPath === 'function') {
      try { bridge.openPath(absolute); setLogMsg(null); return } catch (error) { /* 落到复制兜底 */ }
    }
    copyLogPath()
  }
  const jPct = Math.round(draft.jitterRatio * 100) + '%'
  const retryStatus = draft.enabled
    ? L.statusOn(draft.maxRetries, draft.initialDelayMs, draft.maxDelayMs, jPct, draft.retryableCodes.length)
    : L.statusOff
  const status = retryStatus + ' · ' + (draft.autoContinue ? L.continueOn(draft.maxContinuations) : L.continueOff)

  // ── 滚动流畅性（2026-10-04）────────────────────────────────────────────────
  // 症状：本分区高 ~1977px，DSH 设置面板的滚动容器（.VOzbGW_options，clientH 915 /
  //   scrollH 2026）**没有合成层提示** ⇒ 滚动时每帧都要重栅格化整块内容。
  // 量具：真窗口 1600×1000 + `--force_low_power_gpu` + CDP 真实滚轮事件（165Hz，帧预算
  //   6.06ms；无头走软渲染，数字不可信）。基线：静止 p50 6.1ms 满帧，滚动 p50 12.1~18.1ms /
  //   p95 24.3ms / p99 30ms / max 79~152ms、**11~13 帧超 16.7ms**；程序化跳滚更差
  //   （63/146 帧超预算，总时长 1866ms）。
  // 修法：给「真正在滚的那个祖先」加 `will-change:scroll-position`（语义即「此容器会滚」，
  //   不建无条件层、不改布局、视觉零差异）⇒ 实测 p50 6.1ms / p95 6.2ms / **0-of-410 帧
  //   超预算**，总时长 1866ms → 604ms。
  // 为什么用 JS 沿祖先找，而不是 CSS 结构选择器（如 `div:has(> div > .dlr-card)`）：
  //   宿主槽位结构在 0.1.6→0.2.1 之间变过，结构选择器会**静默失效**；沿祖先只认
  //   「overflow-y 可滚且内容溢出」这一事实，与层级、类名都无关。两种下发方式实测等价
  //   （各 4 轮：超标 4/1795 帧 vs 1/1649 帧）。
  // ★ 本分区已实测否掉、勿再加回来：
  //   · `content-visibility:auto` —— 本分区列表太短，行级 74~91 帧超标、子块级 85 帧；
  //   · 删掉 .dlr-card 的 `contain:layout paint` —— 15 → 47~58 帧超标，它在这里是**净收益**
  //     （与混元那边「contain 加在滚动容器上更差」不矛盾：那边加在滚动容器自身）；
  //   · 给 .dlr-card 加 will-change —— 它不是滚动容器，86/125 帧超标；
  //   · 把 .dlr-card 改成自带滚动容器 —— 有效（0~1/125）但改交互形态，不必要。
  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    let target = null
    let prev = ''
    const apply = () => {
      if (target && target.isConnected) return
      let el = card.parentElement
      for (let i = 0; i < 8 && el; i += 1) {
        const cs = getComputedStyle(el)
        const scrolls =
          (cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflowY === 'overlay') &&
          el.scrollHeight > el.clientHeight + 2
        if (scrolls) {
          // 宿主若已自行内联声明 will-change，就不覆盖它的选择
          if (el.style.willChange !== '') return
          prev = el.style.willChange
          el.style.willChange = 'scroll-position'
          target = el
          return
        }
        el = el.parentElement
      }
    }
    apply()
    // 内容长高（加覆盖行 / 展开日志）之后才变成可滚的情况：尺寸变化时再找一次
    let ro = null
    try {
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => apply())
        ro.observe(card)
      }
    } catch { /* 无 ResizeObserver 的内核：只在挂载时应用一次 */ }
    return () => {
      try { if (ro) ro.disconnect() } catch { /* ignore */ }
      try { if (target && target.isConnected) target.style.willChange = prev } catch { /* ignore */ }
    }
  }, [])

  return (
    <div className="dlr-card" ref={cardRef}>
      <div className="dlr-head">
        <div className="dlr-headTop">
          <div className="dlr-headText">
            <div className="dlr-titleRow">
              <span className="dlr-title">{L.title}</span>
              <Badge on={draft.enabled} label={draft.enabled ? L.badgeOn : L.badgeOff} />
            </div>
            <span className="dlr-desc">{L.desc}</span>
          </div>
          <Switch
            checked={draft.enabled}
            disabled={!writable}
            label={L.title}
            title={draft.enabled ? L.badgeOn : L.badgeOff}
            onClick={() => update('enabled', !draft.enabled)}
          />
        </div>
        {/* 状态行整行宽：状态文字在左，保存控件右对齐到卡片右边缘（与上面的开关同一条竖线）。
            吸顶后随时可存，不必滚到卡片底部。 */}
        <div className="dlr-statusRow">
          <span className="dlr-status">{status}</span>
          <div className="dlr-headActions">
            {dirty && <span className="dlr-dirtyHint">{L.dirtyHint}</span>}
            {saveState === 'fail' && <span className="dlr-fail">{L.saveFailed}</span>}
            {saveState === 'ok' && <span className="dlr-ok">{L.saved}</span>}
            {dirty && saveState !== 'saving' && <button type="button" className="dlr-revertBtn" onClick={revert}>{L.revert}</button>}
            <button type="button" className="dlr-saveBtn" disabled={!writable || !dirty || saveState === 'saving'} onClick={save}>
              {saveState === 'saving' ? L.saving : L.save}
            </button>
          </div>
        </div>
        {ready && !hostFresh && <span className="dlr-fail">{L.hostStale}</span>}
      </div>

      <div className="dlr-body">
        {/* ① 重试行为：次数/退避/抖动 + 退避曲线（曲线画的就是这几个字段，放同一块里） */}
        <div className={'dlr-block' + (draft.enabled ? '' : ' dlr-disabled')}>
          <div className="dlr-blockHead">
            <span className="dlr-groupTitle">{L.groupBehavior}</span>
          </div>
          <div className="dlr-grid">
            <NumberField label={L.fieldRetries} hint={L.fieldRetriesHint} value={draft.maxRetries}
              min={0} step={1} suffix={L.suffixTimes}
              disabled={!writable} dirty={draft.maxRetries !== current.maxRetries}
              onChange={(n) => update('maxRetries', n)} onEnter={save} />
            <NumberField label={L.fieldInitial} hint={L.fieldInitialHint} value={draft.initialDelayMs}
              min={1} step={100} suffix={L.suffixMs}
              disabled={!writable} dirty={draft.initialDelayMs !== current.initialDelayMs}
              onChange={(n) => update('initialDelayMs', n)} onEnter={save} />
            <NumberField label={L.fieldMax} hint={L.fieldMaxHint} value={draft.maxDelayMs}
              min={1} step={500} suffix={L.suffixMs}
              disabled={!writable} dirty={draft.maxDelayMs !== current.maxDelayMs}
              onChange={(n) => update('maxDelayMs', n)} onEnter={save} />
            {/* 本字段是 0~1 的比例（见 hint）；原先带 "%" 后缀会把 0.1 显示成「0.1 %」，
                而同屏状态行写的是「抖动 10%」——同一份数据两种读法。去掉后缀，输入框只放比例。 */}
            <NumberField label={L.fieldJitter} hint={L.fieldJitterHint} value={draft.jitterRatio}
              min={0} max={1} step={0.05} float
              disabled={!writable} dirty={draft.jitterRatio !== current.jitterRatio}
              onChange={(n) => update('jitterRatio', n)} onEnter={save} />
          </div>
          <BackoffViz
            maxRetries={draft.maxRetries}
            initialDelayMs={draft.initialDelayMs}
            maxDelayMs={draft.maxDelayMs}
            jitterRatio={draft.jitterRatio}
          />
        </div>

        {/* ② 错误码：哪些错误值得重试 */}
        <div className={'dlr-block' + (draft.enabled ? '' : ' dlr-disabled')}>
          <div className="dlr-blockHead">
            <span className="dlr-groupTitle">{L.groupCodes}</span>
          </div>
          <div className="dlr-chipOuter">
            <CodeChips
              selected={draft.retryableCodes}
              disabled={!writable}
              onToggle={toggleCode}
              onClear={() => update('retryableCodes', [])}
              onAdd={addCode}
            />
            {addMsg && (
              <span className={'dlr-chipHint' + (addMsg.kind === 'bad' ? ' dlr-addWarn' : '')}>
                {addMsg.kind === 'dup' ? L.codesAddDup(addMsg.code) : L.codesAddBad(addMsg.code)}
              </span>
            )}
            <span className="dlr-chipHint">{L.fieldCodesHint}</span>
          </div>
        </div>

        {/* ③ 覆盖规则：按 provider/model 单独设策略 */}
        <div className={'dlr-block' + (draft.enabled ? '' : ' dlr-disabled')}>
          <div className="dlr-blockHead">
            <span className="dlr-groupTitle">{L.groupOverrides}</span>
          </div>
          <OverridesEditor
            rows={draft.overrides}
            disabled={!writable}
            onChange={(rows) => update('overrides', rows)}
          />
        </div>

        {/* ④ 自动续写：与重试是两条独立通路——max-tokens 不是错误，重试策略永远碰不到它，
            所以这里的开关不受上方 enabled 影响，也不随上方一起置灰。 */}
        <div className="dlr-block">
          <div className="dlr-blockHead">
            <span className="dlr-groupTitle">{L.groupContinue}</span>
            <Switch
              checked={draft.autoContinue}
              disabled={!writable}
              label={L.groupContinue}
              title={draft.autoContinue ? L.switchOn : L.switchOff}
              onClick={() => update('autoContinue', !draft.autoContinue)}
            />
          </div>
          <span className="dlr-note">{L.continueHint}</span>
          <div className={'dlr-blockBody' + (draft.autoContinue ? '' : ' dlr-disabled')}>
            <div className="dlr-grid">
              <NumberField label={L.fieldMaxContinue} hint={L.fieldMaxContinueHint} value={draft.maxContinuations}
                min={0} step={1} suffix={L.suffixTimes}
                disabled={!writable || !draft.autoContinue} dirty={draft.maxContinuations !== current.maxContinuations}
                onChange={(n) => update('maxContinuations', n)} onEnter={save} />
            </div>
            {draft.autoContinue && draft.maxContinuations === 0 && (
              <span className="dlr-note">{L.continueZero}</span>
            )}
            <div className="dlr-switchRow">
              <Switch
                checked={draft.continueOnError}
                disabled={!writable || !draft.autoContinue}
                label={L.continueOnError}
                title={draft.continueOnError ? L.switchOn : L.switchOff}
                onClick={() => update('continueOnError', !draft.continueOnError)}
              />
              <div className="dlr-switchText">
                <span className="dlr-groupTitle">{L.continueOnError}</span>
                <span className="dlr-note">{L.continueOnErrorHint}</span>
              </div>
            </div>
            <div className="dlr-cell">
              <div className="dlr-cellHead">
                <span className="dlr-cellLabel">{L.fieldPromptTemplate}</span>
              </div>
              <select
                className="dlr-input"
                disabled={!writable || !draft.autoContinue}
                value="__pick"
                onChange={(e) => {
                  const picked = e.target.value
                  const tpl = templatesOf(detectLang()).find((t) => t.id === picked)
                  if (tpl) update('continuationPrompt', tpl.text)
                  // 受控值恒为占位项：选同一个模板两次也要弹回去
                  e.target.value = '__pick'
                }}
              >
                <option value="__pick">{L.promptTemplatePick}</option>
                {templatesOf(detectLang()).map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>{tpl.label}</option>
                ))}
              </select>
              <span className="dlr-cellHint">{L.promptTemplateHint}</span>
            </div>
            <PromptField
              label={L.fieldPrompt}
              hint={L.fieldPromptHint}
              value={draft.continuationPrompt}
              placeholder={L.fieldPromptPlaceholder}
              disabled={!writable || !draft.autoContinue}
              dirty={draft.continuationPrompt !== current.continuationPrompt}
              onChange={(v) => update('continuationPrompt', v)}
            />
            <span className="dlr-note">{promptStateLabel(L, draft.continuationPrompt)}</span>
            {draft.autoContinue && <span className="dlr-note">{L.continueLog}</span>}
          </div>
        </div>

        {/* 观测面板：同源 fetch 只读路由；挂载与手动刷新各拉一次，不轮询。 */}
        <StatsPanel logPath={logAbsolute()} live={hostFresh} lang={detectLang()} />
      </div>

      {/* ⑥ 排错日志：按钮用宿主给出的绝对路径调壳层 openPath 打开日志目录；
          宿主路径未到位时退化为复制路径。 */}
      <div className="dlr-block">
        <div className="dlr-blockHead">
          <span className="dlr-groupTitle">{L.logTitle}</span>
          <button type="button" className="dlr-miniBtn" onClick={openLog}>{L.logOpen}</button>
        </div>
        <code className="dlr-logPath">{logAbsolute() !== '' ? logAbsolute() : L.logFile}</code>
        {logMsg === 'copied' && <span className="dlr-note">{L.logCopied}</span>}
        {logMsg === 'manual' && <span className="dlr-fail">{L.logManual}</span>}
      </div>
    </div>
  )
}


// ── 双版本设置作用域适配器（2026-09-22 起）─────────────────────────────────────
// 0.1.6 及以前：ctx.settingsScope.bind({ namespace }) 提供同步快照 + 订阅 + set/mutate。
// 0.1.7 起：settingsScope 服务被整体移除（内核改为 @deepseek-ai/dsh-settings，服务名 settings），
//           客户端只能经 ctx.remote.settings 走 RPC：describe() / update() / mutate()。
// 本适配器用 remote 路径复刻老 scope 的对外形状（getSnapshot/subscribe/set/mutate）；
// ops 形状（{op:'set',path,value}）两版一致，故组件层与调用点均无需改动。
function makeRemoteSettingsScope(ctx, namespace) {
  let remote
  try {
    remote = ctx && ctx.remote ? ctx.remote.settings : undefined
  } catch (error) {
    remote = undefined
  }
  if (!remote || typeof remote.describe !== 'function') return undefined
  let snap = { value: {} }
  let revision
  /** 实际生效的命名空间键：describe() 命中哪一行就用哪一行的 ns（0.1.7 = entry id）。 */
  let target = namespace
  const subs = new Set()
  const emit = () => {
    for (const fn of Array.from(subs)) {
      try {
        fn()
      } catch (error) {
        /* 单个订阅者异常不影响其他订阅者 */
      }
    }
  }
  const absorb = (view, hostWritable) => {
    if (!view || typeof view !== 'object') return
    snap = { value: view.value || {}, revision: view.revision, schema: view.schema, status: 'ready', writable: hostWritable !== false && view.writable !== false, base: view.base, user: view.user }
    revision = view.revision
    emit()
  }
  // 0.1.7 remote RPC 统一返回 {ok:true,value}|{ok:false,error} 信封（dsh-client-connection parseConnectionResponse）
  const unwrap = (resp) => (resp && typeof resp === 'object' && 'ok' in resp ? (resp.ok ? resp.value : undefined) : resp)
  const absorbResp = (resp) => {
    const view = unwrap(resp)
    if (view) absorb(view)
  }
  const refresh = () =>
    Promise.resolve()
      .then(() => remote.describe())
      .then((all) => {
        const payload = unwrap(all)
        const list = payload && payload.namespaces
        if (!Array.isArray(list)) return
        // 双键匹配：0.1.6 命中 NS，0.1.7 命中 entry id。
        const row = list.find((r) => r && (r.ns === namespace || NS_KEYS.indexOf(r.ns) >= 0))
        if (row) target = row.ns
        absorb(row, payload && payload.writable)
      })
      .catch(() => {
        // 首次失败多半是连接/装载竞态：1.5s 后单次重试，失败不再重试（不轮询）
        if (!retried) {
          retried = true
          scheduleRefresh(1500)
        }
      })
      .then((all) => {
        // describe 成功但没找到本插件的行（装载竞态）：同样给一次单发重试
        if (!retried && snap.status !== 'ready') {
          retried = true
          scheduleRefresh(1500)
        }
      })
  void refresh()
  let primed = false
  let retried = false
  let pending = null
  const scheduleRefresh = (delay) => {
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => {
      pending = null
      void refresh()
    }, delay)
  }
  try {
    if (ctx && ctx.remote && typeof ctx.remote.$on === 'function') {
      const off = ctx.remote.$on('settings/document-updated', (ns) => {
        if (NS_KEYS.indexOf(ns) >= 0) scheduleRefresh(200)
      })
      // $on 内部是 events.subscribe(this.ctx, …)：订阅挂在网关自己的 ctx 上，**不随本插件
      // fiber 释放**（官方写法即 ctx.effect(() => ctx.remote.$on(…))）。不回收的话每次热重载
      // 都累积一份监听，死 scope 每次设置变更都白跑一次 describe RPC；未触发的 200ms 定时器
      // 也会在卸载后继续跑。
      const dispose = () => {
        try {
          if (typeof off === 'function') off()
        } catch {
          /* 网关已释放 */
        }
        if (pending) {
          clearTimeout(pending)
          pending = null
        }
      }
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => dispose, PLUGIN_ID + ': settings document subscription')
      }
    }
  } catch (error) {
    /* 事件通道不可用：退回手动刷新 */
  }
  return {
    getSnapshot: () => snap,
    subscribe: (fn) => {
      subs.add(fn)
      if (!primed) {
        primed = true
        void refresh()
      }
      return () => {
        subs.delete(fn)
      }
    },
    set: (key, value) =>
      Promise.resolve()
        .then(() => remote.update(target, { [key]: value }, revision))
        .then(absorbResp)
        .then(() => undefined),
    mutate: (ops) =>
      Promise.resolve()
        .then(() => remote.mutate(target, ops, revision))
        .then(absorbResp)
        .then(() => undefined),
    refresh,
  }
}

export function apply(ctx) {
  ensureCss()
  // 语言：优先跟内核 locale 设置的 language 字段（有订阅就跟随切换），
  // 拿不到就退到 <html lang> / navigator.language（见 detectLang）。
  ctx.inject(['settingsScope'], (sctx) => {
  try {
    const localeScope = sctx.settingsScope.bind({ namespace: 'locale' })
    const readLang = () => {
      try {
        const localeSnap = localeScope.getSnapshot()
        const value = localeSnap && localeSnap.value
        return value && typeof value.language === 'string' ? value.language : ''
      } catch (error) {
        return ''
      }
    }
    const syncLang = () => {
      const lang = readLang()
      if (lang !== '') setLangOf(lang)
    }
    syncLang()
    try {
      localeScope.subscribe(syncLang)
    } catch (error) {
      /* 订阅不了就只读这一次 */
    }
  } catch (error) {
    /* locale 命名空间不存在：靠 html/浏览器语言 */
  }
  })
  // ctx.remote.$host.home = 宿主 OS 用户目录（dsh-api-remotes 传的 homedir()），
  // 用于在宿主半边还没重载时也能拼出 ~/.dsh/logs/... 的绝对路径。
  const hostHome = () => {
    try {
      const home = ctx.remote && ctx.remote.$host ? ctx.remote.$host.home : undefined
      return typeof home === 'string' ? home : ''
    } catch (error) {
      return ''
    }
  }

  let registered = false
  const registerSection = (scope) => {
    if (!scope || registered) return
    registered = true
    const useScope = bindSnapshotSelector(scope)
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'llm-retry-settings',
      order: 15,
      // 语言必须在这里现算，不能读模块级 L：设置页只渲染当前分区（宿主 `renderSlot(…, {only: active})`），
      // 本卡片没渲染过时 L 还是模块初值 ZH ⇒ 英文界面里导航项恒为中文；而宿主会把 thunk 结果缓存进
      // 导航行（仅在 slots 版本 / locale 变化时重算），卡片渲染本身不触发重算。
      label: () => (STR[detectLang()] || ZH).title,
      inject: () => ({ useScope, scope, hostHome })
    }, RetrySettingsRow), PLUGIN_ID + ': settings section')
  }
  // 0.1.6 路径：settingsScope（软注入 ⇒ 服务不存在也不会让 entry 卡 pending）
  ctx.inject(['settingsScope'], (sctx) => {
    try {
      registerSection(sctx.settingsScope.bind({ namespace: NS }))
    } catch (error) {
      /* 落到新路径 */
    }
  })
  // 0.1.7 路径：ctx.remote.settings
  ctx.inject(['remote.settings'], (sctx) => {
    try {
      registerSection(makeRemoteSettingsScope(sctx, NS))
    } catch (error) {
      /* 无设置服务：不注册分区，其余功能不受影响 */
    }
  })
}

export const inject = ['slots', 'remote']
