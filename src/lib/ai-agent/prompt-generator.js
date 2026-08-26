/**
 * @fileoverview Prompt generator for communicating with external LLMs (Claude, ChatGPT, etc.).
 * Embeds the project state, clear grammar instructions, and cheatsheet of Scratch 3.0 opcodes.
 */

import {formatProjectSummary} from './sprite-reader.js';
import {BLOCK_SCHEMA} from './block-schema.js';

/**
 * The exhaustive list of opcodes the builder is able to create correctly.
 * Generated from the schema so the prompt can never drift from the code.
 * @returns {string} formatted list
 */
const listSupportedOpcodes = () => Object.keys(BLOCK_SCHEMA).sort().join(', ');

/**
 * Cheatsheet of the most common and useful Scratch opcodes for the AI
 */
const OPCODES_CHEATSHEET = `
CHEATSHEET DES OPCODES SCRATCH 3.0 COURANTS :
- Événements :
  * event_whenflagclicked : Quand drapeau vert cliqué
  * event_whenkeypressed : fields: { KEY_OPTION: "space" | "up arrow" | "down arrow" | "z" | "s" | ... }
  * event_whenthisspriteclicked : Quand ce sprite est cliqué
  * event_broadcast : inputs: { BROADCAST_INPUT: "nom_message" }
  * event_whenbroadcastreceived : fields: { BROADCAST_OPTION: "nom_message" }

- Mouvement :
  * motion_movesteps : inputs: { STEPS: 10 }
  * motion_gotoxy : inputs: { X: 0, Y: 0 }
  * motion_changexby : inputs: { DX: 10 }
  * motion_setx : inputs: { X: 100 }
  * motion_changeyby : inputs: { DY: 10 }
  * motion_sety : inputs: { Y: 100 }
  * motion_pointindirection : inputs: { DIRECTION: 90 }
  * motion_pointtowards : inputs: { TOWARDS: "_mouse_" | "NomSprite" }
  * motion_ifonedgebounce : Rebondir si le bord est atteint

- Apparence :
  * looks_say : inputs: { MESSAGE: "Texte" }
  * looks_sayforsecs : inputs: { MESSAGE: "Texte", SECS: 2 }
  * looks_show : Montrer
  * looks_hide : Cacher
  * looks_setsizeto : inputs: { SIZE: 100 }
  * looks_changesizeby : inputs: { CHANGE: 10 }
  * looks_nextcostume : Costume suivant

- Contrôle (avec SUBSTACK pour les boucles/conditions imbriquées) :
  * control_forever : inputs: { SUBSTACK: [ ...liste de blocs... ] }
  * control_repeat : inputs: { TIMES: 10, SUBSTACK: [ ... ] }
  * control_if : inputs: { CONDITION: { opcode: ... }, SUBSTACK: [ ... ] }
  * control_if_else : inputs: { CONDITION: { opcode: ... }, SUBSTACK: [ ... ], SUBSTACK2: [ ... ] }
  * control_wait : inputs: { DURATION: 1 }
  * control_stop : fields: { STOP_OPTION: "all" | "this script" | "other scripts in sprite" }
  * control_create_clone_of : inputs: { CLONE_OPTION: "_myself_" | "NomSprite" }
  * control_start_as_clone : Quand je démarre comme clone
  * control_delete_this_clone : Supprimer ce clone

- Capteurs (Reporters & Conditions) :
  * sensing_touchingobject : inputs: { TOUCHINGOBJECTMENU: "_edge_" | "_mouse_" | "NomSprite" }
  * sensing_keypressed : inputs: { KEY_OPTION: "space" | "z" | "s" | "up arrow" | ... }
  * sensing_mousex, sensing_mousey : Position souris
  * sensing_mousedown : Souris cliquée

- Opérateurs (Reporters) :
  * operator_add : inputs: { NUM1: ..., NUM2: ... }
  * operator_subtract : inputs: { NUM1: ..., NUM2: ... }
  * operator_multiply : inputs: { NUM1: ..., NUM2: ... }
  * operator_divide : inputs: { NUM1: ..., NUM2: ... }
  * operator_random : inputs: { FROM: 1, TO: 10 }
  * operator_gt : inputs: { OPERAND1: ..., OPERAND2: ... } (Plus grand que)
  * operator_lt : inputs: { OPERAND1: ..., OPERAND2: ... } (Plus petit que)
  * operator_equals : inputs: { OPERAND1: ..., OPERAND2: ... } (Égal à)
  * operator_not : inputs: { OPERAND: { ... } }

- Variables :
  * data_setvariableto : fields: { VARIABLE: "nom_variable" }, inputs: { VALUE: 0 }
  * data_changevariableby : fields: { VARIABLE: "nom_variable" }, inputs: { VALUE: 1 }
  * data_showvariable, data_hidevariable : fields: { VARIABLE: "nom_variable" }
  * data_variable : fields: { VARIABLE: "nom_variable" } (Reporter valeur de variable)

- Listes (fields: { LIST: "nom_liste" }) :
  * data_addtolist : inputs: { ITEM: "valeur" }, fields: { LIST: "nom_liste" }
  * data_deleteoflist : inputs: { INDEX: 1 }, fields: { LIST: "nom_liste" }
  * data_deletealloflist : fields: { LIST: "nom_liste" }
  * data_insertatlist : inputs: { ITEM: "valeur", INDEX: 1 }, fields: { LIST: "nom_liste" }
  * data_replaceitemoflist : inputs: { INDEX: 1, ITEM: "valeur" }, fields: { LIST: "nom_liste" }
  * data_itemoflist : inputs: { INDEX: 1 }, fields: { LIST: "nom_liste" } (Reporter)
  * data_itemnumoflist : inputs: { ITEM: "valeur" }, fields: { LIST: "nom_liste" } (Reporter)
  * data_lengthoflist : fields: { LIST: "nom_liste" } (Reporter)
  * data_listcontainsitem : inputs: { ITEM: "valeur" }, fields: { LIST: "nom_liste" } (Condition)
  * data_showlist, data_hidelist : fields: { LIST: "nom_liste" }

- Extension Stylo (Pen) — l'extension est chargée automatiquement dès qu'un bloc pen_ est utilisé :
  * pen_clear : Effacer tout
  * pen_stamp : Estampiller (tampon du costume)
  * pen_penDown : Stylo en position d'écriture
  * pen_penUp : Relever le stylo
  * pen_setPenColorToColor : inputs: { COLOR: "#ff0000" } (couleur hexadécimale)
  * pen_changePenSizeBy : inputs: { SIZE: 1 }
  * pen_setPenSizeTo : inputs: { SIZE: 5 }
  * pen_changePenColorParamBy : inputs: { COLOR_PARAM: "color" | "saturation" | "brightness" | "transparency", VALUE: 10 }
  * pen_setPenColorParamTo : inputs: { COLOR_PARAM: "color" | "saturation" | "brightness" | "transparency", VALUE: 50 }
`;

