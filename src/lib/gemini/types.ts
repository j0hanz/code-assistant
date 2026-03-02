export type JsonObject = Record<string, unknown>;
export type GeminiLogHandler = (level: string, data: unknown) => Promise<void>;
export type GeminiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface GeminiRequestExecutionOptions {
  maxRetries?: number;
  timeoutMs?: number;
  temperature?: number;
  topK?: number;
  topP?: number;
  maxOutputTokens?: number;
  thinkingLevel?: GeminiThinkingLevel;
  includeThoughts?: boolean;
  signal?: AbortSignal;
  onLog?: GeminiLogHandler;
  responseKeyOrdering?: readonly string[];
  batchMode?: 'off' | 'inline';
  useGrounding?: boolean;
  useCodeExecution?: boolean;
  fileSearchStoreNames?: readonly string[];
}

export interface GeminiStructuredRequestOptions extends GeminiRequestExecutionOptions {
  model?: string;
}

export interface GeminiStructuredRequest extends GeminiStructuredRequestOptions {
  systemInstruction?: string;
  prompt: string;
  responseSchema: Readonly<JsonObject>;
  cachedContent?: string;
}

export type GeminiOnLog = GeminiStructuredRequest['onLog'];

export interface CodeExecutionBlock {
  code: string;
  language: string;
}

export interface CodeExecutionResultBlock {
  outcome: string;
  output: string;
}

export interface CodeExecutionResponse {
  text: string;
  codeBlocks: CodeExecutionBlock[];
  executionResults: CodeExecutionResultBlock[];
}
