# Changelog

版本号单点：`package.json` 的 `version` 是唯一来源，`SKILL.md` 的 `metadata.version` 必须与之一致——`node scripts/check-armor.mjs` 会查这一条。

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
