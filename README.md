<p align="center">
  <img src="https://open-design.ai/apple-touch-icon.png" width="72" height="72" alt="OpenDesign logo" />
</p>

# OpenDesign Community Plugin / OpenDesign 社区插件

**非官方插件 · Unofficial plugin**

[中文](#中文) · [English](#english) · [OpenDesign 官网 / Official website](https://open-design.ai/) · [Magpie 插件文档 / Plugin docs](https://usemagpie.ai/docs/plugins)

## 中文

在 Magpie / OpenCode 中使用你的 OpenDesign 账号，发现可用模型，并在 Magpie 中查询美元余额、积分和 Coding Plan 周期额度。Provider ID 为 `opendesign`。

> 本项目由社区独立维护，**不是 OpenDesign 或 Magpie 官方插件**，不隶属于其团队，也未获得其官方背书。问题请提交到[本仓库 Issues](https://github.com/ezdemo/opencode-opendesign-auth/issues)。

### 功能

- 从本地 `~/.amr/config.json` 的 `profiles.prod` 只读导入登录信息。
- 动态获取账号可用的模型，读取上下文长度与输入能力，过滤禁用模型。
- 使用 OpenAI Chat Completions 协议，转发普通请求、流式请求与工具调用参数。
- 在 Magpie 中分别查看钱包、订阅积分、充值积分及 Coding Plan 周期的已用、剩余、上限和重置时间。
- 将 OpenDesign 官网 PNG 图标内嵌到插件中，作为 Magpie 提供商图标，加载时无需下载图标。

### 安装与登录

先在 OpenDesign 桌面端登录，确认本地存在 `~/.amr/config.json`，再运行：

```sh
magpie plugin add github:ezdemo/opencode-opendesign-auth
magpie plugin login opendesign
```

选择 **Import OpenDesign local prod sign-in**。要显示 Coding Plan 的周期百分比，填写对应的 **Workspace ID**。也可以稍后通过插件选项配置：

```sh
magpie plugin options github:ezdemo/opencode-opendesign-auth '{"workspaceId":"your-workspace-id"}'
```

未配置工作区时，余额仍可查询，但周期额度会明确报错，不会假装剩余 100% 或没有额度上限。

本地开发或从目录安装：

```sh
git clone https://github.com/ezdemo/opencode-opendesign-auth.git
cd opencode-opendesign-auth
magpie plugin add .
magpie plugin login opendesign
```

Magpie 的 `auth.usage` 用量查询是扩展功能，OpenCode 不调用这一 Hook。包提供 OpenCode 兼容的认证、模型和请求 Hook；本仓库尚未发布到 npm。

### 配置选项

选项保存在 Magpie `plugins.json` 中对应插件条目的 `options` 内：

```json
{
  "workspaceId": "your-workspace-id",
  "configPath": "C:/Users/you/.amr/config.json",
  "velaPath": "C:/path/to/vela.exe"
}
```

| 选项 | 用途 |
| --- | --- |
| `workspaceId` | Coding Plan 周期查询所需的工作区 ID；未填写时周期查询报错。 |
| `configPath` | 可选，默认读取 `~/.amr/config.json`。 |
| `velaPath` | 可选，指定 Vela 可执行文件位置。 |

也支持环境变量 `OPENDESIGN_WORKSPACE_ID`。工作区 ID 的优先级是：导入登录时保存的值 → 插件选项 → 环境变量。

Windows 自动查找桌面端自带的 `%LOCALAPPDATA%/Programs/Open Design/resources/open-design/bin/vela.exe`；未找到时，以及其他系统上，使用 PATH 中的 Vela。Vela 必须登录到与插件相同的 prod 账号。

### 接口与额度显示

| 操作 | 接口或命令 | 凭据 / 主要字段 |
| --- | --- | --- |
| 模型列表 | `GET https://amr-link.open-design.ai/v1/models` | `runtimeKey` |
| AI 调用 | `POST https://amr-link.open-design.ai/v1/chat/completions` | `runtimeKey`；`model`、`messages`、`stream` |
| 钱包余额 | `GET https://amr-api.open-design.ai/api/v1/wallet/balance` | `controlKey`；`balanceUsd` |
| 账单摘要 | `GET https://amr-api.open-design.ai/api/v1/billing/summary` | `controlKey`；`membershipTier`、`subscriptionStatus`、`balances` |
| 周期额度 | `vela billing preflight --workspace-id <id> --format json` | CLI 本地登录；`codingPlan.windows[]` |

两类 API Key 均通过 `Authorization: Bearer <key>` 使用，职责分别对应运行时和账户查询。

**钱包和积分是余额，不是百分比。** 只有真实的 Coding Plan 周期形成额度窗口。例如：

| 周期 | 已用 / 上限 | 剩余 | 显示的剩余百分比 |
| --- | --- | --- | --- |
| 5 小时 | 0 / 50,000 积分 | 50,000 积分 | 100% |
| 7 天 | 150,445 / 150,000 积分 | 0 积分 | 0% |

上表为示例，不代表任何账号的当前额度。超额使用保留超过 100% 的已用比例；钱包为零不等于周期用尽。查询失败、数据缺失或未配置工作区不会换算成零。部分查询失败时保留成功字段，Magpie 可能用错误信息替代周期行。真实周期窗口参与 Magpie 的周期额度判断。

### 凭据与故障排查

- 本地 OpenDesign 配置只读；导入后，两类 Key 会保存在 Magpie 的 `plugin-auth.json` 或 OpenCode 的认证存储中。请保护这些文件。
- 插件不会主动打印 Key，转发错误响应时会对其中反射出的 Key 脱敏；不接受把 Key 写进插件选项。
- 切换账号或更换 Key 后重新导入。CLI 周期查询前会核对本地 prod Key 与已保存账号是否一致。
- 元数据请求超时为 15 秒，CLI 查询超时为 20 秒；AI 请求保留调用方的取消信号和响应流。
- `HTTP 402` 是上游拒绝请求，请核对真实余额和周期额度；插件不会伪造成功，也不会把它当作 Key 过期。
- 图标或本地代码修改后，在 Magpie 的插件页关闭再开启该插件，并刷新额度。GitHub 安装的版本可运行 `magpie plugin update` 更新。

### 验证与已知限制

```sh
bun run check
bun test
```

18 项单元测试使用模拟凭据和临时配置，覆盖认证隔离、余额/周期解析、失败不显示为零、流式转发、取消信号、工具参数及错误脱敏。

2026-10-05 的本地 Windows 实测读取到了 10 个模型及 5 小时、7 天周期。普通与流式聊天探测均返回上游 `HTTP 402`，因此**成功的真实聊天和 SSE 响应仍未验证**；相关转发行为已通过模拟响应测试。模型、套餐和 API 可能随上游变化。

### 非官方声明与免责

本项目为非官方社区集成，未获得 OpenDesign 或 Magpie 团队的授权背书。OpenDesign、Magpie 的名称和标识仅用于识别兼容服务，其权利属于各自权利人；使用图标不表示官方合作或认可。

插件代码采用 [MIT 许可证](LICENSE)，按“现状”提供，不作适用性、稳定性或服务可用性保证。使用者应遵守相关服务条款，并自行管理凭据、确认调用费用和账号权限。在适用法律允许的范围内，维护者不对使用本插件导致的费用、数据损失、服务中断或账号限制承担责任。上游服务规则和实际账单以服务方记录为准。

图标引用自 [OpenDesign 官网的 Apple Touch 图标](https://open-design.ai/apple-touch-icon.png)，仅作服务识别；本仓库的 MIT 许可不授予第三方商标或标识权利。

## English

Use your OpenDesign account in Magpie / OpenCode, discover available models, and read wallet balances, credits and Coding Plan windows in Magpie. Provider ID: `opendesign`.

> This is an independently maintained **unofficial community plugin**. It is not affiliated with or endorsed by the OpenDesign or Magpie teams. Please report plugin issues in [this repository](https://github.com/ezdemo/opencode-opendesign-auth/issues).

### Features

- Import the local `profiles.prod` sign-in from `~/.amr/config.json` without modifying it.
- Discover account models, context limits and input capabilities; omit disabled models.
- Forward OpenAI Chat Completions requests, streaming responses and tool-call parameters.
- Display wallet balance, subscription/recharge credits, and Coding Plan usage, remaining credits, limits and reset times in Magpie.
- Embed OpenDesign's website PNG as the Magpie provider icon, with no icon download needed at load time.

### Install and sign in

Sign in to the OpenDesign desktop app first and confirm `~/.amr/config.json` exists:

```sh
magpie plugin add github:ezdemo/opencode-opendesign-auth
magpie plugin login opendesign
```

Choose **Import OpenDesign local prod sign-in**. Enter the **Workspace ID** to enable Coding Plan percentages, or configure it later:

```sh
magpie plugin options github:ezdemo/opencode-opendesign-auth '{"workspaceId":"your-workspace-id"}'
```

Without a workspace ID, balances still load, but quota reports an explicit error instead of implying unlimited allowance or 100% remaining.

For local development or installation from a folder:

```sh
git clone https://github.com/ezdemo/opencode-opendesign-auth.git
cd opencode-opendesign-auth
magpie plugin add .
magpie plugin login opendesign
```

Usage reporting through `auth.usage` is a Magpie extension; OpenCode ignores it. The package supplies OpenCode-compatible auth, model and request hooks. This repository has not been published to npm.

### Options

Put options in the plugin entry's `options` object in Magpie's `plugins.json`:

```json
{
  "workspaceId": "your-workspace-id",
  "configPath": "C:/Users/you/.amr/config.json",
  "velaPath": "C:/path/to/vela.exe"
}
```

| Option | Purpose |
| --- | --- |
| `workspaceId` | Workspace required for Coding Plan queries; missing values produce a quota error. |
| `configPath` | Optional; defaults to `~/.amr/config.json`. |
| `velaPath` | Optional path to the Vela executable. |

`OPENDESIGN_WORKSPACE_ID` is also supported. Precedence: workspace saved during import → plugin option → environment variable.

On Windows, the plugin looks for `%LOCALAPPDATA%/Programs/Open Design/resources/open-design/bin/vela.exe`, then falls back to PATH. Other systems use Vela on PATH. Vela must be signed in to the same prod account as the plugin.

### APIs and quota display

| Operation | Endpoint or command | Credential / main fields |
| --- | --- | --- |
| Models | `GET https://amr-link.open-design.ai/v1/models` | `runtimeKey` |
| Inference | `POST https://amr-link.open-design.ai/v1/chat/completions` | `runtimeKey`; `model`, `messages`, `stream` |
| Wallet | `GET https://amr-api.open-design.ai/api/v1/wallet/balance` | `controlKey`; `balanceUsd` |
| Billing | `GET https://amr-api.open-design.ai/api/v1/billing/summary` | `controlKey`; `membershipTier`, `subscriptionStatus`, `balances` |
| Period limits | `vela billing preflight --workspace-id <id> --format json` | Local CLI sign-in; `codingPlan.windows[]` |

Both API keys use `Authorization: Bearer <key>`, with runtime and account-query responsibilities kept separate.

**Wallet and credits are balances, not percentages.** Only actual Coding Plan periods become quota windows. For example:

| Period | Used / limit | Remaining | Remaining percentage |
| --- | --- | --- | --- |
| 5 hours | 0 / 50,000 credits | 50,000 credits | 100% |
| 7 days | 150,445 / 150,000 credits | 0 credits | 0% |

These are illustrative values, not a live account reading. Overspending retains usage above 100%; a zero wallet does not mean period allowance is exhausted. Failed queries, missing fields or a missing workspace never become synthetic zeros. Successful fields survive partial failures, although Magpie may display the error instead of period rows. Actual period windows participate in Magpie's quota decisions.

### Credentials and troubleshooting

- The OpenDesign config is read-only. Imported keys are saved in Magpie's `plugin-auth.json` or OpenCode's auth store; protect those files.
- The plugin does not print keys, redacts reflected keys in forwarded error responses, and does not accept keys in plugin options.
- Import again after switching accounts or rotating keys. CLI quota reads check that local prod keys still match the saved account.
- Metadata requests time out after 15 seconds; CLI queries after 20 seconds. Inference preserves the caller's abort signal and response stream.
- `HTTP 402` is an upstream refusal: check actual funding and period limits. It is neither fabricated success nor a declaration that the key expired.
- After changing the icon or local source, turn the plugin off and on in Magpie and refresh quota. GitHub installations can use `magpie plugin update`.

### Verification and known limits

```sh
bun run check
bun test
```

18 unit tests use synthetic credentials and temporary config files. They cover credential separation, balance/period parsing, failures without invented zeros, streaming forwarding, cancellation, tool parameters and error redaction.

A Windows installation was checked on 2026-10-05: model discovery returned 10 models and CLI quota returned 5-hour and 7-day windows. Both non-streaming and streaming inference probes returned upstream `HTTP 402`, so **successful live inference and SSE remain unverified**; forwarding behavior is covered by mocked responses. Upstream models, plans and APIs may change.

### Unofficial status and disclaimer

This is an unofficial community integration and is not endorsed by the OpenDesign or Magpie teams. Their names and marks identify compatible services and belong to their respective rights holders. Displaying an icon does not imply an official partnership or endorsement.

Plugin code is provided under the [MIT license](LICENSE), “as is”, without warranties of fitness, stability or service availability. Users are responsible for complying with applicable service terms, protecting credentials, and checking charges and account permissions. To the extent permitted by applicable law, maintainers are not liable for charges, data loss, service interruption or account restrictions arising from use. Upstream service rules and billing records remain authoritative.

The icon is referenced from [OpenDesign's official Apple Touch icon](https://open-design.ai/apple-touch-icon.png) for service identification. This repository's MIT license does not grant rights to third-party trademarks or marks.
