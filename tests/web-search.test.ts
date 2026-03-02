import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatGroundedResponse,
  type GroundingMetadata,
} from '../src/tools/web-search.js';

describe('formatGroundedResponse', () => {
  it('returns text unchanged when metadata is undefined', () => {
    assert.equal(formatGroundedResponse('hello', undefined), 'hello');
  });

  it('returns text unchanged when metadata has no supports', () => {
    const metadata: GroundingMetadata = {
      groundingChunks: [{ web: { uri: 'https://example.com', title: 'Ex' } }],
    };
    assert.equal(formatGroundedResponse('hello', metadata), 'hello');
  });

  it('returns text unchanged when metadata has no chunks', () => {
    const metadata: GroundingMetadata = {
      groundingSupports: [
        { segment: { endIndex: 5 }, groundingChunkIndices: [0] },
      ],
    };
    assert.equal(formatGroundedResponse('hello', metadata), 'hello');
  });

  it('inserts single citation at segment end', () => {
    const metadata: GroundingMetadata = {
      groundingChunks: [
        { web: { uri: 'https://example.com', title: 'Example' } },
      ],
      groundingSupports: [
        {
          segment: { startIndex: 0, endIndex: 5, text: 'Spain' },
          groundingChunkIndices: [0],
        },
      ],
    };
    const result = formatGroundedResponse('Spain won.', metadata);
    assert.equal(result, 'Spain [Example](https://example.com) won.');
  });

  it('inserts multiple citations for one segment', () => {
    const metadata: GroundingMetadata = {
      groundingChunks: [
        { web: { uri: 'https://a.com', title: 'A' } },
        { web: { uri: 'https://b.com', title: 'B' } },
      ],
      groundingSupports: [
        {
          segment: { startIndex: 0, endIndex: 5, text: 'Spain' },
          groundingChunkIndices: [0, 1],
        },
      ],
    };
    const result = formatGroundedResponse('Spain won.', metadata);
    assert.equal(result, 'Spain [A](https://a.com) [B](https://b.com) won.');
  });

  it('handles multiple supports without index shifting', () => {
    // "Spain won. England lost." — two segments at indices 10 and 24
    const text = 'Spain won. England lost.';
    const metadata: GroundingMetadata = {
      groundingChunks: [
        { web: { uri: 'https://a.com', title: 'A' } },
        { web: { uri: 'https://b.com', title: 'B' } },
      ],
      groundingSupports: [
        {
          segment: { startIndex: 0, endIndex: 10, text: 'Spain won.' },
          groundingChunkIndices: [0],
        },
        {
          segment: { startIndex: 11, endIndex: 24, text: 'England lost.' },
          groundingChunkIndices: [1],
        },
      ],
    };
    const result = formatGroundedResponse(text, metadata);
    // Descending sort ensures later segments are inserted first
    assert.equal(
      result,
      'Spain won. [A](https://a.com) England lost. [B](https://b.com)'
    );
  });

  it('uses "Source" as fallback title when title is missing', () => {
    const metadata: GroundingMetadata = {
      groundingChunks: [{ web: { uri: 'https://x.com' } }],
      groundingSupports: [
        {
          segment: { startIndex: 0, endIndex: 2, text: 'Hi' },
          groundingChunkIndices: [0],
        },
      ],
    };
    const result = formatGroundedResponse('Hi there', metadata);
    assert.equal(result, 'Hi [Source](https://x.com) there');
  });

  it('skips supports with no endIndex', () => {
    const metadata: GroundingMetadata = {
      groundingChunks: [{ web: { uri: 'https://a.com', title: 'A' } }],
      groundingSupports: [
        {
          segment: { startIndex: 0, text: 'test' },
          groundingChunkIndices: [0],
        },
      ],
    };
    assert.equal(formatGroundedResponse('test', metadata), 'test');
  });

  it('skips supports with empty groundingChunkIndices', () => {
    const metadata: GroundingMetadata = {
      groundingChunks: [{ web: { uri: 'https://a.com', title: 'A' } }],
      groundingSupports: [
        {
          segment: { startIndex: 0, endIndex: 4, text: 'test' },
          groundingChunkIndices: [],
        },
      ],
    };
    assert.equal(formatGroundedResponse('test', metadata), 'test');
  });

  it('skips chunks without a uri', () => {
    const metadata: GroundingMetadata = {
      groundingChunks: [{ web: { title: 'NoURI' } }],
      groundingSupports: [
        {
          segment: { startIndex: 0, endIndex: 4, text: 'test' },
          groundingChunkIndices: [0],
        },
      ],
    };
    assert.equal(formatGroundedResponse('test', metadata), 'test');
  });

  it('handles chunk index out of bounds gracefully', () => {
    const metadata: GroundingMetadata = {
      groundingChunks: [{ web: { uri: 'https://a.com', title: 'A' } }],
      groundingSupports: [
        {
          segment: { startIndex: 0, endIndex: 4, text: 'test' },
          groundingChunkIndices: [5],
        },
      ],
    };
    // Index 5 is out of bounds — chunk is undefined, uri is undefined → filtered out
    assert.equal(formatGroundedResponse('test', metadata), 'test');
  });
});
