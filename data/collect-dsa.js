'use strict';

// Collecteur de données récentes, pour dépasser l'arrêt des chiffres de X en 2020.
//
// Deux sources ont été essayées.
//
// 1. L'API interne du Transparency Center de X. Le bundle JavaScript du site appelle
//    https://api.x.com/1.1/strato/column/None/{params}/cms/prod/transparency/{clé}
//    avec un bearer public et un guest token. Testée le 15/08/2026 sous toutes ses
//    formes — avec et sans dates, sur api.x.com et api.twitter.com, avec cookie de
//    session et en-tête CSRF — elle renvoie invariablement 404. La colonne n'est plus
//    exposée publiquement. `npm run probe:x` rejoue le test : le jour où elle rouvre,
//    on le saura.
//
// 2. La base de transparence du DSA, tenue par la Commission européenne. X y dépose
//    chaque jour ses « déclarations de motifs » (statements of reasons), une par
//    décision de modération, avec le pays visé. C'est public, quotidien, et bien plus
//    détaillé que ce que X publiait de lui-même. C'est cette source qu'on collecte.
//
// Ce que ça couvre, et ce que ça ne couvre pas : le DSA ne s'applique qu'à l'Union et
// à l'Espace économique européen. Et surtout — le site le répète à l'affichage — ces
// déclarations sont d'abord de la modération décidée par X, pas des ordres d'État.
// Elles disent ce que X retire dans un pays, pas ce qu'un gouvernement lui a imposé.

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const BASE = 'https://transparency.dsa.ec.europa.eu';
const PLATEFORME_X = 22;                       // identifiant de X dans le formulaire
const JOURS = Number(process.env.DSA_JOURS || 7);
const OUT = path.join(__dirname, 'dsa-recent.json');
const UA = 'censureX/1.0 (+https://censure-x.purvanas.fr)';

// --------------------------------------------------------------- petit client HTTP

function get(url, options = {}, redirections = 0) {
  return new Promise((resolve, reject) => {
    if (redirections > 5) return reject(new Error('trop de redirections'));
    const req = https.get(url, {
      headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip', ...(options.headers || {}) },
      timeout: 120000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), options, redirections + 1));
      }
      const morceaux = [];
      const flux = res.headers['content-encoding'] === 'gzip' ? res.pipe(zlib.createGunzip()) : res;
      flux.on('data', (c) => morceaux.push(c));
      flux.on('end', () => resolve({ statut: res.statusCode, corps: Buffer.concat(morceaux) }));
      flux.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
  });
}

// ------------------------------------------------- lecture des ZIP sans dépendance
//
// Les archives de la Commission sont des ZIP de ZIP de CSV, en « stored » ou
// « deflate ». zlib sait faire les deux, le reste est du décodage d'en-têtes : ça
// évite une dépendance pour trois champs.

function entreesZip(buf) {
  // On lit le catalogue central, en le cherchant depuis la fin.
  let fin = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('ZIP invalide : catalogue introuvable');

  const nbEntrees = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const entrees = [];

  for (let i = 0; i < nbEntrees; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP invalide : entrée illisible');
    const methode = buf.readUInt16LE(p + 10);
    const tailleCompressee = buf.readUInt32LE(p + 20);
    const lgNom = buf.readUInt16LE(p + 28);
    const lgExtra = buf.readUInt16LE(p + 30);
    const lgCommentaire = buf.readUInt16LE(p + 32);
    const offsetLocal = buf.readUInt32LE(p + 42);
    const nom = buf.toString('utf8', p + 46, p + 46 + lgNom);
    entrees.push({ nom, methode, tailleCompressee, offsetLocal });
    p += 46 + lgNom + lgExtra + lgCommentaire;
  }
  return entrees;
}

function lireEntree(buf, e) {
  // L'en-tête local redonne les longueurs de nom et d'extra, qui peuvent différer.
  const lgNom = buf.readUInt16LE(e.offsetLocal + 26);
  const lgExtra = buf.readUInt16LE(e.offsetLocal + 28);
  const debut = e.offsetLocal + 30 + lgNom + lgExtra;
  const brut = buf.subarray(debut, debut + e.tailleCompressee);
  if (e.methode === 0) return brut;
  if (e.methode === 8) return zlib.inflateRawSync(brut);
  throw new Error(`méthode de compression ZIP non gérée : ${e.methode}`);
}

