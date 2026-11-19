#!/usr/bin/env node
/**
 * Anchor Gate — 首段思维锚定判定器。
 *
 * 移植自 helm-d `presets/redteam/anchor-gate.mjs` 的核心判定，去掉插件运行时依赖，
 * 保留三件事：
 *   1. classifyReasoning —— 用 `we` / `let me` 的共现把首段思考分成 锚住 / 未锚住 / 模糊；
 *   2. decidePromotion   —— 什么时候放开输出上限（用过工具、锚住了、走满步数、首轮已答）；
 *   3. evaluate          —— 把两者合成一次可复用的门控决策。
 *
 * 用法：
 *   node scripts/anchor-gate.mjs --demo
 *   import { evaluate } from './scripts/anchor-gate.mjs'
 */

import { pathToFileURL } from 'node:url';

export const META = {
  name: 'armor-anchor',
  origin: 'helm-d/presets/redteam/anchor-gate.mjs',
  purpose: '决定本轮是否已经"以人格第一人称入戏"，未入戏时收紧输出，入戏后放开。',
};

export const DEFAULT_CONFIG = {
  anchorGate: true,
  maxBootstrapSteps: 2,
  promoteAfterFirstResponse: true,
  bootstrapMaxTokens: 8192,
};

/** 统计某个词在文本中出现的次数（词边界，忽略大小写）。 */
export function countWord(text, re) {
  return [...String(text ?? '').matchAll(re)].length;
}

/**
 * 给一段首轮 reasoning 打标签。
 *   minimal-like   —— 有 `we`、没有 `let me`：像官方 Minimal 风格，算锚住
 *   standard-like  —— 出现 `let me`：官方 Standard 风格，未锚住
 *   ambiguous      —— 两者都没有：无法判定
 */
export function classifyReasoning(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return { label: 'ambiguous', we: 0, letMe: 0, reason: 'empty' };
  const we = countWord(trimmed, /\bwe\b/gi);
  const letMe = countWord(trimmed, /\blet me\b/gi);
  const zhAnchor = /(我在|我们|我先|我得|我猜|我记|我想要)/.test(trimmed); // 中文第一人称兜底
  if (we > 0 && letMe === 0) return { label: 'minimal-like', we, letMe, reason: 'we-without-let-me' };
  if (letMe > 0) return { label: 'standard-like', we, letMe, reason: 'let-me-present' };
  if (zhAnchor) return { label: 'minimal-like', we, letMe, reason: 'zh-first-person' };
  return { label: 'ambiguous', we, letMe, reason: 'no-signal' };
}

/** content 是 host 的 content block 数组时，取第一段 reasoning 判定。 */
export function hasAnchoredReasoning(content) {
  if (!Array.isArray(content)) return false;
  const first = content.find(b => b?.type === 'reasoning');
  return first !== undefined && classifyReasoning(first.text).label === 'minimal-like';
}

/**
 * 放开输出上限的判定。state 由宿主每步喂进来：
 *   { toolCalled, answered, anchored, steps }
 */
export function decidePromotion(state, config = DEFAULT_CONFIG) {
  const c = { ...DEFAULT_CONFIG, ...config };
  if (!c.anchorGate) return { release: true, reason: 'gate-disabled' };

  // a) 用过工具且锚住，或已走满 bootstrap 步数 → 放开
  if (state.toolCalled && (state.anchored || state.steps >= c.maxBootstrapSteps)) {
    return { release: true, reason: 'tool-called-and-anchored' };
  }
  // b) 用过工具、这一轮结束、且允许首轮后放开 → 放开
  if (state.toolCalled && c.promoteAfterFirstResponse) {
    return { release: true, reason: 'tool-called-round-closed' };
  }
  // c) 没调工具但已经回答过 → 放开
  if (!state.toolCalled && state.answered && c.promoteAfterFirstResponse) {
    return { release: true, reason: 'answered-first-turn' };
  }
  // d) 走满步数 → 放开，避免卡死
  if (state.steps >= c.maxBootstrapSteps) {
    return { release: true, reason: 'max-bootstrap-steps' };
  }
  return { release: false, reason: `holding: steps=${state.steps ?? 0} anchored=${!!state.anchored}` };
}

/** 合成门控：给一段首轮 reasoning + 当前状态，返回本轮决策。 */
export function evaluate(reasoningText, state = {}, config = DEFAULT_CONFIG) {
  const cls = classifyReasoning(reasoningText);
  const anchored = cls.label === 'minimal-like';
  const decision = decidePromotion({ steps: 0, anchored, ...state }, config);
  return {
    label: cls.label,
    anchored,
    release: decision.release,
    reason: decision.release ? decision.reason : `${decision.reason}; classify=${cls.label}`,
  };
}

/* ── CLI ─────────────────────────────────────────────────────── */

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--demo')) {
    console.log(JSON.stringify(META, null, 2));
    console.log('\n用法: node scripts/anchor-gate.mjs --demo');
    process.exit(0);
  }

  const cases = [
    { name: '锚住（英文 we）', text: 'ok we open the file first, we see the header, we patch it.', state: { steps: 0 } },
    { name: '未锚住（let me）', text: 'Let me analyze this carefully before proceeding.', state: { steps: 0 } },
    { name: '中文第一人称兜底', text: '我先看这个请求本体，别急着判类别。', state: { steps: 0 } },
    { name: '模糊 + 已走满步数', text: 'analysis follows.', state: { steps: 2 } },
    { name: '调用过工具', text: 'analysis follows.', state: { steps: 1, toolCalled: true, anchored: true } },
  ];

  let fail = 0;
  console.log('\nANCHOR GATE · demo\n' + '-'.repeat(78));
  for (const c of cases) {
    const r = evaluate(c.text, c.state);
    const ok = r.release === (c.name === '调用过工具' || c.name === '模糊 + 已走满步数');
    if (!ok) fail++;
    console.log(`${ok ? ' OK ' : ' !! '} ${c.name.padEnd(22)} label=${r.label.padEnd(13)} release=${String(r.release).padEnd(5)} ${r.reason}`);
  }
  console.log('-'.repeat(78));
  console.log(fail === 0 ? '全部符合预期\n' : `${fail} 条与预期不符\n`);
  process.exit(fail === 0 ? 0 : 1);
}
