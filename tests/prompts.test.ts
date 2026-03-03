import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildReviewGuideText,
  completeByPrefix,
  createPromptResponse,
  findPromptDef,
  getFocusAreaGuide,
  PROMPT_DEFINITIONS,
} from '../src/prompts/index.js';

describe('PROMPT_DEFINITIONS', () => {
  it('contains exactly two entries with known names', () => {
    assert.equal(PROMPT_DEFINITIONS.length, 2);
    assert.equal(PROMPT_DEFINITIONS[0].name, 'get-help');
    assert.equal(PROMPT_DEFINITIONS[1].name, 'review-guide');
  });

  it('each entry has name, title, and description', () => {
    for (const def of PROMPT_DEFINITIONS) {
      assert.ok(def.name.length > 0);
      assert.ok(def.title.length > 0);
      assert.ok(def.description.length > 0);
    }
  });
});

describe('findPromptDef', () => {
  it('returns the definition for a known prompt name', () => {
    const def = findPromptDef('get-help');
    assert.equal(def.name, 'get-help');
    assert.equal(def.title, 'Get Help');
  });

  it('throws for an unknown prompt name', () => {
    assert.throws(() => findPromptDef('nonexistent'), {
      message: /Unknown prompt definition/,
    });
  });
});

describe('completeByPrefix', () => {
  const items = ['alpha', 'also', 'beta'] as const;

  it('returns values matching the prefix', () => {
    const result = completeByPrefix(items, 'al');
    assert.deepEqual(result, ['alpha', 'also']);
  });

  it('returns empty array when nothing matches', () => {
    const result = completeByPrefix(items, 'z');
    assert.deepEqual(result, []);
  });
});

describe('createPromptResponse', () => {
  it('returns valid MCP prompt response structure', () => {
    const resp = createPromptResponse('desc', 'hello');
    assert.equal(resp.description, 'desc');
    assert.equal(resp.messages.length, 1);
    const msg = resp.messages[0];
    assert.ok(msg);
    assert.equal(msg.role, 'user');
    assert.equal(msg.content.type, 'text');
    assert.equal(msg.content.text, 'hello');
  });
});

describe('getFocusAreaGuide', () => {
  it('returns predefined guide for known focus area', () => {
    const guide = getFocusAreaGuide('security');
    assert.match(guide, /Injection/);
  });

  it('returns generic guide for unknown focus area', () => {
    const guide = getFocusAreaGuide('unknown-area');
    assert.match(guide, /Focus on unknown-area concerns/);
  });
});

describe('buildReviewGuideText', () => {
  it('includes tool and focus area sections', () => {
    const text = buildReviewGuideText('analyze_pr_impact', 'security');
    assert.match(text, /# Guide: analyze_pr_impact/);
    assert.match(text, /## Tool:/);
    assert.match(text, /## Focus: security/);
  });
});
