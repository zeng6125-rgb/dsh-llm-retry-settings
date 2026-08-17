# @dsh-external/dsh-llm-retry-settings

A settings card for the DSH LLM auto-retry engine (`@deepseek-ai/dsh-llm-retry`). Tune the retry count and backoff from **Settings → General**; changes take effect immediately.

[中文说明](./README.zh-CN.md)

## Features

- Overrides `maxRetries`, `initialDelayMs`, `maxDelayMs`, and `jitterRatio` on the `agent/request-error` retry policy.
- Preserves each provider's own `mode` and `retryableCodes` — only the retry count and backoff timing are overridden.
- Default `enabled: false` = fully bypassed; nothing changes until you enable the override.

## Configuration

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | Enable the retry-policy override. |
| `maxRetries` | integer (≥ 0) | `2` | Maximum retry count (`0` = do not retry). |
| `initialDelayMs` | integer (≥ 1) | `500` | Initial backoff before the first retry (ms). |
| `maxDelayMs` | integer (≥ 1) | `10000` | Upper bound for backoff (ms). |
| `jitterRatio` | number (0–1) | `0.1` | Random jitter applied to backoff (0 = none). |

## How it works

The host half registers the `dsh-llm-retry` settings namespace (schema validation + persistence + live sync) and **prepends** an `agent/request-error` listener that rewrites `retryPolicy` before the official `@deepseek-ai/dsh-llm-retry` recover runs:

```text
agent/request-error  →  [this plugin: override count/backoff]  →  dsh-llm-retry recover
```

## UI

Settings → General → **LLM 自动重试** card. Edits are draft-based: click **Save** to commit or **Revert** to discard. After saving, the card verifies the write against the settings snapshot and shows `已保存 ✓` / `保存失败 ✗`.

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

[BSD-3-Clause](./LICENSE)
