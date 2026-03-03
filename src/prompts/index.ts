import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { toInlineCode } from '../lib/format.js';
import {
  getToolContract,
  getToolContractNames,
  INSPECTION_FOCUS_AREAS,
} from '../lib/tools.js';

export const PROMPT_DEFINITIONS = [
  {
    name: 'get-help',
    title: 'Get Help',
    description:
      'Returns full server instructions: capabilities, tools, resources, constraints, and task lifecycle.',
  },
  {
    name: 'review-guide',
    title: 'Review Guide',
    description:
      'Returns a workflow guide for a specific tool and focus area. Supports auto-completion.',
  },
] as const;

const TOOLS = getToolContractNames();
const DEFAULT_TOOL_NAME = TOOLS[0] ?? 'analyze_pr_impact';

type FocusArea = (typeof INSPECTION_FOCUS_AREAS)[number];
const TOOL_DESCRIPTION_TEXT = 'Select tool for review guide.';
const FOCUS_DESCRIPTION_TEXT = 'Select focus area.';

const FOCUS_AREA_GUIDES: Record<FocusArea, string> = {
  security: 'Focus: Injection, Auth, Crypto, OWASP.',
  correctness: 'Focus: Logic, Edge Cases, Types.',
  performance: 'Focus: Complexity, Memory, Latency.',
  regressions: 'Focus: Behavior Changes, Breaking APIs.',
  tests: 'Focus: Coverage, Error Paths.',
  maintainability: 'Focus: Complexity, Readability, Patterns.',
  concurrency: 'Focus: Races, Deadlocks, Atomicity.',
};

function isFocusArea(value: string): value is FocusArea {
  return INSPECTION_FOCUS_AREAS.includes(value as FocusArea);
}

export function findPromptDef(
  name: string
): (typeof PROMPT_DEFINITIONS)[number] {
  const def = PROMPT_DEFINITIONS.find((d) => d.name === name);
  if (!def) {
    throw new Error(`Unknown prompt definition: ${name}`);
  }
  return def;
}

export function completeByPrefix<T extends string>(
  values: readonly T[],
  prefix: string
): T[] {
  return values.filter((value) => value.startsWith(prefix));
}

function getToolGuide(tool: string): string {
  const contract = getToolContract(tool);
  if (!contract) {
    return `Use ${toInlineCode(tool)} to analyze your code changes.`;
  }

  const modelLine = buildToolModelLine(contract);
  return `Tool: ${contract.name}\n${modelLine}\nOutput: ${contract.outputShape}\nUse: ${contract.purpose}`;
}

function buildToolModelLine(contract: {
  model: string;
  thinkingLevel?: string;
  maxOutputTokens: number;
}): string {
  if (contract.thinkingLevel !== undefined) {
    return `Model: ${contract.model} (thinking level ${contract.thinkingLevel}, output cap ${contract.maxOutputTokens}).`;
  }

  return `Model: ${contract.model} (output cap ${contract.maxOutputTokens}).`;
}

export function createPromptResponse(
  description: string,
  text: string
): {
  description: string;
  messages: {
    role: 'user';
    content: { type: 'text'; text: string };
  }[];
} {
  return {
    description,
    messages: [
      {
        role: 'user' as const,
        content: { type: 'text' as const, text },
      },
    ],
  };
}

export function getFocusAreaGuide(focusArea: string): string {
  return isFocusArea(focusArea)
    ? FOCUS_AREA_GUIDES[focusArea]
    : `Focus on ${focusArea} concerns.`;
}

function registerHelpPrompt(server: McpServer, instructions: string): void {
  const def = findPromptDef('get-help');
  server.registerPrompt(
    def.name,
    {
      title: def.title,
      description: def.description,
    },
    () => createPromptResponse(def.description, instructions)
  );
}

export function buildReviewGuideText(tool: string, focusArea: string): string {
  const toolCode = toInlineCode(tool);

  return (
    `# Guide: ${tool} / ${focusArea}\n\n` +
    `## Tool: ${toolCode}\n${getToolGuide(tool)}\n\n` +
    `## Focus: ${focusArea}\n${getFocusAreaGuide(focusArea)}`
  );
}

function registerReviewGuidePrompt(server: McpServer): void {
  const def = findPromptDef('review-guide');
  server.registerPrompt(
    def.name,
    {
      title: def.title,
      description: def.description,
      argsSchema: {
        tool: completable(
          z.string().max(128).optional().describe(TOOL_DESCRIPTION_TEXT),
          (value) => completeByPrefix(TOOLS, value ?? '')
        ),
        focusArea: completable(
          z.string().max(128).optional().describe(FOCUS_DESCRIPTION_TEXT),
          (value) => completeByPrefix(INSPECTION_FOCUS_AREAS, value ?? '')
        ),
      },
    },
    (args) => {
      const selectedTool = args.tool ?? DEFAULT_TOOL_NAME;
      const selectedFocus = args.focusArea ?? INSPECTION_FOCUS_AREAS[0];
      return createPromptResponse(
        `Code review guide: ${selectedTool} / ${selectedFocus}`,
        buildReviewGuideText(selectedTool, selectedFocus)
      );
    }
  );
}

export function registerAllPrompts(
  server: McpServer,
  instructions: string
): void {
  registerHelpPrompt(server, instructions);
  registerReviewGuidePrompt(server);
}
