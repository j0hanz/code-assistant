import {
  ANALYSIS_TEMPERATURE,
  CREATIVE_TEMPERATURE,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_TIMEOUT_EXTENDED_MS,
  FLASH_MODEL,
  FLASH_THINKING_LEVEL,
  FLASH_TRIAGE_THINKING_LEVEL,
  HEAVY_MAX_OUTPUT_TOKENS,
  LIGHT_MAX_OUTPUT_TOKENS,
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
  /** MCP per-tool task negotiation value exposed in tools/list. */
  taskSupport: 'forbidden' | 'optional' | 'required';
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
  /** Tool requires a cached diff from generate_diff. */
  requiresDiff?: boolean;
  /** Tool requires a cached file from load_file. */
  requiresFile?: boolean;
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

const MAX_SUGGESTIONS_PARAM = createParam(
  'maxSuggestions',
  'number',
  false,
  '1-15',
  'Max refactoring suggestions to return. Default: 10.'
);

const FILE_PATH_PARAM = createParam(
  'filePath',
  'string',
  true,
  '1-500 chars',
  'Relative to workspace root (e.g. src/app.ts) or absolute. Must be within workspace.'
);

const QUESTION_PARAM = createParam(
  'question',
  'string',
  true,
  '1-2000 chars',
  'Question about the loaded file.'
);

const QUERY_PARAM = createParam(
  'query',
  'string',
  true,
  '1-1000 chars',
  'Search query.'
);

const TOPIC_PARAM = createParam(
  'topic',
  'string',
  false,
  '2-100 chars',
  'Domain focus. Set to avoid irrelevant results.'
);

const RESPONSE_STYLE_PARAM = createParam(
  'responseStyle',
  'string',
  false,
  "'concise' | 'detailed' | 'bullets' | 'code_focused'",
  'Output format. Default: concise (2-4 sentences).'
);

const TOOL_CONTRACTS = [
  {
    name: 'generate_diff',
    purpose:
      'Generate a diff of current changes and cache it server-side. MUST be called before any other tool. Uses git to capture unstaged or staged changes in the current working directory.',
    model: 'none',
    taskSupport: 'forbidden',
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
    taskSupport: 'optional',
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
    requiresDiff: true,
  },
  {
    name: 'generate_review_summary',
    purpose: 'Produce PR summary, risk rating, and merge recommendation.',
    model: FLASH_MODEL,
    taskSupport: 'optional',
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
    requiresDiff: true,
  },
  {
    name: 'generate_test_plan',
    purpose: 'Generate prioritized test cases and coverage guidance.',
    model: FLASH_MODEL,
    taskSupport: 'optional',
    timeoutMs: DEFAULT_TIMEOUT_FLASH_MS,
    thinkingLevel: FLASH_THINKING_LEVEL,
    maxOutputTokens: HEAVY_MAX_OUTPUT_TOKENS,
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
    requiresDiff: true,
  },
  {
    name: 'analyze_time_space_complexity',
    purpose:
      'Analyze Big-O complexity and detect degradations in changed code.',
    model: FLASH_MODEL,
    taskSupport: 'optional',
    timeoutMs: DEFAULT_TIMEOUT_FLASH_MS,
    thinkingLevel: FLASH_THINKING_LEVEL,
    maxOutputTokens: LIGHT_MAX_OUTPUT_TOKENS,
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
    requiresDiff: true,
  },
  {
    name: 'detect_api_breaking_changes',
    purpose: 'Detect breaking API/interface changes in a diff.',
    model: FLASH_MODEL,
    taskSupport: 'optional',
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
    requiresDiff: true,
  },
  {
    name: 'load_file',
    purpose:
      'Cache a single file for analysis tools. Accepts relative path from workspace root (preferred) or absolute path.',
    model: 'none',
    taskSupport: 'forbidden',
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
      'Analyze cached file for complexity, duplication, naming, and grouping improvements. Focuses on high-impact structural issues.',
    model: FLASH_MODEL,
    taskSupport: 'optional',
    timeoutMs: DEFAULT_TIMEOUT_FLASH_MS,
    thinkingLevel: FLASH_TRIAGE_THINKING_LEVEL,
    maxOutputTokens: LIGHT_MAX_OUTPUT_TOKENS,
    temperature: ANALYSIS_TEMPERATURE,
    deterministicJson: true,
    params: cloneParams(LANGUAGE_PARAM, MAX_SUGGESTIONS_PARAM),
    outputShape:
      '{filePath, language, summary, suggestions[{category, target, currentIssue, suggestion, priority}], *IssuesCount}',
    gotchas: [
      'Requires load_file first.',
      'Analyzes one file — does not suggest cross-file moves.',
      'maxSuggestions caps output (default 10, max 15).',
    ],
    crossToolFlow: [
      'Use after load_file. Provides refactoring roadmap for the cached file.',
    ],
    requiresFile: true,
  },
  {
    name: 'ask_about_code',
    purpose: 'Answer natural-language questions about a cached file.',
    model: FLASH_MODEL,
    taskSupport: 'optional',
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
    requiresFile: true,
  },
  {
    name: 'verify_logic',
    purpose:
      'Verify algorithms and logic in cached file using Gemini code execution sandbox.',
    model: FLASH_MODEL,
    taskSupport: 'optional',
    timeoutMs: DEFAULT_TIMEOUT_EXTENDED_MS,
    thinkingLevel: FLASH_THINKING_LEVEL,
    maxOutputTokens: HEAVY_MAX_OUTPUT_TOKENS,
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
    requiresFile: true,
  },
  {
    name: 'web_search',
    purpose:
      'Google Search with Grounding. Set topic to scope results; responseStyle controls output length.',
    model: FLASH_MODEL,
    taskSupport: 'optional',
    timeoutMs: DEFAULT_TIMEOUT_FLASH_MS,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    params: cloneParams(QUERY_PARAM, TOPIC_PARAM, RESPONSE_STYLE_PARAM),
    outputShape: '{ok, result: {text, groundingMetadata}}',
    gotchas: [
      'Uses Gemini grounding — results depend on Google Search availability.',
      'No diff or file prerequisite.',
      'Set topic to avoid irrelevant results for ambiguous queries.',
    ],
    crossToolFlow: [
      'Standalone tool for fetching up-to-date information from the web.',
    ],
  },
  {
    name: 'generate_documentation',
    purpose:
      'Generate documentation stubs (JSDoc/TSDoc/docstrings) for all public exports in a cached file.',
    model: FLASH_MODEL,
    taskSupport: 'optional',
    timeoutMs: DEFAULT_TIMEOUT_EXTENDED_MS,
    thinkingLevel: FLASH_THINKING_LEVEL,
    maxOutputTokens: HEAVY_MAX_OUTPUT_TOKENS,
    temperature: ANALYSIS_TEMPERATURE,
    deterministicJson: true,
    params: cloneParams(LANGUAGE_PARAM),
    outputShape:
      '{filePath, language, summary, docBlocks[{target, kind, signature, documentation, example?}], totalExports, documentedCount}',
    gotchas: [
      'Requires load_file first.',
      'Skips private/internal symbols by default.',
    ],
    crossToolFlow: [
      'Use after load_file. Generates documentation for the cached file.',
    ],
    requiresFile: true,
  },
  {
    name: 'detect_code_smells',
    purpose:
      'Detect structural code smells (Fowler taxonomy) in a cached file. Does not overlap with refactor_code categories.',
    model: FLASH_MODEL,
    taskSupport: 'optional',
    timeoutMs: DEFAULT_TIMEOUT_EXTENDED_MS,
    thinkingLevel: FLASH_THINKING_LEVEL,
    maxOutputTokens: HEAVY_MAX_OUTPUT_TOKENS,
    temperature: ANALYSIS_TEMPERATURE,
    deterministicJson: true,
    params: cloneParams(LANGUAGE_PARAM),
    outputShape:
      '{filePath, language, summary, smells[{type, target, severity, explanation, suggestion}], overallHealth, infoCount, warningCount, errorCount}',
    gotchas: [
      'Requires load_file first.',
      'Focuses on structural anti-patterns, not naming/complexity/duplication/grouping (those belong to refactor_code).',
    ],
    crossToolFlow: [
      'Use after load_file. Complements refactor_code with smell detection.',
    ],
    requiresFile: true,
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
