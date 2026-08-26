/**
 * @fileoverview Block Builder for Scratch VM.
 * Converts structured block specifications into valid Scratch 3.0 blocks
 * and links them with variables, inputs, branches, and coordinates.
 */

// Unique ID generator
const generateId = (prefix = 'block_') =>
    prefix + Math.random().toString(36).substring(2, 9) + Date.now().toString(36).substring(4);

/**
 * Normalizes input values into Scratch VM format
 * @param {any} val Raw input value or child block spec
 * @param {Array} blocksList Accumulator for created blocks
 * @param {string} parentId ID of the parent block
 * @param {object} context Target and VM context for variable lookup
 */
const processInputValue = (inputKey, val, blocksList, parentId, context) => {
    // If it's a child block (reporter / condition)
    if (val && typeof val === 'object' && !Array.isArray(val) && val.opcode) {
        const childBlockId = generateId('rep_');
        const childBlock = buildSingleBlock(val, childBlockId, parentId, blocksList, context);
        // Scratch input reporter format: [3, childBlockId, [4, ""]] or [2, childBlockId]
        return [2, childBlockId];
    }

    // Number or string primitive
    if (typeof val === 'number') {
        return [1, [4, String(val)]];
    }
    if (typeof val === 'boolean') {
        return [1, [4, val ? 'true' : 'false']];
    }
    if (typeof val === 'string') {
        return [1, [4, val]];
    }

    // Already in Scratch format [1, [4, "..."]]
    if (Array.isArray(val)) {
        return val;
    }

    return [1, [4, String(val ?? '')]];
};

/**
 * Builds a single block and appends it to blocksList
 */
const buildSingleBlock = (spec, blockId, parentId, blocksList, context) => {
    const opcode = spec.opcode;
    const inputs = {};
    const fields = {};

    // 1. Process inputs
    if (spec.inputs) {
        for (const [k, v] of Object.entries(spec.inputs)) {
            if (k === 'SUBSTACK' || k === 'SUBSTACK2') {
                // Branch input (for control_forever, control_if, etc.)
                if (Array.isArray(v) && v.length > 0) {
                    const branchHeadId = buildBlockStack(v, blockId, blocksList, context);
                    if (branchHeadId) {
                        inputs[k] = [2, branchHeadId];
                    }
                }
            } else {
                inputs[k] = processInputValue(k, v, blocksList, blockId, context);
            }
        }
    }

    // 2. Process fields (e.g. VARIABLE, KEY_OPTION, STOP_OPTION, etc.)
    if (spec.fields) {
        for (const [k, v] of Object.entries(spec.fields)) {
            if (k === 'VARIABLE') {
                const varName = Array.isArray(v) ? v[0] : String(v);
                // Lookup or create variable in context
                const varId = resolveOrCreateVariable(varName, context);
                fields[k] = [varName, varId];
            } else if (k === 'KEY_OPTION' || k === 'STOP_OPTION' || k === 'TOUCHINGOBJECTMENU' || k === 'BROADCAST_OPTION') {
                const val = Array.isArray(v) ? v[0] : String(v);
                fields[k] = [val, null];
            } else {
                fields[k] = Array.isArray(v) ? v : [String(v), null];
            }
        }
    }

    // Handle shortcut helper: if opcode is data_setvariableto / data_changevariableby and variable is in spec.variable
    if ((opcode === 'data_setvariableto' || opcode === 'data_changevariableby' || opcode === 'data_variable') && !fields.VARIABLE) {
        const varName = spec.variable || (spec.inputs && spec.inputs.VARIABLE) || 'score';
        const varId = resolveOrCreateVariable(varName, context);
        fields.VARIABLE = [varName, varId];
    }

    // Handle shortcut for keys (sensing_keypressed)
    if (opcode === 'sensing_keypressed' && !inputs.KEY_OPTION && !fields.KEY_OPTION) {
        const key = spec.key || 'space';
        // Scratch uses shadow block for key_options
        const shadowId = generateId('key_');
        blocksList.push({
            id: shadowId,
            opcode: 'sensing_keyoptions',
            inputs: {},
            fields: { KEY_OPTION: [key, null] },
            next: null,
            topLevel: false,
            parent: blockId,
            shadow: true
        });
        inputs.KEY_OPTION = [1, shadowId];
    }

    // Handle shortcut for touching object menu
    if (opcode === 'sensing_touchingobject' && !inputs.TOUCHINGOBJECTMENU && !fields.TOUCHINGOBJECTMENU) {
        const menuVal = spec.target || spec.touching || '_edge_';
        const shadowId = generateId('touch_');
        blocksList.push({
            id: shadowId,
            opcode: 'sensing_touchingobjectmenu',
            inputs: {},
            fields: { TOUCHINGOBJECTMENU: [menuVal, null] },
            next: null,
            topLevel: false,
            parent: blockId,
            shadow: true
        });
        inputs.TOUCHINGOBJECTMENU = [1, shadowId];
    }

    const block = {
        id: blockId,
        opcode: opcode,
        inputs: inputs,
        fields: fields,
        next: null,
        topLevel: false,
        parent: parentId || null,
        shadow: !!spec.shadow,
        mutation: spec.mutation || null
    };

    blocksList.push(block);
    return block;
};

