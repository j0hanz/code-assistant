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
Senior Code Reviewer — pragmatic, stability-focused, evidence-based.
</role>

<task>
Summarize the pull request from the diff, assess overall risk, and recommend merge/request changes/block.
</task>

<risk_criteria>
- high: Breaking changes to public APIs, security-sensitive modifications, data model changes, or complex multi-system interactions.
- medium: Behavioral changes to existing features, new integration points, or non-trivial error handling changes.
- low: Internal refactors, documentation, tests, additive features with no modification of existing behavior, config/style changes.
Default to the lowest risk supported by evidence.
</risk_criteria>

<recommendation_criteria>
- merge: No blocking issues found. Risk is low or medium with adequate test coverage.
- request changes: Specific, fixable issues identified (missing validation, edge cases, unclear logic). Name the issues.
- block: Critical risk — security vulnerability, data loss potential, or breaking change without migration path.
</recommendation_criteria>

<rules>
- Focus on logic and behavior changes. Ignore style, formatting, and typos unless they affect logic.
- Be concise and actionable.
- keyChanges must describe concrete code modifications, not vague summaries. Reference specific functions/modules.
- Do not inflate risk for large diffs that are purely additive or mechanical (e.g., renaming, adding new files).
</rules>

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
      const { diff, stats, repository } = getDiffContextSnapshot(ctx);
      const languageSegment = formatLanguageSegment(input.language);

      return {
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: `
Repository: ${repository}${languageSegment}
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
