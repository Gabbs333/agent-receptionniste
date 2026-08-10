import OpenAI from "openai";
import type { LlmProvider, LlmCompletionOptions } from "../types";

/**
 * Generic provider for any OpenAI-compatible API.
 * Works with: OpenAI, Groq, DeepSeek, Mistral, Together AI, Fireworks, etc.
 */
export class OpenAICompatibleProvider implements LlmProvider {
  private client: OpenAI;

  constructor(
    apiKey: string,
    baseURL?: string,
  ) {
    this.client = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
  }

  async complete(options: LlmCompletionOptions): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: options.model,
      messages: options.messages.map((m) => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      })),
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens,
    });

    return response.choices[0]?.message?.content ?? "";
  }
}
