# @dsh-external/dsh-llm-retry-settings

DSH「LLM 自动重试」设置卡片：在 **设置 → General** 里调整自动重试的次数与退避时间，宿主 `@deepseek-ai/dsh-llm-retry` 实时生效。

[English](./README.md)

## 功能

- 覆盖 `agent/request-error` 重试策略中的 `maxRetries`、`initialDelayMs`、`maxDelayMs`、`jitterRatio`。
- 保留各 provider 自带的 `mode` 与 `retryableCodes` —— 只覆盖「次数」和「退避时间」。
- 默认 `enabled: false` = 完全旁路：不开启覆盖时，不改动任何东西。

## 配置项

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | 是否开启重试策略覆盖。 |
| `maxRetries` | integer（≥ 0） | `2` | 最大重试次数（`0` = 不重试）。 |
| `initialDelayMs` | integer（≥ 1） | `500` | 首次重试前的初始退避（毫秒）。 |
| `maxDelayMs` | integer（≥ 1） | `10000` | 退避时间上限（毫秒）。 |
| `jitterRatio` | number（0–1） | `0.1` | 退避抖动比例（0 = 无抖动）。 |

## 工作原理

宿主半边注册 `dsh-llm-retry` 设置命名空间（schema 校验 + 持久化 + live 同步），并在 `agent/request-error` 监听链最前端 **prepend** 改写 `retryPolicy`，官方 `@deepseek-ai/dsh-llm-retry` 的 recover 直接消费覆盖后的策略：

```text
agent/request-error  →  [本插件：覆盖次数/退避]  →  dsh-llm-retry recover
```

## 界面

设置 → General → **LLM 自动重试** 卡片。编辑采用草稿模式：点「保存」提交、「放弃」回滚；保存后会对快照做校验，显示 `已保存 ✓` / `保存失败 ✗`。

## 依赖

- 宿主插件：`@deepseek-ai/dsh-llm-retry`
- 客户端运行时：`@deepseek-ai/dsh-client-web-react`
- DSH `settings` 服务

## 构建

```bash
npm run build        # bash scripts/build.sh（需要 DSH_CHECKOUT）
npm run typecheck    # tsc --noEmit
```

## License

[BSD-3-Clause](./LICENSE)
