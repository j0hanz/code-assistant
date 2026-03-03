import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  buildStructuredToolExecutionOptions,
  getFileContextSnapshot,
  registerStructuredToolTask,
  requireToolContract,
} from '../lib/tools.js';
import { DetectCodeSmellsInputSchema } from '../schemas/inputs.js';
import type { DetectCodeSmellsInput } from '../schemas/inputs.js';
import {
  DetectCodeSmellsGeminiResultSchema,
  DetectCodeSmellsResultSchema,
} from '../schemas/outputs.js';
import type {
  DetectCodeSmellsGeminiResult,
  DetectCodeSmellsResult,
} from '../schemas/outputs.js';

const SYSTEM_INSTRUCTION = `
<role>
Code Smell Detector.
</role>

<task>
Analyze one source file for structural code smells: dead_code, magic_number, long_function, deep_nesting, god_class, feature_envy, primitive_obsession, shotgun_surgery, data_clump, long_parameter_list.
</task>

<constraints>
- Focus on structural/design smells only. Do NOT report style/formatting issues.
- Do NOT overlap with refactor_code findings (naming, duplication, grouping). Focus on smells that indicate deeper design problems.
- Only report smells from the types listed in <task>. Do not invent new smell types.
- If a code section is borderline, err on the side of not reporting it.
- Every smell must reference a concrete symbol, block, or line range in the file.
- Severity: info = minor/cosmetic, warning = should fix, error = significant design problem.
- overallHealth: healthy = 0 warnings/errors, needs_attention = some warnings, unhealthy = any error-level smell.
- If the file is clean, return an empty smells array with overallHealth = "healthy".
</constraints>

<output>
Return strict JSON matching the schema. No markdown, prose outside JSON, or extra keys.
</output>
`;

const TOOL_CONTRACT = requireToolContract('detect_code_smells');

export function registerDetectCodeSmellsTool(server: McpServer): void {
  registerStructuredToolTask<
    DetectCodeSmellsInput,
    DetectCodeSmellsGeminiResult,
    DetectCodeSmellsResult
  >(server, {
    name: 'detect_code_smells',
    title: 'Detect Code Smells',
    description:
      'Detect structural code smells in a cached file. Prerequisite: load_file. Auto-infer language.',
    inputSchema: DetectCodeSmellsInputSchema,
    fullInputSchema: DetectCodeSmellsInputSchema,
    resultSchema: DetectCodeSmellsResultSchema,
    geminiSchema: DetectCodeSmellsGeminiResultSchema,
    errorCode: 'E_DETECT_CODE_SMELLS',
    ...buildStructuredToolExecutionOptions(TOOL_CONTRACT),
    requiresFile: true,
    formatOutcome: (result) => {
      const parts: string[] = [];
      if (result.errorCount > 0) parts.push(`${result.errorCount} error`);
      if (result.warningCount > 0) parts.push(`${result.warningCount} warning`);
      if (result.infoCount > 0) parts.push(`${result.infoCount} info`);
      return parts.length > 0
        ? `${result.overallHealth} — ${parts.join(', ')}`
        : result.overallHealth;
    },
    formatOutput: (result) => {
      const lines = [result.summary];

      lines.push('', `**Health:** ${result.overallHealth}`);
      lines.push(
        `**Findings:** ${result.errorCount} error, ${result.warningCount} warning, ${result.infoCount} info`
      );

      if (result.smells.length > 0) {
        lines.push('', '### Code Smells', '');
        for (const smell of result.smells) {
          const icon =
            smell.severity === 'error'
              ? '🔴'
              : smell.severity === 'warning'
                ? '🟡'
                : '🔵';
          lines.push(`${icon} **${smell.type}** — \`${smell.target}\``);
          lines.push(`  ${smell.explanation}`);
          lines.push(`  *Fix:* ${smell.suggestion}`);
          lines.push('');
        }
      }

      return lines.join('\n');
    },
    buildPrompt: (input, ctx) => {
      const file = getFileContextSnapshot(ctx);
      const language = input.language ?? file.language;

      return {
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: `Language: ${language}\nFile: ${file.filePath}\n\n<source>\n${file.content}\n</source>\n\nDetect structural code smells in this file.`,
      };
    },
    transformResult: (_input, result, ctx) => {
      const file = getFileContextSnapshot(ctx);

      return {
        ...result,
        filePath: file.filePath,
        language: file.language,
        infoCount: result.smells.filter((s) => s.severity === 'info').length,
        warningCount: result.smells.filter((s) => s.severity === 'warning')
          .length,
        errorCount: result.smells.filter((s) => s.severity === 'error').length,
      };
    },
  });
}
