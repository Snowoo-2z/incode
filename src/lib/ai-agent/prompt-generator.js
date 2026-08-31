/**
 * @fileoverview Prompt generator for communicating with external LLMs (Claude, ChatGPT, etc.).
 * Embeds the project state, clear grammar instructions, and cheatsheet of Scratch 3.0 opcodes.
 *
 * TWO MODES
 *  - `generateAIPrompt` ("nouvelle conversation") : the whole documentation
 *    (grammar, command reference, cheatsheet, costume syntax) + the project
 *    state. Use it as the FIRST message of a conversation, the AI knows nothing
 *    about our mini-language yet.
 *  - `generateContinuationPrompt` ("suite de la conversation") : only the
 *    project state and the request. The AI already received the documentation
 *    in the first message, resending it would waste thousands of tokens and
 *    push the real context out of its window.
 *  - `generateAgentPrompt` ("mode agent") : documentation + a LIGHT overview of
 *    the project (sprite names and counts, no code) + the tools the AI may call
 *    (`/list`, `/read`, `/vars`, `/search`). For big projects the AI asks for
 *    the sprites it needs instead of receiving all of them.
 *  - `generateAgentFollowUp` : the "paste this in the same conversation" prompt
 *    carrying the answers of those tools, closing the agent loop.
 */

import {formatProjectSummary} from './sprite-reader.js';
import {formatProjectOverview, agentToolsDoc} from './agent-protocol.js';
import {BLOCK_SCHEMA, getDefaultInputs, getDefaultFields} from './block-schema.js';
import {ALIASES, getParamOrder} from './dsl-parser.js';
import ProjectDocumentation from '../project-documentation.js';

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
 * Documentation of the costume directives: the AI writes its own SVG.
 * @type {string}
 */
const COSTUME_DOC = `
COSTUMES ET ARRIÈRE-PLANS (tu peux DESSINER en écrivant du SVG) :
Tu n'es pas limité aux costumes existants : tu fournis directement le code SVG d'un costume, il est créé dans Scratch.
  costume <nom> = <svg ...>...</svg>     -> crée (ou remplace, même nom) un costume avec ton SVG
  costume <nom> = circle #FFAB19         -> forme prédéfinie : circle, square, star, paddle, ball, rectangle
  renamecostume <ancien> = <nouveau>     -> renomme un costume (le nom OU le numéro, 1er = 1)
  deletecostume <nom>                    -> supprime un costume
  setcostume <nom>                       -> affiche ce costume
Sur la scène (\`stage:\`), ces mêmes directives créent des ARRIÈRE-PLANS (480×360 conseillé).

Règles du SVG :
- Un seul élément \`<svg>\` racine, avec \`xmlns="http://www.w3.org/2000/svg"\` (sinon le costume est refusé).
- Indique \`width\`/\`height\` (ou \`viewBox\`) : le centre de rotation est calculé au milieu du dessin.
- Le SVG peut tenir sur une ligne OU être indenté sous la directive (plus lisible pour un dessin détaillé).
- Utilise des formes simples (rect, circle, ellipse, polygon, path, line) et des couleurs en hexadécimal.
- Un sprite = souvent 2 costumes (ex. "ouvert" / "fermé") pour animer avec \`nextcostume\`.
- Redonne le même nom pour REMPLACER un costume déjà créé.

EXEMPLE COSTUMES :
\`\`\`scratch
sprite Vaisseau 0 -120:
  costume "coque" =
    <svg xmlns="http://www.w3.org/2000/svg" width="60" height="40" viewBox="0 0 60 40">
      <polygon points="30,2 58,38 2,38" fill="#4C97FF"/>
      <circle cx="30" cy="24" r="7" fill="#FFFFFF"/>
    </svg>
  costume "flammes" = "<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"60\\" height=\\"40\\"><polygon points=\\"30,2 58,38 2,38\\" fill=\\"#FF661A\\"/></svg>"
  whenflagclicked
  forever:
    nextcostume
    wait 0.2
stage:
  costume "espace" = <svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="#0b1026"/><circle cx="90" cy="60" r="2" fill="#fff"/><circle cx="400" cy="120" r="3" fill="#fff"/></svg>
  renamecostume "backdrop1" = "ancien"
  deletecostume "ancien"
\`\`\`

En JSON, les actions équivalentes sont CREATE_COSTUME { sprite, name, svg }, RENAME_COSTUME { sprite, costume, name }, DELETE_COSTUME { sprite, costume } et SET_COSTUME { sprite, costume }.
`;

