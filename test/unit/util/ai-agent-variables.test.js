import {parseDSL} from '../../../src/lib/ai-agent/dsl-parser';
import {buildScript, lookupVariableId} from '../../../src/lib/ai-agent/block-builder';
import {interpretAndExecute} from '../../../src/lib/ai-agent/code-interpreter';

/**
 * The AI writes `set py (+ py 1)`. `py` is an UNQUOTED word, so it must become a
 * variable reporter inside the green operator; putting the text "py" there made
 * Scratch display "py + 1" and compute 0 + 1.
 */

class FakeTarget {
    constructor (name, {isStage = false} = {}) {
        this.id = `id-${name}`;
        this.name = name;
        this.isStage = isStage;
        this.variables = {};
        this.blocks = {_blocks: {}, getScripts: () => [], createBlock () {}, deleteBlock () {}};
        this.sprite = {costumes: [{name: 'costume1'}]};
    }

    getName () {
        return this.name;
    }

    getCostumes () {
        return this.sprite.costumes;
    }

    lookupVariableByNameAndType (name, type) {
        return Object.values(this.variables).find(v => v.name === name && v.type === type) || null;
    }

    createVariable (id, name, type) {
        this.variables[id] = {id, name, type, value: 0};
    }
}

const makeVM = () => {
    const stage = new FakeTarget('Scène', {isStage: true});
    const sprite = new FakeTarget('Sprite1');
    stage.createVariable('var-px', 'px', '');
    stage.createVariable('var-py', 'py', '');
    stage.createVariable('var-speed', 'speed', '');
    const vm = {
        runtime: {
            targets: [stage, sprite],
            getTargetForStage: () => stage,
            emitProjectChanged: () => {},
            requestBlocksUpdate: () => {}
        },
        editingTarget: sprite,
        emitTargetsUpdate: () => {},
        refreshWorkspace: () => {},
        shareBlocksToTarget: blocks => {
            for (const b of blocks) sprite.blocks._blocks[b.id] = b;
            return Promise.resolve();
        }
    };
    return {vm, stage, sprite};
};

/** Finds a block by opcode in a flat hydrated list. */
const byOpcode = (blocks, opcode) => blocks.filter(b => b.opcode === opcode);

describe('bare words become variable reporters', () => {
    test('the DSL marks an unquoted word and keeps quoted text as text', () => {
        const actions = parseDSL(`
sprite Sprite1 0 0:
  whenflag
  set py (+ py 1)
  say "py"
`);
        const script = actions.find(a => a.type === 'ADD_SCRIPT');
        const setVar = script.blocks.find(b => b.opcode === 'data_setvariableto');
        expect(setVar.inputs.VALUE).toMatchObject({
            opcode: 'operator_add',
            inputs: {NUM1: {__variable: 'py'}, NUM2: 1}
        });
        const say = script.blocks.find(b => b.opcode === 'looks_say');
        expect(say.inputs.MESSAGE).toBe('py'); // quoted -> literal text
    });

    test('(+ py 1) builds a variable reporter instead of the text "py"', () => {
        const {vm, sprite} = makeVM();
        const actions = parseDSL(`
sprite Sprite1 0 0:
  whenflag
  set py (+ py 1)
`);
        const script = actions.find(a => a.type === 'ADD_SCRIPT');
        const blocks = buildScript(script.blocks, 0, 0, {vm, target: sprite});

        const add = byOpcode(blocks, 'operator_add');
        expect(add).toHaveLength(1);
        const num1 = add[0].inputs.NUM1;
        // A reporter obscuring its numeric shadow, exactly like in the editor.
        expect(num1.block).not.toBe(num1.shadow);
        const reporter = blocks.find(b => b.id === num1.block);
        expect(reporter.opcode).toBe('data_variable');
        expect(reporter.fields.VARIABLE).toMatchObject({value: 'py', id: 'var-py'});
        expect(blocks.find(b => b.id === num1.shadow).opcode).toBe('math_number');
    });

    test('an unknown bare word stays a literal and creates no variable', () => {
        const {vm, sprite, stage} = makeVM();
        const actions = parseDSL(`
sprite Sprite1 0 0:
  whenflag
  say hello
`);
        const script = actions.find(a => a.type === 'ADD_SCRIPT');
        const blocks = buildScript(script.blocks, 0, 0, {vm, target: sprite});

        const say = byOpcode(blocks, 'looks_say')[0];
        const text = blocks.find(b => b.id === say.inputs.MESSAGE.block);
        expect(text.opcode).toBe('text');
        expect(text.fields.TEXT.value).toBe('hello');
        expect(Object.values(stage.variables).map(v => v.name)).not.toContain('hello');
    });

    test('menu slots keep working (_edge_, key names, mathop operator)', () => {
        const {vm, sprite} = makeVM();
        const actions = parseDSL(`
sprite Sprite1 0 0:
  whenflag
  set speed (* (mathop "cos" px) speed)
  if (touching _edge_):
    bounce
`);
        const script = actions.find(a => a.type === 'ADD_SCRIPT');
        const blocks = buildScript(script.blocks, 0, 0, {vm, target: sprite});

        const mathop = byOpcode(blocks, 'operator_mathop')[0];
        // OPERATOR is a FIELD of operator_mathop (not a menu input).
        expect(mathop.fields.OPERATOR.value).toBe('cos');
        // "speed" is a real variable -> reporter inside the operator
        const numReporter = blocks.find(b => b.id === mathop.inputs.NUM.block);
        expect(numReporter.opcode).toBe('data_variable');

        const touching = byOpcode(blocks, 'sensing_touchingobject')[0];
        const touchingMenu = blocks.find(b => b.id === touching.inputs.TOUCHINGOBJECTMENU.block);
        expect(touchingMenu.fields.TOUCHINGOBJECTMENU.value).toBe('_edge_');
    });

    test('nested expressions resolve every variable level', () => {
        const {vm, sprite} = makeVM();
        const actions = parseDSL(`
sprite Sprite1 0 0:
  whenflag
  set px (+ px (* speed 2))
`);
        const script = actions.find(a => a.type === 'ADD_SCRIPT');
        const blocks = buildScript(script.blocks, 0, 0, {vm, target: sprite});
        const reporters = byOpcode(blocks, 'data_variable').map(b => b.fields.VARIABLE.value);
        expect(reporters.sort()).toEqual(['px', 'speed']);
        expect(byOpcode(blocks, 'operator_multiply')).toHaveLength(1);
    });

    test('lookupVariableId never creates the variable it looks for', () => {
        const {vm, sprite, stage} = makeVM();
        expect(lookupVariableId('py', {vm, target: sprite})).toBe('var-py');
        expect(lookupVariableId('nope', {vm, target: sprite})).toBeNull();
        expect(Object.keys(stage.variables)).toHaveLength(3);
    });
});

