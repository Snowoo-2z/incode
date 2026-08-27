import {parseDSL, parseCall, resolveOpcode, getParamOrder} from '../../../src/lib/ai-agent/dsl-parser';
import {buildScript} from '../../../src/lib/ai-agent/block-builder';

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

const assertNoDanglingRefs = blocks => {
    const byId = Object.fromEntries(blocks.map(b => [b.id, b]));
    for (const b of blocks) {
        for (const input of Object.values(b.inputs)) {
            if (input.block) expect(byId[input.block]).toBeDefined();
            if (input.shadow) expect(byId[input.shadow]).toBeDefined();
        }
        if (b.next) expect(byId[b.next]).toBeDefined();
    }
};

describe('DSL parser — resolveOpcode', () => {
    test('resolves aliases, symbols and raw opcodes', () => {
        expect(resolveOpcode('move')).toBe('motion_movesteps');
        expect(resolveOpcode('say')).toBe('looks_say');
        expect(resolveOpcode('+')).toBe('operator_add');
        expect(resolveOpcode('>')).toBe('operator_gt');
        expect(resolveOpcode('motion_gotoxy')).toBe('motion_gotoxy');
    });

    test('suffix collisions: looks wins the bare name, sound needs its alias', () => {
        expect(resolveOpcode('changeeffectby')).toBe('looks_changeeffectby');
        expect(resolveOpcode('changesoundeffect')).toBe('sound_changeeffectby');
    });
});

describe('DSL parser — parseCall', () => {
    test('maps positional args to the schema input order', () => {
        expect(parseCall('move 10')).toEqual({opcode: 'motion_movesteps', inputs: {STEPS: 10}});
        expect(parseCall('gotoxy 0 0')).toEqual({opcode: 'motion_gotoxy', inputs: {X: 0, Y: 0}});
    });

    test('keeps quoted strings intact', () => {
        expect(parseCall('say "Bonjour le monde"'))
            .toEqual({opcode: 'looks_say', inputs: {MESSAGE: 'Bonjour le monde'}});
    });

    test('routes variable name then value for set/change', () => {
        // An unquoted word is marked as a variable reference; block-builder
        // resolves it against the real VM (and falls back on a literal).
        expect(parseCall('set score 0'))
            .toEqual({
                opcode: 'data_setvariableto',
                inputs: {VARIABLE: {__variable: 'score'}, VALUE: 0}
            });
    });

    test('parses nested reporters in parentheses', () => {
        expect(parseCall('change score (random 1 10)')).toEqual({
            opcode: 'data_changevariableby',
            inputs: {
                VARIABLE: {__variable: 'score'},
                VALUE: {opcode: 'operator_random', inputs: {FROM: 1, TO: 10}}
            }
        });
    });

    test('accepts named arguments', () => {
        expect(parseCall('gotoxy Y=50 X=10'))
            .toEqual({opcode: 'motion_gotoxy', inputs: {X: 10, Y: 50}});
    });

    test('negative numbers are numeric', () => {
        expect(parseCall('point -90')).toEqual({opcode: 'motion_pointindirection', inputs: {DIRECTION: -90}});
    });
});

describe('DSL parser — getParamOrder', () => {
    test('lists inputs then fields, excluding branches', () => {
        expect(getParamOrder('control_repeat')).toEqual(['TIMES']);
        expect(getParamOrder('motion_gotoxy')).toEqual(['X', 'Y']);
    });
});

