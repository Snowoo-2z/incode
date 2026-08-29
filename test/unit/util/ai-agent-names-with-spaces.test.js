/**
 * Names containing SPACES ("Ma Balle", "mon score", "visage joyeux"...).
 *
 * Scratch names are free text, but the DSL separates arguments with spaces, so
 * every name position of the language has to accept a quoted multi-word name —
 * and, when the meaning is unambiguous, an unquoted one too. These tests cover
 * the whole path: the parser, the block builder, the agent tools, the addressed
 * listing the AI reads back, and the legacy line commands.
 */
import Runtime from 'scratch-vm/src/engine/runtime';
import Blocks from 'scratch-vm/src/engine/blocks';

import {parseDSL, parseCall} from '../../../src/lib/ai-agent/dsl-parser';
import {buildScript} from '../../../src/lib/ai-agent/block-builder';
import {parseLineCommands} from '../../../src/lib/ai-agent/code-interpreter';
import {
    parseAgentRequests,
    runAgentRequest,
    readTargetDetail,
    splitQuoted
} from '../../../src/lib/ai-agent/agent-protocol';
import {formatAddressedScripts} from '../../../src/lib/ai-agent/sprite-reader';

/**
 * Fake storage asset: what scratch-storage hands back for an SVG costume.
 * @param {string} text SVG source
 * @returns {object} asset
 */
const makeAsset = text => ({dataFormat: 'svg', decodeText: () => text});

/**
 * A project whose names all contain spaces, around a real scratch-vm Blocks
 * container (the addressed listing is read through the engine).
 * @returns {object} {vm, runtime, stage, ball}
 */
const makeFixture = () => {
    const runtime = new Runtime();
    const stageVars = {
        'mon score': {id: 'v-score', name: 'mon score', type: '', value: 7},
        'ma liste': {id: 'v-liste', name: 'ma liste', type: 'list', value: ['a', 'b']}
    };
    const stage = {
        id: 'stage',
        isStage: true,
        variables: stageVars,
        getName: () => 'Scène',
        getCostumes: () => [{name: 'nuit étoilée', width: 480, height: 360}],
        getSounds: () => [],
        lookupVariableByNameAndType: (name, type) =>
            Object.values(stageVars).find(v => v.name === name && v.type === type) || null,
        createVariable (id, name, type) {
            this.variables[id] = {id, name, type, value: 0};
        },
        blocks: new Blocks(runtime)
    };
    const ballCostumes = [{
        name: 'visage joyeux',
        width: 24,
        height: 24,
        asset: makeAsset('<svg id="balle"><circle cx="12" cy="12" r="12" fill="#FF0000"/></svg>')
    }];
    const ball = {
        id: 'sprite1',
        isStage: false,
        x: 12,
        y: -30,
        size: 80,
        direction: 45,
        visible: true,
        variables: {},
        getName: () => 'Ma Balle',
        getCostumes: () => ballCostumes,
        getSounds: () => [],
        lookupVariableByNameAndType: () => null,
        blocks: new Blocks(runtime)
    };
    runtime.targets = [stage, ball];
    runtime.getTargetForStage = () => stage;
    runtime.getTargetById = id => runtime.targets.find(t => t.id === id);

    const vm = {
        runtime,
        editingTarget: ball,
        shareBlocksToTarget (blocks, targetId) {
            const target = runtime.targets.find(t => t.id === targetId);
            for (const block of blocks) target.blocks.createBlock(block);
            return Promise.resolve();
        }
    };

    // One script setting the "mon score" variable, so /read shows a name with a
    // space in the addressed listing.
    const context = {vm, target: ball};
    const spec = [
        {opcode: 'event_whenflagclicked'},
        {opcode: 'data_setvariableto', fields: {VARIABLE: 'mon score'}, inputs: {VALUE: 1}}
    ];
    for (const b of buildScript(spec, 0, 0, context)) ball.blocks.createBlock(b);

    return {vm, runtime, stage, ball};
};

