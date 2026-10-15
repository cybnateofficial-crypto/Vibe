// Turns "provider:model-id" specs into ready-to-use provider instances.
// Also resolves the right brain for a user (their BYOK key if they set one).
import { AnthropicProvider, OpenAIProvider, GeminiProvider, MockProvider } from './providers.js';
import { decrypt } from './db.js';

export function resolveModelSpec(spec) {
  const s = String(spec || '').trim();
  if (!s) return null;
  const i = s.indexOf(':');
  if (i === -1) return null;
  const provider = s.slice(0, i).toLowerCase();
  const model = s.slice(i + 1).trim();

  switch (provider) {
    case 'anthropic': {
      const key = (process.env.ANTHROPIC_API_KEY || '').trim();
      return key ? new AnthropicProvider(key, model) : null;
    }
    case 'openai': {
      const key = (process.env.OPENAI_API_KEY || '').trim();
      return key ? new OpenAIProvider(key, model, process.env.OPENAI_BASE_URL) : null;
    }
    case 'openrouter': {
      const key = (process.env.OPENROUTER_API_KEY || '').trim();
      return key ? new OpenAIProvider(key, model, 'https://openrouter.ai/api/v1') : null;
    }
    case 'gemini': {
      const key = (process.env.GEMINI_API_KEY || '').trim();
      return key ? new GeminiProvider(key, model) : null;
    }
    case 'mock':
      return new MockProvider();
    default:
      return null;
  }
}

// Build a provider from a user's stored BYOK key (decrypted at call time).
export function providerFromByok(secret, byok) {
  if (!byok) return null;
  let key;
  try {
    key = decrypt(secret, byok.keyEnc);
  } catch {
    return null;
  }
  switch (byok.provider) {
    case 'anthropic':
      return new AnthropicProvider(key, byok.model || 'claude-haiku-4-5');
    case 'openai':
      return new OpenAIProvider(key, byok.model || 'gpt-4o', process.env.OPENAI_BASE_URL);
    case 'openrouter':
      return new OpenAIProvider(key, byok.model || 'meta-llama/llama-3.3-70b-instruct', 'https://openrouter.ai/api/v1');
    case 'gemini':
      return new GeminiProvider(key, byok.model || 'gemini-2.5-flash');
    default:
      return null;
  }
}

// Friendly display name for a model id (shown in the app's plan screen).
export function friendlyName(modelId) {
  const m = String(modelId || '');
  if (/sonnet-5/.test(m)) return 'Claude Sonnet 5';
  if (/sonnet/.test(m)) return 'Claude Sonnet';
  if (/opus/.test(m)) return 'Claude Opus';
  if (/haiku/.test(m)) return 'Claude Haiku';
  if (/gpt-5/.test(m)) return 'GPT-5.5';
  if (/gpt-4o/.test(m)) return 'GPT-4o';
  if (/gemini/.test(m)) return 'Gemini';
  if (/llama|deepseek|qwen|mistral/i.test(m)) return m.split('/').pop();
  return m || 'Demo';
}
