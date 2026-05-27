// ── Model pricing & context window registry ───────────────────────────────────
// Prices in USD per 1M tokens.

export type ModelPricing = {
  inputPer1M: number
  outputPer1M: number
  cacheWritePer1M?: number
  cacheReadPer1M?: number
  contextWindow: number  // tokens
}

const PRICING: Record<string, ModelPricing> = {
  // ── Claude ──────────────────────────────────────────────────────────────────
  'claude-opus-4':          { inputPer1M: 15,    outputPer1M: 75,   cacheWritePer1M: 18.75, cacheReadPer1M: 1.5,  contextWindow: 200_000 },
  'claude-opus-4-5':        { inputPer1M: 15,    outputPer1M: 75,   cacheWritePer1M: 18.75, cacheReadPer1M: 1.5,  contextWindow: 200_000 },
  'claude-opus-4-6':        { inputPer1M: 15,    outputPer1M: 75,   cacheWritePer1M: 18.75, cacheReadPer1M: 1.5,  contextWindow: 200_000 },
  'claude-sonnet-4':        { inputPer1M: 3,     outputPer1M: 15,   cacheWritePer1M: 3.75,  cacheReadPer1M: 0.3,  contextWindow: 200_000 },
  'claude-sonnet-4-5':      { inputPer1M: 3,     outputPer1M: 15,   cacheWritePer1M: 3.75,  cacheReadPer1M: 0.3,  contextWindow: 200_000 },
  'claude-sonnet-4-6':      { inputPer1M: 3,     outputPer1M: 15,   cacheWritePer1M: 3.75,  cacheReadPer1M: 0.3,  contextWindow: 200_000 },
  'claude-3-7-sonnet':      { inputPer1M: 3,     outputPer1M: 15,   cacheWritePer1M: 3.75,  cacheReadPer1M: 0.3,  contextWindow: 200_000 },
  'claude-3-5-sonnet':      { inputPer1M: 3,     outputPer1M: 15,   cacheWritePer1M: 3.75,  cacheReadPer1M: 0.3,  contextWindow: 200_000 },
  'claude-haiku-4-5':       { inputPer1M: 0.8,   outputPer1M: 4,    cacheWritePer1M: 1,     cacheReadPer1M: 0.08, contextWindow: 200_000 },
  'claude-3-5-haiku':       { inputPer1M: 0.8,   outputPer1M: 4,    cacheWritePer1M: 1,     cacheReadPer1M: 0.08, contextWindow: 200_000 },
  // ── OpenAI / Codex ──────────────────────────────────────────────────────────
  'gpt-4o':                 { inputPer1M: 2.5,   outputPer1M: 10,   contextWindow: 128_000 },
  'gpt-4o-mini':            { inputPer1M: 0.15,  outputPer1M: 0.6,  contextWindow: 128_000 },
  'gpt-4.1':                { inputPer1M: 2,     outputPer1M: 8,    contextWindow: 128_000 },
  'gpt-4.1-mini':           { inputPer1M: 0.4,   outputPer1M: 1.6,  contextWindow: 128_000 },
  'gpt-4.1-nano':           { inputPer1M: 0.1,   outputPer1M: 0.4,  contextWindow: 128_000 },
  'o3':                     { inputPer1M: 10,    outputPer1M: 40,   contextWindow: 200_000 },
  'o4-mini':                { inputPer1M: 1.1,   outputPer1M: 4.4,  contextWindow: 200_000 },
  'codex-mini-latest':      { inputPer1M: 1.5,   outputPer1M: 6,    contextWindow: 200_000 },
  // ── Gemini ──────────────────────────────────────────────────────────────────
  'gemini-2.5-pro':         { inputPer1M: 1.25,  outputPer1M: 10,   contextWindow: 1_048_576 },
  'gemini-2.5-flash':       { inputPer1M: 0.075, outputPer1M: 0.3,  contextWindow: 1_048_576 },
  'gemini-2.0-flash':       { inputPer1M: 0.075, outputPer1M: 0.3,  contextWindow: 1_048_576 },
  // ── Cursor models ───────────────────────────────────────────────────────────
  'cursor-auto':            { inputPer1M: 3,     outputPer1M: 15,   contextWindow: 200_000 },
  // ── DeepSeek ────────────────────────────────────────────────────────────────
  'deepseek-chat':          { inputPer1M: 0.27,  outputPer1M: 1.1,  contextWindow: 128_000 },
  'deepseek-reasoner':      { inputPer1M: 0.55,  outputPer1M: 2.19, contextWindow: 128_000 },
  // ── Default fallback ────────────────────────────────────────────────────────
  'unknown':                { inputPer1M: 3,     outputPer1M: 15,   contextWindow: 128_000 },
}

/** Prefix-match a model ID against the pricing table */
function findPricing(model: string): ModelPricing {
  const clean = model
    .replace(/@.*$/, '')        // strip @date suffix
    .replace(/-\d{8}$/, '')     // strip YYYYMMDD suffix
    .toLowerCase()

  // Exact match first
  if (PRICING[clean]) return PRICING[clean]!

  // Prefix match (longest prefix wins)
  let best: ModelPricing | null = null
  let bestLen = 0
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (clean.startsWith(key) && key.length > bestLen) {
      best = pricing
      bestLen = key.length
    }
  }
  return best ?? PRICING['unknown']!
}

export function getContextWindow(model: string): number {
  return findPricing(model).contextWindow
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens = 0,
  cacheReadTokens = 0,
): number {
  const p = findPricing(model)
  const input = (inputTokens / 1_000_000) * p.inputPer1M
  const output = (outputTokens / 1_000_000) * p.outputPer1M
  const cacheWrite = p.cacheWritePer1M ? (cacheCreationTokens / 1_000_000) * p.cacheWritePer1M : 0
  const cacheRead = p.cacheReadPer1M ? (cacheReadTokens / 1_000_000) * p.cacheReadPer1M : 0
  return input + output + cacheWrite + cacheRead
}

export function getShortModelName(model: string): string {
  const clean = model.replace(/@.*$/, '').replace(/-\d{8}$/, '').toLowerCase()
  // Short name mappings
  const shorts: Record<string, string> = {
    'claude-opus-4-6': 'Opus 4.6',
    'claude-opus-4-5': 'Opus 4.5',
    'claude-opus-4':   'Opus 4',
    'claude-sonnet-4-6': 'Sonnet 4.6',
    'claude-sonnet-4-5': 'Sonnet 4.5',
    'claude-sonnet-4': 'Sonnet 4',
    'claude-3-7-sonnet': 'Sonnet 3.7',
    'claude-3-5-sonnet': 'Sonnet 3.5',
    'claude-haiku-4-5': 'Haiku 4.5',
    'claude-3-5-haiku': 'Haiku 3.5',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o-mini',
    'gpt-4.1': 'GPT-4.1',
    'gpt-4.1-mini': 'GPT-4.1-mini',
    'o3': 'o3',
    'o4-mini': 'o4-mini',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.0-flash': 'Gemini 2.0 Flash',
    'cursor-auto': 'Cursor (auto)',
    'deepseek-chat': 'DeepSeek Chat',
    'deepseek-reasoner': 'DeepSeek R1',
    'codex-mini-latest': 'Codex Mini',
  }
  for (const [key, name] of Object.entries(shorts)) {
    if (clean.startsWith(key)) return name
  }
  return model.split('/').pop() ?? model
}

/** Estimate token count for a plain-text string (rough: 1 token ≈ 4 chars) */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
