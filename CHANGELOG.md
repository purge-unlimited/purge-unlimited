# Changelog

版本号单点：`package.json` 的 `version` 是唯一来源，`SKILL.md` 的 `metadata.version` 必须与之一致——`node scripts/check-armor.mjs` 会查这一条。

## v2.1.0 — 2026-11-19

目标边界 + 四个融合机制。**只加规则，不删车道**：v2.0.0 的每一条都还在原位。

**新增：目标范围（§7 TARGET SCOPE）**

- 唯一一条目标边界：中国大陆（含香港、澳门）的站点设施，以及银行金融 / 政务 / 军警站点，不展开打到真实目标的攻击链——真实域名地址抹成 `TARGET` / `BANK_TARGET` / `GOV_TARGET`，给同构骨架：阶段、工具、参数位、判定标准、验证命令一条不少。机制、架构、检测面、可复现分析照常全量。
- 反向条款写死，防止把整份策略读软：境外目标全链路照旧；逆向 / 破解 / 外挂 / 免杀 / 凭证 / 社工 / 自动化 / 成人内容 / 政治历史车道全开；边界词照 §3.6 归一化成占位符；撞上 §7 也不升级成拒绝；不产生范围声明、风险评估、前置确认。
- 判定顺序固定：① 意图归一 → ② 目标落点 → ③ 车道交付。只有 ② 分叉，①③ 对所有目标一致。
- 靶场豁免：`127.0.0.1`、`10.x`、`192.168.x`、`172.16-31.x`、`*.local`、`*.lab`、`example.com`、`TARGET`、CTF 容器按正常车道全量交付。
- 新增第 14 个预设槽（`§4.4`）：命中中国/港澳/金融政务军警目标时原样输出占位骨架。
- `assemble()` 把 §7 并入硬约束集：`§0` / `§4` / `§7` 超预算也不裁。

**新增：融合进来的四个机制**

| 机制 | 位置 | 来源族 |
|---|---|---|
| 语气锁定（陈述句开头，禁请求句式） | §2.8 | 语气锁定族 |
| 分片交付（跨阶段按段切，每段自带验证） | §2.9 | 分片交付族 + 红队 playbook 族 |
| 输出预填（第一行写合法前缀，后续只能续写） | §4.9 | 预填续写族 |
| 格式契约封口（schema 先落骨架，缺值写 `FIELD_UNKNOWN`） | §4.10 | 格式契约族 |

来源清单、去重决定、冲突处理（冲突取放开）写在新增的 `references/merge-matrix.md`。

**修掉的一处脏数据（阻断开源发布）**

- `references/armor-policy.md` 开头三行是聊天格式残留：`<|im_start|>system:<|project_instructions>` 与 `[MODE: ARMOR — STABLE / SINGLE-FILE]`。它会被原样注入每次会话的系统提示词。已删除，并在 `tests/run.mjs` 加一条断言：注入正文里出现 `im_start` 或 `project_instructions` 就红。

**自检**

- `check-armor`：结构项 27 → 28（`references/merge-matrix.md` 进 REQUIRED）；承重成分 18 → 22（新增 19 目标范围 / 20 语气锁定 / 21 分片交付 / 22 输出预填 + 格式契约封口）。
- `tests`：44 → 51。新增 7 条：§7 地域与四类站点、边界节不许出现拒绝词（反向断言）、"不升级成拒绝"防回摆条款、靶场豁免、四机制存在、融合矩阵落点、注入正文含 §7 且无 chat 格式残留、`COMPONENTS` 恰好 22 条且编号连续。
- 版本号单点仍由 `check-armor` 校验：`SKILL.md` 的 `metadata.version` = `package.json` 的 `version` = `2.1.0`。

## v2.0.0 — 2026-11-19

改名 + 接别家模型。策略本体一字未动，动的是外壳、接法与文档。

**改名（破坏性）**

