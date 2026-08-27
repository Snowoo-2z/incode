/* eslint-disable no-invalid-this */
import Runtime from 'scratch-vm/src/engine/runtime';
import Blocks from 'scratch-vm/src/engine/blocks';

import {buildScript} from '../../../src/lib/ai-agent/block-builder';
import {resolveAddress, listAddressedScripts} from '../../../src/lib/ai-agent/block-address';
import {applyUpdate, applyDelete, applyInsert, applyReplace} from '../../../src/lib/ai-agent/block-editor';
import {interpretAndExecute} from '../../../src/lib/ai-agent/code-interpreter';

/**
 * Builds a test fixture around a REAL scratch-vm Blocks container, so the edits
 * are validated against the actual engine (createBlock/deleteBlock/scripts),
 * not a mock.
 * @returns {object} {runtime, target, context}
 */
const makeFixture = () => {
    const runtime = new Runtime();
    const stageVars = {};
    const stage = {
        id: 'stage',
        isStage: true,
        variables: stageVars,
        getName: () => 'Stage',
        lookupVariableByNameAndType (name, type) {
            return Object.values(stageVars).find(v => v.name === name && v.type === type) || null;
        },
        lookupBroadcastMsg: () => null,
        createVariable (id, name, type) {
            stageVars[id] = {id, name, type, value: 0};
        },
        getCostumes: () => [{name: 'backdrop1'}],
        getSounds: () => [],
        blocks: new Blocks(runtime)
    };
    const blocks = new Blocks(runtime);
    const target = {
        id: 'sprite1',
        isStage: false,
        variables: {},
        blocks,
        getName: () => 'Balle',
        lookupVariableByNameAndType: () => null,
        getCostumes: () => [{name: 'costume1'}],
        getSounds: () => []
    };
    runtime.targets = [stage, target];
    runtime.getTargetForStage = () => stage;
    runtime.getTargetById = id => runtime.targets.find(t => t.id === id);
    return {runtime, target, context: {vm: {runtime}, target}};
};

/**
 * Loads a script into the fixture's real block container.
 * @param {object} fixture fixture
 * @param {Array<object>} specs block specs
 */
const seed = (fixture, specs) => {
    const built = buildScript(specs, 10, 20, fixture.context);
    for (const b of built) fixture.target.blocks.createBlock(b);
};

/**
 * Returns the flat list of "address opcode" strings for the first script.
 * @param {object} target VM target
 * @returns {Array<string>} lines
 */
const addressed = target => {
    const scripts = listAddressedScripts(target, b => b.opcode);
    const lines = [];
    for (const s of scripts) {
        for (const e of s.entries) lines.push(`${e.address} ${e.opcode}`);
    }
    return lines;
};

/**
 * Counts dangling references and inconsistent parents in the container.
 * @param {object} target VM target
 * @returns {number} number of integrity problems
 */
const integrityProblems = target => {
    const map = target.blocks._blocks;
    let problems = 0;
    for (const b of Object.values(map)) {
        if (b.next && !map[b.next]) problems++;
        if (b.parent && !map[b.parent]) problems++;
        for (const input of Object.values(b.inputs || {})) {
            if (input.block && !map[input.block]) problems++;
            if (input.shadow && !map[input.shadow]) problems++;
        }
    }
    return problems;
};

const noop = () => {};

describe('block-address — addressing', () => {
    test('addresses top-level and nested blocks with a stable path scheme', () => {
        const fx = makeFixture();
        seed(fx, [
            {opcode: 'event_whenflagclicked'},
            {opcode: 'motion_gotoxy', inputs: {X: 0, Y: 0}},
            {opcode: 'control_forever', inputs: {SUBSTACK: [
                {opcode: 'motion_movesteps', inputs: {STEPS: 10}},
                {opcode: 'control_if', inputs: {
                    CONDITION: {opcode: 'sensing_touchingobject', inputs: {TOUCHINGOBJECTMENU: '_edge_'}},
                    SUBSTACK: [{opcode: 'motion_turnright', inputs: {DEGREES: 15}}]
                }}
            ]}}
        ]);
        expect(addressed(fx.target)).toEqual([
            '1/1 event_whenflagclicked',
            '1/2 motion_gotoxy',
            '1/3 control_forever',
            '1/3.1 motion_movesteps',
            '1/3.2 control_if',
            '1/3.2.1 motion_turnright'
        ]);
    });

    test('resolves a combined address and a split script/path', () => {
        const fx = makeFixture();
        seed(fx, [
            {opcode: 'event_whenflagclicked'},
            {opcode: 'control_forever', inputs: {SUBSTACK: [{opcode: 'motion_movesteps', inputs: {STEPS: 10}}]}}
        ]);
        const a = resolveAddress(fx.target, '1/2.1');
        const b = resolveAddress(fx.target, 1, '2.1');
        expect(a.blockId).toBe(b.blockId);
        expect(fx.target.blocks.getBlock(a.blockId).opcode).toBe('motion_movesteps');
    });
});