describe('declarations keep quoted values as text', () => {
    test('a quoted digit string is NOT turned into a number', () => {
        const actions = parseDSL(`
var map_data = "1111111110000001101101011001000110000101101000011000020111111111"
var wall_type = "0"
var speed = 0.08
var count = 3
`);
        const byName = Object.fromEntries(actions.map(a => [a.name, a.value]));
        expect(byName.map_data).toBe('1111111110000001101101011001000110000101101000011000020111111111');
        expect(byName.wall_type).toBe('0');
        expect(byName.speed).toBe(0.08);
        expect(byName.count).toBe(3);
    });

    test('a quoted comma stays inside the string, an unquoted one splits a list', () => {
        const single = parseDSL('var csv = "a,b"');
        expect(single[0].value).toBe('a,b');

        const list = parseDSL('list inventory = "sword", "shield", 3');
        expect(list[0]).toMatchObject({type: 'CREATE_LIST', name: 'inventory'});
        expect(list[0].value).toEqual(['sword', 'shield', '3']);
    });

    test('the value reaches the VM as text, so letterof reads the map', async () => {
        const {vm, stage} = makeVM();
        await interpretAndExecute('var map_data = "1101"\nvar wall_type = "0"', vm);
        expect(stage.variables['var-px']).toBeDefined(); // untouched
        const map = Object.values(stage.variables).find(v => v.name === 'map_data');
        expect(map.value).toBe('1101');
        expect(typeof map.value).toBe('string');
    });
});

describe('end to end on the VM', () => {
    test('the raycaster pattern executes and stores variable reporters', async () => {
        const {vm, sprite, stage} = makeVM();
        const report = await interpretAndExecute(`
var px = 1.5
var py = 1.5
var speed = 0.08
sprite Sprite1 0 0:
  whenflag
  forever:
    set py (+ py speed)
    set px (- px speed)
`, vm);

        expect(report.success).toBe(true);
        expect(stage.variables['var-px'].value).toBe(1.5);
        const built = Object.values(sprite.blocks._blocks);
        expect(byOpcode(built, 'data_variable').map(b => b.fields.VARIABLE.value).sort())
            .toEqual(['px', 'py', 'speed', 'speed'].sort());
        // the "set [X] to ..." blocks point at the right variable, not at "undefined"
        const setters = byOpcode(built, 'data_setvariableto').map(b => b.fields.VARIABLE);
        expect(setters.map(f => f.value).sort()).toEqual(['px', 'py']);
        expect(setters.every(f => f.id && f.id.startsWith('var-'))).toBe(true);
        expect(Object.values(stage.variables).map(v => v.name)).not.toContain('undefined');
        // no numeric shadow was filled with the text "px" / "py"
        const numericTexts = byOpcode(built, 'math_number').map(b => b.fields.NUM.value);
        expect(numericTexts).not.toContain('px');
        expect(numericTexts).not.toContain('py');
    });
});
