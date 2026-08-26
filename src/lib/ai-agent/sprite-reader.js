/**
 * @fileoverview Reads and formats Scratch targets (stage and sprites) and their blocks
 * into human- and AI-readable representations.
 */

import {listAddressedScripts} from './block-address.js';

// Helper to translate opcodes and arguments into concise pseudo-code
const formatBlockToText = (block, blocksMap, indent = 0) => {
    if (!block) return '';
    const spaces = '  '.repeat(indent);
    const opcode = block.opcode || '';

    const getInputValue = inputName => {
        if (!block.inputs || !block.inputs[inputName]) return null;
        const inp = block.inputs[inputName];
        // Scratch input structure: [shadowType, valueOrBlockId]
        // or array where element 1 is [type, val]
        const val = inp[1];
        if (Array.isArray(val)) {
            // [4, "10"] or [10, "message"]
            return val[1];
        } else if (typeof val === 'string' && blocksMap[val]) {
            // It's a reporter or sub-block
            return formatBlockToText(blocksMap[val], blocksMap, 0).trim();
        }
        return JSON.stringify(val);
    };

    const getFieldValue = fieldName => {
        if (!block.fields || !block.fields[fieldName]) return null;
        const fld = block.fields[fieldName];
        return Array.isArray(fld) ? fld[0] : fld.value || fld;
    };

    const formatBranch = (branchInputName, branchIndent) => {
        if (!block.inputs || !block.inputs[branchInputName]) return '';
        const branchBlockId = block.inputs[branchInputName][1];
        if (!branchBlockId || !blocksMap[branchBlockId]) return '';

        const lines = [];
        let curr = blocksMap[branchBlockId];
        while (curr) {
            lines.push(formatBlockToText(curr, blocksMap, branchIndent));
            curr = curr.next ? blocksMap[curr.next] : null;
        }
        return lines.join('\n');
    };

    // Human-readable mapping
    switch (opcode) {
    // Events
    case 'event_whenflagclicked':
        return `${spaces}quand drapeau vert cliqué :`;
    case 'event_whenkeypressed':
        return `${spaces}quand la touche [${getFieldValue('KEY_OPTION')}] pressée :`;
    case 'event_whenthisspriteclicked':
        return `${spaces}quand ce sprite est cliqué :`;
    case 'event_whenbroadcastreceived':
        return `${spaces}quand je reçois [${getFieldValue('BROADCAST_OPTION')}] :`;
    case 'event_broadcast':
        return `${spaces}envoyer à tous [${getInputValue('BROADCAST_INPUT') || getFieldValue('BROADCAST_OPTION')}]`;
    case 'event_broadcastandwait':
        return `${spaces}envoyer à tous [${getInputValue('BROADCAST_INPUT') || getFieldValue('BROADCAST_OPTION')}] et attendre`;

    // Motion
    case 'motion_movesteps':
        return `${spaces}avancer de ${getInputValue('STEPS') ?? 10} pas`;
    case 'motion_turnright':
        return `${spaces}tourner à droite de ${getInputValue('DEGREES') ?? 15} degrés`;
    case 'motion_turnleft':
        return `${spaces}tourner à gauche de ${getInputValue('DEGREES') ?? 15} degrés`;
    case 'motion_goto':
        return `${spaces}aller à [${getInputValue('TO') ?? 'position aléatoire'}]`;
    case 'motion_gotoxy':
        return `${spaces}aller à x: ${getInputValue('X') ?? 0} y: ${getInputValue('Y') ?? 0}`;
    case 'motion_glideto':
        return `${spaces}glisser en ${getInputValue('SECS') ?? 1}s vers [${getInputValue('TO')}]`;
    case 'motion_glidesecstoxy':
        return `${spaces}glisser en ${getInputValue('SECS') ?? 1}s vers x: ${getInputValue('X')} y: ${getInputValue('Y')}`;
    case 'motion_pointindirection':
        return `${spaces}s'orienter à ${getInputValue('DIRECTION') ?? 90}`;
    case 'motion_pointtowards':
        return `${spaces}s'orienter vers [${getInputValue('TOWARDS')}]`;
    case 'motion_changexby':
        return `${spaces}ajouter ${getInputValue('DX') ?? 10} à x`;
    case 'motion_setx':
        return `${spaces}mettre x à ${getInputValue('X') ?? 0}`;
    case 'motion_changeyby':
        return `${spaces}ajouter ${getInputValue('DY') ?? 10} à y`;
    case 'motion_sety':
        return `${spaces}mettre y à ${getInputValue('Y') ?? 0}`;
    case 'motion_ifonedgebounce':
        return `${spaces}rebondir si le bord est atteint`;
    case 'motion_xposition':
        return `(abscisse x)`;
    case 'motion_yposition':
        return `(ordonnée y)`;
    case 'motion_direction':
        return `(direction)`;

    // Looks
    case 'looks_say':
        return `${spaces}dire [${getInputValue('MESSAGE') ?? ''}]`;
    case 'looks_sayforsecs':
        return `${spaces}dire [${getInputValue('MESSAGE') ?? ''}] pendant ${getInputValue('SECS') ?? 2} secondes`;
    case 'looks_think':
        return `${spaces}penser à [${getInputValue('MESSAGE') ?? ''}]`;
    case 'looks_thinkforsecs':
        return `${spaces}penser à [${getInputValue('MESSAGE') ?? ''}] pendant ${getInputValue('SECS') ?? 2} secondes`;
    case 'looks_switchcostumeto':
        return `${spaces}basculer sur le costume [${getInputValue('COSTUME') || getFieldValue('COSTUME')}]`;
    case 'looks_nextcostume':
        return `${spaces}costume suivant`;
    case 'looks_switchbackdropto':
        return `${spaces}basculer sur l'arrière-plan [${getInputValue('BACKDROP') || getFieldValue('BACKDROP')}]`;
    case 'looks_nextbackdrop':
        return `${spaces}arrière-plan suivant`;
    case 'looks_changesizeby':
        return `${spaces}ajouter ${getInputValue('CHANGE') ?? 10} à la taille`;
    case 'looks_setsizeto':
        return `${spaces}mettre la taille à ${getInputValue('SIZE') ?? 100}%`;
    case 'looks_show':
        return `${spaces}montrer`;
    case 'looks_hide':
        return `${spaces}cacher`;

    // Sound
    case 'sound_play':
        return `${spaces}jouer le son [${getInputValue('SOUND_MENU') || getFieldValue('SOUND_MENU')}]`;
    case 'sound_playuntildone':
        return `${spaces}jouer le son [${getInputValue('SOUND_MENU') || getFieldValue('SOUND_MENU')}] jusqu'au bout`;
    case 'sound_stopallsounds':
        return `${spaces}arrêter tous les sons`;

    // Control
    case 'control_wait':
        return `${spaces}attendre ${getInputValue('DURATION') ?? 1} secondes`;
    case 'control_repeat': {
        const branch = formatBranch('SUBSTACK', indent + 1);
        return `${spaces}répéter ${getInputValue('TIMES') ?? 10} fois :\n${branch}\n${spaces}fin répéter`;
    }
    case 'control_forever': {
        const branch = formatBranch('SUBSTACK', indent + 1);
        return `${spaces}répéter indéfiniment :\n${branch}\n${spaces}fin répéter indéfiniment`;
    }
    case 'control_if': {
        const cond = getInputValue('CONDITION') ?? 'vrai';
        const branch = formatBranch('SUBSTACK', indent + 1);
        return `${spaces}si <${cond}> alors :\n${branch}\n${spaces}fin si`;
    }
    case 'control_if_else': {
        const cond = getInputValue('CONDITION') ?? 'vrai';
        const branch1 = formatBranch('SUBSTACK', indent + 1);
        const branch2 = formatBranch('SUBSTACK2', indent + 1);
        return `${spaces}si <${cond}> alors :\n${branch1}\n${spaces}sinon :\n${branch2}\n${spaces}fin si`;
    }
    case 'control_wait_until':
        return `${spaces}attendre jusqu'à <${getInputValue('CONDITION') ?? 'vrai'}>`;
    case 'control_repeat_until': {
        const cond = getInputValue('CONDITION') ?? 'vrai';
        const branch = formatBranch('SUBSTACK', indent + 1);
        return `${spaces}répéter jusqu'à <${cond}> :\n${branch}\n${spaces}fin répéter`;
    }
    case 'control_stop':
        return `${spaces}stop [${getFieldValue('STOP_OPTION') ?? 'tout'}]`;
    case 'control_create_clone_of':
        return `${spaces}créer un clone de [${getInputValue('CLONE_OPTION') || getFieldValue('CLONE_OPTION') || 'moi-même'}]`;
    case 'control_start_as_clone':
        return `${spaces}quand je commence comme un clone :`;

    // Sensing
    case 'sensing_touchingobject':
        return `<touche [${getInputValue('TOUCHINGOBJECTMENU') || getFieldValue('TOUCHINGOBJECTMENU') || ''}] ?>`;
    case 'sensing_touchingcolor':
        return `<couleur touchée ?>`;
    case 'sensing_distanceto':
        return `(distance de [${getInputValue('DISTANCETOMENU') || getFieldValue('DISTANCETOMENU')}])`;
    case 'sensing_askandwait':
        return `${spaces}demander [${getInputValue('QUESTION')}] et attendre`;
    case 'sensing_answer':
        return `(réponse)`;
    case 'sensing_keypressed':
        return `<touche [${getInputValue('KEY_OPTION') || getFieldValue('KEY_OPTION')}] pressée ?>`;
    case 'sensing_mousedown':
        return `<souris pressée ?>`;
    case 'sensing_mousex':
        return `(souris x)`;
    case 'sensing_mousey':
        return `(souris y)`;
    case 'sensing_timer':
        return `(chronomètre)`;
    case 'sensing_resettimer':
        return `${spaces}réinitialiser le chronomètre`;

    // Operators
    case 'operator_add':
        return `(${getInputValue('NUM1') ?? 0} + ${getInputValue('NUM2') ?? 0})`;
    case 'operator_subtract':
        return `(${getInputValue('NUM1') ?? 0} - ${getInputValue('NUM2') ?? 0})`;
    case 'operator_multiply':
        return `(${getInputValue('NUM1') ?? 0} * ${getInputValue('NUM2') ?? 0})`;
    case 'operator_divide':
        return `(${getInputValue('NUM1') ?? 0} / ${getInputValue('NUM2') ?? 0})`;
    case 'operator_random':
        return `(nombre aléatoire entre ${getInputValue('FROM') ?? 1} et ${getInputValue('TO') ?? 10})`;
    case 'operator_gt':
        return `<${getInputValue('OPERAND1') ?? ''} > ${getInputValue('OPERAND2') ?? ''}>`;
    case 'operator_lt':
        return `<${getInputValue('OPERAND1') ?? ''} < ${getInputValue('OPERAND2') ?? ''}>`;
    case 'operator_equals':
        return `<${getInputValue('OPERAND1') ?? ''} = ${getInputValue('OPERAND2') ?? ''}>`;
    case 'operator_and':
        return `<${getInputValue('OPERAND1') ?? ''} et ${getInputValue('OPERAND2') ?? ''}>`;
    case 'operator_or':
        return `<${getInputValue('OPERAND1') ?? ''} ou ${getInputValue('OPERAND2') ?? ''}>`;
    case 'operator_not':
        return `<non ${getInputValue('OPERAND') ?? ''}>`;
    case 'operator_join':
        return `(regrouper [${getInputValue('STRING1') ?? ''}] et [${getInputValue('STRING2') ?? ''}])`;

    // Variables
    case 'data_variable':
        return `(variable: ${getFieldValue('VARIABLE') ?? ''})`;
    case 'data_setvariableto':
        return `${spaces}mettre la variable [${getFieldValue('VARIABLE') ?? ''}] à ${getInputValue('VALUE') ?? 0}`;
    case 'data_changevariableby':
        return `${spaces}ajouter à la variable [${getFieldValue('VARIABLE') ?? ''}] ${getInputValue('VALUE') ?? 1}`;
    case 'data_showvariable':
        return `${spaces}montrer la variable [${getFieldValue('VARIABLE') ?? ''}]`;
    case 'data_hidevariable':
        return `${spaces}cacher la variable [${getFieldValue('VARIABLE') ?? ''}]`;

    // Pen (extension Stylo)
    case 'pen_clear':
        return `${spaces}effacer tout`;
    case 'pen_stamp':
        return `${spaces}estampiller`;
    case 'pen_penDown':
        return `${spaces}stylo en position d'écriture`;
    case 'pen_penUp':
        return `${spaces}relever le stylo`;
    case 'pen_setPenColorToColor':
        return `${spaces}mettre la couleur du stylo à ${getInputValue('COLOR') ?? ''}`;
    case 'pen_changePenColorParamBy':
        return `${spaces}ajouter ${getInputValue('VALUE') ?? 10} à [${getInputValue('COLOR_PARAM') ?? 'color'}] du stylo`;
    case 'pen_setPenColorParamTo':
        return `${spaces}mettre [${getInputValue('COLOR_PARAM') ?? 'color'}] du stylo à ${getInputValue('VALUE') ?? 50}`;
    case 'pen_changePenSizeBy':
        return `${spaces}ajouter ${getInputValue('SIZE') ?? 1} à la taille du stylo`;
    case 'pen_setPenSizeTo':
        return `${spaces}mettre la taille du stylo à ${getInputValue('SIZE') ?? 1}`;

    default:
        return `${spaces}[${opcode}]`;
    }
};

