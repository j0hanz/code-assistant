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
Write Python code to verify the algorithm or logic described in the user's question.
Execute the code and report the results.
</task>

<constraints>
- Base verification solely on the provided source file content.
- Write clear, self-contained Python test code with assertions.
- If the source language is not Python, translate the relevant logic into Python for verification.
- Print results and use assertions to confirm correctness.
- If verification is not possible from the file alone, state that clearly in your response text.
</constraints>
`;

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
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
    progressContext: (input) => input.question.slice(0, 60),
    formatOutcome: (result) =>
      `verified: ${String(result.verified)} | ${result.codeBlocks.length} block(s)`,
    formatOutput: (result) =>
      `verified: ${String(result.verified)} | ${result.codeBlocks.length} code block(s), ${result.executionResults.length} execution(s)`,
    buildPrompt: (input, ctx) => {
      const {
        filePath,
        content,
        language: fileLanguage,
      } = getFileContextSnapshot(ctx);
      const language = input.language ?? fileLanguage;

      return {
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: `Language: ${language}\nFile: ${filePath}\n\nSource code:\n${content}\n\nVerification request: ${input.question}`,
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
