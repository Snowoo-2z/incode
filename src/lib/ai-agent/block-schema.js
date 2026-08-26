/**
 * @fileoverview Schema of Scratch 3.0 blocks used by the AI Agent.
 *
 * Scratch blocks are NOT just "an opcode with values": every editable input of a
 * block is actually filled by a hidden "shadow" block coming from the palette
 * (math_number, text, math_angle, a dropdown menu block, ...).
 * Creating a block without the right shadow produces a broken / unusable block
 * in the workspace, which is exactly what made the previous generator unreliable.
 *
 * This table describes, for every supported opcode:
 *  - `inputs`  : input name -> shadow descriptor
 *  - `fields`  : field name -> default value (fields are rendered directly on the block)
 *
 * Shadow descriptor:
 *  - {shadow: 'math_number', field: 'NUM'}            -> numeric slot
 *  - {shadow: 'text', field: 'TEXT'}                  -> text slot
 *  - {shadow: 'motion_goto_menu', field: 'TO'}        -> dropdown slot
 *  - {shadow: null}                                   -> boolean / no shadow (conditions)
 *  - {branch: true}                                   -> SUBSTACK (nested blocks)
 */

const NUM = {shadow: 'math_number', field: 'NUM'};
const WHOLE = {shadow: 'math_whole_number', field: 'NUM'};
const POSITIVE = {shadow: 'math_positive_number', field: 'NUM'};
const INTEGER = {shadow: 'math_integer', field: 'NUM'};
const ANGLE = {shadow: 'math_angle', field: 'NUM'};
const TEXT = {shadow: 'text', field: 'TEXT'};
const BOOL = {shadow: null};
const BRANCH = {branch: true};
const menu = (shadow, field, defaultValue = '') => ({shadow, field, isMenu: true, defaultValue});

/** Shorthand for a "list" field (field_variable of the list type). */
const LIST = {list: true, value: 'ma liste'};

