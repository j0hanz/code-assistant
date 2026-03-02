export type ErrorKind =
  | 'validation'
  | 'budget'
  | 'upstream'
  | 'timeout'
  | 'cancelled'
  | 'internal'
  | 'busy';

export interface ErrorMeta {
  retryable?: boolean;
  kind?: ErrorKind;
}

interface ToolError {
  code: string;
  message: string;
  retryable?: boolean;
  kind?: ErrorKind;
}

interface ToolTextContent {
  type: 'text';
  text: string;
}

interface ToolStructuredContent {
  [key: string]: unknown;
  ok: boolean;
  result?: unknown;
  error?: ToolError;
}

interface ToolResponse<TStructuredContent extends ToolStructuredContent> {
  [key: string]: unknown;
  content: ToolTextContent[];
  structuredContent: TStructuredContent;
}

interface ErrorToolResponse {
  [key: string]: unknown;
  content: ToolTextContent[];
  isError: true;
}

function appendErrorMeta(error: ToolError, meta?: ErrorMeta): void {
  if (meta?.retryable !== undefined) {
    error.retryable = meta.retryable;
  }
  if (meta?.kind !== undefined) {
    error.kind = meta.kind;
  }
}

function createToolError(
  code: string,
  message: string,
  meta?: ErrorMeta
): ToolError {
  const error: ToolError = { code, message };
  appendErrorMeta(error, meta);
  return error;
}

function toTextContent(
  structured: ToolStructuredContent,
  textContent?: string
): ToolTextContent[] {
  const text = textContent ?? JSON.stringify(structured);
  return [{ type: 'text', text }];
}

function createErrorStructuredContent(
  code: string,
  message: string,
  result?: unknown,
  meta?: ErrorMeta
): ToolStructuredContent {
  const error = createToolError(code, message, meta);

  if (result === undefined) {
    return { ok: false, error };
  }

  return { ok: false, error, result };
}

export function createToolResponse<
  TStructuredContent extends ToolStructuredContent,
>(
  structured: TStructuredContent,
  textContent?: string
): ToolResponse<TStructuredContent> {
  return {
    content: toTextContent(structured, textContent),
    structuredContent: structured,
  };
}

export function createErrorToolResponse(
  code: string,
  message: string,
  result?: unknown,
  meta?: ErrorMeta
): ErrorToolResponse {
  const structured = createErrorStructuredContent(code, message, result, meta);
  return {
    content: toTextContent(structured),
    isError: true,
  };
}
