'use strict';

// censureX — choisir un pays, lire ce que le droit local impose à X.
//
// Aucune dépendance : le service tient en quelques routes JSON et un dossier de
// fichiers statiques, et un `npm install` de plus n'apporterait rien ici.
//
// Écoute sur 127.0.0.1 : c'est nginx qui publie le service. Écouter sur 0.0.0.0
// l'exposerait aussi hors du tunnel Cloudflare.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { attribuerScores, PALIERS } = require('./lib/score');
const { chargerDsa, dsaPourPays, lienLumen } = require('./lib/sources');

const PORT = Number(process.env.PORT || 4380);
const HOST = process.env.HOST || '127.0.0.1';
const DATA = path.join(__dirname, 'data');
const PUBLIC = path.join(__dirname, 'public');

function secretCorrespond(recu, attendu) {
  if (typeof recu !== 'string' || typeof attendu !== 'string' || !attendu) return false;
  const a = Buffer.from(recu);
  const b = Buffer.from(attendu);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- chargement

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

// Noms français et régions pour les pays qui n'existent que dans les chiffres de X.
const NOMS_FR = {
  BW: 'Botswana', GH: 'Ghana', SN: 'Sénégal', CI: "Côte d'Ivoire", CM: 'Cameroun',
  AO: 'Angola', MZ: 'Mozambique', ZM: 'Zambie', NA: 'Namibie', MU: 'Maurice',
  BN: 'Brunei', KH: 'Cambodge', LA: 'Laos', YE: 'Yémen', GI: 'Gibraltar',
  MO: 'Macao', AD: 'Andorre', LI: 'Liechtenstein', MC: 'Monaco', BS: 'Bahamas',
  BB: 'Barbade', SR: 'Suriname', GY: 'Guyana',
};
const REGIONS = {
  BW: 'Afrique', GH: 'Afrique', SN: 'Afrique', CI: 'Afrique', CM: 'Afrique',
  AO: 'Afrique', MZ: 'Afrique', ZM: 'Afrique', NA: 'Afrique', MU: 'Afrique',
  BN: 'Asie', KH: 'Asie', LA: 'Asie', YE: 'Moyen-Orient',
  GI: 'Europe', MO: 'Asie', AD: 'Europe', LI: 'Europe', MC: 'Europe',
  BS: 'Amériques', BB: 'Amériques', SR: 'Amériques', GY: 'Amériques',
};

function chargerDonnees() {
  const detaillees = readJson('countries.json').pays.map((p) => ({ ...p, fiche: 'detaillee' }));
  const sommaires = readJson('countries-sommaire.json').pays.map((p) => ({ ...p, fiche: 'sommaire' }));
  const blocs = readJson('blocs.json');
  const meca = readJson('mecanismes.json');
  const figures = readJson('figures.json');

  // Une fiche détaillée l'emporte toujours sur une fiche sommaire du même pays.
  const parCode = new Map();
  for (const p of [...sommaires, ...detaillees]) parCode.set(p.code, p);

  // Un pays peut n'exister que dans les chiffres de X : on lui fabrique une fiche
  // minimale plutôt que de le faire disparaître du sélecteur.
  for (const code of Object.keys(figures.countries)) {
    if (code === 'WW' || parCode.has(code)) continue;
    parCode.set(code, {
      code,
      nom: NOMS_FR[code] || figures.countries[code].nameEn,
      region: REGIONS[code] || 'Autre',
      acces: 'libre',
      severite: 1,
      blocs: [],
      resume: "Aucun régime de retrait propre à ce pays n'est documenté ici. X y applique ses règles "
        + "globales, et retire ou masque un contenu sur décision de justice locale. Les chiffres "
        + "ci-dessous montrent que des demandes légales lui sont bien parvenues depuis ce pays.",
      mecanismes: ['retrait-global'],
      fiche: 'minimale',
    });
  }

  // On raccroche chiffres, blocs et sources externes à chaque fiche, une fois pour toutes.
  const dsa = chargerDsa();
  const pays = [...parCode.values()].map((p) => ({
    ...p,
    chiffres: figures.countries[p.code] || null,
    blocsDetail: (p.blocs || []).map((id) => blocs[id]).filter(Boolean),
    dsa: dsaPourPays(dsa, p.code),
    lumen: lienLumen(p.code, p.nom),
  }));
  pays.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

  // Le score se calcule après coup : il a besoin de voir tous les pays pour établir
  // l'échelle de sa composante mesurée.
  const { maxima } = attribuerScores(pays);

  return { pays, blocs, meca, figures, dsa, maxima, monde: figures.countries.WW };
}

let D = chargerDonnees();

// ------------------------------------------------------------------ routage

const CRITERES = ['requests', 'accountsSpecified', 'accountsWithheld', 'tweetsWithheld'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function json(res, code, corps) {
  const s = JSON.stringify(corps);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(s),
    'Cache-Control': 'no-cache',
  });
  res.end(s);
}

