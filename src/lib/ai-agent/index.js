/**
 * @fileoverview Main entry point for the Scratch AI Agent.
 * Exposes inspection, prompt generation, code execution, and pre-built templates.
 */

import {readTarget, readAllTargets, formatProjectSummary} from './sprite-reader.js';
import {interpretAndExecute} from './code-interpreter.js';
import {generateAIPrompt, generateFollowUpPrompt} from './prompt-generator.js';
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
     * Generates a prompt ready to copy and send to an external AI
     */
    generatePrompt (userGoal) {
        return generateAIPrompt(this.getVM(), userGoal);
    }

    /**
     * Generates a follow-up prompt with previous results to continue the conversation
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
    interpretAndExecute,
    generateAIPrompt,
    generateFollowUpPrompt,
    PONG_GAME_TEMPLATE,
    CLICKER_GAME_TEMPLATE
};
