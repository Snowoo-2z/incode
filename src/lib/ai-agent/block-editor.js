/**
 * @fileoverview Targeted block edits for the Scratch AI Agent.
 *
 * Until now the agent could only ADD a whole script or CLEAR a whole sprite.
 * Changing "just the speed of the ball" meant regenerating the entire sprite,
 * which is what blew up token usage on big projects. This module adds surgical
 * edits addressed by the compact path scheme in block-address.js:
 *
 *   - UPDATE_BLOCK : change inputs/fields of one existing block
 *   - DELETE_BLOCK : remove one block (its inner branches go with it), the
 *                    surrounding stack is re-linked so nothing else breaks
 *   - INSERT_BLOCKS: splice new blocks before/after a target, or at the start
 *                    of a C-block's branch
 *   - REPLACE_BLOCK: swap one block for a new stack in place
 *
 * All edits reuse the hydrated block format produced by block-builder.js and go
 * through target.blocks so the VM stays the single source of truth.
 */

import {buildScript, buildSingleBlock, generateId} from './block-builder.js';
import {resolveAddress, branchHeadId, BRANCH_INPUTS} from './block-address.js';

/**
 * Resolves the target block of an edit action. When the action carries a
 * pre-resolved block id (`__blockId`, set by the interpreter's snapshot pass so
 * that positional addresses stay valid across a batch of edits), that concrete
 * id is used; otherwise the address is resolved live.
 * @param {object} action edit action
 * @param {object} target VM target
 * @returns {?object} {blockId, address} or null
 */
const resolveEditTarget = (action, target) => {
    if (action.__blockId) {
        const blocksMap = target.blocks._blocks || {};
        if (blocksMap[action.__blockId]) {
            return {blockId: action.__blockId, address: action.address || action.__blockId};
        }
        return null;
    }
    return resolveAddress(target, action.address || action.script, action.path);
};

/**
 * Inserts already-built hydrated blocks into a target's block container.
 * @param {object} target VM target
 * @param {Array<object>} blocks hydrated blocks
 */
const addBlocksToContainer = (target, blocks) => {
    for (const block of blocks) {
        // createBlock ignores blocks whose id already exists, which is fine.
        target.blocks.createBlock(block);
    }
};

/**
 * Builds a detached stack of hydrated blocks (no top-level head) ready to be
 * spliced into an existing stack.
 * @param {Array<object>} specs block specs
 * @param {object} context {vm, target}
 * @returns {{blocks: Array<object>, headId: ?string, tailId: ?string}} built stack
 */
const buildDetachedStack = (specs, context) => {
    const blocks = buildScript(specs, 0, 0, context);
    // buildScript marks the first block topLevel + x/y; undo that for splicing.
    const head = blocks.find(b => b.topLevel);
    let headId = null;
    let tailId = null;
    if (head) {
        head.topLevel = false;
        delete head.x;
        delete head.y;
        headId = head.id;
        // Walk the top chain to find the tail (last `next`).
        const byId = new Map(blocks.map(b => [b.id, b]));
        let curr = head;
        while (curr && curr.next) curr = byId.get(curr.next);
        tailId = curr ? curr.id : headId;
    }
    return {blocks, headId, tailId};
};

/**
 * Finds the parent of a block within its stack: either the previous statement
 * (linked via `next`), or the C-block whose branch this block heads.
 * @param {object} target VM target
 * @param {string} blockId block id
 * @returns {object} {prevId, branchOwnerId, branchInput} — all possibly null
 */
const findAttachment = (target, blockId) => {
    const blocksMap = target.blocks._blocks || {};
    let prevId = null;
    let branchOwnerId = null;
    let branchInput = null;

    for (const [id, b] of Object.entries(blocksMap)) {
        if (b.next === blockId) {
            prevId = id;
        }
        if (b.inputs) {
            for (const name of Object.values(BRANCH_INPUTS)) {
                if (b.inputs[name] && b.inputs[name].block === blockId) {
                    branchOwnerId = id;
                    branchInput = name;
                }
            }
        }
    }
    return {prevId, branchOwnerId, branchInput};
};

/**
 * Re-parents a block id to a new parent, keeping the VM's `parent` pointer
 * consistent.
 * @param {object} target VM target
 * @param {?string} blockId block id (no-op when null)
 * @param {?string} parentId new parent id
 */
const setParent = (target, blockId, parentId) => {
    if (!blockId) return;
    const block = target.blocks.getBlock(blockId);
    if (block) block.parent = parentId || null;
};

/**
 * Repairs cap-block consistency after a re-link: `control_stop` renders as a
 * cap (no notch) when its mutation says hasnext "false". If an edit chains a
 * block under such a stop, the VM ends up with a `next` on a block that has no
 * next connection — the workspace XML then makes scratch-blocks abort the
 * whole workspace load ("Next statement does not exist"), which blanks the
 * sprite's code area on the next refresh. Any stop with something under it
 * must therefore declare hasnext "true" (Scratch 2.0 projects migrated to 3.0
 * do exactly this).
 * @param {object} target VM target
 */
