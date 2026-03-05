import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createServer } from '../src/server.js';

type ToolRegistry = Record<string, RegisteredTool>;

function getRegisteredTools(): {
  tools: ToolRegistry;
  shutdown: () => Promise<void>;
} {
  const handle = createServer();
  const tools = (handle.server as unknown as { _registeredTools: ToolRegistry })
    ._registeredTools;

  return {
    tools,
    shutdown: handle.shutdown,
  };
}

describe('server tool registration', () => {
  let shutdown: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (shutdown) {
      await shutdown();
      shutdown = undefined;
    }
  });

  it('keeps generate_diff and load_file task-forbidden', () => {
    const serverState = getRegisteredTools();
    shutdown = serverState.shutdown;

    assert.equal(
      serverState.tools.generate_diff?.execution?.taskSupport,
      'forbidden'
    );
    assert.equal(
      serverState.tools.load_file?.execution?.taskSupport,
      'forbidden'
    );
  });

  it('registers every other tool as task-optional', () => {
    const serverState = getRegisteredTools();
    shutdown = serverState.shutdown;

    for (const [name, tool] of Object.entries(serverState.tools)) {
      if (name === 'generate_diff' || name === 'load_file') {
        continue;
      }

      assert.equal(
        tool.execution?.taskSupport,
        'optional',
        `${name} should expose optional task support`
      );
    }
  });
});
