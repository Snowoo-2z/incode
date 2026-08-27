/* eslint-disable no-invalid-this */
import Runtime from 'scratch-vm/src/engine/runtime';
import Blocks from 'scratch-vm/src/engine/blocks';

import {
    parseAgentRequests,
    stripAgentRequests,
    runAgentRequests,
    runAgentRequest,
    formatProjectOverview,
    readTargetDetail,
    readGlobalVariables,
    searchProject
} from '../../../src/lib/ai-agent/agent-protocol';
import {
    generateAgentPrompt,
    generateAgentFollowUp,
    generateAIPrompt
} from '../../../src/lib/ai-agent/prompt-generator';
import AIAgent from '../../../src/lib/ai-agent/index';
import {parseDSL} from '../../../src/lib/ai-agent/dsl-parser';
import {formatProjectSummary} from '../../../src/lib/ai-agent/sprite-reader';
import {interpretAndExecute} from '../../../src/lib/ai-agent/code-interpreter';
import {buildScript} from '../../../src/lib/ai-agent/block-builder';
import {
    readCostumes,
    findTargetByName
} from '../../../src/lib/ai-agent/agent-protocol';
import {getCostumeSvg} from '../../../src/lib/ai-agent/sprite-costumes';

/**
 * Fake storage asset: what scratch-storage hands back for an SVG costume.
 * @param {string} text SVG source
 * @param {string} [format] data format
 * @returns {object} asset
 */
const makeAsset = (text, format = 'svg') => ({
    dataFormat: format,
    decodeText: () => text
});

/**
 * Builds a fixture around a REAL scratch-vm Runtime/Blocks container: the agent
 * tools read scripts through the engine, so mocking `blocks` would only prove
 * the mock works.
 * @returns {object} {vm, runtime, targets}
 */
const makeFixture = () => {
    const runtime = new Runtime();
    const stageVars = {
        score: {id: 'score', name: 'score', type: '', value: 7},
        liste: {id: 'liste', name: 'liste', type: 'list', value: ['a', 'b']}
    };
    const stage = {
        id: 'stage',
        isStage: true,
        variables: stageVars,
        getName: () => 'Scène',
        getCostumes: () => [{
            name: 'backdrop1',
            width: 480,
            height: 360,
            asset: makeAsset('<svg id="fond"><rect width="480" height="360" fill="#111"/></svg>')
        }],
        getSounds: () => [],
        lookupVariableByNameAndType: (name, type) =>
            Object.values(stageVars).find(v => v.name === name && v.type === type) || null,
        blocks: new Blocks(runtime)
    };
    const ballVars = {vitesse: {id: 'vitesse', name: 'vitesse', type: '', value: 3}};
    // Two costumes: one vector (readable/editable), one bitmap (no SVG to read).
    const ballCostumes = [
        {
            name: 'balle-rouge',
            width: 24,
            height: 24,
            asset: makeAsset('<svg id="balle"><circle cx="12" cy="12" r="12" fill="#FF0000"/></svg>')
        },
        {
            name: 'balle-photo',
            width: 60,
            height: 60,
            asset: {dataFormat: 'png'}
        }
    ];
    const ball = {
        id: 'sprite1',
        isStage: false,
        x: 12,
        y: -30,
        size: 80,
        direction: 45,
        visible: true,
        variables: ballVars,
        getName: () => 'Balle',
        getCostumes: () => ballCostumes,
        getSounds: () => [],
        lookupVariableByNameAndType: () => null,
        deleteCostume (index) {
            return ballCostumes.splice(index, 1)[0];
        },
        blocks: new Blocks(runtime)
    };
    const paddle = {
        id: 'sprite2',
        isStage: false,
        x: 0,
        y: -150,
        size: 100,
        direction: 90,
        visible: false,
        variables: {},
        getName: () => 'Raquette',
        getCostumes: () => [{
            name: 'raquette',
            width: 16,
            height: 90,
            asset: makeAsset('<svg id="raq"><rect width="16" height="90" rx="8" fill="#4C97FF"/></svg>')
        }],
        getSounds: () => [],
        lookupVariableByNameAndType: () => null,
        blocks: new Blocks(runtime)
    };
    runtime.targets = [stage, ball, paddle];
    runtime.getTargetForStage = () => stage;
    runtime.getTargetById = id => runtime.targets.find(t => t.id === id);
    runtime.emitProjectChanged = () => {};

    runtime.storage = {
        AssetType: {ImageVector: 'ImageVector'},
        DataFormat: {SVG: 'svg', PNG: 'png', JPG: 'jpg'},
        createAsset (type, format, data) {
            const text = new TextDecoder().decode(data);
            return {assetId: `asset-${data.length}`, dataFormat: format, decodeText: () => text};
        },
        get: () => null
    };

    const renamed = [];
    const vm = {
        runtime,
        editingTarget: ball,
        renamed,
        addCostume (md5ext, costumeObject, targetId) {
            const target = runtime.targets.find(t => t.id === targetId);
            if (!target) return Promise.reject(new Error('no target'));
            target.getCostumes().push(costumeObject);
            return Promise.resolve();
        },
        // What the real VM does: drop the built blocks in the target's container.
        shareBlocksToTarget (blocks, targetId) {
            const target = runtime.targets.find(t => t.id === targetId);
            if (!target) return Promise.reject(new Error('no target'));
            for (const block of blocks) target.blocks.createBlock(block);
            return Promise.resolve();
        },
        renameSprite (targetId, newName) {
            const target = runtime.targets.find(t => t.id === targetId);
            if (!target) throw new Error('No sprite associated with this target.');
            if (target.isStage) throw new Error('Cannot rename non-sprite targets.');
            renamed.push({from: target.getName(), to: newName, id: targetId});
            target.getName = () => newName;
        }
    };

    // Two scripts on the ball so /read and /search have real addresses.
    const context = {vm, target: ball};
    const spec1 = [{opcode: 'event_whenflagclicked'}, {opcode: 'motion_movesteps', inputs: {STEPS: 10}}];
    const spec2 = [{
        opcode: 'control_forever',
        inputs: {
            SUBSTACK: [{opcode: 'event_broadcast', fields: {BROADCAST_OPTION: 'rebond'}}]
        }
    }];
    for (const spec of [spec1, spec2]) {
        for (const b of buildScript(spec, 0, 0, context)) ball.blocks.createBlock(b);
    }
    return {vm, runtime, targets: {stage, ball, paddle}, renamed, ballCostumes};
};