/**
 * Generates the full initial prompt to copy and paste into ChatGPT / Claude
 * ("nouvelle conversation" : documentation complète + état du projet).
 * @param {object} vm Scratch VM
 * @param {string} userGoal what the user wants to build
 * @returns {string} prompt
 */
/* ------------------------------------------------------------------ Shared doc */

/** Answer-format paragraph shared by every prompt. */
const ANSWER_FORMAT = `FORMAT DE RÉPONSE ATTENDU — SCRATCHSCRIPT (format compact recommandé) :
Tu PEUX parler et expliquer ce que tu fais (c'est même encouragé). Si tu modifies le projet, termine ta réponse par UN SEUL bloc de code (entouré de \`\`\`scratch et \`\`\`) écrit dans un mini-langage indenté, proche de Scratch. C'est BEAUCOUP plus court que le JSON et donc préférable, surtout pour les gros projets. Si ta réponse est uniquement une explication, un plan ou une question, tu n'as pas besoin de bloc de code.`;

/** Grammar of the mini-language, shared by every prompt. */
const DSL_LANGUAGE_RULES = `Règles du langage :
- Une instruction par ligne : \`nom_bloc arg1 arg2 ...\` (les arguments sont positionnels, dans l'ordre indiqué par la référence ci-dessous).
- L'IMBRICATION se fait par l'INDENTATION (2 espaces). Les blocs C (boucles, si) se terminent par \`:\` et leur contenu est indenté en dessous.
- Un bloc rapporteur ou une condition s'écrit entre parenthèses : \`(random 1 10)\`, \`(touching _edge_)\`, \`(> (timer) 5)\`.
- Le texte va entre guillemets : \`say "Bonjour"\`.
- RÈGLE ABSOLUE — UN ESPACE = DES GUILLEMETS : dès qu'un nom contient un espace, tu l'écris
  TOUJOURS entre guillemets, sans aucune exception, partout : déclarations, cibles, arguments
  de blocs, valeurs de menu, outils /read et /costume, et \`(var "…")\` dans un calcul.
  Les arguments étant séparés par des espaces, un nom non guillemeté est coupé et le projet
  se retrouve avec des sprites et des variables au nom tronqué. Un nom d'un seul mot
  s'écrit sans guillemets.
- Un MOT NU est une VARIABLE, pas du texte : \`set py (+ py 1)\` additionne la variable \`py\`
  (sinon Scratch affiche le texte « py + 1 » et calcule 0 + 1). Guillemets = texte littéral.
- Une valeur entre guillemets reste du TEXTE même si elle ne contient que des chiffres :
  \`var carte = "110100..."\` crée bien une chaîne, indispensable pour \`letterof\`.
- Déclarations :
  * \`var nom = valeur\`        -> crée une variable globale
  * \`list nom = a, b, c\`      -> crée une liste globale
  * \`sprite Nom x y:\`         -> crée/sélectionne un sprite (x y optionnels), ses scripts sont indentés dessous
  * \`stage:\`                  -> cible la scène
  * \`clear Nom\`               -> efface les blocs d'un sprite
- Un nouveau script commence à chaque bloc-chapeau (whenflagclicked, whenkey, whenclicked, whenreceive...) ou après une ligne vide.
- Le \`si ... sinon\` s'écrit avec \`if (...):\` suivi, à la même indentation, de \`else:\`.`;

/** Command reference header (the list itself comes from the parser). */
const COMMAND_REFERENCE_HEADER = `RÉFÉRENCE DES COMMANDES (nom court <ARGS> ; un \`:\` final = bloc conteneur à corps indenté) :`;

