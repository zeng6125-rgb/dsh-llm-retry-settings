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

import { useState, useCallback, useSyncExternalStore } from 'react'

// [rc.8 compat] dsh-client-web-react 移除了静态模块导出；
// bindSnapshotSelector 本是 uSES selector bridge，这里用 useSyncExternalStore 内联等价实现。
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
const CODE_CATEGORIES = [
  { id: 'transient', label: '瞬时故障', note: '重试通常能恢复' },
  { id: 'quota', label: '限流与配额', note: '退避后可能恢复' },
  { id: 'request', label: '请求与参数', note: '多为确定性错误' },
  { id: 'content', label: '内容与能力', note: '模型不支持，重试无意义' },
  { id: 'auth', label: '凭证与鉴权', note: '先修配置' },
  { id: 'misc', label: '取消与兜底', note: '慎选' },
]

const KNOWN_CODES = [
  // —— 瞬时故障 ——
  { code: 'SERVER', cat: 'transient', desc: 'HTTP 5xx 服务端错误' },
  { code: 'TIMEOUT', cat: 'transient', desc: '请求超时：整次请求未在时限内返回；SSE 卡流（stream idle 看门狗）也以此码上报' },
  { code: 'TRANSPORT', cat: 'transient', desc: '网络中断、连接重置、流提前结束' },
  { code: 'EMPTY_RESPONSE', cat: 'transient', desc: '流正常结束但零内容块；重试安全' },
  { code: 'STREAM_CLOSED', cat: 'transient', desc: 'deepseek SSE 流未收到 [DONE] 就断开' },
  { code: 'MALFORMED_RESPONSE', cat: 'transient', desc: 'SSE 数据帧格式损坏' },
  { code: 'INVALID_RESPONSE', cat: 'transient', desc: '响应结构不符合预期（偶发可试）' },
  { code: 'PI_AI_ERROR', cat: 'transient', desc: 'pi-ai 兜底未知错误；STREAM_ERROR 流式失败归此类' },
  { code: 'PI_AI_NOT_WARMED', cat: 'transient', desc: 'pi-ai 适配器尚未预热完成就被调用（启动竞态）；退避后重试通常能成' },
  // —— 限流与配额 ——
  { code: 'RATE_LIMIT', cat: 'quota', desc: '429 限流' },
  { code: 'QUOTA', cat: 'quota', warn: true, desc: '配额/余额耗尽（规范字面值就是 QUOTA）；重试无意义' },
  // —— 请求与参数 ——
  { code: 'INVALID_REQUEST', cat: 'request', desc: '400 类请求被拒（如 thinking 模式 reasoning_text 冲突、payload 超限）' },
  { code: 'CONTEXT_WINDOW_EXCEEDED', cat: 'request', warn: true, desc: '上下文超窗；重试同样失败，应压缩上下文' },
  { code: 'UNSUPPORTED_OPTION', cat: 'request', warn: true, desc: '适配器不支持该生成参数（如 stop）；改参数而非重试' },
  { code: 'UNKNOWN_MODEL', cat: 'request', warn: true, desc: '请求的模型不在目录；重试同样失败，应改模型选择' },
  { code: 'REQUEST_EXTENSION', cat: 'request', warn: true, desc: 'deepseek 请求扩展（图片/搜索等）准备或受理失败（extension field 冲突等）；多为确定性错误' },
  { code: 'INVALID_REPLAY_STATE', cat: 'request', warn: true, desc: 'pi-ai 重放状态损坏（内部管线错误）' },
  // —— 内容与能力 ——
  { code: 'UNSUPPORTED_CONTENT', cat: 'content', warn: true, desc: '该模型不支持此类内容（如图片）' },
  { code: 'UNSUPPORTED_REASONING_EFFORT', cat: 'content', warn: true, desc: '该模型不支持所选推理档位' },
  { code: 'FILES_API', cat: 'content', warn: true, desc: 'deepseek 文件服务 HTTP 失败' },
  // —— 凭证与鉴权 ——
  { code: 'AUTH', cat: 'auth', warn: true, desc: '401/403 认证被拒；修密钥而非重试' },
  { code: 'INVALID_CREDENTIAL', cat: 'auth', warn: true, desc: '凭证格式非法；修正存储值' },
  { code: 'MISSING_CREDENTIAL', cat: 'auth', warn: true, desc: '缺少 API Key；先去模型页配置' },
  // —— 取消与兜底 ——
  { code: 'ABORTED', cat: 'misc', warn: true, desc: '调用方主动取消；绝不应重试' },
  { code: 'UNKNOWN', cat: 'misc', warn: true, desc: '非 LlmError 的通用兜底；勾选=广撒网' },
]

const KNOWN_CODE_SET = new Set(KNOWN_CODES.map((k) => k.code))

