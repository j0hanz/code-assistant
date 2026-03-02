import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { getErrorMessage } from '../lib/errors.js';
import {
  createNoFileError,
  getFile,
  validateFileBudget,
} from '../lib/file-store.js';
import {
  type CodeExecutionResponse,
  generateWithCodeExecution,
} from '../lib/gemini/index.js';
import {
  createErrorToolResponse,
  createToolResponse,
  wrapToolHandler,
} from '../lib/tools.js';
import { VerifyLogicInputSchema } from '../schemas/inputs.js';
import {
  DefaultOutputSchema,
  VerifyLogicResultSchema,
} from '../schemas/outputs.js';
import type { VerifyLogicResult } from '../schemas/outputs.js';

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

export function registerVerifyLogicTool(server: McpServer): void {
  server.registerTool(
    'verify_logic',
    {
      title: 'Verify Logic',
      description:
        'Verify algorithms and logic in a cached file using Gemini code execution sandbox. Prerequisite: load_file. Auto-infer language.',
      inputSchema: VerifyLogicInputSchema,
      outputSchema: DefaultOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    wrapToolHandler(
      {
        toolName: 'verify_logic',
        progressContext: (input) => input.question.slice(0, 60),
      },
      async (input) => {
        const file = getFile();
        if (!file) {
          return createNoFileError();
        }

        // Snapshot file content once to avoid TOCTOU race
        const { content: fileContent, filePath, language: fileLanguage } = file;

        const budgetError = validateFileBudget(fileContent);
        if (budgetError) {
          return budgetError;
        }

        const parsed = VerifyLogicInputSchema.parse(input);
        const language = parsed.language ?? fileLanguage;

        const prompt = `Language: ${language}\nFile: ${filePath}\n\nSource code:\n${fileContent}\n\nVerification request: ${parsed.question}`;

        try {
          const response = await generateWithCodeExecution({
            systemInstruction: SYSTEM_INSTRUCTION,
            prompt,
            responseSchema: {},
          });

          const verified = deriveVerified(response);

          const result: VerifyLogicResult = VerifyLogicResultSchema.parse({
            answer: response.text || 'No analysis text returned.',
            verified,
            codeBlocks: response.codeBlocks,
            executionResults: response.executionResults,
            filePath,
            language,
          });

          const summary = `verified: ${String(verified)} | ${result.codeBlocks.length} code block(s), ${result.executionResults.length} execution(s)`;

          return createToolResponse(
            {
              ok: true as const,
              result,
            },
            summary
          );
        } catch (error) {
          return createErrorToolResponse(
            'E_VERIFY_LOGIC',
            getErrorMessage(error)
          );
        }
      }
    )
  );
}