/** Full worked example. */
const COMPLETE_EXAMPLE = `EXEMPLE COMPLET EN SCRATCHSCRIPT :
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
\`\`\``;

/** Targeted-edit documentation (needs the addresses from a `/read`). */
const TARGETED_EDITS_DOC = `ÉDITIONS CIBLÉES (IMPORTANT pour modifier un projet existant sans tout réécrire) :
Dans l'état du projet ci-dessus, chaque bloc est précédé de son ADRESSE entre crochets, ex. \`[1/3.1]\`. Le format est \`script/chemin\` : le numéro de script, puis la position du bloc dans sa pile, en descendant dans les blocs C avec des points (la branche « sinon » est notée \`~2\`). Ex. : \`2/4.2.1\` = script 2, 4e bloc, 2e bloc de son corps, 1er bloc du corps de celui-ci.
Pour retoucher un projet, PRÉFÈRE ces directives plutôt que régénérer un sprite entier :
  on <Sprite>:            -> sélectionne un sprite EXISTANT (n'en crée pas), puis indente les directives dessous
    edit <adr> <bloc args>       -> remplace les valeurs/opcode d'un bloc existant. Ex: edit 1/3.1 move 25
    delete <adr>                 -> supprime un bloc (et son contenu s'il est C)
    insert after <adr>:          -> insère les blocs indentés APRÈS le bloc
    insert before <adr>:         -> insère AVANT le bloc
    insert into <adr>:           -> insère au DÉBUT du corps d'un bloc C (into2 = branche sinon)
    replace <adr>:               -> remplace un bloc par les blocs indentés
Toutes les adresses d'un même envoi sont résolues sur l'état AVANT modifications : lis-les directement dans l'état du projet sans te soucier des décalages.

EXEMPLE D'ÉDITIONS CIBLÉES :
\`\`\`scratch
on Balle:
  edit 1/3.1 move 25
  insert after 1/2:
    say "Partie lancee"
  delete 1/3.2
\`\`\``;

/** Closing rules. */
const IMPORTANT_RULES = `RÈGLES IMPORTANTES :
- Tu PEUX (et c'est encouragé) parler, expliquer ce que tu vas faire, pourquoi tu le fais et ce qui a changé avant de donner ton code. Une petite explication claire aide le développeur à comprendre et à décider.
- Pour une modification, termine TOUJOURS par UN SEUL bloc \`\`\`scratch ... \`\`\` directement exécutable. S'il n'y a pas de code à envoyer (question, plan, explication), réponds sans bloc code.
- Fournis un code complet, fonctionnel et directement exécutable.
- N'utilise QUE les noms/opcodes listés dans la référence ci-dessus : ce sont exactement les blocs de la palette Scratch. Tout autre sera refusé.
- Respecte l'ordre des arguments de la référence. Pour lever un doute tu peux nommer un argument : \`gotoxy X=0 Y=0\`.
- Pour une PETITE modification d'un projet existant, utilise les éditions ciblées (edit/insert/delete/replace) : c'est beaucoup plus court que de recréer le sprite.
- Dessine les costumes dont le jeu a besoin en SVG plutôt que de laisser les sprites invisibles.
- Si une liste ou une variable est trop volumineuse, ne la recopie PAS entièrement : utilise l'aperçu déjà fourni et demande des détails seulement si nécessaire.`;

/** Optional project-documentation block shared by every prompt generator. */
const MAX_DOC_PROMPT_CHARS = 12000;
const projectDocumentationBlock = () => {
    const text = ProjectDocumentation.getText();
    if (!text) return '';
    const doc = text.length > MAX_DOC_PROMPT_CHARS ?
        `${text.slice(0, MAX_DOC_PROMPT_CHARS)}\n… (documentation tronquée ici)` :
        text;
    return `\n\nDOCUMENTATION DU PROJET (donnée par le développeur, à respecter et à utiliser comme contexte) :\n${doc}\n`;
};

