import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { toInlineCode } from '../lib/format.js';
import {
  getToolContract,
  getToolContractNames,
  INSPECTION_FOCUS_AREAS,
} from '../lib/tools.js';

export const PROMPT_DEFINITIONS = [
  {
    name: 'get-help',
    title: 'Get Help',
    description:
      'Returns full server instructions: capabilities, tools, resources, constraints, and task lifecycle.',
  },
  {
    name: 'review-guide',
    title: 'Review Guide',
    description:
      'Returns a workflow guide for a specific tool and focus area. Supports auto-completion.',
  },
  {
    name: 'select-workflow',
    title: 'Select Workflow',
    description:
      'Returns a recommended tool pipeline based on the type of code change. Supports auto-completion.',
  },
  {
    name: 'analyze-file',
    title: 'Analyze File',
    description:
      'Returns a goal-based tool pipeline for single-file analysis. Supports auto-completion.',
  },
  {
    name: 'tool-chain',
    title: 'Tool Chain',
    description:
      'Returns the full prerequisite chain for a given tool, including setup steps and follow-ups.',
  },
] as const;

const TOOLS = getToolContractNames();
const DEFAULT_TOOL_NAME = TOOLS[0] ?? 'analyze_pr_impact';

type FocusArea = (typeof INSPECTION_FOCUS_AREAS)[number];
const TOOL_DESCRIPTION_TEXT = 'Select tool for review guide.';
const FOCUS_DESCRIPTION_TEXT = 'Select focus area.';

const FOCUS_AREA_GUIDES: Record<FocusArea, string> = {
  security: 'Focus: Injection, Auth, Crypto, OWASP.',
  correctness: 'Focus: Logic, Edge Cases, Types.',
  performance: 'Focus: Complexity, Memory, Latency.',
  regressions: 'Focus: Behavior Changes, Breaking APIs.',
  tests: 'Focus: Coverage, Error Paths.',
  maintainability: 'Focus: Complexity, Readability, Patterns.',
  concurrency: 'Focus: Races, Deadlocks, Atomicity.',
};

function isFocusArea(value: string): value is FocusArea {
  return INSPECTION_FOCUS_AREAS.includes(value as FocusArea);
}

// --- Change type workflow data ---

const CHANGE_TYPES = [
  'api_change',
  'refactor',
  'bugfix',
  'performance',
  'security',
  'dependency',
  'test_update',
  'feature',
] as const;

type ChangeType = (typeof CHANGE_TYPES)[number];

const CHANGE_TYPE_WORKFLOWS: Record<
  ChangeType,
  { tools: readonly string[]; note: string }
> = {
  api_change: {
    tools: [
      'generate_diff',
      'detect_api_breaking_changes',
      'analyze_pr_impact',
      'generate_test_plan',
    ],
    note: 'API surface change — check breaking changes first, then assess impact and generate tests.',
  },
  refactor: {
    tools: [
      'generate_diff',
      'generate_review_summary',
      'analyze_time_space_complexity',
    ],
    note: 'Refactor — verify no behavior change and check for complexity regressions.',
  },
  bugfix: {
    tools: ['generate_diff', 'generate_review_summary', 'generate_test_plan'],
    note: 'Bug fix — review the change, then generate tests to cover the fixed path.',
  },
  performance: {
    tools: [
      'generate_diff',
      'analyze_time_space_complexity',
      'generate_review_summary',
    ],
    note: 'Performance change — analyze complexity first, then review for correctness.',
  },
  security: {
    tools: [
      'generate_diff',
      'analyze_pr_impact',
      'generate_review_summary',
      'generate_test_plan',
    ],
    note: 'Security fix — assess impact severity, review thoroughly, and generate regression tests.',
  },
  dependency: {
    tools: [
      'generate_diff',
      'detect_api_breaking_changes',
      'analyze_pr_impact',
    ],
    note: 'Dependency update — check for breaking API changes and assess rollback complexity.',
  },
  test_update: {
    tools: ['generate_diff', 'generate_review_summary'],
    note: 'Test-only change — review for coverage gaps and correctness.',
  },
  feature: {
    tools: [
      'generate_diff',
      'generate_review_summary',
      'analyze_pr_impact',
      'generate_test_plan',
    ],
    note: 'New feature — full review pipeline: summary, impact, and test plan.',
  },
};

