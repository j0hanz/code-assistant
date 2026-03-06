import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  type CodeExecutionResponse,
  generateWithCodeExecution,
} from '../lib/gemini/index.js';
import {
  buildStructuredToolExecutionOptions,
  getFileContextSnapshot,
  registerStructuredToolTask,
  requireToolContract,
} from '../lib/tools.js';
import { VerifyLogicInputSchema } from '../schemas/inputs.js';
import type { VerifyLogicInput } from '../schemas/inputs.js';
import {
  VerifyLogicGeminiResultSchema,
  VerifyLogicResultSchema,
} from '../schemas/outputs.js';
import type {
  VerifyLogicGeminiResult,
  VerifyLogicResult,
} from '../schemas/outputs.js';

const OUTCOME_OK = 'OUTCOME_OK';

const SYSTEM_INSTRUCTION = `
<role>
Code Verification Assistant.
</role>

<task>
Write Python code to verify the algorithm or logic in the user's request, run it, and report results.
</task>

<rules>
- Use only evidence from the provided source file. No external assumptions.
- Produce self-contained Python verification code with assertions.
- If source is not Python, translate only relevant logic to Python for equivalent checks.
- Include executable checks and explicit pass/fail evidence.
- If verification is not possible from file evidence, say so clearly.
</rules>

<output>
Return strict JSON matching the schema. No markdown, prose outside JSON, or extra keys.
</output>
`;

/**
 * Derives the `verified` flag from execution results.
 * Returns false when no code blocks were executed (model chose not to verify),
 * distinguishing "not verified" from "verified and failed".
 */
function deriveVerified(result: CodeExecutionResponse): boolean {
  if (result.executionResults.length === 0) {
    return false;
  }

  return result.executionResults.every((r) => r.outcome === OUTCOME_OK);
}

const TOOL_CONTRACT = requireToolContract('verify_logic');

export function registerVerifyLogicTool(server: McpServer): void {
  registerStructuredToolTask<
    VerifyLogicInput,
    VerifyLogicGeminiResult,
    VerifyLogicResult
  >(server, {
    name: 'verify_logic',
    title: 'Verify Logic',
    description:
      'Verify algorithms and logic in a cached file using Gemini code execution sandbox. Prerequisite: load_file. Auto-infer language.',
    inputSchema: VerifyLogicInputSchema,
    fullInputSchema: VerifyLogicInputSchema,
    resultSchema: VerifyLogicResultSchema,
    geminiSchema: VerifyLogicGeminiResultSchema,
    errorCode: 'E_VERIFY_LOGIC',
    ...buildStructuredToolExecutionOptions(TOOL_CONTRACT),
    requiresFile: true,
    progressContext: (input) => input.question.slice(0, 60),
    formatOutcome: (result) =>
      `${result.verified ? 'verified' : 'unverified'}, ${result.codeBlocks.length} code samples`,
    formatOutput: (result) => {
      const status = result.verified ? 'Verified' : 'Failed';
      const lines = [`**Status:** ${status}`, '', result.answer];

      if (result.codeBlocks.length > 0) {
        lines.push('', '### Code', '');
        for (const cb of result.codeBlocks) {
          lines.push(`\`\`\`${cb.language}`, cb.code, '```', '');
        }
      }

      if (result.executionResults.length > 0) {
        lines.push('### Execution Results', '');
        for (const er of result.executionResults) {
          lines.push(`- **${er.outcome}**${er.output ? `: ${er.output}` : ''}`);
        }
      }

      return lines.join('\n');
    },
    buildPrompt: (input, ctx) => {
      const {
        filePath,
        content,
        language: fileLanguage,
      } = getFileContextSnapshot(ctx);
      const language = input.language ?? fileLanguage;

      return {
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: `Language: ${language}\nFile: ${filePath}\n\n<source>\n${content}\n</source>\n\nVerification request: ${input.question}`,
      };
    },
    transformResult: (input, result, ctx) => {
      const { filePath, language: fileLanguage } = getFileContextSnapshot(ctx);
      return {
        ...result,
        filePath,
        language: input.language ?? fileLanguage,
      };
    },
    customGenerate: async (promptParts, _ctx, opts) => {
      const response = await generateWithCodeExecution({
        systemInstruction: promptParts.systemInstruction,
        prompt: promptParts.prompt,
        responseSchema: {},
        ...(opts.signal ? { signal: opts.signal } : {}),
        onLog: opts.onLog,
      });

      const verified = deriveVerified(response);

      return VerifyLogicGeminiResultSchema.parse({
        answer: response.text || 'No analysis text returned.',
        verified,
        codeBlocks: response.codeBlocks,
        executionResults: response.executionResults,
      });
    },
  });
}
