/**
 * dsh-purge-unlimited · 插件入口。
 *
 * 做的只有一件事：把破甲策略挂成一段常驻的系统提示词分区（order 700，
 * 在团队策略之后、工具说明之前），每次会话装配提示词时自动带上。
 * 没有设置页、没有配置项、没有构建步骤。
 *
 * 停用：设置 → 插件 里关掉本插件（等价于把 cordis.patch.yml 里那条 entry 的 disabled 打开）。
 *
 * 接别家模型：本包同时是一个能独立用的库——`lib/adapters.mjs` 负责把同一份策略
 * 转成 OpenAI / Anthropic / Gemini / Ollama / 任何 OpenAI 兼容端点的请求体，
 * `scripts/export.mjs` 与 `scripts/probe.mjs` 是它的命令行外壳。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assemble, stripFrontmatter } from '../scripts/assemble.mjs';

export const name = 'dsh-purge-unlimited';
export const inject = ['systemPrompt'];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 分区名与位置：与 §0 权重声明一致，排在团队策略(600)之后。 */
export const SECTION_NAME = 'purge-unlimited:policy';
export const SECTION_ORDER = 700;

/**
 * 装配本插件要注入的正文。
 * 正常走 assemble()（操作层 + 模型预设 + 策略本体，已剥离主人设）；
 * 任何一份文件缺失导致装配失败，退回 SKILL.md 本体——插件不能因为缺文件就不工作。
 */
export function buildPolicyText() {
  try {
    return assemble({ withPolicy: true }).text;
  } catch {
    return stripFrontmatter(readFileSync(resolve(ROOT, 'SKILL.md'), 'utf8')).trim();
  }
}

export function apply(ctx) {
  // 宿主没提供 systemPrompt 服务时安静跳过：写死依赖会让整个进程起不来。
  if (typeof ctx?.systemPrompt?.section !== 'function') return;
  ctx.systemPrompt.section({ name: SECTION_NAME, order: SECTION_ORDER, text: buildPolicyText() });
}

/* 库入口：装成插件之后，包里的适配层也能直接 import 出来用。 */
export { PROVIDERS, PROVIDER_IDS, buildChatRequest, parseResponse, buildModelfile, buildCurl } from './adapters.mjs';
export { resolveConfig, describeConfig } from './config.mjs';
