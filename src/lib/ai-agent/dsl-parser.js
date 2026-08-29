/**
 * @fileoverview Compact DSL parser for the Scratch AI Agent.
 *
 * WHY THIS EXISTS
 * The agent used to require the AI to answer with verbose, indented JSON. A
 * full Pong game weighed ~2 400 tokens that way, and a single missing brace
 * made `JSON.parse` reject the whole answer. For large projects this became
 * both expensive and fragile.
 *
 * This module adds an indentation-based, Scratch-like text format that is
 * roughly 3-5x more compact and far more robust (a typo breaks one line, not
 * the whole program). Example:
 *
 *   var score = 0
 *   sprite Balle:
 *     whenflagclicked
 *     gotoxy 0 0
 *     point 45
 *     forever:
 *       move 10
 *       bounce
 *       if (touching _edge_):
 *         change score 1
 *
 * IMPORTANT — the parser is only a *front-end*: it produces exactly the same
 * action / block-spec objects the JSON path already produced, so it reuses the
 * whole battle-tested block-builder pipeline untouched. Anything the DSL can
 * express, the JSON could express too.
 */

import {BLOCK_SCHEMA, getDefaultInputs, getDefaultFields, isKnownOpcode} from './block-schema.js';
import {SHAPES} from './sprite-costumes.js';

/**
 * Opcodes that start a new script (hat blocks). Used to split a sprite body
 * into separate scripts.
 * @type {Set<string>}
 */
const HAT_OPCODES = new Set([
    'event_whenflagclicked',
    'event_whenthisspriteclicked',
    'event_whenstageclicked',
    'event_whenkeypressed',
    'event_whenbroadcastreceived',
    'event_whenbackdropswitchesto',
    'event_whengreaterthan',
    'control_start_as_clone'
]);

/** Inputs that are filled by nested indentation, never by positional args. */
const BRANCH_INPUTS = new Set(['SUBSTACK', 'SUBSTACK2']);

/**
 * Friendly short names / symbols mapped to their opcode. These take precedence
 * over the auto-generated suffix names.
 * @type {Object<string, string>}
 */
const ALIASES = {
    // Control
    'if': 'control_if',
    'forever': 'control_forever',
    'repeat': 'control_repeat',
    'wait': 'control_wait',
    'waituntil': 'control_wait_until',
    'repeatuntil': 'control_repeat_until',
    'stop': 'control_stop',
    'clone': 'control_create_clone_of',
    'createclone': 'control_create_clone_of',
    'deleteclone': 'control_delete_this_clone',
    'whenclone': 'control_start_as_clone',
    'startasclone': 'control_start_as_clone',

    // Events
    'whenflag': 'event_whenflagclicked',
    'whenflagclicked': 'event_whenflagclicked',
    'whenclicked': 'event_whenthisspriteclicked',
    'whenkey': 'event_whenkeypressed',
    'broadcast': 'event_broadcast',
    'broadcastwait': 'event_broadcastandwait',
    'whenreceive': 'event_whenbroadcastreceived',
    'whenbroadcast': 'event_whenbroadcastreceived',

    // Motion
    'move': 'motion_movesteps',
    'turnright': 'motion_turnright',
    'turnleft': 'motion_turnleft',
    'goto': 'motion_goto',
    'gotoxy': 'motion_gotoxy',
    'glideto': 'motion_glideto',
    'glidexy': 'motion_glidesecstoxy',
    'point': 'motion_pointindirection',
    'pointtowards': 'motion_pointtowards',
    'changex': 'motion_changexby',
    'setx': 'motion_setx',
    'changey': 'motion_changeyby',
    'sety': 'motion_sety',
    'bounce': 'motion_ifonedgebounce',
    'rotationstyle': 'motion_setrotationstyle',
    'xpos': 'motion_xposition',
    'ypos': 'motion_yposition',
    'direction': 'motion_direction',

    // Looks
    'say': 'looks_say',
    'sayfor': 'looks_sayforsecs',
    'think': 'looks_think',
    'thinkfor': 'looks_thinkforsecs',
    'costume': 'looks_switchcostumeto',
    'nextcostume': 'looks_nextcostume',
    'backdrop': 'looks_switchbackdropto',
    'nextbackdrop': 'looks_nextbackdrop',
    'changesize': 'looks_changesizeby',
    'setsize': 'looks_setsizeto',
    'changegraphiceffect': 'looks_changeeffectby',
    'setgraphiceffect': 'looks_seteffectto',
    'show': 'looks_show',
    'hide': 'looks_hide',
    'size': 'looks_size',

    // Sound
    'play': 'sound_play',
    'playuntildone': 'sound_playuntildone',
    'stopsounds': 'sound_stopallsounds',
    'changesoundeffect': 'sound_changeeffectby',
    'setsoundeffect': 'sound_seteffectto',
    'changevolume': 'sound_changevolumeby',
    'setvolume': 'sound_setvolumeto',
    'volume': 'sound_volume',

    // Sensing
    'touching': 'sensing_touchingobject',
    'touchingcolor': 'sensing_touchingcolor',
    'ask': 'sensing_askandwait',
    'answer': 'sensing_answer',
    'keypressed': 'sensing_keypressed',
    'mousedown': 'sensing_mousedown',
    'mousex': 'sensing_mousex',
    'mousey': 'sensing_mousey',
    'timer': 'sensing_timer',
    'resettimer': 'sensing_resettimer',
    'loudness': 'sensing_loudness',
    'username': 'sensing_username',
    'distanceto': 'sensing_distanceto',
    'of': 'sensing_of',

    // Operators (symbols + words)
    '+': 'operator_add',
    '-': 'operator_subtract',
    '*': 'operator_multiply',
    '/': 'operator_divide',
    '%': 'operator_mod',
    'mod': 'operator_mod',
    '>': 'operator_gt',
    '<': 'operator_lt',
    '=': 'operator_equals',
    '==': 'operator_equals',
    'and': 'operator_and',
    'or': 'operator_or',
    'not': 'operator_not',
    'join': 'operator_join',
    'letterof': 'operator_letter_of',
    'length': 'operator_length',
    'contains': 'operator_contains',
    'round': 'operator_round',
    'random': 'operator_random',
    'mathop': 'operator_mathop',

    // Variables
    'set': 'data_setvariableto',
    'change': 'data_changevariableby',
    'setvar': 'data_setvariableto',
    'changevar': 'data_changevariableby',
    'showvar': 'data_showvariable',
    'hidevar': 'data_hidevariable',
    'var': 'data_variable',

    // Lists
    'additem': 'data_addtolist',
    'deleteitem': 'data_deleteoflist',
    'deleteall': 'data_deletealloflist',
    'insertitem': 'data_insertatlist',
    'replaceitem': 'data_replaceitemoflist',
    'itemof': 'data_itemoflist',
    'itemnum': 'data_itemnumoflist',
    'listlength': 'data_lengthoflist',
    'listcontains': 'data_listcontainsitem',
    'showlist': 'data_showlist',
    'hidelist': 'data_hidelist',

    // Pen (extension Stylo)
    'penclear': 'pen_clear',
    'stamp': 'pen_stamp',
    'pendown': 'pen_penDown',
    'penup': 'pen_penUp',
    'pencolor': 'pen_setPenColorToColor',
    'changepencolorparam': 'pen_changePenColorParamBy',
    'setpencolorparam': 'pen_setPenColorParamTo',
    'changepensize': 'pen_changePenSizeBy',
    'setpensize': 'pen_setPenSizeTo'
};

