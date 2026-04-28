const test = require('node:test');
const assert = require('node:assert/strict');
const { upsertMapping } = require('../lib/manualSopMerge.cjs');

test('upsertMapping appends when field not present', () => {
  const existing = [{ standardField: 'siteUrl', xpath: '//a' }];
  const next = upsertMapping(existing, { standardField: 'email', xpath: '//b' });
  assert.equal(next.length, 2);
  assert.equal(next.find((x) => x.standardField === 'email').xpath, '//b');
});

test('upsertMapping replaces when field already present', () => {
  const existing = [
    { standardField: 'email', xpath: '//old' },
    { standardField: 'siteUrl', xpath: '//a' }
  ];
  const next = upsertMapping(existing, { standardField: 'email', xpath: '//new' });
  assert.equal(next.filter((x) => x.standardField === 'email').length, 1);
  assert.equal(next.find((x) => x.standardField === 'email').xpath, '//new');
  assert.equal(next.find((x) => x.standardField === 'siteUrl').xpath, '//a');
});