function isChangeType(value: string): value is ChangeType {
  return (CHANGE_TYPES as readonly string[]).includes(value);
}

// --- File analysis goal data ---

const FILE_GOALS = [
  'understand',
  'refactor',
  'document',
  'smell_check',
  'verify',
  'full',
] as const;

type FileGoal = (typeof FILE_GOALS)[number];

const FILE_GOAL_PIPELINES: Record<
  FileGoal,
  { tools: readonly string[]; note: string }
> = {
  understand: {
    tools: ['load_file', 'ask_about_code'],
    note: 'Understand — load the file and ask questions about its purpose, logic, or structure.',
  },
  refactor: {
    tools: ['load_file', 'refactor_code', 'detect_code_smells'],
    note: 'Refactor — get structural improvement suggestions and detect code smells.',
  },
  document: {
    tools: ['load_file', 'generate_documentation'],
    note: 'Document — generate JSDoc/TSDoc/docstring stubs for public exports.',
  },
  smell_check: {
    tools: ['load_file', 'detect_code_smells'],
    note: 'Smell check — detect structural anti-patterns (Fowler taxonomy).',
  },
  verify: {
    tools: ['load_file', 'verify_logic'],
    note: 'Verify — validate algorithms and logic using Gemini code execution sandbox.',
  },
  full: {
    tools: [
      'load_file',
      'ask_about_code',
      'refactor_code',
      'detect_code_smells',
      'generate_documentation',
    ],
    note: 'Full analysis — run all file-based tools for comprehensive understanding.',
  },
};

function isFileGoal(value: string): value is FileGoal {
  return (FILE_GOALS as readonly string[]).includes(value);
}

// --- Workflow summary data (for review-guide enhancement) ---

const WORKFLOW_KEYS = ['A', 'B', 'C', 'D'] as const;

type WorkflowKey = (typeof WORKFLOW_KEYS)[number];

const WORKFLOW_SUMMARIES: Record<WorkflowKey, string> = {
  A: '## Workflow A: Full PR Review\n1. `generate_review_summary` -> {overallRisk, keyChanges[], recommendation, stats}',
  B: '## Workflow B: Impact Assessment\n1. `analyze_pr_impact` -> {severity, categories[], breakingChanges[], rollbackComplexity}\n2. `generate_review_summary` -> complementary merge recommendation',
  C: '## Workflow C: Test Coverage\n1. `generate_test_plan` -> {testCases[], coverageSummary}\n2. Review by priority: must_have -> should_have -> nice_to_have',
  D: '## Workflow D: Complexity & Breaking Changes\n1. `analyze_time_space_complexity` -> {timeComplexity, spaceComplexity, isDegradation}\n2. `detect_api_breaking_changes` -> {hasBreakingChanges, breakingChanges[]}',
};

function isWorkflowKey(value: string): value is WorkflowKey {
  return (WORKFLOW_KEYS as readonly string[]).includes(value);
}

// --- Tool classification (derived from contracts) ---

export type ToolCategory = 'diff' | 'file' | 'sync' | 'standalone';

const DIFF_PREREQUISITE_PATTERN = /requires generate_diff/i;
const FILE_PREREQUISITE_PATTERN = /requires load_file/i;

export function classifyTool(toolName: string): ToolCategory {
  const contract = getToolContract(toolName);
  if (!contract) {
    return 'standalone';
  }
  const firstGotcha = contract.gotchas[0] ?? '';
  if (DIFF_PREREQUISITE_PATTERN.test(firstGotcha)) {
    return 'diff';
  }
  if (FILE_PREREQUISITE_PATTERN.test(firstGotcha)) {
    return 'file';
  }
  if (contract.model === 'none') {
    return 'sync';
  }
  return 'standalone';
}

