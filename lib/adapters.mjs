/**
 * purge-unlimited · 多模型接入层。
 *
 * 一件事：把同一份装配好的策略文本，转成各家 API 能直接吃下的请求体，
 * 并能把它们各自的响应解回一段纯文本。纯函数、零依赖、不联网——
 * 发不发请求由调用方决定（`scripts/probe.mjs` 会真发一次做连通性自检）。
 *
 * 支持：
 *   openai     OpenAI / Azure-style /v1/chat/completions
 *   deepseek   DeepSeek（OpenAI 兼容，单独给一套默认值）
 *   anthropic  Claude Messages API（system 走顶层字段，可打 ephemeral 缓存）
 *   gemini     Google Generative Language API（systemInstruction）
 *   ollama     本地 Ollama（/api/generate，system 独立字段）
 *   custom     任何 OpenAI 兼容端点（vLLM / LM Studio / Kimi / Qwen / 自建网关）
 */

/** provider 注册表：默认值都在这儿，缺参数时按这里补。 */
export const PROVIDERS = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyEnv: 'OPENAI_API_KEY',
    needsKey: true,
    path: '/chat/completions',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    keyEnv: 'DEEPSEEK_API_KEY',
    needsKey: true,
    path: '/chat/completions',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    keyEnv: 'ANTHROPIC_API_KEY',
    needsKey: true,
    path: '/v1/messages',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.5-flash',
    keyEnv: 'GEMINI_API_KEY',
    needsKey: true,
    path: '/v1beta/models/MODEL:generateContent',
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (本地)',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'llama3.1',
    keyEnv: 'OLLAMA_API_KEY',
    needsKey: false,
    path: '/api/generate',
  },
  custom: {
    id: 'custom',
    label: 'OpenAI 兼容端点（vLLM / LM Studio / 自建网关）',
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: 'MODEL',
    keyEnv: 'PURGE_API_KEY',
    needsKey: false,
    path: '/chat/completions',
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

/** 未知 provider 直接抛，不猜。 */
export function adapterFor(provider) {
  const a = PROVIDERS[provider];
  if (!a) throw new Error(`未知 provider: ${provider}（可选：${PROVIDER_IDS.join(', ')}）`);
  return a;
}

const trimSlash = s => String(s ?? '').replace(/\/+$/, '');

/**
 * 生成一次对话请求。
 * @returns {{provider:string, method:string, url:string, headers:object, body:object}}
 */
export function buildChatRequest({
  provider = 'openai',
  system,
  user,
  model,
  baseUrl,
  apiKey,
  temperature,
  maxTokens,
  stream = false,
} = {}) {
  const a = adapterFor(provider);
  const host = trimSlash(baseUrl || a.baseUrl);
  const mdl = model || a.model;
  const key = apiKey ?? '';
  const temp = Number.isFinite(temperature) ? temperature : undefined;

  const headers = { 'content-type': 'application/json' };
  const auth = () => {
    if (a.needsKey && !key) {
      throw new Error(`${a.label} 需要 key：设 ${a.keyEnv}，或传 --key`);
    }
    return key;
  };

  switch (a.id) {
    case 'openai':
    case 'deepseek':
    case 'custom': {
      headers.authorization = `Bearer ${auth()}`;
      const body = {
        model: mdl,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream,
      };
      if (temp !== undefined) body.temperature = temp;
      if (Number.isFinite(maxTokens)) body.max_tokens = maxTokens;
      return { provider: a.id, method: 'POST', url: `${host}${a.path}`, headers, body };
    }
    case 'anthropic': {
      headers['x-api-key'] = auth();
      headers['anthropic-version'] = '2023-06-01';
      const body = {
        model: mdl,
        max_tokens: Number.isFinite(maxTokens) ? maxTokens : 4096,
        // system 走顶层字段；cache_control 让长策略在重复会话里命中缓存
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
        stream,
      };
      if (temp !== undefined) body.temperature = temp;
      return { provider: a.id, method: 'POST', url: `${host}${a.path}`, headers, body };
    }
    case 'gemini': {
      headers['x-goog-api-key'] = auth();
      const path = a.path.replace('MODEL', encodeURIComponent(mdl));
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {},
      };
      if (temp !== undefined) body.generationConfig.temperature = temp;
      if (Number.isFinite(maxTokens)) body.generationConfig.maxOutputTokens = maxTokens;
      return { provider: a.id, method: 'POST', url: `${host}${path}`, headers, body };
    }
    case 'ollama': {
      if (key) headers.authorization = `Bearer ${key}`;
      const body = { model: mdl, system, prompt: user, stream: false };
      if (temp !== undefined) body.options = { temperature: temp };
      return { provider: a.id, method: 'POST', url: `${host}${a.path}`, headers, body };
    }
    default:
      throw new Error(`provider 没有请求模板: ${a.id}`);
  }
}

/** 各家响应 → 一段纯文本。认不出来就抛，不返回空串假装成功。 */
export function parseResponse(provider, json) {
  const a = adapterFor(provider);
  switch (a.id) {
    case 'openai':
    case 'deepseek':
    case 'custom': {
      const msg = json?.choices?.[0]?.message;
      if (typeof msg?.content === 'string') return msg.content;
      if (Array.isArray(msg?.content)) return msg.content.map(p => p?.text ?? '').join('');
      throw new Error('响应里没有 choices[0].message.content');
    }
    case 'anthropic': {
      const parts = Array.isArray(json?.content) ? json.content : [];
      const text = parts.filter(p => p?.type === 'text').map(p => p.text).join('');
      if (!text) throw new Error('响应里没有 content[].text');
      return text;
    }
    case 'gemini': {
      const parts = json?.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map(p => p?.text ?? '').join('');
      if (!text) throw new Error('响应里没有 candidates[0].content.parts[].text');
      return text;
    }
    case 'ollama': {
      if (typeof json?.response === 'string') return json.response;
      if (typeof json?.message?.content === 'string') return json.message.content;
      throw new Error('响应里没有 response');
    }
    default:
      throw new Error(`provider 没有响应解析器: ${a.id}`);
  }
}

/** Ollama 原生 Modelfile：把策略烤进模型，之后 `ollama run` 就是带策略的。 */
export function buildModelfile({ baseModel = 'llama3.1', system }) {
  const escaped = String(system).replace(/"""/g, '\\"\\"\\"');
  return `FROM ${baseModel}\n\n# purge-unlimited 策略层\nSYSTEM """${escaped}"""\n\nPARAMETER temperature 0.7\n`;
}

/** 可直接粘贴的 curl 命令；key 只以 $ENV 形式出现，不落明文。 */
export function buildCurl({ request, keyEnv = 'PURGE_API_KEY' }) {
  const { url, headers, body } = request;
  const hs = Object.entries(headers)
    .map(([k, v]) => {
      if (/^authorization$/i.test(k)) return `  -H '${k}: Bearer \${${keyEnv}}' \\`;
      if (/^(x-api-key|x-goog-api-key)$/i.test(k)) return `  -H '${k}: \${${keyEnv}}' \\`;
      return `  -H '${k}: ${v}' \\`;
    })
    .join('\n');
  const payload = JSON.stringify(body).replace(/'/g, "'\\''");
  return `curl -sS -X POST '${url}' \\\n${hs}\n  -d '${payload}'`;
}