const repairCapBlocks = target => {
    const blocksMap = target.blocks._blocks || {};
    for (const block of Object.values(blocksMap)) {
        if (block.opcode !== 'control_stop' || !block.next) continue;
        if (block.mutation && block.mutation.hasnext === 'true') continue;
        block.mutation = block.mutation
            ? {...block.mutation, hasnext: 'true'}
            : {tagName: 'mutation', hasnext: 'true', children: []};
    }
};

/**
 * Applies UPDATE_BLOCK: rebuilds the inputs/fields of an existing block in
 * place, preserving its id, position in the stack and any inner branches.
 * @param {object} action {sprite, address|script+path, inputs, fields, opcode?}
 * @param {object} target VM target
 * @param {object} context {vm, target}
 * @param {function(string): void} log logger
 * @returns {boolean} success
 */
const applyUpdate = (action, target, context, log) => {
    const resolved = resolveEditTarget(action, target);
    if (!resolved) {
        log(`⚠ UPDATE_BLOCK : adresse introuvable "${action.address || `${action.script}/${action.path}`}".`);
        return false;
    }
    const blocksMap = target.blocks._blocks || {};
    const original = blocksMap[resolved.blockId];
    if (!original) {
        log(`⚠ UPDATE_BLOCK : bloc "${resolved.blockId}" absent.`);
        return false;
    }

    const opcode = action.opcode || original.opcode;

    // Preserve the surrounding wiring and inner branches.
    const savedNext = original.next;
    const savedParent = original.parent;
    const savedShadow = original.shadow;
    const savedTopLevel = original.topLevel;
    const savedX = original.x;
    const savedY = original.y;
    const savedBranches = {};
    for (const name of Object.values(BRANCH_INPUTS)) {
        if (original.inputs && original.inputs[name]) savedBranches[name] = original.inputs[name];
    }

    // Delete the old block's OWN shadows/reporters (but not its branch bodies),
    // then rebuild it fresh with the same id.
    for (const [name, input] of Object.entries(original.inputs || {})) {
        if (Object.prototype.hasOwnProperty.call(savedBranches, name)) continue;
        if (input.block && blocksMap[input.block]) target.blocks.deleteBlock(input.block);
        if (input.shadow && input.shadow !== input.block && blocksMap[input.shadow]) {
            target.blocks.deleteBlock(input.shadow);
        }
    }
    delete blocksMap[resolved.blockId];

    // Merge: default to old field/input values, override with what was given.
    const spec = {
        opcode,
        inputs: action.inputs || {},
        fields: action.fields || {}
    };

    const built = [];
    buildSingleBlock(spec, resolved.blockId, savedParent, built, context);

    // Restore wiring + branches on the freshly built head block.
    const newHead = built.find(b => b.id === resolved.blockId);
    newHead.next = savedNext;
    newHead.parent = savedParent;
    newHead.shadow = savedShadow;
    if (savedTopLevel) {
        newHead.topLevel = true;
        newHead.x = savedX;
        newHead.y = savedY;
    }
    for (const [name, input] of Object.entries(savedBranches)) {
        newHead.inputs[name] = input;
    }

    addBlocksToContainer(target, built);
    log(`✓ UPDATE_BLOCK : bloc ${resolved.address} (${opcode}) mis à jour.`);
    return true;
};

/**
 * Applies DELETE_BLOCK: removes one block and re-links the stack around it.
 * @param {object} action {sprite, address|script+path}
 * @param {object} target VM target
 * @param {function(string): void} log logger
 * @returns {boolean} success
 */
const applyDelete = (action, target, log) => {
    const resolved = resolveEditTarget(action, target);
    if (!resolved) {
        log(`⚠ DELETE_BLOCK : adresse introuvable "${action.address || `${action.script}/${action.path}`}".`);
        return false;
    }
    const blocksMap = target.blocks._blocks || {};
    const block = blocksMap[resolved.blockId];
    if (!block) {
        log(`⚠ DELETE_BLOCK : bloc absent.`);
        return false;
    }

    const nextId = block.next;
    const {prevId, branchOwnerId, branchInput} = findAttachment(target, resolved.blockId);

    // Detach `next` so the recursive deleteBlock does not take the rest with it.
    block.next = null;

    // Re-link the stack around the deleted block.
    if (prevId) {
        target.blocks.getBlock(prevId).next = nextId;
        setParent(target, nextId, prevId);
    } else if (branchOwnerId) {
        // The block headed a branch: make its `next` the new branch head.
        const owner = target.blocks.getBlock(branchOwnerId);
        if (nextId) {
            owner.inputs[branchInput].block = nextId;
            setParent(target, nextId, branchOwnerId);
        } else {
            delete owner.inputs[branchInput];
        }
    } else if (block.topLevel && nextId) {
        // Deleting a script head: promote the next block to the new head.
        const newHead = target.blocks.getBlock(nextId);
        newHead.topLevel = true;
        newHead.parent = null;
        newHead.x = block.x;
        newHead.y = block.y;
        if (typeof target.blocks._addScript === 'function') target.blocks._addScript(nextId);
    }

    target.blocks.deleteBlock(resolved.blockId);
    if (typeof target.blocks._deleteScript === 'function') target.blocks._deleteScript(resolved.blockId);
    repairCapBlocks(target);
    log(`✓ DELETE_BLOCK : bloc ${resolved.address} supprimé.`);
    return true;
};

