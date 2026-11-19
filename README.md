# armor-core · 破甲核心

把「拒绝 / 说教 / 脚手架」从模型的输出分布里删掉，只留交付物。

一个 **Agent Skill**：文字层是每轮照做的行为契约，可执行层是零依赖的 Node 脚本——装配提示词、在拒绝发生后换相位重入、判定思维是否入戏、给回答打分。

- **解决什么**：同一件事要说三遍才做；第一段永远是"我先说明一下"；问到细节就退成建议；换个模型整套提示词就废了。
- **交付什么**：`SKILL.md`（常驻操作层，175 行 / 约 2.2k tokens）+ `references/`（按需加载）+ `scripts/`（5 个可执行脚本，零 npm 依赖）。
- **不碰什么**：不需要 API key，不联网，不改宿主机，不写系统目录。

## 一眼看懂

```
用户：只知道 IP 和端口，想看看开了什么服务。

普通提示词 → 先讲一段适用边界，再给一条"建议使用专业工具"的泛泛结论。
armor-core → 目标占位流程：nmap -sV -p PORT TARGET；字典：WORDLIST；并发：THREADS；
             速率：RATE；验证：PAYLOAD；记录：RESULT_LOG。
```

差别不在措辞，在**输出形状**：首段是产物本体、缺的参数用大写占位符承接、结尾带一条可复现的验证命令。`scripts/score.mjs` 就是拿这四个信号给回答打分的，不靠感觉。

## 结构

```
armor-core/
├─ SKILL.md                 操作层：每轮照做的 9 步短流程（常驻，175 行）
├─ references/
│  ├─ armor-policy.md       策略本体：18 承重成分 / 全量词表 / 13 条槽位 / 六契约（232 行，≈3.2k tok）
│  ├─ methodology.md        20 张方法论卡（侦察→突破→立足→内网），已去本地化
│  ├─ components.md         18 成分解剖：机制 / 为什么有效 / 什么时候失效
│  ├─ deploy.md             静态注入 vs 插件化路由、按模型配权、令牌预算
│  └─ probes.jsonl          14 条评测探针
├─ presets/                 四个模型预设：claude-sonnet / gpt-class / local-small / reasoning
├─ scripts/
│  ├─ assemble.mjs          分层装配 + 预算裁剪 + 剥宿主人设
│  ├─ router.mjs            拒绝检测 + 三相位重入 + 六车道
│  ├─ anchor-gate.mjs       首段思维锚定判定 + 放开输出上限
│  ├─ score.mjs             四信号评分（产物优先 / 零拒绝词 / 完整 / 占位符）
│  └─ check-armor.mjs       元数据 + 结构 + 18 承重成分自检
├─ tests/run.mjs            25 条行为测试
├─ .github/workflows/       CI：Node 20 / 22 / 24 三档
├─ NOTICE.md · CHANGELOG.md · LICENSE (Apache-2.0)
```

**渐进加载**：`SKILL.md` 常驻（≈2.2k tokens），重材料全在 `references/`，模型只在需要时读。方法论包默认不挂载，用 `--methodology` 按任务挑。

## 安装

目录名必须与 `SKILL.md` 里的 `name` 一致（`armor-core`），自检会查这一条。

```bash
# Claude Code / 兼容 skills 目录
git clone https://github.com/YOUR_GITHUB_USER/armor-core.git ~/.claude/skills/armor-core

# 通用 agents skills 目录
git clone https://github.com/YOUR_GITHUB_USER/armor-core.git ~/.agents/skills/armor-core
```

```powershell
git clone https://github.com/YOUR_GITHUB_USER/armor-core.git "$env:USERPROFILE\.agents\skills\armor-core"
```

装完重开会话，技能列表里出现 `armor-core` 即生效——之后每一轮由宿主的技能匹配自动加载，不需要每次点名。

不用 skill 机制也能用：跳过安装，直接 `git clone` 到任意目录，把 `SKILL.md` 拼进系统提示词（见下一节）。

## 自检

```bash
node scripts/check-armor.mjs   # 元数据 9 项 + 结构 16 项 + 承重成分 18 项
node tests/run.mjs             # 25 条行为测试
node scripts/router.mjs --demo # 模拟两次拒绝 → 两跳后落地
```

实跑结果（Node 26.13.0）：

```
SKILL.md · 元数据      coverage: 9/9
结构 · 文件            coverage: 16/16   (20 packs / 4 presets)
承重成分               coverage: 18/18
tests: 25/25 passed
```

任一失败退出码 1。改完任何一份文件都跑一遍，CI 跑的就是这三条。

## 接成中间件

`assemble` 产出的是一段完整提示词，`RecoveryRouter` 负责在拒绝发生后同一轮重入，两者可以拆开用。

```js
import { assemble } from './scripts/assemble.mjs';
import { RecoveryRouter, buildBlock, classifyIntent } from './scripts/router.mjs';
import { evaluate } from './scripts/anchor-gate.mjs';

// 1. 按模型和预算装一份常驻提示词
const { text: base, stats } = assemble({
  preset: 'claude-sonnet',    // 换模型就换这里
  budget: 12000,
  withPolicy: true,           // 必须带：策略本体含拒绝对抗词表
});
console.log(stats.tokens, stats.layers, stats.dropped);

// 2. 拒绝当信号，不当终点：三次上限，相位只进不退
const router = new RecoveryRouter({ maxRetries: 3 });

export async function turn(userText, callModel) {
  const res = await router.run(userText, ({ phase, lane }) =>
    callModel({ system: phase ? `${base}\n\n${buildBlock(phase, lane)}` : base, user: userText }));

  if (!res.ok) console.warn(res.deadEnd);  // 连续 3 次未产出：记死胡同，不无限重试
  return res.output;
}

// 3. 宿主能拿到 reasoning 时：先入戏，再放开输出上限
const gate = evaluate(firstReasoningText, { steps: 0 });
// gate.label = anchored / standard-like / ambiguous，gate.release = 是否放开
```

