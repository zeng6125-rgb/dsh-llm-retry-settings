# dsh-llm-retry-settings

DSH「LLM 自动重试」设置卡片：在 **设置 → General** 里调整自动重试的次数与退避时间，宿主 `@deepseek-ai/dsh-llm-retry` 实时生效。0.1.7 起还能**在回答被输出 token 上限截断时自动续写**。

[English](./README.md)

## 功能

- **自带设置 UI**（客户端 bundle `lib/client.js`）：一张位于 **设置 → General** 的卡片，无需另外装 UI 包。
- 覆盖 `agent/request-error` 重试策略中的 `maxRetries`、`initialDelayMs`、`maxDelayMs`、`jitterRatio`。
- **0.1.3 新增** `retryableCodes`：可勾选的额外重试错误码，与各 provider 自带列表 **合并（去重）而非替换**。默认补入 `INVALID_REQUEST` + `PI_AI_ERROR`，开箱即重试 OpenAI 式 HTTP 400（thinking 模式 `reasoning_text`）与流式失败兜底码。
- **0.1.7 新增** 重新按当前宿主核对错误码清单：补入 `PI_AI_NOT_WARMED`（适配器预热竞态，退避后重试通常能成）与三个琥珀色「重试无意义」码（`UNKNOWN_MODEL`、`UNSUPPORTED_OPTION`、`REQUEST_EXTENSION`）。同时澄清 `TIMEOUT`：SSE 卡流（stream idle 看门狗）就是以 `TIMEOUT` 上报，并没有独立错误码，宿主默认重试码表已覆盖。
- **0.1.7 新增** **输出截断自动续写**（`autoContinue`，默认关闭）。撞到输出 token 上限**不是请求失败**——请求是成功返回的，只是 `finish = max-tokens`——所以任何重试策略都管不到它。开启后本插件监听 `turn/end`，每次截断补一轮续写，最多连续 `maxContinuations` 次（模型正常说完或你重新发言即重新计数）。
- **0.1.7 新增** 错误码 chip 按「重试有没有恢复价值」分六组：瞬时故障 → 限流与配额 → 请求与参数 → 内容与能力 → 凭证与鉴权 → 取消与兜底，组标题上标出该组已选数量；已选中的码仍在**自己那一组内**靠前。
- **0.1.6 新增** 已选中的错误码自动靠前，未选中的排在分隔线之后；组内顺序固定，勾选时 chip 不会乱跳。
- 默认 `enabled: false` = 完全旁路：不开启覆盖时，不改动任何东西。

## 安装

前置：一个 DSH Desktop profile（web profile 位于 `~/.dsh/profiles/web`）。

### 方式 A —— GitHub Release 安装包（推荐）

```bash
# 1. 从 v0.1.7 release 下载打包好的插件 tgz
gh release download v0.1.7 -R zeng6125-rgb/dsh-llm-retry-settings

# 2. 解压进 profile 的 node_modules
mkdir -p ~/.dsh/profiles/web/node_modules
tar -xzf dsh-llm-retry-settings-0.1.7.tgz -C ~/.dsh/profiles/web/node_modules/
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
dsh plugin --profile web add https://github.com/zeng6125-rgb/dsh-llm-retry-settings/releases/download/v0.1.7/dsh-llm-retry-settings-0.1.7.tgz
```

装完还需要在 profile 里启用：把 `"dsh-llm-retry-settings"` 加进 `dsh.profile.bundles`（或使用 Desktop 的插件管理 UI），然后重启 DSH。

> 注意：命令是 **`dsh plugin`**（`dsh` CLI 的子命令），不是 `dsh-plugin`。`dsh` CLI 随 Desktop 应用内置；如果不在 `PATH` 里，用 app 的 bin 调用，例如 `node "<app>/node_modules/@deepseek-ai/dsh/lib/bin.js" plugin --profile web ...`。

### 方式 C —— 源码

```bash
git clone https://github.com/zeng6125-rgb/dsh-llm-retry-settings.git
cd dsh-llm-retry-settings
npm install
npm run build        # node scripts/build.mjs → lib/index.js + lib/client.js（不需要 DSH 源码树）
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
5. 需要的话打开**输出截断自动续写**（`autoContinue`）并设置 `maxContinuations` 上限——它与上面的重试覆盖互不影响。

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
| `autoContinue` | boolean | `false` | 回合因输出 token 上限被截断时，自动补一轮「继续」。 |
| `maxContinuations` | integer（≥ 0） | `2` | 同一次截断后连续续写的上限（`0` = 永不续写）。 |

## 工作原理

宿主半边注册 `dsh-llm-retry` 设置命名空间（schema 校验 + 持久化 + live 同步），并在 `agent/request-error` 监听链最前端 **prepend** 改写 `retryPolicy`，官方 `@deepseek-ai/dsh-llm-retry` 的 recover 直接消费覆盖后的策略：

```text
agent/request-error  →  [本插件：覆盖次数/退避]  →  dsh-llm-retry recover
```

自动续写那一半走的是会话事件流，因为被截断的回复本质上是一次**成功**的请求：

```text
适配器 finish="max-tokens"  →  agent-loop turn/end{reason:"max-tokens"}  →  [本插件]  →  agent.followup("继续")
```

不能用 `agent/turn-stopping`：它的 payload 里没有结束原因，分不清「模型说完了」和「模型被截断了」。
续写消息的 `source.kind` 是 `plugin`，因此聊天里渲染成一条标注 `dsh-llm-retry` 的注入上下文行，而不是伪装成你亲自发的消息。
构造期种子事件（resume / fork / replay）不会进入 `session/event`，所以重新打开一个历史上被截断过的旧会话不会触发续写。

## 界面

设置 → General → **LLM 自动重试** 卡片。编辑采用草稿模式：点「保存」提交、「放弃」回滚；保存后会对快照做校验，显示 `已保存 ✓` / `保存失败 ✗`。

卡片内是两块互不影响的能力：上面的重试覆盖（次数 / 退避 / 抖动 + 分组错误码 chip）与下面的**输出截断自动续写**（独立开关 + `maxContinuations` 上限）。
关闭的那一块会置灰，但开关本身仍可点击——开自动续写不需要先开重试覆盖。

## 依赖

- 宿主插件：`@deepseek-ai/dsh-llm-retry`
- 客户端运行时：`@deepseek-ai/dsh-client-web-react`
- DSH `settings` 服务

## 构建

```bash
npm run build        # node scripts/build.mjs
npm run typecheck    # tsc --noEmit
```

## License

[MIT](./LICENSE)
