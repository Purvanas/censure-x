# censureX

**<https://censure-x.purvanas.fr>**

Choisir un pays, et lire ce que son droit impose à X — ce qui peut faire disparaître un
contenu, sur quel fondement, dans quel délai, et ce que X en fait réellement.

## Pourquoi ce site

X n'obéit pas aux mêmes règles partout, et cette asymétrie est mal documentée. Selon le pays,
un même message peut rester en ligne, être supprimé pour le monde entier, devenir invisible
sur un seul territoire tout en restant lisible ailleurs, ou n'être jamais lu parce que la
plateforme y est coupée à la frontière.

Les chiffres existent — X les publie — mais ils ne disent pas *pourquoi*. Les lois existent —
elles sont publiques — mais personne ne les rapproche des chiffres. Ce site fait le
rapprochement, pays par pays.

## Ce qu'on y trouve

Une **carte du monde** colorée par score ouvre la page : on clique un pays, on tombe sur sa fiche.

Pour chaque pays :

- **un score de censure sur 100**, décomposé en trois composantes visibles ;
- **un état d'accès** — accessible, entravé, bloqué ;
- **les mécanismes** applicables, expliqués : masquage par pays, retrait global, étiquetage
  imposé, blocage par les opérateurs, ralentissement, vérification d'âge, remise de données,
  représentant légal obligatoire, délai légal, sanction financière ;
- **les textes** qui s'imposent à X, avec leur objet et, quand il existe, le délai de retrait
  qu'ils fixent ;
- **une chronologie** des épisodes marquants ;
- **les chiffres publiés par X** : demandes légales reçues, comptes visés, posts et comptes
  effectivement masqués, part du total mondial ;
- **les chiffres récents** pour les pays de l'Union, tirés de la base de transparence du DSA ;
- **un lien vers Lumen**, pour aller lire les injonctions elles-mêmes ;
- **les sources**, et la date à laquelle la fiche y a été confrontée.

Plus un classement — par score, par demandes, par comptes visés, par posts masqués — et une
page qui explique la méthode et le vocabulaire.

## Le score de censure

Sur 100, en trois composantes toujours affichées séparément :

| Composante | Points | Ce qu'elle pèse |
|---|---|---|
| État d'accès | 40 | accessible 0, entravé 22, bloqué 40 |
| Contrainte légale | 35 | 20 d'appréciation du cadre, 15 de mécanismes documentés et pondérés |
| Pression mesurée | 25 | demandes, comptes visés et posts masqués, sur échelle logarithmique |

**Ce n'est pas une mesure, c'est une grille de lecture.** Rien dans le monde réel ne produit un
nombre sur cent ; la pondération est un choix. C'est pourquoi le détail est toujours visible, et
pourquoi le barème complet — maxima compris — est servi sur `/api/score` : le score se recalcule
sans nous croire sur parole.

Deux partis pris qui méritent d'être connus :

- **Un pays bloqué reçoit d'office le maximum de la composante mesurée.** Sinon la Chine et la
  Russie tomberaient en bas du classement, puisqu'un pays qui coupe la plateforme n'a plus besoin
  de demander des retraits. Récompenser le blocage aurait été absurde.
- **Un pays mal documenté paraît plus libre qu'il ne l'est.** Chaque score porte donc une mention
  de fiabilité — documenté, partiel, indicatif — et un score indicatif est un plancher.

Cinq paliers : Faible, Limitée, Encadrée, Lourde, Systémique.

## Trois profondeurs de fiche

| Profondeur | Ce qu'elle contient | Combien |
|---|---|---|
| Détaillée | textes, chronologie, sources datées | 41 pays |
| Sommaire | cadre applicable, sans chronologie | 85 pays |
| Minimale | aucun régime spécifique documenté, mais des chiffres existent | générée au chargement |

Un pays qui n'apparaît que dans le CSV de X reçoit une fiche minimale plutôt que de
disparaître de la liste : son absence de cadre documenté est une information, pas un trou.

## D'où viennent les données

### Les chiffres

