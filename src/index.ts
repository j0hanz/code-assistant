#!/usr/bin/env node
import { parseArgs } from 'node:util';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { getErrorMessage } from './lib/errors.js';

import { createServer } from './server.js';

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

// --- CLI Parsing ---

const ARG_OPTION_MODEL = 'model';
const ARG_OPTION_MAX_DIFF_CHARS = 'max-diff-chars';
const PROCESS_ARGS_START_INDEX = 2;

const CLI_ENV_MAPPINGS = [
  { option: ARG_OPTION_MODEL, envVar: 'GEMINI_MODEL' },
  { option: ARG_OPTION_MAX_DIFF_CHARS, envVar: 'MAX_DIFF_CHARS' },
] as const;

const CLI_OPTIONS = {
  [ARG_OPTION_MODEL]: {
    type: 'string',
    short: 'm',
  },
  [ARG_OPTION_MAX_DIFF_CHARS]: {
    type: 'string',
  },
} as const;

function setStringEnv(name: string, value: string | boolean | undefined): void {
  if (typeof value !== 'string') {
    return;
  }

  process.env[name] = value;
}

function applyCliEnvironmentOverrides(
  values: Record<string, string | boolean | undefined>
): void {
  for (const mapping of CLI_ENV_MAPPINGS) {
    setStringEnv(mapping.envVar, values[mapping.option]);
  }
}

function parseCommandLineArgs(): void {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(PROCESS_ARGS_START_INDEX),
      options: CLI_OPTIONS,
      strict: true,
    });

    applyCliEnvironmentOverrides(values);
  } catch (error: unknown) {
    console.error(`[error] ${getErrorMessage(error)}`);
    process.exit(2);
  }
}

// --- Server Lifecycle ---

type ServerInstance = ReturnType<typeof createServer>;

let shuttingDown = false;

async function shutdown(server: ServerInstance): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  setTimeout(() => process.exit(1), 15_000).unref();
  await server.shutdown();
  process.exit(0);
}

function registerShutdownHandlers(server: ServerInstance): void {
  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      shutdown(server).catch((error: unknown) => {
        console.error(`[fatal] ${getErrorMessage(error)}`);
        process.exit(1);
      });
    });
  }
}

async function main(): Promise<void> {
  parseCommandLineArgs();
  const server = createServer();
  const transport = new StdioServerTransport();

  registerShutdownHandlers(server);
  await server.server.connect(transport);
}

main().catch((error: unknown) => {
  console.error(`[fatal] ${getErrorMessage(error)}`);
  process.exit(1);
});
