import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  buildStructuredToolExecutionOptions,
  getFileContextSnapshot,
  registerStructuredToolTask,
  requireToolContract,
} from '../lib/tools.js';
import { RefactorCodeInputSchema } from '../schemas/inputs.js';
import type { RefactorCodeInput } from '../schemas/inputs.js';
import {
  RefactorCodeGeminiResultSchema,
  RefactorCodeResultSchema,
} from '../schemas/outputs.js';
import type {
  RefactorCodeGeminiResult,
  RefactorCodeResult,
} from '../schemas/outputs.js';

const DEFAULT_MAX_SUGGESTIONS = 10;

function buildSystemInstruction(maxSuggestions: number): string {
  return `<role>Code Refactoring Analyst.</role>

<task>
Analyze one source file. Return up to ${String(maxSuggestions)} refactoring suggestions, highest priority first.
Categories (priority order): complexity, duplication, naming, grouping.
Focus: complexity and duplication. Only report naming/grouping if high-impact.
</task>

<constraints>
- Analyze only the provided file content.
- Do not suggest creating files or moving code across files.
- Every suggestion must reference a concrete target (name or location) from this file.
- Prefer high-impact structural improvements over minor style edits.
- Grouping: only report when related items are split by 50+ lines of unrelated code.
- If no valid issues exist, return empty suggestions array and a 1-sentence summary.
- Keep summary to 1-3 sentences. Keep currentIssue and suggestion to 1-2 sentences each.
</constraints>

<output>
- Return strict JSON only. No markdown, no prose outside JSON, no extra keys.
</output>`;
}

const TOOL_CONTRACT = requireToolContract('refactor_code');

function countByCategory(
  suggestions: readonly { category: string }[],
  category: string
): number {
  return suggestions.filter((s) => s.category === category).length;
}

export function registerRefactorCodeTool(server: McpServer): void {
  registerStructuredToolTask<
    RefactorCodeInput,
    RefactorCodeGeminiResult,
    RefactorCodeResult
  >(server, {
    name: 'refactor_code',
    title: 'Refactor Code',
    description:
      'Analyze cached file for complexity, duplication, naming, and grouping improvements. Prerequisite: load_file. Set maxSuggestions to cap output (default 10).',
    inputSchema: RefactorCodeInputSchema,
    fullInputSchema: RefactorCodeInputSchema,
    resultSchema: RefactorCodeResultSchema,
    geminiSchema: RefactorCodeGeminiResultSchema,
    errorCode: 'E_REFACTOR_CODE',
    ...buildStructuredToolExecutionOptions(TOOL_CONTRACT),
    requiresFile: true,
    progressContext: (input) => input.language ?? 'auto-detect',
    formatOutcome: (result) => {
      const total =
        result.namingIssuesCount +
        result.complexityIssuesCount +
        result.duplicationIssuesCount +
        result.groupingIssuesCount;
      return `${total} suggestion${total === 1 ? '' : 's'}`;
    },
    formatOutput: (result) => {
      const lines = [result.summary];

      if (result.suggestions.length > 0) {
        lines.push('', '### Suggestions', '');
        for (const s of result.suggestions) {
          lines.push(`- **[${s.category}]** \`${s.target}\` (${s.priority})  `);
          lines.push(`  ${s.currentIssue} — ${s.suggestion}`);
        }
      }

      return lines.join('\n');
    },
    buildPrompt: (input, ctx) => {
      const file = getFileContextSnapshot(ctx);
      const language = input.language ?? file.language;
      const maxSuggestions = input.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS;

      return {
        systemInstruction: buildSystemInstruction(maxSuggestions),
        prompt: `Language: ${language}\nFile: ${file.filePath}\n\n${file.content}`,
      };
    },
    transformResult: (_input, result, ctx) => {
      const file = getFileContextSnapshot(ctx);

      return {
        ...result,
        filePath: file.filePath,
        language: file.language,
        namingIssuesCount: countByCategory(result.suggestions, 'naming'),
        complexityIssuesCount: countByCategory(
          result.suggestions,
          'complexity'
        ),
        duplicationIssuesCount: countByCategory(
          result.suggestions,
          'duplication'
        ),
        groupingIssuesCount: countByCategory(result.suggestions, 'grouping'),
      };
    },
  });
}
