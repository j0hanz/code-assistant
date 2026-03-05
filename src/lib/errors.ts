import { inspect } from 'node:util';

import { z } from 'zod';

import type { ErrorMeta } from './tool-response.js';

// --- API key sanitization ---

const SENSITIVE_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{35}/g,
  /sk-[0-9A-Za-z_-]{20,}/g,
  /Bearer\s+[^\s"']{20,}/gi,
];

/** Remove sensitive credentials from a string before it reaches clients. */
function sanitizeErrorMessage(message: string): string {
  let sanitized = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}

/** Matches transient upstream provider failures that are typically safe to retry. */
export const RETRYABLE_UPSTREAM_ERROR_PATTERN =
  /(\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|rate.?limit|quota|overload|\bunavailable\b|\bgateway\b|\btimeout\b|timed.out|\bconnection\b|conn(ection)?\s*reset|\beconn\w*|\benotfound\b|\btemporary\b|\btransient\b)/i;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }
  return value;
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (!isObjectRecord(value) || !(key in value)) {
    return undefined;
  }

  const property = value[key];
  return typeof property === 'string' ? property : undefined;
}

export function getErrorMessage(error: unknown): string {
  const message = getStringProperty(error, 'message');
  if (message !== undefined) {
    return sanitizeErrorMessage(message);
  }

  if (typeof error === 'string') {
    return sanitizeErrorMessage(error);
  }

  return sanitizeErrorMessage(inspect(error, { depth: 3, breakLength: 120 }));
}

const CANCELLED_ERROR_PATTERN = /cancelled|canceled/i;
const TIMEOUT_ERROR_PATTERN = /timed out|timeout/i;
const BUDGET_ERROR_PATTERN = /exceeds limit|max allowed size|input too large/i;
const BUSY_ERROR_PATTERN = /too many concurrent/i;
const VALIDATION_ERROR_PATTERN = /validation/i;

const ERROR_CLASSIFIERS: { pattern: RegExp; meta: ErrorMeta }[] = [
  {
    pattern: CANCELLED_ERROR_PATTERN,
    meta: { kind: 'cancelled', retryable: false },
  },
  {
    pattern: TIMEOUT_ERROR_PATTERN,
    meta: { kind: 'timeout', retryable: true },
  },
  { pattern: BUDGET_ERROR_PATTERN, meta: { kind: 'budget', retryable: false } },
  { pattern: BUSY_ERROR_PATTERN, meta: { kind: 'busy', retryable: true } },
  {
    pattern: RETRYABLE_UPSTREAM_ERROR_PATTERN,
    meta: { kind: 'upstream', retryable: true },
  },
];

export function classifyErrorMeta(error: unknown, message: string): ErrorMeta {
  if (error instanceof z.ZodError || VALIDATION_ERROR_PATTERN.test(message)) {
    return {
      kind: 'validation',
      retryable: false,
    };
  }

  for (const { pattern, meta } of ERROR_CLASSIFIERS) {
    if (pattern.test(message)) {
      return meta;
    }
  }

  return {
    kind: 'internal',
    retryable: false,
  };
}
