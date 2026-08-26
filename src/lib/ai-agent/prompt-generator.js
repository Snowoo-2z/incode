/**
 * @fileoverview Prompt generator for communicating with external LLMs (Claude, ChatGPT, etc.).
 * Embeds the project state, clear grammar instructions, and cheatsheet of Scratch 3.0 opcodes.
 */

import {formatProjectSummary} from './sprite-reader.js';
import {BLOCK_SCHEMA, getDefaultInputs, getDefaultFields} from './block-schema.js';
import {ALIASES, getParamOrder} from './dsl-parser.js';

/**
 * Builds the DSL command reference straight from the parser's alias table and
 * the block schema, so the documented short names + argument order can never
 * drift from what the parser actually accepts.
 * @returns {string} formatted reference
 */
const listDslCommands = () => {
    // opcode -> preferred short name (first alias that maps to it).
    const preferred = {};
    for (const [name, opcode] of Object.entries(ALIASES)) {
        if (!preferred[opcode]) preferred[opcode] = name;
    }
    const branchInputs = new Set(['SUBSTACK', 'SUBSTACK2']);
    const lines = [];
    for (const opcode of Object.keys(BLOCK_SCHEMA)) {
        const name = preferred[opcode] || opcode;
        const order = getParamOrder(opcode).filter(p => !branchInputs.has(p));
        const hasBranch = Object.keys(getDefaultInputs(opcode)).some(i => branchInputs.has(i)) ||
            Object.prototype.hasOwnProperty.call(getDefaultFields(opcode), 'SUBSTACK');
        const args = order.map(p => `<${p}>`).join(' ');
        const suffix = hasBranch ? ' :' : '';
        lines.push(`  ${name}${args ? ` ${args}` : ''}${suffix}`);
    }
    return lines.join('\n');
};

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

FORMAT DE RÉPONSE ATTENDU — SCRATCHSCRIPT (format compact recommandé) :
Réponds UNIQUEMENT par un bloc de code (entouré de \`\`\`scratch et \`\`\`) écrit dans un mini-langage indenté, proche de Scratch. C'est BEAUCOUP plus court que le JSON et donc préférable, surtout pour les gros projets.

Règles du langage :
- Une instruction par ligne : \`nom_bloc arg1 arg2 ...\` (les arguments sont positionnels, dans l'ordre indiqué par la référence ci-dessous).
- L'IMBRICATION se fait par l'INDENTATION (2 espaces). Les blocs C (boucles, si) se terminent par \`:\` et leur contenu est indenté en dessous.
- Un bloc rapporteur ou une condition s'écrit entre parenthèses : \`(random 1 10)\`, \`(touching _edge_)\`, \`(> (timer) 5)\`.
- Le texte va entre guillemets : \`say "Bonjour"\`.
- Déclarations :
  * \`var nom = valeur\`        -> crée une variable globale
  * \`list nom = a, b, c\`      -> crée une liste globale
  * \`sprite Nom x y:\`         -> crée/sélectionne un sprite (x y optionnels), ses scripts sont indentés dessous
  * \`stage:\`                  -> cible la scène
  * \`clear Nom\`               -> efface les blocs d'un sprite
- Un nouveau script commence à chaque bloc-chapeau (whenflagclicked, whenkey, whenclicked, whenreceive...) ou après une ligne vide.
- Le \`si ... sinon\` s'écrit avec \`if (...):\` suivi, à la même indentation, de \`else:\`.

RÉFÉRENCE DES COMMANDES (nom court <ARGS> ; un \`:\` final = bloc conteneur à corps indenté) :
${listDslCommands()}

${OPCODES_CHEATSHEET}

EXEMPLE COMPLET EN SCRATCHSCRIPT :
\`\`\`scratch
var score = 0
sprite Balle 0 0:
  whenflagclicked
  gotoxy 0 0
  point 45
  forever:
    move 10
    bounce
    if (touching _edge_):
      change score 1
\`\`\`

RÈGLES IMPORTANTES :
- Fournis un code complet, fonctionnel et directement exécutable.
- N'utilise QUE les noms/opcodes listés dans la référence ci-dessus : ce sont exactement les blocs de la palette Scratch. Tout autre sera refusé.
- Respecte l'ordre des arguments de la référence. Pour lever un doute tu peux nommer un argument : \`gotoxy X=0 Y=0\`.
- Réponds UNIQUEMENT avec le bloc \`\`\`scratch ... \`\`\`, sans explication autour, pour que l'interface puisse l'exécuter directement.

ALTERNATIVE (si tu préfères) — FORMAT JSON :
Tu peux aussi répondre par un bloc \`\`\`json { "actions": [ ... ] } \`\`\`. Les actions possibles : CREATE_VAR, CREATE_LIST, CREATE_SPRITE, SET_POSITION, CLEAR_BLOCKS, et ADD_SCRIPT avec une liste "blocks" d'objets { "opcode", "inputs", "fields" } (les SUBSTACK sont des tableaux de blocs). Mais le format SCRATCHSCRIPT ci-dessus reste préférable car bien plus léger.
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
