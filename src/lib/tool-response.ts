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

interface ToolEmbeddedResource {
  type: 'resource';
  resource: {
    uri: string;
    mimeType: string;
    text: string;
  };
}

export type ToolContentBlock = ToolTextContent | ToolEmbeddedResource;

interface ToolStructuredContent {
  [key: string]: unknown;
  ok: boolean;
  result?: unknown;
  error?: ToolError;
}

interface ToolResponse<TStructuredContent extends ToolStructuredContent> {
  [key: string]: unknown;
  content: ToolContentBlock[];
  structuredContent: TStructuredContent;
}

interface ErrorToolResponse {
  [key: string]: unknown;
  content: ToolContentBlock[];
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

function toContentBlocks(
  structured: ToolStructuredContent,
  textContent?: string
): ToolContentBlock[] {
  const text = textContent ?? JSON.stringify(structured);
  const blocks: ToolContentBlock[] = [{ type: 'text', text }];

  if (textContent) {
    blocks.push({
      type: 'resource',
      resource: {
        uri: 'internal://preview/result.md',
        mimeType: 'text/markdown',
        text: textContent,
      },
    });
  }

  return blocks;
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
    content: toContentBlocks(structured, textContent),
    structuredContent: structured,
  };
}

/**
 * Build an error tool response with `isError: true`.
 *
 * Intentionally omits `structuredContent`. The MCP SDK skips `outputSchema`
 * validation when `isError` is true, so including it is unnecessary and could
 * create schema mismatches if the error shape diverges from the success shape.
 * Error details are available in `content[0].text` as JSON.
 */
export function createErrorToolResponse(
  code: string,
  message: string,
  result?: unknown,
  meta?: ErrorMeta
): ErrorToolResponse {
  const structured = createErrorStructuredContent(code, message, result, meta);
  return {
    content: toContentBlocks(structured),
    isError: true,
  };
}

/** Shared meta for non-retryable validation errors across tools. */
export const VALIDATION_ERROR_META: ErrorMeta = {
  retryable: false,
  kind: 'validation',
};