export function getToolChain(toolName: string): string {
  const category = classifyTool(toolName);
  const contract = getToolContract(toolName);
  const purpose = contract?.purpose ?? 'Unknown tool.';

  const steps: string[] = [];
  if (category === 'diff') {
    steps.push('1. `generate_diff({ mode })` — capture current changes');
    steps.push(`2. \`${toolName}(...)\` — ${purpose}`);
  } else if (category === 'file') {
    steps.push('1. `load_file({ filePath })` — cache the target file');
    steps.push(`2. \`${toolName}(...)\` — ${purpose}`);
  } else {
    steps.push(`1. \`${toolName}(...)\` — ${purpose}`);
  }

  const crossFlow = contract?.crossToolFlow.join('\n') ?? '';
  const header = `# Tool Chain: ${toolName}\n\nCategory: ${category}\n\n## Steps\n`;
  const footer = crossFlow ? `\n\n## Follow-up\n${crossFlow}` : '';
  return header + steps.join('\n') + footer;
}

// --- Builder functions for new prompts ---

export function buildWorkflowText(changeType: string): string {
  if (isChangeType(changeType)) {
    const workflow = CHANGE_TYPE_WORKFLOWS[changeType];
    const steps = workflow.tools
      .map((tool, i) => `${i + 1}. \`${tool}\``)
      .join('\n');
    return `# Workflow: ${changeType}\n\n${workflow.note}\n\n## Steps\n${steps}`;
  }
  return `# Workflow: ${changeType}\n\nNo predefined workflow for this change type. Start with \`generate_diff\`, then choose tools based on your needs.`;
}

export function buildFileAnalysisText(goal: string): string {
  if (isFileGoal(goal)) {
    const pipeline = FILE_GOAL_PIPELINES[goal];
    const steps = pipeline.tools
      .map((tool, i) => `${i + 1}. \`${tool}\``)
      .join('\n');
    return `# File Analysis: ${goal}\n\n${pipeline.note}\n\n## Steps\n${steps}`;
  }
  return `# File Analysis: ${goal}\n\nNo predefined pipeline for this goal. Start with \`load_file\`, then choose analysis tools.`;
}

export function getWorkflowSummary(key: string): string {
  if (isWorkflowKey(key)) {
    return WORKFLOW_SUMMARIES[key];
  }
  return `Unknown workflow key: ${key}. Valid keys: ${WORKFLOW_KEYS.join(', ')}.`;
}

export function findPromptDef(
  name: string
): (typeof PROMPT_DEFINITIONS)[number] {
  const def = PROMPT_DEFINITIONS.find((d) => d.name === name);
  if (!def) {
    throw new Error(`Unknown prompt definition: ${name}`);
  }
  return def;
}

export function completeByPrefix<T extends string>(
  values: readonly T[],
  prefix: string
): T[] {
  return values.filter((value) => value.startsWith(prefix));
}

function getToolGuide(tool: string): string {
  const contract = getToolContract(tool);
  if (!contract) {
    return `Use ${toInlineCode(tool)} to analyze your code changes.`;
  }

  const modelLine = buildToolModelLine(contract);
  return `Tool: ${contract.name}\n${modelLine}\nOutput: ${contract.outputShape}\nUse: ${contract.purpose}`;
}

function buildToolModelLine(contract: {
  model: string;
  thinkingLevel?: string;
  maxOutputTokens: number;
}): string {
  if (contract.thinkingLevel !== undefined) {
    return `Model: ${contract.model} (thinking level ${contract.thinkingLevel}, output cap ${contract.maxOutputTokens}).`;
  }

  return `Model: ${contract.model} (output cap ${contract.maxOutputTokens}).`;
}

export function createPromptResponse(
  description: string,
  text: string
): {
  description: string;
  messages: {
    role: 'user';
    content: { type: 'text'; text: string };
  }[];
} {
  return {
    description,
    messages: [
      {
        role: 'user' as const,
        content: { type: 'text' as const, text },
      },
    ],
  };
}

export function getFocusAreaGuide(focusArea: string): string {
  return isFocusArea(focusArea)
    ? FOCUS_AREA_GUIDES[focusArea]
    : `Focus on ${focusArea} concerns.`;
}

function registerHelpPrompt(server: McpServer, instructions: string): void {
  const def = findPromptDef('get-help');
  server.registerPrompt(
    def.name,
    {
      title: def.title,
      description: def.description,
    },
    () => createPromptResponse(def.description, instructions)
  );
}

