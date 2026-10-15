# 我装了哪些 mod —— 索引与复现

这份是**一台新机器照着做就能把这套 Claude Code 配置装回来**的清单。本仓库（`zhuobichen/zhaowen-claudemod`）只负责**我们自己写的 mod**；别人的 mod 也记在这儿，但来源是别处（见第 3 节）。

- 自己的 mod：3 个，都在本仓库，就是 **第 2 节**
- 别人的 mod：1 个（`context-view`），**不在本仓库**，第 3 节给的是它自己的 GitHub 地址
- 技能、MCP 服务**不在这个仓库**，见第 4 节

## 1. 新机器怎么装

```bash
git clone git@github.com:zhuobichen/zhaowen-claudemod.git
```

然后在 Claude Code 里（本地那份克隆就是 marketplace 的**源**）：

```
/plugin marketplace add D:\github_project\ZhaoWen_GitHub维护\zhaowen-claudemod
/plugin install deepseek-balance --marketplace zhaowen-claudemod
/plugin install moon-band --marketplace zhaowen-claudemod
/plugin install novel-pane --marketplace zhaowen-claudemod
```

（从别人机器上装，走 GitHub 也行：`/plugin marketplace add zhuobichen/zhaowen-claudemod`。）

**为什么指本地文件夹而不是 GitHub**：装的是**目录**不是快照 —— 改完源码下一个会话生效，会话里 `/reload-plugins` 立刻生效；`git pull` 就是更新。指 GitHub 的话每次要重新拉。

装完一条命令自检：`claude plugin list`，四个 mod 都该是 `Scope: user`、`Status: ✔ enabled`。

## 2. 自己的 mod（本仓库）

| mod | 版本 | 干什么 | 前提 |
| --- | --- | --- | --- |
| [deepseek-balance](./deepseek-balance) | 0.1.0 | 提示行上面一行：DeepSeek 余额 + 最近五个整点每小时花多少，5 分钟自刷，`/balance` 手动读 | 会话要接在 DeepSeek 上。key 读 `ANTHROPIC_AUTH_TOKEN`（`settings.json` 的 `env` 里那把），兜底 `DEEPSEEK_API_KEY`；`ANTHROPIC_BASE_URL` 里没有 deepseek 时它闭嘴且不发请求 |
| [moon-band](./moon-band) | 0.1.0 | 提示行上面一行：月相 + 月龄 + 一句古诗（每分钟换），`/moon` 收起 | 无。月相查相时刻表，覆盖到 2026-12-31，表外标 `≈` |
| [novel-pane](./novel-pane) | 0.8.0 | 会话里开一个可折叠窗格读书：`/novel <文件>`，一次一屏、控件就是窗格第一行，进度另钉在提示框下面，读到哪按文件记住 | 文件走 `$.fs.read`，**单文件上限 4 MiB**；翻页靠按钮和滚轮，不用键盘焦点 |

各自的详细用法在各自的 README 里（`<mod>/README.md`）。

**新机器上要复现得一模一样的，还有两样不在仓库里**：`deepseek-balance` 看到的那把 key 配在**本机** `~/.claude/settings.json` 的 `env` 里（不跟着仓库走，别复制进仓库）；`novel-pane` 的书是你自己的文件，我在 `D:\books\` 放的是公版书（西游记/红楼梦/三国演义/水浒传）。

## 3. 别人的 mod（不在本仓库，也不该放进来）

| mod | 版本 | 干什么 | 从哪来 |
| --- | --- | --- | --- |
| `context-view` | 0.2.0 | 同上那一行显示上下文窗口用了多少（格子 + 百分比 + 剩余 token） | **不是我们的**，作者 [kongyo2](https://github.com/kongyo2/context-view)。装法：`/plugin marketplace add kongyo2/context-view` 然后 `/plugin install context-view --marketplace kongyo2/context-view` |

本机它是从 `~/.claude/mods-staging/context-view` 那个**文件夹 marketplace** 装的（当初是从上游拉的）。换机器照上面那两行装新的就行。

**版权和归属**：这个仓库只放我们自己写的。别人写的哪怕天天用，也只在**这份文档里记一笔**，不进仓库——不然就是拿别人的东西当自己的发。

## 4. 其余配置在别的仓库 / 不在仓库

这台机器的 Claude Code 配置不止 mod，别的部分各有各的家：

| 什么 | 在哪 | 怎么复现 |
| --- | --- | --- |
| **技能**（cnki 系列、docx_to_mp、wechat_mp_ops、khazix-writer…） | `zhuobichen/zhaowen-skill` | 拉下来按那个仓库的 README 放 `~/.claude/skills/` |
| **MCP 服务**（15 个：小红书、B站、热榜、会话检索、识图生图…） | `zhuobichen/zhaowen-mcp` | 拉下来按那个仓库的 README 装；本机的注册写在 `~/.claude.json`（`mcpServers` 的 `args`/`env` 各一份路径） |
| **api key、MCP 路径、权限** | **不在任何仓库**，在 `~/.claude/settings.json` / `~/.claude.json` | 手动抄，或另做一份脱敏模板 |
| **书**（公版小说） | 不在仓库 | 重新下，或从旧机器拷 `D:\books\` |

## 5. 在这台机器上改 mod

```
claude plugin validate <mod 目录>    静态检查：清单、钩子、$.env 读写了哪些
claude plugin test <mod 目录>        在跟钩子相同的环境里跑 tests/
claude plugin validate <仓库根>      验 marketplace 清单
```

改完提交推送（本仓库是公开的，别把 key、本机路径之外的隐私写进去）：

```
git add -A
git commit -F <消息文件> --trailer 'Co-Authored-By: Claude Code <noreply@anthropic.com>'
git push origin main
```

推送走哪条当场看：2026-10-15 实测 HTTPS(github.com:443) 被 reset、SSH 通，所以 remote 是
`git@github.com:zhuobichen/zhaowen-claudemod.git`，密钥用 `~/.ssh/id_github`。哪天反过来就用 HTTPS。
