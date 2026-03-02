import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  createSearchStore,
  deleteSearchStore,
  getCurrentSearchStore,
  setCurrentSearchStore,
  uploadToSearchStore,
} from '../lib/gemini/index.js';
import { createErrorToolResponse, createToolResponse } from '../lib/tools.js';
import { wrapToolHandler } from '../lib/tools.js';
import { IndexRepositoryInputSchema } from '../schemas/inputs.js';
import { DefaultOutputSchema } from '../schemas/outputs.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_BYTES = 1_048_576; // 1 MB
const MAX_FILES = 500;

const ALLOWED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.cs',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.swift',
  '.php',
  '.sh',
  '.bash',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.html',
  '.css',
  '.scss',
  '.sql',
  '.md',
  '.lua',
  '.r',
  '.dart',
  '.ex',
  '.exs',
  '.erl',
  '.zig',
  '.vue',
  '.svelte',
  '.txt',
  '.cfg',
  '.ini',
  '.env.example',
  '.dockerfile',
  '.tf',
  '.graphql',
  '.proto',
]);

const DENIED_SEGMENTS = new Set([
  '.env',
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '__pycache__',
  '.venv',
  'vendor',
  'coverage',
  '.cache',
]);

const EXTENSION_MIME_MAP: ReadonlyMap<string, string> = new Map([
  ['.json', 'application/json'],
  ['.xml', 'application/xml'],
  ['.html', 'text/html'],
  ['.css', 'text/css'],
  ['.md', 'text/markdown'],
  ['.yaml', 'text/yaml'],
  ['.yml', 'text/yaml'],
]);

const VALIDATION_META = { retryable: false, kind: 'validation' as const };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_MIME_MAP.get(ext) ?? 'text/plain';
}

function isDeniedSegment(segment: string): boolean {
  return DENIED_SEGMENTS.has(segment);
}

function isAllowedExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

interface CollectedFile {
  absolutePath: string;
  relativePath: string;
}

/**
 * Recursively walk a directory, collecting files that pass the extension
 * whitelist and denied-path filter. Stops after MAX_FILES.
 */
async function collectFiles(
  rootPath: string,
  currentPath: string,
  result: CollectedFile[]
): Promise<void> {
  if (result.length >= MAX_FILES) return;

  let entries;
  try {
    entries = await readdir(currentPath, { withFileTypes: true });
  } catch {
    return; // Skip unreadable directories
  }

  for (const entry of entries) {
    if (result.length >= MAX_FILES) return;

    if (isDeniedSegment(entry.name)) continue;

    const fullPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      // Skip symlinked directories to prevent symlink traversal attacks
      try {
        const entryStat = await lstat(fullPath);
        if (entryStat.isSymbolicLink()) continue;
      } catch {
        continue;
      }
      await collectFiles(rootPath, fullPath, result);
    } else if (entry.isFile() && isAllowedExtension(entry.name)) {
      // Skip symlinked files
      try {
        const entryStat = await lstat(fullPath);
        if (entryStat.isSymbolicLink()) continue;
      } catch {
        continue;
      }
      const relativePath = path.relative(rootPath, fullPath);
      result.push({ absolutePath: fullPath, relativePath });
    }
  }
}

function validateRootPath(rootPath: string): string | undefined {
  const resolved = path.resolve(rootPath);

  // Basic safety: reject paths that look like system roots
  if (resolved === path.parse(resolved).root) {
    return 'Cannot index a filesystem root directory.';
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerIndexRepositoryTool(server: McpServer): void {
  server.registerTool(
    'index_repository',
    {
      title: 'Index Repository',
      description:
        'Walk a local repository, upload source files to a Gemini File Search Store for RAG queries. Call before query_repository.',
      inputSchema: IndexRepositoryInputSchema,
      outputSchema: DefaultOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        openWorldHint: true,
        destructiveHint: false,
      },
    },
    wrapToolHandler(
      {
        toolName: 'index_repository',
        progressContext: (input) =>
          input.displayName ?? path.basename(input.rootPath),
      },
      async (input) => {
        const parsed = IndexRepositoryInputSchema.parse(input);
        const rootPath = path.resolve(parsed.rootPath);

        const pathError = validateRootPath(rootPath);
        if (pathError) {
          return createErrorToolResponse(
            'E_INDEX_REPO',
            pathError,
            undefined,
            VALIDATION_META
          );
        }

        // Verify root exists
        let rootStat;
        try {
          rootStat = await stat(rootPath);
        } catch {
          return createErrorToolResponse(
            'E_INDEX_REPO',
            `Directory not found: ${rootPath}`,
            undefined,
            VALIDATION_META
          );
        }
        if (!rootStat.isDirectory()) {
          return createErrorToolResponse(
            'E_INDEX_REPO',
            'Path is not a directory.',
            undefined,
            VALIDATION_META
          );
        }

        // Collect files
        const files: CollectedFile[] = [];
        await collectFiles(rootPath, rootPath, files);

        if (files.length === 0) {
          return createErrorToolResponse(
            'E_INDEX_REPO',
            'No indexable source files found in directory.',
            undefined,
            VALIDATION_META
          );
        }

        // Clean up previous store (fire-and-forget)
        const previousStore = getCurrentSearchStore();
        if (previousStore) {
          void deleteSearchStore(previousStore.storeName).catch(() => {
            // Best-effort cleanup; errors are logged inside deleteSearchStore
          });
        }

        // Create store
        const displayName = parsed.displayName ?? path.basename(rootPath);
        const storeName = await createSearchStore(displayName);
        if (!storeName) {
          return createErrorToolResponse(
            'E_INDEX_REPO',
            'Failed to create File Search Store. Check GEMINI_API_KEY.',
            undefined,
            { retryable: true, kind: 'upstream' }
          );
        }

        // Upload files
        let uploaded = 0;
        let skipped = 0;

        for (const file of files) {
          try {
            const fileStat = await stat(file.absolutePath);
            if (fileStat.size > MAX_FILE_BYTES) {
              skipped += 1;
              continue;
            }

            const content = await readFile(file.absolutePath, 'utf8');
            const mimeType = getMimeType(file.absolutePath);
            const docName = await uploadToSearchStore(
              storeName,
              file.relativePath,
              content,
              mimeType
            );

            if (docName) {
              uploaded += 1;
            } else {
              skipped += 1;
            }
          } catch {
            skipped += 1;
          }
        }

        setCurrentSearchStore({
          storeName,
          displayName,
          documentCount: uploaded,
          createdAt: Date.now(),
        });

        const message = `Indexed ${String(uploaded)} files into ${storeName} (${String(skipped)} skipped).`;
        return createToolResponse(
          {
            ok: true as const,
            result: {
              storeName,
              displayName,
              filesUploaded: uploaded,
              filesSkipped: skipped,
              message,
            },
          },
          message
        );
      }
    )
  );
}
