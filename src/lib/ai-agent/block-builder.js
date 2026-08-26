/**
 * @fileoverview Block Builder for the Scratch VM.
 *
 * IMPORTANT — why this file was rewritten:
 * `vm.shareBlocksToTarget()` does NOT accept the sb3 *serialized* block format
 * (the compact one with `inputs: {X: [1, [4, "10"]]}`). It only deep-clones the
 * given array, renumbers the ids and calls `target.blocks.createBlock()` on each
 * item, which expects the *hydrated* runtime format:
 *
 *   {
 *     id, opcode, next, parent, topLevel, shadow, x, y,
 *     inputs: {X: {name: 'X', block: '<id>', shadow: '<id>'}},
 *     fields: {VARIABLE: {name: 'VARIABLE', value: 'score', id: '<varId>'}}
 *   }
 *
 * Feeding the serialized format produced blocks that were dropped in the
 * workspace with empty / broken slots and no shadow blocks: this is what made
 * the agent's block spawning unusable.
 *
 * This builder now creates, for every editable slot, the very same shadow block
 * the palette on the left would have inserted (math_number, text, math_angle,
 * sensing_keyoptions dropdown, ...) as described in `block-schema.js`.
 */

import {
    getInputSchema,
    getDefaultFields,
    getDefaultInputs,
    isKnownOpcode
} from './block-schema.js';

/** Unique ID generator */
const generateId = (prefix = 'block_') =>
    prefix + Math.random().toString(36).substring(2, 9) + Date.now().toString(36).substring(4);

const SCALAR_TYPE = '';
const BROADCAST_TYPE = 'broadcast_msg';

/**
 * Creates a hydrated block object.
 * @param {object} params block description
 * @returns {object} VM block
 */
const makeBlock = ({id, opcode, parent = null, shadow = false, mutation = null}) => ({
    id,
    opcode,
    inputs: {},
    fields: {},
    next: null,
    topLevel: false,
    parent,
    shadow,
    mutation
});

/**
 * Creates a shadow block (the little editable oval coming from the palette).
 * @param {string} shadowOpcode e.g. 'math_number'
 * @param {string} fieldName e.g. 'NUM'
 * @param {any} value default value
 * @param {string} parentId parent block id
 * @param {Array} blocksList accumulator
 * @returns {string} id of the created shadow
 */
const createShadow = (shadowOpcode, fieldName, value, parentId, blocksList) => {
    const id = generateId('shadow_');
    const block = makeBlock({id, opcode: shadowOpcode, parent: parentId, shadow: true});
    block.fields[fieldName] = {
        name: fieldName,
        value: value === null || typeof value === 'undefined' ? '' : String(value)
    };
    blocksList.push(block);
    return id;
};

/**
 * Resolves a variable id, creating the global variable on the stage if needed.
 * @param {string} varName variable name
 * @param {object} context {vm, target}
 * @returns {string} variable id
 */
const resolveOrCreateVariable = (varName, context) => {
    const {vm, target} = context;
    if (!vm || !vm.runtime) return generateId('var_');

    const stage = vm.runtime.getTargetForStage ? vm.runtime.getTargetForStage() : null;
    let existing = null;

    if (target && target.lookupVariableByNameAndType) {
        existing = target.lookupVariableByNameAndType(varName, SCALAR_TYPE);
    }
    if (!existing && stage && stage.lookupVariableByNameAndType) {
        existing = stage.lookupVariableByNameAndType(varName, SCALAR_TYPE);
    }
    if (existing) return existing.id;

    const newId = generateId('var_');
    if (stage && stage.createVariable) {
        stage.createVariable(newId, varName, SCALAR_TYPE, false);
    }
    return newId;
};

/**
 * Resolves (or creates) a broadcast message on the stage.
 * @param {string} name message name
 * @param {object} context {vm}
 * @returns {string} broadcast id
 */
const resolveOrCreateBroadcast = (name, context) => {
    const {vm} = context;
    const stage = vm && vm.runtime && vm.runtime.getTargetForStage ? vm.runtime.getTargetForStage() : null;
    if (stage && stage.lookupBroadcastMsg) {
        const existing = stage.lookupBroadcastMsg(null, name);
        if (existing) return existing.id;
    }
    const id = generateId('broadcast_');
    if (stage && stage.createVariable) {
        stage.createVariable(id, name, BROADCAST_TYPE, false);
    }
    return id;
};

/**
 * True when the value describes a nested block ({opcode: ...}).
 * @param {any} val candidate
 * @returns {boolean} result
 */
const isBlockSpec = val =>
    !!val && typeof val === 'object' && !Array.isArray(val) && typeof val.opcode === 'string';

/**
 * Extracts a plain value from what the AI may have written:
 * 10 / "10" / [1, [4, "10"]] / {value: 10}
 * @param {any} val raw value
 * @returns {any} plain value
 */
