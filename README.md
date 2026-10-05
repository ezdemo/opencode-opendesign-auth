# OpenDesign

Use the models on your OpenDesign account in magpie and OpenCode, through
OpenAI **Chat Completions** at `https://amr-link.open-design.ai/v1`.
The account's model list comes from `GET /models`; requests go to
`POST /chat/completions`, including streaming and tool calls.

## Install and sign in

Sign in to the OpenDesign desktop app first. This plugin reads
`~/.amr/config.json` → `profiles.prod` without changing it:

- `runtimeKey` authenticates model discovery and AI requests.
- `controlKey` authenticates wallet and billing queries.

Install directly from GitHub (npm publication is not required):

```sh
magpie plugin add github:ezdemo/opencode-opendesign-auth
magpie plugin login opendesign
```

Choose **Import OpenDesign local prod sign-in**. The optional Workspace ID
enables Coding Plan queries; it can also be set as a plugin option. Without it,
wallet and billing still load, but quota reports an explicit missing-workspace
error instead of implying unlimited allowance.
The plugin copies both keys into magpie's `plugin-auth.json` (OpenCode's auth
store when used there). It prints neither key. Import again after changing
accounts or rotating keys; each saved account keeps its own keys.

Alternatively, clone this repository and install the local folder:

```sh
git clone https://github.com/ezdemo/opencode-opendesign-auth.git
cd opencode-opendesign-auth
magpie plugin add .
```

If this package is published to npm, OpenCode can add it to `opencode.json`;
then run `opencode auth login`:

```json
{ "plugin": ["opencode-opendesign-auth"] }
```

Provider id: `opendesign`. Model ids are exactly those returned by AMR.
Disabled models are omitted. Image and other input capabilities and context
limits come from the live list; unknown output limits and reasoning levels
are not guessed. If discovery fails, magpie retains its previous list.

## Usage

magpie's account row and `magpie quota` show:

- USD wallet balance from `GET https://amr-api.open-design.ai/api/v1/wallet/balance`
  (`balanceUsd`).
- Membership tier and subscription status from `GET /api/v1/billing/summary`
  (`membershipTier`, `subscriptionStatus`), subscription and recharge credits
  (`balances.subscriptionCredits`, `balances.rechargeCredits`), and the period
  end and renewal setting when available.
- Coding Plan windows from
  `vela billing preflight --workspace-id <id> --format json`: `usedCredits`,
  `remainingCredits`, `limitCredits`, `durationSeconds`, `resetsAt`.

Only real Coding Plan windows carry usage percentages and govern their period
limits. Wallet and credit balances appear together in the balance text, never
as percentage windows: a remaining balance without a known total cannot say
“100% remaining”. A zero USD wallet does not mean a Coding Plan window is
exhausted. An overspent window retains a percentage above 100. Missing/failed
queries (including a missing workspace ID) produce an error, never a synthetic
zero or an unlimited/100%-remaining quota window.
Queries are independent; successful fields are retained on partial failure
(magpie displays `error` in place of window rows). A refused control key does
not mark a working runtime key as expired.

Vela must be installed and signed in to the same prod account. On Windows the
plugin finds the desktop app's bundled executable at
`%LOCALAPPDATA%/Programs/Open Design/resources/open-design/bin/vela.exe`;
otherwise it uses `vela` on PATH. It checks that the local prod keys still
match the saved account before reading CLI quotas, to avoid attributing a
different account's limits to it.

Plugin options (the second argument of the plugin function, or the entry's
`options` in magpie's `plugins.json`):

```json
{
  "configPath": "C:/Users/you/.amr/config.json",
  "workspaceId": "your-workspace-id",
  "velaPath": "C:/path/to/vela.exe"
}
```

All options are optional. `OPENDESIGN_WORKSPACE_ID` is also accepted. The
workspace saved at import takes precedence, then `options.workspaceId`, then
the environment variable. Keys are never accepted in options. Vela runs
without a shell and has a 20-second timeout; API metadata queries have a
15-second timeout. Inference preserves the caller's abort signal and streams.

## Verification

```sh
bun run check
bun test
magpie provider test opendesign
magpie quota
```

Unit tests use synthetic keys and temporary config files, never the real home.
The AMR account endpoints, model metadata and Vela window schema were also
checked against a local Windows OpenDesign installation on 2026-10-05.
No real credentials, account identifiers or CLI output are included in fixtures.
The plugin discovered 10 live models and read both the 5-hour and 7-day
windows. Small non-streaming and streaming inference probes both returned
HTTP 402 from the upstream account, which had an overspent 7-day window and
zero wallet/subscription/recharge balances. Successful live inference and
SSE therefore remain unverified; forwarding, SSE, cancellation and tool-body
preservation are covered by mocked responses in the unit tests.

## 中文

先在 OpenDesign 桌面端登录，再安装插件并选择“导入本地 prod 登录”。
插件只读 `~/.amr/config.json`，把 `runtimeKey` 用于模型列表与 AI 调用，
把 `controlKey` 用于账户查询。两种 Key 保存在 Magpie/OpenCode 的认证文件中，
不会写进日志；切换账号或更换 Key 后需要重新导入。

工作区 ID 可选；填写后使用 Vela 查询 Coding Plan 的周期已用、剩余、上限和
重置时间。Windows 会自动寻找桌面端自带的 `vela.exe`。美元余额、订阅积分、
充值积分放在余额说明中，只有真实周期额度显示百分比；查询失败或未配置工作区
会明确报错。钱包为零不会当作周期额度耗尽，实际周期用尽则由额度窗口体现。
模型和流式聊天使用 OpenAI Chat
Completions 协议。
