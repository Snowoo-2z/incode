/**
 * @fileoverview Main entry point for the Scratch AI Agent.
 * Exposes inspection, prompt generation, code execution, and pre-built templates.
 */

import {readTarget, readAllTargets, formatProjectSummary} from './sprite-reader.js';
import {interpretAndExecute} from './code-interpreter.js';
import {generateAIPrompt, generateContinuationPrompt, generateFollowUpPrompt, generateAgentPrompt, generateAgentFollowUp} from './prompt-generator.js';
import {runAgentRequests, stripAgentRequests, formatProjectOverview} from './agent-protocol.js';
import {PONG_GAME_TEMPLATE, CLICKER_GAME_TEMPLATE} from './templates.js';

class AIAgentManager {
    constructor () {
        this.vm = null;
        this.lastReport = null;
    }

    setVM (vm) {
        this.vm = vm;
        if (typeof window !== 'undefined') {
            window.AIAgent = this;
            if (vm) vm.aiAgent = this;
        }
    }

    getVM () {
        return this.vm || (typeof window !== 'undefined' ? window.vm : null);
    }

    /**
     * Reads all targets and returns structured data
     */
    getTargets () {
        return readAllTargets(this.getVM());
    }

    /**
     * Reads a single sprite or the stage
     */
    readSprite (nameOrId) {
        const vm = this.getVM();
        if (!vm || !vm.runtime || !vm.runtime.targets) return null;
        const target = vm.runtime.targets.find(t => {
            const name = t.getName ? t.getName() : '';
            return name.toLowerCase() === String(nameOrId).toLowerCase() || t.id === nameOrId;
        });
        return readTarget(target);
    }

    /**
     * Returns the formatted human-readable summary of the project
     */
    getProjectSummary () {
        return formatProjectSummary(this.getVM());
    }

    /**
     * Generates the FULL prompt (documentation + project state) to copy and
     * send to an external AI: this is the first message of a conversation.
     * @param {string} userGoal what the user wants to build
     * @returns {string} prompt to copy
     */
    generatePrompt (userGoal) {
        return generateAIPrompt(this.getVM(), userGoal);
    }

    /**
     * Generates the SHORT prompt for an ongoing conversation: only the current
     * project state (the AI already received the documentation).
     * @param {string} [userNote] what to do next
     * @returns {string} prompt to copy
     */
    generateContinuationPrompt (userNote = '') {
        return generateContinuationPrompt(this.getVM(), userNote, this.lastReport);
    }

    /**
     * Generates a follow-up prompt with previous results to continue the conversation
     * @param {string} [userNote] what to do next
     * @returns {string} prompt to copy
     */
    generateFollowUpPrompt (userNote = '') {
        return generateFollowUpPrompt(this.getVM(), this.lastReport, userNote);
    }

    /**
     * Executes AI-generated code or commands
     */
    async execute (input) {
        const report = await interpretAndExecute(input, this.getVM());
        this.lastReport = report;
        return report;
    }

    /**
     * Returns the LIGHT project overview used by the agent mode: one line per
     * sprite, no code. The AI asks for the rest with `/read`.
     * @returns {string} overview
     */
    getProjectOverview () {
        return formatProjectOverview(this.getVM());
    }

    /**
     * Generates the AGENT prompt: documentation + light overview + tools.
     * @param {string} userGoal what the user wants to build
     * @returns {string} prompt to copy as the first message of a conversation
     */
    generateAgentPrompt (userGoal) {
        return generateAgentPrompt(this.getVM(), userGoal);
    }

    /**
     * Runs one turn of the agent loop over an AI answer:
     *  1. every `/…` tool call is executed locally and its answer collected,
     *  2. the rest of the answer is ScratchScript/JSON and is applied,
     *  3. a "paste this in the same conversation" prompt is built so the loop
     *     can continue (that prompt is what closes the agent cycle).
     * @param {string} aiResponse raw answer pasted by the user
     * @returns {Promise<object>} {answers, requests, unknown, code, report, followUp}
     */
    async runAgentTurn (aiResponse) {
        const vm = this.getVM();
        const {answers, requests, unknown} = runAgentRequests(aiResponse, vm);
        const code = stripAgentRequests(aiResponse);

        let report = null;
        if (code.trim()) {
            report = await this.execute(code);
        }

        return {
            answers,
            requests,
            unknown,
            code,
            report,
            // The follow-up only makes sense once the code has been applied:
            // it carries the tool answers AND the state after execution.
            followUp: generateAgentFollowUp(vm, answers, report, unknown)
        };
    }

    /**
     * Builds the follow-up prompt from tool answers (no execution).
     * @param {Array<string>} answers tool results
     * @param {Array<string>} [unknown] unrecognised /commands
     * @returns {string} prompt to paste back in the same conversation
     */
    generateAgentFollowUp (answers, unknown = []) {
        return generateAgentFollowUp(this.getVM(), answers, this.lastReport, unknown);
    }

    /**
     * Returns pre-built templates
     */
    getTemplates () {
        return {
            pong: PONG_GAME_TEMPLATE,
            clicker: CLICKER_GAME_TEMPLATE
        };
    }
}

const AIAgent = new AIAgentManager();

// Automatically attach to window if available
if (typeof window !== 'undefined') {
    window.AIAgent = AIAgent;
}

export default AIAgent;
export {
    AIAgent,
    readTarget,
    readAllTargets,
    formatProjectSummary,
    formatProjectOverview,
    interpretAndExecute,
    generateAIPrompt,
    generateContinuationPrompt,
    generateFollowUpPrompt,
    generateAgentPrompt,
    generateAgentFollowUp,
    runAgentRequests,
    stripAgentRequests,
    PONG_GAME_TEMPLATE,
    CLICKER_GAME_TEMPLATE
};
