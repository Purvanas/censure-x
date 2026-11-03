'use strict';

// Contrôles sur les données. Ce sont des fiches écrites à la main : c'est là que les
// fautes se logent, pas dans le serveur. Lancé par `npm run check`.

const fs = require('fs');
const path = require('path');

const lire = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));

const erreurs = [];
const alertes = [];

const detaillees = lire('countries.json').pays;
const sommaires = lire('countries-sommaire.json').pays;
const blocs = lire('blocs.json');
const meca = lire('mecanismes.json');
const figures = lire('figures.json');

const ACCES = Object.keys(meca.acces);
const MECAS = Object.keys(meca.mecanismes);
const BLOCS = Object.keys(blocs).filter((k) => !k.startsWith('_'));

const vus = new Map();

for (const [source, liste] of [['countries.json', detaillees], ['countries-sommaire.json', sommaires]]) {
  for (const p of liste) {
    const oue = `${source} / ${p.code || '?'}`;

    if (!/^[A-Z]{2}$/.test(p.code || '')) erreurs.push(`${oue} : code ISO invalide`);
    if (!p.nom) erreurs.push(`${oue} : nom manquant`);
    if (!p.resume) erreurs.push(`${oue} : resume manquant`);
    if (!ACCES.includes(p.acces)) erreurs.push(`${oue} : acces « ${p.acces} » hors vocabulaire`);
    if (!(Number.isInteger(p.severite) && p.severite >= 0 && p.severite <= 5)) {
      erreurs.push(`${oue} : severite doit être un entier de 0 à 5`);
    }

    for (const m of p.mecanismes || []) {
      if (!MECAS.includes(m)) erreurs.push(`${oue} : mécanisme inconnu « ${m} »`);
    }
    for (const b of p.blocs || []) {
      if (!BLOCS.includes(b)) erreurs.push(`${oue} : bloc inconnu « ${b} »`);
    }

    // Les dates sont affichées telles quelles : une date mal formée saute aux yeux.
    for (const e of p.chronologie || []) {
      if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(e.date || '')) {
        erreurs.push(`${oue} : date de chronologie invalide « ${e.date} »`);
      }
      if (!e.texte) erreurs.push(`${oue} : entrée de chronologie sans texte (${e.date})`);
    }
    // Une chronologie non triée se lit mal ; on la signale sans bloquer.
    const dates = (p.chronologie || []).map((e) => e.date);
    if (dates.some((d, i) => i && d < dates[i - 1])) {
      alertes.push(`${oue} : chronologie non ordonnée`);
    }

    for (const s of p.sources || []) {
      if (!/^https?:\/\//.test(s.url || '')) erreurs.push(`${oue} : source sans URL valable (${s.titre})`);
    }
    for (const l of p.lois || []) {
      if (!l.nom || !l.objet) erreurs.push(`${oue} : loi incomplète`);
    }

    if (p.fiche !== undefined) alertes.push(`${oue} : le champ 'fiche' est calculé au chargement, ne pas l'écrire`);

    // Un doublon entre les deux fichiers est légitime — la fiche détaillée gagne —
    // mais un doublon dans le même fichier est une erreur.
    const deja = vus.get(p.code);
    if (deja === source) erreurs.push(`${oue} : code en double dans ${source}`);
    vus.set(p.code, source);
  }
}

// Les fiches détaillées promettent des sources et une date de vérification.
for (const p of detaillees) {
  if (!p.sources || !p.sources.length) erreurs.push(`countries.json / ${p.code} : fiche détaillée sans source`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.verifieLe || '')) {
    erreurs.push(`countries.json / ${p.code} : verifieLe manquant ou mal formé`);
  }
}

// Les chiffres ne doivent pas dériver du CSV : le total mondial est reconstitué.
const monde = figures.countries.WW;
if (!monde || !monde.reconstructed) erreurs.push('figures.json : agrégat mondial absent');
for (const k of ['requests', 'accountsSpecified', 'tweetsWithheld']) {
  const somme = Object.entries(figures.countries)
    .filter(([c]) => c !== 'WW')
    .reduce((t, [, v]) => t + v.total[k], 0);
  if (somme !== monde.total[k]) erreurs.push(`figures.json : total mondial incohérent pour ${k}`);
}

// Un pays cité dans les chiffres sans fiche est acceptable — le serveur en fabrique
// une minimale — mais on veut savoir combien, pour ne pas laisser filer.
const avecFiche = new Set([...detaillees, ...sommaires].map((p) => p.code));
const sansFiche = Object.keys(figures.countries).filter((c) => c !== 'WW' && !avecFiche.has(c));
if (sansFiche.length) alertes.push(`${sansFiche.length} pays n'ont que des chiffres : ${sansFiche.join(' ')}`);

for (const a of alertes) console.warn('  alerte :', a);
for (const e of erreurs) console.error('  erreur :', e);

console.log(`${detaillees.length} fiches détaillées, ${sommaires.length} sommaires, `
  + `${Object.keys(figures.countries).length - 1} pays chiffrés — `
  + `${erreurs.length} erreur(s), ${alertes.length} alerte(s)`);

process.exit(erreurs.length ? 1 : 0);
