import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { summarizeSchemaValidationErrorForRetry } from '../src/lib/tools.js';

describe('summarizeSchemaValidationErrorForRetry', () => {
  it('returns short messages unchanged', () => {
    const msg = 'Expected string, received number';
    assert.equal(summarizeSchemaValidationErrorForRetry(msg), msg);
  });

  it('collapses whitespace and trims', () => {
    const msg = '  Expected   string,\n  received   number  ';
    assert.equal(
      summarizeSchemaValidationErrorForRetry(msg),
      'Expected string, received number'
    );
  });

  it('truncates messages longer than the configured limit with ellipsis', () => {
    // Default limit is max(200, env=1500) = 1500
    const longMsg = 'x'.repeat(2000);
    const result = summarizeSchemaValidationErrorForRetry(longMsg);
    assert.ok(result.length <= 1500);
    assert.ok(result.endsWith('...'));
  });

  it('handles empty string', () => {
    assert.equal(summarizeSchemaValidationErrorForRetry(''), '');
  });

  it('handles whitespace-only string', () => {
    assert.equal(summarizeSchemaValidationErrorForRetry('   \n\t  '), '');
  });

  it('preserves messages exactly at the boundary', () => {
    // Default limit is 1500
    const msg = 'a'.repeat(1500);
    const result = summarizeSchemaValidationErrorForRetry(msg);
    assert.equal(result, msg);
    assert.equal(result.length, 1500);
  });

  it('handles multi-line Zod error messages', () => {
    const zodError = [
      'ZodError: [',
      '  {',
      '    "code": "invalid_type",',
      '    "expected": "string",',
      '    "received": "number",',
      '    "path": ["summary"],',
      '    "message": "Expected string, received number"',
      '  }',
      ']',
    ].join('\n');

    const result = summarizeSchemaValidationErrorForRetry(zodError);
    assert.ok(!result.includes('\n'));
    assert.ok(result.length <= 200);
  });
});
