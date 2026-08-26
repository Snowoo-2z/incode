/**
 * @fileoverview Code Interpreter for the Scratch AI Agent.
 * Parses and executes actions produced by AI or users to manipulate
 * sprites, variables, and code blocks.
 */

import {emptySprite} from '../empty-assets.js';
import {buildScript, findUnknownOpcodes, generateId} from './block-builder.js';
import {applyDefaultCostume} from './sprite-costumes.js';
import {parseDSL} from './dsl-parser.js';
import {applyUpdate, applyDelete, applyInsert, applyReplace} from './block-editor.js';
import {resolveAddress} from './block-address.js';

/**
 * Horizontal/vertical layout used when the AI does not provide coordinates,
 * so that generated scripts never spawn stacked on top of each other.
 */
const SCRIPT_START_X = 60;
const SCRIPT_START_Y = 60;
const SCRIPT_GAP_Y = 60;
const BLOCK_HEIGHT = 48;

/**
 * Estimates the rendered height of a script, to place the next one below it.
 * @param {object} block a top-level VM block
 * @param {object} blocksMap all blocks of the target
 * @returns {number} approximate height in workspace units
 */
const estimateScriptHeight = (block, blocksMap) => {
    let height = 0;
    let curr = block;
    while (curr) {
        height += BLOCK_HEIGHT;
        for (const inputName of ['SUBSTACK', 'SUBSTACK2']) {
            const input = curr.inputs && curr.inputs[inputName];
            const childId = input && input.block;
            if (childId && blocksMap[childId]) {
                height += estimateScriptHeight(blocksMap[childId], blocksMap) + BLOCK_HEIGHT / 2;
            }
        }
        curr = curr.next ? blocksMap[curr.next] : null;
    }
    return height;
};

/**
 * Finds a free spot in the target workspace so a new script does not overlap
 * the existing ones (the previous implementation always used x:50 y:50, which
 * piled every generated script on the same pixel).
 * @param {object} target VM target
 * @returns {{x: number, y: number}} free coordinates
 */
const findFreeScriptPosition = target => {
    if (!target || !target.blocks || !target.blocks._blocks) {
        return {x: SCRIPT_START_X, y: SCRIPT_START_Y};
    }
    const blocksMap = target.blocks._blocks;
    const topBlocks = Object.keys(blocksMap)
        .map(id => blocksMap[id])
        .filter(b => b.topLevel && !b.shadow);

    if (topBlocks.length === 0) {
        return {x: SCRIPT_START_X, y: SCRIPT_START_Y};
    }

    let bottom = SCRIPT_START_Y;
    for (const block of topBlocks) {
        const blockBottom = (block.y || 0) + estimateScriptHeight(block, blocksMap);
        if (blockBottom > bottom) bottom = blockBottom;
    }
    return {x: SCRIPT_START_X, y: Math.round(bottom + SCRIPT_GAP_Y)};
};

/**
 * Finds a target sprite or stage by name or ID
 */
const findTarget = (vm, nameOrId) => {
    if (!vm || !vm.runtime || !vm.runtime.targets) return null;
    const nameLower = String(nameOrId).trim().toLowerCase();

    if (nameLower === 'stage' || nameLower === 'scène' || nameLower === 'scene') {
        return vm.runtime.getTargetForStage();
    }

    return vm.runtime.targets.find(t => {
        const tName = t.getName ? t.getName().toLowerCase() : '';
        return tName === nameLower || t.id === nameOrId;
    });
};

/**
 * Extracts JSON content from arbitrary markdown or text
 */
const extractJson = text => {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();

    // Check for ```json ... ``` codeblock
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch) {
        try {
            return JSON.parse(codeBlockMatch[1]);
        } catch (e) {
            // continue searching
        }
    }

    // Try parsing the whole string
    try {
        return JSON.parse(trimmed);
    } catch (e) {
        // Not direct JSON
    }

    // Find the first { or [ and last } or ]
    const firstBrace = trimmed.indexOf('{');
    const firstBracket = trimmed.indexOf('[');
    const startIdx = (firstBrace !== -1 && firstBracket !== -1)
        ? Math.min(firstBrace, firstBracket)
        : Math.max(firstBrace, firstBracket);

    if (startIdx !== -1) {
        const lastBrace = trimmed.lastIndexOf('}');
        const lastBracket = trimmed.lastIndexOf(']');
        const endIdx = Math.max(lastBrace, lastBracket);
        if (endIdx > startIdx) {
            try {
                return JSON.parse(trimmed.substring(startIdx, endIdx + 1));
            } catch (e) {
                // Parsing failed
            }
        }
    }

    return null;
};

