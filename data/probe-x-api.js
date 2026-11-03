'use strict';

// Rejoue le test de l'API interne du Transparency Center de X.
//
// Le site de X alimente ses graphiques en appelant une colonne « strato » avec un
// bearer public et un guest token. Si cette porte rouvrait un jour, on pourrait
// reprendre les chiffres par pays après 2020 et cesser de dépendre du CSV figé.
//
// Au 15/08/2026 : 404 sur toutes les formes essayées. Ce script existe pour qu'on
// puisse le revérifier en une commande plutôt que de refaire l'enquête.
//
//   npm run probe:x

const https = require('https');

// Le bearer public change et ne doit pas être figé dans l'historique du dépôt.
// Le récupérer depuis la page de X au moment du diagnostic, puis le fournir
// uniquement à ce processus via l'environnement.
const BEARER = String(process.env.X_PUBLIC_BEARER || '').trim();

const CLES = [
  'rrMapNoTime',
  'rrBarChartWorldwideWithTime',
  'countryComparisonRemovalRequestsWorldwideNoTime',
];

function requete(url, methode, entetes) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: methode,
      headers: { 'User-Agent': 'Mozilla/5.0', ...entetes },
    }, (res) => {
      const m = [];
      res.on('data', (c) => m.push(c));
      res.on('end', () => resolve({ statut: res.statusCode, corps: Buffer.concat(m).toString('utf8') }));
    });
    req.on('error', (e) => resolve({ statut: 0, corps: e.message }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ statut: 0, corps: 'délai dépassé' }); });
    req.end();
  });
}

async function main() {
  if (!BEARER) {
    console.error('X_PUBLIC_BEARER est absent. Récupérez le bearer public actuel depuis '
      + 'le Transparency Center de X, puis relancez la commande avec cette variable.');
    process.exitCode = 1;
    return;
  }

  const act = await requete('https://api.x.com/1.1/guest/activate.json', 'POST',
    { Authorization: `Bearer ${BEARER}` });
  let guest = null;
  try { guest = JSON.parse(act.corps).guest_token; } catch { /* réponse illisible */ }
  console.log(`guest token : ${guest ? 'obtenu' : `échec (HTTP ${act.statut})`}`);
  if (!guest) {
    process.exitCode = 1;
    return;
  }

  const entetes = {
    Authorization: `Bearer ${BEARER}`,
    'X-Guest-Token': guest,
    Referer: 'https://transparency.x.com/',
  };

  let ouvert = false;
  for (const hote of ['api.x.com', 'api.twitter.com']) {
    for (const cle of CLES) {
      for (const params of ['periodtype=Biannual', 'periodtype=Biannual,lowerdate=2024-01-01,upperdate=2024-06-30']) {
        const url = `https://${hote}/1.1/strato/column/None/${params}/cms/prod/transparency/${cle}`;
        const r = await requete(url, 'GET', entetes);
        const ok = r.statut === 200 && r.corps.trim().startsWith('[');
        if (ok) ouvert = true;
        console.log(`  ${ok ? 'OUVERT' : 'fermé '} ${String(r.statut).padStart(3)}  ${hote} ${cle} (${params.split(',')[0]})`);
      }
    }
  }

  console.log(ouvert
    ? "\nL'API répond : on peut reprendre la collecte par pays après 2020."
    : "\nToujours fermée. La source actuelle des chiffres récents reste la base DSA "
      + '(npm run collect:dsa), limitée à l’Union européenne.');
  process.exitCode = ouvert ? 0 : 2;
}

main().catch((erreur) => {
  console.error(`Échec du diagnostic : ${erreur.message}`);
  process.exitCode = 1;
});
