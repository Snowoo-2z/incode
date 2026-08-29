/**
 * @fileoverview Code Interpreter for the Scratch AI Agent.
 * Parses and executes actions produced by AI or users to manipulate
 * sprites, variables, and code blocks.
 */

import {emptySprite} from '../empty-assets.js';
import {buildScript, findUnknownOpcodes, generateId} from './block-builder.js';
import {
    addSvgCostume,
    applyDefaultCostume,
    renameCostume as renameCostumeOnTarget,
    deleteCostume as deleteCostumeOnTarget,
    selectCostume as selectCostumeOnTarget
} from './sprite-costumes.js';
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

    // A name may contain spaces (`CREATE_SPRITE Ma Balle 0 0`): it is then
    // either quoted, or made of every word up to the trailing numbers.
    const readQuotedName = rest => {
        const text0 = String(rest || '').trim();
        const quote = text0[0];
        if (quote !== '"' && quote !== '\'') return null;
        const end = text0.indexOf(quote, 1);
        if (end === -1) return {name: text0.slice(1).trim(), rest: ''};
        return {name: text0.slice(1, end), rest: text0.slice(end + 1).trim()};
    };
    const readName = rest => {
        const quoted = readQuotedName(rest);
        if (quoted) return quoted;
        const text0 = String(rest || '').trim();
        const words = text0 === '' ? [] : text0.split(/\s+/);
        let cut = words.length;
        while (cut > 1 && /^[+-]?\d+(\.\d+)?$/.test(words[cut - 1])) cut--;
        return {name: words.slice(0, cut).join(' '), rest: words.slice(cut).join(' ')};
    };
    // A numeric text becomes a number ("0" included), anything else stays text.
    const asValue = raw => {
        if (raw === '') return 0;
        const num = Number(raw);
        return isNaN(num) ? raw : num;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const parts = line.split(/\s+/);
        const cmd = parts[0].toUpperCase();
        const rest = line.slice(parts[0].length).trim();

        switch (cmd) {
        case 'CREATE_SPRITE':
        case 'AJOUTER_SPRITE': {
            const {name, rest: coords} = readName(rest);
            const xy = coords.split(/\s+/).filter(Boolean);
            actions.push({
                type: 'CREATE_SPRITE',
                name: name || 'Sprite' + Math.floor(Math.random() * 100),
                x: xy[0] !== undefined ? Number(xy[0]) : 0,
                y: xy[1] !== undefined ? Number(xy[1]) : 0
            });
            break;
        }

        case 'DELETE_SPRITE':
        case 'SUPPRIMER_SPRITE':
            actions.push({
                type: 'DELETE_SPRITE',
                name: readName(rest).name
            });
            break;

        case 'CREATE_VAR':
        case 'CREER_VARIABLE': {
            // `CREATE_VAR <nom> [<valeur>]`. A name with spaces is quoted
            // (`CREATE_VAR "mon score" 0`); unquoted, only a trailing NUMBER is
            // read as the value (`CREATE_VAR mon score 0`), anything else keeps
            // the historical reading (`CREATE_VAR score bonjour`).
            const quoted = readQuotedName(rest);
            const words = rest === '' ? [] : rest.split(/\s+/);
            const last = words[words.length - 1];
            let name;
            let value;
            if (quoted) {
                name = quoted.name;
                value = quoted.rest;
            } else if (words.length > 1 && /^[+-]?\d+(\.\d+)?$/.test(last)) {
                name = words.slice(0, -1).join(' ');
                value = last;
            } else {
                name = words[0] || '';
                value = words.slice(1).join(' ');
            }
            actions.push({
                type: 'CREATE_VAR',
                name,
                value: asValue(value)
            });
            break;
        }

        case 'CREATE_LIST':
        case 'CREER_LISTE': {
            // Only a QUOTED name can be told apart from the list items:
            // `CREATE_LIST "ma liste" a b c`. Unquoted, the first word stays the
            // name (the historical behaviour) since every other word is an item.
            const quoted = readQuotedName(rest);
            const name = quoted ? quoted.name : parts[1];
            const items = quoted ? quoted.rest : parts.slice(2).join(' ');
            actions.push({
                type: 'CREATE_LIST',
                name,
                value: items === '' ? [] : items.split(/\s+/)
            });
            break;
        }

        case 'SET_POS':
        case 'SET_POSITION': {
            const {name, rest: coords} = readName(rest);
            const xy = coords.split(/\s+/).filter(Boolean);
            actions.push({
                type: 'SET_POSITION',
                sprite: name,
                x: Number(xy[0]) || 0,
                y: Number(xy[1]) || 0
            });
            break;
        }

        case 'CLEAR_BLOCKS':
        case 'EFFACER_BLOCS':
            actions.push({
                type: 'CLEAR_BLOCKS',
                sprite: readName(rest).name
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

        // The AI may ship its own drawings along with the sprite.
        if (target && Array.isArray(action.costumes)) {
            for (const costume of action.costumes) {
                const added = await addSvgCostume(vm, target, costume || {});
                if (added) {
                    log(`✓ Costume "${added.name}" ajouté à "${spriteName}".`);
                } else {
                    log(`⚠ Costume ignoré sur "${spriteName}" : SVG invalide.`);
                }
            }
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

    case 'RENAME_SPRITE':
    case 'RENOMMER_SPRITE': {
        // The AI renames the sprites it creates ("Sprite1" -> "Raquette") or the
        // ones it has to fix. vm.renameSprite also updates every reference in
        // the other sprites ("touching <Raquette>", "point towards", ...), which
        // is exactly what a plain `target.name = x` would break.
        const spriteName = action.sprite || action.from || action.target;
        const newName = action.name || action.newName || action.to;
        const target = findTarget(vm, spriteName);
        if (!target) {
            log(`⚠ RENAME_SPRITE : sprite "${spriteName || '?'}" introuvable.`);
            break;
        }
        if (target.isStage) {
            log('⚠ RENAME_SPRITE : la scène ne peut pas être renommée.');
            break;
        }
        if (!newName) {
            log(`⚠ RENAME_SPRITE : nouveau nom manquant pour "${spriteName}".`);
            break;
        }
        if (target.getName() === newName) {
            log(`ℹ "${spriteName}" porte déjà ce nom.`);
            break;
        }
        const existing = findTarget(vm, newName);
        if (existing) {
            log(`⚠ RENAME_SPRITE : un sprite nommé "${newName}" existe déjà.`);
            break;
        }
        try {
            vm.renameSprite(target.id, newName);
            log(`✓ Sprite "${spriteName}" renommé en "${newName}".`);
        } catch (e) {
            log(`⚠ RENAME_SPRITE : échec (${e.message}).`);
        }
        break;
    }

    case 'CREATE_COSTUME':
    case 'ADD_COSTUME': {
        const spriteName = action.sprite || action.target ||
            (vm.editingTarget ? vm.editingTarget.getName() : null);
        const target = findTarget(vm, spriteName);
        if (!target) {
            log(`⚠ CREATE_COSTUME : cible "${spriteName || '?'}" introuvable.`);
            break;
        }
        const added = await addSvgCostume(vm, target, action);
        if (added) {
            const kind = target.isStage ? 'arrière-plan' : 'costume';
            log(`✓ ${kind === 'arrière-plan' ? 'Arrière-plan' : 'Costume'} "${added.name}" ` +
                `(${Math.round(added.width)}×${Math.round(added.height)}) ` +
                `ajouté à "${target.getName()}" [index ${added.index + 1}].`);
        } else {
            log(`⚠ CREATE_COSTUME : aucun SVG valide fourni pour "${spriteName}". ` +
                `Attendu : un code SVG complet (<svg ...>...</svg>) ou une forme prédéfinie.`);
        }
        break;
    }

    case 'RENAME_COSTUME': {
        const spriteName = action.sprite || action.target;
        const target = findTarget(vm, spriteName);
        if (!target) {
            log(`⚠ RENAME_COSTUME : cible "${spriteName}" introuvable.`);
            break;
        }
        const from = action.costume ?? action.from ?? action.oldName;
        const to = action.name ?? action.newName ?? action.to;
        const applied = renameCostumeOnTarget(target, from, to);
        if (applied) {
            log(`✓ Costume "${from}" de "${target.getName()}" renommé en "${applied}".`);
        } else {
            log(`⚠ RENAME_COSTUME : costume "${from}" introuvable sur "${target.getName()}".`);
        }
        break;
    }

    case 'DELETE_COSTUME': {
        const spriteName = action.sprite || action.target;
        const target = findTarget(vm, spriteName);
        if (!target) {
            log(`⚠ DELETE_COSTUME : cible "${spriteName}" introuvable.`);
            break;
        }
        const removed = deleteCostumeOnTarget(target, action.costume ?? action.name);
        if (removed) {
            log(`✓ Costume "${removed}" supprimé de "${target.getName()}".`);
        } else {
            log(`⚠ DELETE_COSTUME : "${action.costume ?? action.name}" introuvable ` +
                `(ou dernier costume restant) sur "${target.getName()}".`);
        }
        break;
    }

    case 'SET_COSTUME':
    case 'SWITCH_COSTUME': {
        const spriteName = action.sprite || action.target;
        const target = findTarget(vm, spriteName);
        if (!target) {
            log(`⚠ SET_COSTUME : cible "${spriteName}" introuvable.`);
            break;
        }
        const shown = selectCostumeOnTarget(target, action.costume ?? action.name);
        if (shown) {
            log(`✓ "${target.getName()}" affiche maintenant le costume "${shown}".`);
        } else {
            log(`⚠ SET_COSTUME : costume "${action.costume ?? action.name}" introuvable sur "${target.getName()}".`);
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
