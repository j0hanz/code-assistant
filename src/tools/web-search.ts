import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { getErrorMessage } from '../lib/errors.js';
import { generateGroundedContent } from '../lib/gemini/index.js';
import {
  createErrorToolResponse,
  createToolResponse,
  wrapToolHandler,
} from '../lib/tools.js';
import { WebSearchInputSchema } from '../schemas/inputs.js';
import { DefaultOutputSchema } from '../schemas/outputs.js';

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

export function registerWebSearchTool(server: McpServer): void {
  server.registerTool(
    'web_search',
    {
      title: 'Web Search',
      description:
        'Perform a Google Search with Grounding to get up-to-date information.',
      inputSchema: WebSearchInputSchema,
      outputSchema: DefaultOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
        destructiveHint: false,
      },
    },
    wrapToolHandler(
      {
        toolName: 'web_search',
        progressContext: (input) => input.query.slice(0, 60),
      },
      async (input) => {
        try {
          const result = await generateGroundedContent({
            prompt: input.query,
            responseSchema: {},
          });

          const { text } = result;
          const metadata = result.groundingMetadata as
            | GroundingMetadata
            | undefined;
          const formatted = formatGroundedResponse(text, metadata);

          return createToolResponse(
            {
              ok: true as const,
              result: {
                text: formatted,
                groundingMetadata: metadata ?? {},
              },
            },
            formatted.slice(0, 200)
          );
        } catch (error) {
          return createErrorToolResponse(
            'E_WEB_SEARCH',
            getErrorMessage(error)
          );
        }
      }
    )
  );
}
