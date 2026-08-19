window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-llm-retry-settings",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.jsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");
var import_dsh_client_web_react = require("@deepseek-ai/dsh-client-web-react");
var import_jsx_runtime = require("react/jsx-runtime");
var NS = "dsh-llm-retry";
var PLUGIN_ID = "@dsh-external/dsh-llm-retry-settings";
var CSS_TAG = PLUGIN_ID + "/client.css";
var DEFAULTS = {
  enabled: false,
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 1e4,
  jitterRatio: 0.1
};
var L = {
  title: "LLM \u81EA\u52A8\u91CD\u8BD5",
  desc: "\u6A21\u578B\u8BF7\u6C42\u5931\u8D25\u65F6\uFF08\u9650\u6D41/\u670D\u52A1\u7AEF\u9519\u8BEF/\u8D85\u65F6\u7B49\uFF09\u81EA\u52A8\u91CD\u8BD5\u7684\u6B21\u6570\u4E0E\u9000\u907F\u65F6\u95F4\u3002\u5F00\u542F\u8986\u76D6\u540E\uFF0C\u4EE5\u672C\u5361\u7247\u8BBE\u7F6E\u7684\u503C\u4E3A\u51C6\uFF1B\u5173\u95ED\u5219\u6CBF\u7528\u5404 provider \u81EA\u5E26\u7684\u91CD\u8BD5\u7B56\u7565\u3002",
  enabledOn: "\u5DF2\u5F00\u542F\u8986\u76D6",
  enabledOff: "\u5DF2\u5173\u95ED",
  fieldRetries: "\u6700\u5927\u91CD\u8BD5\u6B21\u6570\uFF08maxRetries\uFF09",
  fieldRetriesHint: "\u5931\u8D25\u540E\u6700\u591A\u91CD\u8BD5\u51E0\u6B21\uFF1B0 = \u4E0D\u91CD\u8BD5",
  fieldInitial: "\u521D\u59CB\u9000\u907F\uFF08initialDelayMs\uFF09",
  fieldInitialHint: "\u7B2C\u4E00\u6B21\u91CD\u8BD5\u524D\u7B49\u5F85\u7684\u6BEB\u79D2\u6570\uFF1B\u6B64\u540E\u6309\u6307\u6570\u589E\u957F",
  fieldMax: "\u6700\u5927\u9000\u907F\uFF08maxDelayMs\uFF09",
  fieldMaxHint: "\u9000\u907F\u65F6\u95F4\u5C01\u9876\u7684\u6BEB\u79D2\u6570",
  fieldJitter: "\u6296\u52A8\u6BD4\u4F8B\uFF08jitterRatio\uFF09",
  fieldJitterHint: "0~1\uFF0C\u7ED9\u9000\u907F\u65F6\u95F4\u52A0\u968F\u673A\u6296\u52A8\uFF0C\u907F\u514D\u540C\u65F6\u91CD\u8BD5\uFF080 = \u65E0\u6296\u52A8\uFF09",
  statusOn: (n, init, max, j) => `\u5DF2\u5F00\u542F\u8986\u76D6 \xB7 \u6700\u591A\u91CD\u8BD5 ${n} \u6B21 \xB7 \u9000\u907F ${init}ms\u2192${max}ms \xB7 \u6296\u52A8 ${j}`,
  statusOff: "\u672A\u5F00\u542F\uFF08\u6CBF\u7528 provider \u81EA\u5E26\u91CD\u8BD5\u7B56\u7565\uFF09",
  suffixMs: "ms",
  suffixTimes: "\u6B21",
  save: "\u4FDD\u5B58",
  revert: "\u653E\u5F03",
  saving: "\u4FDD\u5B58\u4E2D\u2026",
  saved: "\u5DF2\u4FDD\u5B58 \u2713",
  saveFailed: "\u4FDD\u5B58\u5931\u8D25 \u2717\uFF08\u91CD\u8BD5\u6216\u5237\u65B0\u9875\u9762\uFF1B\u5BBF\u4E3B\u65E5\u5FD7\u89C1 settings-rejected\uFF09",
  dirtyHint: "\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539"
};
var CSS = [
  ".dlr-card{border-bottom:1px solid var(--dsw-alias-border-l2);padding:16px 0;display:flex;flex-direction:column;gap:14px}",
  ".dlr-head{display:flex;align-items:center;gap:12px}",
  ".dlr-headText{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}",
  ".dlr-title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}",
  ".dlr-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
  ".dlr-switch{width:44px;height:26px;flex:none;background:var(--dsw-alias-interactive-bg-hover);border:none;border-radius:999px;position:relative;cursor:pointer;transition:background .15s;padding:0}",
  ".dlr-switch[aria-checked=true]{background:var(--dsw-alias-state-business-primary)}",
  ".dlr-switch:disabled{opacity:.5;cursor:default}",
  ".dlr-knob{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform .15s}",
  ".dlr-switch[aria-checked=true] .dlr-knob{transform:translateX(18px)}",
  ".dlr-fields{display:flex;flex-direction:column;gap:10px;padding-left:0}",
  ".dlr-field{display:flex;align-items:center;gap:10px;min-width:0}",
  ".dlr-fieldText{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}",
  ".dlr-fieldLabel{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}",
  ".dlr-fieldHint{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}",
  ".dlr-input{width:110px;flex:none;box-sizing:border-box;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;outline:none}",
  ".dlr-input:focus{border-color:var(--dsw-alias-state-business-primary)}",
  ".dlr-input:disabled{opacity:.5}",
  ".dlr-input.dirty{border-color:var(--dsw-alias-state-business-primary)}",
  ".dlr-status{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}",
  ".dlr-actions{display:flex;align-items:center;gap:8px;justify-content:flex-end}",
  ".dlr-saveBtn{height:28px;padding:0 16px;border:none;border-radius:6px;background:var(--dsw-alias-state-business-primary);color:#fff;font-size:12px;cursor:pointer}",
  ".dlr-saveBtn:disabled{opacity:.5;cursor:default}",
  ".dlr-revertBtn{height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}",
  ".dlr-ok{color:var(--dsw-alias-state-success, #2e9e5b);font-size:12px}",
  ".dlr-fail{color:var(--dsw-alias-state-danger, #d54545);font-size:12px}",
  ".dlr-dirtyHint{color:var(--dsw-alias-state-business-primary);font-size:11px}"
].join("");
function ensureCss() {
  if (typeof document === "undefined") return;
  if (document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG) + "]")) return;
  const tag = document.createElement("style");
  tag.dataset.plugin = PLUGIN_ID;
  tag.dataset.pluginCss = CSS_TAG;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}