// ------------------------------------------------------------------ lecture du CSV

function* lignesCsv(texte) {
  let champ = '';
  let ligne = [];
  let guillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++; }
      else if (c === '"') guillemets = false;
      else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === ',') { ligne.push(champ); champ = ''; }
    else if (c === '\n') { ligne.push(champ); yield ligne; ligne = []; champ = ''; }
    else if (c !== '\r') champ += c;
  }
  if (champ || ligne.length) { ligne.push(champ); yield ligne; }
}

// --------------------------------------------------------------- pages de la source

// La page de téléchargement liste, pour une plateforme et une plage de dates, un
// identifiant de fichier par jour. Pas d'API : on lit le tableau.
async function listerFichiers(depuis, jusqua) {
  const url = `${BASE}/explore-data/download?platform_id=${PLATEFORME_X}`
    + `&from_date=${depuis}&to_date=${jusqua}`;
  const { statut, corps } = await get(url);
  if (statut !== 200) throw new Error(`page de téléchargement : HTTP ${statut}`);
  const html = corps.toString('utf8');

  const jours = [];
  const re = /(\d{4}-\d{2}-\d{2})([\s\S]{0,3000}?)download-file\/(\d+)\/full/g;
  let m;
  while ((m = re.exec(html))) {
    const nb = (m[2].match(/>\s*([\d\s  ]+)\s*</) || [])[1];
    jours.push({
      date: m[1],
      id: m[3],
      declarationsAffichees: nb ? Number(nb.replace(/[^\d]/g, '')) : null,
    });
  }
  // Un même identifiant peut apparaître deux fois (lien « full » et lien « sha1 »).
  const vus = new Set();
  const uniques = jours.filter((j) => !vus.has(j.id) && vus.add(j.id));

  // La page ignore les bornes de dates qu'on lui passe et renvoie tout ce qu'elle a.
  // On tronque donc nous-mêmes, du plus récent au plus ancien.
  uniques.sort((a, b) => b.date.localeCompare(a.date));
  return uniques.slice(0, JOURS);
}

async function collecterJour(jour) {
  const { statut, corps } = await get(
    `${BASE}/explore-data/download-file/${jour.id}/full`,
    { headers: { Referer: `${BASE}/explore-data/download` } },
  );
  if (statut !== 200) throw new Error(`fichier ${jour.id} : HTTP ${statut}`);

  const agg = {
    date: jour.date,
    total: 0,
    parPays: {},          // code ISO -> nombre de décisions visant ce pays
    parCategorie: {},
    parFondement: {},     // ce que X déclare comme base : sa propre police, le plus souvent
    parSource: {},        // qui a déclenché : autorité, signalement, ou « autre »
    automatisees: 0,
  };

  for (const externe of entreesZip(corps)) {
    if (!externe.nom.endsWith('.zip')) continue;
    const interne = lireEntree(corps, externe);
    for (const e of entreesZip(interne)) {
      if (!e.nom.endsWith('.csv')) continue;
      const texte = lireEntree(interne, e).toString('utf8');
      const it = lignesCsv(texte);
      const entete = it.next().value;
      if (!entete) continue;
      const idx = Object.fromEntries(entete.map((c, i) => [c, i]));

      for (const l of it) {
        if (l.length < entete.length - 2) continue;
        agg.total++;

        const champ = (n) => l[idx[n]] || '';
        try {
          for (const p of JSON.parse(champ('territorial_scope') || '[]')) {
            agg.parPays[p] = (agg.parPays[p] || 0) + 1;
          }
        } catch { /* périmètre illisible : la déclaration compte au total, pas au pays */ }

        const cat = champ('category');
        if (cat) agg.parCategorie[cat] = (agg.parCategorie[cat] || 0) + 1;
        const fond = champ('illegal_content_legal_ground') || champ('incompatible_content_ground');
        if (fond) agg.parFondement[fond] = (agg.parFondement[fond] || 0) + 1;

        const src = champ('source_type') || 'SOURCE_TYPE_ABSENT';
        agg.parSource[src] = (agg.parSource[src] || 0) + 1;

        if ((champ('automated_decision') || '').startsWith('AUTOMATED_DECISION_')
            && champ('automated_decision') !== 'AUTOMATED_DECISION_NOT_AUTOMATED') {
          agg.automatisees++;
        }
      }
    }
  }
  return agg;
}

