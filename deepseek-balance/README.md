# deepseek-balance

DeepSeek 账户余额，钉在提示行上面一行，每 5 分钟自己刷一次，`/balance` 手动再读一次。

```
DeepSeek ¥10.98 · 2m ago
```

## 安装

```
/plugin install deepseek-balance --marketplace zhuobichen/zhaowen-claudemod
```

装的是**目录**（不是快照），改完源码**下一个会话**生效；当前会话里可以敲 `/reload-plugins` 立刻生效，不用重装。

本机自己那份是从这个仓库的本地克隆装的（marketplace 指向仓库目录），所以改仓库文件就等于改自己在跑的那份。

## 为什么要单做一个

Claude Code 的 `session.usage()` 报的是**订阅套餐**的 5 小时／7 天窗口。API-key 会话（尤其是接到 DeepSeek 这种第三方端点的）报不出来，所以那类 meter 在这里只会显示 `no plan limits reported yet`。这个 mod 不问 Claude，直接问 DeepSeek 自己的接口。

## key 从哪来

按顺序找两个环境变量，**只用不存、不打印**：

1. `ANTHROPIC_AUTH_TOKEN` —— 本会话实际计费的那把（settings.json 的 `env` 里配的）
2. `DEEPSEEK_API_KEY` —— 兜底

两个都没有时，那一行会写清楚它找过哪两个名字，而不是空着。

## 它不骗你的地方

- 一次刷新失败**不会**把已经读到的好数字擦掉：数字和它的**读取时间**一起留着，后面标 `· 12m ago · refresh failed: HTTP 500`。旧的数就显示成旧的，不会假装是刚读的。
- 返回体不是 JSON、账户报 `is_available: false`、HTTP 非 200 —— 各说各的原因，不会读成 0。
- 汇率符号只认 CNY/USD；其它币种原样带出代码（`1200 JPY`），不猜符号。
- **接在别的端点的会话里它闭嘴，且一个请求都不发**（看 `ANTHROPIC_BASE_URL` 里有没有 deepseek），不会在 Anthropic 的会话里刷一行没用的字。

## 和别的 meter 共存

它挂在 `ui.render{component:'AbovePrompt'}`，和 Context View 是同一个位置。所以它 `await next(e)` 把下层画的树**包住**再画自己那一行——直接返回自己的树会把别人那行吞掉。以后往这个位置再加 mod，同样要包一层。

## 文件

```
.claude-plugin/plugin.json   名字、版本、类型契约的位置
hooks/hooks.json             模块清单
hooks/register.tsx           取数、定时、/balance、提示行那一行
hooks/balance.ts             解析与措辞，纯函数，没有引擎调用（测试盯的就是它）
types/index.d.ts             $.state 里那个 reading 的类型契约
tests/balance.test.tsx       13 条：怎么读答案、怎么措辞、挂上去真的画出来了、别的会话里是否沉默
```

（marketplace 清单在仓库根 `.claude-plugin/marketplace.json`，不在这个目录里。）

## 改

- 刷新间隔：`hooks/balance.ts` 的 `REFRESH_MS`
- 想换端点：`BALANCE_URL`
- 改完 `claude plugin validate <本目录>` + `claude plugin test <本目录>`