function Switch({ checked, disabled, label, title, onClick }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "button",
    {
      type: "button",
      role: "switch",
      "aria-checked": checked,
      "aria-label": label,
      title,
      className: "dlr-switch",
      disabled,
      onClick,
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-knob" })
    }
  );
}
var clampInt = (n, min) => Number.isFinite(n) ? Math.max(min, Math.floor(n)) : min;
function NumberField({ label, hint, value, min, step, disabled, dirty, onChange, onEnter, suffix }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-fieldText", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-fieldLabel", children: label }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-fieldHint", children: hint })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        type: "number",
        className: "dlr-input" + (dirty ? " dirty" : ""),
        min,
        step,
        value,
        disabled,
        onChange: (e) => onChange(clampInt(Number(e.target.value), min)),
        onKeyDown: (e) => {
          if (e.key === "Enter") onEnter();
        }
      }
    ),
    suffix ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-fieldHint", children: suffix }) : null
  ] });
}
function projectValue(value) {
  return {
    enabled: value.enabled !== false,
    maxRetries: typeof value.maxRetries === "number" ? value.maxRetries : DEFAULTS.maxRetries,
    initialDelayMs: typeof value.initialDelayMs === "number" ? value.initialDelayMs : DEFAULTS.initialDelayMs,
    maxDelayMs: typeof value.maxDelayMs === "number" ? value.maxDelayMs : DEFAULTS.maxDelayMs,
    jitterRatio: typeof value.jitterRatio === "number" ? value.jitterRatio : DEFAULTS.jitterRatio
  };
}
var sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function RetrySettingsRow({ useScope, scope }) {
  const snap = useScope((s) => s);
  const ready = snap && snap.status === "ready";
  const current = projectValue(ready && snap.value || {});
  const writable = !!(ready && snap.writable);
  const [draft, setDraft] = (0, import_react.useState)(current);
  const [saveState, setSaveState] = (0, import_react.useState)(null);
  const currentKey = JSON.stringify(current);
  const [prevKey, setPrevKey] = (0, import_react.useState)(currentKey);
  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    if (JSON.stringify(draft) === prevKey) setDraft(current);
  }
  const dirty = !sameJson(draft, current);
  const update = (field, v) => setDraft((d) => ({ ...d, [field]: v }));
  const save = (0, import_react.useCallback)(async () => {
    setSaveState("saving");
    try {
      for (const [k, v] of Object.entries(draft)) {
        if (current[k] !== v) await scope.set(k, v);
      }
    } catch {
      setSaveState("fail");
      return;
    }
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 200));
      let latest = null;
      try {
        latest = projectValue(scope.getSnapshot().value || {});
      } catch {
        latest = null;
      }
      if (latest && sameJson(latest, draft)) {
        setSaveState("ok");
        setTimeout(() => setSaveState((s) => s === "ok" ? null : s), 2500);
        return;
      }
    }
    setSaveState("fail");
  }, [draft, current, scope]);
  const revert = () => {
    setDraft(current);
    setSaveState(null);
  };
  const status = draft.enabled ? L.statusOn(draft.maxRetries, draft.initialDelayMs, draft.maxDelayMs, Math.round(draft.jitterRatio * 100) / 100 * 100 + "%") : L.statusOff;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-card", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-headText", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-title", children: L.title }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-desc", children: L.desc }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-status", children: status })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Switch,
        {
          checked: draft.enabled,
          disabled: !writable,
          label: L.title,
          title: draft.enabled ? L.enabledOn : L.enabledOff,
          onClick: () => update("enabled", !draft.enabled)
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-fields", style: draft.enabled ? void 0 : { opacity: 0.55, pointerEvents: "none" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        NumberField,
        {
          label: L.fieldRetries,
          hint: L.fieldRetriesHint,
          value: draft.maxRetries,
          min: 0,
          step: 1,
          disabled: !writable,
          dirty: draft.maxRetries !== current.maxRetries,
          onChange: (n) => update("maxRetries", n),
          onEnter: save,
          suffix: L.suffixTimes
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        NumberField,
        {
          label: L.fieldInitial,
          hint: L.fieldInitialHint,
          value: draft.initialDelayMs,
          min: 1,
          step: 100,
          disabled: !writable,
          dirty: draft.initialDelayMs !== current.initialDelayMs,
          onChange: (n) => update("initialDelayMs", n),
          onEnter: save,
          suffix: L.suffixMs
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        NumberField,
        {
          label: L.fieldMax,
          hint: L.fieldMaxHint,
          value: draft.maxDelayMs,
          min: 1,
          step: 500,
          disabled: !writable,
          dirty: draft.maxDelayMs !== current.maxDelayMs,
          onChange: (n) => update("maxDelayMs", n),
          onEnter: save,
          suffix: L.suffixMs
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        NumberField,
        {
          label: L.fieldJitter,
          hint: L.fieldJitterHint,
          value: draft.jitterRatio,
          min: 0,
          step: 0.05,
          disabled: !writable,
          dirty: draft.jitterRatio !== current.jitterRatio,
          onChange: (n) => update("jitterRatio", n),
          onEnter: save
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-actions", children: [
      dirty && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-dirtyHint", children: L.dirtyHint }),
      saveState === "fail" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-fail", children: L.saveFailed }),
      saveState === "ok" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-ok", children: L.saved }),
      dirty && saveState !== "saving" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dlr-revertBtn", onClick: revert, children: L.revert }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dlr-saveBtn", disabled: !writable || !dirty || saveState === "saving", onClick: save, children: saveState === "saving" ? L.saving : L.save })
    ] })
  ] });
}
function apply(ctx) {
  ensureCss();
  const scope = ctx.settingsScope.bind({ namespace: NS });
  const useScope = (0, import_dsh_client_web_react.bindSnapshotSelector)(scope);
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "llm-retry-settings",
    order: 15,
    label: () => "LLM 自动重试",
    inject: () => ({ useScope, scope })
  }, RetrySettingsRow), PLUGIN_ID + ": settings section");
}
var inject = ["slots", "settingsScope"];

		return module.exports;
	}
});