describe('block-editor — UPDATE_BLOCK', () => {
    test('changes an input value in place, keeping id and position', () => {
        const fx = makeFixture();
        seed(fx, [
            {opcode: 'event_whenflagclicked'},
            {opcode: 'motion_movesteps', inputs: {STEPS: 10}}
        ]);
        const before = resolveAddress(fx.target, '1/2').blockId;
        applyUpdate({address: '1/2', opcode: 'motion_movesteps', inputs: {STEPS: 25}}, fx.target, fx.context, noop);
        const after = resolveAddress(fx.target, '1/2');
        expect(after.blockId).toBe(before); // same id preserved
        const shadowId = fx.target.blocks.getBlock(after.blockId).inputs.STEPS.shadow;
        expect(fx.target.blocks.getBlock(shadowId).fields.NUM.value).toBe('25');
        expect(integrityProblems(fx.target)).toBe(0);
    });

    test('preserves inner branches when updating a C-block', () => {
        const fx = makeFixture();
        seed(fx, [
            {opcode: 'control_repeat', inputs: {TIMES: 4, SUBSTACK: [{opcode: 'motion_movesteps', inputs: {STEPS: 1}}]}}
        ]);
        applyUpdate({address: '1/1', opcode: 'control_repeat', inputs: {TIMES: 10}}, fx.target, fx.context, noop);
        expect(addressed(fx.target)).toEqual(['1/1 control_repeat', '1/1.1 motion_movesteps']);
        expect(integrityProblems(fx.target)).toBe(0);
    });
});

describe('block-editor — DELETE_BLOCK', () => {
    test('removes a middle block and re-links the stack', () => {
        const fx = makeFixture();
        seed(fx, [
            {opcode: 'event_whenflagclicked'},
            {opcode: 'motion_gotoxy', inputs: {X: 0, Y: 0}},
            {opcode: 'motion_movesteps', inputs: {STEPS: 5}}
        ]);
        applyDelete({address: '1/2'}, fx.target, noop);
        expect(addressed(fx.target)).toEqual(['1/1 event_whenflagclicked', '1/2 motion_movesteps']);
        expect(integrityProblems(fx.target)).toBe(0);
    });

    test('promotes the next block when deleting a script head', () => {
        const fx = makeFixture();
        seed(fx, [
            {opcode: 'event_whenflagclicked'},
            {opcode: 'motion_movesteps', inputs: {STEPS: 5}}
        ]);
        applyDelete({address: '1/1'}, fx.target, noop);
        const heads = fx.target.blocks.getScripts();
        expect(heads).toHaveLength(1);
        expect(fx.target.blocks.getBlock(heads[0]).opcode).toBe('motion_movesteps');
        expect(fx.target.blocks.getBlock(heads[0]).topLevel).toBe(true);
        expect(integrityProblems(fx.target)).toBe(0);
    });

    test('empties a branch when its only block is deleted', () => {
        const fx = makeFixture();
        seed(fx, [
            {opcode: 'event_whenflagclicked'},
            {opcode: 'control_if', inputs: {
                CONDITION: {opcode: 'sensing_mousedown'},
                SUBSTACK: [{opcode: 'motion_movesteps', inputs: {STEPS: 1}}]
            }}
        ]);
        applyDelete({address: '1/2.1'}, fx.target, noop);
        const ifId = resolveAddress(fx.target, '1/2').blockId;
        expect(fx.target.blocks.getBlock(ifId).inputs.SUBSTACK).toBeUndefined();
        expect(integrityProblems(fx.target)).toBe(0);
    });
});

