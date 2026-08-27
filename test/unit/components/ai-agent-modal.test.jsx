import React from 'react';
import {shallow} from 'enzyme';
import Runtime from 'scratch-vm/src/engine/runtime';
import Blocks from 'scratch-vm/src/engine/blocks';

import AIAgent from '../../../src/lib/ai-agent/index';
import AIAgentModalComponent from '../../../src/components/ai-agent-modal/ai-agent-modal';

const FOLLOW_UP_TITLE = 'Envoyer ceci à l\'IA dans la même conversation';

/**
 * Renders what a tab method returns. `shallow` stops at <ModalComponent />, so
 * the tab content is rendered on its own — still the real component code.
 * @param {object} instance mounted component instance
 * @param {string} method renderAssistantTab | renderAgentTab
 * @returns {object} enzyme wrapper over the tab content
 */
const renderTab = (instance, method) => shallow(<div>{instance[method]()}</div>);

/**
 * Minimal Scratch VM: two sprites with one script each, so the agent has
 * something to /read and something to rename.
 * @returns {object} {vm, targets}
 */
const makeVM = () => {
    const runtime = new Runtime();
    const stageVars = {score: {id: 'score', name: 'score', type: '', value: 3}};
    const stage = {
        id: 'stage',
        isStage: true,
        variables: stageVars,
        getName: () => 'Scène',
        getCostumes: () => [{name: 'backdrop1'}],
        getSounds: () => [],
        blocks: new Blocks(runtime)
    };
    const ball = {
        id: 'sprite1',
        isStage: false,
        x: 10,
        y: 20,
        size: 100,
        direction: 90,
        visible: true,
        variables: {},
        getName: () => 'Balle',
        getCostumes: () => [{name: 'balle'}],
        getSounds: () => [],
        lookupVariableByNameAndType: () => null,
        blocks: new Blocks(runtime)
    };
    const paddle = {
        id: 'sprite2',
        isStage: false,
        x: 0,
        y: -150,
        size: 100,
        direction: 90,
        visible: true,
        variables: {},
        getName: () => 'Raquette',
        getCostumes: () => [{name: 'raquette'}],
        getSounds: () => [],
        lookupVariableByNameAndType: () => null,
        blocks: new Blocks(runtime)
    };
    runtime.targets = [stage, ball, paddle];
    runtime.getTargetForStage = () => stage;
    runtime.emitProjectChanged = () => {};
    const vm = {
        runtime,
        editingTarget: ball,
        renameSprite (targetId, newName) {
            const target = runtime.targets.find(t => t.id === targetId);
            target.getName = () => newName;
        }
    };
    return {vm, targets: {stage, ball, paddle}};
};

describe('AIAgentModal — la boucle du mode agent', () => {
    test('le cadre « à renvoyer » apparaît après le premier tour et se rafraîchit à chaque tour', async () => {
        const {vm} = makeVM();
        AIAgent.setVM(vm);
        const wrapper = shallow(<AIAgentModalComponent vm={vm} onClose={() => {}} />);
        wrapper.instance().setState({activeTab: 'agent'});
        wrapper.update();

        // Before any turn there is nothing to send back: no green frame.
        expect(renderTab(wrapper.instance(), 'renderAgentTab').text()).not.toContain(FOLLOW_UP_TITLE);

        // --- Turn 1: the AI reads the ball.
        wrapper.instance().setState({agentResponse: '/read Balle'});
        await wrapper.instance().handleRunAgentTurn();
        wrapper.update();
        expect(wrapper.instance().state.agentFollowUp).toContain('--- /read Balle ---');
        // The box is emptied so the next paste does not re-run the old tools.
        expect(wrapper.instance().state.agentResponse).toBe('');
        expect(renderTab(wrapper.instance(), 'renderAgentTab').text()).toContain(FOLLOW_UP_TITLE);
        // ...with the copy button next to it.
        expect(renderTab(wrapper.instance(), 'renderAgentTab').text()).toContain('Copier la réponse à renvoyer');

        // --- Turn 2: it decides it also needs another sprite. The green frame
        // is REPLACED (not stacked), the log keeps the history.
        wrapper.instance().setState({agentResponse: '/read Raquette\n/vars'});
        await wrapper.instance().handleRunAgentTurn();
        wrapper.update();
        const afterTurn2 = wrapper.instance().state.agentFollowUp;
        expect(afterTurn2).toContain('--- /read Raquette ---');
        expect(afterTurn2).toContain('score = 3');
        expect(afterTurn2).not.toContain('--- /read Balle ---');
        const logs = wrapper.instance().state.agentLogs.join('\n');
        expect(logs).toContain('--- Tour 1 ---');
        expect(logs).toContain('--- Tour 2 ---');
        expect(logs).toContain('SPRITE "Balle"');
        expect(logs).toContain('SPRITE "Raquette"');

        // --- Turn 3: it sends code that changes the project. The follow-up
        // carries the report AND a freshly re-read overview.
        wrapper.instance().setState({agentResponse: '```scratch\nrenamesprite Balle = Boule\n```'});
        await wrapper.instance().handleRunAgentTurn();
        wrapper.update();
        const afterTurn3 = wrapper.instance().state.agentFollowUp;
        expect(afterTurn3).toContain('CODE EXÉCUTÉ');
        expect(afterTurn3).toContain('renommé');
        expect(afterTurn3).toContain('"Boule"');
        expect(wrapper.instance().state.agentOverview).toContain('"Boule"');
        expect(wrapper.instance().state.agentLogs.join('\n')).toContain('--- Tour 3 ---');

        // --- Turn 4: nothing new to ask, the loop still answers.
        wrapper.instance().setState({agentResponse: '/list'});
        await wrapper.instance().handleRunAgentTurn();
        wrapper.update();
        expect(wrapper.instance().state.agentFollowUp).toContain('--- /list ---');
        expect(wrapper.instance().state.agentLogs.join('\n')).toContain('--- Tour 4 ---');
    });

    test('an empty answer warns instead of producing an empty frame', async () => {
        const {vm} = makeVM();
        AIAgent.setVM(vm);
        const wrapper = shallow(<AIAgentModalComponent vm={vm} onClose={() => {}} />);
        wrapper.instance().setState({activeTab: 'agent', agentResponse: '   '});
        await wrapper.instance().handleRunAgentTurn();
        wrapper.update();
        expect(wrapper.instance().state.agentFollowUp).toBe('');
        expect(wrapper.instance().state.agentLogs.join('\n')).toContain('Collez d\'abord');
    });

    test('the CLI console and the sprite inspector are gone', () => {
        const {vm} = makeVM();
        AIAgent.setVM(vm);
        const wrapper = shallow(<AIAgentModalComponent vm={vm} onClose={() => {}} />);
        const instance = wrapper.instance();
        expect(instance.renderCliTab).toBeUndefined();
        expect(instance.renderInspectorTab).toBeUndefined();
        expect(instance.handleCliKeyDown).toBeUndefined();
        wrapper.instance().setState({activeTab: 'assistant'});
        wrapper.update();
        const body = shallow(<div>{wrapper.find('ModalComponent').props().children}</div>);
        expect(body.text()).not.toContain('Console CLI');
        expect(body.text()).not.toContain('Inspecteur');
        // Both remaining tabs are reachable.
        expect(body.text()).toContain('Assistant IA');
        expect(body.text()).toContain('Mode agent');
    });
});
