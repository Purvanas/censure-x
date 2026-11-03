'use strict';

// Prépare le fond de carte : Natural Earth 110m (domaine public) → tracés SVG par pays.
//
// On fait ce travail ici, une fois, plutôt que dans le navigateur : le GeoJSON pèse
// 820 Ko et demanderait une projection côté client. Le résultat tient dans un fichier
// que le navigateur lit tel quel, sans bibliothèque de cartographie.
//
//   node data/build-carte.js            # utilise data/ne_110m_admin_0_countries.geojson
//   node data/build-carte.js --telecharger   # va le chercher d'abord
//
// Projection : équirectangulaire, bornée à 84° N et 56° S. On coupe l'Antarctique,
// qui n'a pas de code pays et occuperait un quart de la hauteur pour rien.

const fs = require('fs');
const path = require('path');
const https = require('https');

const SRC = path.join(__dirname, 'ne_110m_admin_0_countries.geojson');
const OUT = path.join(__dirname, '..', 'public', 'monde.json');
const URL_NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/'
  + 'geojson/ne_110m_admin_0_countries.geojson';

const LAT_MAX = 84;
const LAT_MIN = -56;
const LARGEUR = 1000;
const HAUTEUR = Math.round(LARGEUR * (LAT_MAX - LAT_MIN) / 360);

// Natural Earth met -99 dans ISO_A2 pour la France et la Norvège, entre autres, parce
// que leur code officiel est disputé ou réparti. ISO_A2_EH corrige, sauf exceptions.
const RATTRAPAGE = {
  France: 'FR', Norway: 'NO', 'Northern Cyprus': 'CY', Kosovo: 'XK',
  Somaliland: 'SO', 'Western Sahara': 'EH', 'Republic of Serbia': 'RS',
};

const projX = (lon) => ((lon + 180) / 360) * LARGEUR;
const projY = (lat) => ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * HAUTEUR;

// Un dixième de pixel suffit à l'écran, et divise le poids du fichier par trois.
const arrondi = (n) => Math.round(n * 10) / 10;

function anneauVersChemin(anneau) {
  // Doublons consécutifs après arrondi : on les jette, ils n'ajoutent que des octets.
  const pts = [];
  for (const [lon, lat] of anneau) {
    if (lat > LAT_MAX + 5 || lat < LAT_MIN - 5) continue;
    const x = arrondi(projX(lon));
    const y = arrondi(projY(Math.max(LAT_MIN, Math.min(LAT_MAX, lat))));
    const d = pts[pts.length - 1];
    if (d && d[0] === x && d[1] === y) continue;
    pts.push([x, y]);
  }
  if (pts.length < 3) return '';
  return `M${pts.map((p) => `${p[0]} ${p[1]}`).join('L')}Z`;
}

// Aire approchée d'un anneau, pour écarter les îlots invisibles à cette échelle.
function aire(anneau) {
  let a = 0;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
    a += anneau[j][0] * anneau[i][1] - anneau[i][0] * anneau[j][1];
  }
  return Math.abs(a / 2);
}

function geometrieVersChemin(geo) {
  const polygones = geo.type === 'Polygon' ? [geo.coordinates]
    : geo.type === 'MultiPolygon' ? geo.coordinates : [];
  let d = '';
  for (const poly of polygones) {
    const exterieur = poly[0];
    if (!exterieur || aire(exterieur) < 0.05) continue;   // en degrés carrés
    d += anneauVersChemin(exterieur);
  }
  return d;
}

function telecharger(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'censureX/1.0' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const m = [];
      res.on('data', (c) => m.push(c));
      res.on('end', () => resolve(Buffer.concat(m)));
    }).on('error', reject);
  });
}

async function main() {
  if (process.argv.includes('--telecharger') || !fs.existsSync(SRC)) {
    console.log('Téléchargement du fond Natural Earth…');
    fs.writeFileSync(SRC, await telecharger(URL_NE));
  }

  const geo = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const pays = {};
  const noms = {};
  const ignores = [];

  for (const f of geo.features) {
    const p = f.properties;
    let code = p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : null;
    if (!code && p.ISO_A2 && p.ISO_A2 !== '-99') code = p.ISO_A2;
    if (!code) code = RATTRAPAGE[p.NAME] || RATTRAPAGE[p.ADMIN] || null;
    if (!code || code === 'AQ') { ignores.push(p.NAME); continue; }

    const d = geometrieVersChemin(f.geometry);
    if (!d) { ignores.push(p.NAME); continue; }

    // Un même code peut revenir (territoires) : on concatène les tracés.
    pays[code] = (pays[code] || '') + d;
    noms[code] = noms[code] || p.NAME;
  }

  const sortie = {
    source: {
      titre: 'Natural Earth — Admin 0 Countries, 1:110m',
      url: 'https://www.naturalearthdata.com/',
      licence: 'domaine public',
      note: 'Projection équirectangulaire, bornée à 84° N et 56° S. Les îlots de moins '
        + "de 0,05 degré carré sont écartés : ils ne sont pas visibles à cette échelle "
        + "et pèsent plus que le reste.",
    },
    largeur: LARGEUR,
    hauteur: HAUTEUR,
    pays,
    noms,
  };

  fs.writeFileSync(OUT, JSON.stringify(sortie));
  const ko = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`monde.json écrit — ${Object.keys(pays).length} pays, ${ko} Ko`);
  if (ignores.length) console.log(`écartés (sans code ISO ou trop petits) : ${ignores.join(', ')}`);
}

main().catch((e) => { console.error('Échec :', e.message); process.exit(1); });
