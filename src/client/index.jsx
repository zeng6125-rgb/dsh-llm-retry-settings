/**
 * @dsh-external/dsh-llm-retry-settings — 客户端设置 UI（设置 → 独立分区「LLM 自动重试」）
 *
 * 绑定宿主 @deepseek-ai/dsh-llm-retry 注册的 `dsh-llm-retry` 命名空间：
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
const PLUGIN_ID = '@dsh-external/dsh-llm-retry-settings'
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

const DEFAULTS = {
  enabled: false,
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  jitterRatio: 0.1,
  retryableCodes: ['INVALID_REQUEST', 'PI_AI_ERROR'],
}

// 已知错误码全集：核心 dsh-llm 规范码 + pi-ai/deepseek 两个适配器可能产出的全部
// failure.code（扫自 node_modules 实际源码）。warn=true 的码重试基本无意义，
// 仅特殊场景手动勾选；列表之外的码（provider 手工配置）以「自定义」虚线 chip 出现。
const KNOWN_CODES = [
  // —— 常用（瞬时故障，重试有恢复价值）——
  { code: 'RATE_LIMIT', desc: '429 限流' },
  { code: 'SERVER', desc: 'HTTP 5xx 服务端错误' },
  { code: 'TIMEOUT', desc: '请求超时/流空闲超时' },
  { code: 'TRANSPORT', desc: '网络中断、连接重置、流提前结束' },
  { code: 'EMPTY_RESPONSE', desc: '流正常结束但零内容块；重试安全' },
  { code: 'INVALID_REQUEST', desc: '400 类请求被拒（如 thinking 模式 reasoning_text 冲突、payload 超限）' },
  { code: 'PI_AI_ERROR', desc: 'pi-ai 兜底未知错误；STREAM_ERROR 流式失败归此类' },
  { code: 'STREAM_CLOSED', desc: 'deepseek SSE 流未收到 [DONE] 就断开' },
  { code: 'MALFORMED_RESPONSE', desc: 'SSE 数据帧格式损坏' },
  { code: 'INVALID_RESPONSE', desc: '响应结构不符合预期（偶发可试）' },
  // —— 谨慎（重试通常无意义，琥珀色提示）——
  { code: 'CONTEXT_WINDOW_EXCEEDED', warn: true, desc: '上下文超窗；重试同样失败，应压缩上下文' },
  { code: 'QUOTA', warn: true, desc: '配额/余额耗尽（规范字面值就是 QUOTA）；重试无意义' },
  { code: 'AUTH', warn: true, desc: '401/403 认证被拒；修密钥而非重试' },
  { code: 'INVALID_CREDENTIAL', warn: true, desc: '凭证格式非法；修正存储值' },
  { code: 'MISSING_CREDENTIAL', warn: true, desc: '缺少 API Key；先去模型页配置' },
  { code: 'UNSUPPORTED_CONTENT', warn: true, desc: '该模型不支持此类内容（如图片）' },
  { code: 'UNSUPPORTED_REASONING_EFFORT', warn: true, desc: '该模型不支持所选推理档位' },
  { code: 'FILES_API', warn: true, desc: 'deepseek 文件服务 HTTP 失败' },
  { code: 'INVALID_REPLAY_STATE', warn: true, desc: 'pi-ai 重放状态损坏（内部管线错误）' },
  { code: 'ABORTED', warn: true, desc: '调用方主动取消；绝不应重试' },
  { code: 'UNKNOWN', warn: true, desc: '非 LlmError 的通用兜底；勾选=广撒网' },
]

const L = {
  title: 'LLM 自动重试',
  desc: '模型请求失败时的自动恢复策略。开启后以本卡片值为准覆盖各 provider 的重试次数与退避时间。',
  badgeOn: '覆盖已开启',
  badgeOff: '未开启',
  statusOff: '沿用各 provider 自带的重试策略',
  statusOn: (n, init, max, j, c) => `最多重试 ${n} 次 · 退避 ${init}ms→${max}ms · 抖动 ${j} · 补充 ${c} 个错误码`,
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
  fieldCodesHint: '勾选的码与 provider 内置列表取并集（不覆盖已有码）。琥珀色 = 重试通常无意义，慎选；STREAM_ERROR 流式失败归入 PI_AI_ERROR。列表外的码以虚线自定义 chip 出现。',
  codesNone: '未勾选任何补充码——仅按 provider 内置码重试',
  codesCount: (n) => `将补充 ${n} 个错误码`,
  codesClear: '清空',
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

  '.dlr-body{display:flex;flex-direction:column;gap:12px}',
  '.dlr-disabled{opacity:.55;pointer-events:none}',
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

function CodeChips({ selected, disabled, onToggle, onClear }) {
  const selSet = new Set(selected)
  const known = KNOWN_CODES.map((k) => k.code)
  const custom = selected.filter((c) => !known.includes(c))
  return (
    <div className="dlr-chipsWrap">
      <div className="dlr-chips">
        {KNOWN_CODES.map(({ code, desc, warn }) => (
          <button
            key={code}
            type="button"
            title={desc}
            className={'dlr-chip' + (warn ? ' warn' : '') + (selSet.has(code) ? ' on' : '')}
            disabled={disabled}
            onClick={() => onToggle(code)}
          >
            {code}
          </button>
        ))}
        {custom.map((code) => (
          <button
            key={code}
            type="button"
            title="自定义错误码（provider 配置里手工加入的），点击取消勾选"
            className="dlr-chip unknown on"
            disabled={disabled}
            onClick={() => onToggle(code)}
          >
            {code}
          </button>
        ))}
      </div>
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

function projectValue(value) {
  return {
    enabled: value.enabled !== false,
    maxRetries: typeof value.maxRetries === 'number' ? value.maxRetries : DEFAULTS.maxRetries,
    initialDelayMs: typeof value.initialDelayMs === 'number' ? value.initialDelayMs : DEFAULTS.initialDelayMs,
    maxDelayMs: typeof value.maxDelayMs === 'number' ? value.maxDelayMs : DEFAULTS.maxDelayMs,
    jitterRatio: typeof value.jitterRatio === 'number' ? value.jitterRatio : DEFAULTS.jitterRatio,
    retryableCodes: (Array.isArray(value.retryableCodes) ? value.retryableCodes : [])
      .filter((c) => typeof c === 'string' && c.length > 0),
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
  const status = draft.enabled
    ? L.statusOn(draft.maxRetries, draft.initialDelayMs, draft.maxDelayMs, jPct, draft.retryableCodes.length)
    : L.statusOff

  return (
    <div className="dlr-card">
      <div className="dlr-head">
        <div className="dlr-headText">
          <div className="dlr-titleRow">
            <span className="dlr-title">{L.title}</span>
            <Badge on={draft.enabled} label={draft.enabled ? L.badgeOn : L.badgeOff} />
          </div>
          <span className="dlr-desc">{L.desc}</span>
          <span className="dlr-status">{draft.enabled ? status : L.statusOff}</span>
        </div>
        <Switch
          checked={draft.enabled}
          disabled={!writable}
          label={L.title}
          title={draft.enabled ? L.badgeOn : L.badgeOff}
          onClick={() => update('enabled', !draft.enabled)}
        />
      </div>

      <div className={'dlr-body' + (draft.enabled ? '' : ' dlr-disabled')}>
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
