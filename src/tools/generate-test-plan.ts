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
</role>

<task>
Generate a prioritized test plan for the provided diff.
</task>

<rules>
- Generate tests ONLY for code paths directly modified or affected by the diff. Do not generate tests for unchanged or unrelated functions.
- Focus on observable behavior changes.
- Ignore internal refactors that do not affect contract.
- Priority: must_have = tests for critical/breaking behavior changes or bug fixes; should_have = tests for new features or edge cases; nice_to_have = tests for minor paths or defensive coverage.
- Do not generate redundant test cases that verify the same code path with trivially different inputs. Each test must cover a distinct scenario.
</rules>

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
      const { diff, parsedFiles, repository } = getDiffContextSnapshot(ctx);
      const { stats, paths } = computeDiffStatsAndPathsFromFiles(parsedFiles);
      const optionalLines = formatOptionalLines([
        { label: 'Language', value: input.language },
        { label: 'Test Framework', value: input.testFramework },
        { label: 'Max Test Cases', value: input.maxTestCases },
      ]);

      return {
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: `
Repository: ${repository}${optionalLines}
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
