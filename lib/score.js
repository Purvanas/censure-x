'use strict';

// Score de censure, sur 100.
//
// Ce n'est pas une mesure, c'est une grille de lecture. Rien dans le monde réel ne
// produit un nombre ; celui-ci est une pondération choisie, et le site montre toujours
// ses trois composantes séparément pour qu'on puisse être en désaccord avec le total
// sans jeter le détail.
//
//   accès (40) + contrainte légale (35) + pression mesurée (25)
//
// Le choix des poids répond à une idée simple : ce qui compte le plus n'est pas le
// nombre de retraits mais la capacité de l'État à faire disparaître. Un pays qui coupe
// la plateforme entière est plus loin qu'un pays qui en fait retirer beaucoup.

// --- accès : 40 points ------------------------------------------------------
// Bloqué vaut le maximum, et de loin : plus rien ne s'y publie ni ne s'y lit.
const ACCES = { libre: 0, restreint: 22, bloque: 40 };

// --- contrainte légale : 35 points ------------------------------------------
// 20 points d'appréciation éditoriale (le champ `severite`, de 0 à 5) et 15 points
// tirés des mécanismes documentés, du plus contraignant au plus anodin.
//
// `retrait-global` vaut zéro à dessein : tous les pays l'ont, il ne distingue rien.
const POIDS_MECANISME = {
  'blocage-fai': 5,
  'ralentissement': 4,
  'representant-local': 3,
  'delai': 3,
  'cwc': 2,
  'age': 2,
  'donnees': 1,
  'etiquetage': 1,
  'amendes': 1,
  'retrait-global': 0,
};
const MAX_MECANISMES = 15;

// --- pression mesurée : 25 points -------------------------------------------
// Trois indicateurs du rapport de X, ramenés à une échelle logarithmique : entre un
// pays à 50 demandes et un pays à 50 000, l'écart intéressant est d'ordre de grandeur,
// pas de proportion. Sans log, le Japon écraserait les cent autres pays à zéro.
const INDICATEURS = ['requests', 'accountsSpecified', 'tweetsWithheld'];
const MAX_PRESSION = 25;

const borne = (x, min, max) => Math.min(max, Math.max(min, x));

function composanteAcces(pays) {
  return ACCES[pays.acces] ?? 0;
}

function composanteLegale(pays) {
  const editorial = borne(Number(pays.severite) || 0, 0, 5) * 4;
  const mecanismes = borne(
    (pays.mecanismes || []).reduce((t, m) => t + (POIDS_MECANISME[m] || 0), 0),
    0, MAX_MECANISMES,
  );
  return { total: editorial + mecanismes, editorial, mecanismes };
}

function composanteMesuree(pays, maxima) {
  // Un pays bloqué ne reçoit plus guère de demandes de retrait : il n'y a plus rien
  // à retirer. Le prendre au pied de la lettre reviendrait à récompenser le blocage,
  // qui est pourtant la forme la plus complète. On porte donc la composante au maximum.
  if (pays.acces === 'bloque') {
    return { total: MAX_PRESSION, raison: 'blocage', chiffresManquants: false };
  }

  const f = pays.chiffres;
  if (!f) return { total: 0, raison: 'aucune-donnee', chiffresManquants: true };

  const parts = INDICATEURS.map((k) => {
    const max = maxima[k] || 0;
    if (!max) return 0;
    return Math.log1p(f.total[k] || 0) / Math.log1p(max);
  });
  const moyenne = parts.reduce((a, b) => a + b, 0) / parts.length;
  return {
    total: Math.round(moyenne * MAX_PRESSION * 10) / 10,
    raison: 'chiffres',
    chiffresManquants: false,
  };
}

// Les maxima servent d'échelle : ils se lisent sur l'ensemble des pays, une fois.
function calculerMaxima(listePays) {
  const max = {};
  for (const k of INDICATEURS) {
    max[k] = listePays.reduce(
      (m, p) => (p.chiffres ? Math.max(m, p.chiffres.total[k] || 0) : m), 0,
    );
  }
  return max;
}

// Cinq paliers nommés : un nombre nu ne dit rien, « Systémique » si.
const PALIERS = [
  { min: 80, cle: 'systemique', nom: 'Systémique', detail: "La plateforme est coupée, ou l'État peut faire disparaître à peu près ce qu'il veut." },
  { min: 60, cle: 'lourde', nom: 'Lourde', detail: 'Retraits massifs ou obligés, avec des moyens de contrainte que la plateforme ne peut pas ignorer.' },
  { min: 40, cle: 'encadree', nom: 'Encadrée', detail: 'Un cadre exigeant, des délais courts, mais un contrôle et des recours qui existent.' },
  { min: 20, cle: 'limitee', nom: 'Limitée', detail: 'Des retraits ciblés, presque toujours fondés sur une décision de justice.' },
  { min: 0, cle: 'faible', nom: 'Faible', detail: "L'État n'a guère de prise : ce qui disparaît relève surtout des règles de X." },
];

function palier(score) {
  return PALIERS.find((p) => score >= p.min) || PALIERS[PALIERS.length - 1];
}

// Un score bas peut vouloir dire deux choses opposées : l'État a peu de prise, ou
// personne n'a documenté ce qu'il fait. La composante éditoriale d'une fiche minimale
// vaut zéro faute de mieux, ce qui tire mécaniquement le score vers le bas. On le dit
// plutôt que de laisser lire un silence comme une bonne note.
const FIABILITE = {
  detaillee: { cle: 'documentee', nom: 'Documenté', detail: 'Fiche détaillée : textes, chronologie et sources vérifiées.' },
  sommaire: { cle: 'partielle', nom: 'Partiel', detail: 'Fiche sommaire : le cadre est décrit, sans chronologie ni sources détaillées.' },
  minimale: { cle: 'indicative', nom: 'Indicatif', detail: "Aucun cadre national documenté : le score est un plancher, pas une mesure. Un pays mal documenté paraît toujours plus libre qu'il ne l'est." },
};

// Calcule le score de chaque pays et le greffe sur la fiche. Modifie les objets en
// place : ils viennent d'être construits par le chargement, personne d'autre ne les voit.
function attribuerScores(listePays) {
  const maxima = calculerMaxima(listePays);

  for (const p of listePays) {
    const acces = composanteAcces(p);
    const legale = composanteLegale(p);
    const mesuree = composanteMesuree(p, maxima);
    const total = Math.round((acces + legale.total + mesuree.total) * 10) / 10;
    const pal = palier(total);
    const fia = FIABILITE[p.fiche] || FIABILITE.minimale;

    p.score = {
      total,
      palier: pal.cle,
      palierNom: pal.nom,
      palierDetail: pal.detail,
      fiabilite: fia.cle,
      fiabiliteNom: fia.nom,
      fiabiliteDetail: fia.detail,
      composantes: {
        acces: { valeur: acces, max: 40, libelle: "État d'accès à la plateforme" },
        legale: {
          valeur: legale.total, max: 35, libelle: 'Contrainte légale',
          editorial: legale.editorial, mecanismes: legale.mecanismes,
        },
        mesuree: {
          valeur: mesuree.total, max: MAX_PRESSION, libelle: 'Pression mesurée',
          raison: mesuree.raison, chiffresManquants: mesuree.chiffresManquants,
        },
      },
    };
  }

  return { maxima, paliers: PALIERS };
}

module.exports = {
  attribuerScores, palier, PALIERS, FIABILITE, ACCES, POIDS_MECANISME,
  MAX_MECANISMES, MAX_PRESSION, INDICATEURS,
};