Du [Transparency Center de X](https://transparency.x.com/en/reports/removal-requests), et
précisément du **dernier export CSV par pays** que l'entreprise ait mis en téléchargement. Il
couvre dix-huit semestres, du 1ᵉʳ janvier 2012 au 31 décembre 2020, pour 92 pays.

X a cessé de publier ce fichier. Les semestres suivants existent, mais seulement sous forme de
graphiques dans une interface JavaScript, sans jeu de données téléchargeable par pays. Les
totaux affichés ici s'arrêtent donc en 2020, et **le site le répète à chaque fois qu'il les
montre** plutôt que de laisser croire qu'ils sont à jour.

Deux nuances qu'il faut avoir en tête pour les lire :

- une « demande légale » peut viser un seul post ou dix mille comptes — comparer des volumes
  bruts entre pays a ses limites, c'est pourquoi le site affiche aussi les comptes visés ;
- un pays qui bloque X à la frontière n'a plus besoin de demander des retraits. **Un petit
  chiffre n'est pas toujours une bonne nouvelle** : la Chine et la Russie en sont l'exemple.

Le CSV brut est versionné dans le dépôt (`data/x-removal-requests-2012-2020.csv`), pour qu'on
puisse refaire le calcul sans faire confiance à ce site.

### Les chiffres récents, pour l'Europe seulement

L'arrêt des données de X en 2020 a une compensation partielle. Dans l'Union et l'Espace
économique européen, le DSA oblige X à déposer **chaque décision de modération** dans une base
publique, le jour même. `npm run collect:dsa` en collecte la fenêtre glissante la plus récente —
30 jours par défaut, soit environ 400 000 décisions.

**Ces chiffres ne mesurent pas la même chose, et c'est essentiel.** Sur la fenêtre d'août 2026,
X déclare **zéro** injonction d'autorité au sens de l'article 9 du DSA, zéro signalement au sens
de l'article 16, et **91 % de décisions prises sans aucune intervention humaine**. Cette base
mesure la modération de X, que le règlement l'oblige à rendre publique — pas la censure d'État.
Les deux sont intéressantes ; les confondre serait une faute, et le site le répète à chaque
affichage.

Autre singularité visible dans les données : X range ses propres règles internes
(`PlatformManipulation`, `NsfwAdultContent`) sous l'étiquette « contenu illicite », qui devrait
désigner ce qu'une loi interdit. C'est l'un des reproches de la Commission européenne.

### Et l'API interne de X ?

Le Transparency Center alimente ses graphiques par un point d'entrée interne
(`/1.1/strato/column/None/…/cms/prod/transparency/…`). Testé le 15 août 2026 sous toutes ses
formes — avec et sans bornes de dates, sur `api.x.com` et `api.twitter.com`, avec cookie de
session et en-tête CSRF — il répond invariablement 404. `npm run probe:x` rejoue le test et sort
en code 0 le jour où il rouvre. Le script ne contient aucun bearer figé : il exige
`X_PUBLIC_BEARER`, récupéré depuis le Transparency Center au moment du diagnostic.

### Le cadre juridique

Des textes eux-mêmes quand ils sont publics — lois, décrets, décisions de justice — et de
rapports d'organisations spécialisées : Freedom House, Access Now, Article 19, Human Rights
Watch, EFF, NetBlocks pour les coupures. Chaque fiche détaillée liste ses sources.

C'est du travail éditorial, pas une extraction automatique. Il peut donc contenir des erreurs,
et le droit change vite. **Quand une fiche et sa source se contredisent, c'est la source qui a
raison** — le site le dit dans son pied de page.

## Ce que le site ne dit pas

Il ne dit pas si un message précis a été retiré. Chaque fiche renvoie donc vers une recherche
pré-remplie sur [Lumen](https://lumendatabase.org/), au Berkman Klein Center de Harvard, où X
verse une partie des injonctions qu'il reçoit et où l'on peut lire leur texte. Ce sont des liens
et non des données recopiées : l'API JSON de Lumen refuse les requêtes anonymes, seule son
interface de recherche répond.

Il ne dit pas non plus ce que X modère de sa propre initiative. La modération privée et la
censure d'État sont deux sujets différents ; celui-ci ne traite que le second.

## L'API

Tout ce que l'interface affiche est lisible en JSON.

| Route | Ce qu'elle renvoie |
|---|---|
| `GET /api/pays` | la liste allégée, pour peupler un sélecteur ou une carte |
| `GET /api/pays/:code` | la fiche complète d'un pays (code ISO à deux lettres) |
| `GET /api/score` | le barème du score, ses paliers et le classement complet |
| `GET /api/dsa` | la collecte DSA la plus récente, brute |
| `GET /api/classement?critere=…` | classement par `score`, `requests`, `accountsSpecified`, `tweetsWithheld` ou `accountsWithheld` |
| `GET /api/mecanismes` | le vocabulaire : états d'accès et mécanismes |
| `GET /api/blocs` | les régimes communs (DSA, Conseil de l'Europe) |
| `GET /api/ici` | le pays d'où vient la requête, si Cloudflare le dit |
| `GET /api/sante` | état du service |

Chaque pays a aussi une URL partageable : `/pays/fr`, `/pays/tr`, `/pays/br`.

## Faire tourner en local

Prérequis : Node.js 22 ou 24. Le projet n'a aucune dépendance npm à installer.

```bash
cp .env.example .env
npm start               # écoute sur 127.0.0.1:4380
npm run check           # syntaxe + cohérence des fiches
npm run build:figures   # régénère figures.json depuis le CSV
npm run build:carte     # régénère le fond de carte depuis Natural Earth
npm run collect:dsa     # collecte les chiffres récents (DSA_JOURS=30 par défaut)
npm run probe:x         # exige X_PUBLIC_BEARER, puis teste si l'API interne a rouvert
```

Le serveur tient sur le module `http` de Node, le collecteur
lit les ZIP avec `zlib`, et la carte est prétraitée en tracés SVG — pas de bibliothèque
cartographique côté navigateur.

`HOST` et `PORT` se configurent dans `.env`. L'écoute reste en loopback par défaut, prévue pour
un reverse proxy HTTPS. La route `POST /api/recharger` recharge les fichiers en un seul nouvel
instantané : elle reste fermée sans `CENSUREX_ADMIN_TOKEN`, puis exige ce jeton dans l'en-tête
`X-Admin-Token`. Aucune donnée d'identité ni configuration d'infrastructure n'est versionnée.

Le fond de carte vient de [Natural Earth](https://www.naturalearthdata.com/) (domaine public),
en projection équirectangulaire bornée à 84° N et 56° S.

## Indépendance

Site indépendant, sans lien avec X Corp. Le nom et le logo de X appartiennent à leur
propriétaire ; ils ne sont utilisés ici qu'à titre de référence au service décrit.

## Licence

Le code propre au projet est distribué sous licence MIT. Le fond Natural Earth, les jeux de
données publics, les marques et les contenus tiers conservent leurs conditions respectives ;
voir [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Les fiches sont une synthèse éditoriale,
pas un conseil juridique : les sources primaires liées dans chaque fiche font foi.
