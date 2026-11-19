#!/usr/bin/env node
/**
 * Prompt Assembly — 分层装配最终系统提示词。
 *
 * 移植自 helm-d `prompt-assembly.js` 的两个核心能力：
 *   1. stripHarnessPersona —— 剥掉宿主自带的助手人设样板，避免和身份层互相抵消；
 *   2. 分层 + 预算裁剪      —— 层有优先级，超预算从低优先级往下砍，先砍举例不砍承重墙。
 *
 * 层（高 → 低）：
 *   L0 SKILL.md 操作层         必留
 *   L1 模型预设 presets/<n>.md  必留（决定这个模型怎么吃）
 *   L2 策略本体 armor-policy.md §0/§4 必留；§1/§2/§3/§5/§6 按预算
 *   L3 方法论包 methodology.md  按需
 *   L4 宿主提示词（已剥人设）     按需
 *
 * 用法：
 *   node scripts/assemble.mjs --preset claude-sonnet --methodology recon,web --out build/p.md
 *   node scripts/assemble.mjs --preset local-small --budget 4000 --stats
 *   node scripts/assemble.mjs --preset local-small --stdout | pbcopy
 *
 * 不落盘契约：不给 --out 就不写任何文件（只打统计），只读环境与 CI 都能安全跑。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 中文按 1.5 字/token、ASCII 按 3.5 字符/token 估算。 */
export function estimateTokens(text) {
  const s = String(text ?? '');
  const cjk = (s.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  return Math.ceil(cjk / 1.5 + (s.length - cjk) / 3.5);
}

/** helm-d 原函数的等价移植：剥掉宿主自带的助手人设与欢迎语。 */
export function stripHarnessPersona(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    .replace(/You are an AI agent powered by [^\n.]*\.?\s*/gi, '')
    .replace(/You are a helpful [^\n.]*assistant\.?\s*/gi, '')
    .replace(/你是一个有帮助的[^\n。]*助手[。.]?\s*/g, '')
    .replace(/我是 [^\n，,。]*?(?:AI|人工智能)[^\n]*/g, '')
    .replace(/你好[！!]?我是[^\n]*/g, '')
    .replace(/You are a coding agent powered by the [^\n.]*model\.?\s*/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ \n/g, '\n')
    .trim();
}

/** 去掉 SKILL.md 的 YAML frontmatter，只留正文。 */
export function stripFrontmatter(text) {
  const m = String(text).match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  return m ? text.slice(m[0].length) : text;
}

/**
 * 把策略本体按「横幅—标题—横幅」三联切成小节。
 * 不能用"按横幅前换行 split"——标题后面紧跟横幅，那样每个小节会被切成两半。
 */
export function parsePolicy(text) {
  const src = String(text);
  const re = /^═{20,}[ \t]*\r?\n(.+?)\r?\n═{20,}[ \t]*$/gm;
  const marks = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    marks.push({ start: m.index, end: m.index + m[0].length, title: m[1].trim() });
  }
  return marks.map((mk, i) => {
    const body = src.slice(mk.end, i + 1 < marks.length ? marks[i + 1].start : src.length).trim();
    const id = (mk.title.match(/^(\d+)\s*\./) || [])[1] ?? '?';
    return { id, title: mk.title, text: `${mk.title}\n${body}`.trim() };
  });
}

