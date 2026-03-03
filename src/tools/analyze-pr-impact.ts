import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { computeDiffStatsAndSummaryFromFiles } from '../lib/diff.js';
import { formatLanguageSegment } from '../lib/format.js';
import {
  buildStructuredToolExecutionOptions,
  getDiffContextSnapshot,
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
- Risk categories: breaking_change, api_change, schema_change, config_change, dependency_update, security_fix, deprecation, performance_change, bug_fix, feature_addition. Only use these categories.
- Breaking changes (API, contract, schema)
- Rollback complexity (trivial/moderate/complex/irreversible)
</task>

<constraints>
- Base analysis ONLY on the provided diff. Do not introduce external information.
- Ignore formatting, style, and whitespace changes unless they affect logic or behavior.
</constraints>

<output>
Return strict JSON matching the schema. No markdown, prose outside JSON, or extra keys.
</output>
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

<diff>
${diff}
</diff>

Analyze the PR impact based on the diff and change stats above.
`,
      };
    },
  });
}