const plainValue = val => {
    if (Array.isArray(val)) {
        // Tolerate the sb3 serialized form so old AI answers keep working.
        let cur = val;
        while (Array.isArray(cur)) cur = cur[cur.length - 1];
        return cur;
    }
    if (val && typeof val === 'object' && 'value' in val) return val.value;
    return val;
};

/**
 * Default value of a dropdown when the AI provided none.
 * Costume / backdrop / sound menus are resolved against the real assets of the
 * target, exactly like the palette on the left does.
 * @param {object} schema input schema
 * @param {object} context {vm, target}
 * @returns {string} default menu value
 */
const resolveMenuDefault = (schema, context) => {
    const {target, vm} = context;
    switch (schema.shadow) {
    case 'looks_costume': {
        const costumes = target && target.getCostumes ? target.getCostumes() : [];
        return costumes.length ? costumes[0].name : 'costume1';
    }
    case 'looks_backdrops': {
        const stage = vm && vm.runtime && vm.runtime.getTargetForStage ? vm.runtime.getTargetForStage() : null;
        const backdrops = stage && stage.getCostumes ? stage.getCostumes() : [];
        return backdrops.length ? backdrops[0].name : 'backdrop1';
    }
    case 'sound_sounds_menu': {
        const sounds = target && target.getSounds ? target.getSounds() : [];
        return sounds.length ? sounds[0].name : '';
    }
    default:
        return schema.defaultValue || '';
    }
};

/**
 * Builds one input slot of a block, creating shadows and nested blocks.
 * @param {string} opcode parent opcode
 * @param {string} inputName input name
 * @param {any} rawValue value provided by the AI (may be undefined)
 * @param {string} parentId parent block id
 * @param {Array} blocksList accumulator
 * @param {object} context {vm, target}
 * @returns {?object} hydrated input descriptor
 */
const buildInput = (opcode, inputName, rawValue, parentId, blocksList, context) => {
    const schema = getInputSchema(opcode, inputName);

    // --- Branch (SUBSTACK / SUBSTACK2) -------------------------------------
    if (schema.branch) {
        const list = Array.isArray(rawValue) ? rawValue : (rawValue ? [rawValue] : []);
        if (!list.length) return null;
        const headId = buildBlockStack(list, parentId, blocksList, context);
        if (!headId) return null;
        return {name: inputName, block: headId, shadow: null};
    }

    // --- Boolean slot (no shadow in Scratch) -------------------------------
    if (schema.shadow === null) {
        if (!isBlockSpec(rawValue)) return null;
        const childId = generateId('bool_');
        buildSingleBlock(rawValue, childId, parentId, blocksList, context);
        return {name: inputName, block: childId, shadow: null};
    }

    // --- Dropdown menu slot (motion_goto_menu, sensing_keyoptions, ...) -----
    if (schema.isMenu) {
        let menuValue = plainValue(rawValue);
        if (typeof menuValue === 'undefined' || menuValue === null || menuValue === '') {
            menuValue = resolveMenuDefault(schema, context);
        }
        if (isBlockSpec(rawValue)) {
            // A reporter dropped onto the dropdown: keep the shadow underneath.
            const shadowId = createShadow(schema.shadow, schema.field, '', parentId, blocksList);
            const childId = generateId('rep_');
            buildSingleBlock(rawValue, childId, parentId, blocksList, context);
            return {name: inputName, block: childId, shadow: shadowId};
        }
        const value = typeof menuValue === 'undefined' || menuValue === null ? '' : String(menuValue);
        const shadowId = createShadow(schema.shadow, schema.field, value, parentId, blocksList);
        // Broadcast dropdowns carry a variable id.
        if (schema.shadow === 'event_broadcast_menu') {
            const shadowBlock = blocksList[blocksList.length - 1];
            const msgName = value || 'message1';
            shadowBlock.fields[schema.field] = {
                name: schema.field,
                value: msgName,
                id: resolveOrCreateBroadcast(msgName, context),
                variableType: BROADCAST_TYPE
            };
        }
        return {name: inputName, block: shadowId, shadow: shadowId};
    }

    // --- Regular value slot (number / text / angle / colour) ---------------
    const defaultValue = schema.shadow === 'text' ? '' : 0;
    if (isBlockSpec(rawValue)) {
        // Reporter obscuring its shadow: both must exist, like in the editor.
        const shadowId = createShadow(schema.shadow, schema.field, defaultValue, parentId, blocksList);
        const childId = generateId('rep_');
        buildSingleBlock(rawValue, childId, parentId, blocksList, context);
        return {name: inputName, block: childId, shadow: shadowId};
    }

    const value = plainValue(rawValue);
    const finalValue = typeof value === 'undefined' || value === null ? defaultValue : value;
    const shadowId = createShadow(schema.shadow, schema.field, finalValue, parentId, blocksList);
    return {name: inputName, block: shadowId, shadow: shadowId};
};

