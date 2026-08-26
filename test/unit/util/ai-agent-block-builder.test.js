import {buildScript, findUnknownOpcodes} from '../../../src/lib/ai-agent/block-builder';

const makeContext = () => {
    const stage = {
        isStage: true,
        variables: {},
        lookupVariableByNameAndType (name, type) {
            return Object.values(this.variables).find(v => v.name === name && v.type === type) || null;
        },
        lookupBroadcastMsg (id, name) {
            return Object.values(this.variables).find(v => v.name === name) || null;
        },
        createVariable (id, name, type) {
            this.variables[id] = {id, name, type, value: 0};
        },
        getCostumes: () => [{name: 'backdrop1'}]
    };
    const target = {
        id: 'sprite1',
        isStage: false,
        lookupVariableByNameAndType: () => null,
        getCostumes: () => [{name: 'costume1'}],
        getSounds: () => [{name: 'Meow'}]
    };
    return {vm: {runtime: {getTargetForStage: () => stage}}, target, stage};
};

/**
 * Asserts every id referenced by the blocks actually exists.
 * @param {Array<object>} blocks built blocks
 */
const expectConsistent = blocks => {
    const byId = Object.fromEntries(blocks.map(b => [b.id, b]));
    for (const block of blocks) {
        if (block.parent) expect(byId[block.parent]).toBeDefined();
        if (block.next) expect(byId[block.next]).toBeDefined();
        for (const [name, input] of Object.entries(block.inputs)) {
            expect(input.name).toBe(name);
            if (input.block) expect(byId[input.block]).toBeDefined();
            if (input.shadow) expect(byId[input.shadow]).toBeDefined();
        }
        for (const [name, field] of Object.entries(block.fields)) {
            expect(field.name).toBe(name);
            expect(typeof field.value).toBe('string');
        }
    }
};