/** JSON fallback description. */
const JSON_ALTERNATIVE = `ALTERNATIVE (si tu préfères) — FORMAT JSON :
Tu peux aussi répondre par un bloc \`\`\`json { "actions": [ ... ] } \`\`\`. Les actions possibles : CREATE_VAR, CREATE_LIST, CREATE_SPRITE, CREATE_COSTUME, RENAME_COSTUME, DELETE_COSTUME, SET_COSTUME, SET_POSITION, CLEAR_BLOCKS, et ADD_SCRIPT avec une liste "blocks" d'objets { "opcode", "inputs", "fields" } (les SUBSTACK sont des tableaux de blocs). Mais le format SCRATCHSCRIPT ci-dessus reste préférable car bien plus léger.`;

/* ------------------------------------------------------------------ Prompts */

/**
 * Generates the full initial prompt to copy and paste into ChatGPT / Claude
 * ("nouvelle conversation" : documentation complète + état du projet).
 * @param {object} vm Scratch VM
 * @param {string} userGoal what the user wants to build
 * @returns {string} prompt
 */
const generateAIPrompt = (vm, userGoal) => {
    const projectSummary = formatProjectSummary(vm);

    return `Tu es un développeur expert Scratch 3.0 agissant en tant qu'agent autonome pour programmer directement un projet Scratch.

Voici l'état actuel du projet Scratch :
${projectSummary}${projectDocumentationBlock()}

OBJECTIF DE L'UTILISATEUR :
"${userGoal || 'Améliorer ou créer le projet'}"

${ANSWER_FORMAT}

${DSL_LANGUAGE_RULES}

${COMMAND_REFERENCE_HEADER}
${listDslCommands()}

${OPCODES_CHEATSHEET}
${COSTUME_DOC}

${COMPLETE_EXAMPLE}

${TARGETED_EDITS_DOC}

${IMPORTANT_RULES}

${JSON_ALTERNATIVE}
`;
};

/**
 * Generates the AGENT prompt: a tiny project overview and the list of tools the
 * AI may call. No sprite code is sent — the AI asks for the sprites it needs
 * with `/read`, which is what makes big projects usable.
 * @param {object} vm Scratch VM
 * @param {string} userGoal what the user wants to build
 * @returns {string} prompt
 */
/** First line of the agent prompt (kept out of the template to stay under 120 chars). */
const AGENT_INTRO = 'Tu es un AGENT AUTONOME Scratch 3.0. Tu travailles en plusieurs tours : ' +
    'tu explores le projet avec des outils, puis tu écris du code.';

const generateAgentPrompt = (vm, userGoal) => `${AGENT_INTRO}

TU N'AS PAS LE CODE DU PROJET. Voici seulement son APERÇU :
${formatProjectOverview(vm)}${projectDocumentationBlock()}

OBJECTIF DE L'UTILISATEUR :
"${userGoal || 'Améliorer ou créer le projet'}"

OUTILS D'EXPLORATION — écris ces lignes (une par ligne) dans ta réponse : le terminal les exécute et te renvoie les résultats :
${agentToolsDoc()}

PROTOCOLE :
- Demande UNIQUEMENT ce dont tu as besoin. Sur un gros projet, commence par \`/list\`
  puis \`/read <sprite>\` sur les 1 ou 2 sprites concernés.
- Tu peux demander plusieurs outils dans la même réponse (ex. \`/read Balle\` + \`/vars\`).
- Pour MODIFIER du code existant, fais d'abord \`/read <sprite>\` : tu obtiendras
  les ADRESSES \`[1/3.1]\` nécessaires à \`edit\`/\`insert\`/\`delete\`.
- Tu peux mélanger outils ET code dans la même réponse : les outils sont exécutés, puis le code est appliqué.
- Tu PEUX expliquer ce que tu fais et pourquoi avant le code. Quand tu as terminé, n'écris AUCUN outil : envoie seulement le code.

${ANSWER_FORMAT}

${DSL_LANGUAGE_RULES}

${COMMAND_REFERENCE_HEADER}
${listDslCommands()}

${OPCODES_CHEATSHEET}
${COSTUME_DOC}

${COMPLETE_EXAMPLE}

${TARGETED_EDITS_DOC}

GESTION DES SPRITES ET DES COSTUMES :
  /costume <sprite> [<nom>]           -> LIT le code SVG d'un costume existant
  renamesprite <ancien> = <nouveau>   -> renomme un sprite (les blocs qui le citent sont mis à jour)
  clear <sprite>                      -> vide ses blocs
Un nom qui contient un espace va TOUJOURS entre guillemets, dans les outils comme dans le code.
Pour MODIFIER un dessin existant : lis-le avec \`/costume\`, retouche les formes, puis renvoie
\`costume "même nom" = <svg .../>\` — le costume de ce nom est remplacé, les autres sont conservés.
En JSON : RENAME_SPRITE { sprite: "ancien", name: "nouveau" }, DELETE_SPRITE { name }.

${IMPORTANT_RULES}

${JSON_ALTERNATIVE}
`;