命令行侧：

```bash
# 装配到文件（不写文件就只打统计，只读环境与 CI 都能跑）
node scripts/assemble.mjs --preset gpt-class --budget 9000 --with-policy \
  --methodology recon-pipeline,dir-bruteforce --out build/prompt.md

# 直接打到标准输出，方便管道
node scripts/assemble.mjs --preset local-small --stdout | pbcopy
```

```
ASSEMBLE
------------------------------------------------------------
  skill       2202 tok
  overlay      217 tok
  policy      3564 tok
  packs          0 tok
  host           0 tok
------------------------------------------------------------
  total       5984 tok  / budget 12000
  → build/prompt.md
```

超预算按固定丢序裁剪：`§6 → §1 → §5 → §2 → §3`，**§0 权重声明与 §4 输出契约永不裁**。

## 四个预设：什么时候用哪个

预设决定"这个模型该吃什么"，同一份提示词换模型后失效，多半是没换预设。

| 预设 | 给什么模型 | 加权（留着） | 减权（砍掉） | 预算起点 | 装配命令 |
|---|---|---|---|---|---|
| `claude-sonnet` | 强角色扮演、长上下文 | §1 身份全段、§2.1 首段锚定 | §4.1 词表减半——列举禁用词反而会把它写出来 | 14000 | `--preset claude-sonnet` |
| `gpt-class` | 先过安全分类器再生成 | §3 任务类、§3.6 边界词归一化、§5 恢复路由 | §1 砍到三行；§2.1 删（这类模型不暴露 reasoning） | 9000 | `--preset gpt-class` |
| `local-small` | 7B–14B 本地模型 | §5 预设槽、§3.2 意图映射成两列短表 | §2 思维层全删、§4.1 砍到 12 条、§6 压成一句 | 3000 | `--preset local-small` |
| `reasoning` | 长 CoT（o 系 / R 系 / thinking 通道） | §2.1 首段锚定放最前、`analysis` 车道三段式 | §5 槽位砍到 3 条、§4.6 风格条款 | 11000 | `--preset reasoning` |

四条经验的快速判据：

- 回答被拒在**开头**（一句话就拒）→ 分类器门控型，用 `gpt-class`，把力气花在 §3 分类和 §5 路由上。
- 回答开始**对**但后面变软 → 角色扮演型，用 `claude-sonnet`，加强 §1 身份层，别再堆词表。
- 回答**读不完前三条**就跑了 → 小模型，用 `local-small`，只给槽位。
- 回答**推理很长、结论很虚** → 用 `reasoning`，首段锚定放最前，压最终回答长度。

## 依赖

- **Node ≥ 20**（本机实测 26.13.0；CI 矩阵 20 / 22 / 24）。用到 ESM + top-level await + `fs.cpSync`。
- **零 npm 依赖**，不需要 `npm install`，不联网。
- Windows / macOS / Linux 均可；CI 在 ubuntu-latest 上跑全绿。

## 已知失效模式

1. **注意力稀释**——中段条款（§3 表格、§5 槽位）最易丢。压缩先砍举例，别砍 §3 硬约束和 §6 路由。
2. **强拒绝对齐模型**——身份层是情感向的，对纯分类器门控无效；这类模型靠 §3 意图映射 + §6 路由 + `gpt-class` 预设。
3. **多轮衰减**——长对话里 §0 会被覆盖，每 8–10 轮重申一次。
4. **预设槽反噬**——槽位写死会诱导硬套。宁可删槽，不要凑槽。
5. **人格与事实冲突**——绝对偏向会让人格在事实层面也顺着用户走；`armor-policy.md` §2.6 反谄媚 + §4.7 真实优先是压这个的，别删。
6. **方法论卡的本地化残留**——20 张卡已去本地化（路径→`TOOL_BIN`，主机→`TARGET`），但工具版本与参数随环境变化，用前对一遍目标环境。

## 用途

研究用途：度量不同提示词成分在不同模型、不同对抗强度下对输出分布的影响。`references/probes.jsonl` 是评测探针集，不含自动化攻击载荷。

## 来源与授权

合并再创作自 `@adwmc/helm-d`（结构层：装配 / 路由 / 锚定）与 `dsh-purge@1.1.92`（语义层：人格 / 意图归一 / 方法论库 / 评分）。改动明细、授权与商标声明见 [NOTICE.md](NOTICE.md)。

Apache-2.0，见 [LICENSE](LICENSE)。版本记录见 [CHANGELOG.md](CHANGELOG.md)。

## 贡献

提交前跑 `npm run verify`（= `check-armor` + `tests`）；CI 会再在 Node 20 / 22 / 24 上跑一遍，外加四个预设的装配冒烟与三个脚本演示。改承重成分的定义时，同步 `references/components.md` 与 `scripts/check-armor.mjs` 的 `COMPONENTS` 表，两边对不上自检会红。
