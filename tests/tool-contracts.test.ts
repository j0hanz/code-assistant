import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildStructuredToolRuntimeOptions,
  getToolContract,
  getToolContractNames,
  getToolContracts,
  requireToolContract,
} from '../src/lib/tools.js';

describe('tool contracts', () => {
  it('exposes expected tool names with no duplicates', () => {
    const names = getToolContractNames();
    const uniqueNames = new Set(names);

    assert.equal(names.length, 13);
    assert.equal(uniqueNames.size, names.length);
    assert.deepEqual(names, [
      'generate_diff',
      'analyze_pr_impact',
      'generate_review_summary',
      'generate_test_plan',
      'analyze_time_space_complexity',
      'detect_api_breaking_changes',
      'load_file',
      'refactor_code',
      'ask_about_code',
      'verify_logic',
      'web_search',
      'generate_documentation',
      'detect_code_smells',
    ]);
  });

  it('retrieves contracts by name and throws for unknown names', () => {
    const contract = getToolContract('generate_diff');
    assert.ok(contract);
    assert.equal(contract?.name, 'generate_diff');
    assert.equal(getToolContract('missing_tool'), undefined);

    assert.throws(
      () => requireToolContract('missing_tool'),
      /Unknown tool contract: missing_tool/
    );
  });

  it('returns immutable-style contract list with expected shape fields', () => {
    const contracts = getToolContracts();
    assert.equal(contracts.length, 13);

    for (const contract of contracts) {
      assert.match(contract.name, /^[A-Za-z0-9_.-]+$/);
      assert.equal(typeof contract.purpose, 'string');
      assert.ok(Array.isArray(contract.params));
      assert.equal(typeof contract.outputShape, 'string');
    }
  });

  it('builds runtime options from only defined keys', () => {
    assert.deepEqual(buildStructuredToolRuntimeOptions({}), {});

    assert.deepEqual(
      buildStructuredToolRuntimeOptions({
        thinkingLevel: 'high',
        deterministicJson: true,
      }),
      {
        thinkingLevel: 'high',
        deterministicJson: true,
      }
    );

    assert.deepEqual(buildStructuredToolRuntimeOptions({ temperature: 1 }), {
      temperature: 1,
    });
  });
});