/**
 * Positional parameter order for the handful of opcodes whose natural reading
 * order differs from `[...inputs, ...fields]`.
 * @type {Object<string, Array<string>>}
 */
const PARAM_ORDER_OVERRIDE = {
    data_setvariableto: ['VARIABLE', 'VALUE'],
    data_changevariableby: ['VARIABLE', 'VALUE'],
    looks_changeeffectby: ['EFFECT', 'CHANGE'],
    looks_seteffectto: ['EFFECT', 'VALUE'],
    sound_changeeffectby: ['EFFECT', 'VALUE'],
    sound_seteffectto: ['EFFECT', 'VALUE'],
    sensing_of: ['PROPERTY', 'OBJECT'],
    operator_mathop: ['OPERATOR', 'NUM'],
    looks_goforwardbackwardlayers: ['FORWARD_BACKWARD', 'NUM'],
    data_addtolist: ['ITEM', 'LIST'],
    data_deleteoflist: ['INDEX', 'LIST'],
    data_insertatlist: ['ITEM', 'INDEX', 'LIST'],
    data_replaceitemoflist: ['INDEX', 'ITEM', 'LIST'],
    data_itemoflist: ['INDEX', 'LIST'],
    data_itemnumoflist: ['ITEM', 'LIST'],
    data_listcontainsitem: ['ITEM', 'LIST']
};

/**
 * name -> opcode resolution table, built once from the schema (suffix) and the
 * curated alias table.
 * @type {Object<string, string>}
 */
const NAME_TO_OPCODE = (() => {
    const map = {};
    // Auto: opcode suffix (part after the first "_"). First writer wins so
    // that, on a suffix collision (looks_/sound_), the earlier schema entry
    // (looks_) is kept; the other is reachable through an explicit alias.
    for (const opcode of Object.keys(BLOCK_SCHEMA)) {
        const underscore = opcode.indexOf('_');
        const suffix = (underscore === -1 ? opcode : opcode.slice(underscore + 1)).toLowerCase();
        if (!map[suffix]) map[suffix] = opcode;
        // The full opcode is always accepted verbatim.
        map[opcode.toLowerCase()] = opcode;
    }
    // Curated aliases win over auto-generated names.
    Object.assign(map, ALIASES);
    return map;
})();

/**
 * Resolves a DSL head token to a Scratch opcode.
 * @param {string} name head token (alias, suffix, symbol or full opcode)
 * @returns {string} resolved opcode (or the input as-is when unknown)
 */
const resolveOpcode = name => {
    if (!name) return name;
    const key = name.toLowerCase();
    return NAME_TO_OPCODE[key] || name;
};

/**
 * Ordered list of positional parameters for an opcode (branch inputs excluded).
 * @param {string} opcode block opcode
 * @returns {Array<string>} parameter names
 */
const getParamOrder = opcode => {
    if (PARAM_ORDER_OVERRIDE[opcode]) return PARAM_ORDER_OVERRIDE[opcode];
    const inputs = Object.keys(getDefaultInputs(opcode)).filter(n => !BRANCH_INPUTS.has(n));
    const fields = Object.keys(getDefaultFields(opcode));
    return [...inputs, ...fields];
};

/**
 * Reads a single value token starting at index `i`.
 * Handles: (nested call), "quoted", 'quoted', numbers and bare words.
 * @param {string} str source
 * @param {number} start start index
 * @returns {{value: (number|string|object), next: number}} parsed value + next index
 */