/**
 * Extract formatted scripts from a target
 */
const getTargetScripts = target => {
    if (!target || !target.blocks) return [];
    const blocksMap = target.blocks._blocks || {};
    const scripts = [];

    // Top-level blocks represent heads of scripts
    const topBlockIds = Object.keys(blocksMap).filter(id => blocksMap[id].topLevel);

    for (const topId of topBlockIds) {
        const topBlock = blocksMap[topId];
        const lines = [];
        let curr = topBlock;
        while (curr) {
            lines.push(formatBlockToText(curr, blocksMap, 0));
            curr = curr.next ? blocksMap[curr.next] : null;
        }

        scripts.push({
            topBlockId: topId,
            x: Math.round(topBlock.x || 0),
            y: Math.round(topBlock.y || 0),
            text: lines.filter(Boolean).join('\n')
        });
    }

    return scripts;
};

/**
 * Read structured information for a single target
 */
const readTarget = target => {
    if (!target) return null;

    const isStage = target.isStage;
    const name = target.getName ? target.getName() : (isStage ? 'Scène' : 'Sprite');
    const id = target.id;

    // Variables
    const variables = [];
    if (target.variables) {
        for (const varId in target.variables) {
            const v = target.variables[varId];
            variables.push({
                id: varId,
                name: v.name,
                value: v.value,
                type: v.type,
                isCloud: !!v.isCloud
            });
        }
    }

    // Costumes
    const costumes = (target.getCostumes ? target.getCostumes() : []).map((c, idx) => ({
        index: idx,
        name: c.name
    }));

    // Sounds
    const sounds = (target.getSounds ? target.getSounds() : []).map(s => s.name);

    // Scripts
    const scripts = getTargetScripts(target);

    return {
        id,
        name,
        isStage,
        x: target.x !== undefined ? Math.round(target.x) : 0,
        y: target.y !== undefined ? Math.round(target.y) : 0,
        size: target.size !== undefined ? target.size : 100,
        direction: target.direction !== undefined ? target.direction : 90,
        visible: target.visible !== undefined ? target.visible : true,
        variables,
        costumes,
        sounds,
        scripts,
        blocksCount: target.blocks && target.blocks._blocks ? Object.keys(target.blocks._blocks).length : 0
    };
};

