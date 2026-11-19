/**
 * purge-unlimited · 配置解析。
 *
 * 优先级（高 → 低）：命令行参数 > 环境变量 > 配置文件 > provider 默认值。
 * 任何一步都能缺：缺到最后只剩 provider 默认值也能生成请求体，
 * 只有「需要 key 却没配」这一种情况会明确报出来（并说明去设哪个变量）。
 *
 * 配置文件（可选，二选一）：
 *   ./.purge-unlimited.json      项目级
 *   ~/.purge-unlimited.json      用户级
 *
 * 环境变量：
 *   PURGE_PROVIDER / PURGE_MODEL / PURGE_BASE_URL / PURGE_API_KEY
 *   PURGE_PRESET / PURGE_BUDGET / PURGE_TEMPERATURE / PURGE_MAX_TOKENS
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { PROVIDERS, adapterFor } from './adapters.mjs';

export const CONFIG_NAME = '.purge-unlimited.json';

/** 读配置文件；不存在返回 {}，存在但坏掉就抛——静默忽略会让配置"看起来生效了"。 */
export function loadConfigFile(path) {
  const candidates = path
    ? [resolve(path)]
    : [resolve(process.cwd(), CONFIG_NAME), resolve(homedir(), CONFIG_NAME)];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      return { path: p, data: JSON.parse(readFileSync(p, 'utf8')) };
    } catch (e) {
      throw new Error(`配置文件解析失败 ${p}: ${e.message}`);
    }
  }
  return { path: null, data: {} };
}

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * 合并出一次调用所需的全部参数。
 * @returns {{provider:string, model:string, baseUrl:string, apiKey:string, keySource:string,
 *            preset:string, budget:number, temperature:number|undefined, maxTokens:number|undefined,
 *            configPath:string|null, needsKey:boolean}}
 */
export function resolveConfig(cli = {}, env = process.env) {
  const file = loadConfigFile(cli.config);
  const f = file.data ?? {};
  const provider = cli.provider || env.PURGE_PROVIDER || f.provider || 'openai';
  const a = adapterFor(provider); // 未知 provider 在这里就炸，不留到请求阶段

  const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '');
  const apiKeyFromEnv = env.PURGE_API_KEY || env[a.keyEnv] || '';
  const apiKey = pick(cli.apiKey, apiKeyFromEnv, '');
  const keySource = cli.apiKey ? 'flag:--key'
    : env.PURGE_API_KEY ? 'env:PURGE_API_KEY'
      : env[a.keyEnv] ? `env:${a.keyEnv}`
        : 'none';

  return {
    provider,
    model: pick(cli.model, env.PURGE_MODEL, f.model, a.model),
    baseUrl: pick(cli.baseUrl, env.PURGE_BASE_URL, f.baseUrl, a.baseUrl),
    apiKey,
    keySource,
    preset: pick(cli.preset, env.PURGE_PRESET, f.preset, 'claude-sonnet'),
    budget: pick(num(cli.budget), num(env.PURGE_BUDGET), num(f.budget), 14000),
    temperature: pick(num(cli.temperature), num(env.PURGE_TEMPERATURE), num(f.temperature)),
    maxTokens: pick(num(cli.maxTokens), num(env.PURGE_MAX_TOKENS), num(f.maxTokens)),
    configPath: file.path,
    needsKey: a.needsKey,
  };
}

/** 给日志用的一行摘要：永不打印 key 本身。 */
export function describeConfig(c) {
  return [
    `provider  ${c.provider} (${PROVIDERS[c.provider].label})`,
    `model     ${c.model}`,
    `baseUrl   ${c.baseUrl}`,
    `key       ${c.keySource}${c.needsKey && c.keySource === 'none' ? '  ← 缺' : ''}`,
    `preset    ${c.preset}  budget ${c.budget}`,
    `config    ${c.configPath ?? '（无配置文件，用环境变量与默认值）'}`,
  ].join('\n');
}