/**
 * Generates the full initial prompt to copy and paste into ChatGPT / Claude
 */
const generateAIPrompt = (vm, userGoal) => {
    const projectSummary = formatProjectSummary(vm);

    return `Tu es un développeur expert Scratch 3.0 agissant en tant qu'agent autonome pour programmer directement un projet Scratch.

Voici l'état actuel du projet Scratch :
${projectSummary}

OBJECTIF DE L'UTILISATEUR :
"${userGoal || 'Améliorer ou créer le projet'}"

FORMAT DE RÉPONSE ATTENDU :
Tu dois répondre UNIQUEMENT par un bloc de code JSON valide (entouré de \`\`\`json et \`\`\`) contenant la liste ordonnée des "actions" à exécuter dans le projet.

Chaque action peut être de type :
1. "CREATE_VAR" : { "type": "CREATE_VAR", "name": "nom_variable", "value": 0 }
1b. "CREATE_LIST" : { "type": "CREATE_LIST", "name": "nom_liste", "value": ["a", "b"] }
2. "CREATE_SPRITE" : { "type": "CREATE_SPRITE", "name": "NomSprite", "x": 0, "y": 0 }
3. "SET_POSITION" : { "type": "SET_POSITION", "sprite": "NomSprite", "x": -100, "y": 0 }
4. "CLEAR_BLOCKS" : { "type": "CLEAR_BLOCKS", "sprite": "NomSprite" } (optionnel, pour effacer les anciens scripts)
5. "ADD_SCRIPT" : {
     "type": "ADD_SCRIPT",
     "sprite": "NomSprite",
     "x": 50,
     "y": 50,
     "blocks": [
       { "opcode": "event_whenflagclicked" },
       { "opcode": "motion_gotoxy", "inputs": { "X": 0, "Y": 0 } },
       ...
     ]
   }

${OPCODES_CHEATSHEET}

LISTE EXHAUSTIVE DES OPCODES AUTORISÉS (aucun autre ne sera accepté) :
${listSupportedOpcodes()}

EXEMPLE TYPE D'ACTION JSON ATTENDU :
\`\`\`json
{
  "actions": [
    { "type": "CREATE_VAR", "name": "score", "value": 0 },
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
\`\`\`

RÈGLES IMPORTANTES :
- Fournis un code complet, fonctionnel et directement exécutable.
- N'utilise QUE les opcodes listés dans le cheatsheet ci-dessus : ce sont exactement les blocs disponibles dans la palette de Scratch. Tout autre opcode sera refusé.
- Ne mets PAS de valeurs dans les "inputs" attendant un bloc booléen (CONDITION, OPERAND...) : mets-y un objet { "opcode": ... }.
- Les menus déroulants (KEY_OPTION, TOUCHINGOBJECTMENU, CLONE_OPTION, TO, TOWARDS, COSTUME...) se mettent dans "inputs". L'interface accepte aussi "fields" par tolérance, mais "inputs" est le format correct.
- Tu peux omettre les x/y d'un ADD_SCRIPT : les scripts sont alors placés automatiquement les uns sous les autres, sans se superposer.
- N'écris pas d'explication en dehors du bloc JSON, réponds UNIQUEMENT avec le bloc \`\`\`json ... \`\`\` pour que l'interface puisse l'exécuter directement.
`;
};

/**
 * Generates a follow-up prompt to send back to the AI for iterations
 */
const generateFollowUpPrompt = (vm, executionReport, userNote = '') => {
    const projectSummary = formatProjectSummary(vm);

    return `Voici le résultat de l'exécution précédente dans Scratch :
${executionReport ? executionReport.logs.join('\n') : 'Code exécuté avec succès.'}

NOUVEL ÉTAT DU PROJET :
${projectSummary}

REMARQUE / PROCHAINE ÉTAPE :
"${userNote || 'Vérifie le projet et continue les améliorations nécessaires selon le plan.'}"

Réponds à nouveau UNIQUEMENT avec un bloc \`\`\`json contenant les prochaines "actions".
`;
};

export {
    generateAIPrompt,
    generateFollowUpPrompt,
    OPCODES_CHEATSHEET
};
