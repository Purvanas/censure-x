'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('le diagnostic X échoue proprement sans bearer fourni', () => {
  const env = { ...process.env };
  delete env.X_PUBLIC_BEARER;
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'data', 'probe-x-api.js')], {
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /X_PUBLIC_BEARER est absent/);
});