const BLOCK_SCHEMA = {
    /* ------------------------------------------------------------------ Events */
    event_whenflagclicked: {},
    event_whenthisspriteclicked: {},
    event_whenstageclicked: {},
    event_whenkeypressed: {fields: {KEY_OPTION: 'space'}},
    event_whenbroadcastreceived: {fields: {BROADCAST_OPTION: {broadcast: true, value: 'message1'}}},
    event_whengreaterthan: {
        inputs: {VALUE: NUM},
        fields: {WHENGREATERTHANMENU: 'LOUDNESS'}
    },
    event_whenbackdropswitchesto: {fields: {BACKDROP: 'backdrop1'}},
    event_broadcast: {inputs: {BROADCAST_INPUT: menu('event_broadcast_menu', 'BROADCAST_OPTION', 'message1')}},
    event_broadcastandwait: {inputs: {BROADCAST_INPUT: menu('event_broadcast_menu', 'BROADCAST_OPTION', 'message1')}},

    /* ------------------------------------------------------------------ Motion */
    motion_movesteps: {inputs: {STEPS: NUM}},
    motion_turnright: {inputs: {DEGREES: NUM}},
    motion_turnleft: {inputs: {DEGREES: NUM}},
    motion_goto: {inputs: {TO: menu('motion_goto_menu', 'TO', '_random_')}},
    motion_gotoxy: {inputs: {X: NUM, Y: NUM}},
    motion_glideto: {inputs: {SECS: NUM, TO: menu('motion_glideto_menu', 'TO', '_random_')}},
    motion_glidesecstoxy: {inputs: {SECS: NUM, X: NUM, Y: NUM}},
    motion_pointindirection: {inputs: {DIRECTION: ANGLE}},
    motion_pointtowards: {inputs: {TOWARDS: menu('motion_pointtowards_menu', 'TOWARDS', '_mouse_')}},
    motion_changexby: {inputs: {DX: NUM}},
    motion_setx: {inputs: {X: NUM}},
    motion_changeyby: {inputs: {DY: NUM}},
    motion_sety: {inputs: {Y: NUM}},
    motion_ifonedgebounce: {},
    motion_setrotationstyle: {fields: {STYLE: 'left-right'}},
    motion_xposition: {},
    motion_yposition: {},
    motion_direction: {},

    /* ------------------------------------------------------------------ Looks */
    motion_align_scene: {fields: {ALIGNMENT: 'bottom-left'}},
    looks_say: {inputs: {MESSAGE: TEXT}},
    looks_sayforsecs: {inputs: {MESSAGE: TEXT, SECS: NUM}},
    looks_think: {inputs: {MESSAGE: TEXT}},
    looks_thinkforsecs: {inputs: {MESSAGE: TEXT, SECS: NUM}},
    looks_switchcostumeto: {inputs: {COSTUME: menu('looks_costume', 'COSTUME')}},
    looks_nextcostume: {},
    looks_switchbackdropto: {inputs: {BACKDROP: menu('looks_backdrops', 'BACKDROP')}},
    looks_nextbackdrop: {},
    looks_changesizeby: {inputs: {CHANGE: NUM}},
    looks_setsizeto: {inputs: {SIZE: NUM}},
    looks_changeeffectby: {inputs: {CHANGE: NUM}, fields: {EFFECT: 'COLOR'}},
    looks_seteffectto: {inputs: {VALUE: NUM}, fields: {EFFECT: 'COLOR'}},
    looks_cleargraphiceffects: {},
    looks_show: {},
    looks_hide: {},
    looks_gotofrontback: {fields: {FRONT_BACK: 'front'}},
    looks_goforwardbackwardlayers: {inputs: {NUM: WHOLE}, fields: {FORWARD_BACKWARD: 'forward'}},
    looks_costumenumbername: {fields: {NUMBER_NAME: 'number'}},
    looks_backdropnumbername: {fields: {NUMBER_NAME: 'number'}},
    looks_size: {},

    /* ------------------------------------------------------------------ Sound */
    sound_play: {inputs: {SOUND_MENU: menu('sound_sounds_menu', 'SOUND_MENU')}},
    sound_playuntildone: {inputs: {SOUND_MENU: menu('sound_sounds_menu', 'SOUND_MENU')}},
    sound_stopallsounds: {},
    sound_changeeffectby: {inputs: {VALUE: NUM}, fields: {EFFECT: 'PITCH'}},
    sound_seteffectto: {inputs: {VALUE: NUM}, fields: {EFFECT: 'PITCH'}},
    sound_cleareffects: {},
    sound_changevolumeby: {inputs: {VOLUME: NUM}},
    sound_setvolumeto: {inputs: {VOLUME: NUM}},
    sound_volume: {},

    /* ------------------------------------------------------------------ Control */
    control_wait: {inputs: {DURATION: POSITIVE}},
    control_repeat: {inputs: {TIMES: WHOLE, SUBSTACK: BRANCH}},
    control_forever: {inputs: {SUBSTACK: BRANCH}},
    control_if: {inputs: {CONDITION: BOOL, SUBSTACK: BRANCH}},
    control_if_else: {inputs: {CONDITION: BOOL, SUBSTACK: BRANCH, SUBSTACK2: BRANCH}},
    control_wait_until: {inputs: {CONDITION: BOOL}},
    control_repeat_until: {inputs: {CONDITION: BOOL, SUBSTACK: BRANCH}},
    control_stop: {fields: {STOP_OPTION: 'all'}},
    control_start_as_clone: {},
    control_create_clone_of: {inputs: {CLONE_OPTION: menu('control_create_clone_of_menu', 'CLONE_OPTION', '_myself_')}},
    control_delete_this_clone: {},

    /* ------------------------------------------------------------------ Sensing */
    sensing_touchingobject: {inputs: {TOUCHINGOBJECTMENU: menu('sensing_touchingobjectmenu', 'TOUCHINGOBJECTMENU', '_edge_')}},
    sensing_touchingcolor: {inputs: {COLOR: {shadow: 'colour_picker', field: 'COLOUR'}}},
    sensing_coloristouchingcolor: {
        inputs: {
            COLOR: {shadow: 'colour_picker', field: 'COLOUR'},
            COLOR2: {shadow: 'colour_picker', field: 'COLOUR'}
        }
    },
    sensing_distanceto: {inputs: {DISTANCETOMENU: menu('sensing_distancetomenu', 'DISTANCETOMENU', '_mouse_')}},
    sensing_askandwait: {inputs: {QUESTION: TEXT}},
    sensing_answer: {},
    sensing_keypressed: {inputs: {KEY_OPTION: menu('sensing_keyoptions', 'KEY_OPTION', 'space')}},
    sensing_mousedown: {},
    sensing_mousex: {},
    sensing_mousey: {},
    sensing_timer: {},
    sensing_resettimer: {},
    sensing_of: {inputs: {OBJECT: menu('sensing_of_object_menu', 'OBJECT', '_stage_')}, fields: {PROPERTY: 'x position'}},
    sensing_current: {fields: {CURRENTMENU: 'YEAR'}},
    sensing_dayssince2000: {},
    sensing_username: {},
    sensing_loudness: {},

    /* ------------------------------------------------------------------ Operators */
    operator_add: {inputs: {NUM1: NUM, NUM2: NUM}},
    operator_subtract: {inputs: {NUM1: NUM, NUM2: NUM}},
    operator_multiply: {inputs: {NUM1: NUM, NUM2: NUM}},
    operator_divide: {inputs: {NUM1: NUM, NUM2: NUM}},
    operator_random: {inputs: {FROM: NUM, TO: NUM}},
    operator_gt: {inputs: {OPERAND1: TEXT, OPERAND2: TEXT}},
    operator_lt: {inputs: {OPERAND1: TEXT, OPERAND2: TEXT}},
    operator_equals: {inputs: {OPERAND1: TEXT, OPERAND2: TEXT}},
    operator_and: {inputs: {OPERAND1: BOOL, OPERAND2: BOOL}},
    operator_or: {inputs: {OPERAND1: BOOL, OPERAND2: BOOL}},
    operator_not: {inputs: {OPERAND: BOOL}},
    operator_join: {inputs: {STRING1: TEXT, STRING2: TEXT}},
    operator_letter_of: {inputs: {LETTER: WHOLE, STRING: TEXT}},
    operator_length: {inputs: {STRING: TEXT}},
    operator_contains: {inputs: {STRING1: TEXT, STRING2: TEXT}},
    operator_mod: {inputs: {NUM1: NUM, NUM2: NUM}},
    operator_round: {inputs: {NUM: NUM}},
    operator_mathop: {inputs: {NUM: NUM}, fields: {OPERATOR: 'abs'}},

    /* ------------------------------------------------------------------ Variables */
    data_variable: {fields: {VARIABLE: {variable: true, value: 'ma variable'}}},
    data_setvariableto: {
        inputs: {VALUE: TEXT},
        fields: {VARIABLE: {variable: true, value: 'ma variable'}}
    },
    data_changevariableby: {
        inputs: {VALUE: NUM},
        fields: {VARIABLE: {variable: true, value: 'ma variable'}}
    },
    data_showvariable: {fields: {VARIABLE: {variable: true, value: 'ma variable'}}},
    data_hidevariable: {fields: {VARIABLE: {variable: true, value: 'ma variable'}}},

    /* ------------------------------------------------------------------ Lists */
    data_listcontents: {fields: {LIST}},
    data_addtolist: {inputs: {ITEM: TEXT}, fields: {LIST}},
    data_deleteoflist: {inputs: {INDEX: INTEGER}, fields: {LIST}},
    data_deletealloflist: {fields: {LIST}},
    data_insertatlist: {inputs: {ITEM: TEXT, INDEX: INTEGER}, fields: {LIST}},
    data_replaceitemoflist: {inputs: {INDEX: INTEGER, ITEM: TEXT}, fields: {LIST}},
    data_itemoflist: {inputs: {INDEX: INTEGER}, fields: {LIST}},
    data_itemnumoflist: {inputs: {ITEM: TEXT}, fields: {LIST}},
    data_lengthoflist: {fields: {LIST}},
    data_listcontainsitem: {inputs: {ITEM: TEXT}, fields: {LIST}},
    data_showlist: {fields: {LIST}},
    data_hidelist: {fields: {LIST}}
};

