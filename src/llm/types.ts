export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCompletionOptions {
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LlmProvider {
  /** Returns the raw completion text from the LLM */
  complete(options: LlmCompletionOptions): Promise<string>;
}
