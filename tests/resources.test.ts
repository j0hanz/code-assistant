import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../src/server.js';

describe('resource reads', () => {
  let shutdown: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (shutdown) {
      await shutdown();
      shutdown = undefined;
    }
  });

  it('rejects unknown tool-info resources', async () => {
    const handle = createServer();
    shutdown = handle.shutdown;

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'resource-test-client', version: '1.0.0' },
      { capabilities: {} }
    );

    try {
      await Promise.all([
        handle.server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await assert.rejects(
        async () =>
          await client.readResource({
            uri: 'internal://tool-info/does-not-exist',
          }),
        /Resource internal:\/\/tool-info\/does-not-exist not found/
      );
    } finally {
      await client.close();
    }
  });
});
