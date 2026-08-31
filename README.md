# dsh-llm-retry-settings

A settings card for the DSH LLM auto-retry engine (`@deepseek-ai/dsh-llm-retry`). Tune the retry count and backoff from **Settings → General**; changes take effect immediately.

[中文说明](./README.zh-CN.md)

## Features

- **Includes the settings UI** (client bundle `lib/client.js`): a card in **Settings → General** — no separate UI package needed.
- Overrides `maxRetries`, `initialDelayMs`, `maxDelayMs`, and `jitterRatio` on the `agent/request-error` retry policy.
- **New in 0.1.3** — configurable `retryableCodes`: extra failure codes to retry on, **merged** into each provider's own list (never replaces it). Defaults to `INVALID_REQUEST` + `PI_AI_ERROR`, so OpenAI-style HTTP 400 errors (thinking-mode `reasoning_text`) and generic stream failures get retried out of the box.
- **New in 0.1.5** — selected error codes float to the front of the chip list, with the unselected ones behind a divider; the order inside each group stays fixed, so chips never jump around when you toggle them.
- Default `enabled: false` = fully bypassed; nothing changes until you enable the override.

## Install

Prerequisite: a DSH Desktop profile (the web profile lives at `~/.dsh/profiles/web`).

### Option A — GitHub Release package (recommended)

```bash
# 1. download the packaged plugin tgz from the v0.1.5 release
gh release download v0.1.5 -R zeng6125-rgb/dsh-llm-retry-settings

# 2. unpack it into the profile's node_modules
mkdir -p ~/.dsh/profiles/web/node_modules
tar -xzf dsh-llm-retry-settings-0.1.5.tgz -C ~/.dsh/profiles/web/node_modules/
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
dsh plugin --profile web add https://github.com/zeng6125-rgb/dsh-llm-retry-settings/releases/download/v0.1.5/dsh-llm-retry-settings-0.1.5.tgz
```

Then enable the plugin in the profile: add `"dsh-llm-retry-settings"` to `dsh.profile.bundles` (or use the Desktop plugin-inventory UI) and restart DSH.

> Note: the command is `dsh plugin` (a subcommand of the `dsh` CLI), not `dsh-plugin`. The `dsh` CLI is bundled with the Desktop app; if it is not on your `PATH`, invoke it via the app's `node_modules` bin, e.g. `node "<app>/node_modules/@deepseek-ai/dsh/lib/bin.js" plugin --profile web ...`.

### Option C — from source

```bash
git clone https://github.com/zeng6125-rgb/dsh-llm-retry-settings.git
cd dsh-llm-retry-settings
npm run build        # bash scripts/build.sh (requires DSH_CHECKOUT)
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

Changes are written to the `dsh-llm-retry` settings namespace and picked up live by the retry engine.

## Configuration

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | Enable the retry-policy override. |
| `maxRetries` | integer (≥ 0) | `2` | Maximum retry count (`0` = do not retry). |
| `initialDelayMs` | integer (≥ 1) | `500` | Initial backoff before the first retry (ms). |
| `maxDelayMs` | integer (≥ 1) | `10000` | Upper bound for backoff (ms). |
| `jitterRatio` | number (0–1) | `0.1` | Random jitter applied to backoff (0 = none). |
| `retryableCodes` | string[] | `["INVALID_REQUEST", "PI_AI_ERROR"]` | Extra failure codes treated as retryable, **merged** into each provider's own list. |

## How it works

The host half registers the `dsh-llm-retry` settings namespace (schema validation + persistence + live sync) and **prepends** an `agent/request-error` listener that rewrites `retryPolicy` before the official `@deepseek-ai/dsh-llm-retry` recover runs:

```text
agent/request-error  →  [this plugin: override count/backoff]  →  dsh-llm-retry recover
```

## UI

Settings → General → **LLM 自动重试** card. Edits are draft-based: click **保存** to commit or **放弃** to discard. After saving, the card verifies the write against the settings snapshot and shows `已保存 ✓` / `保存失败 ✗`.

## Requirements

- Host plugin: `@deepseek-ai/dsh-llm-retry`
- Client runtime: `@deepseek-ai/dsh-client-web-react`
- DSH `settings` service

## Build

```bash
npm run build        # bash scripts/build.sh (requires DSH_CHECKOUT)
npm run typecheck    # tsc --noEmit
```

## License

[MIT](./LICENSE)
