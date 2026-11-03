'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { serveur } = require('../server');

test('sert les données publiques et protège le rechargement', async (t) => {
  serveur.listen(0, '127.0.0.1');
  await new Promise((resolve) => serveur.once('listening', resolve));
  t.after(() => new Promise((resolve) => serveur.close(resolve)));
  const base = `http://127.0.0.1:${serveur.address().port}`;

  const countries = await fetch(`${base}/api/pays`);
  assert.equal(countries.status, 200);
  assert.match(countries.headers.get('content-security-policy'), /object-src 'none'/);
  const body = await countries.json();
  assert.ok(body.pays.length > 100);
  assert.ok(body.pays.every((country) => /^[A-Z]{2}$/.test(country.code)));

  const location = await fetch(`${base}/api/ici`, { headers: { 'cf-ipcountry': 'FR' } });
  assert.deepEqual(await location.json(), { code: 'FR' });

  const reload = await fetch(`${base}/api/recharger`, { method: 'POST' });
  assert.equal(reload.status, 403);
});
