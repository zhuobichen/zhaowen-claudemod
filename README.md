# zhaowen-claudemod

我自用的 Claude Code mod 合集。仓库根就是 marketplace，每个 mod 一个子目录 —— 官方那套结构，装的时候一条命令。

## 装

```
/plugin install deepseek-balance --marketplace zhuobichen/zhaowen-claudemod
```

（会先问要不要把这个 marketplace 加进来，答 y；再选 scope，`user` 就是每个会话都有。）

## mod 列表

| mod | 干什么 | 前提 |
| --- | --- | --- |
| [deepseek-balance](./deepseek-balance) | 提示行上面一行显示 DeepSeek 余额 + 最近五个整点每小时的花费，5 分钟自刷，`/balance` 手动读 | 会话接在 DeepSeek 上（API key）；接在别的端点的会话里它不说话也不发请求 |
| [moon-band](./moon-band) | 月相 + 月龄 + 一句古诗，压暗的一行，每小时换一句，`/moon` 收起 | 无。月相查相时刻表（覆盖到 2026-12-31），表外会标 `≈` |

## 一个 mod 长什么样

```
<mod>/.claude-plugin/plugin.json   名字、版本、类型契约的位置
<mod>/hooks/hooks.json             模块清单
<mod>/hooks/register.tsx           钩子：注册事件、取数、画界面
<mod>/hooks/*.ts                   纯函数（解析、措辞），测试盯的就是这层
<mod>/types/index.d.ts             $.state 的类型契约
<mod>/tests/*.test.tsx             claude plugin test 跑的用例
```

## 改一个 mod

```
claude plugin validate <mod 目录>    静态检查：清单、钩子、$.env 读写了哪些
claude plugin test <mod 目录>        在跟钩子相同的环境里跑 tests/
```

装的是**目录**（不是快照），改完源码下一个会话生效；当前会话里可以敲 `/reload-plugins` 立刻生效。