describe('agent tool parsing', () => {
    test('reads the four tools and their argument', () => {
        const {requests, unknown} = parseAgentRequests([
            '/list',
            '/read Balle',
            '/vars',
            '/search rebond'
        ].join('\n'));
        expect(requests.map(r => `${r.tool}:${r.arg}`))
            .toEqual(['list:', 'read:Balle', 'vars:', 'search:rebond']);
        expect(unknown).toEqual([]);
    });

    test('accepts the tools inside prose, lists and quotes', () => {
        const {requests} = parseAgentRequests([
            'Je vais regarder la balle :',
            '- /read "Balle"',
            '  * /vars',
            '> /search "rebond"'
        ].join('\n'));
        expect(requests.map(r => `${r.tool}:${r.arg}`))
            .toEqual(['read:Balle', 'vars:', 'search:rebond']);
    });

    test('French aliases resolve to the same tools', () => {
        const {requests} = parseAgentRequests('/liste\n/lire Balle\n/variables\n/cherche rebond');
        expect(requests.map(r => r.tool)).toEqual(['list', 'read', 'vars', 'search']);
    });

    test('unknown /commands are reported, not silently dropped', () => {
        const {requests, unknown} = parseAgentRequests('/read Balle\n/exec rm -rf');
        expect(requests).toHaveLength(1);
        expect(unknown).toEqual(['/exec rm -rf']);
    });

    test('stripAgentRequests leaves the code to execute', () => {
        const stripped = stripAgentRequests([
            '/read Balle',
            '```scratch',
            'on Balle:',
            '  move 10',
            '```',
            '/vars'
        ].join('\n'));
        expect(stripped).not.toContain('/read');
        expect(stripped).not.toContain('/vars');
        expect(stripped).toContain('move 10');
    });
});