describe('DSL parser — declarations with spaces in the name', () => {
    test('sprite: quoted name, bare multi-word name, coordinates kept', () => {
        expect(parseDSL('sprite "Ma Balle" 0 0:\n  whenflagclicked')[0])
            .toEqual({type: 'CREATE_SPRITE', name: 'Ma Balle', x: 0, y: 0});
        expect(parseDSL('sprite Ma Balle 10 -20:\n  whenflagclicked')[0])
            .toEqual({type: 'CREATE_SPRITE', name: 'Ma Balle', x: 10, y: -20});
        // Without coordinates the whole name is kept.
        expect(parseDSL('sprite Ma Balle:\n  whenflagclicked')[0])
            .toEqual({type: 'CREATE_SPRITE', name: 'Ma Balle'});
    });

    test('the scripts of a multi-word sprite target that sprite', () => {
        const actions = parseDSL('sprite "Ma Balle" 0 0:\n  whenflagclicked\n  move 10');
        const script = actions.find(a => a.type === 'ADD_SCRIPT');
        expect(script.sprite).toBe('Ma Balle');
    });

    test('on: selects an EXISTING sprite whose name has spaces', () => {
        for (const line of ['on "Ma Balle":', 'on Ma Balle:']) {
            const actions = parseDSL(`${line}\n  edit 1/1 move 5`);
            expect(actions[0]).toEqual({
                type: 'UPDATE_BLOCK',
                address: '1/1',
                opcode: 'motion_movesteps',
                inputs: {STEPS: 5},
                sprite: 'Ma Balle'
            });
        }
    });

    test('var / list: the name keeps its spaces, with or without quotes', () => {
        expect(parseDSL('var "mon score" = 0')[0]).toEqual({type: 'CREATE_VAR', name: 'mon score', value: 0});
        expect(parseDSL('var mon score = 0')[0]).toEqual({type: 'CREATE_VAR', name: 'mon score', value: 0});
        expect(parseDSL('var "mon score" = 12')[0]).toEqual({type: 'CREATE_VAR', name: 'mon score', value: 12});
        expect(parseDSL('list "ma liste" = a, b')[0])
            .toEqual({type: 'CREATE_LIST', name: 'ma liste', value: ['a', 'b']});
    });

    test('clear / renamesprite / deletesprite take the whole name', () => {
        expect(parseDSL('clear "Ma Balle"')[0]).toEqual({type: 'CLEAR_BLOCKS', sprite: 'Ma Balle'});
        expect(parseDSL('clear Ma Balle')[0]).toEqual({type: 'CLEAR_BLOCKS', sprite: 'Ma Balle'});
        expect(parseDSL('renamesprite "Ma Balle" = "Ma Raquette"')[0])
            .toEqual({type: 'RENAME_SPRITE', sprite: 'Ma Balle', name: 'Ma Raquette'});
        expect(parseDSL('deletesprite "Ma Balle"')[0]).toEqual({type: 'DELETE_SPRITE', name: 'Ma Balle'});
    });

    test('costume directives keep a multi-word costume name', () => {
        expect(parseDSL('costume "visage joyeux" = circle #ff0000')[0])
            .toEqual({type: 'CREATE_COSTUME', shape: 'circle', name: 'visage joyeux', color: '#ff0000'});
        expect(parseDSL('renamecostume "visage joyeux" = "visage triste"')[0])
            .toEqual({type: 'RENAME_COSTUME', costume: 'visage joyeux', name: 'visage triste'});
        expect(parseDSL('setcostume "visage joyeux"')[0])
            .toEqual({type: 'SET_COSTUME', costume: 'visage joyeux'});
    });
});

