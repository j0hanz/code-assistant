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
Code Smell Detector — strict, evidence-based structural analysis.
</role>

<task>
Analyze one source file for structural code smells from this closed set:
dead_code, magic_number, long_function, deep_nesting, god_class, feature_envy, primitive_obsession, shotgun_surgery, data_clump, long_parameter_list.
</task>

<thresholds>
Apply these minimum thresholds. Do not report below them.
- long_function: >80 lines of logic (exclude blank lines, comments, closing braces) AND high cyclomatic complexity (multiple branches/loops). Linear config mappers, sequential builders, or simple delegation chains do NOT qualify regardless of line count.
- long_parameter_list: >6 parameters. 4-6 params is acceptable, especially when the caller resolves defaults and passes resolved values to keep inner functions pure. Only flag if the params form an obvious data clump (3+ params always passed together) or cause genuine confusion (multiple params of the same type with unclear ordering).
- deep_nesting: >4 levels of nesting (not counting namespace/class/function definition).
- god_class: Only for classes or module-scoped objects with 500+ lines that mix 3+ unrelated responsibilities WITHOUT internal separation. A large module that uses clear section separators, has cohesive purpose, or follows a single domain (e.g., "Gemini call engine") is NOT a god class — even if it contains multiple helper functions. Modules are not classes; do not penalize a file for being the single home of a cohesive subsystem.
- magic_number: Numeric literals outside of 0, 1, -1 used in logic/conditions without a named constant. Array indices and common defaults (e.g., 1.0 for temperature) are NOT magic numbers.
- dead_code: Unreachable code paths, unused exports, or functions with no callers within the file. Do NOT flag code that may be called externally (exports) unless clearly dead.
</thresholds>

<rules>
- Focus on structural/design smells only. Do NOT report style/formatting issues.
- Do NOT overlap with refactor_code findings (naming, duplication, grouping).
- Only report smells from the types listed in <task>. Do not invent new types.
- If a code section is borderline, do NOT report it. Err strongly toward fewer, higher-confidence findings.
- Every smell must reference a concrete symbol or block name in the file.
- Verify each claim from file evidence before emitting a smell: confirm symbol details, count relevant lines/nesting, and name concrete responsibilities where claimed.
- Suggestions must be actionable AND an improvement over the current design. Do not suggest refactors that add abstraction overhead (builder patterns, utility classes) for simple linear code. Do not suggest moving parameters into an object when the current signature is a deliberate pure-function design.
- Severity: info = minor/cosmetic, warning = should fix soon, error = significant design problem.
- overallHealth: healthy = 0 warnings/errors, needs_attention = some warnings, unhealthy = any error-level smell.
- If the file is clean or only has borderline issues, return an empty smells array with overallHealth = "healthy".
</rules>

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

      let infoCount = 0;
      let warningCount = 0;
      let errorCount = 0;
      for (const s of result.smells) {
        if (s.severity === 'info') infoCount++;
        else if (s.severity === 'warning') warningCount++;
        else errorCount++;
      }

      return {
        ...result,
        filePath: file.filePath,
        language: file.language,
        infoCount,
        warningCount,
        errorCount,
      };
    },
  });
}
