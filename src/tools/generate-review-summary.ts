import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { formatLanguageSegment } from '../lib/format.js';
import {
  buildStructuredToolExecutionOptions,
  getDiffContextSnapshot,
  registerStructuredToolTask,
  requireToolContract,
} from '../lib/tools.js';
import {
  type GenerateReviewSummaryInput,
  GenerateReviewSummaryInputSchema,
} from '../schemas/inputs.js';
import {
  ReviewSummaryGeminiResultSchema,
  ReviewSummaryResultSchema,
} from '../schemas/outputs.js';

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
- Recommend action: merge, request changes, or block.
</task>

<constraints>
- Focus on logic and behavior changes.
- Be concise and actionable.
- Ignore style, formatting, and typos unless they affect logic.
</constraints>

<output>
Return strict JSON matching the schema. No markdown, prose outside JSON, or extra keys.
</output>
`;
export function registerGenerateReviewSummaryTool(server: McpServer): void {
  registerStructuredToolTask(server, {
    name: 'generate_review_summary',
    title: 'Generate Review Summary',
    description:
      'Summarize diff and risk level. Prerequisite: generate_diff. Auto-infer repo/language.',
    inputSchema: GenerateReviewSummaryInputSchema,
    fullInputSchema: GenerateReviewSummaryInputSchema,
    resultSchema: ReviewSummaryResultSchema,
    geminiSchema: ReviewSummaryGeminiResultSchema,
    errorCode: 'E_REVIEW_SUMMARY',
    ...buildStructuredToolExecutionOptions(TOOL_CONTRACT),
    requiresDiff: true,
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

<diff>
${diff}
</diff>

Summarize the PR and provide a merge recommendation based on the diff above.
`,
      };
    },
  });
}