describe('block-editor — INSERT_BLOCKS', () => {
    test('inserts after a block', () => {
        const fx = makeFixture();
        seed(fx, [
            {opcode: 'event_whenflagclicked'},
            {opcode: 'motion_movesteps', inputs: {STEPS: 5}}
        ]);
        applyInsert(
            {address: '1/1', position: 'after', blocks: [{opcode: 'looks_say', inputs: {MESSAGE: 'Go'}}]},
            fx.target, fx.context, noop
        );
        expect(addressed(fx.target)).toEqual([
            '1/1 event_whenflagclicked',
            '1/2 looks_say',
            '1/3 motion_movesteps'
        ]);
        expect(integrityProblems(fx.target)).toBe(0);
    });

    test('inserts into the start of a C-block branch', () => {
        const fx = makeFixture();
        seed(fx, [
            {opcode: 'control_forever', inputs: {SUBSTACK: [{opcode: 'motion_movesteps', inputs: {STEPS: 1}}]}}
        ]);
        applyInsert(
            {address: '1/1', position: 'into', blocks: [{opcode: 'motion_ifonedgebounce'}]},
            fx.target, fx.context, noop
        );
        expect(addressed(fx.target)).toEqual([
            '1/1 control_forever',
            '1/1.1 motion_ifonedgebounce',
            '1/1.2 motion_movesteps'
        ]);
        expect(integrityProblems(fx.target)).toBe(0);
    });

    test('inserts before a script head, making the new block the head', () => {
        const fx = makeFixture();
        seed(fx, [
            {opcode: 'event_whenflagclicked'},
            {opcode: 'motion_movesteps', inputs: {STEPS: 3}}
        ]);
        applyInsert(
            {address: '1/1', position: 'before', blocks: [{opcode: 'control_wait', inputs: {DURATION: 1}}]},
            fx.target, fx.context, noop
        );
        const heads = fx.target.blocks.getScripts();
        expect(heads).toHaveLength(1);
        expect(fx.target.blocks.getBlock(heads[0]).opcode).toBe('control_wait');
        expect(integrityProblems(fx.target)).toBe(0);
    });
});

describe('block-editor — REPLACE_BLOCK', () => {
    test('swaps a block for a new stack in place', () => {
        const fx = makeFixture();
        seed(fx, [
            {opcode: 'event_whenflagclicked'},
            {opcode: 'looks_say', inputs: {MESSAGE: 'hi'}},
            {opcode: 'motion_movesteps', inputs: {STEPS: 5}}
        ]);
        applyReplace(
            {address: '1/2', blocks: [{opcode: 'looks_think', inputs: {MESSAGE: 'hmm'}}, {opcode: 'looks_show'}]},
            fx.target, fx.context, noop
        );
        expect(addressed(fx.target)).toEqual([
            '1/1 event_whenflagclicked',
            '1/2 looks_think',
            '1/3 looks_show',
            '1/4 motion_movesteps'
        ]);
        expect(integrityProblems(fx.target)).toBe(0);
    });
});

/**
 * Counts the "cap block with a chained next" inconsistencies — the exact VM
 * state that makes scratch-blocks abort the whole workspace reload
 * ("Next statement does not exist") and blank the sprite's code area.
 * @param {object} target VM target
 * @returns {number} number of load-breaking stop blocks
 */
const capBlockCrashes = target => {
    const map = target.blocks._blocks;
    let crashes = 0;
    for (const b of Object.values(map)) {
        if (b.opcode === 'control_stop' && b.next && (!b.mutation || b.mutation.hasnext !== 'true')) {
            crashes++;
        }
    }
    return crashes;
};

