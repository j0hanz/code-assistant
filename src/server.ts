import { readFileSync } from 'node:fs';
import { findPackageJSON } from 'node:module';

import { InMemoryTaskStore } from '@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { initDiffStore } from './lib/diff.js';
import { getErrorMessage } from './lib/errors.js';
import { initFileStore } from './lib/file-store.js';

import { registerAllPrompts } from './prompts/index.js';
import { registerAllResources } from './resources/index.js';
import { buildServerInstructions } from './resources/instructions.js';
import { registerAllTools } from './tools/index.js';

const SERVER_NAME = 'code-assistant';
const UTF8_ENCODING = 'utf8';

const PackageJsonSchema = z.object({
  version: z.string().min(1),
});

const TASK_TOOL_CALL_CAPABILITY = {
  tools: {
    call: {},
  },
} as const;

const SERVER_CAPABILITIES = {
  logging: {},
  completions: {},
  prompts: {},
  resources: { subscribe: true },
  tools: { listChanged: true },
  tasks: {
    list: {},
    cancel: {},
    requests: TASK_TOOL_CALL_CAPABILITY,
  },
} as const;

function readUtf8File(path: string): string {
  try {
    return readFileSync(path, UTF8_ENCODING);
  } catch (error: unknown) {
    throw new Error(`Unable to read ${path}: ${getErrorMessage(error)}`, {
      cause: error,
    });
  }
}

function parsePackageVersion(
  packageJsonText: string,
  packageJsonPath: string
): string {
  try {
    const json: unknown = JSON.parse(packageJsonText);
    return PackageJsonSchema.parse(json).version;
  } catch (error: unknown) {
    throw new Error(
      `Invalid package.json at ${packageJsonPath}: ${getErrorMessage(error)}`,
      { cause: error }
    );
  }
}

function loadVersion(): string {
  const packageJsonPath = findPackageJSON(import.meta.url);
  if (!packageJsonPath) {
    throw new Error(`Unable to locate package.json for ${SERVER_NAME}.`);
  }

  const packageJsonText = readUtf8File(packageJsonPath);
  return parsePackageVersion(packageJsonText, packageJsonPath);
}

const SERVER_VERSION = loadVersion();

const SERVER_INSTRUCTIONS = buildServerInstructions();

export interface ServerHandle {
  server: McpServer;
  shutdown: () => Promise<void>;
}

function createMcpServer(taskStore: InMemoryTaskStore): McpServer {
  return new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      instructions: SERVER_INSTRUCTIONS,
      taskStore,
      capabilities: SERVER_CAPABILITIES,
    }
  );
}

function registerServerCapabilities(server: McpServer): void {
  initDiffStore(server);
  initFileStore(server);
  registerAllTools(server);
  registerAllResources(server, SERVER_INSTRUCTIONS);
  registerAllPrompts(server, SERVER_INSTRUCTIONS);
}

export function createServer(): ServerHandle {
  const taskStore = new InMemoryTaskStore();
  const server = createMcpServer(taskStore);
  registerServerCapabilities(server);

  const shutdown = async (): Promise<void> => {
    await server.close();
    taskStore.cleanup();
  };

  return { server, shutdown };
}