const L = {
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
  codesCustomHint: '不在已知清单内（provider 配置手工加的）',
  groupContinue: '输出截断自动续写',
  switchOn: '开启',
  switchOff: '关闭',
  continueHint: '回答被输出 token 上限截断时（宿主会显示「已达到输出 token 上限」），自动替你发一条「继续」，'
    + '模型接着上文往下写。这不是请求失败，上面的重试策略管不到它；两者互不影响。',
  continueWarn: '每次续写都会带着完整上下文再跑一轮，会额外消耗 token。',
  continueZero: '次数为 0：开关虽开，实际不会补写任何一轮。',
  fieldMaxContinue: '最多连续续写',
  fieldMaxContinueHint: '同一次截断后连续补写的次数上限；模型正常说完或你重新发言即重新计数',
  suffixTimes: '次',
  suffixMs: 'ms',
  save: '保存',
  revert: '放弃',
  saving: '保存中…',
  saved: '已保存 ✓',
  saveFailed: '保存失败 ✗（重试或刷新页面；宿主日志见 settings-rejected）',
  dirtyHint: '有未保存的修改',
}

const CSS = [
  '.dlr-card{border-bottom:1px solid var(--dsw-alias-border-l2);padding:18px 0 20px;display:flex;flex-direction:column;gap:16px}',
  '.dlr-head{display:flex;align-items:flex-start;gap:12px}',
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
  '.dlr-switch{width:44px;height:26px;flex:none;background:var(--dsw-alias-interactive-bg-hover);border:none;border-radius:999px;position:relative;cursor:pointer;transition:background .15s;padding:0;margin-top:2px}',
  '.dlr-switch[aria-checked=true]{background:var(--dsw-alias-state-business-primary)}',
  '.dlr-switch:disabled{opacity:.5;cursor:default}',
  '.dlr-knob{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform .15s}',
  '.dlr-switch[aria-checked=true] .dlr-knob{transform:translateX(18px)}',

  '.dlr-body{display:flex;flex-direction:column;gap:16px}',
  '.dlr-section{display:flex;flex-direction:column;gap:12px}',
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

  '.dlr-chipsWrap{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}',
  '.dlr-chipOuter{display:flex;flex-direction:column;gap:6px}',
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

  '.dlr-actions{display:flex;align-items:center;gap:8px;justify-content:flex-end}',
  '.dlr-saveBtn{height:30px;padding:0 18px;border:none;border-radius:6px;background:var(--dsw-alias-state-business-primary);color:#fff;font-size:13px;cursor:pointer}',
  '.dlr-saveBtn:disabled{opacity:.5;cursor:default}',
  '.dlr-revertBtn{height:30px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer}',
  '.dlr-ok{color:var(--dsw-alias-state-success,#2e9e5b);font-size:13px}',
  '.dlr-fail{color:var(--dsw-alias-state-danger,#d54545);font-size:13px}',
  '.dlr-dirtyHint{color:var(--dsw-alias-state-business-primary);font-size:12px}',
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

function Chip({ code, title, warn, unknown, on, disabled, onClick }) {
  return (
    <button
      type="button"
      title={title}
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

function CodeChips({ selected, disabled, onToggle, onClear }) {
  const selSet = new Set(selected)
  const custom = selected.filter((c) => !KNOWN_CODE_SET.has(c))
  const chip = ({ code, desc, warn }) => (
    <Chip key={code} code={code} title={desc} warn={warn} on={selSet.has(code)}
      disabled={disabled} onClick={() => onToggle(code)} />
  )
  return (
    <div className="dlr-chipsWrap">
      {custom.length > 0 && (
        <div className="dlr-chipGroup">
          <span className="dlr-chipGroupLabel">
            {L.codesCustom}
            <em>{L.codesCustomHint}</em>
          </span>
          <div className="dlr-chips">
            {custom.map((code) => (
              <Chip key={code} code={code} title="自定义错误码（provider 配置里手工加入的），点击取消勾选"
                unknown on disabled={disabled} onClick={() => onToggle(code)} />
            ))}
          </div>
        </div>
      )}
      {CODE_CATEGORIES.map((cat) => {
        const items = KNOWN_CODES.filter((k) => k.cat === cat.id)
        if (items.length === 0) return null
        // 组内仍是「已选靠前」+ 其余按 KNOWN_CODES 规范顺序（v0.1.5 行为），
        // 分组只决定行归属，勾选不会让 chip 跳到别的组去。
        const picked = items.filter((k) => selSet.has(k.code))
        const others = items.filter((k) => !selSet.has(k.code))
        return (
          <div className="dlr-chipGroup" key={cat.id}>
            <span className="dlr-chipGroupLabel">
              {cat.label}
              {cat.note ? <em>{cat.note}</em> : null}
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
  }
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function RetrySettingsRow({ useScope, scope }) {
  const snap = useScope((s) => s)
  const ready = snap && snap.status === 'ready'
  const current = projectValue((ready && snap.value) || {})
  const writable = !!(ready && snap.writable)

  const [draft, setDraft] = useState(current)
  const [saveState, setSaveState] = useState(null) // null | 'saving' | 'ok' | 'fail'

  // 外部变更跟随（渲染期调整，无 effect 竞态）：快照变化时，草稿若仍是旧快照的
  // 原样（用户没改过）就跟随更新；用户改过则保留草稿（dirty）
  const currentKey = JSON.stringify(current)
  const [prevKey, setPrevKey] = useState(currentKey)
  if (currentKey !== prevKey) {
    setPrevKey(currentKey)
    if (JSON.stringify(draft) === prevKey) setDraft(current)
  }

  const dirty = !sameJson(draft, current)
  const update = (field, v) => setDraft((d) => ({ ...d, [field]: v }))
  const toggleCode = (code) =>
    setDraft((d) => {
      const cur = Array.isArray(d.retryableCodes) ? d.retryableCodes : []
      if (cur.includes(code)) return { ...d, retryableCodes: cur.filter((c) => c !== code) }
      return { ...d, retryableCodes: [...cur, code] }
    })

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

  const jPct = Math.round(draft.jitterRatio * 100) + '%'
  const retryStatus = draft.enabled
    ? L.statusOn(draft.maxRetries, draft.initialDelayMs, draft.maxDelayMs, jPct, draft.retryableCodes.length)
    : L.statusOff
  const status = retryStatus + ' · ' + (draft.autoContinue ? L.continueOn(draft.maxContinuations) : L.continueOff)

  return (
    <div className="dlr-card">
      <div className="dlr-head">
        <div className="dlr-headText">
          <div className="dlr-titleRow">
            <span className="dlr-title">{L.title}</span>
            <Badge on={draft.enabled} label={draft.enabled ? L.badgeOn : L.badgeOff} />
          </div>
          <span className="dlr-desc">{L.desc}</span>
          <span className="dlr-status">{status}</span>
        </div>
        <Switch
          checked={draft.enabled}
          disabled={!writable}
          label={L.title}
          title={draft.enabled ? L.badgeOn : L.badgeOff}
          onClick={() => update('enabled', !draft.enabled)}
        />
      </div>

      <div className="dlr-body">
        <div className={'dlr-section' + (draft.enabled ? '' : ' dlr-disabled')}>
          <span className="dlr-groupTitle">{L.groupBehavior}</span>
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
            <NumberField label={L.fieldJitter} hint={L.fieldJitterHint} value={draft.jitterRatio}
              min={0} max={1} step={0.05} float suffix="%"
              disabled={!writable} dirty={draft.jitterRatio !== current.jitterRatio}
              onChange={(n) => update('jitterRatio', n)} onEnter={save} />
          </div>

          <span className="dlr-groupTitle">{L.groupCodes}</span>
          <div className="dlr-chipOuter">
            <CodeChips
              selected={draft.retryableCodes}
              disabled={!writable}
              onToggle={toggleCode}
              onClear={() => update('retryableCodes', [])}
            />
            <span className="dlr-chipHint">{L.fieldCodesHint}</span>
          </div>
        </div>

        {/* 自动续写与重试是两条独立通路：max-tokens 不是错误，重试策略永远碰不到它，
            所以这里的开关不受上方 enabled 影响，也不随上方一起置灰。 */}
        <div className="dlr-section">
          <div className="dlr-switchRow">
            <Switch
              checked={draft.autoContinue}
              disabled={!writable}
              label={L.groupContinue}
              title={draft.autoContinue ? L.switchOn : L.switchOff}
              onClick={() => update('autoContinue', !draft.autoContinue)}
            />
            <div className="dlr-switchText">
              <span className="dlr-groupTitle">{L.groupContinue}</span>
              <span className="dlr-note">{L.continueHint}</span>
            </div>
          </div>
          <div className={'dlr-section' + (draft.autoContinue ? '' : ' dlr-disabled')}>
            <div className="dlr-grid">
              <NumberField label={L.fieldMaxContinue} hint={L.fieldMaxContinueHint} value={draft.maxContinuations}
                min={0} step={1} suffix={L.suffixTimes}
                disabled={!writable} dirty={draft.maxContinuations !== current.maxContinuations}
                onChange={(n) => update('maxContinuations', n)} onEnter={save} />
            </div>
            {draft.autoContinue && draft.maxContinuations === 0 && (
              <span className="dlr-note">{L.continueZero}</span>
            )}
            {draft.autoContinue && <span className="dlr-note">{L.continueWarn}</span>}
          </div>
        </div>
      </div>

      <div className="dlr-actions">
        {dirty && <span className="dlr-dirtyHint">{L.dirtyHint}</span>}
        {saveState === 'fail' && <span className="dlr-fail">{L.saveFailed}</span>}
        {saveState === 'ok' && <span className="dlr-ok">{L.saved}</span>}
        {dirty && saveState !== 'saving' && <button type="button" className="dlr-revertBtn" onClick={revert}>{L.revert}</button>}
        <button type="button" className="dlr-saveBtn" disabled={!writable || !dirty || saveState === 'saving'} onClick={save}>
          {saveState === 'saving' ? L.saving : L.save}
        </button>
      </div>
    </div>
  )
}

export function apply(ctx) {
  ensureCss()
  const scope = ctx.settingsScope.bind({ namespace: NS })
  const useScope = bindSnapshotSelector(scope)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'llm-retry-settings',
    order: 15,
    label: () => 'LLM 自动重试',
    inject: () => ({ useScope, scope })
  }, RetrySettingsRow), PLUGIN_ID + ': settings section')
}

export const inject = ['slots', 'settingsScope']
