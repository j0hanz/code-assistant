import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cleanDiff,
  computeDiffStats,
  computeDiffStatsAndPathsFromFiles,
  computeDiffStatsAndSummaryFromFiles,
  exceedsDiffBudget,
  extractChangedPaths,
  formatFileSummary,
  getDiffBudgetError,
  getMaxDiffChars,
  parseDiffFiles,
  resetMaxDiffCharsCacheForTesting,
  validateDiffBudget,
} from '../src/lib/diff.js';

function buildDiff(files: number): string {
  const sections: string[] = [];
  for (let i = 0; i < files; i++) {
    sections.push(
      [
        `diff --git a/file-${i}.ts b/file-${i}.ts`,
        `--- a/file-${i}.ts`,
        `+++ b/file-${i}.ts`,
        '@@ -1 +1 @@',
        `-old-${i}`,
        `+new-${i}`,
      ].join('\n')
    );
  }
  return `${sections.join('\n')}\n`;
}

describe('diff budget', () => {
  it('supports env override for max diff chars', () => {
    const previous = process.env.MAX_DIFF_CHARS;
    process.env.MAX_DIFF_CHARS = '25';

    try {
      resetMaxDiffCharsCacheForTesting();
      assert.equal(getMaxDiffChars(), 25);
      assert.equal(exceedsDiffBudget('x'.repeat(26)), true);
      assert.equal(exceedsDiffBudget('x'.repeat(25)), false);
    } finally {
      if (previous === undefined) {
        delete process.env.MAX_DIFF_CHARS;
      } else {
        process.env.MAX_DIFF_CHARS = previous;
      }
      resetMaxDiffCharsCacheForTesting();
    }
  });

  it('returns structured budget errors when diff is too large', () => {
    const previous = process.env.MAX_DIFF_CHARS;
    process.env.MAX_DIFF_CHARS = '5';

    try {
      resetMaxDiffCharsCacheForTesting();
      const error = validateDiffBudget('123456');
      assert.ok(error);
      assert.equal(error.isError, true);

      const first = error.content[0];
      assert.ok(first && 'text' in first);
      const parsed = JSON.parse(first.text) as {
        ok: boolean;
        error?: {
          code: string;
          kind?: string;
          retryable?: boolean;
          message: string;
        };
        result?: { providedChars: number; maxChars: number };
      };

      assert.equal(parsed.ok, false);
      assert.equal(parsed.error?.code, 'E_INPUT_TOO_LARGE');
      assert.equal(parsed.error?.kind, 'budget');
      assert.equal(parsed.error?.retryable, false);
      assert.deepEqual(parsed.result, { providedChars: 6, maxChars: 5 });
      assert.equal(parsed.error?.message, getDiffBudgetError(6, 5));
    } finally {
      if (previous === undefined) {
        delete process.env.MAX_DIFF_CHARS;
      } else {
        process.env.MAX_DIFF_CHARS = previous;
      }
      resetMaxDiffCharsCacheForTesting();
    }
  });
});

describe('diff cleaning and parsing', () => {
  it('removes binary and mode-only sections while keeping hunks', () => {
    const raw = [
      'diff --git a/keep.ts b/keep.ts',
      '--- a/keep.ts',
      '+++ b/keep.ts',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      'diff --git a/image.png b/image.png',
      'Binary files a/image.png and b/image.png differ',
      'diff --git a/mode-only.sh b/mode-only.sh',
      'old mode 100644',
      'new mode 100755',
      'diff --git a/mode-with-hunk.sh b/mode-with-hunk.sh',
      'old mode 100644',
      'new mode 100755',
      '--- a/mode-with-hunk.sh',
      '+++ b/mode-with-hunk.sh',
      '@@ -1 +1 @@',
      '-echo old',
      '+echo new',
    ].join('\n');

    const cleaned = cleanDiff(raw);
    assert.match(cleaned, /keep\.ts/);
    assert.match(cleaned, /mode-with-hunk\.sh/);
    assert.doesNotMatch(cleaned, /image\.png/);
    assert.doesNotMatch(cleaned, /mode-only\.sh/);
  });

  it('preserves rename-only and copy-only sections during cleaning', () => {
    const raw = [
      'diff --git a/old-name.ts b/new-name.ts',
      'similarity index 100%',
      'rename from old-name.ts',
      'rename to new-name.ts',
      'diff --git a/source.ts b/copied.ts',
      'similarity index 100%',
      'copy from source.ts',
      'copy to copied.ts',
    ].join('\n');

    const cleaned = cleanDiff(raw);
    assert.match(cleaned, /rename to new-name\.ts/);
    assert.match(cleaned, /copy to copied\.ts/);
  });

  it('computes stats and changed paths from parsed diff files', () => {
    const diff = buildDiff(2);

    const files = parseDiffFiles(diff);
    assert.equal(files.length, 2);

    const stats = computeDiffStats(diff);
    assert.equal(stats.files, 2);
    assert.equal(stats.added, 2);
    assert.equal(stats.deleted, 2);

    const paths = extractChangedPaths(diff);
    assert.deepEqual(paths, ['file-0.ts', 'file-1.ts']);

    const fromFiles = computeDiffStatsAndPathsFromFiles(files);
    assert.deepEqual(fromFiles.paths, ['file-0.ts', 'file-1.ts']);
    assert.deepEqual(fromFiles.stats, stats);
  });

  it('handles documented rename, copy, add, delete, and no-newline patch forms', () => {
    const diff = [
      'diff --git a/old-name.ts b/new-name.ts',
      'similarity index 100%',
      'rename from old-name.ts',
      'rename to new-name.ts',
      'diff --git a/source.ts b/copied.ts',
      'similarity index 100%',
      'copy from source.ts',
      'copy to copied.ts',
      'diff --git a/added.ts b/added.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/added.ts',
      '@@ -0,0 +1 @@',
      '+const added = true;',
      'diff --git a/removed.ts b/removed.ts',
      'deleted file mode 100644',
      '--- a/removed.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-const removed = true;',
      'diff --git a/no-newline.txt b/no-newline.txt',
      '--- a/no-newline.txt',
      '+++ b/no-newline.txt',
      '@@ -1 +1 @@',
      '-old line',
      '\\ No newline at end of file',
      '+new line',
      '\\ No newline at end of file',
    ].join('\n');

    const files = parseDiffFiles(diff);
    const stats = computeDiffStats(diff);

    assert.equal(files.length, 3);
    assert.deepEqual(extractChangedPaths(diff), [
      'added.ts',
      'no-newline.txt',
      'removed.ts',
    ]);
    assert.deepEqual(computeDiffStatsAndPathsFromFiles(files), {
      stats,
      paths: ['added.ts', 'no-newline.txt', 'removed.ts'],
    });
    assert.deepEqual(stats, { files: 3, added: 2, deleted: 2 });
  });

  it('truncates long summaries after 40 files', () => {
    const files = parseDiffFiles(buildDiff(42));
    const result = computeDiffStatsAndSummaryFromFiles(files);

    assert.equal(result.stats.files, 42);
    assert.match(result.summary, /\.\.\. and 2 more files/);
    assert.match(result.summary, /\[42 files, \+42 -42\]$/);
    assert.equal(formatFileSummary(files), result.summary);
  });
});