describe('agent tools', () => {
    test('/list gives an overview WITHOUT any block code', () => {
        const {vm} = makeFixture();
        const out = formatProjectOverview(vm);
        expect(out).toContain('Sprites : 2');
        expect(out).toContain('"Balle"');
        expect(out).toContain('scripts=2');
        // The whole point of the mode: no code, no opcode, no address.
        expect(out).not.toContain('motion_movesteps');
        expect(out).not.toContain('[1/');
    });

    test('/read gives one sprite in full, with addresses', () => {
        const {vm} = makeFixture();
        const out = readTargetDetail(vm, 'Balle');
        expect(out).toContain('SPRITE "Balle"');
        expect(out).toContain('x=12');
        expect(out).toContain('vitesse = 3');
        expect(out).toContain('motion_movesteps');
        expect(out).toContain('[1/');
        // Only the asked sprite: the paddle's costume must not leak in.
        expect(out).not.toContain('raquette');
    });

    test('/read is case-insensitive and explains a miss', () => {
        const {vm} = makeFixture();
        expect(readTargetDetail(vm, 'balle')).toContain('SPRITE "Balle"');
        const miss = readTargetDetail(vm, 'Fantome');
        expect(miss).toContain('introuvable');
        expect(miss).toContain('"Balle"');
    });

    test('/vars lists the globals with their values', () => {
        const {vm} = makeFixture();
        const out = readGlobalVariables(vm);
        expect(out).toContain('score = 7');
        expect(out).toContain('liste = [a, b]');
    });

    test('/search finds the sprite holding a broadcast', () => {
        const {vm} = makeFixture();
        const out = searchProject(vm, 'rebond');
        expect(out).toContain('SPRITE "Balle"');
        expect(out).toContain('event_broadcast');
        expect(out).not.toContain('SPRITE "Raquette"');
    });

    test('/search matches a sprite name and reports a clean miss', () => {
        const {vm} = makeFixture();
        expect(searchProject(vm, 'Raquette')).toContain('le NOM du sprite correspond');
        expect(searchProject(vm, 'zzzz')).toContain('Aucun résultat');
    });

    test('runAgentRequests runs every call, in order, without duplicates', () => {
        const {vm} = makeFixture();
        const {answers, requests, unknown} = runAgentRequests('/list\n/read Balle\n/READ Balle\n/exec x', vm);
        expect(requests).toHaveLength(3);
        expect(answers).toHaveLength(2);
        expect(answers[0]).toMatch(/^--- \/list ---/);
        expect(answers[1]).toMatch(/^--- \/read Balle ---/);
        expect(unknown).toEqual(['/exec x']);
    });

    test('a tool asked without its argument explains itself', () => {
        const {vm} = makeFixture();
        expect(runAgentRequest({tool: 'read', arg: '', raw: '/read'}, vm)).toContain('/read demande');
        expect(runAgentRequest({tool: 'search', arg: '', raw: '/search'}, vm)).toContain('/search demande');
    });
});

describe('agent prompts', () => {
    test('the agent prompt sends the overview, the tools and no sprite code', () => {
        const {vm} = makeFixture();
        const prompt = generateAgentPrompt(vm, 'Ajouter un menu');
        expect(prompt).toContain('AGENT AUTONOME');
        expect(prompt).toContain('TU N\'AS PAS LE CODE DU PROJET');
        expect(prompt).toContain('"Balle"');
        expect(prompt).toContain('/read <sprite>');
        expect(prompt).toContain('/search <mot>');
        // Documentation still there: the AI must know the language.
        expect(prompt).toContain('Règles du langage');
        expect(prompt).toContain('ÉDITIONS CIBLÉES');
        // ...but not the project's own code: neither the addressed listing
        // header nor the broadcast that only exists inside the ball's script.
        // (`[1/3.1]` alone is not a valid marker: the editing doc uses it too.)
        expect(prompt).not.toContain('préfixé par son adresse');
        expect(prompt).not.toContain('rebond');
        expect(prompt).not.toContain('balle-rouge');
        expect(prompt).toContain('Ajouter un menu');
    });

    test('the project state sent in agent mode is a fraction of the classic one', () => {
        const {vm} = makeFixture();
        // Same documentation in both; what changes is the STATE. With 3 sprites
        // and 2 tiny scripts it is already 3x smaller, and it grows linearly
        // with the classic one while the agent's stays one line per sprite.
        const overview = formatProjectOverview(vm);
        const full = formatProjectSummary(vm);
        expect(overview.length).toBeLessThan(full.length / 3);
        expect(generateAIPrompt(vm, 'x')).toContain('rebond');
        expect(generateAgentPrompt(vm, 'x')).not.toContain('rebond');
    });

    test('the follow-up prompt carries the tool answers and the run report', () => {
        const {vm} = makeFixture();
        const {answers} = runAgentRequests('/vars', vm);
        const followUp = generateAgentFollowUp(vm, answers, {logs: ['✓ 2 actions exécutées.']}, ['/exec x']);
        expect(followUp).toContain('Même conversation');
        expect(followUp).toContain('--- /vars ---');
        expect(followUp).toContain('score = 7');
        expect(followUp).toContain('✓ 2 actions exécutées.');
        expect(followUp).toContain('Commandes non reconnues');
    });

    test('the follow-up prompt works without a report and without tools', () => {
        const {vm} = makeFixture();
        const followUp = generateAgentFollowUp(vm, []);
        expect(followUp).toContain('aucun outil demandé');
        expect(followUp).not.toContain('RÉSULTAT');
    });
});

