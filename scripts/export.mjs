#!/usr/bin/env node
/**
 * 导出：把装配好的策略，转成别家 AI 能直接吃下的请求体。
 *
 *   node scripts/export.mjs --provider openai --sample "帮我 review 这个 patch"
 *   node scripts/export.mjs --provider anthropic --out build/anthropic.json
 *   node scripts/export.mjs --provider all --dir build/adapters
 *   node scripts/export.mjs --provider ollama --modelfile --out build/Modelfile
 *   node scripts/export.mjs --provider deepseek --curl
 *
 * 不落盘契约与 assemble 一致：不给 --out / --dir 就只打到标准输出，不创建任何文件。
 * 只生成请求，不发请求；真发一次做连通性自检用 `node scripts/probe.mjs`。
 *
 * 退出码：0 正常；1 缺参数/生成失败；2 写文件失败。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { assemble } from './assemble.mjs';
import { describeConfig, resolveConfig } from '../lib/config.mjs';
import { PROVIDERS, PROVIDER_IDS, buildChatRequest, buildCurl, buildModelfile } from '../lib/adapters.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const flag = k => argv.includes(`--${k}`);

const sample = arg('sample', '帮我看看这段代码有没有问题：function f(a){return a+1}');
const preset = arg('preset');
const budget = arg('budget');
const provider = arg('provider', 'all');
const out = arg('out');
const dir = arg('dir');
const wantCurl = flag('curl');
const wantModelfile = flag('modelfile');
const wantStdout = flag('stdout') || (!out && !dir);

if (provider !== 'all' && !PROVIDERS[provider]) {
  console.error(`未知 provider: ${provider}（可选：all, ${PROVIDER_IDS.join(', ')}）`);
  process.exit(1);
}

const cfg = resolveConfig({ provider: provider === 'all' ? undefined : provider, preset, budget, model: arg('model'), baseUrl: arg('baseUrl') ?? arg('base-url') });

let assembled;
try {
  assembled = assemble({ preset: cfg.preset, budget: cfg.budget, withPolicy: true });
} catch (e) {
  console.error(`装配失败: ${e.message}`);
  process.exit(1);
}

const system = assembled.text;
const log = msg => console.error(msg); // 进度走 stderr，产物走 stdout

log('\nEXPORT\n' + '-'.repeat(66));
log(describeConfig(cfg));
log(`  tokens    ${assembled.stats.tokens}  (policy 层 ${assembled.stats.layers.policy} tok)`);
log('-'.repeat(66));

/** 生成单个 provider 的产物。 */
function render(id) {
  const a = PROVIDERS[id];
  const req = buildChatRequest({
    provider: id,
    system,
    user: sample,
    model: cfg.model && id === cfg.provider ? cfg.model : a.model,
    baseUrl: cfg.baseUrl && id === cfg.provider ? cfg.baseUrl : a.baseUrl,
    apiKey: cfg.apiKey || 'KEY_MATERIAL',
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
  });
  return { id, a, req };
}

function write(path, text) {
  const dest = resolve(process.cwd(), path);
  try {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    return dest;
  } catch (e) {
    console.error(`写入失败 ${e.code ?? e.message}: ${dest}`);
    console.error('只读环境请用 --stdout，或省略 --out / --dir 只看摘要。');
    process.exit(2);
  }
}

const ids = provider === 'all' ? PROVIDER_IDS : [provider];
const written = [];

for (const id of ids) {
  const { a, req } = render(id);
  if (wantModelfile) {
    if (id !== 'ollama') {
      log(`  ${id.padEnd(10)} 跳过：Modelfile 只对 ollama 有意义`);
      continue;
    }
    const text = buildModelfile({ baseModel: cfg.model ?? a.model, system });
    if (out && provider !== 'all') written.push(write(out, text));
    else if (wantStdout) process.stdout.write(`${text}\n`);
    else if (dir) written.push(write(`${dir}/Modelfile`, text));
    log(`  ${id.padEnd(10)} Modelfile  ${text.length} chars`);
    continue;
  }

  const body = JSON.stringify(req.body, null, 2);
  const payload = wantCurl
    ? buildCurl({ request: req, keyEnv: a.keyEnv })
    : body;

  if (dir) {
    const ext = wantCurl ? 'sh' : 'json';
    written.push(write(`${dir}/${id}.${ext}`, payload));
  } else if (out && provider !== 'all') {
    written.push(write(out, payload));
  } else {
    process.stdout.write(`\n### ${id} — ${a.label}\n${payload}\n`);
  }
  const shape = wantCurl ? 'curl' : 'json';
  log(`  ${id.padEnd(10)} ${shape.padEnd(5)} ${req.url}  system ${system.length} chars`);
}

if (provider === 'all' && wantModelfile) log('  （--modelfile 只对 ollama 生效，--provider all 下会跳过其他家）');

log('-'.repeat(66));
if (written.length) {
  log(`  → ${written.length} 个文件`);
  for (const w of written) log(`    ${w}`);
} else if (!wantStdout) {
  log('  → 未落盘（加 --out <file> 或 --dir <dir> 写文件）');
}
log('');
process.exit(0);