/**
 * Builds the fields of a block (dropdowns rendered directly on the block).
 * @param {object} block target block
 * @param {object} givenFields field name -> value map already routed/cleaned
 * @param {object} context {vm, target}
 */
const buildFields = (block, givenFields, context) => {
    const opcode = block.opcode;

    const provided = Object.assign({}, getDefaultFields(opcode), givenFields);

    for (const [name, rawValue] of Object.entries(provided)) {
        const descriptor = (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) ? rawValue : null;
        const value = plainValue(descriptor ? descriptor.value : rawValue);

        if (name === 'VARIABLE' || (descriptor && descriptor.variable)) {
            const varName = String(value);
            block.fields[name] = {
                name,
                value: varName,
                id: resolveOrCreateVariable(varName, context),
                variableType: SCALAR_TYPE
            };
        } else if (name === 'BROADCAST_OPTION' || (descriptor && descriptor.broadcast)) {
            const msgName = String(value);
            block.fields[name] = {
                name,
                value: msgName,
                id: resolveOrCreateBroadcast(msgName, context),
                variableType: BROADCAST_TYPE
            };
        } else {
            block.fields[name] = {name, value: String(value)};
        }
    }
};

/**
 * Builds a single block (plus its shadows and nested blocks).
 * @param {object} spec {opcode, inputs, fields, ...}
 * @param {string} blockId id to use
 * @param {?string} parentId parent block id
 * @param {Array} blocksList accumulator
 * @param {object} context {vm, target}
 * @returns {object} the created block
 */
const buildSingleBlock = (spec, blockId, parentId, blocksList, context) => {
    const opcode = spec.opcode;
    const block = makeBlock({
        id: blockId,
        opcode,
        parent: parentId || null,
        shadow: !!spec.shadow,
        mutation: spec.mutation || null
    });
    blocksList.push(block);

    // The AI (and our own cheatsheet) frequently puts a dropdown selection in
    // `fields` when Scratch actually stores it as an `input` filled by a menu
    // shadow block (KEY_OPTION, TOUCHINGOBJECTMENU, CLONE_OPTION, TO, ...), and
    // vice-versa. Feeding such a value to the wrong slot produced a broken block:
    // the condition of a "si <touche pressée>" never worked and, because the
    // C-block held a corrupt input, scratch-blocks refused to render its body —
    // so everything nested inside the `if` disappeared. We therefore route every
    // provided value to the slot the opcode really declares before building.
    const declared = getDefaultInputs(opcode);
    const declaredFields = getDefaultFields(opcode);

    const givenInputs = Object.assign({}, spec.inputs);
    const givenFields = Object.assign({}, spec.fields);

    // A value the AI placed in `fields` but that is really an input slot of this
    // opcode is moved to the inputs (so its menu shadow block gets created).
    for (const name of Object.keys(givenFields)) {
        if (Object.prototype.hasOwnProperty.call(declared, name) &&
            !Object.prototype.hasOwnProperty.call(declaredFields, name) &&
            typeof givenInputs[name] === 'undefined') {
            givenInputs[name] = givenFields[name];
            delete givenFields[name];
        }
    }
    // Conversely, a value placed in `inputs` but that is really a plain field of
    // this opcode is moved to the fields (e.g. EFFECT, STOP_OPTION, STYLE...).
    for (const name of Object.keys(givenInputs)) {
        if (Object.prototype.hasOwnProperty.call(declaredFields, name) &&
            !Object.prototype.hasOwnProperty.call(declared, name) &&
            typeof givenFields[name] === 'undefined') {
            givenFields[name] = givenInputs[name];
            delete givenInputs[name];
        }
    }

    // Friendly shorthands the AI (and our templates) may use. Each targets a
    // dropdown/menu input slot; they only apply when nothing else was provided.
    const inputShorthands = {
        sensing_keypressed: ['KEY_OPTION', spec.key],
        sensing_touchingobject: ['TOUCHINGOBJECTMENU', spec.target || spec.touching],
        sensing_distanceto: ['DISTANCETOMENU', spec.target],
        motion_goto: ['TO', spec.target || spec.to],
        motion_glideto: ['TO', spec.target || spec.to],
        motion_pointtowards: ['TOWARDS', spec.target || spec.towards],
        looks_switchcostumeto: ['COSTUME', spec.costume],
        looks_switchbackdropto: ['BACKDROP', spec.backdrop],
        sound_play: ['SOUND_MENU', spec.sound],
        sound_playuntildone: ['SOUND_MENU', spec.sound],
        control_create_clone_of: ['CLONE_OPTION', spec.target || spec.clone],
        event_broadcast: ['BROADCAST_INPUT', spec.message],
        event_broadcastandwait: ['BROADCAST_INPUT', spec.message]
    };
    const inputShorthand = inputShorthands[opcode];
    if (inputShorthand && typeof inputShorthand[1] !== 'undefined' &&
        typeof givenInputs[inputShorthand[0]] === 'undefined') {
        givenInputs[inputShorthand[0]] = inputShorthand[1];
    }

    // Shorthands that target a field rendered directly on the block.
    if (spec.variable && typeof givenFields.VARIABLE === 'undefined') {
        givenFields.VARIABLE = {variable: true, value: spec.variable};
    }
    if (spec.key && opcode === 'event_whenkeypressed' && typeof givenFields.KEY_OPTION === 'undefined') {
        givenFields.KEY_OPTION = spec.key;
    }
    if (spec.message && opcode === 'event_whenbroadcastreceived' &&
        typeof givenFields.BROADCAST_OPTION === 'undefined') {
        givenFields.BROADCAST_OPTION = {broadcast: true, value: spec.message};
    }

    // "control_stop" needs a mutation telling scratch-blocks if it can connect below.
    if (opcode === 'control_stop' && !block.mutation) {
        const option = plainValue(givenFields.STOP_OPTION) || 'all';
        block.mutation = {
            tagName: 'mutation',
            hasnext: (option === 'other scripts in sprite' || option === 'other scripts in stage') ? 'true' : 'false',
            children: []
        };
    }

    buildFields(block, givenFields, context);

    // Every declared input of the opcode gets built, even if the AI omitted it,
    // so the block always looks exactly like the one from the palette.
    const inputNames = new Set([...Object.keys(declared), ...Object.keys(givenInputs)]);

    for (const inputName of inputNames) {
        // A name already consumed as a field must not also become an input.
        if (block.fields[inputName]) continue;
        const built = buildInput(opcode, inputName, givenInputs[inputName], blockId, blocksList, context);
        if (built) block.inputs[inputName] = built;
    }

    return block;
};

