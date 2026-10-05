# dsh-llm-retry-settings

A settings card for the DSH LLM auto-retry engine (`@deepseek-ai/dsh-llm-retry`). Tune the retry count and backoff from **Settings → General**; changes take effect immediately. Since 0.1.7 it can also **auto-continue a reply that was cut off by the output-token limit**; since 0.1.9 both the extra error codes and the continuation prompt are yours to write.

[中文说明](./README.zh-CN.md)

## Features

- **Includes the settings UI** (client bundle `lib/client.js`): a card in **Settings → General** — no separate UI package needed.
- Overrides `maxRetries`, `initialDelayMs`, `maxDelayMs`, and `jitterRatio` on the `agent/request-error` retry policy.
- **New in 0.1.14** — declares its host requirement (`engines.dsh: >=0.1.6-alpha.1`) so the plugin market can show DSH compatibility. Ships every 0.1.13 fix (0.1.13 never reached npm).
- **New in 0.1.13** — noticeably smoother settings-card scrolling: the scroll container now gets a compositing hint (measured p99 30.2ms → 6.2–12.1ms; frames over 16.7ms dropped from 11–13/410 to 0–2/410).
- **New in 0.1.13** — **model-level overrides no longer silently stop working after a plugin reload**: the kernel only re-emits `request/header`/`request/context` on the *first* request and on change (the first-request flag lives on the AgentLoop instance and a plugin reload does not reset it), so sessions that had already made a request resolved no model; the lookup now falls back to the session's own `requestContext()` / `requestHeader()`, and the `model=(n/a)` diagnostics disappear with it.
- **New in 0.1.13** — settings changes apply **immediately**: the `loader/volatile-update` listener now uses `{ global: true }` — the kernel's filter compares a bare fiber against the entry's wrapper, which never matches, so the event was never delivered (the official `dsh-llm-deepseek` / `dsh-llm-pi-ai` listeners miss it too).
- **New in 0.1.13** — no more Chinese leaking into the English UI: all 25 error-code descriptions and the 6 group titles moved into the dictionaries; the settings-page entry name no longer lags behind a language switch.
- **New in 0.1.13** — smaller fixes: `?tail=` normalization on the observation route, jitter-ratio unit, initial-delay > max-delay display, custom error-code input no longer cleared on rejection, a separate continuation prompt when retries are exhausted, and accessibility attributes on chips and inputs.
- **New in 0.1.12** — auto-continue failed on session format v4: message sources must now be producer-owned, so the continuation carries `source.kind = "plugin:dsh-llm-retry"` instead of the retired `{kind:"plugin"}` wrapper; the "continuation landed" line in host.log is detected again.
- **New in 0.1.11** — compatible with the new kernel **0.1.7-alpha.1** (the settings API moved to `SettingsForms`: volatile form fields, live config sync via `loader/volatile-update`, the card reads/writes through `remote.settings`).
- **New in 0.1.11** — smoother settings-card scrolling; bug fixes.
- **New in 0.1.10** — a read-only observation panel at the bottom of the card: retried failures, auto-continues, cap hits and skipped rounds, broken down by error code and provider/model, with the live session models (so you can copy the exact model id into an override) and a log-tail viewer.
- **New in 0.1.10** — per-provider/model overrides: first matching rule wins, `*` wildcards, empty numbers inherit the global values.
- **New in 0.1.10** — backoff curve with a wait budget, a "continue after retries are exhausted" switch (transient errors only), prompt templates, and a zh/en UI that follows the kernel locale.
- **New in 0.1.9** — add your own error codes straight from the card (the `自定义` group): type a code a provider throws that is not in the known list (e.g. `MY_PROVIDER_BUSY`) and press **添加**. Input is upper-cased and validated (`A-Z 0-9 _ - .`), duplicates and blanks are rejected with an inline hint, and the code reaches `retryableCodes` unchanged.
- **New in 0.1.9** — the auto-continue prompt is editable (`continuationPrompt`). Leave it empty to use the built-in wording, or write your own line for relays/models that need different phrasing.
- **New in 0.1.8** — auto-continue now actually fires. Two host-side timing traps: `session/event` is dispatched *inside* `Session.append`, so queueing the follow-up straight from the listener died on `session append cannot reenter while another append is being published`; once that was fixed, waking the agent at that moment turned out to be silently dropped by the driver (`wakeDriver` only latches in maintenance/abort), so the message sat in the queue forever. The plugin now waits for `agent.whenIdle()` and re-checks (new turn started / you sent a message / session disposed) before delivering.
- **New in 0.1.8** — the host half writes a low-frequency decision log to `~/.dsh/logs/dsh-llm-retry-settings/host.log` (capped at 256 KB) and the card points at it. See [Troubleshooting](#troubleshooting).
- **New in 0.1.7** — error-code list re-audited against the current host build: added `PI_AI_NOT_WARMED` (adapter warm-up race; a delayed retry usually succeeds) plus three amber "retrying will not help" codes (`UNKNOWN_MODEL`, `UNSUPPORTED_OPTION`, `REQUEST_EXTENSION`). Also clarified `TIMEOUT`: a stalled SSE stream (stream-idle watchdog) is reported as `TIMEOUT` — there is no separate code for it, so the host default retry list already covers hangs.
- **New in 0.1.7** — **auto-continue on output truncation** (`autoContinue`, off by default). Hitting the output-token ceiling is *not* a request failure — the call returns successfully with `finish = max-tokens` — so no retry policy can ever cover it. When enabled, the plugin watches `turn/end` and queues one follow-up continuation turn per truncation, at most `maxContinuations` times in a row (the counter resets when the model finishes normally or you send a new message).
- **New in 0.1.7** — the error-code chips are grouped into six categories ordered by "will retrying help": transient → rate limit & quota → request & parameters → content & capability → credentials → abort & fallback. Each group shows how many of its codes you selected; picked codes still float to the front *within their own group*.
- **New in 0.1.5** — selected error codes float to the front of the chip list, with the unselected ones after them; the order inside each group stays fixed, so chips never jump around when you toggle them. (Since 0.1.7 the floating happens within each category group.)
- **New in 0.1.3** — configurable `retryableCodes`: extra failure codes to retry on, **merged** into each provider's own list (never replaces it). Defaults to `INVALID_REQUEST` + `PI_AI_ERROR`, so OpenAI-style HTTP 400 errors (thinking-mode `reasoning_text`) and generic stream failures get retried out of the box.
- Default `enabled: false` = fully bypassed; nothing changes until you enable the override.

## Install

Prerequisite: a DSH Desktop profile (the web profile lives at `~/.dsh/profiles/web`).

### Option A — GitHub Release package (recommended)

```bash
# 1. download the packaged plugin tgz from the v0.1.14 release
gh release download v0.1.14 -R zeng6125-rgb/dsh-llm-retry-settings

# 2. unpack it into the profile's node_modules
mkdir -p ~/.dsh/profiles/web/node_modules
tar -xzf dsh-llm-retry-settings-0.1.14.tgz -C ~/.dsh/profiles/web/node_modules/
mv ~/.dsh/profiles/web/node_modules/package \
   ~/.dsh/profiles/web/node_modules/dsh-llm-retry-settings

# 3. register the bundle in the profile, then restart DSH
#    add "dsh-llm-retry-settings" to dsh.profile.bundles
#    in ~/.dsh/profiles/web/package.json
```

### Option B — dsh CLI / pnpm (requires git + network)

The `dsh plugin` command forwards its arguments to `pnpm` in the profile directory:

```bash
# from a git repo (pnpm clones it; the committed lib/ means no build needed)
dsh plugin --profile web add github:zeng6125-rgb/dsh-llm-retry-settings

# or from the release tarball URL
dsh plugin --profile web add https://github.com/zeng6125-rgb/dsh-llm-retry-settings/releases/download/v0.1.14/dsh-llm-retry-settings-0.1.14.tgz
```

Then enable the plugin in the profile: add `"dsh-llm-retry-settings"` to `dsh.profile.bundles` (or use the Desktop plugin-inventory UI) and restart DSH.

> Note: the command is `dsh plugin` (a subcommand of the `dsh` CLI), not `dsh-plugin`. The `dsh` CLI is bundled with the Desktop app; if it is not on your `PATH`, invoke it via the app's `node_modules` bin, e.g. `node "<app>/node_modules/@deepseek-ai/dsh/lib/bin.js" plugin --profile web ...`.

### Option C — from source

```bash
git clone https://github.com/zeng6125-rgb/dsh-llm-retry-settings.git
cd dsh-llm-retry-settings
npm install
npm run build        # node scripts/build.mjs → lib/index.js + lib/client.js (no DSH checkout needed)
```

Link the local build into the profile and register the bundle:

```bash
dsh plugin --profile web link "$PWD"
# then add "dsh-llm-retry-settings" to dsh.profile.bundles and restart DSH
```

## Usage

1. Open DSH **Settings → General**.
2. Find the **LLM 自动重试** card.
3. Toggle **开启覆盖** (`enabled`) to apply the override.
4. Set `maxRetries` / `initialDelayMs` / `maxDelayMs` / `jitterRatio`, pick extra **retryable codes** (chips) — or type a code the list does not know into the `自定义` group — and click **保存**.
5. Optionally toggle **输出截断自动续写** (`autoContinue`) and set its `maxContinuations` cap — independent of the retry override above. The line it sends can be rewritten in **续写提示词**; leave it empty for the built-in wording.

Changes are written to the `dsh-llm-retry` settings namespace and picked up live by the retry engine.

## Troubleshooting

**A truncated reply did not get continued.** The host half logs every decision it makes to
`~/.dsh/logs/dsh-llm-retry-settings/host.log` — one line per event, capped at 256 KB. `ctx.logger`
output is not persisted anywhere in desktop builds, so this file is the only way to see what happened.
Read the last lines:

- no `activate v…` line at boot → the plugin is not loaded (check `dsh.profile.bundles` in the profile).
- `activate v…` names the running build — if it is not the version you installed, the agent was not restarted.
- `settings registered … autoContinue=false` → the switch is off.
- a `turn/end …` line with nothing after it → `autoContinue` was off at that moment, or `maxContinuations` is `0`.
- `bail …` → the reason is in the line (no agent instance for this session, `followup` unavailable, …).
- `放弃投递 …` → the agent was still busy when the follow-up was ready, and something changed in the meantime (a new turn started, you typed a message, the session was disposed), so the stale continuation was dropped on purpose.
- `续写已投递 … chain=N/M` → the continuation was queued. `连续续写触顶` means the `maxContinuations` cap is hit; the chain resets as soon as the model finishes a turn normally or you send a message.

**Host-half changes (`lib/index.js`) need a DSH restart.** The client card reloads with the page; the agent does not.

## Configuration

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | Enable the retry-policy override. |
| `maxRetries` | integer (≥ 0) | `2` | Maximum retry count (`0` = do not retry). |
| `initialDelayMs` | integer (≥ 1) | `500` | Initial backoff before the first retry (ms). |
| `maxDelayMs` | integer (≥ 1) | `10000` | Upper bound for backoff (ms). |
| `jitterRatio` | number (0–1) | `0.1` | Random jitter applied to backoff (0 = none). |
| `retryableCodes` | string[] | `["INVALID_REQUEST", "PI_AI_ERROR"]` | Extra failure codes treated as retryable, **merged** into each provider's own list. |
| `autoContinue` | boolean | `false` | When a turn ends truncated by the output-token ceiling, queue one follow-up "continue" turn automatically. |
| `maxContinuations` | integer (≥ 0) | `2` | Cap on consecutive auto-continuations per truncation (`0` = never continue). |
| `continuationPrompt` | string | `""` | The line sent to the model after a truncation; empty (or whitespace-only) falls back to the built-in wording. |
| `continueOnError` | boolean | `false` | Also continue once when a turn ends in a transient error after the retries are exhausted (timeout / transport / server / stream break / empty response). Deterministic failures are never continued. |
| `overrides` | array | `[]` | Per provider/model policy. Each row: `{ provider, model, maxRetries, initialDelayMs, maxDelayMs, jitterRatio }`; `*` or empty matches anything, and a numeric `-1` inherits the global value. First matching row wins. |
| `logPath` | string | (host-injected) | **Read-only.** Absolute path of the host log, injected by the host half for the card's "Open log" button. Not persisted. |

## How it works

The host half registers the `dsh-llm-retry` settings namespace (schema validation + persistence + live sync) and **prepends** an `agent/request-error` listener that rewrites `retryPolicy` before the official `@deepseek-ai/dsh-llm-retry` recover runs:

```text
agent/request-error  →  [this plugin: override count/backoff]  →  dsh-llm-retry recover
```

The auto-continue half listens to the session log instead, because a truncated reply is a *successful* request:

```text
adapter finish="max-tokens"  →  agent-loop turn/end{reason:"max-tokens"}  →  [this plugin]  →  agent.followup(continuationPrompt || built-in wording)
```

`turn-stopping` cannot be used for this: its payload carries no end reason, so it cannot tell "the model finished" from "the model was cut off".
The continuation is sent as a `plugin`-sourced user message, so the chat renders it as an injected-context row labelled `dsh-llm-retry` rather than
pretending you typed it. Constructor-seeded events (resume / fork / replay) never reach `session/event`, so reopening an old truncated session does
not trigger a continuation.

Which wording works is provider-dependent: some relays do not echo the previous `reasoning` back on the next request, so the model cannot see where
its thinking stopped and may restart the task. If that happens, rewrite `continuationPrompt` (e.g. ask it to answer directly without re-thinking) —
sending more "continue" messages cannot fix it.

## UI

Settings → General → **LLM 自动重试** card. Edits are draft-based: click **保存** to commit or **放弃** to discard. After saving, the card verifies the write against the settings snapshot and shows `已保存 ✓` / `保存失败 ✗`.

The card holds two independent sections: the retry override (count / backoff / jitter plus the grouped error-code chips, with a `自定义` group that
accepts free-form codes) and **输出截断自动续写** (its own switch, the `maxContinuations` cap and the `continuationPrompt` textarea). A switched-off
section is dimmed and its inputs are disabled, but the switch itself stays clickable — turning auto-continue on does not require the retry override to be on.

## Requirements

- Host plugin: `@deepseek-ai/dsh-llm-retry`
- Client runtime: `@deepseek-ai/dsh-client-web-react`
- DSH `settings` service

## Build

```bash
npm run build        # node scripts/build.mjs
npm run typecheck    # tsc --noEmit
```

## License

[MIT](./LICENSE)
