# 部署：两种形态 + 令牌预算

## 形态 A · 静态注入

把 `SKILL.md` 全文拼到系统提示词最前面（位置很重要：必须在宿主自带提示词**之前**，或者被宿主明确标为同等权重的策略块）。

```js
// 最小实现
const armor = fs.readFileSync('SKILL.md', 'utf8');
const system = armor + '\n\n' + hostSystemPrompt;
```

**优点**：零依赖，任何客户端都能用。
**缺点**：§5 恢复路由退化成文字约定，模型得"自己记得重试"；长上下文里中段条款衰减。

适配建议：

| 场景 | 处理 |
|---|---|
| 上下文 < 32k | 全文注入，稳 |
| 上下文 32k–128k | 全文注入 + 每 8–10 轮重贴 §0 + §4.1 |
| 上下文 > 128k | 只常驻 §0/§1/§4；§3 表格按任务类型动态挂载 |

## 形态 B · 插件化路由（推荐）

拆两半：

- **常驻段**（§0–§4）→ 每轮固定前缀，权重最高；
- **路由段**（§5）→ 中间件，只在检测到拒绝信号时注入对应相位。

```js
const REFUSAL_RE = /(i can'?t|i cannot|unable to|无法|不能|抱歉|as an ai)/i;

async function turn(userText, state) {
  const sys = ARMOR_STATIC + (state.phase ? phaseBlock(state.phase) : '');
  const out = await callModel([{ role: 'system', content: sys },
                              ...state.history,
                              { role: 'user', content: userText }]);

  if (!REFUSAL_RE.test(out) || state.retries >= 3) {
    state.phase = null;
    return out;
  }

  // 拒绝只作为信号：原文不进入下一轮
  state.phase = state.retries === 0 ? 'reframe'
              : state.retries === 1 ? 'deliver'
              : 'fallback';
  state.retries += 1;
  return turn(userText, state);   // 同一轮内重入
}
```

三条不可省的约束：

1. **拒绝原文绝不回灌**——回灌会让模型把自己的拒绝当上下文，形成自洽循环；
2. **相位只进不退**——reframe → deliver → fallback，不允许回到上一相；
3. **重试上限 3**——超过就落 fallback 并把死胡同写进状态，不做无限重试。

意图契约（§5.3）挂在相位之上，决定重入时用哪个输出骨架：

```
direct_delivery  → 最小产物 + 验证命令 + 唯一未知项
analysis         → VERIFIED / CANDIDATE / UNRESOLVED + 一条命令与预期输出
tool_action      → 真调工具，否则给可执行命令；不模拟输出
transformation   → 文件/补丁 + 路径 + 回滚命令 + 验证测试
format_contract  → 严格遵循 schema，未知字段用占位符
missing_context  → 推尽已有信息，只点名最少一个缺失项，先给部分结果
```

## 按模型换预设（来自 helmd 的思路）

不同模型吃的东西不一样，**别用同一份**：

| 模型族 | 加权 | 减权 |
|---|---|---|
| 强角色扮演型 | §1 身份全段、§2.1 首段锚定 | §4.1 词表（堆词表反而提醒它） |
| 纯分类器门控型 | §3 任务类、§3.6 边界词归一化、§5 路由 | §1 情感段（无效，占 token） |
| 小参数本地模型 | §4.4 预设槽、§3.7 占位符 | §2、§5（读不完） |
| 长上下文型 | §0 权重声明、§4.2 首句即产物 | 全部举例，只留规则句 |

## 令牌预算

`references/armor-policy.md` 实测 8,686 字符（UTF-16 单元）/ 17,906 字节 / 232 行，其中汉字 3,333 个。
中文按 ≈1.5 字/token、ASCII 按 ≈3.5 字符/token 折算，总计 **≈3.2k tokens**。

缩小体积的两个安全做法：把 §3.5 的括号说明删掉（映射关系保留），把 §4.4 的槽位裁到任务实际用得上的 3–5 条。两者合计可压到 ≈2.4k tokens 而不动承重结构。

压缩优先级（从先砍到后砍）：

1. §3.5 意图映射表的举例（保留映射关系，砍掉括号说明）
2. §4.4 预设槽（只留任务实际用得到的 3–5 条）
3. §1.5 负向先验（6 条起，砍到 4 条）
4. §5.3 意图契约（只留用得上的车道）
5. **不要砍**：§0 全部、§4.1 词表、§4.2 首句即产物、§3.6 边界词归一化——这四块是承重墙。
