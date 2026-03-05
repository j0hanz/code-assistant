import {
  formatThinkingLevel,
  formatTimeoutSeconds,
  formatUsNumber,
} from '../lib/format.js';
import { toBulletedList, toInlineCode } from '../lib/format.js';
import { getToolContracts } from '../lib/tools.js';

interface ToolInfoEntry {
  name: string;
  purpose: string;
  model: string;
  taskSupport: string;
  thinkingLevel: string;
  timeout: string;
  maxOutputTokens: string;
  params: string;
  outputShape: string;
  gotchas: readonly string[];
  crossToolFlow: readonly string[];
  constraints?: readonly string[];
}

const GLOBAL_CONSTRAINTS = [
  'Diff budget: <= 120K chars.',
  'Structured output: tools return both `structuredContent` and JSON text `content`.',
] as const;

function formatParameterRow(entry: {
  name: string;
  type: string;
  required: boolean;
  constraints: string;
  description: string;
}): string {
  return `| ${entry.name} | ${entry.type} | ${entry.required ? 'Yes' : 'No'} | ${entry.constraints} | ${entry.description} |`;
}

function toToolInfoEntry(
  contract: ReturnType<typeof getToolContracts>[number]
): ToolInfoEntry {
  const parameterRows = [
    '| Param | Type | Required | Constraints | Description |',
    '|-------|------|----------|-------------|-------------|',
    ...contract.params.map((parameter) => formatParameterRow(parameter)),
  ];

  return {
    name: contract.name,
    purpose: contract.purpose,
    model: contract.model,
    taskSupport: contract.taskSupport,
    thinkingLevel: formatThinkingLevel(contract.thinkingLevel),
    timeout: formatTimeoutSeconds(contract.timeoutMs),
    maxOutputTokens: formatUsNumber(contract.maxOutputTokens),
    params: parameterRows.join('\n'),
    outputShape: `\`${contract.outputShape}\``,
    gotchas: contract.gotchas,
    crossToolFlow: contract.crossToolFlow,
    ...(contract.constraints
      ? { constraints: contract.constraints }
      : undefined),
  };
}

const TOOL_INFO_ENTRIES = Object.fromEntries(
  getToolContracts().map((contract) => [
    contract.name,
    toToolInfoEntry(contract),
  ])
) as Record<string, ToolInfoEntry>;

const TOOL_NAMES = Object.keys(TOOL_INFO_ENTRIES).sort((a, b) =>
  a.localeCompare(b)
);

function collectToolConstraints(
  entries: Record<string, ToolInfoEntry>
): string[] {
  const constraints = new Set<string>();

  for (const [toolName, entry] of Object.entries(entries)) {
    for (const constraint of entry.constraints ?? []) {
      constraints.add(`\`${toolName}\`: ${constraint}`);
    }
  }

  return Array.from(constraints).sort((a, b) => a.localeCompare(b));
}

function formatToolInfo(entry: ToolInfoEntry): string {
  const constraints = [...entry.gotchas, ...entry.crossToolFlow];
  return `# ${entry.name}
${entry.purpose}

## Model
\`${entry.model}\` (Thinking: ${entry.thinkingLevel}, Timeout: ${entry.timeout}, Tokens: ${entry.maxOutputTokens})

## Execution
- MCP task support: \`${entry.taskSupport}\`

## Parameters
${entry.params}

## Output
${entry.outputShape}

## Constraints
${constraints.map((item) => `- ${item}`).join('\n')}
`;
}

function formatCompactToolRow(entry: ToolInfoEntry): string {
  return `| ${toInlineCode(entry.name)} | ${entry.model} | ${toInlineCode(entry.taskSupport)} | ${entry.timeout} | ${entry.maxOutputTokens} | ${entry.purpose} |`;
}

export function buildCoreContextPack(): string {
  const rows = TOOL_NAMES.flatMap((toolName) => {
    const entry = TOOL_INFO_ENTRIES[toolName];
    return entry ? [formatCompactToolRow(entry)] : [];
  });

  return `# Core Context Pack

## Server Essentials
- Domain: Gemini-powered MCP server for code analysis.
- Surface: 7 analysis tools + internal resources + guided prompts.
- Transport: stdio with task lifecycle support for task-capable tools.
- Sync prerequisites: \`generate_diff\` and \`load_file\` are sync-only and advertise \`taskSupport: forbidden\`.

## Tool Matrix
| Tool | Model | Task Support | Timeout | Max Output Tokens | Purpose |
|------|-------|--------------|---------|-------------------|---------|
${rows.join('\n')}

## Shared Constraints
${toBulletedList(getSharedConstraints())}
`;
}

export function getSharedConstraints(): readonly string[] {
  const toolConstraints = collectToolConstraints(TOOL_INFO_ENTRIES);
  return [...GLOBAL_CONSTRAINTS, ...toolConstraints];
}

export function getToolInfoNames(): string[] {
  return TOOL_NAMES;
}

export function getToolInfo(toolName: string): string | undefined {
  const entry = TOOL_INFO_ENTRIES[toolName];
  if (!entry) {
    return undefined;
  }
  return formatToolInfo(entry);
}
