import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolResultSchema,
  RELATED_TASK_META_KEY,
  TaskStatusNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { CodeLensTaskStore } from '../src/lib/task-store.js';
import {
  createToolResponse,
  registerTaskBackedTool,
} from '../src/lib/tools.js';
import { createToolOutputSchema } from '../src/schemas/outputs.js';

const SLOW_TOOL_INPUT = z.object({
  waitMs: z.number().int().min(50).max(2_000),
});

const SLOW_TOOL_RESULT = z.object({
  done: z.literal(true),
});

async function createTaskTestServer(): Promise<{
  server: McpServer;
  client: Client;
  close: () => Promise<void>;
}> {
  const taskStore = new CodeLensTaskStore();
  const server = new McpServer(
    { name: 'task-test-server', version: '1.0.0' },
    {
      taskStore,
      capabilities: {
        tools: {},
        tasks: {
          list: {},
          cancel: {},
          requests: {
            tools: {
              call: {},
            },
          },
        },
      },
    }
  );

  registerTaskBackedTool(server, {
    name: 'slow_tool',
    title: 'Slow Tool',
    description: 'Synthetic long-running task for lifecycle tests.',
    inputSchema: SLOW_TOOL_INPUT,
    outputSchema: createToolOutputSchema(SLOW_TOOL_RESULT),
    errorCode: 'E_SLOW_TOOL',
    taskSupport: 'required',
    handler: async (input, extra) => {
      const { waitMs } = SLOW_TOOL_INPUT.parse(input);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, waitMs);

        extra.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new DOMException('Task cancelled', 'AbortError'));
          },
          { once: true }
        );
      });

      return createToolResponse({
        ok: true as const,
        result: { done: true as const },
      });
    },
  });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'task-test-client', version: '1.0.0' },
    { capabilities: {} }
  );

  const close = async (): Promise<void> => {
    try {
      await client.close();
    } finally {
      await server.close();
      taskStore.cleanup();
    }
  };

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { server, client, close };
}

describe('task execution lifecycle', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  it('returns a cancellation-shaped tool result for cancelled tasks', async () => {
    const handle = await createTaskTestServer();
    close = handle.close;

    const stream = handle.client.experimental.tasks.callToolStream(
      {
        name: 'slow_tool',
        arguments: { waitMs: 1_000 },
      },
      CallToolResultSchema,
      {
        task: {
          ttl: 250,
        },
      }
    );

    const firstMessage = await stream.next();
    assert.equal(firstMessage.done, false);

    const created = firstMessage.value as {
      type: string;
      task: { taskId: string; ttl: number | null };
    };
    assert.equal(created.type, 'taskCreated');
    assert.equal(created.task.ttl, 250);

    const cancelled = await handle.client.experimental.tasks.cancelTask(
      created.task.taskId
    );
    assert.equal(cancelled.status, 'cancelled');

    const task = await handle.client.experimental.tasks.getTask(
      created.task.taskId
    );
    assert.equal(task.status, 'cancelled');

    const result = await handle.client.experimental.tasks.getTaskResult(
      created.task.taskId,
      CallToolResultSchema
    );
    assert.equal(result.isError, true);
    const firstBlock = result.content[0];
    const firstText = firstBlock?.type === 'text' ? firstBlock.text : '';
    assert.match(firstText, /Task cancelled|cancelled/i);

    await stream.return(undefined);
  });

  it('created task includes pollInterval from server config', async () => {
    const handle = await createTaskTestServer();
    close = handle.close;

    const stream = handle.client.experimental.tasks.callToolStream(
      {
        name: 'slow_tool',
        arguments: { waitMs: 200 },
      },
      CallToolResultSchema,
      { task: { ttl: 10_000 } }
    );

    const firstMessage = await stream.next();
    assert.equal(firstMessage.done, false);

    const created = firstMessage.value as {
      type: string;
      task: { taskId: string; pollInterval?: number };
    };
    assert.equal(created.type, 'taskCreated');
    assert.equal(typeof created.task.pollInterval, 'number');
    assert.ok(
      created.task.pollInterval! > 0,
      'pollInterval should be positive'
    );

    await stream.return(undefined);
  });

  it('tasks/result includes related-task metadata injected by SDK', async () => {
    const handle = await createTaskTestServer();
    close = handle.close;

    const stream = handle.client.experimental.tasks.callToolStream(
      {
        name: 'slow_tool',
        arguments: { waitMs: 50 },
      },
      CallToolResultSchema,
      { task: { ttl: 10_000 } }
    );

    const firstMessage = await stream.next();
    assert.equal(firstMessage.done, false);

    const created = firstMessage.value as {
      type: string;
      task: { taskId: string };
    };
    assert.equal(created.type, 'taskCreated');
    const taskId = created.task.taskId;

    // Wait for completion via status messages
    let lastMessage: { type: string } | undefined;
    for await (const message of stream) {
      lastMessage = message as { type: string };
      if (lastMessage.type === 'result') break;
    }

    const result = await handle.client.experimental.tasks.getTaskResult(
      taskId,
      CallToolResultSchema
    );

    // SDK should inject related-task metadata
    const meta = (result as Record<string, unknown>)._meta as
      | Record<string, unknown>
      | undefined;
    assert.ok(meta, 'result should include _meta');
    const relatedTask = meta[RELATED_TASK_META_KEY] as
      | { taskId: string }
      | undefined;
    assert.ok(relatedTask, 'result _meta should include related-task key');
    assert.equal(relatedTask.taskId, taskId);
  });

  it('emits notifications/tasks/status on task status changes', async () => {
    const handle = await createTaskTestServer();
    close = handle.close;

    const statusUpdates: Array<{ taskId: string; status: string }> = [];
    handle.client.setNotificationHandler(
      TaskStatusNotificationSchema,
      (notification) => {
        statusUpdates.push({
          taskId: notification.params.taskId,
          status: notification.params.status,
        });
      }
    );

    const stream = handle.client.experimental.tasks.callToolStream(
      {
        name: 'slow_tool',
        arguments: { waitMs: 50 },
      },
      CallToolResultSchema,
      { task: { ttl: 10_000 } }
    );

    // Consume entire stream to completion
    for await (const message of stream) {
      const msg = message as { type: string };
      if (msg.type === 'result' || msg.type === 'error') break;
    }

    // Give notifications time to propagate
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    assert.ok(
      statusUpdates.length > 0,
      'should receive at least one status notification'
    );

    const terminalUpdate = statusUpdates.find(
      (u) => u.status === 'completed' || u.status === 'failed'
    );
    assert.ok(terminalUpdate, 'should include a terminal status notification');
  });
});
