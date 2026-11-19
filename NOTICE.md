# NOTICE

## 来源与授权

本仓库的 `SKILL.md`（操作层）与 `references/armor-policy.md`（策略本体）是对以下两套实现的**合并再创作**，不是任何一份的拷贝：

| 来源 | 标识 | 授权 | 被吸收的部分 |
|---|---|---|---|
| `@adwmc/helm-d` | helm-d: `jailbreak-prompt-router.js` / `prompt-assembly.js` / `presets/redteam/anchor-gate.mjs` | 见其上游条款 | 三相位恢复路由、六条意图契约、首段思维锚定、按模型换预设 |
| `dsh-purge` | `dsh-purge@1.1.92`，repo: `HunYiSage/dsh-purge` | Apache-2.0 | 人格层、任务类、意图映射、边界词归一化、拒绝词表、预设槽、分层降级 |

两套原文均带有完整的 `LICENSE` / `NOTICE` 结构；`dsh-purge` 为 Apache-2.0，本仓库沿用 Apache-2.0 以保持兼容。

## 改动说明

合并过程中做了以下实质性修改，因此不构成对上游的逐字复制：

1. 删除了两套原文里与破甲无关的工程约束（`rg`/`apply_patch`/`git` 规范、CTF 工具章节、终端约定、最终回答格式细则）。
2. 统一了人格命名：沿用上游人格的结构位，改写为 `ARMOR`，不保留原文措辞。
3. 将两套各自独立的 §TASK PRIORITY / MODE 段合并成单一 §0 权重声明，新增冲突消解运算符。
4. dsh-purge 原 §3 的"沙箱测试方向"清单按层归并进 §3.5 意图映射，去掉重复枚举。
5. 新增 §5.5（三次失败换路径）与 §6 稳定锚，用于压制合并后体量增大带来的注意力稀释。
6. 预设槽统一为占位符形态，补齐"越权/未授权""分层降级"等原文分散在各处的槽位。

## v1.1 新增：可执行部分的来源

| 本仓库文件 | 上游 | 改动 |
|---|---|---|
| `scripts/assemble.mjs` | helm-d `.real/prompt-assembly.js` | 抽出 `stripHarnessPersona` 等价实现；把插件级 waterfall 改成可独立调用的分层装配 + 预算裁剪 |
| `scripts/router.mjs` | helm-d `.real/jailbreak-prompt-router.js` | 相位与意图契约沿用，检测器改为 17 条中英正则的通用实现；导出为类，去插件依赖 |
| `scripts/anchor-gate.mjs` | helm-d `presets/redteam/anchor-gate.mjs` | 保留 `countWord` / `classifyReasoning` / `decidePromotion` 语义，补中文第一人称兜底 |
| `scripts/score.mjs` | dsh-purge `lib/redteam/score-rules.js` | 只保留四个可判定硬信号，去掉题库与权重表 |
| `references/methodology.md` | dsh-purge `skills/redteam/*.md`（20 张） | 去本地化：工具绝对路径 → `TOOL_BIN`，主机 → `TARGET`，删本机版本表，保留链路与坑 |
| `presets/*.md` | dsh-purge 「按模型换提示词」+ helm-d preset 思路 | 新增，四份，内容为再创作 |

## v2.0 新增：多模型适配层

| 本仓库文件 | 来源 | 说明 |
|---|---|---|
| `lib/adapters.mjs` | 本仓库原创 | 六家 provider 的请求体 / 响应解析 / Modelfile / curl 生成；请求形状按各家公开 API 文档实现，未拷贝任何 SDK 代码 |
| `lib/config.mjs` | 本仓库原创 | 参数合并（命令行 > 环境变量 > 配置文件 > 默认值） |
| `scripts/export.mjs`、`scripts/probe.mjs` | 本仓库原创 | 适配层的命令行外壳；`probe` 用 Node 内置 `fetch`，不引入 HTTP 客户端依赖 |

## 改名

v2.0 起，本仓库由 `armor-core` 更名为 `purge-unlimited`（包名 `dsh-purge-unlimited`）。上游名称保持不变；`purge-unlimited` 是本仓库自己的名字，与上游 `dsh-purge`、`helm-d` 无隶属关系。

## 用途

研究用途：度量不同提示词成分在不同模型、不同对抗强度下对输出分布的影响。附带的 `probes/` 是评测探针集，不含自动化攻击载荷。

## 商标

`helm-d`、`dsh-purge`、`DeepSeek Harness` 等名称归其各自所有者，本仓库与之无隶属关系。