export function buildReviewGuideText(tool: string, focusArea: string): string {
  const toolCode = toInlineCode(tool);

  return (
    `# Guide: ${tool} / ${focusArea}\n\n` +
    `## Tool: ${toolCode}\n${getToolGuide(tool)}\n\n` +
    `## Focus: ${focusArea}\n${getFocusAreaGuide(focusArea)}`
  );
}

function registerReviewGuidePrompt(server: McpServer): void {
  const def = findPromptDef('review-guide');
  server.registerPrompt(
    def.name,
    {
      title: def.title,
      description: def.description,
      argsSchema: {
        tool: completable(
          z.string().max(128).optional().describe(TOOL_DESCRIPTION_TEXT),
          (value) => completeByPrefix(TOOLS, value ?? '')
        ),
        focusArea: completable(
          z.string().max(128).optional().describe(FOCUS_DESCRIPTION_TEXT),
          (value) => completeByPrefix(INSPECTION_FOCUS_AREAS, value ?? '')
        ),
        workflow: completable(
          z
            .string()
            .max(128)
            .optional()
            .describe('Select a predefined workflow (A, B, C, or D).'),
          (value) => completeByPrefix(WORKFLOW_KEYS, value ?? '')
        ),
      },
    },
    (args) => {
      const selectedTool = args.tool ?? DEFAULT_TOOL_NAME;
      const selectedFocus = args.focusArea ?? INSPECTION_FOCUS_AREAS[0];
      const guideText = buildReviewGuideText(selectedTool, selectedFocus);
      const workflowSection = args.workflow
        ? `\n\n${getWorkflowSummary(args.workflow)}`
        : '';
      return createPromptResponse(
        `Code review guide: ${selectedTool} / ${selectedFocus}`,
        guideText + workflowSection
      );
    }
  );
}

function registerSelectWorkflowPrompt(server: McpServer): void {
  const def = findPromptDef('select-workflow');
  server.registerPrompt(
    def.name,
    {
      title: def.title,
      description: def.description,
      argsSchema: {
        changeType: completable(
          z
            .string()
            .max(128)
            .optional()
            .describe(
              'Type of code change (e.g. api_change, refactor, bugfix).'
            ),
          (value) => completeByPrefix(CHANGE_TYPES, value ?? '')
        ),
      },
    },
    (args) => {
      const selected = args.changeType ?? CHANGE_TYPES[0];
      return createPromptResponse(
        `Workflow for: ${selected}`,
        buildWorkflowText(selected)
      );
    }
  );
}

function registerAnalyzeFilePrompt(server: McpServer): void {
  const def = findPromptDef('analyze-file');
  server.registerPrompt(
    def.name,
    {
      title: def.title,
      description: def.description,
      argsSchema: {
        goal: completable(
          z
            .string()
            .max(128)
            .optional()
            .describe(
              'Analysis goal (e.g. understand, refactor, document, smell_check, verify, full).'
            ),
          (value) => completeByPrefix(FILE_GOALS, value ?? '')
        ),
      },
    },
    (args) => {
      const selected = args.goal ?? FILE_GOALS[0];
      return createPromptResponse(
        `File analysis: ${selected}`,
        buildFileAnalysisText(selected)
      );
    }
  );
}

function registerToolChainPrompt(server: McpServer): void {
  const def = findPromptDef('tool-chain');
  server.registerPrompt(
    def.name,
    {
      title: def.title,
      description: def.description,
      argsSchema: {
        tool: completable(
          z
            .string()
            .max(128)
            .optional()
            .describe('Tool name to resolve the prerequisite chain for.'),
          (value) => completeByPrefix(TOOLS, value ?? '')
        ),
      },
    },
    (args) => {
      const selected = args.tool ?? DEFAULT_TOOL_NAME;
      return createPromptResponse(
        `Tool chain: ${selected}`,
        getToolChain(selected)
      );
    }
  );
}

export function registerAllPrompts(
  server: McpServer,
  instructions: string
): void {
  registerHelpPrompt(server, instructions);
  registerReviewGuidePrompt(server);
  registerSelectWorkflowPrompt(server);
  registerAnalyzeFilePrompt(server);
  registerToolChainPrompt(server);
}
