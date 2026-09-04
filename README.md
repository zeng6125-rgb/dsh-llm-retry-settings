# dsh-llm-retry-settings

A settings card for the DSH LLM auto-retry engine (`@deepseek-ai/dsh-llm-retry`). Tune the retry count and backoff from **Settings → General**; changes take effect immediately. Since 0.1.7 it can also **auto-continue a reply that was cut off by the output-token limit**.

[中文说明](./README.zh-CN.md)

## Features

- **Includes the settings UI** (client bundle `lib/client.js`): a card in **Settings → General** — no separate UI package needed.
- Overrides `maxRetries`, `initialDelayMs`, `maxDelayMs`, and `jitterRatio` on the `agent/request-error` retry policy.
- **New in 0.1.3** — configurable `retryableCodes`: extra failure codes to retry on, **merged** into each provider's own list (never replaces it). Defaults to `INVALID_REQUEST` + `PI_AI_ERROR`, so OpenAI-style HTTP 400 errors (thinking-mode `reasoning_text`) and generic stream failures get retried out of the box.
- **New in 0.1.8** — auto-continue now actually fires. Two host-side timing traps: `session/event` is dispatched *inside* `Session.append`, so queueing the follow-up straight from the listener died on `session append cannot reenter while another append is being published`; once that was fixed, waking the agent at that moment turned out to be silently dropped by the driver (`wakeDriver` only latches in maintenance/abort), so the message sat in the queue forever. The plugin now waits for `agent.whenIdle()` and re-checks (new turn started / you sent a message / session disposed) before delivering.
- **New in 0.1.8** — the host half writes a low-frequency decision log to `~/.dsh/logs/dsh-llm-retry-settings/host.log` (capped at 256 KB) and the card points at it. See [Troubleshooting](#troubleshooting).
- **New in 0.1.7** — error-code list re-audited against the current host build: added `PI_AI_NOT_WARMED` (adapter warm-up race; a delayed retry usually succeeds) plus three amber "retrying will not help" codes (`UNKNOWN_MODEL`, `UNSUPPORTED_OPTION`, `REQUEST_EXTENSION`). Also clarified `TIMEOUT`: a stalled SSE stream (stream-idle watchdog) is reported as `TIMEOUT` — there is no separate code for it, so the host default retry list already covers hangs.
- **New in 0.1.7** — **auto-continue on output truncation** (`autoContinue`, off by default). Hitting the output-token ceiling is *not* a request failure — the call returns successfully with `finish = max-tokens` — so no retry policy can ever cover it. When enabled, the plugin watches `turn/end` and queues one follow-up continuation turn per truncation, at most `maxContinuations` times in a row (the counter resets when the model finishes normally or you send a new message).
- **New in 0.1.7** — the error-code chips are grouped into six categories ordered by "will retrying help": transient → rate limit & quota → request & parameters → content & capability → credentials → abort & fallback. Each group shows how many of its codes you selected; picked codes still float to the front *within their own group*.
- **New in 0.1.5** — selected error codes float to the front of the chip list, with the unselected ones after them; the order inside each group stays fixed, so chips never jump around when you toggle them. (Since 0.1.7 the floating happens within each category group.)
- Default `enabled: false` = fully bypassed; nothing changes until you enable the override.

## Install

Prerequisite: a DSH Desktop profile (the web profile lives at `~/.dsh/profiles/web`).

### Option A — GitHub Release package (recommended)

```bash
# 1. download the packaged plugin tgz from the v0.1.8 release
gh release download v0.1.8 -R zeng6125-rgb/dsh-llm-retry-settings

# 2. unpack it into the profile's node_modules
mkdir -p ~/.dsh/profiles/web/node_modules
tar -xzf dsh-llm-retry-settings-0.1.8.tgz -C ~/.dsh/profiles/web/node_modules/
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
dsh plugin --profile web add https://github.com/zeng6125-rgb/dsh-llm-retry-settings/releases/download/v0.1.8/dsh-llm-retry-settings-0.1.8.tgz
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
4. Set `maxRetries` / `initialDelayMs` / `maxDelayMs` / `jitterRatio`, pick extra **retryable codes** (chips), and click **保存**.
5. Optionally toggle **输出截断自动续写** (`autoContinue`) and set its `maxContinuations` cap — independent of the retry override above.

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

## How it works

The host half registers the `dsh-llm-retry` settings namespace (schema validation + persistence + live sync) and **prepends** an `agent/request-error` listener that rewrites `retryPolicy` before the official `@deepseek-ai/dsh-llm-retry` recover runs:

```text
agent/request-error  →  [this plugin: override count/backoff]  →  dsh-llm-retry recover
```

The auto-continue half listens to the session log instead, because a truncated reply is a *successful* request:

```text
adapter finish="max-tokens"  →  agent-loop turn/end{reason:"max-tokens"}  →  [this plugin]  →  agent.followup("continue")
```

`turn-stopping` cannot be used for this: its payload carries no end reason, so it cannot tell "the model finished" from "the model was cut off".
The continuation is sent as a `plugin`-sourced user message, so the chat renders it as an injected-context row labelled `dsh-llm-retry` rather than
pretending you typed it. Constructor-seeded events (resume / fork / replay) never reach `session/event`, so reopening an old truncated session does
not trigger a continuation.

## UI

Settings → General → **LLM 自动重试** card. Edits are draft-based: click **保存** to commit or **放弃** to discard. After saving, the card verifies the write against the settings snapshot and shows `已保存 ✓` / `保存失败 ✗`.

The card holds two independent sections: the retry override (count / backoff / jitter plus the grouped error-code chips) and **输出截断自动续写**
(its own switch plus the `maxContinuations` cap). A switched-off section is dimmed, but its switch stays clickable — turning auto-continue on does
not require the retry override to be on.

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
