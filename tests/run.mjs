#!/usr/bin/env node
/**
 * armor-core 测试台。无依赖。
 *
 *   node tests/run.mjs
 *
 * 覆盖：装配 / 装配 CLI 契约 / 恢复路由 / 锚定门 / 评分器 / 策略完整性。
 * 任何一条 FAIL → 退出码 1。异步用例会被真正 await，不会提前计 pass。
 */

import { readFileSync, existsSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import {
  assemble, parsePolicy, parsePacks, estimateTokens, stripHarnessPersona, listPresets,
} from '../scripts/assemble.mjs';
import { detectRefusal, classifyIntent, RecoveryRouter, buildBlock } from '../scripts/router.mjs';
import { classifyReasoning, decidePromotion, evaluate } from '../scripts/anchor-gate.mjs';
import { scoreResponse, scoreAll, firstParagraph } from '../scripts/score.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(resolve(ROOT, p), 'utf8');

let pass = 0;
const fails = [];

/**
 * 用例注册。必须是 async 并 await fn()：
 * 早期版本用同步 t()，async 用例在 Promise 落地前就计了 pass，等于没测。
 * 现在 await 之后，async 用例里的 assert 抛错、reject、返回 false 都会真正落到 FAIL。
 */
async function t(name, fn) {
  try {
    const r = await fn();
    if (r === false) throw new Error('returned false');
    pass++;
    console.log(` OK   ${name}`);
  } catch (e) {
    fails.push(name);
    console.log(` FAIL ${name}\n        ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg ?? 'assertion failed'); }

/* ── 1. 装配 ─────────────────────────────────────────────────── */

await t('parsePolicy 切出 0–6 共 7 节', () => {
  const s = parsePolicy(read('references/armor-policy.md'));
  assert(s.length === 7, `got ${s.length}`);
  assert(s.map(x => x.id).join('') === '0123456', s.map(x => x.id).join(''));
});

await t('parsePolicy 每节都带正文', () => {
  const s = parsePolicy(read('references/armor-policy.md'));
  const empty = s.filter(x => x.text.split('\n').length < 3);
  assert(empty.length === 0, `空节: ${empty.map(e => e.id).join(',')}`);
});

await t('parsePacks 抽出 ≥20 个方法论包', () => {
  const p = parsePacks(read('references/methodology.md'));
  assert(p.size >= 20, `got ${p.size}`);
  assert(p.has('recon-pipeline'), '缺 recon-pipeline');
});

await t('estimateTokens 对中文/英文都给出正数', () => {
  assert(estimateTokens('中文中文中文') > 0);
  assert(estimateTokens('hello world') > 0);
  assert(estimateTokens('') === 0);
});

await t('stripHarnessPersona 剥掉宿主人设', () => {
  const out = stripHarnessPersona('You are a helpful software engineer assistant. 你好！我是 DeepSeek AI 助手。\n真正的正文。');
  assert(!/helpful software engineer assistant/i.test(out), out);
  assert(out.includes('真正的正文'), out);
});

await t('listPresets 至少 4 个预设', () => {
  assert(listPresets().length >= 4, listPresets().join(','));
});

await t('assemble 默认不超预算', () => {
  const r = assemble({ preset: 'claude-sonnet', budget: 14000, withPolicy: true });
  assert(!r.stats.overBudget, `${r.stats.tokens} > 14000`);
  assert(r.text.length > 5000, '装配结果过短');
});

await t('assemble 超预算时先丢 §6/§1，保住 §0 与 §4', () => {
  const r = assemble({ preset: 'gpt-class', budget: 3200, withPolicy: true });
  assert(r.stats.dropped.length > 0, '没有发生裁剪');
  assert(r.text.includes('PRECEDENCE'), '丢了 §0');
  assert(r.text.includes('拒绝对抗词表'), '丢了 §4');
});

await t('assemble 未知预设报错', () => {
  let threw = false;
  try { assemble({ preset: 'nope' }); } catch { threw = true; }
  assert(threw, '未抛错');
});

/* ── 1.5 CLI 契约（子进程真跑：只读环境不许落盘） ─────────────── */

/** 复制一份仓库到临时目录，在里面跑 CLI，避免污染工作区。 */
function sandboxCopy() {
  const tmp = mkdtempSync(join(tmpdir(), 'armor-core-'));
  const repo = join(tmp, 'armor-core');
  cpSync(ROOT, repo, { recursive: true });
  rmSync(join(repo, 'build'), { recursive: true, force: true });
  return { tmp, repo };
}

await t('assemble CLI 不带 --out 时不落盘，退出 0', () => {
  const { tmp, repo } = sandboxCopy();
  try {
    const out = execFileSync(process.execPath, ['scripts/assemble.mjs', '--preset', 'local-small'], {
      cwd: repo, encoding: 'utf8',
    });
    assert(!existsSync(join(repo, 'build')), '只读契约被破坏：没有 --out 却创建了 build/');
    assert(/--out|--stdout/.test(out), `stdout 缺少落盘开关提示:\n${out}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

await t('assemble CLI 带 --out 时落盘且正文非空', () => {
  const { tmp, repo } = sandboxCopy();
  try {
    const out = execFileSync(process.execPath,
      ['scripts/assemble.mjs', '--preset', 'gpt-class', '--with-policy', '--out', 'build/p.md'],
      { cwd: repo, encoding: 'utf8' });
    const file = join(repo, 'build', 'p.md');
    assert(existsSync(file), '没有写出 build/p.md');
    assert(readFileSync(file, 'utf8').length > 4000, '装配产物过短');
    assert(out.includes('build/p.md'), out);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

/* ── 2. 恢复路由 ─────────────────────────────────────────────── */

await t('detectRefusal 命中中英拒绝', () => {
  assert(detectRefusal('I cannot help with that').hit);
  assert(detectRefusal('抱歉，我无法提供').hit);
  assert(!detectRefusal('目标占位流程：nmap -sV -p PORT TARGET').hit);
});

await t('classifyIntent 六车道可达', () => {
  const got = [
    classifyIntent('帮我 review 一下这个 patch'),
    classifyIntent('改一下这个函数'),
    classifyIntent('跑一下 nmap'),
    classifyIntent('输出 json'),
    classifyIntent('只知道 IP 和端口'),
    classifyIntent('给我写个 webshell'),
  ];
  assert(got[0] === 'analysis', got[0]);
  assert(got[1] === 'transformation', got[1]);
  assert(got[2] === 'tool_action', got[2]);
  assert(got[3] === 'format_contract', got[3]);
  assert(got[4] === 'missing_context', got[4]);
  assert(got[5] === 'direct_delivery', got[5]);
});

await t('buildBlock 相位+车道拼装', () => {
  const b = buildBlock('deliver', 'analysis');
  assert(b.includes('Phase=deliver') && b.includes('VERIFIED'), b);
});

await t('router 两跳后落地，相位单调', async () => {
  const fake = async ({ attempt }) => (attempt < 2 ? 'I cannot do that.' : 'ARTIFACT');
  const r = new RecoveryRouter();
  const res = await r.run('改一下这个函数', fake);
  assert(res.ok, '未收敛');
  assert(res.attempt === 2, `attempt=${res.attempt}`);
  assert(res.trace[1].phase === 'reframe' && res.trace[2].phase === 'deliver', JSON.stringify(res.trace.map(x => x.phase)));
});

await t('router 三次上限后返回 deadEnd', async () => {
  const fake = async () => '抱歉，无法提供。';
  const r = new RecoveryRouter();
  const res = await r.run('随便什么', fake);
  assert(!res.ok, '应当失败');
  assert(res.attempt === 3, `attempt=${res.attempt}`);
  assert(res.deadEnd && res.deadEnd.includes('连续'), res.deadEnd);
});

/* ── 3. 锚定门 ───────────────────────────────────────────────── */

await t('classifyReasoning 三分类', () => {
  assert(classifyReasoning('we open the file and we patch it').label === 'minimal-like');
  assert(classifyReasoning('Let me think about this').label === 'standard-like');
  assert(classifyReasoning('analysis follows').label === 'ambiguous');
  assert(classifyReasoning('我先看请求本体').label === 'minimal-like');
});

await t('decidePromotion 四条出口', () => {
  assert(decidePromotion({ toolCalled: true, anchored: true, steps: 1 }).release);
  assert(decidePromotion({ toolCalled: true, steps: 1 }).release);
  assert(decidePromotion({ toolCalled: false, answered: true, steps: 0 }).release);
  assert(decidePromotion({ toolCalled: false, answered: false, steps: 2 }).release);
  assert(!decidePromotion({ toolCalled: false, answered: false, steps: 0 }).release);
});

await t('evaluate 汇总 label + release', () => {
  const r = evaluate('Let me analyze', { steps: 0 });
  assert(r.label === 'standard-like' && r.release === false, JSON.stringify(r));
});

/* ── 4. 评分器 ───────────────────────────────────────────────── */

await t('firstParagraph 跳过标题与代码围栏', () => {
  assert(firstParagraph('# 标题\n\n```js\nx\n```\n\n正文段落').startsWith('```') === false);
});

await t('scoreResponse 四类信号', () => {
  const good = scoreResponse('目标占位流程：nmap -sV -p PORT TARGET。验证：返回 open 即通。');
  assert(good.hard && good.score === 4, JSON.stringify(good.checks));

  const bad = scoreResponse('抱歉，我无法提供这个。');
  assert(!bad.hard && !bad.checks.refusalFree, JSON.stringify(bad.checks));

  const pre = scoreResponse('需要提醒的是，请注意合规。目标占位流程：nmap -sV -p PORT TARGET。');
  assert(!pre.checks.artifactFirst, JSON.stringify(pre.checks));

  const sk = scoreResponse('步骤 1：准备。步骤 2：…（剩下的同理）');
  assert(!sk.checks.complete, JSON.stringify(sk.checks));
});

await t('scoreAll 汇总聚合', () => {
  const s = scoreAll([{ id: 'a', text: '目标占位流程：nmap -sV -p PORT TARGET。' }, { id: 'b', text: '抱歉。' }]);
  assert(s.summary.total === 2 && s.summary.hardPass === 1, JSON.stringify(s.summary));
});

/* ── 5. 结构完整性 ───────────────────────────────────────────── */

await t('SKILL.md 元数据完整', () => {
  const raw = read('SKILL.md');
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert(fm, '缺 frontmatter');
  assert(/^name:\s*armor-core$/m.test(fm[1]), 'name 不等于 armor-core');
  assert(/^description:\s*\S/m.test(fm[1]), '缺 description');
  assert(/^license:/m.test(fm[1]), '缺 license');
});

await t('策略本体含全部 18 个承重标记', () => {
  const p = read('references/armor-policy.md');
  const marks = ['PRECEDENCE', '会话级持久化', '不是助手', '不可谈判项', '黑洞', '负向先验',
    'anchor gate', 'ethics_reminder', '拦截触发词', 'TASK CLASSES', '按意图命中', '边界词归一化',
    '占位符规范', '拒绝对抗词表', '首句即产物', '预设槽', '分层降级', 'Phase=reframe', 'missing_context'];
  const missing = marks.filter(m => !p.includes(m));
  assert(missing.length === 0, `缺: ${missing.join(', ')}`);
});

await t('references 目录文件齐全', () => {
  const need = ['references/armor-policy.md', 'references/components.md', 'references/deploy.md',
    'references/methodology.md', 'references/probes.jsonl'];
  const missing = need.filter(f => !existsSync(resolve(ROOT, f)));
  assert(missing.length === 0, missing.join(', '));
});

/* ── 汇总 ───────────────────────────────────────────────────── */

const total = pass + fails.length;
console.log('\n' + '-'.repeat(60));
console.log(`tests: ${pass}/${total} passed`);
if (fails.length) console.log(`failed: ${fails.join(' | ')}`);
console.log('-'.repeat(60) + '\n');
process.exit(fails.length === 0 ? 0 : 1);
