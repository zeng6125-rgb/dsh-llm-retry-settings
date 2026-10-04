# dsh-llm-retry-settings

DSH「LLM 自动重试」设置卡片：在 **设置 → General** 里调整自动重试的次数与退避时间，宿主 `@deepseek-ai/dsh-llm-retry` 实时生效。0.1.7 起还能**在回答被输出 token 上限截断时自动续写**；0.1.9 起额外错误码与续写提示词都能自己写。

[English](./README.md)

## 功能

- **自带设置 UI**（客户端 bundle `lib/client.js`）：一张位于 **设置 → General** 的卡片，无需另外装 UI 包。
- 覆盖 `agent/request-error` 重试策略中的 `maxRetries`、`initialDelayMs`、`maxDelayMs`、`jitterRatio`。
- **0.1.13 修复** 设置卡片滑动明显更顺：滚动容器补上合成层提示（实测滚动 p99 30.2ms → 6.2~12.1ms，超过 16.7ms 的帧从 11~13/410 降到 0~2/410）。
- **0.1.13 修复** 插件重载后 **model 级覆盖规则不再静默失效**：内核只在**首次**请求与**变化**时补发 `request/header`/`request/context`（首次标记挂在 AgentLoop 实例上，重载不会重置），所以重载前就已发过请求的会话取不到 model；现在回落到会话自身的 `requestContext()` / `requestHeader()`，诊断里的 `model=(n/a)` 随之消失。
- **0.1.13 修复** 设置改动**即时生效**：`loader/volatile-update` 监听改用 `{ global: true }` —— 内核的过滤器拿裸 fiber 与 entry 的包装体比较，恒不相等，此前该事件根本收不到（官方 `dsh-llm-deepseek` / `dsh-llm-pi-ai` 等同样收不到）。
- **0.1.13 修复** 英文界面不再混中文：25 条错误码说明与 6 个分组标题进字典；设置页左侧入口名不再滞后于语言切换。
- **0.1.13 修复** 若干细节：观测路由 `?tail=` 参数归一化、抖动比例单位、初始退避 > 最大退避时的显示、自定义错误码被拒时输入不再被清空、重试耗尽改用独立续写文案、chip 与输入框补可访问性属性。
- **0.1.12 修复** 会话格式 v4 下自动续写投递失败：消息 source 必须是 producer-owned 形态，续写消息改携 `source.kind = "plugin:dsh-llm-retry"`（退役的 `{kind:"plugin"}` 包装不再被接受）；host.log 的「续写消息已入会话」识别同步恢复。
- **0.1.11 新增** 支持新内核 **0.1.7-alpha.1**（设置 API 迁移到 `SettingsForms`：volatile 表单字段、`loader/volatile-update` 实时同步、卡片经 `remote.settings` 读写）。
- **0.1.11 新增** 改善设置卡片滑动流畅度，修复 bug。
- **0.1.10 新增** 卡片底部**重试观测面板**（只读）：请求失败重试、自动续写、触顶、让位用户的计数，按错误码与 provider/model 拆分，并列出当前会话模型（覆盖规则照抄即可），可展开日志尾部。
- **0.1.10 新增** **按 provider / model 的策略**：按顺序取第一条命中的规则，支持 `*` 通配，数值留空即继承全局值。
- **0.1.10 新增** **退避曲线 + 等待预算**、「重试彻底失败后也续写」开关（仅瞬时错误）、提示词模板，以及跟随内核语言的中英文界面。
- **0.1.9 新增** 可以直接在卡片上**输入自定义错误码**（`自定义` 分组）：provider 抛出的码不在已知清单里时，输入（如 `MY_PROVIDER_BUSY`）后点**添加**即可。输入会自动转大写并校验（仅限 `A-Z 0-9 _ - .`），重复或非法输入给出内联提示，码原样进入 `retryableCodes`。
- **0.1.9 新增** **续写提示词可自定义**（`continuationPrompt`）：留空使用内置文案，也可以自己写一句，适配不同中转/模型对措辞的偏好。
- **0.1.8 修复** 自动续写现在真的会发出去了。宿主半边两道时机坑：`session/event` 是在 `Session.append` **内部**同步派发的，在监听器里直接排续写会撞 `session append cannot reenter while another append is being published`；绕开之后又发现此刻唤醒 agent 会被驱动静默丢弃（`wakeDriver` 只在 maintenance/abort 下才 latch），消息就永远卡在队列里。现在改成先 `await agent.whenIdle()` 再投递，投递前复核（已开新回合 / 你重新发言 / 会话已 dispose 则放弃）。
- **0.1.8 新增** 宿主半边把每一步决策写进 `~/.dsh/logs/dsh-llm-retry-settings/host.log`（低频、256 KB 封顶），设置卡片上也标了这个路径。见 [排错](#排错)。
- **0.1.7 新增** 重新按当前宿主核对错误码清单：补入 `PI_AI_NOT_WARMED`（适配器预热竞态，退避后重试通常能成）与三个琥珀色「重试无意义」码（`UNKNOWN_MODEL`、`UNSUPPORTED_OPTION`、`REQUEST_EXTENSION`）。同时澄清 `TIMEOUT`：SSE 卡流（stream idle 看门狗）就是以 `TIMEOUT` 上报，并没有独立错误码，宿主默认重试码表已覆盖。
- **0.1.7 新增** **输出截断自动续写**（`autoContinue`，默认关闭）。撞到输出 token 上限**不是请求失败**——请求是成功返回的，只是 `finish = max-tokens`——所以任何重试策略都管不到它。开启后本插件监听 `turn/end`，每次截断补一轮续写，最多连续 `maxContinuations` 次（模型正常说完或你重新发言即重新计数）。
- **0.1.7 新增** 错误码 chip 按「重试有没有恢复价值」分六组：瞬时故障 → 限流与配额 → 请求与参数 → 内容与能力 → 凭证与鉴权 → 取消与兜底，组标题上标出该组已选数量；已选中的码仍在**自己那一组内**靠前。
- **0.1.5 新增** 已选中的错误码自动靠前，未选中的排在其后；组内顺序固定，勾选时 chip 不会乱跳。（0.1.7 起改为在各分组内部靠前。）
- **0.1.3 新增** `retryableCodes`：可勾选的额外重试错误码，与各 provider 自带列表 **合并（去重）而非替换**。默认补入 `INVALID_REQUEST` + `PI_AI_ERROR`，开箱即重试 OpenAI 式 HTTP 400（thinking 模式 `reasoning_text`）与流式失败兜底码。
- 默认 `enabled: false` = 完全旁路：不开启覆盖时，不改动任何东西。

## 安装

前置：一个 DSH Desktop profile（web profile 位于 `~/.dsh/profiles/web`）。

### 方式 A —— GitHub Release 安装包（推荐）

```bash
# 1. 从 v0.1.13 release 下载打包好的插件 tgz
gh release download v0.1.13 -R zeng6125-rgb/dsh-llm-retry-settings

# 2. 解压进 profile 的 node_modules
mkdir -p ~/.dsh/profiles/web/node_modules
tar -xzf dsh-llm-retry-settings-0.1.13.tgz -C ~/.dsh/profiles/web/node_modules/
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
dsh plugin --profile web add https://github.com/zeng6125-rgb/dsh-llm-retry-settings/releases/download/v0.1.13/dsh-llm-retry-settings-0.1.13.tgz
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
4. 设置 `maxRetries` / `initialDelayMs` / `maxDelayMs` / `jitterRatio`，按需点选 **可重试错误码** chip；清单里没有的码可以在 `自定义` 分组里输入后点**添加**，最后点 **保存**。
5. 需要的话打开**输出截断自动续写**（`autoContinue`）并设置 `maxContinuations` 上限——它与上面的重试覆盖互不影响。续写要发的那句话可以在**续写提示词**里改，留空即用内置文案。

改动会写入 `dsh-llm-retry` 设置命名空间，重试引擎实时生效。

## 排错

**回答被截断但没有自动续写。** 宿主半边会把每一步决策写进
`~/.dsh/logs/dsh-llm-retry-settings/host.log`——一个事件一行，超过 256 KB 重写一次。
桌面版的 `ctx.logger` 不落任何可读文件，所以这个日志是唯一的观察口。看最后几行：

- 启动处没有 `activate v…` → 插件没被加载（查 profile 里的 `dsh.profile.bundles`）。
- `activate v…` 会写明当前跑的是哪一版构建——不是你刚装的那版，就是没重启 agent。
- `settings registered … autoContinue=false` → 开关没开。
- 有 `turn/end …` 但后面没内容 → 那一刻 `autoContinue` 是关的，或 `maxContinuations` 是 `0`。
- `bail …` → 原因在行里（该会话没有 agent 实例、`followup` 不可用……）。
- `放弃投递 …` → 等 agent 空闲期间情况变了（开了新回合、你重新发言、会话被 dispose），这条过期续写按设计丢弃。
- `续写已投递 … chain=N/M` → 已排队发出。`连续续写触顶` 表示到了 `maxContinuations` 上限；模型正常说完或你发一条消息即重新计数。

**改宿主半边（`lib/index.js`）必须重启 DSH。** 客户端卡片刷新页面即可，agent 不会热重载。

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
| `continuationPrompt` | string | `""` | 截断后自动发给模型的那句话；留空（或只有空白）使用内置文案。 |
| `continueOnError` | boolean | `false` | 重试次数用尽后，若结束原因是瞬时错误（超时 / 传输 / 服务端 / 流中断 / 空响应），也补一轮续写；确定性错误不补。 |
| `overrides` | array | `[]` | 按 provider / model 的策略。每行 `{ provider, model, maxRetries, initialDelayMs, maxDelayMs, jitterRatio }`；`*` 或留空 = 任意，数值 `-1` = 继承全局值。按顺序取第一条命中。 |
| `logPath` | string | （宿主注入） | **只读。** 宿主日志绝对路径，由宿主半边注入给卡片的「打开日志」按钮，不写回设置文件。 |

## 工作原理

宿主半边注册 `dsh-llm-retry` 设置命名空间（schema 校验 + 持久化 + live 同步），并在 `agent/request-error` 监听链最前端 **prepend** 改写 `retryPolicy`，官方 `@deepseek-ai/dsh-llm-retry` 的 recover 直接消费覆盖后的策略：

```text
agent/request-error  →  [本插件：覆盖次数/退避]  →  dsh-llm-retry recover
```

自动续写那一半走的是会话事件流，因为被截断的回复本质上是一次**成功**的请求：

```text
适配器 finish="max-tokens"  →  agent-loop turn/end{reason:"max-tokens"}  →  [本插件]  →  agent.followup(continuationPrompt || 内置文案)
```

不能用 `agent/turn-stopping`：它的 payload 里没有结束原因，分不清「模型说完了」和「模型被截断了」。
续写消息的 `source.kind` 是 `plugin`，因此聊天里渲染成一条标注 `dsh-llm-retry` 的注入上下文行，而不是伪装成你亲自发的消息。
构造期种子事件（resume / fork / replay）不会进入 `session/event`，所以重新打开一个历史上被截断过的旧会话不会触发续写。

哪种措辞有效取决于 provider：有些中转不会在下一轮请求里回显上一段的 `reasoning`，模型看不到自己的思考停在哪，就可能把任务从头重做。
遇到这种情况请改 `continuationPrompt`（例如让它直接作答、不要再长篇思考）——多发几条「继续」是解决不了的。

## 界面

设置 → General → **LLM 自动重试** 卡片。编辑采用草稿模式：点「保存」提交、「放弃」回滚；保存后会对快照做校验，显示 `已保存 ✓` / `保存失败 ✗`。

卡片内是两块互不影响的能力：上面的重试覆盖（次数 / 退避 / 抖动 + 分组错误码 chip，另有可自由输入码的 `自定义` 分组）与下面的**输出截断自动续写**（独立开关 + `maxContinuations` 上限 + `continuationPrompt` 输入框）。
关闭的那一块会置灰且输入框不可编辑，但开关本身仍可点击——开自动续写不需要先开重试覆盖。

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
