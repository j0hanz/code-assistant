import {
  ANALYSIS_TEMPERATURE,
  CREATIVE_TEMPERATURE,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_TIMEOUT_EXTENDED_MS,
  FLASH_MODEL,
  FLASH_THINKING_LEVEL,
  FLASH_TRIAGE_THINKING_LEVEL,
  TRIAGE_TEMPERATURE,
} from './config.js';

const DEFAULT_TIMEOUT_FLASH_MS = 90_000;

export const INSPECTION_FOCUS_AREAS = [
  'security',
  'correctness',
  'performance',
  'regressions',
  'tests',
  'maintainability',
  'concurrency',
] as const;

export interface ToolParameterContract {
  name: string;
  type: string;
  required: boolean;
  constraints: string;
  description: string;
}

export interface ToolContract {
  name: string;
  purpose: string;
  /** Set to 'none' for synchronous (non-Gemini) tools. */
  model: string;
  /** Set to 0 for synchronous (non-Gemini) tools. */
  timeoutMs: number;
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
  /** Set to 0 for synchronous (non-Gemini) tools. */
  maxOutputTokens: number;
  /**
   * Sampling temperature for the Gemini call.
   * Gemini 3 recommends 1.0 for all tasks.
   */
  temperature?: number;
  /** Enables deterministic JSON guidance and schema key ordering. */
  deterministicJson?: boolean;
  params: readonly ToolParameterContract[];
  outputShape: string;
  gotchas: readonly string[];
  crossToolFlow: readonly string[];
  constraints?: readonly string[];
}

interface StructuredToolRuntimeOptions {
  thinkingLevel?: NonNullable<ToolContract['thinkingLevel']>;
  temperature?: NonNullable<ToolContract['temperature']>;
  deterministicJson?: NonNullable<ToolContract['deterministicJson']>;
}

interface StructuredToolExecutionOptions extends StructuredToolRuntimeOptions {
  timeoutMs: ToolContract['timeoutMs'];
  maxOutputTokens: ToolContract['maxOutputTokens'];
}

export function buildStructuredToolRuntimeOptions(
  contract: Pick<
    ToolContract,
    'thinkingLevel' | 'temperature' | 'deterministicJson'
  >
): StructuredToolRuntimeOptions {
  return {
    ...(contract.thinkingLevel !== undefined
      ? { thinkingLevel: contract.thinkingLevel }
      : {}),
    ...(contract.temperature !== undefined
      ? { temperature: contract.temperature }
      : {}),
    ...(contract.deterministicJson !== undefined
      ? { deterministicJson: contract.deterministicJson }
      : {}),
  };
}

export function buildStructuredToolExecutionOptions(
  contract: Pick<
    ToolContract,
    | 'timeoutMs'
    | 'maxOutputTokens'
    | 'thinkingLevel'
    | 'temperature'
    | 'deterministicJson'
  >
): StructuredToolExecutionOptions {
  return {
    timeoutMs: contract.timeoutMs,
    maxOutputTokens: contract.maxOutputTokens,
    ...buildStructuredToolRuntimeOptions(contract),
  };
}

function createParam(
  name: string,
  type: string,
  required: boolean,
  constraints: string,
  description: string
): ToolParameterContract {
  return { name, type, required, constraints, description };
}

function cloneParams(
  ...params: readonly ToolParameterContract[]
): ToolParameterContract[] {
  return params.map((param) => ({ ...param }));
}

const MODE_PARAM = createParam(
  'mode',
  'string',
  true,
  "'unstaged' | 'staged'",
  "'unstaged': working tree changes not yet staged. 'staged': changes added to the index (git add)."
);

const REPOSITORY_PARAM = createParam(
  'repository',
  'string',
  true,
  '1-200 chars',
  'Repository identifier (org/repo).'
);

const LANGUAGE_PARAM = createParam(
  'language',
  'string',
  false,
  '2-32 chars',
  'Primary language hint.'
);

const TEST_FRAMEWORK_PARAM = createParam(
  'testFramework',
  'string',
  false,
  '1-50 chars',
  'Framework hint (jest, vitest, pytest, node:test).'
);

const MAX_TEST_CASES_PARAM = createParam(
  'maxTestCases',
  'number',
  false,
  '1-30',
  'Post-generation cap applied to test cases.'
);

const FILE_PATH_PARAM = createParam(
  'filePath',
  'string',
  true,
  '1-500 chars',
  'Absolute path to the file to analyze.'
);

const QUESTION_PARAM = createParam(
  'question',
  'string',
  true,
  '1-2000 chars',
  'Question about the loaded file.'
);

