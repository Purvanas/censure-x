'use strict';

// censureX — tout le rendu est ici. Pas de framework, pas d'étape de build.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const etat = {
  pays: [],
  meca: null,
  region: null,
  filtre: '',
  critere: 'score',
  paliers: [],
  carte: null,
};

// Échelle du vert au rouge, un cran par palier de score. Elle sert à la fois à la
// carte, à la légende et aux barres du classement : une seule vérité de couleur.
const COULEUR_PALIER = {
  faible: '#2f7d55',
  limitee: '#6a9d3f',
  encadree: '#cf9b2a',
  lourde: '#d96a2c',
  systemique: '#cc3b2c',
};
const SANS_DONNEE = '#1b222a';

// Le drapeau se déduit du code ISO : deux lettres → deux symboles régionaux.
function drapeau(code) {
  if (!/^[A-Z]{2}$/.test(code)) return '🏳️';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const nb = (n) => (n == null ? '—' : n.toLocaleString('fr-FR'));
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`);

function dateFr(s) {
  const [a, m, j] = String(s).split('-');
  const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
    'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  if (j) return `${Number(j)}${Number(j) === 1 ? 'er' : ''} ${mois[Number(m) - 1]} ${a}`;
  if (m) return `${mois[Number(m) - 1]} ${a}`;
  return a;
}

// Rien de ce qu'on affiche ne vient d'un tiers, mais les fiches sont du texte libre :
// on échappe systématiquement plutôt que de se fier à leur contenu.
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Une coquille dans une source ne doit jamais créer un lien javascript: actif.
function urlExterne(value) {
  try {
    const url = new URL(String(value), window.location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? esc(url.href) : '#';
  } catch {
    return '#';
  }
}

function afficherErreur(message) {
  const el = $('#erreur-globale');
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
}

// ------------------------------------------------------------------ onglets

function ouvrirOnglet(nom) {
  $$('.vue').forEach((v) => { v.hidden = v.id !== `vue-${nom}`; });
  $$('.nav button').forEach((b) => b.classList.toggle('actif', b.dataset.onglet === nom));
  if (nom === 'classement') rendreClassement();
  if (nom === 'methode') rendreMethode();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

$$('.nav button').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.onglet === 'pays') fermerFiche();
  ouvrirOnglet(b.dataset.onglet);
}));

$('[data-lien-accueil]').addEventListener('click', (e) => {
  e.preventDefault();
  fermerFiche();
  ouvrirOnglet('pays');
});

// ------------------------------------------------------------- liste pays

function rendreFiltres() {
  const regions = [...new Set(etat.pays.map((p) => p.region))].sort((a, b) => a.localeCompare(b, 'fr'));
  const el = $('#filtres-region');
  el.innerHTML = [`<button type="button" data-region="" class="actif">Tous les pays</button>`]
    .concat(regions.map((r) => `<button type="button" data-region="${esc(r)}">${esc(r)}</button>`))
    .join('');
  $$('button', el).forEach((b) => b.addEventListener('click', () => {
    etat.region = b.dataset.region || null;
    $$('button', el).forEach((x) => x.classList.toggle('actif', x === b));
    rendreGrille();
  }));
}

// Comparaison insensible aux accents : « Emirats » doit trouver « Émirats ».
const pliage = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function rendreGrille() {
  const q = pliage(etat.filtre.trim());
  const liste = etat.pays.filter((p) => {
    if (etat.region && p.region !== etat.region) return false;
    if (!q) return true;
    return pliage(p.nom).includes(q) || p.code.toLowerCase() === q;
  });

  const g = $('#grille');
  if (!liste.length) {
    g.innerHTML = `<p class="vide">Aucun pays ne correspond. Ce site couvre ${etat.pays.length} pays&nbsp;; les autres n'ont ni cadre documenté ni chiffres publiés par X.</p>`;
    return;
  }
  g.innerHTML = liste.map((p) => `
    <button type="button" class="carte-pays" data-code="${p.code}">
      <span class="drapeau" aria-hidden="true">${drapeau(p.code)}</span>
      <span class="nom">${esc(p.nom)}</span>
      <span class="pastille ${p.acces}" title="${esc(libelleAcces(p.acces))}"></span>
    </button>`).join('');
  $$('.carte-pays', g).forEach((b) => b.addEventListener('click', () => ouvrirPays(b.dataset.code)));
}

function libelleAcces(a) {
  return ({ libre: 'Accessible', restreint: 'Accès entravé', bloque: 'Bloqué' })[a] || a;
}

// ------------------------------------------------------------------- la carte