// no-cache assumé : ce site change souvent et n'a pas de build à invalider.
// Un maxAge servirait un app.js périmé pendant des heures.
function servirFichier(res, fichier, code = 200) {
  fs.readFile(fichier, (err, buf) => {
    if (err) { json(res, 404, { erreur: 'introuvable' }); return; }
    res.writeHead(code, {
      'Content-Type': TYPES[path.extname(fichier).toLowerCase()] || 'application/octet-stream',
      'Content-Length': buf.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(buf);
  });
}

const index = (res, code = 200) => servirFichier(res, path.join(PUBLIC, 'index.html'), code);

function api(req, res, chemin, params) {

  if (req.method === 'POST' && chemin !== '/api/recharger') {
    return json(res, 405, { erreur: 'méthode non autorisée' });
  }

  if (chemin === '/api/pays') {
    // Liste allégée : de quoi peupler le sélecteur, rien de plus.
    return json(res, 200, {
      pays: D.pays.map((p) => ({
        code: p.code, nom: p.nom, region: p.region, acces: p.acces,
        severite: p.severite, fiche: p.fiche,
        demandes: p.chiffres ? p.chiffres.total.requests : 0,
        score: p.score.total, palier: p.score.palier, fiabilite: p.score.fiabilite,
      })),
      monde: D.monde,
      source: D.figures.source,
      paliers: PALIERS,
    });
  }

  const unPays = chemin.match(/^\/api\/pays\/([A-Za-z]{2})$/);
  if (unPays) {
    const p = D.pays.find((x) => x.code === unPays[1].toUpperCase());
    if (!p) return json(res, 404, { erreur: 'pays inconnu', code: unPays[1] });
    return json(res, 200, { pays: p, monde: D.monde, source: D.figures.source });
  }

  if (chemin === '/api/mecanismes') return json(res, 200, D.meca);
  if (chemin === '/api/blocs') return json(res, 200, D.blocs);

  if (chemin === '/api/score') {
    // La méthode du score, servie avec les données : un indice qu'on ne peut pas
    // recalculer soi-même ne vaut pas grand-chose.
    const { ACCES, POIDS_MECANISME, MAX_MECANISMES, MAX_PRESSION, INDICATEURS } = require('./lib/score');
    return json(res, 200, {
      paliers: PALIERS,
      bareme: {
        acces: { max: 40, valeurs: ACCES },
        legale: { max: 35, editorialMax: 20, mecanismesMax: MAX_MECANISMES, poids: POIDS_MECANISME },
        mesuree: { max: MAX_PRESSION, indicateurs: INDICATEURS, echelle: 'logarithmique', maxima: D.maxima },
      },
      classement: D.pays
        .map((p) => ({ code: p.code, nom: p.nom, score: p.score.total, palier: p.score.palier, acces: p.acces }))
        .sort((a, b) => b.score - a.score),
    });
  }

  if (chemin === '/api/dsa') {
    if (!D.dsa) return json(res, 404, { erreur: 'collecte DSA absente — lancer npm run collect:dsa' });
    return json(res, 200, D.dsa);
  }

  if (chemin === '/api/classement') {
    const critere = params.get('critere') || 'requests';

    // Le score ne vient pas du CSV : il se classe à part, sur toute la liste.
    if (critere === 'score') {
      const lignes = D.pays
        .map((p) => ({
          code: p.code, nom: p.nom, acces: p.acces, severite: p.severite,
          valeur: p.score.total, part: p.score.total / 100, palier: p.score.palier,
        }))
        .sort((a, b) => b.valeur - a.valeur);
      return json(res, 200, { critere, monde: 100, lignes, paliers: PALIERS });
    }

    if (!CRITERES.includes(critere)) {
      return json(res, 400, { erreur: 'critère inconnu', permis: [...CRITERES, 'score'] });
    }
    const total = D.monde.total[critere];
    const lignes = D.pays
      .filter((p) => p.chiffres && p.chiffres.total[critere] > 0)
      .map((p) => ({
        code: p.code, nom: p.nom, acces: p.acces, severite: p.severite,
        valeur: p.chiffres.total[critere],
        part: total ? p.chiffres.total[critere] / total : 0,
      }))
      .sort((a, b) => b.valeur - a.valeur);
    return json(res, 200, { critere, monde: total, lignes, source: D.figures.source });
  }

  if (chemin === '/api/ici') {
    // Le pays d'où vient la requête, quand Cloudflare veut bien le dire.
    // XX = inconnu, T1 = réseau Tor : dans les deux cas on ne propose rien.
    const cf = req.headers['cf-ipcountry'];
    const code = cf && cf !== 'XX' && cf !== 'T1' ? String(cf).toUpperCase() : null;
    const connu = code && D.pays.some((p) => p.code === code);
    return json(res, 200, { code: connu ? code : null });
  }

  if (chemin === '/api/sante') return json(res, 200, { ok: true, pays: D.pays.length });

  if (chemin === '/api/recharger' && req.method === 'POST') {
    // Corriger une fiche sans redémarrer. Sans jeton configuré, la route est fermée.
    const jeton = process.env.CENSUREX_ADMIN_TOKEN;
    if (!secretCorrespond(req.headers['x-admin-token'], jeton)) {
      return json(res, 403, { erreur: 'interdit' });
    }
    try { D = chargerDonnees(); } catch (e) { return json(res, 500, { erreur: e.message }); }
    return json(res, 200, { ok: true, pays: D.pays.length });
  }

  return json(res, 404, { erreur: 'route inconnue' });
}

const serveur = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // On passe par l'URL WHATWG : url.parse() est déprécié et connu pour ses pièges.
  // L'hôte est arbitraire, seuls le chemin et la requête nous intéressent.
  let u;
  try { u = new URL(req.url, 'http://interne'); }
  catch { return json(res, 400, { erreur: 'URL invalide' }); }
  let chemin;
  try { chemin = decodeURIComponent(u.pathname); } catch { chemin = u.pathname; }

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
    return json(res, 405, { erreur: 'méthode non autorisée' });
  }

  if (chemin.startsWith('/api/')) {
    return api(req, res, chemin, u.searchParams);
  }

  if (chemin === '/' || chemin === '') return index(res);

  // Une URL par pays, pour qu'un lien soit partageable ; le rendu reste côté client.
  if (/^\/pays\/[A-Za-z]{2}\/?$/.test(chemin)) return index(res);

  // Statiques. On résout puis on vérifie que le résultat est bien sous public/ :
  // sans ce contrôle, un ../ remonterait dans le système de fichiers.
  const fichier = path.resolve(PUBLIC, '.' + chemin);
  if (fichier !== PUBLIC && !fichier.startsWith(PUBLIC + path.sep)) {
    return json(res, 403, { erreur: 'interdit' });
  }
  fs.stat(fichier, (err, st) => {
    if (err || !st.isFile()) return index(res, 404);
    servirFichier(res, fichier);
  });
});

if (require.main === module) {
  serveur.listen(PORT, HOST, () => {
    console.log(`censureX écoute sur http://${HOST}:${PORT} — ${D.pays.length} pays`);
  });
}

module.exports = { serveur, chargerDonnees, secretCorrespond };
