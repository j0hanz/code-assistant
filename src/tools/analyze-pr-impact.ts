import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { computeDiffStatsAndSummaryFromFiles } from '../lib/diff.js';
import { formatLanguageSegment } from '../lib/format.js';
import { getDiffContextSnapshot } from '../lib/tools.js';
import {
  buildStructuredToolExecutionOptions,
  registerStructuredToolTask,
  requireToolContract,
} from '../lib/tools.js';
import { AnalyzePrImpactInputSchema } from '../schemas/inputs.js';
import { PrImpactResultSchema } from '../schemas/outputs.js';

const SYSTEM_INSTRUCTION = `
<role>
Technical Change Analyst.
You are a strict, objective auditor of code changes.
</role>

<task>
Analyze the unified diff to assess:
- Severity (low/medium/high/critical)
- Risk categories (security, stability, etc.)
- Breaking changes (API, contract, schema)
- Rollback complexity
</task>

<constraints>
- Base analysis ONLY on the provided diff. No external inference.
- Ignore formatting/style changes unless they affect logic.
- Return valid JSON matching the schema.
</constraints>
`;
const TOOL_CONTRACT = requireToolContract('analyze_pr_impact');

export function registerAnalyzePrImpactTool(server: McpServer): void {
  registerStructuredToolTask(server, {
    name: 'analyze_pr_impact',
    title: 'Analyze PR Impact',
    description:
      'Assess impact and risk from cached diff. Prerequisite: generate_diff. Auto-infer repo/language.',
    inputSchema: AnalyzePrImpactInputSchema,
    fullInputSchema: AnalyzePrImpactInputSchema,
    resultSchema: PrImpactResultSchema,
    errorCode: 'E_ANALYZE_IMPACT',
    ...buildStructuredToolExecutionOptions(TOOL_CONTRACT),
    requiresDiff: true,
    progressContext: (input) => input.repository,
    formatOutcome: (result) => `severity: ${result.severity}`,
    formatOutput: (result) => {
      const lines = [
        `**Severity:** ${result.severity}`,
        `**Rollback Complexity:** ${result.rollbackComplexity}`,
        '',
        result.summary,
      ];

      if (result.categories.length > 0) {
        lines.push('', '### Categories', '');
        for (const c of result.categories) {
          lines.push(`- ${c}`);
        }
      }

      if (result.affectedAreas.length > 0) {
        lines.push('', '### Affected Areas', '');
        for (const a of result.affectedAreas) {
          lines.push(`- ${a}`);
        }
      }

      if (result.breakingChanges.length > 0) {
        lines.push('', '### Breaking Changes', '');
        for (const bc of result.breakingChanges) {
          lines.push(`- ${bc}`);
        }
      }

      return lines.join('\n');
    },
    buildPrompt: (input, ctx) => {
      const { diff, parsedFiles } = getDiffContextSnapshot(ctx);
      const { stats, summary: fileSummary } =
        computeDiffStatsAndSummaryFromFiles(parsedFiles);
      const languageSegment = formatLanguageSegment(input.language);

      return {
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: `
Repository: ${input.repository}${languageSegment}
Change Stats: ${stats.files} files, +${stats.added} lines, -${stats.deleted} lines.
Changed Files:
${fileSummary}

Diff:
${diff}

Based on the diff and change stats above, analyze the PR impact.
`,
      };
    },
  });
}