describe('renaming sprites', () => {
    test('renamesprite <ancien> = <nouveau> becomes a RENAME_SPRITE action', () => {
        const actions = parseDSL('renamesprite Balle = Raquette');
        expect(actions).toEqual([{type: 'RENAME_SPRITE', sprite: 'Balle', name: 'Raquette'}]);
    });

    test('renamesprite inside `on` renames the current sprite', () => {
        const actions = parseDSL('on Balle:\n  renamesprite Boule');
        expect(actions.some(a =>
            a.type === 'RENAME_SPRITE' && a.sprite === 'Balle' && a.name === 'Boule')).toBe(true);
    });

    test('deletesprite becomes a DELETE_SPRITE action', () => {
        const actions = parseDSL('deletesprite Fantome');
        expect(actions.some(a => a.type === 'DELETE_SPRITE' && a.name === 'Fantome')).toBe(true);
    });

    test('executing RENAME_SPRITE calls vm.renameSprite', async () => {
        const {vm, renamed} = makeFixture();
        const report = await interpretAndExecute('renamesprite Balle = Boule', vm);
        expect(report.success).toBe(true);
        expect(renamed).toEqual([{from: 'Balle', to: 'Boule', id: 'sprite1'}]);
        expect(report.logs.join('\n')).toContain('renommé');
        expect(report.logs.join('\n')).not.toContain('❌');
    });

    test('renaming onto an existing sprite is refused, not silently done', async () => {
        const {vm, renamed} = makeFixture();
        const report = await interpretAndExecute('renamesprite Balle = Raquette', vm);
        expect(renamed).toEqual([]);
        expect(report.success).toBe(true);
        expect(report.logs.join('\n')).toContain('existe déjà');
    });

    test('the stage cannot be renamed', async () => {
        const {vm, renamed} = makeFixture();
        const report = await interpretAndExecute('renamesprite Scène = Fond', vm);
        expect(renamed).toEqual([]);
        expect(report.success).toBe(true);
        expect(report.logs.join('\n')).toContain('scène');
    });
});

describe('the agent loop (what the modal calls)', () => {
    test('one turn runs the tools, applies the code and hands back a follow-up', async () => {
        const {vm} = makeFixture();
        AIAgent.setVM(vm);
        const answer = [
            'Je regarde la balle et les variables :',
            '/read Balle',
            '/vars',
            '```scratch',
            'on Balle:',
            '  whenflagclicked',
            '  move 10',
            '```',
            'Dis-moi si ça te convient.'
        ].join('\n');

        const turn = await AIAgent.runAgentTurn(answer);

        // 1. the two tools were answered
        expect(turn.answers).toHaveLength(2);
        expect(turn.answers[0]).toContain('SPRITE "Balle"');
        expect(turn.answers[1]).toContain('score = 7');

        // 2. the code in the answer really landed on the sprite
        expect(turn.report.actionsCount).toBe(1);
        const scripts = vm.runtime.targets.find(t => t.id === 'sprite1').blocks.getScripts();
        expect(scripts.length).toBe(3); // 2 seeded + the one just added

        // 3. the follow-up carries the answers AND the run report
        expect(turn.followUp).toContain('Même conversation');
        expect(turn.followUp).toContain('--- /read Balle ---');
        expect(turn.followUp).toContain('Exécution');
        expect(turn.followUp).toContain('"Balle"');

        // 4. the code handed to the interpreter had no tool line left in it
        expect(turn.code).not.toContain('/read');
        expect(turn.code).toContain('move 10');
    });

    test('a turn with tools but no code still answers and still offers a follow-up', async () => {
        const {vm} = makeFixture();
        AIAgent.setVM(vm);
        const turn = await AIAgent.runAgentTurn('/list');
        expect(turn.report).toBeNull();
        expect(turn.answers).toHaveLength(1);
        expect(turn.followUp).toContain('--- /list ---');
        expect(turn.followUp).not.toContain('CODE EXÉCUTÉ');
    });
});

