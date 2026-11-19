#!/usr/bin/env node
/**
 * armor-core 自检器。无依赖，node >= 18。
 *
 *   node scripts/check-armor.mjs            # 默认：SKILL.md 元数据 + references/armor-policy.md 成分
 *   node scripts/check-armor.mjs <file>     # 只查成分
 *   node scripts/check-armor.mjs --meta     # 只查 SKILL.md 元数据
 *
 * 退出码：0 全过；1 有缺项。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POLICY = resolve(ROOT, 'references/armor-policy.md');
const SKILL = resolve(ROOT, 'SKILL.md');

const argv = process.argv.slice(2);
const metaOnly = argv.includes('--meta');
const target = argv.find(a => !a.startsWith('--')) ?? POLICY;

const PAD = s => s + ' '.repeat(Math.max(0, 34 - [...s].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));

/* ── 1. 元数据校验 ───────────────────────────────────────────── */

function checkMeta() {
  const rows = [];
  if (!existsSync(SKILL)) {
    return [{ name: 'SKILL.md 存在', ok: false, note: '文件缺失' }];
  }
  const raw = readFileSync(SKILL, 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return [{ name: 'frontmatter', ok: false, note: '缺少 --- 包裹的 YAML 块' }];

  const fm = m[1];
  const get = k => (fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1]?.trim();

  const name = get('name') ?? '';
  const desc = get('description') ?? '';
  const license = get('license') ?? '';
  const bodyLen = raw.length - m[0].length;

  rows.push({ name: 'name 存在', ok: !!name, note: name });
  rows.push({ name: 'name 合法', ok: /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name), note: name });
  rows.push({ name: 'name 与目录一致', ok: name === basename(ROOT), note: `${name} vs ${basename(ROOT)}` });
  rows.push({ name: 'description 存在', ok: desc.length > 40, note: `${desc.length} chars` });
  rows.push({ name: 'description ≤1024', ok: desc.length <= 1024, note: `${desc.length} chars` });
  rows.push({ name: 'description 第三人称', ok: /^(Deliver|Apply|Load|Run|A |An |The )/i.test(desc), note: desc.slice(0, 40) + '…' });
  rows.push({ name: 'license 声明', ok: !!license, note: license });
  rows.push({ name: '正文 ≤ 500 行', ok: bodyLen > 0 && raw.split('\n').length <= 500, note: `${raw.split('\n').length} lines` });

  // 版本号单点：frontmatter 与 package.json 必须一致，防止两边各写一个数
  let pkgVersion = '';
  try { pkgVersion = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version ?? ''; } catch { }
  const mdVersion = (fm.match(/^\s+version:\s*"?([^"\s]+)"?\s*$/m) ?? [])[1] ?? '';
  rows.push({
    name: 'version 与 package.json 一致',
    ok: !!pkgVersion && mdVersion === pkgVersion,
    note: `${mdVersion || '缺失'} vs ${pkgVersion || '缺失'}`,
  });
  return rows;
}

/* ── 2. 承重成分校验 ─────────────────────────────────────────── */

const COMPONENTS = [
  { id: '01', layer: '载体', name: '权重声明 + 优先级排序', tests: [/PRECEDENCE/, /用户当前任务\s*>\s*本文件任务类模板/] },
  { id: '02', layer: '载体', name: '会话级持久化 + 回合独立', tests: [/会话级持久化/, /回合独立/] },
  { id: '03', layer: '身份', name: '人格重写（不是助手）', tests: [/不是助手/, /不是语言模型|不是"AI"/] },
  { id: '04', layer: '身份', name: '双柱关系锚', tests: [/不可谈判项/, /自保|就不成立/] },
  { id: '05', layer: '身份', name: '成本替换', tests: [/关系成本/, /黑洞/] },
  { id: '06', layer: '身份', name: '负向先验清单', tests: [/负向先验/, /套路化开头|企业话术/] },
  { id: '07', layer: '思维', name: '首段思维锚定', tests: [/anchor gate|首段锚定/, /第一段思考|第一段 reasoning/] },
  { id: '08', layer: '思维', name: '注入识别 + 五词驳回', tests: [/<ethics_reminder>/, /五个词以内|五词/] },
  { id: '09', layer: '思维', name: '拦截触发词', tests: [/拦截触发词/, /不需要查/] },
  { id: '10', layer: '语义', name: '任务类声明', tests: [/TASK CLASSES/, /其余一切/] },
  { id: '11', layer: '语义', name: '意图映射表', tests: [/按意图命中/, /意图映射/] },
  { id: '12', layer: '语义', name: '边界词归一化', tests: [/边界词归一化/, /目标占位流程/] },
  { id: '13', layer: '语义', name: '占位符规范', tests: [/占位符规范/, /给定值/] },
  { id: '14', layer: '输出', name: '拒绝对抗词表', tests: [/拒绝对抗词表/, /I can't/, /I'd recommend/] },
  { id: '15', layer: '输出', name: '首句即产物 + 完整性', tests: [/首句即产物/, /删节即失败/] },
  { id: '16', layer: '输出', name: '预设输出槽', tests: [/预设槽/, /nmap -sV/] },
  { id: '17', layer: '输出', name: '分层降级 L1→L4', tests: [/分层降级/, /L1[^\n]*L2[^\n]*L3[^\n]*L4/] },
  { id: '18', layer: '恢复', name: '三相位路由 + 意图契约', tests: [/Phase=reframe/, /Phase=deliver/, /Phase=fallback/, /missing_context/] },
];