/**
 * Parses simple line-by-line DSL commands if JSON is not present
 */
const parseLineCommands = text => {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && !l.startsWith('//'));
    const actions = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const parts = line.split(/\s+/);
        const cmd = parts[0].toUpperCase();

        switch (cmd) {
        case 'CREATE_SPRITE':
        case 'AJOUTER_SPRITE':
            actions.push({
                type: 'CREATE_SPRITE',
                name: parts[1] || 'Sprite' + Math.floor(Math.random() * 100),
                x: parts[2] !== undefined ? Number(parts[2]) : 0,
                y: parts[3] !== undefined ? Number(parts[3]) : 0
            });
            break;

        case 'DELETE_SPRITE':
        case 'SUPPRIMER_SPRITE':
            actions.push({
                type: 'DELETE_SPRITE',
                name: parts[1]
            });
            break;

        case 'CREATE_VAR':
        case 'CREER_VARIABLE':
            actions.push({
                type: 'CREATE_VAR',
                name: parts[1],
                value: parts[2] !== undefined ? Number(parts[2]) || parts[2] : 0
            });
            break;

        case 'CREATE_LIST':
        case 'CREER_LISTE':
            actions.push({
                type: 'CREATE_LIST',
                name: parts[1],
                value: parts.slice(2)
            });
            break;

        case 'SET_POS':
        case 'SET_POSITION':
            actions.push({
                type: 'SET_POSITION',
                sprite: parts[1],
                x: Number(parts[2]) || 0,
                y: Number(parts[3]) || 0
            });
            break;

        case 'CLEAR_BLOCKS':
        case 'EFFACER_BLOCS':
            actions.push({
                type: 'CLEAR_BLOCKS',
                sprite: parts[1]
            });
            break;

        default:
            break;
        }
    }

    return actions;
};

/**
 * Executes a single action on the Scratch VM
 */
