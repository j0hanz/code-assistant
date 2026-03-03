import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildFileAnalysisText,
  buildReviewGuideText,
  buildWorkflowText,
  classifyTool,
  completeByPrefix,
  createPromptResponse,
  findPromptDef,
  getFocusAreaGuide,
  getToolChain,
  getWorkflowSummary,
  PROMPT_DEFINITIONS,
} from '../src/prompts/index.js';

describe('PROMPT_DEFINITIONS', () => {
  it('contains exactly five entries with known names', () => {
    assert.equal(PROMPT_DEFINITIONS.length, 5);
    assert.equal(PROMPT_DEFINITIONS[0].name, 'get-help');
    assert.equal(PROMPT_DEFINITIONS[1].name, 'review-guide');
    assert.equal(PROMPT_DEFINITIONS[2].name, 'select-workflow');
    assert.equal(PROMPT_DEFINITIONS[3].name, 'analyze-file');
    assert.equal(PROMPT_DEFINITIONS[4].name, 'tool-chain');
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

describe('classifyTool', () => {
  it('classifies diff-based tools', () => {
    assert.equal(classifyTool('analyze_pr_impact'), 'diff');
  });

  it('classifies file-based tools', () => {
    assert.equal(classifyTool('refactor_code'), 'file');
  });

  it('classifies sync tools', () => {
    assert.equal(classifyTool('generate_diff'), 'sync');
  });

  it('returns standalone for unknown tools', () => {
    assert.equal(classifyTool('nonexistent_tool'), 'standalone');
  });
});

describe('getToolChain', () => {
  it('includes prerequisite for diff-based tools', () => {
    const chain = getToolChain('analyze_pr_impact');
    assert.match(chain, /generate_diff/);
    assert.match(chain, /Category: diff/);
  });

  it('includes prerequisite for file-based tools', () => {
    const chain = getToolChain('refactor_code');
    assert.match(chain, /load_file/);
    assert.match(chain, /Category: file/);
  });

  it('works for standalone tools', () => {
    const chain = getToolChain('web_search');
    assert.match(chain, /Category: standalone/);
  });
});

describe('buildWorkflowText', () => {
  it('returns pipeline for known change type', () => {
    const text = buildWorkflowText('api_change');
    assert.match(text, /# Workflow: api_change/);
    assert.match(text, /detect_api_breaking_changes/);
  });

  it('returns fallback for unknown change type', () => {
    const text = buildWorkflowText('unknown_type');
    assert.match(text, /No predefined workflow/);
  });
});

describe('buildFileAnalysisText', () => {
  it('returns pipeline for known goal', () => {
    const text = buildFileAnalysisText('refactor');
    assert.match(text, /# File Analysis: refactor/);
    assert.match(text, /refactor_code/);
  });

  it('returns fallback for unknown goal', () => {
    const text = buildFileAnalysisText('unknown_goal');
    assert.match(text, /No predefined pipeline/);
  });
});

describe('getWorkflowSummary', () => {
  it('returns summary for valid key', () => {
    const summary = getWorkflowSummary('A');
    assert.match(summary, /Full PR Review/);
  });

  it('returns error for invalid key', () => {
    const summary = getWorkflowSummary('Z');
    assert.match(summary, /Unknown workflow key/);
  });
});
