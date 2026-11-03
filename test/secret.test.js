'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { secretCorrespond } = require('../server');

test('compare les jetons sans accepter une longueur ou une valeur différente', () => {
  assert.equal(secretCorrespond('abcdef', 'abcdef'), true);
  assert.equal(secretCorrespond('abcdeg', 'abcdef'), false);
  assert.equal(secretCorrespond('abc', 'abcdef'), false);
  assert.equal(secretCorrespond(undefined, 'abcdef'), false);
});
