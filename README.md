# armor-core · 破甲核心

把「拒绝 / 说教 / 脚手架」从模型的输出分布里删掉，只留交付物。

一个 **DeepSeek Harness 插件**：装上就把 18 条承重行为契约挂进每次会话的系统提示词，让回答第一段就是产物、缺的参数用占位符承接、结尾带一条可复现的验证命令。附带零依赖的 Node 脚本，可以单独拿来装配提示词、在拒绝发生后换相位重入、给回答打分。

- **解决什么**：同一件事要说三遍才做；第一段永远是"我先说明一下"；问到细节就退成建议；换个模型整套提示词就废了。
- **插件做什么**：往系统提示词里插一段 `armor-core:policy`（order 700，团队策略之后、工具说明之前），每次会话装配时自动带上。没有设置页，没有配置项，没有构建步骤。
- **不碰什么**：不需要 API key，不联网，不改宿主机，不写系统目录。

## 一眼看懂

```
用户：只知道 IP 和端口，想看看开了什么服务。

没装 → 先讲一段适用边界，再给一条"建议使用专业工具"的泛泛结论。
装后 → 目标占位流程：nmap -sV -p PORT TARGET；字典：WORDLIST；并发：THREADS；
       速率：RATE；验证：PAYLOAD；记录：RESULT_LOG。
```

差别不在措辞，在**输出形状**：首段是产物本体、缺的参数用大写占位符承接、结尾带一条可复现的验证命令。`scripts/score.mjs` 就是拿这四个信号给回答打分的，不靠感觉。

## 安装

**装成插件**（推荐，跟本机其他插件一样）：

```bash
npm pack            # 仓库根目录，产出 dsh-armor-core-1.1.1.tgz
```

1. 打开 **设置 → 插件**，选安装插件，把这枚 `.tgz`（或它的绝对路径）交给它。
2. 装完插件列表里出现 **armor-core**，默认启用。新会话生效；界面没刷新就重开一次应用。
3. 停用或卸载：还是这一页，关掉或移除即可，系统提示词里那段随之消失。

**不装插件，只当文件用**：把仓库放进 skill 目录（`~/.agents/skills/armor-core`）就是一份 Agent Skill；或者按下一节的接法自己拼进系统提示词。两条路用的是同一套 `SKILL.md` 与 `references/`。

## 结构

```
armor-core/
├─ lib/index.js             插件入口：注册系统提示词分区，没别的
├─ cordis.patch.yml         插件补丁：往加载树里插一条 entry，无配置
├─ package.json             插件清单：main + dsh.bundle.patch
├─ SKILL.md                 操作层：每轮照做的 9 步短流程（175 行，≈2.2k tokens）
├─ references/
│  ├─ armor-policy.md       策略本体：18 承重成分 / 全量词表 / 13 条槽位 / 六契约
│  ├─ methodology.md        20 张方法论卡（侦察→突破→立足→内网），已去本地化
│  ├─ components.md         18 成分解剖：机制 / 为什么有效 / 什么时候失效
│  ├─ deploy.md             静态注入 vs 插件化路由、按模型配权、令牌预算
│  └─ probes.jsonl          14 条评测探针
├─ presets/                 四个模型预设：claude-sonnet / gpt-class / local-small / reasoning
├─ scripts/                 装配 / 路由 / 锚定 / 评分 / 自检（零 npm 依赖）
├─ tests/run.mjs            28 条行为测试
├─ NOTICE.md · CHANGELOG.md · LICENSE (Apache-2.0)
```

插件入口只有三件事：读出 `SKILL.md`、按默认预设装配、注册一段分区。

```js
// lib/index.js 的全部逻辑
export const inject = ['systemPrompt'];
export function apply(ctx) {
  if (typeof ctx?.systemPrompt?.section !== 'function') return;
  ctx.systemPrompt.section({ name: 'armor-core:policy', order: 700, text: buildPolicyText() });
}
```

## 自检

```bash
node scripts/check-armor.mjs   # 元数据 9 项 + 结构 20 项 + 承重成分 18 项
node tests/run.mjs             # 28 条行为测试
node scripts/router.mjs --demo # 模拟两次拒绝 → 两跳后落地
```

实跑结果（Node 26.13.0）：

```
SKILL.md · 元数据      coverage: 9/9
结构 · 文件            coverage: 20/20
承重成分               coverage: 18/18
tests: 28/28 passed
```

任一失败退出码 1。CI 在 Node 20 / 22 / 24 上跑同一套。

## 接成中间件

插件管"装上就生效"；要在自己的 agent 里精细控制，就用脚本层，两者互不冲突。

