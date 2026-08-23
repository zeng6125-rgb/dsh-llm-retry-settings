/**
 * @dsh-external/dsh-llm-retry-settings — 客户端设置 UI（设置 → 独立分区「LLM 自动重试」）
 *
 * 绑定宿主 @deepseek-ai/dsh-llm-retry 注册的 `dsh-llm-retry` 命名空间：
 *  - ctx.settingsScope.bind({ namespace: 'dsh-llm-retry' })
 *  - 在 settings.section 槽位注册独立分区（设置页左侧导航项「LLM 自动重试」，
 *    不再混入通用设置的 General 卡片）
 *  - inject: ["slots", "settingsScope"]，运行时由客户端 runner 注入
 *
 * 交互模型（草稿 + 显式保存）：
 *  - 输入只改本地草稿，标脏（有未保存修改）；「保存」批量提交变更字段
 *  - 保存后轮询 scope 快照验证写入确实生效：✓ 已保存 / ✗ 保存失败（显式可见，
 *    不再静默——宿主 controller 会吞掉写入失败，例如 settings.yaml 孤儿锁超时）
 *  - 「放弃」回滚草稿到当前快照值；外部变更在未编辑时自动跟随
 *
 * 语义：enabled = 覆盖开关。开启后，LLM 自动重试的次数（maxRetries）与
 * 退避时间（initialDelayMs/maxDelayMs/jitterRatio）以本卡片值为准，
 * 覆盖各 provider 自带的重试策略（mode/retryableCodes 保留）。
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
}

const L = {
  title: 'LLM 自动重试',
  desc: '模型请求失败时（限流/服务端错误/超时等）自动重试的次数与退避时间。开启覆盖后，以本卡片设置的值为准；关闭则沿用各 provider 自带的重试策略。',
  enabledOn: '已开启覆盖',
  enabledOff: '已关闭',
  fieldRetries: '最大重试次数（maxRetries）',
  fieldRetriesHint: '失败后最多重试几次；0 = 不重试',
  fieldInitial: '初始退避（initialDelayMs）',
  fieldInitialHint: '第一次重试前等待的毫秒数；此后按指数增长',
  fieldMax: '最大退避（maxDelayMs）',
  fieldMaxHint: '退避时间封顶的毫秒数',
  fieldJitter: '抖动比例（jitterRatio）',
  fieldJitterHint: '0~1，给退避时间加随机抖动，避免同时重试（0 = 无抖动）',
  statusOn: (n, init, max, j) => `已开启覆盖 · 最多重试 ${n} 次 · 退避 ${init}ms→${max}ms · 抖动 ${j}`,
  statusOff: '未开启（沿用 provider 自带重试策略）',
  suffixMs: 'ms',
  suffixTimes: '次',
  save: '保存',
  revert: '放弃',
  saving: '保存中…',
  saved: '已保存 ✓',
  saveFailed: '保存失败 ✗（重试或刷新页面；宿主日志见 settings-rejected）',
  dirtyHint: '有未保存的修改',
}

const CSS = [
  '.dlr-card{border-bottom:1px solid var(--dsw-alias-border-l2);padding:16px 0;display:flex;flex-direction:column;gap:14px}',
  '.dlr-head{display:flex;align-items:center;gap:12px}',
  '.dlr-headText{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
  '.dlr-title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}',
  '.dlr-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
  '.dlr-switch{width:44px;height:26px;flex:none;background:var(--dsw-alias-interactive-bg-hover);border:none;border-radius:999px;position:relative;cursor:pointer;transition:background .15s;padding:0}',
  '.dlr-switch[aria-checked=true]{background:var(--dsw-alias-state-business-primary)}',
  '.dlr-switch:disabled{opacity:.5;cursor:default}',
  '.dlr-knob{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform .15s}',
  '.dlr-switch[aria-checked=true] .dlr-knob{transform:translateX(18px)}',
  '.dlr-fields{display:flex;flex-direction:column;gap:10px;padding-left:0}',
  '.dlr-field{display:flex;align-items:center;gap:10px;min-width:0}',
  '.dlr-fieldText{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
  '.dlr-fieldLabel{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
  '.dlr-fieldHint{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}',
  '.dlr-input{width:110px;flex:none;box-sizing:border-box;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;outline:none}',
  '.dlr-input:focus{border-color:var(--dsw-alias-state-business-primary)}',
  '.dlr-input:disabled{opacity:.5}',
  '.dlr-input.dirty{border-color:var(--dsw-alias-state-business-primary)}',
  '.dlr-status{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
  '.dlr-actions{display:flex;align-items:center;gap:8px;justify-content:flex-end}',
  '.dlr-saveBtn{height:28px;padding:0 16px;border:none;border-radius:6px;background:var(--dsw-alias-state-business-primary);color:#fff;font-size:12px;cursor:pointer}',
  '.dlr-saveBtn:disabled{opacity:.5;cursor:default}',
  '.dlr-revertBtn{height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}',
  '.dlr-ok{color:var(--dsw-alias-state-success, #2e9e5b);font-size:12px}',
  '.dlr-fail{color:var(--dsw-alias-state-danger, #d54545);font-size:12px}',
  '.dlr-dirtyHint{color:var(--dsw-alias-state-business-primary);font-size:11px}',
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

const clampInt = (n, min) => (Number.isFinite(n) ? Math.max(min, Math.floor(n)) : min)

function NumberField({ label, hint, value, min, step, disabled, dirty, onChange, onEnter, suffix }) {
  return (
    <div className="dlr-field">
      <div className="dlr-fieldText">
        <span className="dlr-fieldLabel">{label}</span>
        <span className="dlr-fieldHint">{hint}</span>
      </div>
      <input
        type="number"
        className={'dlr-input' + (dirty ? ' dirty' : '')}
        min={min}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(clampInt(Number(e.target.value), min))}
        onKeyDown={(e) => { if (e.key === 'Enter') onEnter() }}
      />
      {suffix ? <span className="dlr-fieldHint">{suffix}</span> : null}
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

  const save = useCallback(async () => {
    setSaveState('saving')
    try {
      for (const [k, v] of Object.entries(draft)) {
        if (current[k] !== v) await scope.set(k, v)
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

  const status = draft.enabled
    ? L.statusOn(draft.maxRetries, draft.initialDelayMs, draft.maxDelayMs, (Math.round(draft.jitterRatio * 100) / 100) * 100 + '%')
    : L.statusOff

  return (
    <div className="dlr-card">
      <div className="dlr-head">
        <div className="dlr-headText">
          <span className="dlr-title">{L.title}</span>
          <span className="dlr-desc">{L.desc}</span>
          <span className="dlr-status">{status}</span>
        </div>
        <Switch
          checked={draft.enabled}
          disabled={!writable}
          label={L.title}
          title={draft.enabled ? L.enabledOn : L.enabledOff}
          onClick={() => update('enabled', !draft.enabled)}
        />
      </div>
      <div className="dlr-fields" style={draft.enabled ? undefined : { opacity: 0.55, pointerEvents: 'none' }}>
        <NumberField label={L.fieldRetries} hint={L.fieldRetriesHint} value={draft.maxRetries} min={0} step={1}
          disabled={!writable} dirty={draft.maxRetries !== current.maxRetries}
          onChange={(n) => update('maxRetries', n)} onEnter={save} suffix={L.suffixTimes} />
        <NumberField label={L.fieldInitial} hint={L.fieldInitialHint} value={draft.initialDelayMs} min={1} step={100}
          disabled={!writable} dirty={draft.initialDelayMs !== current.initialDelayMs}
          onChange={(n) => update('initialDelayMs', n)} onEnter={save} suffix={L.suffixMs} />
        <NumberField label={L.fieldMax} hint={L.fieldMaxHint} value={draft.maxDelayMs} min={1} step={500}
          disabled={!writable} dirty={draft.maxDelayMs !== current.maxDelayMs}
          onChange={(n) => update('maxDelayMs', n)} onEnter={save} suffix={L.suffixMs} />
        <NumberField label={L.fieldJitter} hint={L.fieldJitterHint} value={draft.jitterRatio} min={0} step={0.05}
          disabled={!writable} dirty={draft.jitterRatio !== current.jitterRatio}
          onChange={(n) => update('jitterRatio', n)} onEnter={save} />
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
