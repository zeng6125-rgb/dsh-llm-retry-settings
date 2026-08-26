# dsh-llm-retry-settings

DSH「LLM 自动重试」设置卡片：在 **设置 → General** 里调整自动重试的次数与退避时间，宿主 `@deepseek-ai/dsh-llm-retry` 实时生效。

[English](./README.md)

## 功能

- **自带设置 UI**（客户端 bundle `lib/client.js`）：一张位于 **设置 → General** 的卡片，无需另外装 UI 包。
- 覆盖 `agent/request-error` 重试策略中的 `maxRetries`、`initialDelayMs`、`maxDelayMs`、`jitterRatio`。
- **0.1.3 新增** `retryableCodes`：可勾选的额外重试错误码，与各 provider 自带列表 **合并（去重）而非替换**。默认补入 `INVALID_REQUEST` + `PI_AI_ERROR`，开箱即重试 OpenAI 式 HTTP 400（thinking 模式 `reasoning_text`）与流式失败兜底码。
- 默认 `enabled: false` = 完全旁路：不开启覆盖时，不改动任何东西。

## 安装

前置：一个 DSH Desktop profile（web profile 位于 `~/.dsh/profiles/web`）。

### 方式 A —— GitHub Release 安装包（推荐）

```bash
# 1. 从 v0.1.4 release 下载打包好的插件 tgz
gh release download v0.1.4 -R zeng6125-rgb/dsh-llm-retry-settings

# 2. 解压进 profile 的 node_modules
mkdir -p ~/.dsh/profiles/web/node_modules
tar -xzf dsh-llm-retry-settings-0.1.4.tgz -C ~/.dsh/profiles/web/node_modules/
mv ~/.dsh/profiles/web/node_modules/package \
   ~/.dsh/profiles/web/node_modules/dsh-llm-retry-settings

# 3. 在 profile 里注册 bundle，然后重启 DSH
#    在 ~/.dsh/profiles/web/package.json 的 dsh.profile.bundles 里加 "dsh-llm-retry-settings"
```

### 方式 B —— dsh CLI / pnpm（需要 git + 网络）

`dsh plugin` 命令会把参数转发给 profile 目录里的 `pnpm`：

```bash
# 从 git 仓库安装（pnpm 会 clone；lib/ 已提交，无需构建）
dsh plugin --profile web add github:zeng6125-rgb/dsh-llm-retry-settings

# 或从 release tarball 地址安装
dsh plugin --profile web add https://github.com/zeng6125-rgb/dsh-llm-retry-settings/releases/download/v0.1.4/dsh-llm-retry-settings-0.1.4.tgz
```

装完还需要在 profile 里启用：把 `"dsh-llm-retry-settings"` 加进 `dsh.profile.bundles`（或使用 Desktop 的插件管理 UI），然后重启 DSH。

> 注意：命令是 **`dsh plugin`**（`dsh` CLI 的子命令），不是 `dsh-plugin`。`dsh` CLI 随 Desktop 应用内置；如果不在 `PATH` 里，用 app 的 bin 调用，例如 `node "<app>/node_modules/@deepseek-ai/dsh/lib/bin.js" plugin --profile web ...`。

### 方式 C —— 源码

```bash
git clone https://github.com/zeng6125-rgb/dsh-llm-retry-settings.git
cd dsh-llm-retry-settings
npm run build        # bash scripts/build.sh（需要 DSH_CHECKOUT）
```

把本地构建 link 进 profile 并注册 bundle：

```bash
dsh plugin --profile web link "$PWD"
# 然后把 "dsh-llm-retry-settings" 加进 dsh.profile.bundles 并重启 DSH
```

## 使用

1. 打开 DSH **设置 → General**。
2. 找到 **LLM 自动重试** 卡片。
3. 打开 **开启覆盖**（`enabled`）。
4. 设置 `maxRetries` / `initialDelayMs` / `maxDelayMs` / `jitterRatio`，按需点选 **可重试错误码** chip，点 **保存**。

改动会写入 `dsh-llm-retry` 设置命名空间，重试引擎实时生效。

## 配置项

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | 是否开启重试策略覆盖。 |
| `maxRetries` | integer（≥ 0） | `2` | 最大重试次数（`0` = 不重试）。 |
| `initialDelayMs` | integer（≥ 1） | `500` | 首次重试前的初始退避（毫秒）。 |
| `maxDelayMs` | integer（≥ 1） | `10000` | 退避时间上限（毫秒）。 |
| `jitterRatio` | number（0–1） | `0.1` | 退避抖动比例（0 = 无抖动）。 |
| `retryableCodes` | string[] | `["INVALID_REQUEST", "PI_AI_ERROR"]` | 额外视为可重试的错误码，与各 provider 自带列表合并。 |

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

[MIT](./LICENSE)
