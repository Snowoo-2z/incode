# 🤖 Terminal Agent IA - Guide d'utilisation

Le **Terminal Agent IA** transforme TurboWarp / Scratch en un environnement pilotable par une Intelligence Artificielle (ChatGPT, Claude, Mistral, DeepSeek, etc.) ou par des commandes directes.

---

## 🎯 Comment fonctionne la boucle d'échange (Copier / Coller) ?

1. **Décrivez votre projet** :
   - Ouvrez le menu **🤖 Terminal IA** dans la barre de menu supérieure.
   - Dans l'onglet *Assistant IA*, décrivez ce que vous souhaitez réaliser (ex : *"Créer un jeu de Pong à 2 joueurs avec score et rebonds"*).

2. **Copiez le prompt généré** :
   - Cliquez sur **"📋 Copier le prompt pour l'IA"**.
   - Le prompt contient automatiquement :
     - L'état complet du projet (scène, sprites existants, coordonnées, variables, et les scripts existants traduits en pseudo-code lisible).
     - Le dictionnaire des opcodes Scratch 3.0.
     - Le format JSON attendu pour exécuter les actions.
     - Votre consigne.

3. **Collez la réponse de l'IA** :
   - Collez la réponse de ChatGPT ou Claude dans le champ *"2. Collez la réponse de l'IA"*.
   - Cliquez sur **"▶ Exécuter le code sur Scratch"**.
   - Les sprites sont automatiquement créés, les variables initialisées, et les blocs empilés et positionnés exactement là où vous le souhaitez.

4. **Boucle d'itération continue** :
   - Cliquez sur **"📋 Copier le rapport pour l'étape suivante de l'IA"** pour lui renvoyer les nouveaux scripts et continuer le développement pas à pas.

---

## 💻 Onglets disponibles

### 1. 🤖 Assistant IA (Prompt & Exécution)
- Permet de générer les prompts, coller les réponses, et exécuter les scripts.
- Bouton **"🚀 Charger l'exemple Pong"** : permet de générer et tester instantanément un jeu complet de Pong (2 raquettes contrôlables au clavier, balle et score) sans avoir besoin d'ouvrir une IA externe.

### 2. 💻 Console CLI
Console interactive intégrée. Commandes disponibles :
- `status` : Affiche l'état complet du projet.
- `read <nom_sprite>` : Lit tous les scripts et propriétés d'un sprite en clair.
- `create-sprite <nom>` : Crée un nouveau sprite.
- `create-var <nom>` : Crée une variable globale.
- `clear <nom_sprite>` : Efface tous les blocs d'un sprite.
- `pong` : Génère le jeu de Pong.
- `clear-console` : Efface l'affichage du terminal.

### 3. 🔍 Inspecteur de Sprites
- Liste visuelle de tous les sprites et de la scène avec coordonnées, taille, variables et retranscription complète des scripts sous forme de texte clair.

---

## 📋 Format des actions acceptées par le Terminal

L'IA répond avec un bloc `json` :

```json
{
  "actions": [
    { "type": "CREATE_VAR", "name": "score1", "value": 0 },
    { "type": "CREATE_SPRITE", "name": "Balle", "x": 0, "y": 0 },
    {
      "type": "ADD_SCRIPT",
      "sprite": "Balle",
      "x": 50,
      "y": 50,
      "blocks": [
        { "opcode": "event_whenflagclicked" },
        { "opcode": "motion_gotoxy", "inputs": { "X": 0, "Y": 0 } },
        { "opcode": "motion_pointindirection", "inputs": { "DIRECTION": 45 } },
        {
          "opcode": "control_forever",
          "inputs": {
            "SUBSTACK": [
              { "opcode": "motion_movesteps", "inputs": { "STEPS": 10 } },
              { "opcode": "motion_ifonedgebounce" }
            ]
          }
        }
      ]
    }
  ]
}
```

---

## 📄 Documentation invisible du projet

Le bouton **📄 Documentation** de la barre de menu ouvre un éditeur pour un fichier
compagnon (`.documentation.md`) qui décrit le projet pour l'IA. Il reste à côté du
projet et n'appartient pas au code Scratch.

- Quand vous cliquez sur **Sauvegarder sur votre ordinateur**, le projet `.sb3`
  est téléchargé **avec** la documentation incorporée ; un `.documentation.md`
  séparé est aussi téléchargé.
- À la réouverture d'un `.sb3`, la documentation incorporée (`documentation.md`,
  `.txt` ou `.json`) est chargée automatiquement.
- Le Terminal IA ajoute automatiquement cette documentation au prompt généré
  (mode Assistant et mode Agent), ce qui évite à l'IA de redécouvrir le projet.
- Pour créer la documentation, l'IA peut lire les sprites (`/read`), les
  variables/listes (`/vars`) et les costumes SVG (`/costume`) — les SVG peuvent
  contenir du texte utile. Le travail est découpé en 3 étapes pour rester dans
  le contexte.
- Les listes géantes (ex. 300 000 éléments) ne sont jamais envoyées en entier :
  le prompt affiche un aperçu (30 premiers éléments + nombre total).

## 🛠 Accès direct via la console du navigateur

Vous pouvez également manipuler l'agent directement depuis la console JavaScript (`F12`) :
```javascript
// Lire l'état du projet
window.AIAgent.getProjectSummary();

// Créer un sprite et lui ajouter des blocs
window.AIAgent.execute(`
  CREATE_VAR mon_score
  CREATE_SPRITE MonSprite
`);
```