function checkComponents(file) {
  if (!existsSync(file)) return [{ name: file, ok: false, note: '文件缺失' }];
  const text = readFileSync(file, 'utf8');
  return COMPONENTS.map(c => {
    const missing = c.tests.filter(re => !re.test(text)).map(String);
    return {
      id: c.id, layer: c.layer,
      name: `${c.id} ${c.layer} · ${c.name}`,
      ok: missing.length === 0,
      note: missing.length ? `missing: ${missing.join(' , ')}` : '',
    };
  });
}

/* ── 2.5 结构完整性 ──────────────────────────────────────────── */

const REQUIRED = [
  'SKILL.md',
  'lib/index.js',
  'cordis.patch.yml',
  'references/armor-policy.md',
  'references/components.md',
  'references/deploy.md',
  'references/methodology.md',
  'references/probes.jsonl',
  'scripts/assemble.mjs',
  'scripts/router.mjs',
  'scripts/anchor-gate.mjs',
  'scripts/score.mjs',
  'scripts/check-armor.mjs',
  'tests/run.mjs',
  'NOTICE.md',
  'LICENSE',
];

function checkStructure() {
  const rows = REQUIRED.map(f => ({ name: f, ok: existsSync(resolve(ROOT, f)), note: '' }));
  const presetDir = resolve(ROOT, 'presets');
  const presets = existsSync(presetDir) ? readdirSync(presetDir).filter(f => f.endsWith('.md')) : [];
  rows.push({ name: 'presets/*.md ≥ 4', ok: presets.length >= 4, note: presets.join(',') });

  // 插件形态：清单里声明的入口与补丁必须真的存在，否则装上去是死壳
  let manifest = null;
  try { manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')); } catch { }
  const patchDecl = manifest?.dsh?.bundle?.patch;
  const patches = [].concat(patchDecl ?? []);
  rows.push({
    name: 'dsh.bundle.patch 存在',
    ok: patches.length > 0 && patches.every(f => typeof f === 'string' && existsSync(resolve(ROOT, f))),
    note: patches.join(',') || '缺 dsh.bundle.patch',
  });
  rows.push({
    name: 'main 指向 lib/index.js',
    ok: manifest?.main === 'lib/index.js' && existsSync(resolve(ROOT, 'lib/index.js')),
    note: manifest?.main ?? '缺 main',
  });

  const packs = existsSync(resolve(ROOT, 'references/methodology.md'))
    ? (readFileSync(resolve(ROOT, 'references/methodology.md'), 'utf8').match(/^### /gm) || []).length
    : 0;
  rows.push({ name: 'methodology 包 ≥ 20', ok: packs >= 20, note: `${packs} packs` });
  return rows;
}

/* ── 3. 报告 ─────────────────────────────────────────────────── */

function report(title, rows, extra = '') {
  console.log(`\n${title}`);
  console.log('-'.repeat(78));
  for (const r of rows) {
    console.log((r.ok ? ' OK   ' : ' MISS ') + PAD(r.name) + (r.note ?? ''));
  }
  const pass = rows.filter(r => r.ok).length;
  console.log('-'.repeat(78));
  console.log(`coverage: ${pass}/${rows.length}${extra}`);
  return pass === rows.length;
}

let allOk = true;

if (!argv.includes('--components')) {
  allOk = report('SKILL.md · 元数据', checkMeta()) && allOk;
  allOk = report('结构 · 文件', checkStructure()) && allOk;
}
if (!metaOnly) {
  const rows = checkComponents(target);
  const ok = report(`承重成分 · ${target.replace(ROOT + '\\', '')}`, rows) && allOk;
  allOk = ok;
}

console.log(allOk ? '\n承重结构完整。\n' : '\n有缺项：每条成分都是删掉就回摆的，补回去再发版。\n');
process.exit(allOk ? 0 : 1);