// ---------------------------------------------------------------------- assemblage

const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n)
  .map(([cle, nombre]) => ({ cle, nombre }));

async function main() {
  const jour = 86400000;
  const auj = new Date(Date.now() - jour);           // la veille : le jour même est incomplet
  const depuis = new Date(auj.getTime() - (JOURS - 1) * jour);
  const iso = (d) => d.toISOString().slice(0, 10);

  console.log(`Fenêtre : ${iso(depuis)} → ${iso(auj)} (${JOURS} jours)`);
  const jours = await listerFichiers(iso(depuis), iso(auj));
  console.log(`${jours.length} fichier(s) quotidien(s) listé(s) pour X`);
  if (!jours.length) throw new Error('aucun fichier : la page a peut-être changé de forme');

  const parJour = [];
  for (const j of jours) {
    process.stdout.write(`  ${j.date} … `);
    try {
      const agg = await collecterJour(j);
      parJour.push(agg);
      console.log(`${agg.total.toLocaleString('fr-FR')} déclarations`);
    } catch (e) {
      console.log(`échec (${e.message})`);
    }
  }
  if (!parJour.length) throw new Error('aucun jour collecté');

  const parPays = {};
  const parCategorie = {};
  const parFondement = {};
  const parSource = {};
  let total = 0; let automatisees = 0;

  for (const j of parJour) {
    total += j.total; automatisees += j.automatisees;
    for (const [k, v] of Object.entries(j.parPays)) parPays[k] = (parPays[k] || 0) + v;
    for (const [k, v] of Object.entries(j.parCategorie)) parCategorie[k] = (parCategorie[k] || 0) + v;
    for (const [k, v] of Object.entries(j.parFondement)) parFondement[k] = (parFondement[k] || 0) + v;
    for (const [k, v] of Object.entries(j.parSource)) parSource[k] = (parSource[k] || 0) + v;
  }

  // Ce que X déclare comme origine de ses décisions. Sur la fenêtre observée en août
  // 2026, la réponse est « autre notification » pour la totalité : ni injonction
  // d'autorité au sens de l'article 9, ni signalement au sens de l'article 16. C'est
  // une information en soi, et le site l'affiche telle quelle.
  const ordres = Object.entries(parSource)
    .filter(([k]) => /AUTHORITY|ARTICLE_9|ORDER/.test(k))
    .reduce((t, [, v]) => t + v, 0);
  const signalements = parSource.SOURCE_TYPE_ARTICLE_16 || 0;

  const dates = parJour.map((j) => j.date).sort();
  const sortie = {
    source: {
      titre: 'Base de transparence du DSA — déclarations de motifs déposées par X',
      url: `${BASE}/explore-data/download`,
      couverture: `${dates[0]} → ${dates[dates.length - 1]}`,
      jours: parJour.length,
      note: "Chaque déclaration correspond à une décision de modération prise par X et "
        + "visant un pays de l'Union ou de l'Espace économique européen. Le DSA l'oblige à "
        + "les publier. Attention à la lecture : ce sont très majoritairement des décisions "
        + "que X prend de sa propre initiative, pas des retraits ordonnés par un État.",
      limite: "Ne couvre que l'Union et l'EEE. Pour les autres pays, les seuls chiffres "
        + "disponibles restent ceux de X, arrêtés en 2020.",
    },
    collecteLe: new Date().toISOString(),
    total,
    moyenneParJour: Math.round(total / parJour.length),
    ordresAutorite: ordres,
    signalements,
    automatisees,
    parPays,
    parSource,
    topCategories: top(parCategorie, 10),
    topFondements: top(parFondement, 10),
    parJour: parJour.map((j) => ({ date: j.date, total: j.total })).sort((a, b) => a.date.localeCompare(b.date)),
  };

  fs.writeFileSync(OUT, JSON.stringify(sortie, null, 2));
  console.log(`\ndsa-recent.json écrit — ${total.toLocaleString('fr-FR')} déclarations, `
    + `${Object.keys(parPays).length} pays, ${parJour.length} jours`);
}

main().catch((e) => { console.error('Échec :', e.message); process.exit(1); });
