# TERRA INCOGNITA — Lot 1

Carte de France médiévale sous brouillard de guerre, dissipé par tes activités
Strava. Site 100 % statique (GitHub Pages) + un petit Worker Cloudflare gratuit
qui garde les secrets. Aucune base de données : tout vit dans ton navigateur.

```
index.html            la page unique
css/  js/  libs/      code de l'application (libs auto-hébergées)
assets/               polices (OFL) et textures
data/                 contours, mers, fleuves + comptes H3 précalculés
worker/worker.js      le Worker Cloudflare (2 routes)
tools/                scripts de précalcul — à ignorer au quotidien
```

Compte 30 à 45 minutes pour tout installer, sans rien connaître au code.

---

## Prérequis

- un compte **GitHub** (gratuit) — hébergera le site ;
- un compte **Cloudflare** (gratuit) — hébergera le Worker ;
- ton compte **Strava** ;
- (Lot 2, facultatif pour l'instant) une clé API **Anthropic** pour les
  chroniques du Codex.

---

## Étape 1 — Publier le site sur GitHub Pages

On commence par le site car son adresse est nécessaire aux étapes suivantes.

1. Sur github.com, connecté, clique **+** (en haut à droite) → **New repository**.
2. Nom : `terra-incognita`. Laisse **Public**. Clique **Create repository**.
3. Sur la page du dépôt vide : **uploading an existing file** (lien dans le
   texte). Glisse-dépose **tout le contenu** de ce dossier (index.html, css,
   js, libs, assets, data, worker, tools, README.md). Si ton navigateur refuse
   les dossiers, dépose le zip puis… non : GitHub ne décompresse pas. Dépose
   les dossiers directement (Chrome/Edge/Firefox savent le faire) puis
   **Commit changes**.
4. **Settings** (onglet du dépôt) → menu **Pages** → section *Build and
   deployment* → Source : **Deploy from a branch** → Branch : **main** et
   **/ (root)** → **Save**.
5. Après 1 à 2 minutes, la même page affiche l'adresse du site, du type
   **`https://TON-PSEUDO.github.io/terra-incognita/`**. Note-la : c'est
   **l'adresse du site**. Elle affichera pour l'instant un message de
   configuration incomplète — c'est normal.

## Étape 2 — Créer ton application Strava

1. Va sur <https://www.strava.com/settings/api> (connecté à Strava).
2. Remplis le formulaire :
   - *Application Name* : `Terra Incognita` (ou ce que tu veux) ;
   - *Category* : Visualizer ;
   - *Website* : l'adresse du site (étape 1) ;
   - *Authorization Callback Domain* : **`TON-PSEUDO.github.io`**
     — uniquement le domaine, sans `https://` ni chemin ;
   - une image quelconque comme logo.
3. Une fois créée, la page affiche :
   - **Client ID** (un nombre) → note-le ;
   - **Client Secret** (clique *show*) → note-le, il reste secret ;
   - **ton ID d'athlète** : ouvre ton profil Strava
     (<https://www.strava.com/athlete/profile> puis « Voir mon profil ») ;
     le nombre à la fin de l'adresse `https://www.strava.com/athletes/XXXXXXX`
     est ton **ATHLETE_ID** → note-le.

## Étape 3 — Déployer le Worker Cloudflare

1. Sur <https://dash.cloudflare.com>, crée un compte / connecte-toi.
2. Menu de gauche : **Compute (Workers)** → **Workers & Pages** →
   **Create** → **Create Worker**.
3. Nom : `terra-incognita` → **Deploy** (il déploie un modèle vide).
4. Clique **Edit code**. Efface tout, colle **l'intégralité du fichier
   `worker/worker.js`**, puis **Deploy** (en haut à droite).
5. Reviens à l'écran du Worker (flèche retour) → onglet **Settings** →
   **Variables and Secrets** → **Add** :

   | Nom | Type | Valeur |
   |---|---|---|
   | `STRAVA_CLIENT_ID` | Text | le Client ID (étape 2) |
   | `STRAVA_CLIENT_SECRET` | **Secret** | le Client Secret (étape 2) |
   | `ATHLETE_ID` | Text | ton ID d'athlète (étape 2) |
   | `ALLOWED_ORIGIN` | Text | `https://TON-PSEUDO.github.io` (sans / final, sans le chemin) |
   | `ANTHROPIC_API_KEY` | **Secret** | (facultatif, Lot 2) ta clé Anthropic |

   Clique **Deploy** après l'ajout.
6. En haut de la page du Worker figure son adresse, du type
   **`https://terra-incognita.TON-COMPTE.workers.dev`** → note-la : c'est
   **l'adresse du Worker**.

Grâce à `ATHLETE_ID` et `ALLOWED_ORIGIN`, même publique, cette instance ne
fonctionne qu'avec **ton** compte Strava et **ton** site.

## Étape 4 — Renseigner la configuration

1. Dans ton dépôt GitHub, ouvre `js/config.js` puis clique le **crayon** ✏️.
2. Remplace les deux `REMPLACE_MOI` :
   - `STRAVA_CLIENT_ID` : le Client ID, entre guillemets, ex. `'134217'` ;
   - `WORKER_URL` : l'adresse du Worker, sans `/` final.
3. **Commit changes**. GitHub Pages republie tout seul (≈ 1 minute).

## Étape 5 — Première expédition

1. Ouvre l'adresse du site (idéalement sur téléphone, puis « Ajouter à
   l'écran d'accueil » pour un vrai plein écran).
2. **Se lier à Strava** → autorise l'application (l'écran Strava doit bien
   mentionner « Voir tes données d'activités, y compris privées »).
3. L'import de tout ton historique démarre : pages de 200 activités, avec une
   pause entre chaque. Laisse l'écran ouvert. À la fin, la caméra plonge sur
   les terres révélées et le brouillard se déchire.

### Quotas Strava — à savoir

L'API Strava autorise environ **100 requêtes / 15 min** et **1 000 / jour**
par application. L'import normal consomme ~1 requête pour 200 activités :
même 3 000 activités passent sans effort. Si le quota tombe (message dédié),
attends un quart d'heure et relance **Synchroniser** : la reprise repart
exactement où elle s'était arrêtée. L'option « haute précision » consomme
1 requête *par activité* — réserve-la aux petits volumes ou étale-la.

### Sauvegarde

Toute la progression vit dans le navigateur. **Réglages → Exporter** produit
un fichier JSON à garder précieusement (aucun secret dedans) ; **Importer**
le restaure sur n'importe quel appareil.

---

## Dépannage

- **« Configuration incomplète »** : `js/config.js` contient encore un
  `REMPLACE_MOI`, ou la modification n'est pas encore republiée.
- **L'autorisation Strava échoue immédiatement** : *Authorization Callback
  Domain* (étape 2) doit être exactement `TON-PSEUDO.github.io`.
- **« Échange du code Strava refusé »** : variables du Worker mal saisies
  (Client ID/Secret), ou `ALLOWED_ORIGIN` différent de l'origine réelle du
  site (attention : pas de `/terra-incognita` dans l'origine, et pas de `/`
  final).
- **« Ce compte Strava n'est pas autorisé »** : l'`ATHLETE_ID` du Worker ne
  correspond pas au compte connecté.
- **Carte grise sans relief** : les tuiles de relief AWS se chargent depuis
  `s3.amazonaws.com` — vérifie qu'aucun bloqueur ne les filtre.
- **Tout réimporter** : Réglages → Réimporter (efface la progression locale
  puis relit l'historique).

## Le dossier `tools/` (pour information)

- `compute-counts.mjs` a précalculé `data/dept-cell-counts.json`
  (5 552 617 cellules H3 de résolution 9 pour la métropole + Corse).
- `make-textures.py` a généré les textures de parchemin et de brume.

Ces scripts ne servent **que** si tu changes un jour de contours (autre pays)
ou de résolution H3. Au quotidien, ne t'en occupe pas.