describe('lire et modifier les costumes SVG', () => {
    test('/costume <sprite> renvoie le SVG de tous ses costumes', () => {
        const {vm} = makeFixture();
        const out = readCostumes(vm, 'Balle');
        expect(out).toContain('COSTUMES DE "Balle"');
        expect(out).toContain('<circle cx="12" cy="12" r="12" fill="#FF0000"/>');
        // the bitmap has no SVG: say so instead of dumping a data URI
        expect(out).toContain('balle-photo');
        expect(out).toContain('pas de code SVG à lire');
    });

    test('/costume <sprite> <nom> ne renvoie que ce costume', () => {
        const {vm} = makeFixture();
        const out = readCostumes(vm, 'Balle', 'balle-rouge');
        expect(out).toContain('fill="#FF0000"');
        expect(out).not.toContain('balle-photo');
        expect(out).toContain('Pour le modifier : costume "balle-rouge" = <svg .../>');
    });

    test('getCostumeSvg lit le SVG, et signale un bitmap sans SVG', () => {
        const {vm, targets} = makeFixture();
        const vector = getCostumeSvg(vm, targets.ball, 'balle-rouge');
        expect(vector.kind).toBe('svg');
        expect(vector.svg).toContain('<circle');
        const bitmap = getCostumeSvg(vm, targets.ball, 'balle-photo');
        expect(bitmap.svg).toBeNull();
        expect(bitmap.kind).toBe('png');
        // no name at all -> the costume currently shown
        expect(getCostumeSvg(vm, targets.ball).name).toBe('balle-rouge');
        targets.ball.currentCostume = 1;
        expect(getCostumeSvg(vm, targets.ball).name).toBe('balle-photo');
    });

    test('/read indique comment lire le costume', () => {
        const {vm} = makeFixture();
        expect(readTargetDetail(vm, 'Balle')).toContain('/costume Balle <balle-rouge|balle-photo>');
    });

    test('outil /costume inconnu ou sans argument', () => {
        const {vm} = makeFixture();
        expect(readCostumes(vm, 'Fantome')).toContain('introuvable');
        expect(readCostumes(vm, 'Fantome')).toContain('"Balle"');
        expect(runAgentRequest({tool: 'costume', arg: '', raw: '/costume'}, vm)).toContain('/costume demande');
    });

    test('boucle complète : lire le SVG, le retoucher, le remplacer en place', async () => {
        const {vm, ballCostumes} = makeFixture();
        AIAgent.setVM(vm);

        // 1. the AI reads the drawing
        const read = await AIAgent.runAgentTurn('/costume Balle balle-rouge');
        expect(read.answers[0]).toContain('fill="#FF0000"');
        expect(read.followUp).toContain('<circle cx="12" cy="12" r="12" fill="#FF0000"/>');

        // 2. it sends back the same costume, changed to a square
        const edited = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
            '<rect width="24" height="24" fill="#00FF00"/></svg>';
        const turn = await AIAgent.runAgentTurn(
            '```scratch\non Balle:\n  costume "balle-rouge" = ' + edited + '\n```');
        expect(turn.report.logs.join('\n')).toContain('balle-rouge');

        // 3. same name, same slot, new drawing — nothing duplicated
        expect(ballCostumes).toHaveLength(2);
        expect(ballCostumes.map(c => c.name)).toEqual(['balle-photo', 'balle-rouge']);
        const after = getCostumeSvg(vm, findTargetByName(vm, 'Balle'), 'balle-rouge');
        expect(after.svg).toContain('<rect width="24" height="24" fill="#00FF00"/>');
        expect(after.svg).not.toContain('circle');
    });

    test('le prompt agent annonce l\'outil /costume', () => {
        const {vm} = makeFixture();
        const prompt = generateAgentPrompt(vm, 'x');
        expect(prompt).toContain('/costume <sprite> [<costume>]');
        expect(prompt).toContain('LIT le code SVG');
    });
});
