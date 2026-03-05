import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { debuglog } from 'node:util';

import { GoogleGenAI } from '@google/genai';

import { UNKNOWN_REQUEST_CONTEXT_VALUE } from './config.js';
import type { GeminiOnLog } from './types.js';

// ---------------------------------------------------------------------------
// API key & client singleton
// ---------------------------------------------------------------------------

const GEMINI_API_KEY_ENV_VAR = 'GEMINI_API_KEY';
const GOOGLE_API_KEY_ENV_VAR = 'GOOGLE_API_KEY';

let cachedClient: GoogleGenAI | undefined;

function getApiKey(): string {
  const apiKey =
    process.env[GEMINI_API_KEY_ENV_VAR] ?? process.env[GOOGLE_API_KEY_ENV_VAR];
  if (!apiKey) {
    throw new Error(
      `Missing ${GEMINI_API_KEY_ENV_VAR} or ${GOOGLE_API_KEY_ENV_VAR}.`
    );
  }

  return apiKey;
}

export function getClient(): GoogleGenAI {
  cachedClient ??= new GoogleGenAI({
    apiKey: getApiKey(),
    apiVersion: 'v1beta',
  });

  return cachedClient;
}

export function setClientForTesting(client: GoogleGenAI): void {
  cachedClient = client;
}

// ---------------------------------------------------------------------------
// Request context (AsyncLocalStorage)
// ---------------------------------------------------------------------------

interface GeminiRequestContext {
  requestId: string;
  model: string;
}

export type GeminiLogLevel = 'info' | 'warning' | 'error';

interface GeminiLogPayload {
  event: string;
  details: Record<string, unknown>;
}

export type { GeminiLogPayload };

export const geminiContext = new AsyncLocalStorage<GeminiRequestContext>({
  name: 'gemini_request',
  defaultValue: {
    requestId: UNKNOWN_REQUEST_CONTEXT_VALUE,
    model: UNKNOWN_REQUEST_CONTEXT_VALUE,
  },
});

const UNKNOWN_CONTEXT: GeminiRequestContext = {
  requestId: UNKNOWN_REQUEST_CONTEXT_VALUE,
  model: UNKNOWN_REQUEST_CONTEXT_VALUE,
};

export function nextRequestId(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Event emitter & debug logging
// ---------------------------------------------------------------------------

const geminiEvents = new EventEmitter();

const debug = debuglog('gemini') as ReturnType<typeof debuglog> & {
  enabled?: boolean;
};

geminiEvents.on('log', (payload: unknown) => {
  if (debug.enabled) {
    debug('%j', payload);
  }
});

function logEvent(event: string, details: Record<string, unknown>): void {
  const context = geminiContext.getStore() ?? UNKNOWN_CONTEXT;
  geminiEvents.emit('log', {
    event,
    requestId: context.requestId,
    model: context.model,
    ...details,
  });
}

export async function safeCallOnLog(
  onLog: GeminiOnLog,
  level: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    await onLog?.(level, data);
  } catch {
    // Log callbacks are best-effort; never fail the tool call.
  }
}

export async function emitGeminiLog(
  onLog: GeminiOnLog,
  level: GeminiLogLevel,
  payload: GeminiLogPayload
): Promise<void> {
  logEvent(payload.event, payload.details);
  await safeCallOnLog(onLog, level, {
    event: payload.event,
    ...payload.details,
  });
}