async function rendreCarte() {
  let monde;
  try {
    monde = await fetch('/monde.json').then((r) => r.json());
  } catch {
    $('#carte-bloc').hidden = true;          // pas de fond de carte : on s'en passe
    return;
  }
  etat.carte = monde;

  // Les dimensions viennent du fichier, pas du HTML : le jour où on rebâtit la carte
  // avec une autre projection, le cadrage suit sans qu'on ait à y penser.
  $('#carte').setAttribute('viewBox', `0 0 ${monde.largeur} ${monde.hauteur}`);

  const parCode = new Map(etat.pays.map((p) => [p.code, p]));
  const g = $('#carte-pays');

  // Un seul <path> par pays, construit en une passe : 174 nœuds, pas de bibliothèque.
  g.innerHTML = Object.entries(monde.pays).map(([code, d]) => {
    const p = parCode.get(code);
    const couleur = p ? (COULEUR_PALIER[p.palier] || SANS_DONNEE) : SANS_DONNEE;
    return `<path d="${d}" fill="${couleur}" data-code="${code}"`
      + `${p ? ' class="cliquable" tabindex="0" role="button"' : ' class="inerte"'}`
      + ` aria-label="${esc(p ? `${p.nom} — score ${p.score} sur 100` : monde.noms[code] || code)}"></path>`;
  }).join('');

  const bulle = $('#infobulle');
  const cadre = $('.carte-cadre');

  function montrer(cible, ev) {
    const p = parCode.get(cible.dataset.code);
    if (!p) return;
    const pal = etat.paliers.find((x) => x.cle === p.palier);
    bulle.innerHTML = `<strong>${drapeau(p.code)} ${esc(p.nom)}</strong>`
      + `<span class="bulle-score" style="color:${COULEUR_PALIER[p.palier]}">`
      + `${p.score} / 100 · ${esc(pal ? pal.nom : '')}</span>`
      + `<span class="bulle-acces">${esc(libelleAcces(p.acces))}</span>`
      + (p.fiabilite === 'indicative' ? '<span class="bulle-note">score indicatif : cadre non documenté</span>' : '');
    bulle.hidden = false;
    const r = cadre.getBoundingClientRect();
    const x = (ev.clientX ?? r.left + r.width / 2) - r.left;
    const y = (ev.clientY ?? r.top + r.height / 2) - r.top;
    bulle.style.left = `${Math.min(Math.max(8, x + 14), r.width - bulle.offsetWidth - 8)}px`;
    bulle.style.top = `${Math.max(8, y - bulle.offsetHeight - 12)}px`;
  }

  g.addEventListener('mousemove', (e) => {
    const c = e.target.closest('path.cliquable');
    if (c) montrer(c, e); else bulle.hidden = true;
  });
  g.addEventListener('mouseleave', () => { bulle.hidden = true; });
  g.addEventListener('focusin', (e) => {
    const c = e.target.closest('path.cliquable');
    if (c) montrer(c, {});
  });
  g.addEventListener('focusout', () => { bulle.hidden = true; });
  g.addEventListener('click', (e) => {
    const c = e.target.closest('path.cliquable');
    if (c) ouvrirPays(c.dataset.code);
  });
  g.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const c = e.target.closest('path.cliquable');
    if (c) { e.preventDefault(); ouvrirPays(c.dataset.code); }
  });

  // Légende : les paliers du plus grave au plus léger, comme on lit une échelle.
  $('#legende').innerHTML = [...etat.paliers]
    .sort((a, b) => b.min - a.min)
    .map((p) => `<span class="cle" title="${esc(p.detail)}">
        <i style="background:${COULEUR_PALIER[p.cle]}"></i>${esc(p.nom)}
      </span>`).join('')
    + `<span class="cle"><i style="background:${SANS_DONNEE}"></i>hors périmètre</span>`;

  const absents = etat.pays.filter((p) => !monde.pays[p.code]);
  $('#carte-note').innerHTML =
    `Fond de carte&nbsp;: <a href="${urlExterne(monde.source.url)}" target="_blank" rel="noreferrer noopener">Natural Earth</a>, domaine public. `
    + `Cliquez un pays pour ouvrir sa fiche.`
    + (absents.length
      ? ` Trop petits pour ce fond de carte, mais présents dans la liste&nbsp;: ${absents.map((p) => esc(p.nom)).join(', ')}.`
      : '');
}

$('#recherche').addEventListener('input', (e) => {
  etat.filtre = e.target.value;
  rendreGrille();
});

// Entrée sur une recherche qui ne laisse qu'un pays : on l'ouvre.
$('#recherche').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const carte = $('.carte-pays', $('#grille'));
  if (carte && $$('.carte-pays', $('#grille')).length === 1) ouvrirPays(carte.dataset.code);
});

// --------------------------------------------------------------- fiche pays

