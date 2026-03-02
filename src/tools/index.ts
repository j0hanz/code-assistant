import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAnalyzeComplexityTool } from './analyze-complexity.js';
import { registerAnalyzePrImpactTool } from './analyze-pr-impact.js';
import { registerAskTool } from './ask.js';
import { registerDetectApiBreakingTool } from './detect-api-breaking.js';
import { registerDetectCodeSmellsTool } from './detect-code-smells.js';
import { registerGenerateDiffTool } from './generate-diff.js';
import { registerGenerateDocumentationTool } from './generate-documentation.js';
import { registerGenerateReviewSummaryTool } from './generate-review-summary.js';
import { registerGenerateTestPlanTool } from './generate-test-plan.js';
import { registerLoadFileTool } from './load-file.js';
import { registerRefactorCodeTool } from './refactor-code.js';
import { registerVerifyLogicTool } from './verify-logic.js';
import { registerWebSearchTool } from './web-search.js';

type ToolRegistrar = (server: McpServer) => void;

const TOOL_REGISTRARS = [
  registerGenerateDiffTool,
  registerAnalyzePrImpactTool,
  registerGenerateReviewSummaryTool,
  registerGenerateTestPlanTool,
  registerAnalyzeComplexityTool,
  registerDetectApiBreakingTool,
  registerLoadFileTool,
  registerRefactorCodeTool,
  registerGenerateDocumentationTool,
  registerDetectCodeSmellsTool,
  registerAskTool,
  registerVerifyLogicTool,
  registerWebSearchTool,
] as const satisfies readonly ToolRegistrar[];

export function registerAllTools(server: McpServer): void {
  for (const registrar of TOOL_REGISTRARS) {
    registrar(server);
  }
}