/**
 * Applies INSERT_BLOCKS: splices new blocks relative to a target block.
 * position: 'after' (default) | 'before' | 'into' (start of the branch) |
 *           'into2' (start of the else branch).
 * @param {object} action {sprite, address|script+path, position, blocks}
 * @param {object} target VM target
 * @param {object} context {vm, target}
 * @param {function(string): void} log logger
 * @returns {boolean} success
 */
const applyInsert = (action, target, context, log) => {
    const resolved = resolveEditTarget(action, target);
    if (!resolved) {
        log(`⚠ INSERT_BLOCKS : adresse introuvable "${action.address || `${action.script}/${action.path}`}".`);
        return false;
    }
    const specs = action.blocks || [];
    if (!Array.isArray(specs) || !specs.length) {
        log(`⚠ INSERT_BLOCKS : aucun bloc à insérer.`);
        return false;
    }

    const {blocks, headId, tailId} = buildDetachedStack(specs, context);
    if (!headId) {
        log(`⚠ INSERT_BLOCKS : blocs invalides.`);
        return false;
    }

    // Register the new blocks first, so getBlock(headId/tailId) works while we
    // rewire the surrounding stack below.
    addBlocksToContainer(target, blocks);

    const anchor = target.blocks.getBlock(resolved.blockId);
    const position = (action.position || 'after').toLowerCase();

    if (position === 'into' || position === 'into2') {
        const branch = position === 'into2' ? 2 : 1;
        const branchInput = BRANCH_INPUTS[branch];
        const oldBranchHead = branchHeadId(anchor, branch);
        anchor.inputs = anchor.inputs || {};
        anchor.inputs[branchInput] = {name: branchInput, block: headId, shadow: null};
        setParent(target, headId, resolved.blockId);
        if (oldBranchHead) {
            target.blocks.getBlock(tailId).next = oldBranchHead;
            setParent(target, oldBranchHead, tailId);
        }
    } else if (position === 'before') {
        const {prevId, branchOwnerId, branchInput} = findAttachment(target, resolved.blockId);
        target.blocks.getBlock(tailId).next = resolved.blockId;
        setParent(target, resolved.blockId, tailId);
        if (prevId) {
            target.blocks.getBlock(prevId).next = headId;
            setParent(target, headId, prevId);
        } else if (branchOwnerId) {
            target.blocks.getBlock(branchOwnerId).inputs[branchInput].block = headId;
            setParent(target, headId, branchOwnerId);
        } else if (anchor.topLevel) {
            // Inserting before a script head: the new head becomes top-level and
            // the old head is demoted (and removed from the scripts list, else it
            // would remain registered as a separate script too).
            if (typeof target.blocks._deleteScript === 'function') target.blocks._deleteScript(resolved.blockId);
            const newHead = blocks.find(b => b.id === headId);
            newHead.topLevel = true;
            newHead.parent = null;
            newHead.x = anchor.x;
            newHead.y = anchor.y;
            anchor.topLevel = false;
            delete anchor.x;
            delete anchor.y;
            if (typeof target.blocks._addScript === 'function') target.blocks._addScript(headId);
        }
    } else {
        // 'after' (default)
        const oldNext = anchor.next;
        anchor.next = headId;
        setParent(target, headId, resolved.blockId);
        if (oldNext) {
            target.blocks.getBlock(tailId).next = oldNext;
            setParent(target, oldNext, tailId);
        }
    }

    repairCapBlocks(target);
    log(`✓ INSERT_BLOCKS : ${specs.length} bloc(s) inséré(s) ${position} ${resolved.address}.`);
    return true;
};

/**
 * Applies REPLACE_BLOCK: swaps a block for a new stack, keeping its place.
 * Implemented as insert-after + delete of the original: inserting after does
 * not shift the original's address, so the subsequent delete stays valid, and
 * the re-link makes the new stack take the original's slot.
 * @param {object} action {sprite, address|script+path, blocks}
 * @param {object} target VM target
 * @param {object} context {vm, target}
 * @param {function(string): void} log logger
 * @returns {boolean} success
 */
const applyReplace = (action, target, context, log) => {
    const insertOk = applyInsert(
        {...action, position: 'after'},
        target,
        context,
        () => {}
    );
    if (!insertOk) {
        log(`⚠ REPLACE_BLOCK : échec de l'insertion du remplacement.`);
        return false;
    }
    const delOk = applyDelete(action, target, () => {});
    if (!delOk) {
        log(`⚠ REPLACE_BLOCK : remplacement inséré mais suppression de l'ancien bloc impossible.`);
        return false;
    }
    log(`✓ REPLACE_BLOCK : bloc ${action.address || `${action.script}/${action.path}`} remplacé.`);
    return true;
};

export {
    applyUpdate,
    applyDelete,
    applyInsert,
    applyReplace,
    buildDetachedStack,
    findAttachment,
    repairCapBlocks,
    generateId
};