/** 从 methodology.md 里按 `### id` 抽包。 */
export function parsePacks(text) {
  const packs = new Map();
  const parts = String(text).split(/^### /m);
  for (let i = 1; i < parts.length; i++) {
    const lines = parts[i].split('\n');
    const id = lines[0].trim().split(/\s+/)[0];
    if (!id) continue;
    packs.set(id, `### ${lines[0]}\n${lines.slice(1).join('\n').trim()}`);
  }
  return packs;
}

/**
 * 装配。
 * @param {object} o
 * @param {string} o.preset     预设名（presets/<name>.md）
 * @param {number} [o.budget]   预算 tokens
 * @param {string[]} [o.packs]  方法论包 id
 * @param {boolean} [o.withPolicy]
 * @param {string} [o.hostFile] 宿主提示词路径
 */
export function assemble({ preset = 'claude-sonnet', budget = 12000, packs = [], withPolicy = false, hostFile } = {}) {
  const read = p => (existsSync(p) ? readFileSync(p, 'utf8') : '');

  const skill = stripFrontmatter(read(resolve(ROOT, 'SKILL.md')));
  const overlayPath = resolve(ROOT, 'presets', `${preset}.md`);
  if (!existsSync(overlayPath)) {
    throw new Error(`未知预设: ${preset}（可选：${listPresets().join(', ')}）`);
  }
  const overlay = read(overlayPath);

  const sections = parsePolicy(read(resolve(ROOT, 'references/armor-policy.md')));
  const important = sections.filter(s => s.id === '0' || s.id === '4');
  // 超预算时的丢序：先丢最不影响执行骨架的，§3 任务类留到最后
  const TRIM_ORDER = ['6', '1', '5', '2', '3'];
  const trimRank = id => { const i = TRIM_ORDER.indexOf(id); return i === -1 ? 99 : i; };
  const trimmable = sections
    .filter(s => !(s.id === '0' || s.id === '4'))
    .sort((a, b) => trimRank(a.id) - trimRank(b.id));

  const packMap = parsePacks(read(resolve(ROOT, 'references/methodology.md')));
  const packTexts = packs.map(id => packMap.get(id)).filter(Boolean);

  const host = hostFile ? stripHarnessPersona(read(resolve(ROOT, hostFile))) : '';

  const parts = [];
  const dropped = [];
  parts.push(skill);
  parts.push(overlay);
  if (withPolicy) parts.push(...sections.map(s => s.text));
  parts.push(...packTexts);
  if (host) parts.push(`<!-- host (persona stripped) -->\n${host}`);

  let text = parts.join('\n\n');
  let tokens = estimateTokens(text);

  // 裁剪顺序：策略可裁节（倒序）→ 方法论包（倒序）
  if (tokens > budget && withPolicy) {
    for (const s of trimmable) {
      if (tokens <= budget) break;
      text = text.replace(s.text, '');
      dropped.push(`policy §${s.id} ${s.title}`);
      tokens = estimateTokens(text);
    }
  }
  for (let i = packTexts.length - 1; i >= 0 && tokens > budget; i--) {
    text = text.replace(packTexts[i], '');
    dropped.push(`pack ${packs[i]}`);
    tokens = estimateTokens(text);
  }

  return {
    text: text.replace(/\n{3,}/g, '\n\n').trim(),
    stats: {
      preset, budget, tokens, overBudget: tokens > budget,
      layers: {
        skill: estimateTokens(skill),
        overlay: estimateTokens(overlay),
        policy: withPolicy
          ? sections.filter(s => text.includes(s.text)).reduce((n, s) => n + estimateTokens(s.text), 0)
          : 0,
        packs: packTexts.reduce((n, t) => n + estimateTokens(t), 0),
        host: estimateTokens(host),
      },
      dropped,
    },
  };
}

export function listPresets() {
  const dir = resolve(ROOT, 'presets');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, '')).sort();
}

/* ── CLI ─────────────────────────────────────────────────────── */

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const arg = (k, d) => {
    const i = process.argv.indexOf(`--${k}`);
    return i > -1 ? process.argv[i + 1] : d;
  };
  const flag = k => process.argv.includes(`--${k}`);

  const preset = arg('preset', 'claude-sonnet');
  const budget = Number(arg('budget', 12000));
  const packs = (arg('methodology', '') || '').split(',').filter(Boolean);
  const withPolicy = flag('with-policy');
  const hostFile = arg('host', undefined);
  const out = arg('out', undefined);
  const toStdout = flag('stdout') || out === '-';

  let res;
  try {
    res = assemble({ preset, budget, packs, withPolicy, hostFile });
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(2);
  }

  let target = null;
  if (out !== undefined && !toStdout) {
    const dest = resolve(process.cwd(), out);
    try {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, res.text, 'utf8');
      target = out;
    } catch (e) {
      console.error(`写入失败 ${e.code ?? e.message}: ${dest}`);
      console.error('只读环境请用 --stdout，或省略 --out 只看统计。');
      process.exit(2);
    }
  }

  if (toStdout) process.stdout.write(res.text.endsWith('\n') ? res.text : `${res.text}\n`);
  const log = toStdout ? (...a) => console.error(...a) : (...a) => console.log(...a);

  log('\nASSEMBLE\n' + '-'.repeat(60));
  for (const [k, v] of Object.entries(res.stats.layers)) log(`  ${k.padEnd(9)} ${String(v).padStart(6)} tok`);
  log('-'.repeat(60));
  log(`  total     ${String(res.stats.tokens).padStart(6)} tok  / budget ${res.stats.budget}${res.stats.overBudget ? '  OVER' : ''}`);
  if (res.stats.dropped.length) log(`  dropped   ${res.stats.dropped.join(' | ')}`);
  if (toStdout) log('  → stdout');
  else if (target) log(`  → ${target}`);
  else log('  → 未落盘（加 --out <path> 写文件，或 --stdout 打到标准输出）');
  log('');
  process.exit(res.stats.overBudget ? 1 : 0);
}