async function ouvrirPays(code, sansHistorique) {
  let d;
  try {
    const r = await fetch(`/api/pays/${encodeURIComponent(code)}`);
    if (!r.ok) throw new Error('inconnu');
    d = await r.json();
  } catch {
    afficherErreur('Cette fiche ne peut pas être chargée pour le moment. Réessayez dans quelques instants.');
    return;
  }
  afficherErreur('');
  rendreFiche(d);
  if (!sansHistorique) history.pushState({ code }, '', `/pays/${code.toLowerCase()}`);
  ouvrirOnglet('pays');
}

function fermerFiche() {
  $('#fiche').hidden = true;
  $('#choix').hidden = false;
  if (location.pathname !== '/') history.pushState({}, '', '/');
}

// Le score, avec ses trois composantes en clair. Un total qu'on ne peut pas
// décomposer ne se discute pas — et celui-ci mérite d'être discuté.
function blocScore(p) {
  const s = p.score;
  if (!s) return '';
  const c = s.composantes;
  const couleur = COULEUR_PALIER[s.palier] || SANS_DONNEE;

  const barre = (comp, precision) => `
    <div class="compo">
      <div class="compo-tete">
        <span>${esc(comp.libelle)}</span>
        <b>${comp.valeur} <small>/ ${comp.max}</small></b>
      </div>
      <div class="jauge"><i style="width:${(comp.valeur / comp.max * 100).toFixed(1)}%;background:${couleur}"></i></div>
      ${precision ? `<span class="compo-note">${precision}</span>` : ''}
    </div>`;

  const notesMesure = {
    blocage: "porté au maximum : la plateforme est coupée, les demandes de retrait n'ont plus d'objet",
    'aucune-donnee': 'aucun chiffre publié par X pour ce pays : la composante vaut zéro faute de mieux',
    chiffres: 'échelle logarithmique sur les demandes, les comptes visés et les posts masqués',
  };

  return `
    <div class="bloc score-bloc">
      <div class="score-tete">
        <div class="score-nombre" style="color:${couleur}">
          ${s.total}<small>/100</small>
        </div>
        <div class="score-texte">
          <strong style="color:${couleur}">${esc(s.palierNom)}</strong>
          <span>${esc(s.palierDetail)}</span>
          <span class="fiabilite ${s.fiabilite}" title="${esc(s.fiabiliteDetail)}">${esc(s.fiabiliteNom)}</span>
        </div>
      </div>
      <div class="compos">
        ${barre(c.acces, esc(libelleAcces(p.acces)))}
        ${barre(c.legale, `${c.legale.editorial} d'appréciation du cadre, ${c.legale.mecanismes} de mécanismes documentés`)}
        ${barre(c.mesuree, esc(notesMesure[c.mesuree.raison] || ''))}
      </div>
      <p class="note">
        Ce score est une grille de lecture, pas une mesure&nbsp;: la pondération est un choix,
        expliqué et recalculable dans l'onglet Méthode.
        ${s.fiabilite === 'indicative' ? `<strong> ${esc(s.fiabiliteDetail)}</strong>` : ''}
      </p>
    </div>`;
}

// Les déclarations que le DSA oblige X à publier chaque jour. Actuelles, mais
// européennes seulement — et ce sont ses propres décisions, pas des ordres d'État.
function blocDsa(p) {
  if (!p.dsa) return '';
  const d = p.dsa;
  return `
    <h2>Ce que X déclare retirer aujourd'hui</h2>
    <div class="bloc">
      <div class="chiffres">
        <div class="chiffre">
          <b>${nb(d.declarations)}</b>
          <span>décisions de modération visant ce pays</span>
          <em>sur ${d.jours} jours (${esc(d.couverture)})</em>
        </div>
        <div class="chiffre">
          <b>${nb(d.parJour)}</b>
          <span>par jour en moyenne</span>
        </div>
        <div class="chiffre">
          <b>${pct(d.partUnion)}</b>
          <span>des décisions de X dans l'Union</span>
          <div class="jauge"><i style="width:${Math.min(100, d.partUnion * 100).toFixed(1)}%"></i></div>
        </div>
      </div>
      <p class="note" style="margin-top:14px">
        Source&nbsp;: base de transparence du DSA, où le règlement européen oblige X à déposer
        chaque décision. <strong>À lire avec précaution</strong>&nbsp;: ce sont très
        majoritairement des décisions que X prend seul, pas des retraits ordonnés par l'État.
        Le détail est dans l'onglet Méthode.
      </p>
    </div>`;
}

function rendreFiche({ pays: p, monde, source }) {
  const f = p.chiffres;
  const part = (k) => (f && monde.total[k] ? f.total[k] / monde.total[k] : 0);

  const mecas = (p.mecanismes || [])
    .map((id) => etat.meca.mecanismes[id])
    .filter(Boolean);

  const blocs = (p.blocsDetail || []);

  const html = `
    <button type="button" class="retour" id="retour">← Tous les pays</button>

    <div class="fiche-tete">
      <span class="drapeau" aria-hidden="true">${drapeau(p.code)}</span>
      <div>
        <h1>${esc(p.nom)}</h1>
        <div class="region">${esc(p.region)}</div>
      </div>
      <div style="margin-left:auto">
        <span class="etat ${p.acces}">${esc(libelleAcces(p.acces))}</span>
      </div>
    </div>

    ${blocScore(p)}

    <p class="resume">${esc(p.resume)}</p>

    ${mecas.length ? `
    <h2>Ce qui peut arriver à un contenu</h2>
    <ul class="meca-liste">
      ${mecas.map((m) => `
        <li class="meca" title="${esc(m.detail || m.definition)}">
          <strong>${esc(m.nom)}</strong>
          <span>${esc(m.definition)}</span>
        </li>`).join('')}
    </ul>` : ''}

    ${p.lois && p.lois.length ? `
    <h2>Les textes qui s'imposent à X</h2>
    <div class="bloc">
      ${p.lois.map((l) => `
        <div class="loi">
          <h3>${esc(l.nom)}</h3>
          <p>${esc(l.objet)}</p>
          ${l.delai ? `<span class="delai">Délai&nbsp;: ${esc(l.delai)}</span>` : ''}
        </div>`).join('')}
    </div>` : ''}

    ${blocs.map((b) => `
      <h2>${esc(b.nom)}</h2>
      <div class="bloc">
        <p>${esc(b.resume)}</p>
        ${b.points ? `<ul>${b.points.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${b.autresTextes ? b.autresTextes.map((t) => `
          <div class="loi"><h3>${esc(t.nom)}</h3><p>${esc(t.detail)}</p></div>`).join('') : ''}
        ${b.chronologie ? `<ul class="chrono" style="margin-top:14px">${b.chronologie.map((e) => `
          <li><time>${esc(dateFr(e.date))}</time><p>${esc(e.texte)}</p></li>`).join('')}</ul>` : ''}
      </div>`).join('')}

    ${p.chronologie && p.chronologie.length ? `
    <h2>Ce qui s'est passé</h2>
    <div class="bloc">
      <ul class="chrono">
        ${p.chronologie.map((e) => `
          <li><time>${esc(dateFr(e.date))}</time><p>${esc(e.texte)}</p></li>`).join('')}
      </ul>
    </div>` : ''}

    ${f ? `
    <h2>Les chiffres publiés par X</h2>
    <div class="bloc">
      <div class="chiffres">
        <div class="chiffre">
          <b>${nb(f.total.requests)}</b>
          <span>demandes légales reçues</span>
          <em>${pct(part('requests'))} du total mondial</em>
          <div class="jauge"><i style="width:${Math.min(100, part('requests') * 100).toFixed(1)}%"></i></div>
        </div>
        <div class="chiffre">
          <b>${nb(f.total.accountsSpecified)}</b>
          <span>comptes visés par ces demandes</span>
          <em>${pct(part('accountsSpecified'))} du total mondial</em>
          <div class="jauge"><i style="width:${Math.min(100, part('accountsSpecified') * 100).toFixed(1)}%"></i></div>
        </div>
        <div class="chiffre">
          <b>${nb(f.total.tweetsWithheld)}</b>
          <span>posts rendus invisibles dans le pays</span>
          <em>masquage local, pas suppression</em>
        </div>
        <div class="chiffre">
          <b>${nb(f.total.accountsWithheld)}</b>
          <span>comptes rendus invisibles dans le pays</span>
          <em>l'auteur ne le voit pas toujours</em>
        </div>
      </div>
      ${f.last && f.last.complianceRate != null ? `
      <p class="note" style="margin-top:14px">
        Sur le dernier semestre publié (${esc(dateFr(f.lastPeriod))}), X a donné suite à
        <strong>${pct(f.last.complianceRate)}</strong> des demandes venues de ce pays.
      </p>` : ''}
      ${p.chiffresNote ? `<p class="note">${esc(p.chiffresNote)}</p>` : ''}
      <p class="note">
        Période couverte&nbsp;: ${esc(source.coverage)}. ${esc(source.note)}
      </p>
    </div>` : `
    <div class="bloc">
      <p class="note">X n'a publié aucun chiffre de demandes légales pour ce pays sur la période 2012&ndash;2020.</p>
    </div>`}

    ${blocDsa(p)}

    ${p.lumen ? `
    <h2>Lire les injonctions elles-mêmes</h2>
    <div class="bloc">
      <p>
        X verse une partie des demandes légales qu'il reçoit à la base
        <a href="https://lumendatabase.org/" target="_blank" rel="noreferrer noopener">Lumen</a>,
        au Berkman Klein Center de Harvard. C'est le seul endroit où l'on peut lire le texte
        d'une injonction précise plutôt qu'un total.
      </p>
      <p style="margin-bottom:0">
        <a class="lien-fort" href="${urlExterne(p.lumen.url)}" target="_blank" rel="noreferrer noopener">
          ${esc(p.lumen.libelle)} →</a>
      </p>
      <p class="note">
        Recherche ouverte chez Lumen, pas de données recopiées ici&nbsp;: leur interface publique
        répond, mais leur API refuse les requêtes anonymes.
      </p>
    </div>` : ''}

    ${p.sources && p.sources.length ? `
    <h2>Sources</h2>
    <div class="bloc">
      <ul class="sources">
        ${p.sources.map((s) => `<li><a href="${urlExterne(s.url)}" target="_blank" rel="noreferrer noopener">${esc(s.titre)}</a></li>`).join('')}
        ${blocs.flatMap((b) => b.sources || []).map((s) => `<li><a href="${urlExterne(s.url)}" target="_blank" rel="noreferrer noopener">${esc(s.titre)}</a></li>`).join('')}
      </ul>
      ${p.verifieLe ? `<p class="note" style="margin-top:10px">Fiche confrontée à ces sources le ${esc(dateFr(p.verifieLe))}.</p>` : ''}
    </div>` : `
    <div class="bloc">
      <p class="note">
        Fiche ${p.fiche === 'minimale' ? 'minimale' : 'sommaire'}&nbsp;: le cadre général est indiqué,
        sans chronologie ni sources détaillées. Les chiffres, eux, viennent bien du rapport de X.
      </p>
    </div>`}
  `;

  const el = $('#fiche');
  el.innerHTML = html;
  el.hidden = false;
  $('#choix').hidden = true;
  $('#retour', el).addEventListener('click', fermerFiche);
}

// --------------------------------------------------------------- classement

const CRITERES = [
  {
    id: 'score', nom: 'Score de censure', unite: 'points',
    chapo: "Les 126 pays, du plus fermé au plus ouvert. Le score combine l'état d'accès à la "
      + "plateforme, la contrainte que le droit local fait peser sur elle, et l'ampleur mesurée "
      + 'des retraits. C\'est une grille de lecture assumée, détaillée dans l\'onglet Méthode.',
  },
  {
    id: 'requests', nom: 'Demandes légales', unite: 'demandes',
    chapo: 'Nombre de demandes légales adressées à X, tous motifs confondus. Chiffres publiés '
      + 'par X pour la période 2012-2020 — le dernier jeu de données par pays qu\'il ait mis en '
      + 'téléchargement.',
  },
  {
    id: 'accountsSpecified', nom: 'Comptes visés', unite: 'comptes',
    chapo: 'Comptes nommés dans ces demandes. Un seul courrier peut en viser des milliers : '
      + 'c\'est ici que se voient les demandes massives, invisibles dans le simple décompte.',
  },
  {
    id: 'tweetsWithheld', nom: 'Posts masqués', unite: 'posts',
    chapo: 'Posts effectivement rendus invisibles dans le pays, et seulement là. C\'est la '
      + 'mesure de ce que X a réellement exécuté, pas de ce qu\'on lui a demandé.',
  },
  {
    id: 'accountsWithheld', nom: 'Comptes masqués', unite: 'comptes',
    chapo: 'Comptes entiers rendus inaccessibles depuis le pays. La sanction la plus lourde '
      + 'du masquage local : ce n\'est plus un message qui disparaît, c\'est une voix.',
  },
];

function rendreSegments() {
  const el = $('#segments-classement');
  if (el.dataset.pret) return;
  el.dataset.pret = '1';
  el.innerHTML = CRITERES.map((c) => `
    <button type="button" data-critere="${c.id}" class="${c.id === etat.critere ? 'actif' : ''}">${esc(c.nom)}</button>`).join('');
  $$('button', el).forEach((b) => b.addEventListener('click', () => {
    etat.critere = b.dataset.critere;
    $$('button', el).forEach((x) => x.classList.toggle('actif', x === b));
    rendreClassement();
  }));
}

async function rendreClassement() {
  rendreSegments();
  const conteneur = $('#classement');
  let d;
  try {
    const r = await fetch(`/api/classement?critere=${encodeURIComponent(etat.critere)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    d = await r.json();
  } catch {
    conteneur.innerHTML = '<div class="bloc"><p class="note">Le classement est momentanément indisponible. Réessayez dans quelques instants.</p></div>';
    return;
  }
  const crit = CRITERES.find((c) => c.id === etat.critere);
  const max = d.lignes.length ? d.lignes[0].valeur : 1;
  const estScore = etat.critere === 'score';

  $('#chapo-classement').textContent = crit.chapo;

  const couleurAcces = { libre: 'var(--libre)', restreint: 'var(--restreint)', bloque: 'var(--bloque)' };
  const couleur = (l) => (estScore
    ? (COULEUR_PALIER[l.palier] || SANS_DONNEE)
    : (couleurAcces[l.acces] || 'var(--accent)'));

  conteneur.innerHTML = `
    <div class="bloc">
      <p class="note" style="margin-top:0">
        ${estScore
          ? "La couleur de la barre reprend le palier du score, du vert au rouge."
          : `Total mondial sur la période&nbsp;: <strong>${nb(d.monde)}</strong> ${esc(crit.unite)}.
             La couleur de la barre indique l'état d'accès à X dans le pays.`}
      </p>
    </div>
    ${d.lignes.map((l, i) => `
      <div class="rang">
        <span class="n">${i + 1}</span>
        <div class="corps">
          <div class="ligne">
            <button type="button" class="lien" data-code="${l.code}">${drapeau(l.code)} ${esc(l.nom)}</button>
            <span class="val">${estScore ? `${l.valeur}<small>/ 100</small>` : `${nb(l.valeur)}<small>${pct(l.part)}</small>`}</span>
          </div>
          <div class="barre"><i style="width:${Math.max(0.6, (l.valeur / max) * 100).toFixed(2)}%;background:${couleur(l)}"></i></div>
        </div>
      </div>`).join('')}
  `;
  $$('#classement .lien').forEach((b) => b.addEventListener('click', () => ouvrirPays(b.dataset.code)));
}

// ------------------------------------------------------------------ méthode

async function rendreMethode() {
  const el = $('#methode');
  if (el.dataset.pret) return;
  el.dataset.pret = '1';

  const [bareme, dsa] = await Promise.all([
    fetch('/api/score').then((r) => r.json()).catch(() => null),
    fetch('/api/dsa').then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);

  const m = etat.meca;
  el.innerHTML = `
    <p class="chapo">
      Ce site répond à une question précise&nbsp;: dans un pays donné, qu'est-ce qui peut faire
      disparaître un contenu de X, et sur quel fondement. Il ne dit pas si un message
      particulier a été retiré — cela, seule la base Lumen le documente.
    </p>

    <h2>Le score de censure, et pourquoi s'en méfier</h2>
    <div class="bloc">
      <p>
        Rien dans le monde réel ne produit un nombre sur cent. Ce score est une pondération
        choisie, utile pour comparer d'un coup d'œil et trompeuse si on la prend pour une mesure.
        Chaque fiche montre donc ses trois composantes séparément&nbsp;: on peut rejeter le total
        et garder le détail.
      </p>
      <dl>
        <dt>État d'accès — 40 points</dt>
        <dd>
          Accessible&nbsp;0, accès entravé&nbsp;22, bloqué&nbsp;40. C'est la composante la plus
          lourde parce qu'elle est la plus définitive&nbsp;: là où la plateforme est coupée,
          la question des retraits ne se pose même plus.
        </dd>
        <dt>Contrainte légale — 35 points</dt>
        <dd>
          20 points d'appréciation du cadre national, 15 points tirés des mécanismes documentés,
          pondérés du plus contraignant au plus anodin&nbsp;: blocage par les opérateurs&nbsp;5,
          ralentissement&nbsp;4, représentant légal obligatoire&nbsp;3, délai légal&nbsp;3,
          masquage par pays&nbsp;2, vérification d'âge&nbsp;2, le reste 1 ou 0.
          Le retrait global vaut zéro à dessein&nbsp;: tous les pays l'ont, il ne distingue rien.
        </dd>
        <dt>Pression mesurée — 25 points</dt>
        <dd>
          Trois indicateurs du rapport de X — demandes, comptes visés, posts masqués — sur une
          échelle logarithmique, parce qu'entre 50 et 50&nbsp;000 demandes l'écart intéressant est
          d'ordre de grandeur. Un pays bloqué reçoit d'office le maximum&nbsp;: le prendre au pied
          de la lettre reviendrait à récompenser le blocage, qui est pourtant la forme la plus
          complète.
        </dd>
      </dl>
      <p class="note">
        <strong>Le biais qu'il faut connaître.</strong> Un pays mal documenté obtient un score bas,
        ce qui se lit à tort comme «&nbsp;peu de censure&nbsp;». Chaque score porte donc une mention
        de fiabilité — documenté, partiel, indicatif — et un score indicatif est un plancher,
        jamais une mesure.
      </p>
      ${bareme ? `<p class="note">
        Le barème complet, avec les maxima qui servent d'échelle, est servi tel quel sur
        <code>/api/score</code>&nbsp;: le score se recalcule sans nous croire sur parole.
      </p>` : ''}
    </div>

    <h2>Ce que veut dire chaque état d'accès</h2>
    <div class="bloc"><dl>
      ${Object.entries(m.acces).map(([k, v]) => `
        <dt><span class="pastille ${k}" style="display:inline-block;margin-right:7px"></span>${esc(v.nom)}</dt>
        <dd>${esc(v.definition)}</dd>`).join('')}
    </dl></div>

    <h2>Les moyens employés</h2>
    <div class="bloc"><dl>
      ${Object.values(m.mecanismes).map((v) => `
        <dt>${esc(v.nom)}${v.sigle ? ` <span class="note">(${esc(v.sigle)})</span>` : ''}</dt>
        <dd>${esc(v.definition)}${v.detail ? ` ${esc(v.detail)}` : ''}</dd>`).join('')}
    </dl></div>

    <h2>D'où viennent les chiffres</h2>
    <div class="bloc">
      <p>
        Du <a href="https://transparency.x.com/en/reports/removal-requests" target="_blank" rel="noreferrer noopener">Transparency Center de X</a>,
        et plus précisément du dernier export CSV par pays que l'entreprise ait publié&nbsp;: il
        couvre les dix-huit semestres allant du 1<sup>er</sup> janvier 2012 au 31 décembre 2020.
      </p>
      <p>
        Depuis, X a cessé de proposer ce fichier. Les semestres suivants existent, mais seulement
        sous forme de graphiques dans une interface JavaScript, sans jeu de données téléchargeable
        par pays. Les totaux affichés ici s'arrêtent donc en 2020, et le site le répète à chaque
        fois qu'il les montre plutôt que de laisser croire qu'ils sont à jour.
      </p>
      <p class="note">
        Deux nuances utiles. Une «&nbsp;demande légale&nbsp;» peut viser un seul post ou dix mille
        comptes&nbsp;: comparer des volumes bruts entre pays a donc ses limites. Et un pays qui
        bloque X à la frontière, comme la Chine ou la Russie, n'a plus besoin de demander de
        retraits — un petit chiffre n'est pas toujours une bonne nouvelle.
      </p>
    </div>

    <h2>Les chiffres récents, et pourquoi ils ne disent pas la même chose</h2>
    <div class="bloc">
      ${dsa ? `
      <p>
        L'arrêt des données de X en 2020 a une compensation partielle&nbsp;: dans l'Union et
        l'Espace économique européen, le DSA oblige X à déposer <em>chaque décision de
        modération</em> dans une base publique, le jour même. Nous en collectons la fenêtre
        glissante la plus récente.
      </p>
      <div class="chiffres">
        <div class="chiffre">
          <b>${nb(dsa.total)}</b><span>décisions déposées par X</span>
          <em>sur ${dsa.source.jours} jours (${esc(dsa.source.couverture)})</em>
        </div>
        <div class="chiffre">
          <b>${nb(dsa.moyenneParJour)}</b><span>par jour</span>
        </div>
        <div class="chiffre">
          <b>${pct(dsa.partAutomatisee)}</b><span>prises sans intervention humaine</span>
        </div>
        <div class="chiffre">
          <b>${nb(dsa.ordresAutorite)}</b><span>déclarées comme ordre d'une autorité</span>
          <em>sur toute la fenêtre</em>
        </div>
      </div>
      <p style="margin-top:16px">
        <strong>Ce chiffre de zéro mérite qu'on s'y arrête.</strong> Sur cette fenêtre, X
        n'a déclaré aucune injonction d'autorité au sens de l'article 9 du DSA, ni aucun
        signalement au sens de l'article 16&nbsp;: la totalité de ses décisions est rangée sous
        «&nbsp;autre notification&nbsp;». Autrement dit, cette base ne mesure pas la censure
        d'État&nbsp;: elle mesure la modération de X, que le règlement l'oblige à rendre publique.
        Les deux sont intéressantes, elles ne se confondent pas.
      </p>
      <p>
        Autre singularité&nbsp;: X classe ses propres règles internes — <code>PlatformManipulation</code>,
        <code>NsfwAdultContent</code> — dans la case «&nbsp;contenu illicite&nbsp;», qui devrait
        désigner ce qu'une loi interdit. C'est l'un des reproches que la Commission européenne
        lui adresse.
      </p>
      <p class="note">
        Périmètre&nbsp;: 27 pays de l'Union plus l'Islande, le Liechtenstein et la Norvège. Ailleurs,
        les seuls chiffres disponibles restent ceux de X, arrêtés en 2020. Données collectées le
        ${esc(dateFr(String(dsa.collecteLe).slice(0, 10)))} ;
        source&nbsp;: <a href="${urlExterne(dsa.source.url)}" target="_blank" rel="noreferrer noopener">base de transparence du DSA</a>.
      </p>` : `
      <p class="note">
        La collecte des données récentes n'a pas encore été lancée sur ce serveur
        (<code>npm run collect:dsa</code>).
      </p>`}
      <p class="note">
        <strong>Et l'API de X&nbsp;?</strong> Le Transparency Center alimente ses graphiques par
        un point d'entrée interne. Testé le 15 août 2026 sous toutes ses formes — avec et sans
        bornes de dates, sur deux domaines, avec cookie de session et en-tête CSRF — il répond
        invariablement 404&nbsp;: il n'est plus ouvert. Le test est rejouable
        (<code>npm run probe:x</code>), et le jour où il rouvre, on le saura.
      </p>
    </div>

    <h2>D'où vient le cadre juridique</h2>
    <div class="bloc">
      <p>
        Des textes eux-mêmes quand ils sont publics — lois, décrets, décisions de justice — et de
        rapports d'organisations spécialisées&nbsp;: Freedom House, Access Now, Article 19,
        Human Rights Watch, EFF, NetBlocks pour les coupures. Chaque fiche détaillée liste ses
        sources et la date à laquelle elle y a été confrontée.
      </p>
      <p>
        Les fiches sont de trois profondeurs. <strong>Détaillée</strong>&nbsp;: textes, chronologie
        et sources. <strong>Sommaire</strong>&nbsp;: le cadre applicable, sans chronologie.
        <strong>Minimale</strong>&nbsp;: aucun régime spécifique documenté, mais des chiffres
        existent — le pays reste dans la liste plutôt que de disparaître.
      </p>
      <p class="note">
        Le droit change vite, et ce site est une photographie. Quand une fiche et sa source se
        contredisent, c'est la source qui a raison.
      </p>
    </div>

    <h2>Pour aller voir les demandes une par une</h2>
    <div class="bloc">
      <p>
        X transmet une partie des injonctions qu'il reçoit à la
        <a href="https://lumendatabase.org/" target="_blank" rel="noreferrer noopener">base Lumen</a>,
        hébergée par le Berkman Klein Center de Harvard. On y lit le texte des demandes, y compris
        celles qui ont abouti à un masquage par pays. C'est le seul endroit où l'on peut vérifier
        une décision précise.
      </p>
      <p>
        Pour l'Union européenne, la
        <a href="https://transparency.dsa.ec.europa.eu/" target="_blank" rel="noreferrer noopener">DSA Transparency Database</a>
        recense les motifs de chaque restriction déclarée par les plateformes, X compris.
      </p>
    </div>
  `;
}

// ------------------------------------------------------------- « mon pays »

async function proposerMonPays() {
  try {
    const r = await fetch('/api/ici');
    const d = await r.json();
    if (!d.code) return;
    const p = etat.pays.find((x) => x.code === d.code);
    if (!p) return;
    const b = $('#bouton-ici');
    b.textContent = `${drapeau(p.code)} ${p.nom}`;
    b.hidden = false;
    b.addEventListener('click', () => ouvrirPays(p.code));
  } catch { /* pas de Cloudflare devant : on n'affiche simplement rien */ }
}

// ------------------------------------------------------------------ départ

window.addEventListener('popstate', () => router(true));

function router(sansHistorique) {
  const m = location.pathname.match(/^\/pays\/([a-zA-Z]{2})\/?$/);
  if (m) ouvrirPays(m[1].toUpperCase(), true);
  else { $('#fiche').hidden = true; $('#choix').hidden = false; }
  void sansHistorique;
}

(async function demarrer() {
  let liste;
  let meca;
  try {
    [liste, meca] = await Promise.all([
      fetch('/api/pays').then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
      fetch('/api/mecanismes').then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    ]);
  } catch {
    $('#carte-bloc').hidden = true;
    $('#filtres-region').hidden = true;
    $('#grille').innerHTML = '<p class="vide">Les données ne peuvent pas être chargées pour le moment. Réessayez dans quelques instants.</p>';
    return;
  }
  etat.pays = liste.pays;
  etat.meca = meca;

  etat.paliers = liste.paliers || [];

  rendreFiltres();
  rendreGrille();
  rendreCarte();
  proposerMonPays();
  router(true);
})();
