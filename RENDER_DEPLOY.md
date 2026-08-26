# Déployer ce repo (TurboWarp / scratch-gui) sur Render — plan gratuit

Ce dépôt est un **site statique** : le build webpack génère un dossier `build/`
qui peut être servi par le CDN de Render. Le plan gratuit de Render propose des
**Static Sites gratuits**, c'est donc la bonne solution ici. Aucune
fonctionnalité n'a été retirée : le build continue de produire l'éditeur, le
player, fullscreen, embed, addons, crédits, etc.

---

## 1. Ce qui a été ajouté / modifié

| Fichier | Rôle |
|---|---|
| `render.yaml` | Blueprint Render : crée automatiquement le Static Site avec la commande de build et le dossier à publier. |
| `package.json` | Ajout de `build:render` et `build:render:lowmem`. |
| `webpack.config.js` | Permet de générer **uniquement le playground** (`SKIP_DIST=1`) et de **désactiver la minification** (`SKIP_MINIFY=1`) pour réduire la mémoire du build. Le build normal (`npm run build`) reste inchangé. |
| `scripts/prepublish.mjs` | Générateur micro:bit rendu plus robuste : retries, suffixe d'URL `MICROBIT_HEX_URL` / `MICROBIT_HEX_SHA256`, et réutilisation d'un fichier déjà présent. |

### Pourquoi ces changements ?

- `npm run build` seul produit aussi le bundle **library `/dist`**, ce qui est
  inutile pour le site et consomme beaucoup de mémoire/RAM pendant le build.
- Le plan gratuit Render a des builds avec très peu de RAM. `build:render:lowmem`
  produit le site complet sans minification (le code reste fonctionnel, il est
  juste plus gros).
- `--ignore-scripts` pendant `npm ci` évite le téléchargement des navigateurs
  de test (`chromedriver`, `playwright-chromium`, `puppeteer`) qui n'est pas
  nécessaire pour servir le site.
- `node scripts/prepublish.mjs` est lancé explicitement pour générer le firmware
  micro:bit (feature existante) sans bloquer le `npm ci`.

---

## 2. Prérequis

1. Un compte GitHub avec ce dépôt.
2. Un compte [Render](https://render.com/) (gratuit).
3. Les changements de cette branche doivent être poussés sur GitHub.

```bash
git push origin arena/01a03dfe-incode
```

---

## 3. Méthode recommandée : Blueprint (`render.yaml`)

Le fichier `render.yaml` à la racine décrit déjà le service.

1. Sur Render : **New → Blueprint**.
2. Sélectionne ton dépôt GitHub.
3. Choisis la branche qui contient `render.yaml` (ex. `arena/01a03dfe-incode`,
   ou la branche `develop`/`main` sur laquelle tu fais le déploiement).
4. Render détecte le Blueprint et créé un **Static Site** nommé par exemple
   `scratch-gui-turbowarp`.
5. Lance le déploiement.

Render lira :

```yaml
buildCommand: |
  npm ci --no-optional --ignore-scripts
  node scripts/prepublish.mjs
  npm run build:render:lowmem
staticPublishPath: build
```

---

## 4. Méthode manuelle (sans Blueprint)

Si tu préfères le Dashboard :

1. Sur Render : **New → Static Site**.
2. Connecte le dépôt GitHub.
3. Choisis la branche (`arena/01a03dfe-incode` ou ta branche de déploiement).
4. Renseigne :

   - **Name** : `scratch-gui-turbowarp` (libre)
   - **Branch** : ta branche
   - **Build Command** :
     ```bash
     npm ci --no-optional --ignore-scripts && node scripts/prepublish.mjs && npm run build:render:lowmem
     ```
   - **Publish Directory** : `build`

5. Variables d'environnement (optionnelles mais recommandées) :

   | Clé | Valeur |
   |---|---|
   | `NODE_VERSION` | `24` |
   | `CHROMEDRIVER_SKIP_DOWNLOAD` | `1` |
   | `PUPPETEER_SKIP_DOWNLOAD` | `1` |
   | `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | `1` |

   > **Important** : ne mets pas `NODE_ENV=production` comme variable d'environnement
   > du service. La commande `npm ci` pourrait alors omettre les `devDependencies`
   > (webpack, babel, etc.). `NODE_ENV=production` est déjà défini _à l'intérieur_ de
   > `build:render:lowmem` / `build:render`, donc inutile de le déclarer globalement.

6. Clique sur **Create Static Site**.

---

## 5. Après le build

Render va installer les dépendances, générer le firmware micro:bit, lancer
webpack et publier `build/`.

Tu obtiens une URL du type :

```
https://scratch-gui-turbowarp.onrender.com
```

Points d'entrée disponibles :

- `/` : player
- `/editor.html` : éditeur
- `/fullscreen.html` : plein écran
- `/embed.html` : embed
- `/addons.html` : réglages des addons
- `/credits.html` : crédits

---

## 6. Test local avant déploiement

```bash
# Installer sans les scripts de téléchargement de navigateurs
npm ci --no-optional --ignore-scripts

# Générer le fichier micro:bit
node scripts/prepublish.mjs

# Build static (site complet, moins de RAM)
npm run build:render:lowmem

# Optionnel : build minifié (plus de RAM)
npm run build:render
```

Le dossier `build/` contient ensuite `index.html`, `editor.html`, etc.

---

## 7. Si le build dépasse la mémoire du plan gratuit

Le plan gratuit a des builds modestes. `build:render:lowmem` est déjà la variante
la plus légère. Si tu vois `JavaScript heap out of memory` ou `Exit code 137` :

1. Vérifie que tu utilises bien `npm run build:render:lowmem` (et pas
   `npm run build`).
2. Réessaie après avoir supprimé `node_modules` et `build` (cache corrompu).
3. Si le runner de build dispose de plus de mémoire que le défaut, ajoute dans
   les variables d'environnement :
   ```text
   NODE_OPTIONS=--max-old-space-size=1024
   ```
   (ne dépasse pas la RAM réellement disponible du runner).
4. En dernier recours (uniquement si tu acceptes de payer), passe le service
   sur **Starter** ou **Standard** et utilise `npm run build:render` (minifié).

---

## 8. Limites connues du plan gratuit Render

- Les **Static Sites** sont gratuits, mais les builds comptent dans les
  **500 minutes/mois**. Un build scratch-gui peut durer plusieurs minutes.
- La bande passante gratuite est de **100 Go/mois** par projet (large pour un
  usage perso).
- Les fonctionnalités qui contactent des services externes (cloud variables,
  projets Scratch, extension micro:bit, etc.) dépendent des serveurs de
  TurboWarp / Scratch et de leur politique CORS. Rien n'a été retiré, mais ces
  services peuvent évoluer.

---

## 9. Déploiements automatiques

- Avec le Blueprint, Render redéploie automatiquement à chaque push sur la
  branche sélectionnée (`autoDeployTrigger: commit` par défaut).
- Tu peux ouvrir le service dans Render → **Settings → Deploy Hook** si tu veux
  déclencher un déploiement via une URL (ex. depuis un CI).
