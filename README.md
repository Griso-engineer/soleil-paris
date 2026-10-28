# Soleil & protections — Paris

Simulateur pédagogique en ligne : rayonnement solaire à Paris et efficacité des
protections solaires extérieures mobiles (volets battants, volets pliants,
volet roulant, brise-soleil orientable, store toile, store banne).

**En ligne : https://griso-engineer.github.io/soleil-paris/**

Site 100 % statique : HTML, CSS et JavaScript (modules ES), sans étape de build.
Three.js est chargé depuis jsDelivr (version figée 0.160.0).

## Lancer en local

Les modules ES exigent un serveur HTTP (ouvrir `index.html` en double-clic ne marche pas).

Sous Windows, sans rien installer :

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

puis ouvrir http://localhost:8765/. Avec Python ou Node, `python -m http.server`
ou `npx serve` font la même chose.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Interface, textes pédagogiques, méthode |
| `css/style.css` | Styles (clair / sombre, responsive) |
| `js/solar.js` | Position du soleil (NOAA), heure légale de Paris, ciel clair ASHRAE |
| `js/shading.js` | Géométrie des protections, lancer de rayons, apports (EN ISO 52022-1) |
| `js/scene3d.js` | Vue 3D Three.js : pièce, façade, protection, ombres portées |
| `js/charts.js` | Graphiques SVG : courbe du jour, bilan mensuel, diagramme solaire, comparatif |
| `js/main.js` | État, contrôles, enchaînement des calculs, lien partageable (URL) |

L'état complet (orientation, fenêtre, protection, date, heure, vue) est stocké
dans l'URL : copier le lien suffit à partager une configuration.

## Déployer

N'importe quel hébergement statique convient, il suffit de publier le dossier tel quel.

- **GitHub Pages**, sans installer git :
  1. Sur github.com, **New repository** (par ex. `soleil-paris`), visibilité
     **Public** (Pages est gratuit pour les dépôts publics), sans README.
  2. Sur la page du dépôt vide, lien **uploading an existing file**. Glisser
     **le contenu** du dossier `soleil-paris` (pas le dossier lui-même) :
     `index.html` doit être à la racine du dépôt, à côté de `css/` et `js/`.
     Puis **Commit changes**.
  3. **Settings → Pages → Build and deployment** : Source « Deploy from a
     branch », branche `main`, dossier `/ (root)`, **Save**.
  4. Une à deux minutes plus tard, le site est en ligne à
     `https://<votre-compte>.github.io/soleil-paris/`.

  Pour les mises à jour suivantes : **Add file → Upload files** avec les
  fichiers modifiés (ou installer Git / GitHub Desktop pour travailler en local).
  Le fichier `.nojekyll` évite que GitHub retraite le site avec Jekyll.
- **Netlify** / **Cloudflare Pages** : glisser-déposer le dossier, ou relier le
  dépôt avec une commande de build vide et le dossier de publication `.`.
- **Serveur existant** (Apache, Nginx, OVH…) : copier les fichiers dans le
  répertoire web. Vérifier que les `.js` sont servis en `text/javascript`.

`serve.ps1` ne sert qu'au développement local et peut être exclu du déploiement.

## Modèle de calcul

- **Soleil** : algorithme du NOAA, réfraction de Bennett, heure légale française
  (changement d'heure les derniers dimanches de mars et d'octobre).
- **Ciel clair** : modèle ASHRAE, `DNI = A·exp(−B/sin h)`, `DHI = C·DNI`, avec les
  coefficients mensuels interpolés. Albédo du sol 0,2. Les résultats représentent
  une journée sans nuages : l'enveloppe haute des apports.
- **Ombrage** : une grille de points sur le vitrage, un rayon par point vers le
  soleil, et 392 directions hémisphériques (pondération cosinus) pour le diffus du
  ciel et du sol. Obstacles : tableau, vantaux (quadrilatères orientés), toile du
  store banne, protection verticale dans le tableau.
- **Lames** (BSO, persiennes) : transmission directe géométrique à partir de
  l'angle de profil, `f = 1 − w·|sin(φ+β)| / (s·cos φ)`, plus une part
  inter-réfléchie dépendant de la teinte.
- **Apports** : NF EN ISO 52022-1, méthode simplifiée pour une protection
  extérieure, `g_tot = τ·g + α·G/G₂ + τ·(1−g)·G/G₁` (G₁ = 5, G₂ = 10 W/m²K),
  appliquée rayon par rayon, avec un facteur d'angle d'incidence du vitrage
  (Martin & Ruiz). Les obstacles éloignés (store banne, vantaux ouverts) ne
  renvoient pas de chaleur secondaire vers la vitre.

### Limites

Pas de masques lointains (immeubles en vis-à-vis, arbres), pas de météo réelle,
pas d'inertie ni de ventilation, pas de réflexions multiples dans la pièce. Les
propriétés optiques des protections sont des valeurs types. L'outil sert à
comprendre et comparer, pas à dimensionner.

## Pistes d'évolution

- Masques urbains : hauteur et distance de l'immeuble en face (très parisien).
- Météo moyenne (fichier climatique Paris-Montsouris) en plus du ciel clair.
- Comparaison avec une protection intérieure (store intérieur, rideau).
- Estimation de la température intérieure (modèle RC simple).
