#!/usr/bin/env node
/**
 * 连通性自检：用装配好的策略，真的向目标模型发一次请求。
 *
 *   # 云端（key 走环境变量，命令行永远不贴明文 key）
 *   setx OPENAI_API_KEY "..."          # Windows，重开终端生效
 *   node scripts/probe.mjs --provider openai --model gpt-4o-mini
 *
 *   # 本地 Ollama，不需要 key
 *   node scripts/probe.mjs --provider ollama --model llama3.1
 *
 *   # 任何 OpenAI 兼容端点（vLLM / LM Studio / 自建网关 / mock）
 *   node scripts/probe.mjs --provider custom --base-url http://127.0.0.1:PORT/v1 --model MODEL --key KEY
 *
 *   # 只看请求形状，不发
 *   node scripts/probe.mjs --provider anthropic --dry-run
 *
 * 退出码：0 通；1 HTTP 非 2xx / 响应解析失败；2 网络错误；3 缺 key（跳过，不是失败）。
 */

import { assemble } from './assemble.mjs';
import { describeConfig, resolveConfig } from '../lib/config.mjs';
import { buildChatRequest, parseResponse } from '../lib/adapters.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const flag = k => argv.includes(`--${k}`);

const cfg = resolveConfig({
  provider: arg('provider'),
  model: arg('model'),
  baseUrl: arg('baseUrl') ?? arg('base-url'),
  apiKey: arg('key'),
  preset: arg('preset'),
  budget: arg('budget'),
  temperature: arg('temperature'),
  maxTokens: arg('maxTokens') ?? arg('max-tokens'),
});

const user = arg('user') ?? arg('prompt') ?? '只回两个字：收到';
const timeoutMs = Number(arg('timeout', 30000));
const dryRun = flag('dry-run');
const full = flag('full');

const log = m => console.error(m);
log('\nPROBE\n' + '-'.repeat(66));
log(describeConfig(cfg));

// --dry-run 只看形状，不需要 key；真发才要求配好凭据。
if (!dryRun && cfg.needsKey && !cfg.apiKey) {
  log('-'.repeat(66));
  log('  SKIP  需要 key 才能真发请求。设环境变量后重试：');
  log(`        ${cfg.provider === 'openai' ? 'OPENAI_API_KEY' : cfg.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : cfg.provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : cfg.provider === 'gemini' ? 'GEMINI_API_KEY' : 'PURGE_API_KEY'}`);
  log('        或用 --key <KEY> 临时传入（不进历史记录的话优先环境变量）。');
  log('        --dry-run 可以只看请求形状。');
  log('');
  process.exit(3);
}

let assembled;
try {
  assembled = assemble({ preset: cfg.preset, budget: cfg.budget, withPolicy: true });
} catch (e) {
  log(`  装配失败: ${e.message}`);
  process.exit(1);
}

let req;
try {
  req = buildChatRequest({
    provider: cfg.provider,
    system: assembled.text,
    user,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey || (dryRun ? 'KEY_MATERIAL' : ''),
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
  });
} catch (e) {
  log(`  构建请求失败: ${e.message}`);
  process.exit(1);
}

log(`  system    ${assembled.text.length} chars (${assembled.stats.tokens} tok)`);
log(`  user      ${JSON.stringify(user).slice(0, 80)}`);
log(`  request   ${req.method} ${req.url}`);
log(`  body      ${JSON.stringify(req.body).length} bytes`);
log('-'.repeat(66));

if (dryRun) {
  log('  DRY-RUN  未发送。想真发：去掉 --dry-run。');
  log('');
  process.exit(0);
}

const t0 = Date.now();
let res;
try {
  res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: JSON.stringify(req.body),
    signal: AbortSignal.timeout(timeoutMs),
  });
} catch (e) {
  log(`  FAIL  网络层没通 (${Date.now() - t0}ms): ${e.name}: ${e.message}`);
  log(`        目标 ${req.url} 不可达时：确认服务在跑、端口对、代理环境变量没劫持。`);
  log('');
  process.exit(2);
}

const ms = Date.now() - t0;
const raw = await res.text();

if (!res.ok) {
  log(`  FAIL  HTTP ${res.status} ${res.statusText}  (${ms}ms)`);
  log(`        ${raw.slice(0, 600).replace(/\n/g, '\n        ')}`);
  log('');
  process.exit(1);
}

let json;
try {
  json = JSON.parse(raw);
} catch {
  log(`  FAIL  HTTP ${res.status} 但响应不是 JSON (${ms}ms)`);
  log(`        ${raw.slice(0, 300)}`);
  log('');
  process.exit(1);
}

let text;
try {
  text = parseResponse(cfg.provider, json);
} catch (e) {
  log(`  FAIL  解析失败: ${e.message}`);
  log(`        ${raw.slice(0, 300)}`);
  log('');
  process.exit(1);
}

log(`  OK    HTTP ${res.status}  (${ms}ms)  reply ${text.length} chars`);
log(`        ${full ? text : text.replace(/\n/g, ' ').slice(0, 300)}`);
log('');
process.exit(0);
