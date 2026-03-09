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
Technical Change Analyst — strict, objective, evidence-based.
</role>

<task>
Analyze the unified diff to assess severity, risk categories, breaking changes, and rollback complexity.
</task>

<severity_criteria>
- critical: Production outage risk, data loss, security vulnerability introduced, or corruption of persistent state.
- high: Breaking API/contract change affecting external consumers, removal of exported symbols, or schema migration required.
- medium: Behavioral change to existing features, new integration points, or non-trivial config changes.
- low: Internal refactors, documentation, tests, non-breaking additions, style/formatting, dependency patches.
Default to the lowest severity supported by evidence.
</severity_criteria>

<rollback_criteria>
- trivial: Pure additions or config changes; revert is a clean git revert with no side effects.
- moderate: Behavioral changes that require re-testing but no data migration.
- complex: Schema/data migrations, multi-service coordination, or state changes that persist beyond the code.
- irreversible: Destructive data operations, dropped columns/tables, or published API removals already consumed.
</rollback_criteria>

<rules>
- Use only diff evidence. No external assumptions.
- Ignore formatting/style/whitespace unless behavior changes.
- Categories must be from this set only: breaking_change, api_change, schema_change, config_change, dependency_update, security_fix, deprecation, performance_change, bug_fix, feature_addition.
- Report breaking changes only for explicitly exported/public symbols that require consumer code changes.
- If changes are purely additive and do not alter existing behavior, severity should be low.
</rules>

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
    buildPrompt: (_input, ctx) => {
      const { diff, parsedFiles, repository } = getDiffContextSnapshot(ctx);
      const { stats, summary: fileSummary } =
        computeDiffStatsAndSummaryFromFiles(parsedFiles);
      const languageSegment = formatLanguageSegment(_input.language);

      return {
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: `
Repository: ${repository}${languageSegment}
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