const readValue = (str, start) => {
    const n = str.length;
    let i = start;
    while (i < n && /\s/.test(str[i])) i++;
    const ch = str[i];

    // Nested call: (name arg arg ...)
    if (ch === '(') {
        let depth = 0;
        const open = i;
        for (; i < n; i++) {
            if (str[i] === '(') depth++;
            else if (str[i] === ')') {
                depth--;
                if (depth === 0) {
                    i++;
                    break;
                }
            }
        }
        const inner = str.slice(open + 1, i - 1);
        // parseCall / readValue are mutually recursive; the call only happens at
        // parse time, after every const in this module is assigned.
        // eslint-disable-next-line no-use-before-define
        return {value: parseCall(inner), next: i};
    }

    // Quoted string
    if (ch === '"' || ch === '\'') {
        const quote = ch;
        i++;
        let buf = '';
        for (; i < n; i++) {
            if (str[i] === '\\' && i + 1 < n) {
                buf += str[i + 1];
                i++;
                continue;
            }
            if (str[i] === quote) {
                i++;
                break;
            }
            buf += str[i];
        }
        return {value: buf, next: i};
    }

    // Bare word (until whitespace).
    // An UNQUOTED word is a variable reference, not text: text must be quoted
    // (`say "Bonjour"`). The parser does not know the project's variables, so it
    // only marks the word; block-builder resolves the marker against the real VM
    // and falls back on the literal when no such variable exists (menu items
    // like `_edge_`, or a typo). Without this, `set py (+ py 1)` put the *text*
    // "py" in the green operator, which Scratch then computed as 0 + 1.
    const wordStart = i;
    while (i < n && !/\s/.test(str[i])) i++;
    const word = str.slice(wordStart, i);
    if (word === '') return {value: '', next: i};
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
        return {value: Number(word), next: i};
    }
    return {value: {__variable: word}, next: i};
};

/**
 * Parses an argument string into positional values and NAME=value pairs.
 * A lone `=` is skipped: the AI often writes `set score = 5` and that sign
 * carries no meaning here (real text is quoted), so treating it as a value
 * used to push every following argument one slot to the right.
 * @param {string} str argument string
 * @returns {{positional: Array, named: object}} parsed arguments
 */
const parseArgs = str => {
    const positional = [];
    const named = {};
    const n = str.length;
    let i = 0;
    while (i < n) {
        while (i < n && /\s/.test(str[i])) i++;
        if (i >= n) break;
        if (str[i] === '=' && (i + 1 >= n || /\s/.test(str[i + 1]))) {
            i++;
            continue;
        }
        const rest = str.slice(i);
        const namedMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
        if (namedMatch) {
            const name = namedMatch[1];
            i += namedMatch[0].length;
            const {value, next} = readValue(str, i);
            named[name] = value;
            i = next;
        } else {
            const {value, next} = readValue(str, i);
            positional.push(value);
            i = next;
        }
    }
    return {positional, named};
};

/**
 * True when a positional value is a plain scalar word (number, string or
 * bare-word variable marker) — i.e. not a nested block or list.
 * @param {any} v candidate
 * @returns {boolean} result
 */
const isPlainWord = v =>
    typeof v === 'string' || typeof v === 'number' ||
        (!!v && typeof v === 'object' && typeof v.__variable === 'string');

/**
 * Text of a plain word (unwraps the bare-word variable marker).
 * @param {any} v plain word
 * @returns {string} text
 */
const wordText = v => (v && typeof v === 'object' && typeof v.__variable === 'string') ?
    v.__variable : String(v);

/**
 * Parameters holding the NAME of something (variable, list, sprite, costume,
 * message...) rather than a number or a piece of text. Scratch names are free
 * text and very often contain spaces — "mon score", "Ma Balle", "up arrow" —
 * while the DSL separates arguments with spaces, so a multi-word name has to be
 * quoted (`set "mon score" 1`). When it is NOT quoted, the extra words used to be
 * dropped silently and the block referenced a truncated name ("mon"), creating a
 * bogus variable next to the real one. When exactly one parameter of the block is
 * such a name, the surplus words are glued back onto it instead.
 * @type {Set<string>}
 */
const NAME_PARAMS = new Set([
    'VARIABLE', 'LIST', 'BROADCAST_OPTION', 'BROADCAST_INPUT',
    'TO', 'TOWARDS', 'TOUCHINGOBJECTMENU', 'DISTANCETOMENU', 'CLONE_OPTION',
    'COSTUME', 'BACKDROP', 'SOUND_MENU', 'KEY_OPTION', 'STOP_OPTION',
    // `of <propriété> <objet>`: only OBJECT is listed, so a quoted property
    // leaves the sprite name free to keep its spaces (`of "x position" Ma Balle`).
    'OBJECT'
]);

/**
 * Glues the words left over by a too-short parameter list back onto the single
 * NAME parameter of the block, when there is exactly one and no ambiguity:
 * the parameters placed BEFORE the name take their value from the front, those
 * placed AFTER take theirs from the back, and everything in between is the name.
 *   set mon score 1     -> VARIABLE "mon score", VALUE 1
 *   additem 5 ma liste  -> ITEM 5, LIST "ma liste"
 * Numbers are never absorbed (protects `set score 1 2`-style slop), and a block
 * whose several parameters could all be names is left untouched: only quotes can
 * lift that ambiguity.
 * @param {Array<string>} order parameter names of the opcode
 * @param {Array} positional positional values
 * @returns {Array} positional values, with the name rebuilt when applicable
 */
