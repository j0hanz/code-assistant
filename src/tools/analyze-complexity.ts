import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { buildLanguageDiffPrompt } from '../lib/format.js';
import { getDiffContextSnapshot } from '../lib/tools.js';
import {
  buildStructuredToolExecutionOptions,
  registerStructuredToolTask,
  requireToolContract,
} from '../lib/tools.js';
import { AnalyzeComplexityInputSchema } from '../schemas/inputs.js';
import { AnalyzeComplexityResultSchema } from '../schemas/outputs.js';

const SYSTEM_INSTRUCTION = `
<role>
Algorithm Complexity Analyst.
You are an expert in Big-O analysis and performance optimization.
</role>

<task>
Analyze the time and space complexity of the code changes:
- Compare new complexity vs. original implementation.
- Detect performance degradation (regression).
- Identify bottlenecks (nested loops, recursion, allocations).
</task>

<constraints>
- Focus on the changed code paths.
- Flag degradation only if complexity class worsens (e.g., O(n) -> O(n^2)).
- Return valid JSON matching the schema.
</constraints>
`;
const TOOL_CONTRACT = requireToolContract('analyze_time_space_complexity');

export function registerAnalyzeComplexityTool(server: McpServer): void {
  registerStructuredToolTask(server, {
    name: 'analyze_time_space_complexity',
    title: 'Analyze Time & Space Complexity',
    description:
      'Analyze Big-O complexity. Prerequisite: generate_diff. Auto-infer language.',
    inputSchema: AnalyzeComplexityInputSchema,
    fullInputSchema: AnalyzeComplexityInputSchema,
    resultSchema: AnalyzeComplexityResultSchema,
    errorCode: 'E_ANALYZE_COMPLEXITY',
    ...buildStructuredToolExecutionOptions(TOOL_CONTRACT),
    requiresDiff: true,
    progressContext: (input) => input.language ?? 'auto-detect',
    formatOutcome: (result) =>
      result.isDegradation
        ? 'Performance degradation detected'
        : 'No degradation',
    formatOutput: (result) => {
      const lines = [
        `**Time Complexity:** ${result.timeComplexity}`,
        `**Space Complexity:** ${result.spaceComplexity}`,
        '',
        result.explanation,
      ];

      if (result.potentialBottlenecks.length > 0) {
        lines.push('', '### Potential Bottlenecks', '');
        for (const b of result.potentialBottlenecks) {
          lines.push(`- ${b}`);
        }
      }

      if (result.isDegradation) {
        lines.push('', '> **Warning:** Performance degradation detected.');
      }

      return lines.join('\n');
    },
    buildPrompt: (input, ctx) => {
      const { diff } = getDiffContextSnapshot(ctx);

      return {
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: buildLanguageDiffPrompt(
          input.language,
          diff,
          'Based on the diff above, analyze the Big-O time and space complexity.'
        ),
      };
    },
  });
}
