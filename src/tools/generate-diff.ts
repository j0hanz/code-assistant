import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  cleanDiff,
  computeDiffStatsFromFiles,
  DIFF_RESOURCE_URI,
  isEmptyDiff,
  NOISY_EXCLUDE_PATHSPECS,
  parseDiffFiles,
  storeDiff,
  validateDiffBudget,
} from '../lib/diff.js';
import {
  createErrorToolResponse,
  createToolResponse,
  wrapToolHandler,
} from '../lib/tools.js';
import { GenerateDiffInputSchema } from '../schemas/inputs.js';
import {
  createToolOutputSchema,
  GenerateDiffResultSchema,
} from '../schemas/outputs.js';

const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB
const MAX_GIT_ROOT_CACHE_SIZE = 50;

const execFileAsync = promisify(execFile);
const gitRootByCwd = new Map<string, string>();

type DiffMode = 'unstaged' | 'staged';

async function findGitRoot(cwd: string = process.cwd()): Promise<string> {
  const cached = gitRootByCwd.get(cwd);
  if (cached) {
    return cached;
  }

  const { stdout } = await execFileAsync(
    'git',
    ['rev-parse', '--show-toplevel'],
    {
      cwd,
      encoding: 'utf8',
    }
  );
  const gitRoot = stdout.trim();
  cacheGitRoot(cwd, gitRoot);
  return gitRoot;
}

function cacheGitRoot(cwd: string, gitRoot: string): void {
  if (gitRootByCwd.size >= MAX_GIT_ROOT_CACHE_SIZE) {
    // LRU-style eviction: remove the oldest entry instead of clearing all.
    const oldestKey = gitRootByCwd.keys().next().value;
    if (oldestKey !== undefined) {
      gitRootByCwd.delete(oldestKey);
    }
  }
  gitRootByCwd.set(cwd, gitRoot);
}

function buildGitArgs(mode: DiffMode): string[] {
  const args = ['diff', '--no-color', '--no-ext-diff'];

  if (mode === 'staged') {
    args.push('--cached');
  }

  // '--' separates flags from pathspecs. Everything after it is a
  // pathspec, never interpreted as a flag — prevents flag injection.
  args.push('--', ...NOISY_EXCLUDE_PATHSPECS);

  return args;
}

function describeModeHint(mode: DiffMode): string {
  return mode === 'staged'
    ? 'staged with git add'
    : 'modified but not yet staged (git add)';
}

type GitError = Error & {
  code?: number | string;
  stderr?: string;
  killed?: boolean;
};

function classifyGitError(err: GitError): {
  retryable: boolean;
  kind: 'validation' | 'timeout' | 'internal';
} {
  if (err.code === 'ENOENT') {
    return { retryable: false, kind: 'validation' };
  }
  if (err.killed === true) {
    return { retryable: false, kind: 'timeout' };
  }
  if (typeof err.code === 'number') {
    const stderr = err.stderr?.toLowerCase() ?? '';
    if (
      stderr.includes('not a git repository') ||
      stderr.includes('not a git repo')
    ) {
      return { retryable: false, kind: 'validation' };
    }
  }
  return { retryable: false, kind: 'internal' };
}

function formatGitFailureMessage(
  err: Error & { code?: number | string; stderr?: string }
): string {
  if (typeof err.code === 'number') {
    const stderr = err.stderr?.trim() ?? 'unknown error';
    return `git exited with code ${String(err.code)}: ${stderr}. Ensure the working directory is a git repository.`;
  }

  return `Failed to run git: ${err.message}. Ensure git is installed and the working directory is a git repository.`;
}

async function runGitDiff(mode: DiffMode): Promise<string> {
  const gitRoot = await findGitRoot();
  const args = buildGitArgs(mode);
  const { stdout } = await execFileAsync('git', args, {
    cwd: gitRoot,
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER,
    timeout: GIT_TIMEOUT_MS,
  });
  return cleanDiff(stdout);
}

function buildGitErrorResponse(
  error: unknown
): ReturnType<typeof createErrorToolResponse> {
  const err = error as GitError;
  return createErrorToolResponse(
    'E_GENERATE_DIFF',
    formatGitFailureMessage(err),
    undefined,
    classifyGitError(err)
  );
}

async function generateDiffToolResponse(
  mode: DiffMode
): Promise<
  | ReturnType<typeof createToolResponse>
  | ReturnType<typeof createErrorToolResponse>
> {
  try {
    const diff = await runGitDiff(mode);
    if (isEmptyDiff(diff)) {
      return createNoChangesResponse(mode);
    }
    return createSuccessResponse(diff, mode);
  } catch (error: unknown) {
    return buildGitErrorResponse(error);
  }
}

function createNoChangesResponse(
  mode: DiffMode
): ReturnType<typeof createErrorToolResponse> {
  return createErrorToolResponse(
    'E_NO_CHANGES',
    `No ${mode} changes found in the current branch. Make sure you have changes that are ${describeModeHint(mode)}.`,
    undefined,
    { retryable: false, kind: 'validation' }
  );
}

function createSuccessResponse(
  diff: string,
  mode: DiffMode
):
  | ReturnType<typeof createToolResponse>
  | ReturnType<typeof createErrorToolResponse> {
  const budgetError = validateDiffBudget(diff);
  if (budgetError) {
    return budgetError;
  }

  const parsedFiles = parseDiffFiles(diff);
  const stats = computeDiffStatsFromFiles(parsedFiles);
  const generatedAtMs = Date.now();
  const generatedAt = new Date(generatedAtMs).toISOString();

  storeDiff({ diff, parsedFiles, stats, generatedAt, generatedAtMs, mode });

  const summary = `Diff cached: ${stats.files} files (+${stats.added}, -${stats.deleted})`;
  return createToolResponse(
    {
      ok: true as const,
      result: {
        diffRef: DIFF_RESOURCE_URI,
        stats,
        generatedAt,
        mode,
        message: summary,
      },
    },
    summary
  );
}

export function registerGenerateDiffTool(server: McpServer): void {
  server.registerTool(
    'generate_diff',
    {
      title: 'Generate Diff',
      description:
        'Generate a diff of the current branch working changes and cache it for all review tools. You MUST call this tool before calling any other review tool. Use "unstaged" for working-tree changes not yet staged, or "staged" for changes already added with git add.',
      inputSchema: GenerateDiffInputSchema,
      outputSchema: createToolOutputSchema(GenerateDiffResultSchema),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    wrapToolHandler(
      {
        toolName: 'Generate Diff',
      },
      async (input) => {
        const { mode } = GenerateDiffInputSchema.parse(input);
        return generateDiffToolResponse(mode);
      }
    )
  );
}