/**
 * Builds a linked stack of blocks.
 * @param {Array<object>} specsList block specs
 * @param {?string} parentId parent of the first block
 * @param {Array} blocksList accumulator
 * @param {object} context {vm, target}
 * @returns {?string} id of the first block
 */
const buildBlockStack = (specsList, parentId, blocksList, context) => {
    if (!Array.isArray(specsList) || specsList.length === 0) return null;

    let firstId = null;
    let prevBlock = null;

    for (let i = 0; i < specsList.length; i++) {
        const spec = specsList[i];
        if (!spec || typeof spec.opcode !== 'string') continue;

        const blockId = generateId('block_');
        const currParentId = prevBlock ? prevBlock.id : (parentId || null);
        const block = buildSingleBlock(spec, blockId, currParentId, blocksList, context);

        if (prevBlock) prevBlock.next = blockId;
        else firstId = blockId;

        prevBlock = block;
    }

    return firstId;
};

/**
 * Builds a full top-level script.
 * @param {Array<object>} blockSpecs list of block specs
 * @param {number} x workspace x
 * @param {number} y workspace y
 * @param {object} context {vm, target}
 * @returns {Array<object>} flat list of hydrated blocks for shareBlocksToTarget
 */
const buildScript = (blockSpecs, x = 50, y = 50, context = {}) => {
    const blocksList = [];
    const headId = buildBlockStack(blockSpecs, null, blocksList, context);

    if (headId) {
        const topBlock = blocksList.find(b => b.id === headId);
        if (topBlock) {
            topBlock.topLevel = true;
            topBlock.parent = null;
            topBlock.x = Math.round(x);
            topBlock.y = Math.round(y);
        }
    }

    return blocksList;
};

/**
 * Lists the opcodes of a script that are not part of the known palette.
 * Used to warn the user instead of silently creating unusable blocks.
 * @param {Array<object>} blockSpecs specs (possibly nested)
 * @returns {Array<string>} unknown opcodes
 */
const findUnknownOpcodes = blockSpecs => {
    const unknown = [];
    const walk = specs => {
        if (!Array.isArray(specs)) return;
        for (const spec of specs) {
            if (!spec || typeof spec.opcode !== 'string') continue;
            if (!isKnownOpcode(spec.opcode)) unknown.push(spec.opcode);
            if (spec.inputs) {
                for (const value of Object.values(spec.inputs)) {
                    if (Array.isArray(value)) walk(value);
                    else if (isBlockSpec(value)) walk([value]);
                }
            }
        }
    };
    walk(blockSpecs);
    return [...new Set(unknown)];
};

export {
    buildScript,
    buildSingleBlock,
    buildBlockStack,
    resolveOrCreateVariable,
    resolveOrCreateBroadcast,
    findUnknownOpcodes,
    generateId
};