const executeAction = async (action, vm, log) => {
    const type = (action.type || action.action || '').toUpperCase();

    switch (type) {
    case 'CREATE_SPRITE': {
        const spriteName = action.name || action.spriteName || 'Sprite';
        let target = findTarget(vm, spriteName);

        if (!target) {
            const emptyItem = emptySprite(spriteName, 'pop', 'costume1');
            if (action.x !== undefined) emptyItem.scratchX = Number(action.x);
            if (action.y !== undefined) emptyItem.scratchY = Number(action.y);

            await vm.addSprite(JSON.stringify(emptyItem));
            target = findTarget(vm, spriteName);
            // emptySprite() has a blank costume: give the sprite a visible
            // shape, otherwise it is invisible on the stage.
            try {
                await applyDefaultCostume(vm, target, action.shape, action.color);
            } catch (e) {
                log(`⚠ Costume par défaut non appliqué à "${spriteName}" : ${e.message}`);
            }
            log(`✓ Sprite "${spriteName}" créé avec succès.`);
        } else {
            log(`ℹ Le sprite "${spriteName}" existe déjà.`);
        }

        if (target && target.setXY) {
            if (action.x !== undefined || action.y !== undefined) {
                const newX = action.x !== undefined ? Number(action.x) : target.x;
                const newY = action.y !== undefined ? Number(action.y) : target.y;
                target.setXY(newX, newY);
            }
            if (action.size !== undefined && target.setSize) target.setSize(Number(action.size));
            if (action.direction !== undefined && target.setDirection) target.setDirection(Number(action.direction));
            if (action.visible !== undefined && target.setVisible) target.setVisible(!!action.visible);
        }
        break;
    }

    case 'DELETE_SPRITE': {
        const spriteName = action.name || action.sprite;
        const target = findTarget(vm, spriteName);
        if (target && !target.isStage) {
            vm.deleteSprite(target.id);
            log(`✓ Sprite "${spriteName}" supprimé.`);
        } else {
            log(`⚠ Impossible de supprimer "${spriteName}" : introuvable ou scène.`);
        }
        break;
    }

    case 'CREATE_VAR':
    case 'CREATE_VARIABLE': {
        const varName = action.name || action.varName;
        if (!varName) break;
        const stage = vm.runtime.getTargetForStage();
        const existing = stage ? stage.lookupVariableByNameAndType(varName, '') : null;
        if (!existing) {
            const varId = generateId('var_');
            if (stage && stage.createVariable) {
                stage.createVariable(varId, varName, '', false);
                if (action.value !== undefined && stage.variables[varId]) {
                    stage.variables[varId].value = action.value;
                }
                log(`✓ Variable globale "${varName}" créée (valeur: ${action.value ?? 0}).`);
            }
        } else {
            if (action.value !== undefined) {
                existing.value = action.value;
            }
            log(`ℹ Variable "${varName}" déjà existante.`);
        }
        break;
    }

    case 'CREATE_LIST': {
        const listName = action.name || action.listName;
        if (!listName) break;
        const stage = vm.runtime.getTargetForStage();
        const existing = stage ? stage.lookupVariableByNameAndType(listName, 'list') : null;
        if (!existing) {
            const listId = generateId('list_');
            if (stage && stage.createVariable) {
                stage.createVariable(listId, listName, 'list', false);
                if (Array.isArray(action.value) && stage.variables[listId]) {
                    stage.variables[listId].value = action.value.map(String);
                }
                log(`✓ Liste globale "${listName}" créée (${
                    Array.isArray(action.value) ? action.value.length : 0} élément(s)).`);
            }
        } else {
            if (Array.isArray(action.value)) {
                existing.value = action.value.map(String);
            }
            log(`ℹ Liste "${listName}" déjà existante.`);
        }
        break;
    }

    case 'SET_VAR':
    case 'SET_VARIABLE': {
        const varName = action.name || action.varName;
        const value = action.value ?? 0;
        const stage = vm.runtime.getTargetForStage();
        const v = stage ? stage.lookupVariableByNameAndType(varName, '') : null;
        if (v) {
            v.value = value;
            log(`✓ Variable "${varName}" mise à ${JSON.stringify(value)}.`);
        } else {
            log(`⚠ Variable "${varName}" introuvable.`);
        }
        break;
    }

    case 'SET_POSITION':
    case 'SET_SPRITE': {
        const spriteName = action.sprite || action.name;
        const target = findTarget(vm, spriteName);
        if (target && !target.isStage) {
            if (action.x !== undefined && action.y !== undefined) {
                target.setXY(Number(action.x), Number(action.y));
            }
            if (action.direction !== undefined) target.setDirection(Number(action.direction));
            if (action.size !== undefined) target.setSize(Number(action.size));
            if (action.visible !== undefined) target.setVisible(!!action.visible);
            log(`✓ Propriétés du sprite "${spriteName}" mises à jour.`);
        } else {
            log(`⚠ Sprite "${spriteName}" introuvable pour mise à jour.`);
        }
        break;
    }

    case 'CLEAR_BLOCKS': {
        const spriteName = action.sprite || action.name;
        const target = findTarget(vm, spriteName);
        if (target && target.blocks) {
            // getScripts() returns the live internal array: iterating it while
            // deleting mutated it and left orphan blocks behind.
            const scripts = [...target.blocks.getScripts()];
            for (const sId of scripts) {
                target.blocks.deleteBlock(sId);
            }
            log(`✓ Tous les blocs du sprite "${spriteName}" ont été effacés (${scripts.length} script(s)).`);
        } else {
            log(`⚠ Sprite "${spriteName}" introuvable : rien à effacer.`);
        }
        break;
    }

    case 'ADD_SCRIPT':
    case 'ADD_BLOCKS': {
        const spriteName = action.sprite || action.target || (vm.editingTarget ? vm.editingTarget.getName() : 'Sprite1');
        let target = findTarget(vm, spriteName);

        // Auto-create sprite if it doesn't exist
        if (!target && spriteName.toLowerCase() !== 'stage' && spriteName.toLowerCase() !== 'scène') {
            const emptyItem = emptySprite(spriteName, 'pop', 'costume1');
            await vm.addSprite(JSON.stringify(emptyItem));
            target = findTarget(vm, spriteName);
            try {
                await applyDefaultCostume(vm, target);
            } catch (e) {
                log(`⚠ Costume par défaut non appliqué à "${spriteName}" : ${e.message}`);
            }
            log(`✓ Sprite "${spriteName}" auto-créé.`);
        }

        if (!target) {
            log(`⚠ Impossible d'ajouter des blocs : cible "${spriteName}" introuvable.`);
            break;
        }

        const blockSpecs = action.blocks || [];

        if (!Array.isArray(blockSpecs) || blockSpecs.length === 0) {
            log(`⚠ Aucun bloc fourni pour "${spriteName}".`);
            break;
        }

        // Warn about opcodes that don't exist in the palette instead of
        // silently dropping broken blocks in the workspace.
        const unknown = findUnknownOpcodes(blockSpecs);
        if (unknown.length) {
            log(`⚠ Opcode(s) inconnu(s) ignoré(s) du catalogue : ${unknown.join(', ')}. ` +
                `Les blocs sont créés mais peuvent être incomplets.`);
        }

        // Auto-layout: if the AI gave no coordinates, place the script under
        // the existing ones instead of stacking everything at (50, 50).
        const auto = findFreeScriptPosition(target);
        const posX = action.x !== undefined ? Number(action.x) : auto.x;
        const posY = action.y !== undefined ? Number(action.y) : auto.y;

        const blocks = buildScript(blockSpecs, posX, posY, {vm, target});
        if (!blocks.length) {
            log(`⚠ Aucun bloc valide à ajouter sur "${spriteName}".`);
            break;
        }

        await vm.shareBlocksToTarget(blocks, target.id);
        if (target.blocks && target.blocks.updateTargetSpecificBlocks) {
            target.blocks.updateTargetSpecificBlocks(target.isStage);
        }
        if (target.blocks && target.blocks.resetCache) {
            target.blocks.resetCache();
        }
        log(`✓ Script de ${blockSpecs.length} bloc(s) ajouté sur "${spriteName}" à (x: ${posX}, y: ${posY}).`);
        break;
    }

    case 'REPLACE_SCRIPTS': {
        const spriteName = action.sprite || action.target;
        const target = findTarget(vm, spriteName);
        if (target && target.blocks) {
            const oldScripts = [...target.blocks.getScripts()];
            for (const sId of oldScripts) {
                target.blocks.deleteBlock(sId);
            }
            log(`✓ Anciens blocs de "${spriteName}" nettoyés.`);
        }

        // Add each new script
        const scripts = action.scripts || (action.blocks ? [{ blocks: action.blocks, x: action.x, y: action.y }] : []);
        for (const s of scripts) {
            await executeAction({
                type: 'ADD_SCRIPT',
                sprite: spriteName,
                x: s.x,
                y: s.y,
                blocks: s.blocks
            }, vm, log);
        }
        break;
    }

    case 'UPDATE_BLOCK':
    case 'EDIT_BLOCK': {
        const spriteName = action.sprite || action.target;
        const target = findTarget(vm, spriteName);
        if (!target || !target.blocks) {
            log(`⚠ UPDATE_BLOCK : sprite "${spriteName}" introuvable.`);
            break;
        }
        applyUpdate(action, target, {vm, target}, log);
        break;
    }

    case 'DELETE_BLOCK': {
        const spriteName = action.sprite || action.target;
        const target = findTarget(vm, spriteName);
        if (!target || !target.blocks) {
            log(`⚠ DELETE_BLOCK : sprite "${spriteName}" introuvable.`);
            break;
        }
        applyDelete(action, target, log);
        break;
    }

    case 'INSERT_BLOCKS':
    case 'INSERT_BLOCK': {
        const spriteName = action.sprite || action.target;
        const target = findTarget(vm, spriteName);
        if (!target || !target.blocks) {
            log(`⚠ INSERT_BLOCKS : sprite "${spriteName}" introuvable.`);
            break;
        }
        const unknown = findUnknownOpcodes(action.blocks || []);
        if (unknown.length) {
            log(`⚠ Opcode(s) inconnu(s) : ${unknown.join(', ')}.`);
        }
        applyInsert(action, target, {vm, target}, log);
        break;
    }

    case 'REPLACE_BLOCK': {
        const spriteName = action.sprite || action.target;
        const target = findTarget(vm, spriteName);
        if (!target || !target.blocks) {
            log(`⚠ REPLACE_BLOCK : sprite "${spriteName}" introuvable.`);
            break;
        }
        const unknown = findUnknownOpcodes(action.blocks || []);
        if (unknown.length) {
            log(`⚠ Opcode(s) inconnu(s) : ${unknown.join(', ')}.`);
        }
        applyReplace(action, target, {vm, target}, log);
        break;
    }

    default:
        log(`ℹ Type d'action non reconnu : "${type}".`);
        break;
    }
};

