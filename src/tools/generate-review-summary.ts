import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { formatLanguageSegment } from '../lib/format.js';
import { getDiffContextSnapshot } from '../lib/tools.js';
import {
  buildStructuredToolExecutionOptions,
  registerStructuredToolTask,
  requireToolContract,
} from '../lib/tools.js';
import {
  type GenerateReviewSummaryInput,
  GenerateReviewSummaryInputSchema,
} from '../schemas/inputs.js';
import { ReviewSummaryResultSchema } from '../schemas/outputs.js';

const ReviewSummaryModelSchema = ReviewSummaryResultSchema.omit({
  stats: true,
});
const TOOL_CONTRACT = requireToolContract('generate_review_summary');
const SYSTEM_INSTRUCTION = `
<role>
Senior Code Reviewer.
You are a pragmatic engineer focused on stability and maintainability.
</role>

<task>
Summarize the pull request based on the diff:
- Assess overall risk (low/medium/high).
- Highlight key logic/behavior changes.
- Recommend action: merge, squash, or block.
</task>

<constraints>
- Focus on logic and behavior; ignore style, formatting, and typos.
- Be concise and actionable.
- Return valid JSON matching the schema.
</constraints>
`;
export function registerGenerateReviewSummaryTool(server: McpServer): void {
  registerStructuredToolTask(server, {
    name: 'generate_review_summary',
    title: 'Generate Review Summary',
    description:
      'Summarize diff and risk level. Prerequisite: generate_diff. Auto-infer repo/language.',
    inputSchema: GenerateReviewSummaryInputSchema,
    fullInputSchema: GenerateReviewSummaryInputSchema,
    resultSchema: ReviewSummaryModelSchema,
    errorCode: 'E_REVIEW_SUMMARY',
    ...buildStructuredToolExecutionOptions(TOOL_CONTRACT),
    requiresDiff: true,
    progressContext: (input) => input.repository,
    formatOutcome: (result) => `risk: ${result.overallRisk}`,
    transformResult: (_input: GenerateReviewSummaryInput, result, ctx) => {
      const { stats } = getDiffContextSnapshot(ctx);
      return {
        ...result,
        stats: {
          filesChanged: stats.files,
          linesAdded: stats.added,
          linesRemoved: stats.deleted,
        },
      };
    },
    formatOutput: (result) => {
      const lines = [
        `**Risk:** ${result.overallRisk}`,
        `**Recommendation:** ${result.recommendation}`,
        '',
        result.summary,
      ];

      if (result.keyChanges.length > 0) {
        lines.push('', '### Key Changes', '');
        for (const kc of result.keyChanges) {
          lines.push(`- ${kc}`);
        }
      }

      return lines.join('\n');
    },
    buildPrompt: (input: GenerateReviewSummaryInput, ctx) => {
      const { diff, stats } = getDiffContextSnapshot(ctx);
      const languageSegment = formatLanguageSegment(input.language);

      return {
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: `
Repository: ${input.repository}${languageSegment}
Stats: ${stats.files} files, +${stats.added}, -${stats.deleted}

Diff:
${diff}

Based on the diff and stats above, summarize the PR and provide a merge recommendation.
`,
      };
    },
  });
}
