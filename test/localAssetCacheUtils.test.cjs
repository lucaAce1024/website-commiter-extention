const test = require('node:test');
const assert = require('node:assert/strict');
const { guessImageExt, sanitizeRelPath, sanitizeRelPathPart } = require('../lib/localAssetCacheUtils.cjs');

test('sanitizeRelPathPart keeps safe chars and collapses others', () => {
  assert.equal(sanitizeRelPathPart('site_123'), 'site_123');
  assert.equal(sanitizeRelPathPart(' a/b\\c  '), 'a_b_c');
  assert.equal(sanitizeRelPathPart('...'), '...');
  assert.equal(sanitizeRelPathPart(''), 'x');
});

test('guessImageExt maps common mimes', () => {
  assert.equal(guessImageExt('image/png'), 'png');
  assert.equal(guessImageExt('image/webp'), 'webp');
  assert.equal(guessImageExt('image/gif'), 'gif');
  assert.equal(guessImageExt('image/svg+xml'), 'svg');
  assert.equal(guessImageExt('image/jpeg'), 'jpg');
  assert.equal(guessImageExt(''), 'jpg');
});

test('sanitizeRelPath removes leading slashes and traversal', () => {
  assert.equal(sanitizeRelPath('/sites/site_1/logo.jpg'), 'sites/site_1/logo.jpg');
  assert.equal(sanitizeRelPath('../x/../../y.png'), 'x/y.png');
  assert.equal(sanitizeRelPath('sites/./a/../b.png'), 'sites/a/b.png');
  assert.equal(sanitizeRelPath(''), '');
});