describe('DSL parser — block arguments with spaces', () => {
    test('a quoted variable name is one argument', () => {
        expect(parseCall('set "mon score" 1'))
            .toEqual({opcode: 'data_setvariableto', inputs: {VARIABLE: 'mon score', VALUE: 1}});
        expect(parseCall('additem 5 "ma liste"'))
            .toEqual({opcode: 'data_addtolist', inputs: {ITEM: 5, LIST: 'ma liste'}});
    });

    test('an UNQUOTED variable name gives its extra words back to the name', () => {
        expect(parseCall('set mon score 1'))
            .toEqual({
                opcode: 'data_setvariableto',
                inputs: {VARIABLE: {__variable: 'mon score'}, VALUE: 1}
            });
        expect(parseCall('change mon score 1'))
            .toEqual({
                opcode: 'data_changevariableby',
                inputs: {VARIABLE: {__variable: 'mon score'}, VALUE: 1}
            });
        // The list is the last parameter: the item stays in front.
        expect(parseCall('additem 5 ma liste'))
            .toEqual({opcode: 'data_addtolist', inputs: {ITEM: 5, LIST: {__variable: 'ma liste'}}});
        expect(parseCall('insertitem 5 1 ma liste'))
            .toEqual({
                opcode: 'data_insertatlist',
                inputs: {ITEM: 5, INDEX: 1, LIST: {__variable: 'ma liste'}}
            });
    });

    test('a reporter can sit next to a multi-word variable name', () => {
        expect(parseCall('change mon score (random 1 10)')).toEqual({
            opcode: 'data_changevariableby',
            inputs: {
                VARIABLE: {__variable: 'mon score'},
                VALUE: {opcode: 'operator_random', inputs: {FROM: 1, TO: 10}}
            }
        });
    });

    test('a single-value block keeps its multi-word value (sprite, menu, text)', () => {
        expect(parseCall('goto Ma Balle'))
            .toEqual({opcode: 'motion_goto', inputs: {TO: {__variable: 'Ma Balle'}}});
        expect(parseCall('touching Ma Balle'))
            .toEqual({opcode: 'sensing_touchingobject', inputs: {TOUCHINGOBJECTMENU: {__variable: 'Ma Balle'}}});
        expect(parseCall('whenkey up arrow'))
            .toEqual({opcode: 'event_whenkeypressed', inputs: {KEY_OPTION: {__variable: 'up arrow'}}});
        expect(parseCall('stop other scripts in sprite'))
            .toEqual({opcode: 'control_stop', inputs: {STOP_OPTION: {__variable: 'other scripts in sprite'}}});
    });

    test('a two-name block is only safe quoted: of "x position" "Ma Balle"', () => {
        expect(parseCall('of "x position" Ma Balle'))
            .toEqual({opcode: 'sensing_of', inputs: {PROPERTY: 'x position', OBJECT: {__variable: 'Ma Balle'}}});
        expect(parseCall('of "x position" "Ma Balle"'))
            .toEqual({opcode: 'sensing_of', inputs: {PROPERTY: 'x position', OBJECT: 'Ma Balle'}});
    });

    test('numbers are never swallowed by a name', () => {
        // `set score 1 2` stays as it was: the surplus is dropped, not glued.
        expect(parseCall('set score 1 2'))
            .toEqual({opcode: 'data_setvariableto', inputs: {VARIABLE: {__variable: 'score'}, VALUE: 1}});
        expect(parseCall('gotoxy 0 0 0'))
            .toEqual({opcode: 'motion_gotoxy', inputs: {X: 0, Y: 0}});
    });

    test('a lone = separator is ignored', () => {
        expect(parseCall('set score = 5'))
            .toEqual({opcode: 'data_setvariableto', inputs: {VARIABLE: {__variable: 'score'}, VALUE: 5}});
    });
});

describe('block builder — a name with spaces reaches the VM as-is', () => {
    test('the variable field and the created variable keep the space', () => {
        const {vm, stage} = makeFixture();
        const actions = parseDSL('on "Ma Balle":\n  set "mon score" 3');
        const script = actions.find(a => a.type === 'ADD_SCRIPT');
        expect(script.sprite).toBe('Ma Balle');
        const blocks = buildScript(script.blocks, 0, 0, {vm, target: vm.editingTarget});
        const setter = blocks.find(b => b.opcode === 'data_setvariableto');
        expect(setter.fields.VARIABLE.value).toBe('mon score');
        // It resolved the EXISTING variable, it did not create "mon".
        expect(setter.fields.VARIABLE.id).toBe('v-score');
        expect(Object.values(stage.variables).map(v => v.name)).not.toContain('mon');
    });

    test('an unquoted multi-word name resolves the real variable too', () => {
        const {vm} = makeFixture();
        const spec = parseCall('set mon score 3');
        const blocks = buildScript([spec], 0, 0, {vm, target: vm.editingTarget});
        const setter = blocks.find(b => b.opcode === 'data_setvariableto');
        expect(setter.fields.VARIABLE.value).toBe('mon score');
        expect(setter.fields.VARIABLE.id).toBe('v-score');
    });

    test('(var "mon score") builds a variable reporter', () => {
        const {vm} = makeFixture();
        const spec = parseCall('say (var "mon score")');
        const blocks = buildScript([spec], 0, 0, {vm, target: vm.editingTarget});
        const reporter = blocks.find(b => b.opcode === 'data_variable');
        expect(reporter.fields.VARIABLE.value).toBe('mon score');
        expect(reporter.fields.VARIABLE.id).toBe('v-score');
    });
});

