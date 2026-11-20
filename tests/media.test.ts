import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const hashFile = (path: string): string => createHash('sha256')
  .update(readFileSync(new URL(path, root))).digest('hex');

test('published screenshots and continuous recording match capture hashes', () => {
  const manifest = JSON.parse(readFileSync(new URL('docs/recordings/captures.json', root), 'utf8'));
  assert.equal(hashFile('docs/recordings/walkthrough.mp4'), manifest.video_sha256);
  assert.equal(manifest.captures.length, 6);
  const digests = manifest.captures.map((capture: { path: string; sha256: string }) => {
    const actual = hashFile(capture.path);
    assert.equal(actual, capture.sha256);
    return actual;
  });
  assert.equal(new Set(digests).size, digests.length);
});