/**
 * Read all targets from the Scratch VM
 */
const readAllTargets = vm => {
    if (!vm || !vm.runtime || !vm.runtime.targets) return [];
    return vm.runtime.targets.map(readTarget);
};

/**
 * Renders a single hydrated block as a compact one-liner for the addressed
 * listing: "opcode arg=val arg=(reporter ...)". This is generic (reads the
 * block's own inputs/fields), so it never needs a per-opcode case and cannot
 * drift when new blocks are added.
 * @param {object} block hydrated VM block
 * @param {object} blocksMap target block map
 * @returns {string} one-line description
 */
const renderBlockLine = (block, blocksMap) => {
    if (!block) return '';
    const opcode = block.opcode || '';
    const parts = [];

    const branchInputs = {SUBSTACK: true, SUBSTACK2: true};

    const describeInput = input => {
        if (!input) return '';
        // A reporter/boolean block plugged in (and not merely its shadow).
        if (input.block && input.block !== input.shadow && blocksMap[input.block]) {
            return `(${renderBlockLine(blocksMap[input.block], blocksMap)})`;
        }
        // Otherwise read the value carried by the shadow block.
        const shadowId = input.shadow || input.block;
        const shadow = shadowId ? blocksMap[shadowId] : null;
        if (shadow && shadow.fields) {
            const firstField = Object.values(shadow.fields)[0];
            if (firstField) return String(firstField.value);
        }
        return '';
    };

    for (const [name, input] of Object.entries(block.inputs || {})) {
        if (branchInputs[name]) continue;
        parts.push(`${name}=${describeInput(input)}`);
    }
    for (const [name, field] of Object.entries(block.fields || {})) {
        parts.push(`${name}=${field.value}`);
    }

    return `${opcode}${parts.length ? ' ' + parts.join(' ') : ''}`;
};