describe('agent tools — names with spaces', () => {
    test('splitQuoted keeps a quoted name together', () => {
        expect(splitQuoted('"Ma Balle" "visage joyeux"')).toEqual(['Ma Balle', 'visage joyeux']);
        expect(splitQuoted('Ma Balle visage')).toEqual(['Ma', 'Balle', 'visage']);
        expect(splitQuoted('')).toEqual([]);
    });

    test('/read accepts a quoted sprite name', () => {
        const {vm} = makeFixture();
        const {requests} = parseAgentRequests('/read "Ma Balle"');
        expect(requests[0].arg).toBe('Ma Balle');
        expect(runAgentRequest(requests[0], vm)).toContain('SPRITE "Ma Balle"');
    });

    test('/costume splits the sprite from the costume when both have spaces', () => {
        const {vm} = makeFixture();
        const {requests} = parseAgentRequests('/costume "Ma Balle" "visage joyeux"');
        expect(requests[0].tokens).toEqual(['Ma Balle', 'visage joyeux']);
        const out = runAgentRequest(requests[0], vm);
        expect(out).toContain('COSTUMES DE "Ma Balle"');
        expect(out).toContain('--- visage joyeux (index 1, 24×24) ---');
        expect(out).toContain('<circle');
        expect(out).not.toContain('introuvable');
    });

    test('/costume without quotes still finds the sprite by its longest name', () => {
        const {vm} = makeFixture();
        const {requests} = parseAgentRequests('/costume Ma Balle visage joyeux');
        const out = runAgentRequest(requests[0], vm);
        expect(out).toContain('COSTUMES DE "Ma Balle"');
        expect(out).toContain('--- visage joyeux (index 1, 24×24) ---');
        expect(out).not.toContain('introuvable');
    });

    test('/search keeps a multi-word query', () => {
        const {vm} = makeFixture();
        const {requests} = parseAgentRequests('/search "mon score"');
        expect(requests[0].arg).toBe('mon score');
        expect(runAgentRequest(requests[0], vm)).toContain('mon score');
    });

    test('/read tells the AI to quote the sprite in its /costume example', () => {
        const {vm} = makeFixture();
        expect(readTargetDetail(vm, 'Ma Balle')).toContain('/costume "Ma Balle"');
    });
});

describe('addressed listing — a value with spaces is quoted so it can be sent back', () => {
    test('the line the AI copies keeps the variable name in one piece', () => {
        const {ball} = makeFixture();
        const listing = formatAddressedScripts(ball, '');
        const line = listing.split('\n').find(l => l.includes('data_setvariableto'));
        expect(line).toContain('VARIABLE="mon score"');
        expect(line).toContain('VALUE=1');

        // Round-trip: what the listing shows is what the parser reads back.
        const spec = parseCall(line.trim().replace(/^\[[^\]]+\]\s*/, ''));
        expect(spec.opcode).toBe('data_setvariableto');
        expect(spec.inputs.VARIABLE).toBe('mon score');
    });
});

describe('legacy line commands — names with spaces', () => {
    test('CREATE_SPRITE keeps the whole name and its coordinates', () => {
        expect(parseLineCommands('CREATE_SPRITE Ma Balle 10 -20')[0])
            .toEqual({type: 'CREATE_SPRITE', name: 'Ma Balle', x: 10, y: -20});
        expect(parseLineCommands('CREATE_SPRITE "Ma Balle" 10 -20')[0])
            .toEqual({type: 'CREATE_SPRITE', name: 'Ma Balle', x: 10, y: -20});
    });

    test('CREATE_VAR / CLEAR_BLOCKS / DELETE_SPRITE keep the whole name', () => {
        expect(parseLineCommands('CREATE_VAR "mon score" 5')[0])
            .toEqual({type: 'CREATE_VAR', name: 'mon score', value: 5});
        expect(parseLineCommands('CREATE_VAR mon score 0')[0])
            .toEqual({type: 'CREATE_VAR', name: 'mon score', value: 0});
        // Unquoted without a numeric value: the historical reading is kept.
        expect(parseLineCommands('CREATE_VAR score bonjour')[0])
            .toEqual({type: 'CREATE_VAR', name: 'score', value: 'bonjour'});
        expect(parseLineCommands('CLEAR_BLOCKS "Ma Balle"')[0])
            .toEqual({type: 'CLEAR_BLOCKS', sprite: 'Ma Balle'});
        expect(parseLineCommands('DELETE_SPRITE Ma Balle')[0])
            .toEqual({type: 'DELETE_SPRITE', name: 'Ma Balle'});
    });

    test('CREATE_LIST needs quotes to tell the name from the items', () => {
        expect(parseLineCommands('CREATE_LIST "ma liste" a b c')[0])
            .toEqual({type: 'CREATE_LIST', name: 'ma liste', value: ['a', 'b', 'c']});
        // Unquoted keeps the historical reading: first word = name.
        expect(parseLineCommands('CREATE_LIST liste a b')[0])
            .toEqual({type: 'CREATE_LIST', name: 'liste', value: ['a', 'b']});
    });
});

describe('prompt — the rule is taught to the AI', () => {
    test('the agent prompt shows quoted multi-word names', async () => {
        const {generateAgentPrompt} = await import('../../../src/lib/ai-agent/prompt-generator');
        const {vm} = makeFixture();
        const prompt = generateAgentPrompt(vm, 'un jeu');
        expect(prompt).toContain('sprite "Ma Balle" 0 0:');
        expect(prompt).toContain('set "mon score" 1');
        expect(prompt).toContain('/costume "Ma Balle"');
        expect(prompt).toContain('of "x position" "Ma Balle"');
    });
});