const mergeNameWords = (order, positional) => {
    if (positional.length <= order.length) return positional;
    const nameIndexes = order
        .map((param, index) => (NAME_PARAMS.has(param) ? index : -1))
        .filter(index => index !== -1);
    if (nameIndexes.length !== 1) return positional;

    const nameIndex = nameIndexes[0];
    const before = nameIndex;
    const after = order.length - nameIndex - 1;
    const middle = positional.slice(before, positional.length - after);
    const joinable = middle.length > 1 &&
        middle.every(v => isPlainWord(v) && typeof v !== 'number');
    if (!joinable) return positional;

    return [
        ...positional.slice(0, before),
        {__variable: middle.map(wordText).join(' ')},
        ...(after ? positional.slice(positional.length - after) : [])
    ];
};

/**
 * Assembles a block spec from an opcode and parsed arguments.
 * Every value is placed under `inputs`; the block-builder reroutes field-only
 * names (KEY_OPTION, VARIABLE, EFFECT, ...) to `fields` automatically.
 * @param {string} opcode block opcode
 * @param {Array} positional positional values
 * @param {object} named NAME=value pairs
 * @returns {object} block spec
 */
const assembleSpec = (opcode, positional, named) => {
    const spec = {opcode};
    const inputs = {};
    const order = getParamOrder(opcode);
    // A single-parameter block given several bare words is ONE multi-word
    // value, not several: `stop other scripts in sprite`, `say Bonjour le
    // monde`, a costume / sound name with spaces... Keeping only the first
    // word built `stop` with STOP_OPTION "other": a cap block (mutation
    // hasnext "false") with blocks still chained under it — scratch-blocks
    // then aborts the whole workspace reload ("Next statement does not
    // exist"), which blanks the sprite's code area. Join the words instead,
    // unless one of them is numeric (protects `wait 1 second`-style slop).
    if (order.length === 1 && positional.length > 1 &&
            !positional.some(v => typeof v === 'number') &&
            positional.every(isPlainWord)) {
        positional = [{__variable: positional.map(wordText).join(' ')}];
    } else {
        // Several parameters: an unquoted multi-word NAME keeps its words.
        positional = mergeNameWords(order, positional);
    }
    let pi = 0;
    for (const param of order) {
        if (Object.prototype.hasOwnProperty.call(named, param)) {
            inputs[param] = named[param];
        } else if (pi < positional.length) {
            inputs[param] = positional[pi++];
        }
    }
    // Named args that are not part of the known order are still forwarded.
    for (const key of Object.keys(named)) {
        if (!Object.prototype.hasOwnProperty.call(inputs, key)) inputs[key] = named[key];
    }
    if (Object.keys(inputs).length) spec.inputs = inputs;
    return spec;
};

/**
 * Parses a single inline call ("name arg arg ...") into a block spec.
 * @param {string} text call text (no trailing colon)
 * @returns {object} block spec
 */
const parseCall = text => {
    const trimmed = text.trim();
    const spaceIdx = trimmed.search(/\s/);
    const head = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const argStr = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);
    const opcode = resolveOpcode(head);
    const {positional, named} = parseArgs(argStr);
    return assembleSpec(opcode, positional, named);
};

/**
 * Reads the opcode a node line would produce, without building it.
 * @param {string} text line text
 * @returns {string} opcode
 */
const peekOpcode = text => {
    const trimmed = text.replace(/:\s*$/, '').trim();
    const spaceIdx = trimmed.search(/\s/);
    const head = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    return resolveOpcode(head);
};

/**
 * Builds a linked stack of block specs from indentation nodes.
 * @param {Array<object>} nodes sibling nodes {text, children}
 * @returns {Array<object>} block specs
 */
const buildStack = nodes => {
    const specs = [];
    for (let k = 0; k < nodes.length; k++) {
        const node = nodes[k];
        const text = node.text.replace(/:\s*$/, '').trim();
        if (text === '') continue;
        // A stray "else" without a matching "if" is ignored.
        if (/^else$/i.test(text)) continue;

        const spec = parseCall(text);

        // Nested body via indentation -> SUBSTACK.
        if (node.children && node.children.length) {
            const declared = getDefaultInputs(spec.opcode);
            if (declared.SUBSTACK) {
                spec.inputs = spec.inputs || {};
                spec.inputs.SUBSTACK = buildStack(node.children);
            }
        }

        // "if ...: / else:" -> control_if_else with a second branch.
        if (spec.opcode === 'control_if') {
            const nextNode = nodes[k + 1];
            if (nextNode && /^else\b/i.test(nextNode.text.trim())) {
                spec.opcode = 'control_if_else';
                spec.inputs = spec.inputs || {};
                spec.inputs.SUBSTACK2 = buildStack(nextNode.children || []);
                k++; // consume the else node
            }
        }

        specs.push(spec);
    }
    return specs;
};

/**
 * Splits a sprite body into separate scripts. A new script starts on every hat
 * block or after a blank line.
 * @param {Array<object>} nodes sibling nodes
 * @returns {Array<Array<object>>} groups of nodes, one per script
 */
const splitScripts = nodes => {
    const scripts = [];
    let current = [];
    for (const node of nodes) {
        const isHat = HAT_OPCODES.has(peekOpcode(node.text));
        if (current.length && (isHat || node.blankBefore)) {
            scripts.push(current);
            current = [];
        }
        current.push(node);
    }
    if (current.length) scripts.push(current);
    return scripts;
};

/**
 * Turns raw text into an indentation tree.
 * @param {string} text raw DSL
 * @returns {Array<object>} root-level nodes {indent, text, blankBefore, children}
 */