export const TOOL_CONTRACTS = [
  {
    name: 'generate_diff',
    purpose:
      'Generate a diff of current changes and cache it server-side. MUST be called before any other tool. Uses git to capture unstaged or staged changes in the current working directory.',
    model: 'none',
    timeoutMs: 0,
    maxOutputTokens: 0,
    params: cloneParams(MODE_PARAM),
    outputShape:
      '{ok, result: {diffRef, stats{files, added, deleted}, generatedAt, mode, message}}',
    gotchas: [
      'Must be called first — all other tools return E_NO_DIFF if no diff is cached.',
      'Noisy files (lock files, dist/, build/, minified assets) are excluded automatically.',
      'Empty diff (no changes) returns E_NO_CHANGES.',
    ],
    crossToolFlow: [
      'Caches diff at internal://diff/current — consumed automatically by all review tools.',
    ],
  },
  {
    name: 'analyze_pr_impact',
    purpose:
      'Assess severity, categories, breaking changes, and rollback complexity.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_FLASH_MS,
    thinkingLevel: FLASH_TRIAGE_THINKING_LEVEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: TRIAGE_TEMPERATURE,
    deterministicJson: true,
    params: cloneParams(REPOSITORY_PARAM, LANGUAGE_PARAM),
    outputShape:
      '{severity, categories[], summary, breakingChanges[], affectedAreas[], rollbackComplexity}',
    gotchas: [
      'Requires generate_diff to be called first.',
      'Flash triage tool optimized for speed.',
    ],
    crossToolFlow: [
      'severity/categories feed triage and merge-gate decisions.',
    ],
  },
  {
    name: 'generate_review_summary',
    purpose: 'Produce PR summary, risk rating, and merge recommendation.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_FLASH_MS,
    thinkingLevel: FLASH_TRIAGE_THINKING_LEVEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: TRIAGE_TEMPERATURE,
    deterministicJson: true,
    params: cloneParams(REPOSITORY_PARAM, LANGUAGE_PARAM),
    outputShape:
      '{summary, overallRisk, keyChanges[], recommendation, stats{filesChanged, linesAdded, linesRemoved}}',
    gotchas: [
      'Requires generate_diff to be called first.',
      'stats are computed locally from the diff.',
    ],
    crossToolFlow: [
      'Use before deep review to decide whether Pro analysis is needed.',
    ],
  },
  {
    name: 'generate_test_plan',
    purpose: 'Generate prioritized test cases and coverage guidance.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_FLASH_MS,
    thinkingLevel: FLASH_THINKING_LEVEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: CREATIVE_TEMPERATURE,
    deterministicJson: true,
    params: cloneParams(
      REPOSITORY_PARAM,
      LANGUAGE_PARAM,
      TEST_FRAMEWORK_PARAM,
      MAX_TEST_CASES_PARAM
    ),
    outputShape: '{summary, testCases[], coverageSummary}',
    gotchas: [
      'Requires generate_diff to be called first.',
      'maxTestCases caps output after generation.',
    ],
    crossToolFlow: ['Pair with review tools to validate high-risk paths.'],
  },
  {
    name: 'analyze_time_space_complexity',
    purpose:
      'Analyze Big-O complexity and detect degradations in changed code.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_FLASH_MS,
    thinkingLevel: FLASH_THINKING_LEVEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: ANALYSIS_TEMPERATURE,
    deterministicJson: true,
    params: cloneParams(LANGUAGE_PARAM),
    outputShape:
      '{timeComplexity, spaceComplexity, explanation, potentialBottlenecks[], isDegradation}',
    gotchas: [
      'Requires generate_diff to be called first.',
      'Analyzes only changed code visible in the diff.',
    ],
    crossToolFlow: ['Use for algorithmic/performance-sensitive changes.'],
  },
  {
    name: 'detect_api_breaking_changes',
    purpose: 'Detect breaking API/interface changes in a diff.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_FLASH_MS,
    thinkingLevel: FLASH_TRIAGE_THINKING_LEVEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: TRIAGE_TEMPERATURE,
    deterministicJson: true,
    params: cloneParams(LANGUAGE_PARAM),
    outputShape: '{hasBreakingChanges, breakingChanges[]}',
    gotchas: [
      'Requires generate_diff to be called first.',
      'Targets public API contracts over internal refactors.',
    ],
    crossToolFlow: ['Run before merge for API-surface-sensitive changes.'],
  },
  {
    name: 'load_file',
    purpose:
      'Read a single file from disk and cache it server-side. MUST be called before any file analysis tool.',
    model: 'none',
    timeoutMs: 0,
    maxOutputTokens: 0,
    params: cloneParams(FILE_PATH_PARAM),
    outputShape:
      '{ok, result: {fileRef, filePath, language, lineCount, sizeChars, cachedAt, message}}',
    gotchas: [
      'Single file only — overwrites previous cache.',
      'Max file size enforced (120K chars default).',
      'File must be under workspace root.',
    ],
    crossToolFlow: [
      'Caches file at internal://file/current — consumed by refactor_code and future analysis tools.',
    ],
  },
  {
    name: 'refactor_code',
    purpose:
      'Analyze cached file for naming, complexity, duplication, and grouping improvements.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_EXTENDED_MS,
    thinkingLevel: FLASH_THINKING_LEVEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: ANALYSIS_TEMPERATURE,
    deterministicJson: true,
    params: cloneParams(LANGUAGE_PARAM),
    outputShape:
      '{filePath, language, summary, suggestions[{category, target, currentIssue, suggestion, priority}], *IssuesCount}',
    gotchas: [
      'Requires load_file first.',
      'Analyzes one file — does not suggest cross-file moves.',
    ],
    crossToolFlow: [
      'Use after load_file. Provides refactoring roadmap for the cached file.',
    ],
  },
  {
    name: 'ask_about_code',
    purpose: 'Answer natural-language questions about a cached file.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_EXTENDED_MS,
    thinkingLevel: FLASH_THINKING_LEVEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: ANALYSIS_TEMPERATURE,
    deterministicJson: true,
    params: cloneParams(QUESTION_PARAM, LANGUAGE_PARAM),
    outputShape:
      '{answer, codeReferences[{target, explanation}], confidence, filePath, language}',
    gotchas: [
      'Requires load_file first.',
      'Answers based solely on the cached file content.',
    ],
    crossToolFlow: [
      'Use after load_file. Complements refactor_code for understanding code.',
    ],
  },
  {
    name: 'verify_logic',
    purpose:
      'Verify algorithms and logic in cached file using Gemini code execution sandbox.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_EXTENDED_MS,
    thinkingLevel: FLASH_THINKING_LEVEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: ANALYSIS_TEMPERATURE,
    deterministicJson: false,
    params: cloneParams(QUESTION_PARAM, LANGUAGE_PARAM),
    outputShape:
      '{answer, verified, codeBlocks[{code, language}], executionResults[{outcome, output}], filePath, language}',
    gotchas: [
      'Requires load_file first.',
      'Code execution runs Python only (server-side sandbox).',
    ],
    crossToolFlow: [
      'Use after load_file. Complements ask_about_code for verification tasks.',
    ],
  },
  {
    name: 'web_search',
    purpose:
      'Perform a Google Search with Grounding to get up-to-date information.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_FLASH_MS,
    maxOutputTokens: 0,
    params: cloneParams(QUESTION_PARAM),
    outputShape: '{ok, result: {text, groundingMetadata}}',
    gotchas: [
      'Uses Gemini grounding — results depend on Google Search availability.',
      'No diff or file prerequisite.',
    ],
    crossToolFlow: [
      'Standalone tool for fetching up-to-date information from the web.',
    ],
  },
  {
    name: 'index_repository',
    purpose:
      'Walk a local repository, upload source files to a Gemini File Search Store for RAG queries.',
    model: 'none',
    timeoutMs: 0,
    maxOutputTokens: 0,
    params: cloneParams(FILE_PATH_PARAM),
    outputShape:
      '{ok, result: {storeName, displayName, filesUploaded, filesSkipped, message}}',
    gotchas: [
      'Must be called before query_repository.',
      'Max 500 files, 1 MB per file.',
      'Re-indexing replaces the previous store.',
    ],
    crossToolFlow: ['Creates a search store consumed by query_repository.'],
  },
  {
    name: 'query_repository',
    purpose:
      'Query the indexed repository search store using natural language.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_EXTENDED_MS,
    thinkingLevel: FLASH_THINKING_LEVEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: ANALYSIS_TEMPERATURE,
    deterministicJson: true,
    params: cloneParams(QUESTION_PARAM),
    outputShape: '{ok, result: {answer, references[]}}',
    gotchas: [
      'Requires index_repository first.',
      'Quality depends on indexed file coverage.',
    ],
    crossToolFlow: [
      'Use after index_repository for targeted codebase questions.',
    ],
  },
] as const satisfies readonly ToolContract[];

const TOOL_CONTRACTS_BY_NAME = new Map<string, ToolContract>(
  TOOL_CONTRACTS.map((contract) => [contract.name, contract])
);

export function getToolContracts(): readonly ToolContract[] {
  return TOOL_CONTRACTS;
}

export function getToolContract(toolName: string): ToolContract | undefined {
  return TOOL_CONTRACTS_BY_NAME.get(toolName);
}

export function requireToolContract(toolName: string): ToolContract {
  const contract = getToolContract(toolName);
  if (contract) {
    return contract;
  }

  throw new Error(`Unknown tool contract: ${toolName}`);
}

export function getToolContractNames(): string[] {
  return TOOL_CONTRACTS.map((contract) => contract.name);
}
