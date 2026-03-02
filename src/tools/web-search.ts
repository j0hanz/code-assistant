import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { generateGroundedContent } from '../lib/gemini/index.js';
import {
  buildStructuredToolExecutionOptions,
  registerStructuredToolTask,
  requireToolContract,
} from '../lib/tools.js';
import { WebSearchInputSchema } from '../schemas/inputs.js';
import { WebSearchResultSchema } from '../schemas/outputs.js';
import type { WebSearchResult } from '../schemas/outputs.js';

interface GroundingChunk {
  web?: {
    uri?: string;
    title?: string;
  };
}

interface GroundingSupport {
  segment?: {
    text?: string;
    startIndex?: number;
    endIndex?: number;
  };
  groundingChunkIndices?: number[];
}

interface GroundingMetadata {
  webSearchQueries?: string[];
  groundingChunks?: GroundingChunk[];
  groundingSupports?: GroundingSupport[];
  searchEntryPoint?: unknown;
}

function formatGroundedResponse(
  text: string,
  metadata: GroundingMetadata | undefined
): string {
  if (!metadata?.groundingSupports || !metadata.groundingChunks) {
    return text;
  }

  const supports = metadata.groundingSupports;
  const chunks = metadata.groundingChunks;
  let formattedText = text;

  // Sort supports by end_index in descending order to avoid shifting issues when inserting.
  const sortedSupports = [...supports].sort(
    (a, b) => (b.segment?.endIndex ?? 0) - (a.segment?.endIndex ?? 0)
  );

  for (const support of sortedSupports) {
    const endIndex = support.segment?.endIndex;
    if (endIndex === undefined || !support.groundingChunkIndices?.length) {
      continue;
    }

    const citationLinks = support.groundingChunkIndices
      .map((i) => {
        const chunk = chunks[i];
        const uri = chunk?.web?.uri;
        const title = chunk?.web?.title ?? 'Source';
        if (uri) {
          return `[${title}](${uri})`;
        }
        return null;
      })
      .filter(Boolean);

    if (citationLinks.length > 0) {
      const citationString = ` ${citationLinks.join(' ')}`;
      formattedText =
        formattedText.slice(0, endIndex) +
        citationString +
        formattedText.slice(endIndex);
    }
  }

  return formattedText;
}

const TOOL_CONTRACT = requireToolContract('web_search');

export function registerWebSearchTool(server: McpServer): void {
  registerStructuredToolTask(server, {
    name: 'web_search',
    title: 'Web Search',
    description:
      'Perform a Google Search with Grounding to get up-to-date information.',
    inputSchema: WebSearchInputSchema,
    fullInputSchema: WebSearchInputSchema,
    resultSchema: WebSearchResultSchema,
    errorCode: 'E_WEB_SEARCH',
    ...buildStructuredToolExecutionOptions(TOOL_CONTRACT),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
    progressContext: (input) => input.query.slice(0, 60),
    formatOutput: (result) => result.text.slice(0, 200),
    buildPrompt: (input) => ({
      systemInstruction: '',
      prompt: input.query,
    }),
    customGenerate: async (_promptParts, _ctx, opts) => {
      const result = await generateGroundedContent({
        prompt: _promptParts.prompt,
        responseSchema: {},
        ...(opts.signal ? { signal: opts.signal } : {}),
        onLog: opts.onLog,
      });

      const { text } = result;
      const metadata = result.groundingMetadata as
        | GroundingMetadata
        | undefined;
      const formatted = formatGroundedResponse(text, metadata);

      return WebSearchResultSchema.parse({
        text: formatted,
        groundingMetadata: metadata ?? {},
      }) satisfies WebSearchResult;
    },
  });
}