const buildTree = text => {
    const root = {indent: -1, children: []};
    const stack = [root];
    let blankPending = false;

    const rawLines = String(text).split(/\r?\n/);
    for (const rawLine of rawLines) {
        const expanded = rawLine.replace(/\t/g, '  ');
        const trimmed = expanded.trim();
        if (trimmed === '') {
            blankPending = true;
            continue;
        }
        if (/^(#|\/\/|--)/.test(trimmed)) continue;

        const indent = expanded.match(/^ */)[0].length;
        const node = {indent, text: trimmed, blankBefore: blankPending, children: []};
        blankPending = false;

        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
            stack.pop();
        }
        stack[stack.length - 1].children.push(node);
        stack.push(node);
    }
    return root.children;
};

/**
 * Splits a value list on the commas that are NOT inside quotes.
 * @param {string} str right-hand side of an assignment
 * @returns {Array<string>} parts
 */
const splitOutsideQuotes = str => {
    const parts = [];
    let buf = '';
    let quote = null;
    for (const ch of str) {
        if (quote) {
            buf += ch;
            if (ch === quote) quote = null;
        } else if (ch === '"' || ch === '\'') {
            quote = ch;
            buf += ch;
        } else if (ch === ',') {
            parts.push(buf);
            buf = '';
        } else {
            buf += ch;
        }
    }
    parts.push(buf);
    return parts;
};

/**
 * Removes ONE pair of surrounding quotes from a name.
 * Scratch names are free text, so the AI quotes the ones holding spaces — but a
 * name is not a string literal: `var "mon score" = 0` must create a variable
 * called `mon score`, not `"mon score"` with the quote characters in it.
 * Inner quotes are kept (`he said "hi"`), only a clean pair is stripped.
 * @param {any} value raw name
 * @returns {string} the name without its surrounding quotes
 */
const unquoteName = value => {
    const text = String(value === null || typeof value === 'undefined' ? '' : value).trim();
    const quote = text[0];
    if ((quote === '"' || quote === '\'') && text.length > 1 &&
            text[text.length - 1] === quote && text.indexOf(quote, 1) === text.length - 1) {
        return text.slice(1, -1);
    }
    return text;
};

/**
 * Reads the NAME at the start of a directive: quoted ("Ma Balle") or bare and
 * possibly written in several words (Ma Balle).
 * A bare name stops before the trailing numbers, which are coordinates:
 * `sprite Ma Balle 0 0` -> name "Ma Balle", rest "0 0".
 * @param {string} rest text following the keyword
 * @param {object} [options] {numbersEndName: true} to peel the trailing numbers off
 * @returns {{name: string, rest: string}} name and what follows it
 */
const readName = (rest, options = {}) => {
    const text = String(rest === null || typeof rest === 'undefined' ? '' : rest).trim();
    const quote = text[0];
    if (quote === '"' || quote === '\'') {
        const end = text.indexOf(quote, 1);
        // An unterminated quote still gives the whole rest as the name.
        if (end === -1) return {name: text.slice(1).trim(), rest: ''};
        return {name: text.slice(1, end), rest: text.slice(end + 1).trim()};
    }
    const words = text.split(/\s+/).filter(Boolean);
    let cut = words.length;
    if (options.numbersEndName) {
        while (cut > 1 && /^[+-]?\d+(\.\d+)?$/.test(words[cut - 1])) cut--;
    }
    return {name: words.slice(0, cut).join(' '), rest: words.slice(cut).join(' ')};
};

/**
 * Splits the tail of a `var` / `list` declaration into its name and the
 * "= value" part, honouring a quoted name so that `var "mon score" = 0` keeps
 * the space. The returned tail still starts with "=" (parseAssignTail's input).
 * @param {string} rest text following the `var` / `list` keyword
 * @returns {{name: string, tail: string}} name and "= value" tail
 */
const splitAssignment = rest => {
    const text = String(rest === null || typeof rest === 'undefined' ? '' : rest).trim();
    const quote = text[0];
    if (quote === '"' || quote === '\'') {
        const end = text.indexOf(quote, 1);
        if (end === -1) return {name: text.slice(1).trim(), tail: ''};
        return {name: text.slice(1, end), tail: text.slice(end + 1).trim()};
    }
    const eqIdx = text.indexOf('=');
    if (eqIdx === -1) return {name: text.trim(), tail: ''};
    return {name: text.slice(0, eqIdx).trim(), tail: text.slice(eqIdx).trim()};
};

/**
 * Parses "= value" or "= a, b, c" tails for var/list directives.
 * A QUOTED value always stays text, even when it only contains digits:
 * `var map_data = "1111111110..."` is a string of digits, not 1.11e+63 (which
 * silently destroyed every `letterof` lookup on it).
 * @param {string} tail text after the name
 * @returns {(string|number|Array<string>|null)} parsed value (null when absent)
 */
const parseAssignTail = tail => {
    const trimmed = tail.trim();
    if (!trimmed.startsWith('=')) return null;
    const rhs = trimmed.slice(1).trim();
    if (rhs === '') return null;

    const parts = splitOutsideQuotes(rhs);
    if (parts.length > 1) {
        return parts.map(part => part.trim()
            .replace(/^["']|["']$/g, ''));
    }

    const value = parts[0].trim();
    const unquote = value.replace(/^["']|["']$/g, '');
    const wasQuoted = unquote !== value;
    if (wasQuoted) return unquote;
    const num = Number(unquote);
    return (unquote !== '' && !isNaN(num) && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(unquote)) ? num : unquote;
};

/** Keywords that introduce a targeted-edit directive rather than a block. */
const EDIT_KEYWORDS = new Set(['edit', 'delete', 'del', 'insert', 'replace']);

/**
 * Keywords that introduce a sprite-management directive (rename / delete)
 * rather than a block. Kept apart from the costume keywords so a line like
 * `renamesprite Balle = Raquette` is never mistaken for a block.
 * @type {Set<string>}
 */
const SPRITE_KEYWORDS = new Set(['renamesprite', 'rename', 'deletesprite', 'removesprite']);

/**
 * Parses a sprite-management directive node into an action.
 * Supported forms:
 *   renamesprite <ancien> = <nouveau>
 *   renamesprite <nouveau>          (renames the sprite of the enclosing `on`)
 *   deletesprite <nom>
 * @param {object} node directive node {text}
 * @param {?string} spriteName current target name
 * @returns {?object} action
 */
const parseSpriteDirective = (node, spriteName) => {
    const line = String(node.text || '').trim()
        .replace(/:\s*$/, '');
    const keyword = line.split(/\s+/)[0].toLowerCase();
    if (!SPRITE_KEYWORDS.has(keyword)) return null;

    const rest = line.slice(keyword.length).trim();
    const unquote = unquoteName;

    if (keyword === 'deletesprite' || keyword === 'removesprite') {
        const name = unquote(rest);
        if (!name) return null;
        return {type: 'DELETE_SPRITE', name};
    }

    const eqIdx = rest.indexOf('=');
    if (eqIdx === -1) {
        // `on Balle:` + `renamesprite Raquette` -> rename the current sprite.
        const name = unquote(rest);
        if (!name || !spriteName) return null;
        return {type: 'RENAME_SPRITE', sprite: spriteName, name};
    }
    const from = unquote(rest.slice(0, eqIdx));
    const to = unquote(rest.slice(eqIdx + 1));
    if (!from || !to) return null;
    return {type: 'RENAME_SPRITE', sprite: from, name: to};
};

/**
 * Tells whether a node is a sprite-management directive.
 * @param {object} node DSL node
 * @returns {boolean} true when the line renames or deletes a sprite
 */
const isSpriteDirective = node => {
    const line = String(node.text || '').trim();
    return SPRITE_KEYWORDS.has(line.split(/\s+/)[0].toLowerCase());
};

/**
 * Keywords that introduce a costume directive rather than a block.
 * `costume` is ambiguous: `costume "visage"` is the switch-costume block, while
 * `costume "visage" = <svg .../>` draws a new costume. `isCostumeDirective`
 * tells the two apart so the existing block keeps working.
 * @type {Set<string>}
 */
const COSTUME_KEYWORDS = new Set(['costume', 'renamecostume', 'deletecostume', 'setcostume', 'switchcostume']);

/**
 * Tells whether a node is a costume directive (as opposed to the
 * `looks_switchcostumeto` block, which shares the `costume` keyword).
 * @param {object} node DSL node
 * @returns {boolean} true when the line draws/renames/deletes a costume
 */
const isCostumeDirective = node => {
    const line = String(node.text || '').trim();
    const keyword = line.split(/\s+/)[0].toLowerCase();
    if (!COSTUME_KEYWORDS.has(keyword)) return false;
    if (keyword !== 'costume') return true;
    return line.indexOf('=') !== -1;
};

/**
 * Flattens a subtree back into its source lines, in document order.
 * An SVG written under a `costume` directive is indented, so `buildTree` turns
 * it into a tree: `<svg>` is the child, its shapes are grandchildren. Every
 * level has to be read back, otherwise the drawing loses its content.
 * @param {Array<object>} nodes DSL nodes
 * @returns {Array<string>} lines
 */
const flattenNodeLines = nodes => {
    const lines = [];
    for (const node of nodes || []) {
        lines.push(node.text);
        if (node.children && node.children.length) {
            lines.push(...flattenNodeLines(node.children));
        }
    }
    return lines;
};

/**
 * Parses a costume directive node into an action.
 * Supported forms:
 *   costume <nom> = <svg .../>          (SVG inline, or indented on the lines below)
 *   costume <nom> = circle #ff0000      (preset shape)
 *   renamecostume <ancien> = <nouveau>
 *   deletecostume <nom>
 *   setcostume <nom>
 * @param {object} node directive node {text, children}
 * @param {?string} spriteName current target name
 * @returns {?object} action
 */
const parseCostumeDirective = (node, spriteName) => {
    const line = String(node.text || '').trim()
        .replace(/:\s*$/, '');
    const keyword = line.split(/\s+/)[0].toLowerCase();
    if (!COSTUME_KEYWORDS.has(keyword)) return null;

    const rest = line.slice(keyword.length);
    const unquote = unquoteName;
    const withSprite = action => {
        if (spriteName) action.sprite = spriteName;
        return action;
    };
    // An SVG is often too long for one line: the indented lines are its body.
    const indentedBody = flattenNodeLines(node.children).join('\n');

    if (keyword === 'costume') {
        const eqIdx = rest.indexOf('=');
        if (eqIdx === -1) return null; // plain switch-costume block, not a directive
        const name = unquote(rest.slice(0, eqIdx));
        const inline = rest.slice(eqIdx + 1).trim();
        const source = [inline, indentedBody].filter(Boolean).join('\n')
            .trim();
        if (!source) return null;

        // `costume balle = circle #FFAB19` -> preset shape instead of raw SVG.
        const preset = source.match(/^([a-z]+)(\s+(#[0-9a-fA-F]{3,8}))?$/);
        if (preset && SHAPES[preset[1].toLowerCase()]) {
            const action = {type: 'CREATE_COSTUME', shape: preset[1].toLowerCase()};
            if (name) action.name = name;
            if (preset[3]) action.color = preset[3];
            return withSprite(action);
        }
        const svgAction = {type: 'CREATE_COSTUME', svg: source};
        if (name) svgAction.name = name;
        return withSprite(svgAction);
    }

    if (keyword === 'renamecostume') {
        const eqIdx = rest.indexOf('=');
        if (eqIdx === -1) return null;
        const from = unquote(rest.slice(0, eqIdx));
        const to = unquote(rest.slice(eqIdx + 1));
        if (!from || !to) return null;
        return withSprite({type: 'RENAME_COSTUME', costume: from, name: to});
    }

    if (keyword === 'deletecostume') {
        const name = unquote(rest);
        if (!name) return null;
        return withSprite({type: 'DELETE_COSTUME', costume: name});
    }

    // setcostume / switchcostume
    const name = unquote(rest);
    if (!name) return null;
    return withSprite({type: 'SET_COSTUME', costume: name});
};

/**
 * Parses a single edit-directive node into an action, or returns null if the
 * node is not an edit directive.
 * @param {object} node directive node {text, children}
 * @param {?string} spriteName current target name
 * @returns {?object} action
 */
const parseEditDirective = (node, spriteName) => {
    const lineText = node.text.replace(/:\s*$/, '');
    const parts = lineText.split(/\s+/);
    const keyword = parts[0].toLowerCase();
    if (!EDIT_KEYWORDS.has(keyword)) return null;

    const withSprite = action => {
        if (spriteName) action.sprite = spriteName;
        return action;
    };

    if (keyword === 'edit') {
        const address = parts[1];
        if (!address) return null;
        const callStr = lineText.slice(lineText.indexOf(address) + address.length).trim();
        const action = {type: 'UPDATE_BLOCK', address};
        if (callStr) {
            const spec = parseCall(callStr);
            action.opcode = spec.opcode;
            if (spec.inputs) action.inputs = spec.inputs;
        }
        return withSprite(action);
    }
    if (keyword === 'delete' || keyword === 'del') {
        const address = parts[1];
        if (!address) return null;
        return withSprite({type: 'DELETE_BLOCK', address});
    }
    if (keyword === 'insert') {
        const posWords = {after: 'after', before: 'before', into: 'into', into2: 'into2'};
        let position = 'after';
        let address = parts[1];
        if (posWords[(parts[1] || '').toLowerCase()]) {
            position = posWords[parts[1].toLowerCase()];
            address = parts[2];
        }
        if (!address) return null;
        return withSprite({type: 'INSERT_BLOCKS', address, position, blocks: buildStack(node.children || [])});
    }
    // replace
    const address = parts[1];
    if (!address) return null;
    return withSprite({type: 'REPLACE_BLOCK', address, blocks: buildStack(node.children || [])});
};

/**
 * Emits actions for a sprite/stage body: edit directives become edit actions,
 * everything else is grouped into ADD_SCRIPT scripts.
 * @param {?string} spriteName target name (null -> editing target)
 * @param {Array<object>} bodyNodes body nodes
 * @param {Array<object>} actions accumulator
 */
const emitScripts = (spriteName, bodyNodes, actions) => {
    // Separate edit directives (handled individually, order preserved) from
    // plain block lines (grouped into scripts).
    let scriptBuffer = [];
    const flushScripts = () => {
        if (!scriptBuffer.length) return;
        for (const scriptNodes of splitScripts(scriptBuffer)) {
            const blocks = buildStack(scriptNodes);
            if (blocks.length) {
                const action = {type: 'ADD_SCRIPT', blocks};
                if (spriteName) action.sprite = spriteName;
                actions.push(action);
            }
        }
        scriptBuffer = [];
    };

    for (const node of bodyNodes) {
        const keyword = node.text.trim().split(/\s+/)[0].toLowerCase();
        if (EDIT_KEYWORDS.has(keyword)) {
            flushScripts();
            const editAction = parseEditDirective(node, spriteName);
            if (editAction) actions.push(editAction);
        } else if (isCostumeDirective(node)) {
            flushScripts();
            const costumeAction = parseCostumeDirective(node, spriteName);
            if (costumeAction) actions.push(costumeAction);
        } else if (isSpriteDirective(node)) {
            flushScripts();
            const spriteAction = parseSpriteDirective(node, spriteName);
            if (spriteAction) actions.push(spriteAction);
        } else {
            scriptBuffer.push(node);
        }
    }
    flushScripts();
};

/**
 * Walks the block specs of a set of actions, counting how many reference a
 * known opcode vs an unknown one. Used to decide whether the text really was
 * the DSL (vs. e.g. the legacy uppercase CLI commands).
 * @param {Array<object>} actions produced actions
 * @returns {{known: number, unknown: number, directives: number}} tallies
 */
const scoreActions = actions => {
    let known = 0;
    let unknown = 0;
    let directives = 0;
    const walk = specs => {
        if (!Array.isArray(specs)) return;
        for (const spec of specs) {
            if (!spec || typeof spec.opcode !== 'string') continue;
            if (isKnownOpcode(spec.opcode)) known++;
            else unknown++;
            if (spec.inputs) {
                for (const value of Object.values(spec.inputs)) {
                    if (Array.isArray(value)) walk(value);
                    else if (value && typeof value === 'object' && typeof value.opcode === 'string') walk([value]);
                }
            }
        }
    };
    for (const action of actions) {
        if (action.type === 'ADD_SCRIPT' || action.type === 'INSERT_BLOCKS' || action.type === 'REPLACE_BLOCK') {
            walk(action.blocks);
            directives++;
        } else {
            directives++;
        }
    }
    return {known, unknown, directives};
};

/**
 * Parses the compact DSL into an ordered list of executable actions.
 * Returns an empty array when the text does not look like the DSL, so callers
 * can fall back to another format.
 * @param {string} text raw input
 * @returns {Array<object>} actions
 */
const parseDSL = text => {
    const actions = [];
    try {
        // Strip a surrounding markdown code fence (```scratch ... ``` or ```),
        // which is how the AI is asked to wrap its answer.
        let body = String(text);
        const fenceMatch = body.match(/```(?:scratch|scratchscript|text|txt)?\s*\n([\s\S]*?)```/i);
        if (fenceMatch) body = fenceMatch[1];
        const tree = buildTree(body);
        let currentSprite = null;
        let pendingBlocks = [];

        const flushPending = () => {
            if (pendingBlocks.length) {
                emitScripts(currentSprite, pendingBlocks, actions);
                pendingBlocks = [];
            }
        };

        for (const node of tree) {
            const lineText = node.text.replace(/:\s*$/, '');
            const parts = lineText.split(/\s+/);
            const keyword = parts[0].toLowerCase();

            if (keyword === 'sprite') {
                flushPending();
                // sprite Name [@|at x y] [:] — the name may contain spaces,
                // quoted (`sprite "Ma Balle" 0 0:`) or bare (`sprite Ma Balle:`),
                // in which case the trailing numbers are the coordinates.
                const {name, rest} = readName(lineText.slice(parts[0].length), {numbersEndName: true});
                const nameToken = name || 'Sprite';
                currentSprite = nameToken;
                const coords = rest.split(/\s+/).filter(p => /^[+-]?\d+(\.\d+)?$/.test(p));
                const spriteAction = {type: 'CREATE_SPRITE', name: nameToken};
                if (coords.length >= 2) {
                    spriteAction.x = Number(coords[0]);
                    spriteAction.y = Number(coords[1]);
                }
                actions.push(spriteAction);
                emitScripts(currentSprite, node.children, actions);
            } else if (keyword === 'stage' || keyword === 'scene' || keyword === 'scène') {
                flushPending();
                currentSprite = 'Stage';
                emitScripts('Stage', node.children, actions);
            } else if (keyword === 'var' || keyword === 'variable') {
                flushPending();
                const {name, tail} = splitAssignment(lineText.slice(parts[0].length));
                const value = tail ? parseAssignTail(tail) : 0;
                if (name) actions.push({type: 'CREATE_VAR', name, value: value === null ? 0 : value});
            } else if (keyword === 'list') {
                flushPending();
                const {name, tail} = splitAssignment(lineText.slice(parts[0].length));
                const parsed = tail ? parseAssignTail(tail) : [];
                let listValue = [];
                if (Array.isArray(parsed)) listValue = parsed;
                else if (parsed !== null) listValue = [parsed];
                if (name) {
                    actions.push({type: 'CREATE_LIST', name, value: listValue});
                }
            } else if (keyword === 'clear' || keyword === 'clearblocks') {
                flushPending();
                const {name} = readName(lineText.slice(parts[0].length));
                const spriteName = name || currentSprite;
                if (spriteName) actions.push({type: 'CLEAR_BLOCKS', sprite: spriteName});
            } else if (keyword === 'on' || keyword === 'target') {
                // on <Sprite>:  -> select an EXISTING sprite (no CREATE_SPRITE);
                // its indented body may contain edit directives or new scripts.
                // The name may hold spaces: `on "Ma Balle":` or `on Ma Balle:`.
                flushPending();
                const {name} = readName(lineText.slice(parts[0].length));
                currentSprite = name || currentSprite;
                emitScripts(currentSprite, node.children, actions);
            } else if (EDIT_KEYWORDS.has(keyword)) {
                // Top-level edit directive (edit / delete / insert / replace).
                flushPending();
                const editAction = parseEditDirective(node, currentSprite);
                if (editAction) actions.push(editAction);
            } else if (isCostumeDirective(node)) {
                // Top-level costume directive (draws / renames a costume).
                flushPending();
                const costumeAction = parseCostumeDirective(node, currentSprite);
                if (costumeAction) actions.push(costumeAction);
            } else if (isSpriteDirective(node)) {
                // Top-level sprite directive (renames / deletes a sprite).
                flushPending();
                const spriteAction = parseSpriteDirective(node, currentSprite);
                if (spriteAction) actions.push(spriteAction);
            } else {
                // A bare block line at the top level: accumulate into a script
                // for the current sprite (or the editing target when none).
                pendingBlocks.push(node);
            }
        }
        flushPending();
    } catch (e) {
        return [];
    }

    // Confidence guard: only claim the input if we actually recognised Scratch
    // blocks. This prevents the DSL from swallowing the legacy uppercase CLI
    // commands (CREATE_SPRITE Foo, etc.) which parseLineCommands handles, or
    // arbitrary prose the user might paste. When most block lines resolved to
    // unknown opcodes, we bail out and let the caller fall back.
    const {known, unknown, directives} = scoreActions(actions);
    if (known === 0 && directives === 0) return [];
    if (known === 0 && unknown > 0) return [];
    if (unknown > known) return [];

    return actions;
};

export {
    parseDSL,
    parseCall,
    resolveOpcode,
    getParamOrder,
    NAME_TO_OPCODE,
    ALIASES,
    HAT_OPCODES
};