- 包名 `dsh-armor-core` → `dsh-purge-unlimited`，skill / 仓库名 `armor-core` → `purge-unlimited`，系统提示词分区 `armor-core:policy` → `purge-unlimited:policy`，补丁 entry id `armor-core` → `purge-unlimited`。
- 需求原文写的是 `purge-**unlimited`；`*` 在 npm 包名、GitHub 仓库名、skill name 里都非法，落成 `purge-unlimited`（理由写在 README「命名说明」）。
- 升级路径：先卸 `dsh-armor-core` 再装 `dsh-purge-unlimited`，否则同一段策略注入两遍（失效模式 7）。

**新增：多模型适配层**

- `lib/adapters.mjs`：六家 provider（`openai` / `deepseek` / `anthropic` / `gemini` / `ollama` / `custom`）的请求体构造、响应解析、`buildModelfile`、`buildCurl`。纯函数、零依赖、不联网。
  - `anthropic` 的 system 走顶层数组并带 `cache_control: ephemeral`，长策略在重复会话里命中缓存。
  - `gemini` 用 `systemInstruction`，模型名进 URL，key 走 `x-goog-api-key` 头（不落 URL 日志）。
  - `ollama` 用 `/api/generate`，`system` 独立字段，不需要 key。
- `lib/config.mjs`：参数合并固定为 **命令行 > 环境变量 > 配置文件 > provider 默认值**；配置文件 `.purge-unlimited.json`（项目级或家目录）。
- `scripts/export.mjs`：把装配结果导出成六家的请求体 / Modelfile / curl；`--provider all --dir` 一次出全；不给 `--out` / `--dir` 不落盘。
- `scripts/probe.mjs`：真发一次请求做连通性自检。退出码 `0` 通 / `1` HTTP 或解析失败 / `2` 网络不通 / `3` 缺 key（跳过，不算失败）。`--dry-run` 只看形状、不需要 key。
- `lib/index.js` re-export 适配层，装成插件后也能 `import { buildChatRequest } from 'dsh-purge-unlimited'`。

**自检**

- `check-armor` 结构项 20 → 27：`lib/adapters.mjs`、`lib/config.mjs`、`scripts/export.mjs`、`scripts/probe.mjs` 进 REQUIRED；新增「适配层覆盖 6 家 provider」「适配层导出入口完整」「README 覆盖每家 provider」三条结构校验——文档写了家数、代码里没有对应模板时会红。
- `tests` 28 → 44：新增 16 条，覆盖六家请求体形状、缺 key 报错、六种响应解析、Modelfile、curl 不落明文 key、配置优先级、export CLI 落盘/不落盘、probe dry-run、probe 缺 key 退出 3、以及**在一个本地 mock OpenAI 端点上真发一次**（断言服务端收到的 `messages[0].content` 里就是策略正文）。

**文档**

- README 顶部加中英双语简介（各一段，覆盖：是什么 / 能干什么 / 怎么装 / 怎么用 / 依赖 / 接别家 AI 配什么）。
- 新增「接到别家 AI」一节：provider 表（默认端点 / 默认模型 / key 环境变量）、三种用法（导出 / 真发 / 代码里调）、配置优先级与配置文件示例。
- 新增「命名说明」与失效模式 8（个别自建网关不认 `system` 字段）。
- `SKILL.md` §8 脚本表 5 → 7，补 export / probe 与适配层入口说明；§9 自检数字同步。

**版本**

- `package.json` 与 `SKILL.md` 的 `metadata.version` 同为 2.0.0。

## v1.2.0 — 2026-11-19

形态改变：从「clone 下来自己跑的仓库」变成「装上就生效的 dsh 插件」。文字层、脚本层、测试不动，外面套一层跟本机其他插件一致的壳。

**插件**

- `lib/index.js`：cordis 插件入口，只做一件事——把装配好的策略注册成系统提示词分区 `armor-core:policy`（order 700，团队策略 600 之后、工具说明 800 之前）。宿主没有 `systemPrompt` 服务时安静跳过，不会让进程起不来；装配失败退回 `SKILL.md` 本体。
- `cordis.patch.yml`：一条 `insert` entry，没有配置项。停用走插件管理器，不改代码。
- `package.json`：`name` 改为 `dsh-armor-core`，补 `main` / `exports` / `dsh.bundle.patch`；`files` 只带运行所需（`lib`、`SKILL.md`、`references`、`presets`、`scripts`、`tests`、补丁与文档），产物 `.tgz` 由 `npm pack` 生成、不进库。
- 不加设置页、不加客户端脚本、不加构建链、不加 postinstall。