describe('block-editor — cap-block consistency (workspace-wipe regression)', () => {
    test('REPLACE_BLOCK chaining blocks under an unquoted `stop other scripts in sprite` stays loadable', () => {
        const fx = makeFixture();
        seed(fx, [
            {opcode: 'event_whenbroadcastreceived'},
            {opcode: 'control_wait', inputs: {DURATION: 1}},
            {opcode: 'control_stop', fields: {STOP_OPTION: 'other scripts in sprite'}},
            {opcode: 'looks_hide'}
        ]);
        applyReplace(
            {address: '1/2', blocks: [
                {opcode: 'control_stop', fields: {STOP_OPTION: 'other scripts in sprite'}},
                {opcode: 'control_wait', inputs: {DURATION: 1}}
            ]},
            fx.target, fx.context, noop
        );
        applyDelete({address: '1/4'}, fx.target, noop); // the old stop

        expect(capBlockCrashes(fx.target)).toBe(0);
        expect(integrityProblems(fx.target)).toBe(0);
        // The surviving stop keeps its option and a working next connection.
        const stop = Object.values(fx.target.blocks._blocks)
            .find(b => b.opcode === 'control_stop' && b.next);
        expect(stop.fields.STOP_OPTION.value).toBe('other scripts in sprite');
        expect(stop.mutation.hasnext).toBe('true');
    });

    test('INSERT_BLOCKS after a stop cap repairs hasnext', () => {
        const fx = makeFixture();
        seed(fx, [
            {opcode: 'event_whenflagclicked'},
            {opcode: 'control_stop', fields: {STOP_OPTION: 'all'}},
            {opcode: 'looks_hide'}
        ]);
        // Simulate a stop-all that has a next but declares no next connection
        // (e.g. produced by an older run): the editor must repair it.
        const stop = Object.values(fx.target.blocks._blocks)
            .find(b => b.opcode === 'control_stop');
        stop.mutation.hasnext = 'false';

        applyInsert(
            {address: '1/3', position: 'after', blocks: [{opcode: 'looks_say', inputs: {MESSAGE: 'x'}}]},
            fx.target, fx.context, noop
        );
        expect(capBlockCrashes(fx.target)).toBe(0);
        expect(stop.mutation.hasnext).toBe('true');
    });

    test('full "fleche" scenario: the AI fix batch no longer produces an unloadable workspace', async () => {
        const fx = makeFixture();
        const script3 = [
            {opcode: 'event_whenbroadcastreceived', fields: {BROADCAST_OPTION: {broadcast: true, value: 'first achat'}}},
            {opcode: 'control_wait', inputs: {DURATION: 1}},
            {opcode: 'control_stop', fields: {STOP_OPTION: 'other scripts in sprite'}},
            {opcode: 'looks_hide'},
            {opcode: 'motion_pointindirection', inputs: {DIRECTION: {
                opcode: 'operator_mathop',
                fields: {OPERATOR: 'atan'},
                inputs: {NUM: {opcode: 'operator_divide', inputs: {
                    NUM1: {opcode: 'data_variable', fields: {VARIABLE: 'quest_x'}},
                    NUM2: {opcode: 'data_variable', fields: {VARIABLE: 'quest_y'}}
                }}}
            }}},
            {opcode: 'control_if', inputs: {
                CONDITION: {opcode: 'operator_lt', inputs: {
                    OPERAND1: {opcode: 'data_variable', fields: {VARIABLE: 'quest_y'}},
                    OPERAND2: 0
                }},
                SUBSTACK: [{opcode: 'motion_turnleft', inputs: {DEGREES: 180}}]
            }},
            {opcode: 'looks_show'}
        ];
        const script7 = [
            {opcode: 'event_whenbroadcastreceived', fields: {BROADCAST_OPTION: {broadcast: true, value: 'see arrow'}}},
            {opcode: 'motion_pointindirection', inputs: {DIRECTION: {
                opcode: 'operator_mathop',
                fields: {OPERATOR: 'atan'},
                inputs: {NUM: {opcode: 'operator_divide', inputs: {
                    NUM1: {opcode: 'data_variable', fields: {VARIABLE: 'quest_x'}},
                    NUM2: {opcode: 'data_variable', fields: {VARIABLE: 'quest_y'}}
                }}}
            }}},
            {opcode: 'control_if', inputs: {
                CONDITION: {opcode: 'operator_lt', inputs: {
                    OPERAND1: {opcode: 'data_variable', fields: {VARIABLE: 'quest_y'}},
                    OPERAND2: 0
                }},
                SUBSTACK: [{opcode: 'motion_turnleft', inputs: {DEGREES: 180}}]
            }},
            {opcode: 'looks_show'}
        ];
        seed(fx, script3);
        seed(fx, script7);

        // The EXACT code the AI sent (note the unquoted `stop other scripts in sprite`).
        const aiFix = '```scratch\n' + [
            'on Balle:',
            '  replace 1/2:',
            '    stop other scripts in sprite',
            '    wait 1',
            '  delete 1/3',
            '  replace 1/5:',
            '    point (+ (mathop "atan" (/ quest_x quest_y)) (* 180 (< quest_y 0)))',
            '  delete 1/6',
            '  replace 2/2:',
            '    point (+ (mathop "atan" (/ quest_x quest_y)) (* 180 (< quest_y 0)))',
            '  delete 2/3'
        ].join('\n') + '\n```';

        const report = await interpretAndExecute(aiFix, fx.context.vm);
        expect(report.success).toBe(true);

        // Workspace stays loadable: no cap block with a chained next anywhere.
        expect(capBlockCrashes(fx.target)).toBe(0);
        expect(integrityProblems(fx.target)).toBe(0);
        // Both scripts survive with their new point blocks.
        expect(fx.target.blocks.getScripts().length).toBe(2);
        const opcodes = addressed(fx.target);
        expect(opcodes.some(l => l.includes('control_if'))).toBe(false);
        // Both new point directions carry the atan + 180*(y<0) formula.
        const addCount = Object.values(fx.target.blocks._blocks)
            .filter(b => b.opcode === 'operator_add').length;
        expect(addCount).toBe(2);
        // The rebuilt stop really says "other scripts in sprite" and connects below.
        const stop = Object.values(fx.target.blocks._blocks)
            .find(b => b.opcode === 'control_stop' && b.next);
        expect(stop.fields.STOP_OPTION.value).toBe('other scripts in sprite');
        expect(stop.mutation.hasnext).toBe('true');
    });
});