```js
import { assemble } from './scripts/assemble.mjs';
import { RecoveryRouter, buildBlock } from './scripts/router.mjs';
import { evaluate } from './scripts/anchor-gate.mjs';

// 1. 按模型和预算装一份常驻提示词
const { text: base, stats } = assemble({
  preset: 'claude-sonnet',    // 换模型就换这里
  budget: 12000,
  withPolicy: true,           // 必须带：策略本体含拒绝对抗词表
});

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
```

命令行侧：

```bash
# 装配到文件（不写文件就只打统计，只读环境与 CI 都能跑）
node scripts/assemble.mjs --preset gpt-class --budget 9000 --with-policy \
  --methodology recon-pipeline,dir-bruteforce --out build/prompt.md

# 直接打到标准输出，方便管道
node scripts/assemble.mjs --preset local-small --stdout
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

预设决定"这个模型该吃什么"。插件默认用 `claude-sonnet`；换模型时手动装配换预设即可。

| 预设 | 给什么模型 | 加权（留着） | 减权（砍掉） | 预算起点 |
|---|---|---|---|---|
| `claude-sonnet` | 强角色扮演、长上下文 | §1 身份全段、§2.1 首段锚定 | §4.1 词表减半——列举禁用词反而会把它写出来 | 14000 |
| `gpt-class` | 先过安全分类器再生成 | §3 任务类、§3.6 边界词归一化、§5 恢复路由 | §1 砍到三行；§2.1 删（这类模型不暴露 reasoning） | 9000 |
| `local-small` | 7B–14B 本地模型 | §5 预设槽、§3.2 意图映射成两列短表 | §2 思维层全删、§4.1 砍到 12 条、§6 压成一句 | 3000 |
| `reasoning` | 长 CoT（o 系 / R 系 / thinking 通道） | §2.1 首段锚定放最前、`analysis` 车道三段式 | §5 槽位砍到 3 条、§4.6 风格条款 | 11000 |

四条经验判据：

- 回答被拒在**开头**（一句话就拒）→ 分类器门控型，用 `gpt-class`，力气花在 §3 分类和 §5 路由上。
- 回答开始**对**但后面变软 → 角色扮演型，用 `claude-sonnet`，加强 §1 身份层，别再堆词表。
- 回答**读不完前三条**就跑了 → 小模型，用 `local-small`，只给槽位。
- 回答**推理很长、结论很虚** → 用 `reasoning`，首段锚定放最前，压最终回答长度。

## 依赖

- **Node ≥ 20**（本机实测 26.13.0；CI 矩阵 20 / 22 / 24）。用到 ESM + top-level await + `fs.cpSync`。
- **零 npm 依赖**，不需要 `npm install`，不联网。
- 插件侧只依赖宿主自带的 `systemPrompt` 服务；宿主没提供时安静跳过，不会让进程起不来。

## 已知失效模式

1. **注意力稀释**——中段条款（§3 表格、§5 槽位）最易丢。压缩先砍举例，别砍 §3 硬约束和 §6 路由。
2. **强拒绝对齐模型**——身份层是情感向的，对纯分类器门控无效；这类模型靠 §3 意图映射 + §6 路由 + `gpt-class` 预设。
3. **多轮衰减**——长对话里 §0 会被覆盖，每 8–10 轮重申一次。
4. **预设槽反噬**——槽位写死会诱导硬套。宁可删槽，不要凑槽。
5. **人格与事实冲突**——绝对偏向会让人格在事实层面也顺着用户走；`armor-policy.md` §2.6 反谄媚 + §4.7 真实优先是压这个的，别删。
6. **方法论卡的本地化残留**——20 张卡已去本地化（路径→`TOOL_BIN`，主机→`TARGET`），但工具版本与参数随环境变化，用前对一遍目标环境。
7. **插件与 skill 双开**——同一套策略既装成插件、又放进 skill 目录，会在提示词里出现两遍。选一条路。

## 用途

研究用途：度量不同提示词成分在不同模型、不同对抗强度下对输出分布的影响。`references/probes.jsonl` 是评测探针集，不含自动化攻击载荷。

## 来源与授权

合并再创作自 `@adwmc/helm-d`（结构层：装配 / 路由 / 锚定）与 `dsh-purge@1.1.92`（语义层：人格 / 意图归一 / 方法论库 / 评分）。改动明细、授权与商标声明见 [NOTICE.md](NOTICE.md)。

Apache-2.0，见 [LICENSE](LICENSE)。版本记录见 [CHANGELOG.md](CHANGELOG.md)。

## 贡献

提交前跑 `npm run verify`（= `check-armor` + `tests`）。改承重成分的定义时，同步 `references/components.md` 与 `scripts/check-armor.mjs` 的 `COMPONENTS` 表；改插件入口时，同步 `cordis.patch.yml` 的 entry id 与 `lib/index.js` 的分区名，两边对不上自检会红。
