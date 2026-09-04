window.__ModuleLoader__.load({id: "dsh-llm-retry-settings",factory: (require) => {var module = { exports: {} };var exports = module.exports;
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
var import_jsx_runtime = require("react/jsx-runtime");
var NS = "dsh-llm-retry";
var PLUGIN_ID = "dsh-llm-retry-settings";
var CSS_TAG = PLUGIN_ID + "/client.css";
function bindSnapshotSelector(scope) {
  const subscribe = (fn) => scope.subscribe(fn);
  const getSnapshot = () => scope.getSnapshot();
  return function useSelector(sel) {
    return sel((0, import_react.useSyncExternalStore)(subscribe, getSnapshot));
  };
}
var DEFAULTS = {
  enabled: false,
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 1e4,
  jitterRatio: 0.1,
  retryableCodes: ["INVALID_REQUEST", "PI_AI_ERROR"],
  autoContinue: false,
  maxContinuations: 2
};
var CODE_CATEGORIES = [
  { id: "transient", label: "\u77AC\u65F6\u6545\u969C", note: "\u91CD\u8BD5\u901A\u5E38\u80FD\u6062\u590D" },
  { id: "quota", label: "\u9650\u6D41\u4E0E\u914D\u989D", note: "\u9000\u907F\u540E\u53EF\u80FD\u6062\u590D" },
  { id: "request", label: "\u8BF7\u6C42\u4E0E\u53C2\u6570", note: "\u591A\u4E3A\u786E\u5B9A\u6027\u9519\u8BEF" },
  { id: "content", label: "\u5185\u5BB9\u4E0E\u80FD\u529B", note: "\u6A21\u578B\u4E0D\u652F\u6301\uFF0C\u91CD\u8BD5\u65E0\u610F\u4E49" },
  { id: "auth", label: "\u51ED\u8BC1\u4E0E\u9274\u6743", note: "\u5148\u4FEE\u914D\u7F6E" },
  { id: "misc", label: "\u53D6\u6D88\u4E0E\u515C\u5E95", note: "\u614E\u9009" }
];
var KNOWN_CODES = [
  // —— 瞬时故障 ——
  { code: "SERVER", cat: "transient", desc: "HTTP 5xx \u670D\u52A1\u7AEF\u9519\u8BEF" },
  { code: "TIMEOUT", cat: "transient", desc: "\u8BF7\u6C42\u8D85\u65F6\uFF1A\u6574\u6B21\u8BF7\u6C42\u672A\u5728\u65F6\u9650\u5185\u8FD4\u56DE\uFF1BSSE \u5361\u6D41\uFF08stream idle \u770B\u95E8\u72D7\uFF09\u4E5F\u4EE5\u6B64\u7801\u4E0A\u62A5" },
  { code: "TRANSPORT", cat: "transient", desc: "\u7F51\u7EDC\u4E2D\u65AD\u3001\u8FDE\u63A5\u91CD\u7F6E\u3001\u6D41\u63D0\u524D\u7ED3\u675F" },
  { code: "EMPTY_RESPONSE", cat: "transient", desc: "\u6D41\u6B63\u5E38\u7ED3\u675F\u4F46\u96F6\u5185\u5BB9\u5757\uFF1B\u91CD\u8BD5\u5B89\u5168" },
  { code: "STREAM_CLOSED", cat: "transient", desc: "deepseek SSE \u6D41\u672A\u6536\u5230 [DONE] \u5C31\u65AD\u5F00" },
  { code: "MALFORMED_RESPONSE", cat: "transient", desc: "SSE \u6570\u636E\u5E27\u683C\u5F0F\u635F\u574F" },
  { code: "INVALID_RESPONSE", cat: "transient", desc: "\u54CD\u5E94\u7ED3\u6784\u4E0D\u7B26\u5408\u9884\u671F\uFF08\u5076\u53D1\u53EF\u8BD5\uFF09" },
  { code: "PI_AI_ERROR", cat: "transient", desc: "pi-ai \u515C\u5E95\u672A\u77E5\u9519\u8BEF\uFF1BSTREAM_ERROR \u6D41\u5F0F\u5931\u8D25\u5F52\u6B64\u7C7B" },
  { code: "PI_AI_NOT_WARMED", cat: "transient", desc: "pi-ai \u9002\u914D\u5668\u5C1A\u672A\u9884\u70ED\u5B8C\u6210\u5C31\u88AB\u8C03\u7528\uFF08\u542F\u52A8\u7ADE\u6001\uFF09\uFF1B\u9000\u907F\u540E\u91CD\u8BD5\u901A\u5E38\u80FD\u6210" },
  // —— 限流与配额 ——
  { code: "RATE_LIMIT", cat: "quota", desc: "429 \u9650\u6D41" },
  { code: "QUOTA", cat: "quota", warn: true, desc: "\u914D\u989D/\u4F59\u989D\u8017\u5C3D\uFF08\u89C4\u8303\u5B57\u9762\u503C\u5C31\u662F QUOTA\uFF09\uFF1B\u91CD\u8BD5\u65E0\u610F\u4E49" },
  // —— 请求与参数 ——
  { code: "INVALID_REQUEST", cat: "request", desc: "400 \u7C7B\u8BF7\u6C42\u88AB\u62D2\uFF08\u5982 thinking \u6A21\u5F0F reasoning_text \u51B2\u7A81\u3001payload \u8D85\u9650\uFF09" },
  { code: "CONTEXT_WINDOW_EXCEEDED", cat: "request", warn: true, desc: "\u4E0A\u4E0B\u6587\u8D85\u7A97\uFF1B\u91CD\u8BD5\u540C\u6837\u5931\u8D25\uFF0C\u5E94\u538B\u7F29\u4E0A\u4E0B\u6587" },
  { code: "UNSUPPORTED_OPTION", cat: "request", warn: true, desc: "\u9002\u914D\u5668\u4E0D\u652F\u6301\u8BE5\u751F\u6210\u53C2\u6570\uFF08\u5982 stop\uFF09\uFF1B\u6539\u53C2\u6570\u800C\u975E\u91CD\u8BD5" },
  { code: "UNKNOWN_MODEL", cat: "request", warn: true, desc: "\u8BF7\u6C42\u7684\u6A21\u578B\u4E0D\u5728\u76EE\u5F55\uFF1B\u91CD\u8BD5\u540C\u6837\u5931\u8D25\uFF0C\u5E94\u6539\u6A21\u578B\u9009\u62E9" },
  { code: "REQUEST_EXTENSION", cat: "request", warn: true, desc: "deepseek \u8BF7\u6C42\u6269\u5C55\uFF08\u56FE\u7247/\u641C\u7D22\u7B49\uFF09\u51C6\u5907\u6216\u53D7\u7406\u5931\u8D25\uFF08extension field \u51B2\u7A81\u7B49\uFF09\uFF1B\u591A\u4E3A\u786E\u5B9A\u6027\u9519\u8BEF" },
  { code: "INVALID_REPLAY_STATE", cat: "request", warn: true, desc: "pi-ai \u91CD\u653E\u72B6\u6001\u635F\u574F\uFF08\u5185\u90E8\u7BA1\u7EBF\u9519\u8BEF\uFF09" },
  // —— 内容与能力 ——
  { code: "UNSUPPORTED_CONTENT", cat: "content", warn: true, desc: "\u8BE5\u6A21\u578B\u4E0D\u652F\u6301\u6B64\u7C7B\u5185\u5BB9\uFF08\u5982\u56FE\u7247\uFF09" },
  { code: "UNSUPPORTED_REASONING_EFFORT", cat: "content", warn: true, desc: "\u8BE5\u6A21\u578B\u4E0D\u652F\u6301\u6240\u9009\u63A8\u7406\u6863\u4F4D" },
  { code: "FILES_API", cat: "content", warn: true, desc: "deepseek \u6587\u4EF6\u670D\u52A1 HTTP \u5931\u8D25" },
  // —— 凭证与鉴权 ——
  { code: "AUTH", cat: "auth", warn: true, desc: "401/403 \u8BA4\u8BC1\u88AB\u62D2\uFF1B\u4FEE\u5BC6\u94A5\u800C\u975E\u91CD\u8BD5" },
  { code: "INVALID_CREDENTIAL", cat: "auth", warn: true, desc: "\u51ED\u8BC1\u683C\u5F0F\u975E\u6CD5\uFF1B\u4FEE\u6B63\u5B58\u50A8\u503C" },
  { code: "MISSING_CREDENTIAL", cat: "auth", warn: true, desc: "\u7F3A\u5C11 API Key\uFF1B\u5148\u53BB\u6A21\u578B\u9875\u914D\u7F6E" },
  // —— 取消与兜底 ——
  { code: "ABORTED", cat: "misc", warn: true, desc: "\u8C03\u7528\u65B9\u4E3B\u52A8\u53D6\u6D88\uFF1B\u7EDD\u4E0D\u5E94\u91CD\u8BD5" },
  { code: "UNKNOWN", cat: "misc", warn: true, desc: "\u975E LlmError \u7684\u901A\u7528\u515C\u5E95\uFF1B\u52FE\u9009=\u5E7F\u6492\u7F51" }
];
var KNOWN_CODE_SET = new Set(KNOWN_CODES.map((k) => k.code));
var L = {
  title: "LLM \u81EA\u52A8\u91CD\u8BD5",
  desc: "\u6A21\u578B\u8BF7\u6C42\u5931\u8D25\u65F6\u7684\u81EA\u52A8\u6062\u590D\u7B56\u7565\uFF0C\u4EE5\u53CA\u8F93\u51FA\u88AB token \u4E0A\u9650\u622A\u65AD\u65F6\u7684\u81EA\u52A8\u7EED\u5199\u3002\u5F00\u542F\u91CD\u8BD5\u540E\u4EE5\u672C\u5361\u7247\u503C\u4E3A\u51C6\u8986\u76D6\u5404 provider \u7684\u91CD\u8BD5\u6B21\u6570\u4E0E\u9000\u907F\u65F6\u95F4\u3002",
  badgeOn: "\u8986\u76D6\u5DF2\u5F00\u542F",
  badgeOff: "\u672A\u5F00\u542F",
  statusOff: "\u6CBF\u7528\u5404 provider \u81EA\u5E26\u7684\u91CD\u8BD5\u7B56\u7565",
  statusOn: (n, init, max, j, c) => `\u6700\u591A\u91CD\u8BD5 ${n} \u6B21 \xB7 \u9000\u907F ${init}ms\u2192${max}ms \xB7 \u6296\u52A8 ${j} \xB7 \u8865\u5145 ${c} \u4E2A\u9519\u8BEF\u7801`,
  continueOn: (n) => `\u622A\u65AD\u81EA\u52A8\u7EED\u5199 \u2264${n} \u6B21`,
  continueOff: "\u622A\u65AD\u4E0D\u81EA\u52A8\u7EED\u5199",
  groupBehavior: "\u91CD\u8BD5\u884C\u4E3A",
  fieldRetries: "\u6700\u5927\u91CD\u8BD5\u6B21\u6570",
  fieldRetriesHint: "\u5931\u8D25\u540E\u6700\u591A\u91CD\u8BD5\u51E0\u6B21\uFF1B0 = \u4E0D\u91CD\u8BD5",
  fieldInitial: "\u521D\u59CB\u9000\u907F",
  fieldInitialHint: "\u7B2C\u4E00\u6B21\u91CD\u8BD5\u524D\u7B49\u5F85\u7684\u6BEB\u79D2\u6570\uFF0C\u6B64\u540E\u6309\u6307\u6570\u589E\u957F",
  fieldMax: "\u6700\u5927\u9000\u907F",
  fieldMaxHint: "\u9000\u907F\u65F6\u95F4\u5C01\u9876\u7684\u6BEB\u79D2\u6570",
  fieldJitter: "\u6296\u52A8\u6BD4\u4F8B",
  fieldJitterHint: "0~1\uFF0C\u7ED9\u9000\u907F\u52A0\u968F\u673A\u6296\u52A8\u907F\u514D\u540C\u65F6\u91CD\u8BD5",
  groupCodes: "\u8865\u5145\u53EF\u91CD\u8BD5\u7684\u9519\u8BEF\u7801",
  fieldCodesHint: "\u6309\u201C\u91CD\u8BD5\u6709\u6CA1\u6709\u6062\u590D\u4EF7\u503C\u201D\u5206\u516D\u7EC4\u5217\u51FA\uFF0C\u7EC4\u5185\u5DF2\u9009\u4E2D\u7684\u7801\u81EA\u52A8\u9760\u524D\u5E76\u8BA1\u6570\u3002\u52FE\u9009\u7684\u7801\u4E0E provider \u5185\u7F6E\u5217\u8868\u53D6\u5E76\u96C6\uFF08\u4E0D\u8986\u76D6\u5DF2\u6709\u7801\uFF09\u3002\u7425\u73C0\u8272 = \u91CD\u8BD5\u901A\u5E38\u65E0\u610F\u4E49\uFF0C\u614E\u9009\uFF1BSTREAM_ERROR \u6D41\u5F0F\u5931\u8D25\u5F52\u5165 PI_AI_ERROR\uFF0CSSE \u5361\u6D41\u5F52\u5165 TIMEOUT\u3002provider \u914D\u7F6E\u91CC\u624B\u5DE5\u52A0\u5165\u3001\u4E0D\u5728\u6E05\u5355\u5185\u7684\u7801\u4F1A\u4EE5\u865A\u7EBF\u201C\u81EA\u5B9A\u4E49\u201D\u7EC4\u51FA\u73B0\u3002",
  codesNone: "\u672A\u52FE\u9009\u4EFB\u4F55\u8865\u5145\u7801\u2014\u2014\u4EC5\u6309 provider \u5185\u7F6E\u7801\u91CD\u8BD5",
  codesCount: (n) => `\u5C06\u8865\u5145 ${n} \u4E2A\u9519\u8BEF\u7801`,
  codesClear: "\u6E05\u7A7A",
  codesCustom: "\u81EA\u5B9A\u4E49",
  codesCustomHint: "\u4E0D\u5728\u5DF2\u77E5\u6E05\u5355\u5185\uFF08provider \u914D\u7F6E\u624B\u5DE5\u52A0\u7684\uFF09",
  groupContinue: "\u8F93\u51FA\u622A\u65AD\u81EA\u52A8\u7EED\u5199",
  switchOn: "\u5F00\u542F",
  switchOff: "\u5173\u95ED",
  continueHint: "\u56DE\u7B54\u88AB\u8F93\u51FA token \u4E0A\u9650\u622A\u65AD\u65F6\uFF08\u5BBF\u4E3B\u4F1A\u663E\u793A\u300C\u5DF2\u8FBE\u5230\u8F93\u51FA token \u4E0A\u9650\u300D\uFF09\uFF0C\u81EA\u52A8\u66FF\u4F60\u53D1\u4E00\u6761\u300C\u7EE7\u7EED\u300D\uFF0C\u6A21\u578B\u63A5\u7740\u4E0A\u6587\u5F80\u4E0B\u5199\u3002\u8FD9\u4E0D\u662F\u8BF7\u6C42\u5931\u8D25\uFF0C\u4E0A\u9762\u7684\u91CD\u8BD5\u7B56\u7565\u7BA1\u4E0D\u5230\u5B83\uFF1B\u4E24\u8005\u4E92\u4E0D\u5F71\u54CD\u3002",
  continueWarn: "\u6BCF\u6B21\u7EED\u5199\u90FD\u4F1A\u5E26\u7740\u5B8C\u6574\u4E0A\u4E0B\u6587\u518D\u8DD1\u4E00\u8F6E\uFF0C\u4F1A\u989D\u5916\u6D88\u8017 token\u3002",
  continueZero: "\u6B21\u6570\u4E3A 0\uFF1A\u5F00\u5173\u867D\u5F00\uFF0C\u5B9E\u9645\u4E0D\u4F1A\u8865\u5199\u4EFB\u4F55\u4E00\u8F6E\u3002",
  fieldMaxContinue: "\u6700\u591A\u8FDE\u7EED\u7EED\u5199",
  fieldMaxContinueHint: "\u540C\u4E00\u6B21\u622A\u65AD\u540E\u8FDE\u7EED\u8865\u5199\u7684\u6B21\u6570\u4E0A\u9650\uFF1B\u6A21\u578B\u6B63\u5E38\u8BF4\u5B8C\u6216\u4F60\u91CD\u65B0\u53D1\u8A00\u5373\u91CD\u65B0\u8BA1\u6570",
  suffixTimes: "\u6B21",
  suffixMs: "ms",
  save: "\u4FDD\u5B58",
  revert: "\u653E\u5F03",
  saving: "\u4FDD\u5B58\u4E2D\u2026",
  saved: "\u5DF2\u4FDD\u5B58 \u2713",
  saveFailed: "\u4FDD\u5B58\u5931\u8D25 \u2717\uFF08\u91CD\u8BD5\u6216\u5237\u65B0\u9875\u9762\uFF1B\u5BBF\u4E3B\u65E5\u5FD7\u89C1 settings-rejected\uFF09",
  dirtyHint: "\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539"
};
var CSS = [
  ".dlr-card{border-bottom:1px solid var(--dsw-alias-border-l2);padding:18px 0 20px;display:flex;flex-direction:column;gap:16px}",
  ".dlr-head{display:flex;align-items:flex-start;gap:12px}",
  ".dlr-headText{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}",
  ".dlr-titleRow{display:flex;align-items:center;gap:8px}",
  // 标题显式深色（先给非 light-dark 浏览器一个纯深色回退）；字号提到 16 加粗
  ".dlr-title{color:#101418;color:light-dark(#0f1216,#eef1f4);font-size:16px;line-height:24px;font-weight:700}",
  ".dlr-badge{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 10px;border-radius:999px;font-size:12px;line-height:20px;white-space:nowrap}",
  ".dlr-badge i{width:6px;height:6px;border-radius:50%;flex:none}",
  ".dlr-badge.on{background:rgba(46,158,91,.14);color:var(--dsw-alias-state-success,#2e9e5b)}",
  ".dlr-badge.on i{background:var(--dsw-alias-state-success,#2e9e5b)}",
  ".dlr-badge.off{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary)}",
  ".dlr-badge.off i{background:var(--dsw-alias-label-caption)}",
  ".dlr-desc{color:#24292f;color:light-dark(#24292f,#ccd3da);font-size:13px;line-height:19px}",
  ".dlr-status{color:var(--dsw-alias-label-caption);font-size:12px;line-height:17px}",
  ".dlr-switch{width:44px;height:26px;flex:none;background:var(--dsw-alias-interactive-bg-hover);border:none;border-radius:999px;position:relative;cursor:pointer;transition:background .15s;padding:0;margin-top:2px}",
  ".dlr-switch[aria-checked=true]{background:var(--dsw-alias-state-business-primary)}",
  ".dlr-switch:disabled{opacity:.5;cursor:default}",
  ".dlr-knob{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform .15s}",
  ".dlr-switch[aria-checked=true] .dlr-knob{transform:translateX(18px)}",
  ".dlr-body{display:flex;flex-direction:column;gap:16px}",
  ".dlr-section{display:flex;flex-direction:column;gap:12px}",
  ".dlr-disabled{opacity:.55;pointer-events:none}",
  ".dlr-switchRow{display:flex;align-items:flex-start;gap:10px}",
  ".dlr-switchText{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}",
  ".dlr-note{color:var(--dsw-alias-label-caption);font-size:12px;line-height:17px}",
  ".dlr-groupTitle{color:#14181d;color:light-dark(#14181d,#e2e7ec);font-size:13px;font-weight:600;letter-spacing:.4px}",
  ".dlr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}",
  ".dlr-cell{display:flex;flex-direction:column;gap:4px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;transition:border-color .12s}",
  ".dlr-cell.dirty{border-color:var(--dsw-alias-state-business-primary)}",
  ".dlr-cellHead{display:flex;align-items:baseline;justify-content:space-between;gap:6px}",
  ".dlr-cellLabel{color:var(--dsw-alias-label-primary);font-size:13px;line-height:19px}",
  ".dlr-cellSuffix{color:var(--dsw-alias-label-caption);font-size:12px}",
  ".dlr-cellHint{color:var(--dsw-alias-label-caption);font-size:12px;line-height:17px}",
  ".dlr-input{width:100%;box-sizing:border-box;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;outline:none}",
  ".dlr-input:focus{border-color:var(--dsw-alias-state-business-primary)}",
  ".dlr-input:disabled{opacity:.5}",
  ".dlr-chipsWrap{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}",
  ".dlr-chipOuter{display:flex;flex-direction:column;gap:6px}",
  ".dlr-chipHint{color:var(--dsw-alias-label-caption);font-size:12px;line-height:17px}",
  ".dlr-chips{display:flex;flex-wrap:wrap;gap:6px}",
  ".dlr-chipGroup{display:flex;flex-direction:column;gap:6px}",
  ".dlr-chipGroupLabel{display:flex;align-items:baseline;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}",
  ".dlr-chipGroupLabel em{color:var(--dsw-alias-label-caption);font-size:11px;font-weight:400;font-style:normal}",
  ".dlr-chipGroupLabel b{min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-state-business-primary);color:#fff;font-size:10px;line-height:16px;text-align:center;font-weight:600}",
  ".dlr-chip{height:27px;padding:0 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;transition:all .12s;line-height:25px}",
  ".dlr-chip:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}",
  ".dlr-chip.on{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);color:#fff}",
  ".dlr-chip.unknown{border-style:dashed;border-color:var(--dsw-alias-state-warn,#c78421);color:var(--dsw-alias-state-warn,#c78421)}",
  ".dlr-chip.unknown.on{background:var(--dsw-alias-state-warn,#c78421);border-color:var(--dsw-alias-state-warn,#c78421);color:#fff}",
  ".dlr-chip.warn{border-color:rgba(199,132,33,.45);color:var(--dsw-alias-state-warn,#c78421)}",
  ".dlr-chip.warn.on{background:var(--dsw-alias-state-warn,#c78421);border-color:var(--dsw-alias-state-warn,#c78421);color:#fff}",
  ".dlr-chip:disabled{opacity:.45;cursor:default}",
  ".dlr-chipMeta{display:flex;align-items:center;gap:10px;color:var(--dsw-alias-label-caption);font-size:12px}",
  ".dlr-chipClear{height:auto;padding:0;border:none;background:transparent;color:var(--dsw-alias-state-danger,#d54545);font-size:12px;cursor:pointer}",
  ".dlr-chipClear:hover{text-decoration:underline}",
  ".dlr-actions{display:flex;align-items:center;gap:8px;justify-content:flex-end}",
  ".dlr-saveBtn{height:30px;padding:0 18px;border:none;border-radius:6px;background:var(--dsw-alias-state-business-primary);color:#fff;font-size:13px;cursor:pointer}",
  ".dlr-saveBtn:disabled{opacity:.5;cursor:default}",
  ".dlr-revertBtn{height:30px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer}",
  ".dlr-ok{color:var(--dsw-alias-state-success,#2e9e5b);font-size:13px}",
  ".dlr-fail{color:var(--dsw-alias-state-danger,#d54545);font-size:13px}",
  ".dlr-dirtyHint{color:var(--dsw-alias-state-business-primary);font-size:12px}"
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
function Badge({ on, label }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dlr-badge " + (on ? "on" : "off"), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
    label
  ] });
}
var clampNum = (n, min, max) => Number.isFinite(n) ? Math.min(max ?? Infinity, Math.max(min, n)) : min;
var clampInt = (n, min) => Number.isFinite(n) ? Math.max(min, Math.floor(n)) : min;
function NumberField({ label, hint, value, min, max, step, disabled, dirty, onChange, onEnter, suffix, float }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-cell" + (dirty ? " dirty" : ""), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-cellHead", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-cellLabel", children: label }),
      suffix ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-cellSuffix", children: suffix }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        type: "number",
        className: "dlr-input",
        min,
        max: float ? max : void 0,
        step,
        value,
        disabled,
        onChange: (e) => {
          const n = Number(e.target.value);
          onChange(float ? clampNum(n, min, max) : clampInt(n, min));
        },
        onKeyDown: (e) => {
          if (e.key === "Enter") onEnter();
        }
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-cellHint", children: hint })
  ] });
}
function Chip({ code, title, warn, unknown, on, disabled, onClick }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "button",
    {
      type: "button",
      title,
      className: "dlr-chip" + (warn ? " warn" : "") + (unknown ? " unknown" : "") + (on ? " on" : ""),
      disabled,
      onClick,
      children: code
    }
  );
}
function CodeChips({ selected, disabled, onToggle, onClear }) {
  const selSet = new Set(selected);
  const custom = selected.filter((c) => !KNOWN_CODE_SET.has(c));
  const chip = ({ code, desc, warn }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    Chip,
    {
      code,
      title: desc,
      warn,
      on: selSet.has(code),
      disabled,
      onClick: () => onToggle(code)
    },
    code
  );
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-chipsWrap", children: [
    custom.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-chipGroup", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dlr-chipGroupLabel", children: [
        L.codesCustom,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: L.codesCustomHint })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dlr-chips", children: custom.map((code) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Chip,
        {
          code,
          title: "\u81EA\u5B9A\u4E49\u9519\u8BEF\u7801\uFF08provider \u914D\u7F6E\u91CC\u624B\u5DE5\u52A0\u5165\u7684\uFF09\uFF0C\u70B9\u51FB\u53D6\u6D88\u52FE\u9009",
          unknown: true,
          on: true,
          disabled,
          onClick: () => onToggle(code)
        },
        code
      )) })
    ] }),
    CODE_CATEGORIES.map((cat) => {
      const items = KNOWN_CODES.filter((k) => k.cat === cat.id);
      if (items.length === 0) return null;
      const picked = items.filter((k) => selSet.has(k.code));
      const others = items.filter((k) => !selSet.has(k.code));
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-chipGroup", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dlr-chipGroupLabel", children: [
          cat.label,
          cat.note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: cat.note }) : null,
          picked.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: picked.length }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-chips", children: [
          picked.map(chip),
          others.map(chip)
        ] })
      ] }, cat.id);
    }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-chipMeta", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: selected.length === 0 ? L.codesNone : L.codesCount(selected.length) }),
      selected.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dlr-chipClear", disabled, onClick: onClear, children: L.codesClear })
    ] })
  ] });
}
var numOr = (v, d) => typeof v === "number" ? v : d;
var normCodes = (v) => (Array.isArray(v) ? v : []).filter((c) => typeof c === "string" && c.length > 0);
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
    maxContinuations: numOr(value.maxContinuations, DEFAULTS.maxContinuations)
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
  const toggleCode = (code) => setDraft((d) => {
    const cur = Array.isArray(d.retryableCodes) ? d.retryableCodes : [];
    if (cur.includes(code)) return { ...d, retryableCodes: cur.filter((c) => c !== code) };
    return { ...d, retryableCodes: [...cur, code] };
  });
  const save = (0, import_react.useCallback)(async () => {
    setSaveState("saving");
    try {
      for (const [k, v] of Object.entries(draft)) {
        if (!sameJson(current[k], v)) await scope.set(k, v);
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
  const jPct = Math.round(draft.jitterRatio * 100) + "%";
  const retryStatus = draft.enabled ? L.statusOn(draft.maxRetries, draft.initialDelayMs, draft.maxDelayMs, jPct, draft.retryableCodes.length) : L.statusOff;
  const status = retryStatus + " \xB7 " + (draft.autoContinue ? L.continueOn(draft.maxContinuations) : L.continueOff);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-card", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-headText", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-titleRow", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-title", children: L.title }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { on: draft.enabled, label: draft.enabled ? L.badgeOn : L.badgeOff })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-desc", children: L.desc }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-status", children: status })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Switch,
        {
          checked: draft.enabled,
          disabled: !writable,
          label: L.title,
          title: draft.enabled ? L.badgeOn : L.badgeOff,
          onClick: () => update("enabled", !draft.enabled)
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-body", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-section" + (draft.enabled ? "" : " dlr-disabled"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-groupTitle", children: L.groupBehavior }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-grid", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            NumberField,
            {
              label: L.fieldRetries,
              hint: L.fieldRetriesHint,
              value: draft.maxRetries,
              min: 0,
              step: 1,
              suffix: L.suffixTimes,
              disabled: !writable,
              dirty: draft.maxRetries !== current.maxRetries,
              onChange: (n) => update("maxRetries", n),
              onEnter: save
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
              suffix: L.suffixMs,
              disabled: !writable,
              dirty: draft.initialDelayMs !== current.initialDelayMs,
              onChange: (n) => update("initialDelayMs", n),
              onEnter: save
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
              suffix: L.suffixMs,
              disabled: !writable,
              dirty: draft.maxDelayMs !== current.maxDelayMs,
              onChange: (n) => update("maxDelayMs", n),
              onEnter: save
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            NumberField,
            {
              label: L.fieldJitter,
              hint: L.fieldJitterHint,
              value: draft.jitterRatio,
              min: 0,
              max: 1,
              step: 0.05,
              float: true,
              suffix: "%",
              disabled: !writable,
              dirty: draft.jitterRatio !== current.jitterRatio,
              onChange: (n) => update("jitterRatio", n),
              onEnter: save
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-groupTitle", children: L.groupCodes }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-chipOuter", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            CodeChips,
            {
              selected: draft.retryableCodes,
              disabled: !writable,
              onToggle: toggleCode,
              onClear: () => update("retryableCodes", [])
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-chipHint", children: L.fieldCodesHint })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-switchRow", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            Switch,
            {
              checked: draft.autoContinue,
              disabled: !writable,
              label: L.groupContinue,
              title: draft.autoContinue ? L.switchOn : L.switchOff,
              onClick: () => update("autoContinue", !draft.autoContinue)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-switchText", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-groupTitle", children: L.groupContinue }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-note", children: L.continueHint })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dlr-section" + (draft.autoContinue ? "" : " dlr-disabled"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dlr-grid", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            NumberField,
            {
              label: L.fieldMaxContinue,
              hint: L.fieldMaxContinueHint,
              value: draft.maxContinuations,
              min: 0,
              step: 1,
              suffix: L.suffixTimes,
              disabled: !writable,
              dirty: draft.maxContinuations !== current.maxContinuations,
              onChange: (n) => update("maxContinuations", n),
              onEnter: save
            }
          ) }),
          draft.autoContinue && draft.maxContinuations === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-note", children: L.continueZero }),
          draft.autoContinue && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dlr-note", children: L.continueWarn })
        ] })
      ] })
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
  const useScope = bindSnapshotSelector(scope);
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "llm-retry-settings",
    order: 15,
    label: () => "LLM \u81EA\u52A8\u91CD\u8BD5",
    inject: () => ({ useScope, scope })
  }, RetrySettingsRow), PLUGIN_ID + ": settings section");
}
var inject = ["slots", "settingsScope"];
return module.exports;}
});