/**
 * Resolves a variable ID, creating the global variable if it doesn't exist.
 */
const resolveOrCreateVariable = (varName, context) => {
    const { vm, target } = context;
    if (!vm || !vm.runtime) return generateId('var_');

    const stage = vm.runtime.getTargetForStage();
    let existingVar = null;

    // Check on current target
    if (target && target.lookupVariableByNameAndType) {
        existingVar = target.lookupVariableByNameAndType(varName, '');
    }
    // Check on stage
    if (!existingVar && stage && stage.lookupVariableByNameAndType) {
        existingVar = stage.lookupVariableByNameAndType(varName, '');
    }

    if (existingVar) {
        return existingVar.id;
    }

    // Create global variable on stage
    const newId = generateId('var_');
    if (stage && stage.createVariable) {
        stage.createVariable(newId, varName, '', false);
    }
    return newId;
};

/**
 * Builds a linked sequence of blocks (a stack)
 * Returns the ID of the first block in the stack.
 */
const buildBlockStack = (specsList, parentId, blocksList, context) => {
    if (!Array.isArray(specsList) || specsList.length === 0) return null;

    let firstId = null;
    let prevBlock = null;

    for (let i = 0; i < specsList.length; i++) {
        const spec = specsList[i];
        const blockId = spec.id || generateId('block_');
        if (i === 0) firstId = blockId;

        // Current parent: if first in stack, parent is the caller's parentId; otherwise previous block
        const currParentId = (i === 0) ? parentId : (prevBlock ? prevBlock.id : null);
        const block = buildSingleBlock(spec, blockId, currParentId, blocksList, context);

        if (prevBlock) {
            prevBlock.next = blockId;
        }
        prevBlock = block;
    }

    return firstId;
};

/**
 * Builds a complete top-level script with x, y coordinates
 * @param {Array<object>} blockSpecs List of block specifications
 * @param {number} x X coordinate in the workspace
 * @param {number} y Y coordinate in the workspace
 * @param {object} context Context { vm, target }
 * @returns {Array<object>} Flat array of Scratch VM block objects ready for shareBlocksToTarget
 */
const buildScript = (blockSpecs, x = 50, y = 50, context = {}) => {
    const blocksList = [];
    const headId = buildBlockStack(blockSpecs, null, blocksList, context);

    if (headId) {
        const topBlock = blocksList.find(b => b.id === headId);
        if (topBlock) {
            topBlock.topLevel = true;
            topBlock.x = x;
            topBlock.y = y;
            topBlock.parent = null;
        }
    }

    return blocksList;
};

export {
    buildScript,
    buildSingleBlock,
    buildBlockStack,
    resolveOrCreateVariable,
    generateId
};