/**
 * Fallback used when an opcode is unknown (custom / extension blocks):
 * guess the shadow type from the input name.
 */
const INPUT_NAME_FALLBACK = {
    STEPS: NUM, X: NUM, Y: NUM, DX: NUM, DY: NUM, DEGREES: NUM, DIRECTION: ANGLE,
    SECS: NUM, SIZE: NUM, CHANGE: NUM, VALUE: TEXT, DURATION: POSITIVE, TIMES: WHOLE,
    NUM: NUM, NUM1: NUM, NUM2: NUM, FROM: NUM, TO: NUM, VOLUME: NUM,
    MESSAGE: TEXT, QUESTION: TEXT, STRING: TEXT, STRING1: TEXT, STRING2: TEXT,
    OPERAND: BOOL, OPERAND1: TEXT, OPERAND2: TEXT, CONDITION: BOOL,
    SUBSTACK: BRANCH, SUBSTACK2: BRANCH,
    ITEM: TEXT, INDEX: INTEGER, LETTER: WHOLE
};

/**
 * Resolves the descriptor of an input for a given opcode.
 * @param {string} opcode block opcode
 * @param {string} inputName input name
 * @returns {object} descriptor
 */
const getInputSchema = (opcode, inputName) => {
    const schema = BLOCK_SCHEMA[opcode];
    if (schema && schema.inputs && schema.inputs[inputName]) {
        return schema.inputs[inputName];
    }
    if (inputName === 'SUBSTACK' || inputName === 'SUBSTACK2') return BRANCH;
    return INPUT_NAME_FALLBACK[inputName] || TEXT;
};

/**
 * Returns the default fields of an opcode (KEY_OPTION, STOP_OPTION, ...).
 * @param {string} opcode block opcode
 * @returns {object} fields map
 */
const getDefaultFields = opcode => {
    const schema = BLOCK_SCHEMA[opcode];
    return (schema && schema.fields) || {};
};

/**
 * Returns the default inputs of an opcode, so that every editable slot always
 * gets its shadow block even when the AI did not provide a value.
 * @param {string} opcode block opcode
 * @returns {object} inputs map
 */
const getDefaultInputs = opcode => {
    const schema = BLOCK_SCHEMA[opcode];
    return (schema && schema.inputs) || {};
};

const isKnownOpcode = opcode => Object.prototype.hasOwnProperty.call(BLOCK_SCHEMA, opcode);

export {
    BLOCK_SCHEMA,
    getInputSchema,
    getDefaultFields,
    getDefaultInputs,
    isKnownOpcode
};
