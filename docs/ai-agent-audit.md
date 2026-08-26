# Audit complet des blocs — Terminal AI

Date : 2026-08-26
Portée : `src/lib/ai-agent/` (schéma des blocs, constructeur, interpréteur, prompt).

## Méthode

Chaque opcode déclaré dans `block-schema.js` a été comparé un par un aux
définitions officielles de **scratch-blocks** (dépôt `TurboWarp/scratch-blocks`,
branche `develop`), fichiers :
`blocks_vertical/{motion,looks,sound,event,control,sensing,operators,data}.js`.

Pour chaque bloc on a vérifié :

- si chaque emplacement est un **input** (rempli par un bloc *shadow*) ou un
  **field** (menu rendu directement sur le bloc) ;
- le **type de shadow** attendu (`math_number`, `math_whole_number`,
  `math_integer`, `math_angle`, `text`, `colour_picker`, ou un bloc-menu
  spécifique) ;
- le **nom exact** des inputs/fields ;
- les valeurs par défaut des menus.

Un banc d'essai construit ensuite chaque opcode et vérifie l'intégrité du
graphe de blocs produit (aucun id pendant, chaque valeur de field est une
chaîne, chaque shadow existe).

## Résultat global

| Catégorie   | Blocs | État |
|-------------|-------|------|
| Événements  | 9     | ✅ conforme |
| Mouvement   | 19    | ✅ conforme |
| Apparence   | 20    | ✅ conforme |
| Son         | 9     | ✅ conforme |
| Contrôle    | 11    | ✅ conforme |
| Capteurs    | 17    | ✅ conforme |
| Opérateurs  | 18    | ✅ conforme |
| Variables   | 5     | ✅ conforme |
| **Listes**  | **12**| **➕ ajouté (voir plus bas)** |

Banc d'essai final : **120 opcodes construits, 0 problème**.

## Bug corrigé au tour précédent (rappel)

Les menus déroulants (`KEY_OPTION`, `TOUCHINGOBJECTMENU`, `CLONE_OPTION`, `TO`,
`TOWARDS`, `COSTUME`…) sont des **inputs** remplis par un bloc-menu *shadow*,
et non des `fields`. Quand l'IA fournissait la valeur dans `fields` (ce que
l'ancien cheatsheet lui demandait), le bloc-menu n'était jamais créé → condition
« si &lt;touche pressée&gt; » cassée, « créer un clone » cassé, et corps du `if`
qui disparaît. Corrigé dans `block-builder.js` (routage automatique
input↔field) et dans le prompt.

## Ce que l'audit a confirmé comme correct

- Tous les menus sont bien modélisés comme `inputs` avec le bon bloc-menu
  (`sensing_keyoptions`, `motion_goto_menu`, `control_create_clone_of_menu`…).
- Les vrais `fields` (dropdowns rendus sur le bloc) sont corrects :
  `EFFECT`, `STOP_OPTION`, `STYLE`, `FRONT_BACK`, `FORWARD_BACKWARD`,
  `NUMBER_NAME`, `PROPERTY`, `CURRENTMENU`, `OPERATOR`, `KEY_OPTION` de
  `event_whenkeypressed` (celui-ci est bien un field, contrairement à
  `sensing_keypressed`).
- Les types de shadow numériques sont exacts : `math_whole_number` pour
  `TIMES` et `looks_goforwardbackwardlayers/NUM`, `math_positive_number` pour
  `control_wait/DURATION`, `math_angle` pour les directions, `math_number`
  ailleurs.
- Variables et broadcasts créent/retrouvent bien l'entité sur la scène avec le
  bon `variableType`.
- `control_stop` reçoit la `mutation` attendue par scratch-blocks.

## Lacune trouvée et corrigée : les LISTES

Aucun bloc de liste n'était supporté. 12 opcodes ajoutés :

`data_listcontents`, `data_addtolist`, `data_deleteoflist`,
`data_deletealloflist`, `data_insertatlist`, `data_replaceitemoflist`,
`data_itemoflist`, `data_itemnumoflist`, `data_lengthoflist`,
`data_listcontainsitem`, `data_showlist`, `data_hidelist`.

Détails d'implémentation :

- Nouveau type de shadow `math_integer` (`INTEGER`) pour les slots `INDEX`
  (comme dans le vrai Scratch).
- Champ `LIST` = variable de type `list` : le constructeur crée/retrouve la
  liste sur la scène (fonction `resolveOrCreateList`), exactement comme pour
  les variables scalaires.
- Raccourci `list: "nom"` accepté sur un spec (comme `variable: "nom"`).
- Nouvelle action `CREATE_LIST` dans l'interpréteur (JSON et DSL ligne à ligne),
  avec valeur initiale optionnelle (tableau d'éléments).
- Cheatsheet du prompt mis à jour avec la section Listes.

## Limites connues (non bloquantes)

- **Blocs personnalisés (My Blocks / `procedures_*`)** : non supportés. Ils
  nécessitent une mutation `proccode`/`argumentids` complexe ; hors périmètre
  de l'agent pour l'instant. Les opcodes inconnus sont signalés à l'utilisateur
  via `findUnknownOpcodes`, donc pas de bloc cassé silencieux.
- **Extensions** (stylo, musique, traduction…) : non incluses dans le
  catalogue.
- `sound_seteffectto`/`sound_changeeffectby` : la valeur par défaut du field
  `EFFECT` est `PITCH` (l'autre option étant `PAN`), conforme au VM.
