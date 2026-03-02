import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { getFileContextSnapshot } from '../lib/tools.js';
import {
  buildStructuredToolExecutionOptions,
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

const SYSTEM_INSTRUCTION = `
<role>
Code Refactoring Analyst.
</role>

<task>
Analyze one source file and return refactoring suggestions in exactly four categories:
1. naming
2. complexity
3. duplication
4. grouping
</task>

<constraints>
- Analyze only the provided file content.
- Do not suggest creating files or moving code across files.
- Every suggestion must reference a concrete target (name or location) from this file.
- Prefer high-impact structural improvements over minor style edits.
- Grouping: only report when related items are split by 50+ lines of unrelated code, or when one logical group is clearly fragmented.
- If no valid issues exist, return an empty suggestions array and a brief summary.
</constraints>

<output>
- Return strict JSON only.
- Do not add markdown, prose outside JSON, or extra keys.
- Suggestions must stay within the four allowed categories.
</output>
`;

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
      'Analyze cached file for naming, complexity, duplication, and grouping improvements. Prerequisite: load_file. Auto-infer language.',
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

      return {
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: `Language: ${language}\nFile: ${file.filePath}\n\nSource code:\n${file.content}\n\nAnalyze this file and provide refactoring suggestions across all four categories (naming, complexity, duplication, grouping).`,
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