describe('ai-agent block builder', () => {
    test('creates hydrated blocks, not the sb3 serialized format', () => {
        const context = makeContext();
        const blocks = buildScript([
            {opcode: 'event_whenflagclicked'},
            {opcode: 'motion_gotoxy', inputs: {X: -200, Y: 0}}
        ], 60, 60, context);

        const top = blocks.find(b => b.topLevel);
        expect(top.opcode).toBe('event_whenflagclicked');
        expect(top.x).toBe(60);
        expect(top.y).toBe(60);

        const gotoxy = blocks.find(b => b.opcode === 'motion_gotoxy');
        // Hydrated format: {name, block, shadow} — NOT [1, [4, "-200"]]
        expect(gotoxy.inputs.X).toEqual({
            name: 'X',
            block: expect.any(String),
            shadow: expect.any(String)
        });
        expectConsistent(blocks);
    });

    test('creates the shadow block of every editable slot', () => {
        const context = makeContext();
        const blocks = buildScript([
            {opcode: 'motion_movesteps', inputs: {STEPS: 10}},
            {opcode: 'looks_say', inputs: {MESSAGE: 'Bonjour'}},
            {opcode: 'motion_pointindirection', inputs: {DIRECTION: 45}}
        ], 0, 0, context);

        const byId = Object.fromEntries(blocks.map(b => [b.id, b]));
        const steps = blocks.find(b => b.opcode === 'motion_movesteps');
        const stepsShadow = byId[steps.inputs.STEPS.block];
        expect(stepsShadow.opcode).toBe('math_number');
        expect(stepsShadow.shadow).toBe(true);
        expect(stepsShadow.fields.NUM.value).toBe('10');

        const say = blocks.find(b => b.opcode === 'looks_say');
        expect(byId[say.inputs.MESSAGE.block].opcode).toBe('text');
        expect(byId[say.inputs.MESSAGE.block].fields.TEXT.value).toBe('Bonjour');

        const point = blocks.find(b => b.opcode === 'motion_pointindirection');
        expect(byId[point.inputs.DIRECTION.block].opcode).toBe('math_angle');
    });

    test('fills omitted inputs with default shadows', () => {
        const context = makeContext();
        const blocks = buildScript([{opcode: 'motion_gotoxy'}], 0, 0, context);
        const gotoxy = blocks.find(b => b.opcode === 'motion_gotoxy');
        expect(gotoxy.inputs.X).toBeDefined();
        expect(gotoxy.inputs.Y).toBeDefined();
        expectConsistent(blocks);
    });

    test('builds dropdown menus as real menu shadow blocks', () => {
        const context = makeContext();
        const blocks = buildScript([
            {opcode: 'sensing_keypressed', key: 'w'},
            {opcode: 'sensing_touchingobject', target: 'Paddle1'},
            {opcode: 'looks_switchcostumeto'}
        ], 0, 0, context);
        const byId = Object.fromEntries(blocks.map(b => [b.id, b]));

        const key = blocks.find(b => b.opcode === 'sensing_keypressed');
        const keyMenu = byId[key.inputs.KEY_OPTION.block];
        expect(keyMenu.opcode).toBe('sensing_keyoptions');
        expect(keyMenu.fields.KEY_OPTION.value).toBe('w');

        const touching = blocks.find(b => b.opcode === 'sensing_touchingobject');
        expect(byId[touching.inputs.TOUCHINGOBJECTMENU.block].fields.TOUCHINGOBJECTMENU.value).toBe('Paddle1');

        // Costume menu falls back on the sprite's first real costume.
        const costume = blocks.find(b => b.opcode === 'looks_switchcostumeto');
        expect(byId[costume.inputs.COSTUME.block].fields.COSTUME.value).toBe('costume1');
    });

    test('links branches and nested reporters', () => {
        const context = makeContext();
        const blocks = buildScript([
            {
                opcode: 'control_forever',
                inputs: {
                    SUBSTACK: [
                        {
                            opcode: 'control_if',
                            inputs: {
                                CONDITION: {
                                    opcode: 'operator_gt',
                                    inputs: {OPERAND1: {opcode: 'motion_xposition'}, OPERAND2: 230}
                                },
                                SUBSTACK: [{opcode: 'motion_changeyby', inputs: {DY: 10}}]
                            }
                        }
                    ]
                }
            }
        ], 0, 0, context);
        const byId = Object.fromEntries(blocks.map(b => [b.id, b]));

        const forever = blocks.find(b => b.opcode === 'control_forever');
        const branchHead = byId[forever.inputs.SUBSTACK.block];
        expect(branchHead.opcode).toBe('control_if');
        // Branches never have a shadow.
        expect(forever.inputs.SUBSTACK.shadow).toBeNull();

        const condition = byId[branchHead.inputs.CONDITION.block];
        expect(condition.opcode).toBe('operator_gt');
        expect(branchHead.inputs.CONDITION.shadow).toBeNull();
        // A reporter dropped in a value slot keeps the obscured shadow.
        expect(condition.inputs.OPERAND1.block).not.toBe(condition.inputs.OPERAND1.shadow);
        expectConsistent(blocks);
    });

    test('creates the referenced variables on the stage', () => {
        const context = makeContext();
        buildScript([
            {opcode: 'data_setvariableto', variable: 'score1', inputs: {VALUE: 0}},
            {opcode: 'data_changevariableby', variable: 'score1', inputs: {VALUE: 1}}
        ], 0, 0, context);

        const names = Object.values(context.stage.variables).map(v => v.name);
        expect(names).toContain('score1');
        // The same variable must be reused, not duplicated.
        expect(names.filter(n => n === 'score1')).toHaveLength(1);
    });

    test('gives control_stop the mutation scratch-blocks expects', () => {
        const context = makeContext();
        const blocks = buildScript([{opcode: 'control_stop', fields: {STOP_OPTION: 'all'}}], 0, 0, context);
        const stop = blocks.find(b => b.opcode === 'control_stop');
        expect(stop.mutation).toEqual({tagName: 'mutation', hasnext: 'false', children: []});
    });

    test('reports opcodes that do not exist in the palette', () => {
        expect(findUnknownOpcodes([
            {opcode: 'motion_movesteps'},
            {opcode: 'motion_teleport_to_the_moon'}
        ])).toEqual(['motion_teleport_to_the_moon']);
    });
});
