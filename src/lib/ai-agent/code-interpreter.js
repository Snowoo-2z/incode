/**
 * @fileoverview Code Interpreter for the Scratch AI Agent.
 * Parses and executes actions produced by AI or users to manipulate
 * sprites, variables, and code blocks.
 */

import {emptySprite} from '../empty-assets.js';
import {buildScript, generateId} from './block-builder.js';

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
            log(`✓ Sprite "${spriteName}" créé avec succès.`);
            target = findTarget(vm, spriteName);
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
            const scripts = target.blocks.getScripts();
            for (const sId of scripts) {
                target.blocks.deleteBlock(sId);
            }
            log(`✓ Tous les blocs du sprite "${spriteName}" ont été effacés.`);
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
            log(`✓ Sprite "${spriteName}" auto-créé.`);
        }

        if (!target) {
            log(`⚠ Impossible d'ajouter des blocs : cible "${spriteName}" introuvable.`);
            break;
        }

        const posX = action.x !== undefined ? Number(action.x) : 50;
        const posY = action.y !== undefined ? Number(action.y) : 50;
        const blockSpecs = action.blocks || [];

        if (!Array.isArray(blockSpecs) || blockSpecs.length === 0) {
            log(`⚠ Aucun bloc fourni pour "${spriteName}".`);
            break;
        }

        const blocks = buildScript(blockSpecs, posX, posY, { vm, target });
        await vm.shareBlocksToTarget(blocks, target.id);
        log(`✓ Script de ${blockSpecs.length} blocs ajouté sur "${spriteName}" à (x: ${posX}, y: ${posY}).`);
        break;
    }

    case 'REPLACE_SCRIPTS': {
        const spriteName = action.sprite || action.target;
        const target = findTarget(vm, spriteName);
        if (target && target.blocks) {
            const oldScripts = target.blocks.getScripts();
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
                x: s.x ?? 50,
                y: s.y ?? 50,
                blocks: s.blocks
            }, vm, log);
        }
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
        // Try fallback to line commands DSL
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

    log(`▶ Exécution de ${actions.length} action(s)...`);

    for (let i = 0; i < actions.length; i++) {
        try {
            await executeAction(actions[i], vm, log);
        } catch (err) {
            log(`❌ Erreur sur l'action ${i + 1} (${actions[i].type || 'inconnue'}) : ${err.message}`);
        }
    }

    // Refresh Scratch UI
    try {
        if (vm.refreshWorkspace) vm.refreshWorkspace();
        if (vm.emitWorkspaceUpdate) vm.emitWorkspaceUpdate();
        if (vm.emitTargetsUpdate) vm.emitTargetsUpdate(false);
    } catch (e) {
        // Non-critical
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
