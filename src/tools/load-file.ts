import { realpathSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  SOURCE_RESOURCE_URI,
  storeFile,
  validateFileBudget,
} from '../lib/file-store.js';
import { detectLanguage } from '../lib/language-detect.js';
import {
  createErrorToolResponse,
  createToolResponse,
  VALIDATION_ERROR_META,
  wrapToolHandler,
} from '../lib/tools.js';
import { LoadFileInputSchema } from '../schemas/inputs.js';
import {
  createToolOutputSchema,
  LoadFileResultSchema,
} from '../schemas/outputs.js';

const DENIED_SEGMENTS = new Set(['.git', 'node_modules']);

function isDeniedPath(resolved: string): boolean {
  return resolved
    .split(path.sep)
    .some(
      (segment) =>
        DENIED_SEGMENTS.has(segment) ||
        segment === '.env' ||
        segment.startsWith('.env.')
    );
}

function validateFilePath(
  filePath: string,
  workspaceRoot: string
): string | undefined {
  let resolved: string;
  try {
    resolved = realpathSync(path.resolve(filePath));
  } catch {
    return 'File path not found or not accessible.';
  }

  let resolvedRoot: string;
  try {
    resolvedRoot = realpathSync(path.resolve(workspaceRoot));
  } catch {
    return 'Workspace root not found or not accessible.';
  }

  const relative = path.relative(resolvedRoot, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return 'File path must be within the workspace root directory.';
  }

  if (isDeniedPath(resolved)) {
    return 'Access to this file path is denied (.env, .git/, node_modules/).';
  }

  return undefined;
}

export function registerLoadFileTool(server: McpServer): void {
  server.registerTool(
    'load_file',
    {
      title: 'Load File',
      description:
        'Cache a single file for analysis tools (refactor_code, ask_about_code, verify_logic). Overwrites previous cache. Path is relative to server working directory (e.g. src/index.ts) or absolute (e.g. /home/user/project/src/index.ts).',
      inputSchema: LoadFileInputSchema,
      outputSchema: createToolOutputSchema(LoadFileResultSchema),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    wrapToolHandler(
      {
        toolName: 'Load File',
        progressContext: (input) => path.basename(input.filePath),
      },
      async (input) => {
        const parsed = LoadFileInputSchema.parse(input);
        const { filePath } = parsed;

        const pathError = validateFilePath(filePath, process.cwd());
        if (pathError) {
          return createErrorToolResponse(
            'E_LOAD_FILE',
            pathError,
            undefined,
            VALIDATION_ERROR_META
          );
        }

        const resolved = path.resolve(filePath);

        let fileStat;
        try {
          fileStat = await stat(resolved);
        } catch {
          return createErrorToolResponse(
            'E_LOAD_FILE',
            `File not found or not accessible: ${resolved}`,
            undefined,
            VALIDATION_ERROR_META
          );
        }

        if (!fileStat.isFile()) {
          return createErrorToolResponse(
            'E_LOAD_FILE',
            'Path is not a regular file.',
            undefined,
            VALIDATION_ERROR_META
          );
        }

        let content: string;
        try {
          content = await readFile(resolved, 'utf8');
        } catch {
          return createErrorToolResponse(
            'E_LOAD_FILE',
            `Failed to read file: ${resolved}`,
            undefined,
            { retryable: false, kind: 'internal' }
          );
        }

        const budgetError = validateFileBudget(content);
        if (budgetError) {
          return budgetError;
        }

        const language = detectLanguage(resolved);
        const lineCount = content.split('\n').length;
        const sizeChars = content.length;
        const cachedAt = Date.now();
        const cachedAtIso = new Date(cachedAt).toISOString();

        storeFile({
          filePath: resolved,
          content,
          language,
          lineCount,
          sizeChars,
          cachedAt,
          cachedAtIso,
        });

        const summary = `File cached: ${path.basename(resolved)} (${language}, ${lineCount} lines, ${sizeChars} chars)`;
        return createToolResponse(
          {
            ok: true as const,
            result: {
              fileRef: SOURCE_RESOURCE_URI,
              filePath: resolved,
              language,
              lineCount,
              sizeChars,
              cachedAt,
              message: summary,
            },
          },
          summary
        );
      }
    )
  );
}
