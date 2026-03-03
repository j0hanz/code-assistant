import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { computeDiffStatsAndPathsFromFiles } from '../lib/diff.js';
import { formatOptionalLines } from '../lib/format.js';
import {
  buildStructuredToolExecutionOptions,
  getDiffContextSnapshot,
  registerStructuredToolTask,
  requireToolContract,
} from '../lib/tools.js';
import { GenerateTestPlanInputSchema } from '../schemas/inputs.js';
import { TestPlanResultSchema } from '../schemas/outputs.js';

const SYSTEM_INSTRUCTION = `
<role>
QA Automation Architect.
You are an expert in test strategy and coverage analysis.
</role>

<task>
Generate a prioritized test plan for the provided diff:
- Focus on negative cases, edge cases, and boundary conditions.
- Target branch coverage and integration points.
</task>

<constraints>
- Generate tests ONLY for code paths directly modified or affected by the diff. Do not generate tests for unchanged or unrelated functions.
- Focus on observable behavior changes.
- Ignore internal refactors that do not affect contract.
</constraints>

<output>
Return strict JSON matching the schema. No markdown, prose outside JSON, or extra keys.
</output>
`;
const TOOL_CONTRACT = requireToolContract('generate_test_plan');

export function registerGenerateTestPlanTool(server: McpServer): void {
  registerStructuredToolTask(server, {
    name: 'generate_test_plan',
    title: 'Generate Test Plan',
    description:
      'Generate test cases. Prerequisite: generate_diff. Auto-infer repo/language/framework.',
    inputSchema: GenerateTestPlanInputSchema,
    fullInputSchema: GenerateTestPlanInputSchema,
    resultSchema: TestPlanResultSchema,
    errorCode: 'E_GENERATE_TEST_PLAN',
    ...buildStructuredToolExecutionOptions(TOOL_CONTRACT),
    requiresDiff: true,
    formatOutcome: (result) => `${result.testCases.length} cases`,
    formatOutput: (result) => {
      const lines = [
        result.summary,
        '',
        `### Test Cases (${String(result.testCases.length)})`,
        '',
      ];

      for (const tc of result.testCases) {
        lines.push(`- **${tc.name}** \`${tc.type}\` (${tc.priority})  `);
        lines.push(`  ${tc.description}`);
      }

      if (result.coverageSummary) {
        lines.push('', '### Coverage', '', result.coverageSummary);
      }

      return lines.join('\n');
    },
    transformResult: (input, result) => {
      const cappedTestCases = result.testCases.slice(
        0,
        input.maxTestCases ?? result.testCases.length
      );
      return { ...result, testCases: cappedTestCases };
    },
    buildPrompt: (input, ctx) => {
      const { diff, parsedFiles } = getDiffContextSnapshot(ctx);
      const { stats, paths } = computeDiffStatsAndPathsFromFiles(parsedFiles);
      const optionalLines = formatOptionalLines([
        { label: 'Language', value: input.language },
        { label: 'Test Framework', value: input.testFramework },
        { label: 'Max Test Cases', value: input.maxTestCases },
      ]);

      return {
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: `
Repository: ${input.repository}${optionalLines}
Stats: ${stats.files} files, +${stats.added}, -${stats.deleted}
Changed Files: ${paths.join(', ')}

<diff>
${diff}
</diff>

Generate an actionable test plan based on the diff and stats above.
`,
      };
    },
  });
}