/**
 * Builds the "paste this back in the same conversation" prompt: the answers to
 * the tools the AI asked for, plus what the execution did.
 * @param {object} vm Scratch VM
 * @param {Array<string>} answers tool results
 * @param {?object} [lastReport] report of the execution that just happened
 * @param {Array<string>} [unknown] unrecognised /commands
 * @returns {string} prompt
 */
const generateAgentFollowUp = (vm, answers, lastReport = null, unknown = []) => {
    const report = lastReport && Array.isArray(lastReport.logs) ? lastReport.logs.join('\n') : null;

    return `Même conversation, même projet. Voici les résultats des outils que tu as demandés :

${answers.length ? answers.join('\n\n') : '(aucun outil demandé)'}
${report ? `
CODE EXÉCUTÉ — RÉSULTAT :
${report}

NOUVEL APERÇU DU PROJET :
${formatProjectOverview(vm)}
` : ''}${unknown.length ? `
⚠ Commandes non reconnues (ignore-les, utilise /list, /read, /vars, /search) : ${unknown.join(' | ')}
` : ''}
Continue : demande d'autres outils si besoin, ou envoie le code ScratchScript
(mêmes règles qu'avant, bloc \`\`\`scratch uniquement).
`;
};

/**
 * Generates the short "we are still in the same conversation" prompt: the
 * current project state and the request, WITHOUT the documentation (the AI
 * already has it from the first message).
 * @param {object} vm Scratch VM
 * @param {string} [userNote] what to do next
 * @param {?object} [lastReport] report of the previous execution
 * @returns {string} prompt
 */
const generateContinuationPrompt = (vm, userNote = '', lastReport = null) => {
    const projectSummary = formatProjectSummary(vm);
    const report = lastReport && Array.isArray(lastReport.logs) ? lastReport.logs.join('\n') : null;

    return `Nous continuons la même conversation sur ce projet Scratch : tu connais déjà le langage ScratchScript, ses commandes et la syntaxe des costumes SVG. Inutile de te les renvoyer.

NOUVEL ÉTAT DU PROJET (après exécution) :
${projectSummary}${projectDocumentationBlock()}
${report ? `
RÉSULTAT DE LA DERNIÈRE EXÉCUTION :
${report}
` : ''}
MA DEMANDE :
"${userNote || 'Vérifie le projet et continue les améliorations nécessaires selon le plan.'}"

Tu peux expliquer ce que tu fais avant. Pour une modification, termine UNIQUEMENT par un bloc \`\`\`scratch ... \`\`\` (mêmes règles qu'avant). Pour une réponse explicative, aucun bloc n'est nécessaire.
`;
};

/**
 * Generates a follow-up prompt to send back to the AI for iterations.
 * Kept as an alias of the continuation prompt (same thing: state, no docs).
 * @param {object} vm Scratch VM
 * @param {?object} executionReport report of the previous execution
 * @param {string} [userNote] what to do next
 * @returns {string} prompt
 */
const generateFollowUpPrompt = (vm, executionReport, userNote = '') =>
    generateContinuationPrompt(vm, userNote, executionReport);

/**
 * WEB MODE prompt: instead of answering in ScratchScript/JSON, the AI writes a
 * tiny vanilla HTML/CSS/JS page. The HTML/CSS is rendered by the browser in a
 * hidden 480x360 iframe and captured into sprite costumes; the JS is
 * transpiled into blocks. This documentation defines the Scratch-shaped JS
 * dialect the transpiler understands.
 * @param {object} vm Scratch VM (project state for context)
 * @param {string} userGoal what the user wants to build
 * @returns {string} prompt
 */