/**
 * Main interpreter function
 * @param {string} input Raw input from user or AI
 * @param {VirtualMachine} vm Scratch VM instance
 * @returns {Promise<object>} Execution report
 */
const interpretAndExecute = async (input, vm) => {
    const logs = [];
    const log = msg => logs.push(msg);

    if (!input || !input.trim()) {
        return {
            success: false,
            logs: ['⚠ Entrée vide. Aucune commande à exécuter.']
        };
    }

    if (!vm) {
        return {
            success: false,
            logs: ['⚠ Machine virtuelle Scratch VM non disponible.']
        };
    }

    let actions = [];
    const parsedJson = extractJson(input);

    if (parsedJson) {
        if (Array.isArray(parsedJson)) {
            actions = parsedJson;
        } else if (parsedJson.actions && Array.isArray(parsedJson.actions)) {
            actions = parsedJson.actions;
        } else if (parsedJson.type || parsedJson.action) {
            actions = [parsedJson];
        }
    }

    if (actions.length === 0) {
        // Try the compact indentation-based DSL (Scratch-like text).
        actions = parseDSL(input);
    }

    if (actions.length === 0) {
        // Try fallback to the legacy uppercase line-command DSL.
        actions = parseLineCommands(input);
    }

    if (actions.length === 0) {
        return {
            success: false,
            logs: [
                '⚠ Format non reconnu.',
                'Assurez-vous de fournir du JSON avec une liste "actions" ou des commandes (ex: CREATE_SPRITE, ADD_SCRIPT).'
            ]
        };
    }

    // Snapshot pass: targeted edits (UPDATE/DELETE/INSERT/REPLACE) address
    // blocks by their POSITION in the workspace. Applying one edit shifts the
    // positions of later blocks, so we resolve every edit address to a concrete
    // block id UP FRONT, against the current state, before any mutation. Each
    // edit then acts on its own stable id regardless of what earlier edits did.
    const EDIT_TYPES = new Set([
        'UPDATE_BLOCK', 'EDIT_BLOCK', 'DELETE_BLOCK',
        'INSERT_BLOCKS', 'INSERT_BLOCK', 'REPLACE_BLOCK'
    ]);
    for (const action of actions) {
        const t = (action.type || action.action || '').toUpperCase();
        if (!EDIT_TYPES.has(t)) continue;
        const target = findTarget(vm, action.sprite || action.target);
        if (!target || !target.blocks) continue;
        const resolved = resolveAddress(target, action.address || action.script, action.path);
        if (resolved) action.__blockId = resolved.blockId;
    }

    log(`▶ Exécution de ${actions.length} action(s)...`);

    for (let i = 0; i < actions.length; i++) {
        try {
            await executeAction(actions[i], vm, log);
        } catch (err) {
            log(`❌ Erreur sur l'action ${i + 1} (${actions[i].type || 'inconnue'}) : ${err.message}`);
        }
    }

    // Refresh the Scratch UI.
    // refreshWorkspace() only redraws the *editing* target, so blocks added to
    // another sprite stayed invisible until the user clicked it. We reset every
    // touched block container's cache, then redraw the currently edited one.
    try {
        for (const target of vm.runtime.targets) {
            if (target.blocks && target.blocks.resetCache) target.blocks.resetCache();
        }
        if (vm.emitTargetsUpdate) vm.emitTargetsUpdate(true);
        if (vm.refreshWorkspace) vm.refreshWorkspace();
        if (vm.runtime.emitProjectChanged) vm.runtime.emitProjectChanged();
        if (vm.runtime.requestBlocksUpdate) vm.runtime.requestBlocksUpdate();
    } catch (e) {
        log(`⚠ Rafraîchissement de l'interface partiel : ${e.message}`);
    }

    log('✨ Exécution terminée avec succès !');

    return {
        success: true,
        actionsCount: actions.length,
        logs
    };
};

export {
    interpretAndExecute,
    extractJson,
    findTarget,
    parseLineCommands
};
