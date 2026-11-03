'use strict';

// Sources externes greffées sur les fiches pays.
//
// Deux compléments aux chiffres de X, qui s'arrêtent en 2020 :
//
//  — la base de transparence du DSA, collectée par `npm run collect:dsa`, qui donne
//    des chiffres quotidiens et actuels, mais seulement pour l'Union et l'EEE ;
//  — la base Lumen, où X verse une partie des injonctions qu'il reçoit. Son API JSON
//    refuse les requêtes anonymes (403), donc pas de données embarquées : on renvoie
//    vers une recherche pré-remplie, dont l'URL a été vérifiée le 15/08/2026.

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');

// Les 27 de l'Union, plus l'Islande, le Liechtenstein et la Norvège : le périmètre
// exact où le DSA s'applique, et donc où les déclarations de X existent.
const PERIMETRE_DSA = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO',
]);

// Les libellés du DSA sont des constantes en majuscules ; on les rend lisibles.
const CATEGORIES_FR = {
  STATEMENT_CATEGORY_SCAMS_AND_FRAUD: 'Escroqueries et fraude',
  STATEMENT_CATEGORY_PROTECTION_OF_MINORS: 'Protection des mineurs',
  STATEMENT_CATEGORY_OTHER_VIOLATION_TC: 'Autre violation des conditions',
  STATEMENT_CATEGORY_VIOLENCE: 'Violence',
  STATEMENT_CATEGORY_SELF_HARM: 'Automutilation et suicide',
  STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS: 'Produits interdits ou dangereux',
  STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH: 'Discours illicite ou préjudiciable',
  STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS: 'Atteinte à la propriété intellectuelle',
  STATEMENT_CATEGORY_PORNOGRAPHY_OR_SEXUALIZED_CONTENT: 'Pornographie et contenu sexualisé',
  STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS: 'Atteinte à la vie privée',
  STATEMENT_CATEGORY_NON_CONSENSUAL_BEHAVIOUR: 'Comportement non consenti',
  STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY: 'Risque pour la sécurité publique',
  STATEMENT_CATEGORY_ANIMAL_WELFARE: 'Bien-être animal',
  STATEMENT_CATEGORY_UNSAFE_AND_ILLEGAL_PRODUCTS: 'Produits illicites ou dangereux',
  STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS: 'Atteinte au débat civique ou aux élections',
  STATEMENT_CATEGORY_SCOPE_OF_PLATFORM_SERVICE: 'Périmètre du service',
};

const SOURCES_FR = {
  SOURCE_TYPE_ARTICLE_16: "Signalement d'un utilisateur (art. 16 du DSA)",
  SOURCE_TYPE_TRUSTED_FLAGGER: 'Signaleur de confiance (art. 22 du DSA)',
  SOURCE_TYPE_VOLUNTARY: 'Initiative propre de la plateforme',
  SOURCE_TYPE_OTHER_NOTIFICATION: 'Autre notification',
  SOURCE_TYPE_ABSENT: 'Non renseigné',
};

function chargerDsa() {
  const f = path.join(DATA, 'dsa-recent.json');
  if (!fs.existsSync(f)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));

    // Part de l'automatisation : c'est le chiffre le plus parlant du lot, et il ne se
    // lit nulle part ailleurs. On le calcule une fois, au chargement.
    d.partAutomatisee = d.total ? d.automatisees / d.total : null;
    d.topCategoriesFr = (d.topCategories || []).map((c) => ({
      ...c, nom: CATEGORIES_FR[c.cle] || c.cle,
    }));
    d.parSourceFr = Object.entries(d.parSource || {})
      .sort((a, b) => b[1] - a[1])
      .map(([cle, nombre]) => ({ cle, nombre, nom: SOURCES_FR[cle] || cle }));
    return d;
  } catch (e) {
    console.warn('dsa-recent.json illisible :', e.message);
    return null;
  }
}

// Ce qu'on peut dire d'un pays précis à partir de la collecte DSA.
function dsaPourPays(dsa, code) {
  if (!dsa || !PERIMETRE_DSA.has(code)) return null;
  const n = dsa.parPays[code] || 0;
  return {
    declarations: n,
    parJour: dsa.source.jours ? Math.round(n / dsa.source.jours) : null,
    partUnion: dsa.total ? n / dsa.total : 0,
    couverture: dsa.source.couverture,
    jours: dsa.source.jours,
    collecteLe: dsa.collecteLe,
  };
}

// Recherche pré-remplie sur Lumen. L'API JSON étant fermée aux anonymes, on ne peut
// pas afficher les injonctions elles-mêmes — on emmène le lecteur les lire à la source.
function lienLumen(code, nom) {
  const q = new URLSearchParams({
    recipient_name: 'Twitter',
    sender_country_code: code,
    sort_by: 'date_received desc',
  });
  return {
    url: `https://lumendatabase.org/notices/search?${q}`,
    libelle: `Injonctions reçues par X depuis ${nom}, sur Lumen`,
  };
}

module.exports = { chargerDsa, dsaPourPays, lienLumen, PERIMETRE_DSA, CATEGORIES_FR };