const WEB_MODE_RULES = `
Tu réponds UNIQUEMENT avec un seul fichier HTML autonome (HTML + CSS dans <style> + JS dans <script>),
sans explication, en vanilla JS (aucune bibliothèque, aucun import, aucun module).

## La scène
La page fait 480x360 (taille de la scène Scratch). Le repère CSS (en haut à gauche) est
automatiquement converti : le centre de la scène = (0,0) en Scratch.

## HTML = les sprites
- Chaque élément avec un id devient un SPRITE Scratch (son id est le nom du sprite).
  <button id="jouer"> devient aussi un sprite, cliquable.
- Positionne les éléments en CSS : position:absolute; left/top/width/height ; ou en JS avec
  les méthodes du sprite. La mise en page (couleurs, border-radius, dégradés, texte, emojis,
  :hover, :active) est capturée fidèlement dans le costume : tu peux utiliser TOUT le CSS
  visuel que tu veux.
- Un <button> avec des états :hover/:active reçoit automatiquement plusieurs costumes et
  les blocs qui les permutent.
- Une animation CSS (@keyframes / animation / transition) appliquée à un élément avec id est
  capturée image par image : l'élément reçoit plusieurs costumes et une boucle qui les fait
  défiler au même rythme. Tu peux donc animer un héros qui marche, une porte qui s'ouvre, un
  ennemi qui clignote... directement en CSS. Les décorations sans id (titres, panneaux de fond)
  vont dans le décor de la scène et ne deviennent pas des sprites.

## JS = les blocs
Le JS doit rester SIMPLE et "façon Scratch" : variables globales, if/else, for/while/
for...of, switch/case, fonctions simples. PAS de classes, de closures avancées, de fetch,
de DOM vivant (createElement...), de async/await, ni de bibliothèques.

### Fonctions = "mes blocs"
Une fonction JS appelée comme une instruction devient un VRAI bloc personnalisé Scratch
("définir ..." dans Mes blocs) :
  function tire(cadence) {
    vaisseau.say("pan !");
    vaisseau.move(cadence);
  }
  if (keyPressed("space")) tire(15);   // crée un bloc "tire 15"
Les paramètres deviennent des entrées du bloc. Évite les fonctions qui renvoient une
valeur (Scratch ne sait pas le faire) : utilise une variable globale à la place.

### Initialisation et boucles
  whenFlag(() => { ... })            // quand ⚑ pressé (tout le démarrage va dedans)
  forever(() => { ... })             // répéter indéfiniment
  repeat(10, () => { ... })          // répéter 10 fois
  if (condition) { ... } else { ... }
  while (!condition) { ... }         // répéter jusqu'à ce que condition
  for (let i = 0; i < 10; i++) {}    // répéter 10 fois
  wait(1)                            // attendre 1 seconde (dans une boucle)
  waitUntil(condition)               // attendre jusqu'à
  stopAll()                          // tout arrêter
  switch (etat) { case 1: ...; break; case 2: ...; default: ... }
  for (let en of ennemis) { ... }    // parcourt une liste (en = élément courant)
  setInterval(() => { ... }, 33)     // = forever + attendre (33 ms -> 0.03 s)
  setTimeout(() => { ... }, 500)     // = attendre 0.5 s puis faire
  requestAnimationFrame(() => { ... }) // = forever à ~60 fps (boucle de jeu)
  Math.floor(x), Math.ceil(x), Math.round(x), Math.abs(x), Math.sqrt(x),
    Math.sin(a), Math.cos(a), Math.max(a,b), Math.min(a,b), Math.random(),
    Math.PI                           // fonctions mathématiques Scratch

### Événements
  sprite.onClick(() => { ... })      // quand ce sprite est cliqué
  whenKeyPressed('up arrow', () => {})   // ou document.addEventListener('keydown', e => { if (e.key === 'ArrowUp') ... })
  whenReceive('message', () => {})   // quand je reçois
  broadcast('message')               // envoyer à tous
  Noms de touches : 'up arrow','down arrow','left arrow','right arrow','space','enter',
  ou une lettre 'w' (minuscule).

### Variables et listes
  let score = 0            -> variable Scratch (affichée avec showVariable('score'))
  let ennemis = [1, 2, 3]  -> liste Scratch
  score += 1 ; score *= 2 ; score -= 5 ; score = score + 1
  ennemis.push(5)          (ajouter)
  ennemis.pop()            (supprimer le dernier)  ; ennemis.shift() (le premier)
  ennemis.insert(0, x)     ; ennemis.clear()
  if (ennemis.includes(5)) { ... }
  let x = ennemis[2] ; let n = ennemis.length

### API des sprites (le nom = l'id HTML)
Mouvement : balle.move(7), balle.bounce(), balle.gotoXy(x,y), balle.changeX(3),
  balle.changeY(3), balle.setX(100), balle.setY(50), balle.turnRight(15), balle.turnLeft(15),
  balle.pointInDirection(45), balle.pointTowards(autreSprite), balle.glide(1, x, y),
  balle.setRotationStyle("don't rotate")
Lire : balle.x, balle.y, balle.direction, balle.size  (dans des expressions)
Aspect : balle.say("texte"), balle.sayFor("texte", 2), balle.think("..."), balle.show(),
  balle.hide(), balle.setSize(120), balle.nextCostume(), balle.switchCostume('nom'),
  balle.goToFront(), balle.goBackLayers(2)
Sons : balle.playSound('pop'), balle.stopAllSounds()
Clones : balle.clone() [ou clone(autreSprite)], quand un clone démarre : balle.whenCloned(() => {}),
  puis deleteThisClone() -> utiliser balle.deleteClone()
Capteurs : balle.touching('_edge_')  (ou '_mouse_', ou un autre sprite), balle.distanceTo(sprite),
  keyPressed('w'), mouseDown(), mouseX(), mouseY(), answer() après ask('Question ?')

Tu peux écrire le JS en style DOM classique aussi :
  const balle = document.getElementById('balle'); balle.move(5);
  balle.style.left = '100px' / .top = 50 / .display = 'none' / .opacity = 0.5
    (left/top sont convertis depuis le coin haut-gauche vers les coordonnées Scratch) ;
  alert('game over') -> fait "dire" ; for (let en of ennemis) {...} parcourt une liste ;
  nom.charAt(0) -> lettre n°1 de nom ; Math.min/max/random/floor et requestAnimationFrame OK.
Opérateurs : random(1, 10), round(x), abs(x), floor(x), sqrt(x), sin(x), join('a', b),
  les opérateurs + - * / % < > === && || ! , les littéraux 'texte' et nombres.
Fonctions : définis function tirer(vitesse) { ... } : elle est recopiée (inline) à chaque appel
  avec ses paramètres transformés en variables. (Pas de récursion.)

## Style de code attendu
- Mets TOUT le démarrage dans whenFlag(...), et la logique du jeu dans un forever(...).
- Un seul whenFlag par fichier ; réagis aux clics/touches avec onClick / whenKeyPressed.
- N'utilise les méthodes de sprite QUE sur des id définis dans le HTML.
- Pas de return de valeur : fais transiter les résultats par des variables globales.
`;

const generateWebModePrompt = (vm, userGoal) => {
    const goal = String(userGoal || 'Crée un petit jeu').trim();
    return `OBJECTIF : ${goal}

${WEB_MODE_RULES}

Réponds maintenant avec le fichier HTML complet (commence directement par <!-- ou <!DOCTYPE html>),
prêt à être collé dans l'onglet « 🌐 Mode HTML/JS » du Terminal IA, qui le transformera en blocs Scratch.`;
};

export {
    generateAIPrompt,
    generateContinuationPrompt,
    generateFollowUpPrompt,
    generateAgentPrompt,
    generateAgentFollowUp,
    generateWebModePrompt,
    WEB_MODE_RULES,
    OPCODES_CHEATSHEET,
    COSTUME_DOC
};
