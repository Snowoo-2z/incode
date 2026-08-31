/**
 * @fileoverview Main entry point for the Scratch AI Agent.
 * Exposes inspection, prompt generation, code execution, and pre-built templates.
 */

import {readTarget, readAllTargets, formatProjectSummary} from './sprite-reader.js';
import {interpretAndExecute} from './code-interpreter.js';
import {generateAIPrompt, generateContinuationPrompt, generateFollowUpPrompt, generateAgentPrompt, generateAgentFollowUp, generateWebModePrompt} from './prompt-generator.js';
import {runAgentRequests, stripAgentRequests, formatProjectOverview} from './agent-protocol.js';
import {transpileWebProject} from './html-to-scratch.js';
import {PONG_GAME_TEMPLATE, CLICKER_GAME_TEMPLATE, WEB_PONG_TEMPLATE, WEB_CLICKER_TEMPLATE} from './templates.js';

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
     * WEB MODE: transpiles a raw HTML/CSS/JS paste into agent actions, then
     * executes them exactly like a JSON/DSL answer. The browser lays the page
     * out in a hidden 480x360 iframe (the stage size): every game object
     * becomes a sprite with an SVG costume capturing its look, and the JS is
     * compiled into blocks (whenFlag/forever/if/keyPressed...).
     * @param {{code?: string, html?: string, css?: string, js?: string}} source
     * @returns {Promise<object>} execution report (with conversion stats)
     */
    async executeWeb (source) {
        const conversion = transpileWebProject(source);
        const payload = {actions: conversion.actions};
        const report = await interpretAndExecute(
            JSON.stringify(payload), this.getVM());
        report.stats = conversion.stats;
        report.conversionWarnings = conversion.warnings;
        // Surface conversion warnings at the top of the journal.
        report.logs.unshift(...(conversion.warnings || []));
        this.lastReport = report;
        return report;
    }

    /**
     * Dry-run of the web transpiler: returns the actions + warnings WITHOUT
     * touching the project, useful to preview a conversion.
     * @param {object} source web code
     * @returns {object} {actions, warnings, stats}
     */
    previewWeb (source) {
        return transpileWebProject(source);
    }

    /**
     * Generates the prompt that tells an external AI to answer in the web
     * dialect (HTML/CSS/JS) instead of ScratchScript/JSON.
     * @param {string} userGoal what the user wants to build
     * @returns {string} prompt to copy
     */
    generateWebPrompt (userGoal) {
        return generateWebModePrompt(this.getVM(), userGoal);
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
            clicker: CLICKER_GAME_TEMPLATE,
            webPong: WEB_PONG_TEMPLATE,
            webClicker: WEB_CLICKER_TEMPLATE
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
    transpileWebProject,
    PONG_GAME_TEMPLATE,
    CLICKER_GAME_TEMPLATE,
    WEB_PONG_TEMPLATE,
    WEB_CLICKER_TEMPLATE
};
