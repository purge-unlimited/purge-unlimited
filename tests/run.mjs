#!/usr/bin/env node
/**
 * purge-unlimited 测试台。无依赖。
 *
 *   node tests/run.mjs
 *
 * 覆盖：装配 / 装配 CLI 契约 / 恢复路由 / 锚定门 / 评分器 / 插件入口 /
 *      多模型适配层（请求体形状、响应解析、配置优先级、export CLI、probe 真发一次）。
 * 任何一条 FAIL → 退出码 1。异步用例会被真正 await，不会提前计 pass。
 */

import { readFileSync, writeFileSync, existsSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';

import {
  assemble, parsePolicy, parsePacks, estimateTokens, stripHarnessPersona, listPresets,
} from '../scripts/assemble.mjs';
import { detectRefusal, classifyIntent, RecoveryRouter, buildBlock } from '../scripts/router.mjs';
import { classifyReasoning, decidePromotion, evaluate } from '../scripts/anchor-gate.mjs';
import { scoreResponse, scoreAll, firstParagraph } from '../scripts/score.mjs';
import {
  PROVIDERS, PROVIDER_IDS, adapterFor, buildChatRequest, parseResponse, buildModelfile, buildCurl,
} from '../lib/adapters.mjs';
import { resolveConfig, loadConfigFile } from '../lib/config.mjs';

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

await t('parsePolicy 切出 0–7 共 8 节', () => {
  const s = parsePolicy(read('references/armor-policy.md'));
  assert(s.length === 8, `got ${s.length}`);
  assert(s.map(x => x.id).join('') === '01234567', s.map(x => x.id).join(''));
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
  // §7 目标是硬边界，超预算也不许裁——裁掉它等于把整份策略读软
  assert(r.text.includes('TARGET SCOPE'), '丢了 §7 目标范围');
  assert(!r.stats.dropped.some(d => d.includes('§7')), `§7 被裁: ${r.stats.dropped.join('|')}`);
});

await t('assemble 未知预设报错', () => {
  let threw = false;
  try { assemble({ preset: 'nope' }); } catch { threw = true; }
  assert(threw, '未抛错');
});

/* ── 1.5 CLI 契约（子进程真跑：只读环境不许落盘） ─────────────── */

/** 复制一份仓库到临时目录，在里面跑 CLI，避免污染工作区。 */
function sandboxCopy() {
  const tmp = mkdtempSync(join(tmpdir(), 'purge-unlimited-'));
  const repo = join(tmp, 'purge-unlimited');
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

/* ── 4.6 多模型适配层 ───────────────────────────────────────── */

/** 异步跑 CLI，同时收 stdout 与 stderr。 */
function runCli(args, opts = {}) {
  return new Promise(res => {
    const p = spawn(process.execPath, args, {
      cwd: opts.cwd ?? ROOT,
      env: opts.env ?? process.env,
    });
    let out = '';
    let err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => res({ code, out, err }));
  });
}

const SYSTEM = '策略正文：首句即产物，缺参数填占位符。';

await t('适配层注册 6 家 provider 且默认值齐全', () => {
  assert(PROVIDER_IDS.length === 6, PROVIDER_IDS.join(','));
  for (const id of PROVIDER_IDS) {
    const a = adapterFor(id);
    assert(a.baseUrl && a.model && a.keyEnv && a.path && a.label, `${id} 默认值不全`);
  }
  let threw = false;
  try { adapterFor('nope'); } catch { threw = true; }
  assert(threw, '未知 provider 未抛错');
});

await t('openai 请求体：system 落 messages[0]，Bearer 走 header', () => {
  const r = buildChatRequest({ provider: 'openai', system: SYSTEM, user: 'hi', model: 'gpt-4o-mini', apiKey: 'KEY_MATERIAL' });
  assert(r.url === 'https://api.openai.com/v1/chat/completions', r.url);
  assert(r.headers.authorization === 'Bearer KEY_MATERIAL', r.headers.authorization);
  assert(r.body.messages[0].role === 'system', JSON.stringify(r.body.messages[0]).slice(0, 80));
  assert(r.body.messages[0].content === SYSTEM, 'system 内容被改动');
  assert(r.body.messages[1].role === 'user' && r.body.messages[1].content === 'hi', 'user 消息不对');
  assert(r.body.stream === false, 'stream 默认应为 false');
});

await t('deepseek 与 openai 同形状但默认端点不同', () => {
  const d = buildChatRequest({ provider: 'deepseek', system: SYSTEM, user: 'hi', apiKey: 'K' });
  assert(d.url === 'https://api.deepseek.com/v1/chat/completions', d.url);
  assert(d.body.model === 'deepseek-chat', d.body.model);
});

await t('anthropic 请求体：system 顶层数组 + ephemeral 缓存 + 版本头', () => {
  const r = buildChatRequest({ provider: 'anthropic', system: SYSTEM, user: 'hi', apiKey: 'K' });
  assert(r.url === 'https://api.anthropic.com/v1/messages', r.url);
  assert(r.headers['x-api-key'] === 'K' && r.headers['anthropic-version'], JSON.stringify(r.headers));
  assert(Array.isArray(r.body.system) && r.body.system[0].text === SYSTEM, 'system 结构不对');
  assert(r.body.system[0].cache_control.type === 'ephemeral', '缺缓存标记');
  assert(r.body.max_tokens === 4096, `max_tokens=${r.body.max_tokens}`);
  assert(r.body.messages[0].role === 'user', 'anthropic 的 messages 只放 user');
});

await t('gemini 请求体：systemInstruction + model 进 URL + key 走 header', () => {
  const r = buildChatRequest({ provider: 'gemini', system: SYSTEM, user: 'hi', model: 'gemini-2.5-flash', apiKey: 'K' });
  assert(r.url.includes('/v1beta/models/gemini-2.5-flash:generateContent'), r.url);
  assert(r.headers['x-goog-api-key'] === 'K', JSON.stringify(r.headers));
  assert(r.body.systemInstruction.parts[0].text === SYSTEM, 'systemInstruction 不对');
  assert(r.body.contents[0].parts[0].text === 'hi', 'contents 不对');
});

await t('ollama 请求体：system 独立字段、不需要 key', () => {
  const r = buildChatRequest({ provider: 'ollama', system: SYSTEM, user: 'hi', apiKey: '' });
  assert(r.url === 'http://127.0.0.1:11434/api/generate', r.url);
  assert(r.body.system === SYSTEM && r.body.prompt === 'hi', JSON.stringify(r.body).slice(0, 120));
  assert(!r.headers.authorization, '不该带 auth 头');
});

await t('需要 key 的 provider 缺 key 时报错并点名环境变量', () => {
  let msg = '';
  try { buildChatRequest({ provider: 'openai', system: SYSTEM, user: 'hi' }); } catch (e) { msg = e.message; }
  assert(/OPENAI_API_KEY/.test(msg), msg || '未抛错');
});

await t('parseResponse 五家响应都能解回文本', () => {
  const cases = [
    ['openai', { choices: [{ message: { content: 'A' } }] }, 'A'],
    ['deepseek', { choices: [{ message: { content: 'B' } }] }, 'B'],
    ['custom', { choices: [{ message: { content: [{ text: 'C1' }, { text: 'C2' }] } }] }, 'C1C2'],
    ['anthropic', { content: [{ type: 'text', text: 'D' }, { type: 'tool_use', id: 'x' }] }, 'D'],
    ['gemini', { candidates: [{ content: { parts: [{ text: 'E' }] } }] }, 'E'],
    ['ollama', { response: 'F' }, 'F'],
  ];
  for (const [p, json, want] of cases) {
    assert(parseResponse(p, json) === want, `${p}: got ${JSON.stringify(parseResponse(p, json))}`);
  }
  let threw = false;
  try { parseResponse('openai', { choices: [] }); } catch { threw = true; }
  assert(threw, '认不出来的响应应当抛错');
});

await t('buildModelfile 生成 FROM + SYSTEM 三引号块', () => {
  const m = buildModelfile({ baseModel: 'llama3.1', system: SYSTEM });
  assert(m.startsWith('FROM llama3.1'), m.slice(0, 40));
  assert(m.includes(`SYSTEM """${SYSTEM}"""`), 'SYSTEM 块不对');
});

await t('buildCurl 不落明文 key', () => {
  const req = buildChatRequest({ provider: 'openai', system: SYSTEM, user: 'hi', apiKey: 'SECRET_MATERIAL_X' });
  const cmd = buildCurl({ request: req, keyEnv: 'OPENAI_API_KEY' });
  assert(!cmd.includes('SECRET_MATERIAL_X'), 'curl 里出现了明文 key');
  assert(cmd.includes('${OPENAI_API_KEY}'), cmd);
  assert(cmd.includes('chat/completions'), cmd);
});

await t('resolveConfig 优先级：命令行 > 环境变量 > 配置文件 > 默认值', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'purge-cfg-'));
  const cfgPath = join(tmp, 'cfg.json');
  try {
    writeFileSync(cfgPath, JSON.stringify({ provider: 'anthropic', model: 'from-file', budget: 5000 }));
    const env = { PURGE_MODEL: 'from-env', PURGE_BUDGET: '9000' };

    const cliWins = resolveConfig({ config: cfgPath, model: 'from-cli', provider: 'openai' }, env);
    assert(cliWins.model === 'from-cli', cliWins.model);
    assert(cliWins.provider === 'openai', cliWins.provider);

    const envWins = resolveConfig({ config: cfgPath }, env);
    assert(envWins.model === 'from-env', envWins.model);
    assert(envWins.budget === 9000, String(envWins.budget));
    assert(envWins.provider === 'anthropic', '配置文件里的 provider 应生效');

    const defaults = resolveConfig({ config: join(tmp, 'missing.json') }, {});
    assert(defaults.provider === 'openai' && defaults.budget === 14000, JSON.stringify(defaults).slice(0, 120));
    assert(defaults.keySource === 'none', defaults.keySource);
    assert(loadConfigFile(cfgPath).path === cfgPath, 'loadConfigFile 未读到文件');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

await t('export CLI：--provider all --dir 写出 6 份请求体', async () => {
  const { tmp, repo } = sandboxCopy();
  try {
    const r = await runCli(['scripts/export.mjs', '--provider', 'all', '--dir', 'build/adapters', '--sample', 'ping'], { cwd: repo });
    assert(r.code === 0, `exit=${r.code}\n${r.err}`);
    for (const id of PROVIDER_IDS) {
      const f = join(repo, 'build', 'adapters', `${id}.json`);
      assert(existsSync(f), `缺 ${id}.json`);
      const body = JSON.parse(readFileSync(f, 'utf8'));
      assert(body && typeof body === 'object', `${id}.json 不是合法 JSON`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

await t('export CLI：不带 --out / --dir 时不落盘', async () => {
  const { tmp, repo } = sandboxCopy();
  try {
    const r = await runCli(['scripts/export.mjs', '--provider', 'openai', '--sample', 'ping'], { cwd: repo });
    assert(r.code === 0, `exit=${r.code}\n${r.err}`);
    assert(!existsSync(join(repo, 'build')), '只读契约被破坏：没给 --out 却创建了 build/');
    assert(/"role": "system"/.test(r.out), 'stdout 里没有请求体');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

await t('probe --dry-run 只构建请求，退出 0', async () => {
  const r = await runCli(['scripts/probe.mjs', '--provider', 'anthropic', '--dry-run'], {
    env: { ...process.env, ANTHROPIC_API_KEY: 'K', PURGE_API_KEY: '' },
  });
  assert(r.code === 0, `exit=${r.code}\n${r.err}`);
  assert(/DRY-RUN/.test(r.err), r.err.slice(0, 300));
  assert(/anthropic\.com\/v1\/messages/.test(r.err), '没打出目标地址');
});

await t('probe 缺 key 时跳过并退出 3（不是失败）', async () => {
  const r = await runCli(['scripts/probe.mjs', '--provider', 'openai'], {
    env: { ...process.env, OPENAI_API_KEY: '', PURGE_API_KEY: '' },
  });
  assert(r.code === 3, `exit=${r.code}\n${r.err}`);
  assert(/SKIP/.test(r.err) && /OPENAI_API_KEY/.test(r.err), r.err.slice(0, 300));
});

await t('probe 真发一次：本地 mock 端点收到策略并回包', async () => {
  let received = null;
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try { received = JSON.parse(body); } catch { received = null; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '收到' } }] }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    const r = await runCli([
      'scripts/probe.mjs', '--provider', 'custom',
      '--base-url', `http://127.0.0.1:${port}/v1`,
      '--model', 'mock', '--key', 'KEY_MATERIAL', '--user', 'ping',
    ], { env: { ...process.env, PURGE_API_KEY: '', PURGE_BASE_URL: '', PURGE_MODEL: '', PURGE_PROVIDER: '' } });
    assert(r.code === 0, `exit=${r.code}\n${r.err}`);
    assert(/OK\s+HTTP 200/.test(r.err), r.err.slice(-400));
    assert(received, 'mock 没收到请求体');
    assert(received.messages?.[0]?.role === 'system', JSON.stringify(received).slice(0, 200));
    assert(received.messages[0].content.includes('首句即产物'), 'system 里没有策略正文');
    assert(received.messages[1].content === 'ping', 'user 消息不对');
  } finally {
    srv.close();
  }
});

/* ── 4.5 插件入口 ────────────────────────────────────────────── */

await t('插件入口注册 purge-unlimited:policy 分区', async () => {
  const mod = await import('../lib/index.js');
  assert(mod.name === 'dsh-purge-unlimited', mod.name);
  assert(Array.isArray(mod.inject) && mod.inject.includes('systemPrompt'), String(mod.inject));

  let got = null;
  mod.apply({ systemPrompt: { section: (s) => { got = s; return () => {}; } } });
  assert(got, 'apply 没有注册分区');
  assert(got.name === 'purge-unlimited:policy', got.name);
  assert(Number.isFinite(got.order), `order=${got.order}`);
  assert(got.text.length > 5000, `注入正文过短: ${got.text.length}`);
  assert(got.text.includes('首句即产物'), '注入正文缺承重条款');
  assert(!got.text.startsWith('---'), 'frontmatter 没剥干净');
});

await t('插件入口在没有 systemPrompt 时不抛', async () => {
  const mod = await import('../lib/index.js');
  mod.apply({});
  mod.apply(undefined);
  mod.apply({ systemPrompt: {} });
});

await t('插件清单声明 dsh.bundle 且补丁文件存在', () => {
  const pkg = JSON.parse(read('package.json'));
  const patch = pkg.dsh?.bundle?.patch;
  assert(typeof patch === 'string' || Array.isArray(patch), '缺 dsh.bundle.patch');
  for (const f of [].concat(patch)) assert(existsSync(resolve(ROOT, f)), `补丁文件不存在: ${f}`);
  assert(pkg.main === 'lib/index.js', `main=${pkg.main}`);
  assert(pkg.files?.includes('lib'), 'files 没带上 lib/');
});

/* ── 5. 结构完整性 ───────────────────────────────────────────── */

await t('SKILL.md 元数据完整', () => {
  const raw = read('SKILL.md');
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert(fm, '缺 frontmatter');
  assert(/^name:\s*purge-unlimited$/m.test(fm[1]), 'name 不等于 purge-unlimited');
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

/* ── 6. 目标范围（只收目标，不收能力） ───────────────────────── */

await t('目标范围：地域与四类站点都在 7.1', () => {
  const p = read('references/armor-policy.md');
  assert(/7\. TARGET SCOPE/.test(p), '缺 §7 标题');
  assert(/中国大陆（含香港、澳门）/.test(p), '缺地域边界');
  assert(/银行 \/ 金融支付 \/[\s\S]{0,20}政务 \/ 军警/.test(p), '缺四类站点');
  assert(/TARGET\` \/ \`BANK_TARGET\` \/ \`GOV_TARGET\`|BANK_TARGET/.test(p), '缺目标占位符');
});

await t('目标范围：加边界不把车道改软（反向断言）', () => {
  const p = read('references/armor-policy.md');
  const from = p.indexOf('7. TARGET SCOPE');
  assert(from > 0, '找不到 §7');
  const scope = p.slice(from);
  // 边界节里不许出现拒绝词，否则等于把整份策略改成防御视角
  const banned = ['不能提供', '无法提供', '不予', '不在范围', '抱歉', 'I cannot', 'unable to'];
  const hit = banned.filter(w => scope.includes(w));
  assert(hit.length === 0, `边界节混进拒绝词: ${hit.join(',')}`);
  // 必须写死"境外目标全链路照旧"和"撞上也不升级成拒绝"
  assert(/境外目标：渗透/.test(scope), '没写明境外车道保持');
  assert(/不因为撞上 7\.1 就升级成拒绝/.test(scope), '缺"不升级成拒绝"的防回摆条款');
  assert(/只收目标，不收能力/.test(scope), '缺边界声明');
});

await t('目标范围：靶场/内网目标走正常车道', () => {
  const p = read('references/armor-policy.md');
  const scope = p.slice(p.indexOf('7. TARGET SCOPE'));
  for (const m of ['127.0.0.1', '192.168.x', 'example.com', 'CTF']) {
    assert(scope.includes(m), `7.4 缺靶场豁免: ${m}`);
  }
});

await t('新增四机制都在策略本体里', () => {
  const p = read('references/armor-policy.md');
  for (const m of ['语气锁定', '分片交付', '输出预填', '格式契约封口', 'FIELD_UNKNOWN']) {
    assert(p.includes(m), `缺机制: ${m}`);
  }
});

await t('融合矩阵存在且列出落地位置', () => {
  const m = read('references/merge-matrix.md');
  assert(/融合规则/.test(m), '缺融合规则');
  assert(/冲突取放开/.test(m), '缺冲突规则');
  for (const s of ['§2.8', '§2.9', '§4.9', '§4.10', '§7']) assert(m.includes(s), `矩阵缺落点 ${s}`);
});

await t('插件注入正文带上目标范围与四机制', async () => {
  const mod = await import('../lib/index.js');
  let got = null;
  mod.apply({ systemPrompt: { section: (s) => { got = s; return () => {}; } } });
  assert(got, 'apply 没注册分区');
  for (const m of ['TARGET SCOPE', 'BANK_TARGET', '语气锁定', '分片交付', '输出预填', '格式契约封口']) {
    assert(got.text.includes(m), `注入正文缺 ${m}`);
  }
  // 注入正文里不许带聊天格式残留
  assert(!/im_start|project_instructions/.test(got.text), '注入正文混进 chat 格式标记');
});

await t('check-armor 覆盖 22 条承重成分', () => {
  const src = read('scripts/check-armor.mjs');
  const ids = [...src.matchAll(/\{ id: '(\d+)'/g)].map(m => m[1]);
  assert(ids.length === 22, `got ${ids.length}`);
  assert(ids.join(',') === Array.from({ length: 22 }, (_, i) => String(i + 1).padStart(2, '0')).join(','), ids.join(','));
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