describe('DSL parser — programs', () => {
    test('emits declarations, sprite and a script with nested branches', () => {
        const actions = parseDSL([
            'var score = 0',
            'sprite Balle 0 0:',
            '  whenflagclicked',
            '  gotoxy 0 0',
            '  forever:',
            '    move 10',
            '    if (touching _edge_):',
            '      change score 1'
        ].join('\n'));

        expect(actions[0]).toEqual({type: 'CREATE_VAR', name: 'score', value: 0});
        expect(actions[1]).toEqual({type: 'CREATE_SPRITE', name: 'Balle', x: 0, y: 0});

        const script = actions.find(a => a.type === 'ADD_SCRIPT');
        expect(script.sprite).toBe('Balle');
        expect(script.blocks[0].opcode).toBe('event_whenflagclicked');

        const forever = script.blocks[2];
        expect(forever.opcode).toBe('control_forever');
        const ifBlock = forever.inputs.SUBSTACK[1];
        expect(ifBlock.opcode).toBe('control_if');
        expect(ifBlock.inputs.CONDITION.opcode).toBe('sensing_touchingobject');
        expect(ifBlock.inputs.SUBSTACK[0].opcode).toBe('data_changevariableby');
    });

    test('turns if/else into control_if_else with two branches', () => {
        const actions = parseDSL([
            'sprite S:',
            '  whenflagclicked',
            '  if (mousedown):',
            '    say "clic"',
            '  else:',
            '    say "rien"'
        ].join('\n'));
        const script = actions.find(a => a.type === 'ADD_SCRIPT');
        const ifElse = script.blocks[1];
        expect(ifElse.opcode).toBe('control_if_else');
        expect(ifElse.inputs.SUBSTACK[0].inputs.MESSAGE).toBe('clic');
        expect(ifElse.inputs.SUBSTACK2[0].inputs.MESSAGE).toBe('rien');
    });

    test('splits a sprite body into several scripts on hats and blank lines', () => {
        const actions = parseDSL([
            'sprite S:',
            '  whenflagclicked',
            '  move 10',
            '  whenclicked',
            '  say "hi"'
        ].join('\n'));
        expect(actions.filter(a => a.type === 'ADD_SCRIPT')).toHaveLength(2);
    });

    test('strips a surrounding markdown code fence', () => {
        const answer = 'Voici :\n```scratch\nsprite Chat:\n  whenflagclicked\n  say "Salut"\n```\nVoilà !';
        const actions = parseDSL(answer);
        expect(actions.find(a => a.type === 'CREATE_SPRITE').name).toBe('Chat');
        expect(actions.find(a => a.type === 'ADD_SCRIPT')).toBeDefined();
    });

    test('creates a list from a comma-separated tail', () => {
        const actions = parseDSL('list courses = pommes, lait, pain');
        expect(actions[0]).toEqual({type: 'CREATE_LIST', name: 'courses', value: ['pommes', 'lait', 'pain']});
    });

    test('ignores comments', () => {
        const actions = parseDSL([
            '# ceci est un commentaire',
            'sprite S:',
            '  whenflagclicked',
            '  // encore un commentaire',
            '  move 5'
        ].join('\n'));
        const script = actions.find(a => a.type === 'ADD_SCRIPT');
        expect(script.blocks).toHaveLength(2);
    });
});

describe('DSL parser — targeted edit directives', () => {
    test('parses edit / delete / insert / replace under "on Sprite:"', () => {
        const actions = parseDSL([
            'on Balle:',
            '  edit 1/3.1 move 25',
            '  delete 1/2',
            '  insert after 1/1:',
            '    say "Go"',
            '  insert into 1/3:',
            '    bounce',
            '  replace 1/4:',
            '    think "hmm"',
            '    show'
        ].join('\n'));

        expect(actions.map(a => a.type)).toEqual([
            'UPDATE_BLOCK', 'DELETE_BLOCK', 'INSERT_BLOCKS', 'INSERT_BLOCKS', 'REPLACE_BLOCK'
        ]);
        // "on" selects an existing sprite: no CREATE_SPRITE emitted.
        expect(actions.some(a => a.type === 'CREATE_SPRITE')).toBe(false);
        expect(actions.every(a => a.sprite === 'Balle')).toBe(true);

        expect(actions[0]).toEqual({
            type: 'UPDATE_BLOCK', address: '1/3.1', sprite: 'Balle',
            opcode: 'motion_movesteps', inputs: {STEPS: 25}
        });
        expect(actions[2].position).toBe('after');
        expect(actions[2].blocks[0].opcode).toBe('looks_say');
        expect(actions[3].position).toBe('into');
        expect(actions[4].blocks.map(b => b.opcode)).toEqual(['looks_think', 'looks_show']);
    });

    test('supports insert before/into2 and del alias', () => {
        const actions = parseDSL([
            'on S:',
            '  insert before 1/1:',
            '    wait 1',
            '  insert into2 1/2:',
            '    say "else"',
            '  del 1/3'
        ].join('\n'));
        expect(actions[0].position).toBe('before');
        expect(actions[1].position).toBe('into2');
        expect(actions[2].type).toBe('DELETE_BLOCK');
    });
});

describe('DSL parser — confidence guard', () => {
    test('does not swallow the legacy uppercase CLI commands', () => {
        expect(parseDSL('CREATE_SPRITE Foo 0 0')).toEqual([]);
    });

    test('does not swallow arbitrary prose', () => {
        expect(parseDSL('Bonjour, peux-tu créer un jeu de plateforme pour moi ?')).toEqual([]);
    });
});

describe('DSL parser — end-to-end into the block builder', () => {
    test('produces fully hydrated blocks with no dangling references', () => {
        const actions = parseDSL([
            'sprite Balle:',
            '  whenflagclicked',
            '  gotoxy 0 0',
            '  point 45',
            '  forever:',
            '    move 10',
            '    bounce',
            '    if (touching _edge_):',
            '      change score 1'
        ].join('\n'));
        const script = actions.find(a => a.type === 'ADD_SCRIPT');
        const blocks = buildScript(script.blocks, 0, 0, makeContext());
        expect(blocks.length).toBeGreaterThan(0);
        assertNoDanglingRefs(blocks);
    });
});
