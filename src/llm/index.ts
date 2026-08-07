import type { LlmProvider } from "./types";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";

/**
 * Provider presets for common LLM providers.
 * All use OpenAI-compatible APIs.
 */
const PROVIDER_PRESETS: Record<
  string,
  {
    apiKeyEnv: string;
    baseURL?: string;
    defaultModel: string;
  }
> = {
  openai: {
    apiKeyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
  },
  groq: {
    apiKeyEnv: "GROQ_API_KEY",
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
  },
  deepseek: {
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-pro",
  },
  mistral: {
    apiKeyEnv: "MISTRAL_API_KEY",
    baseURL: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
  },
  together: {
    apiKeyEnv: "TOGETHER_API_KEY",
    baseURL: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  },
  local: {
    apiKeyEnv: "LOCAL_LLM_API_KEY",
    // baseURL is resolved dynamically in getLlmProvider() via LOCAL_LLM_BASE_URL
    defaultModel: "local-model",
  },
};

let cachedProvider: LlmProvider | null = null;
let cachedProviderName: string | null = null;

/** Returns a singleton LlmProvider based on LLM_PROVIDER env var */
export function getLlmProvider(): LlmProvider {
  const providerName = process.env["LLM_PROVIDER"]?.toLowerCase() ?? "openai";

  // Return cached instance if same provider
  if (cachedProvider && cachedProviderName === providerName) {
    return cachedProvider;
  }

  const preset = PROVIDER_PRESETS[providerName];
  if (!preset) {
    throw new Error(
      `Unknown LLM provider: "${providerName}". Supported: ${Object.keys(PROVIDER_PRESETS).join(", ")}`,
    );
  }

  const apiKey = process.env[preset.apiKeyEnv];
  if (!apiKey && providerName !== "local") {
    throw new Error(
      `Missing environment variable ${preset.apiKeyEnv} for provider "${providerName}"`,
    );
  }

  // Resolve baseURL dynamically for local provider
  const baseURL =
    providerName === "local"
      ? (process.env["LOCAL_LLM_BASE_URL"] ?? "http://localhost:1234/v1")
      : preset.baseURL;

  cachedProvider = new OpenAICompatibleProvider(apiKey, baseURL);
  cachedProviderName = providerName;
  return cachedProvider;
}

/** Returns the default model name for the current provider */
export function getDefaultModel(): string {
  const providerName = process.env["LLM_PROVIDER"]?.toLowerCase() ?? "openai";
  return PROVIDER_PRESETS[providerName]?.defaultModel ?? "gpt-4o-mini";
}