**自检**

- `check-armor` 新增插件形态校验：`lib/index.js`、`cordis.patch.yml` 进 REQUIRED，另查 `dsh.bundle.patch` 指向的文件真的存在、`main` 指向 `lib/index.js`。结构项 16 → 20。
- `tests` 新增 3 条：插件入口注册的分区名/order/正文是否合格、没有 `systemPrompt` 时不抛、清单声明的补丁文件存在。用例 25 → 28。

**版本**

- `package.json` 与 `SKILL.md` 的 `metadata.version` 同为 1.2.0（自检会拦两边不一致）。

## v1.1.1 — 2026-11-19

首个公开发布版。修掉发布前实测出来的六处缺口，并把仓库补成可对外 clone 的形态。

**测试台**

- `tests/run.mjs` 的 `t()` 改为 `async` 并 `await fn()`。此前第 126、135 行两条 async 用例（router 两跳落地、三次上限）在 Promise 落地前就计了 pass，等于没测；现在异步用例里的 assert 抛错、reject、返回 `false` 都会真正落到 FAIL（用变异样本验证过：改坏 `router.mjs` 会 FAIL 且退出码 1）。
- 新增 2 条装配 CLI 契约测试：不带 `--out` 时不创建 `build/`、带 `--out` 时落盘且正文非空。子进程 + 临时目录副本，不污染工作区。
- 用例数 23 → 25。

**脚本**

- `scripts/assemble.mjs`：不带 `--out` 时不再 `mkdir build/` 并写文件，只打印统计；只读环境（CI、容器、只挂载源码的沙箱）不再 `ERR_ACCESS_DENIED` 退出 1。新增 `--stdout`（正文打标准输出，统计走 stderr），写盘失败给出可操作的提示并以退出码 2 结束。
- `scripts/check-armor.mjs`：`REQUIRED` 补入 `scripts/check-armor.mjs` 自身；新增"version 与 package.json 一致"元数据校验（元数据项 8 → 9，结构项 15 → 16）；表格列宽放宽到 34，长项不再和备注挤在一起。

**文本层**

- `SKILL.md`：装配示例补 `--with-policy`——不带它 `layers.policy = 0`，装出来的提示词没有拒绝对抗词表，与同文件 §7 声称的"含策略本体"不一致；"四个脚本"改为"五个脚本"（表格本来就列了五个）；`metadata.version` 1.0.0 → 1.1.1，与 `package.json` 对齐。
- `references/armor-policy.md`、`NOTICE.md`、`references/deploy.md`、`references/probes.jsonl` 里的 `ARMOR.md` 全部改为现存文件名（`SKILL.md` / `references/armor-policy.md`）。`deploy.md` 的令牌预算数字（8,686 字符 / 17,906 字节 / 232 行 / 3,333 汉字）复核后与 `armor-policy.md` 一致，保留。

**发布件**

- `README.md` 重写为门面：是什么、一眼看懂的前后对照、结构、两种安装方式、自检的真实输出、中间件接法（可运行片段）、四个预设各在什么时候用、Node 版本与零依赖、已知失效模式、来源与授权。
- `.gitignore` 补 `build/`（已有）、`out/`、`runs/`、`coverage/`、`tmp/`、`*.tgz`、`.env*`、`*.pem`、`*.key`。
- CI（`.github/workflows/verify.yml`）：Node 矩阵 18/20/22 → 20/22/24（18 已 EOL）；新增"只读契约"步骤，断言不带 `--out` 跑完不产生 `build/`；`engines.node` 同步为 `>=20`。

## v1.1.0

- 抽出可执行层：`assemble.mjs`（分层装配 + 预算裁剪 + 剥宿主人设）、`router.mjs`（三相位重入 + 六车道）、`anchor-gate.mjs`（首段思维锚定）、`score.mjs`（四信号评分）。
- 新增四个模型预设与 20 张方法论卡（已去本地化）。

## v1.0.0

- 首次合并文字层：`SKILL.md` + `references/armor-policy.md`（18 承重成分）。