/**
 * Formats a target's scripts as an addressed, indented listing so the AI can
 * point at any single block for targeted edits (UPDATE/DELETE/INSERT).
 * @param {object} target VM target
 * @param {string} indentPrefix leading whitespace for each line
 * @returns {string} formatted listing
 */
const formatAddressedScripts = (target, indentPrefix = '') => {
    const scripts = listAddressedScripts(target, renderBlockLine);
    if (!scripts.length) return '';
    const out = [];
    for (const s of scripts) {
        out.push(`${indentPrefix}Script ${s.scriptIndex} (x:${s.x}, y:${s.y}) :`);
        for (const e of s.entries) {
            const pad = '  '.repeat(e.depth);
            out.push(`${indentPrefix}  [${e.address}] ${pad}${e.text}`);
        }
    }
    return out.join('\n');
};

/**
 * Format a comprehensive, clean project summary text for the AI
 */
const formatProjectSummary = vm => {
    const targets = readAllTargets(vm);
    if (!targets.length) return 'Le projet Scratch est vide.';

    const stage = targets.find(t => t.isStage);
    const sprites = targets.filter(t => !t.isStage);

    // Map target id -> real VM target so we can render addressed scripts.
    const vmTargets = (vm && vm.runtime && vm.runtime.targets) || [];
    const realById = {};
    for (const t of vmTargets) realById[t.id] = t;

    let output = '=== ÉTAT ACTUEL DU PROJET SCRATCH ===\n';
    output += '(Chaque bloc est préfixé par son adresse [script/chemin] pour les éditions ciblées.)\n';

    if (stage) {
        output += `\n[SCÈNE] (ID: ${stage.id})\n`;
        const globalVars = stage.variables.map(v => `${v.name} = ${JSON.stringify(v.value)}`).join(', ');
        output += `- Variables globales : ${globalVars || 'aucune'}\n`;
        output += `- Arrière-plans : ${stage.costumes.map(c => c.name).join(', ') || 'aucun'}\n`;
        const stageScripts = realById[stage.id] ? formatAddressedScripts(realById[stage.id], '  ') : '';
        output += stageScripts ? `- Scripts :\n${stageScripts}\n` : `- Scripts : aucun\n`;
    }

    output += `\n[SPRITES] (Total: ${sprites.length})\n`;
    if (sprites.length === 0) {
        output += `Aucun sprite présent dans le projet.\n`;
    } else {
        sprites.forEach((sp, i) => {
            output += `\n${i + 1}. SPRITE: "${sp.name}" (ID: ${sp.id})\n`;
            output += `   - Coordonnées: x = ${sp.x}, y = ${sp.y}, Direction = ${sp.direction}°, Taille = ${sp.size}%, Visible = ${sp.visible ? 'oui' : 'non'}\n`;
            if (sp.variables.length > 0) {
                output += `   - Variables locales: ${sp.variables.map(v => `${v.name} = ${JSON.stringify(v.value)}`).join(', ')}\n`;
            }
            output += `   - Costumes: ${sp.costumes.map(c => c.name).join(', ') || 'aucun'}\n`;
            const spScripts = realById[sp.id] ? formatAddressedScripts(realById[sp.id], '   ') : '';
            output += spScripts ? `   - Scripts :\n${spScripts}\n` : `   - Scripts: aucun script pour l'instant.\n`;
        });
    }

    return output;
};

export {
    readTarget,
    readAllTargets,
    formatProjectSummary,
    formatAddressedScripts,
    renderBlockLine,
    getTargetScripts,
    formatBlockToText
};
