/**
 * @fileoverview Agent protocol for the AI Agent terminal.
 *
 * WHY THIS EXISTS
 * The classic mode dumps the WHOLE project in the prompt. That is fine for a
 * small project and hopeless for a big one: a 40-sprite game with long scripts
 * produces tens of thousands of tokens of context the AI mostly ignores, and it
 * blows the context window before doing any work.
 *
 * The agent mode sends a tiny overview instead, and the AI asks for what it
 * needs, exactly like a developer greps a codebase:
 *
 *     /list                  one line per sprite
 *     /read Balle            everything about ONE sprite (addressed scripts)
 *     /vars                  global variables and lists, with their values
 *     /search rebond         every sprite/script mentioning "rebond"
 *
 * The AI writes those lines in its answer; the terminal runs them locally and
 * hands the results back with a "paste this in the same conversation" prompt.
 * Nothing here talks to an LLM: it is a read-only query layer over the VM.
 */

import {readTarget, readAllTargets, formatAddressedScripts} from './sprite-reader.js';
import {getCostumeSvg} from './sprite-costumes.js';

/** Every tool the AI may call, with the doc line shown in the prompt. */
const AGENT_TOOLS = {
    list: {
        args: '',
        doc: '/list                  -> une ligne par sprite (taille, scripts, costumes, variables)'
    },
    read: {
        args: '<sprite>',
        doc: '/read <sprite>         -> TOUT un sprite : propriétés, variables, costumes et scripts ADRESSÉS'
    },
    vars: {
        args: '',
        doc: '/vars                  -> variables et listes globales avec leurs valeurs'
    },
    search: {
        args: '<mot>',
        doc: '/search <mot>          -> les sprites et les lignes de script qui contiennent ce mot'
    },
    costume: {
        args: '<sprite> [<costume>]',
        doc: '/costume <sprite> [<costume>] -> le code SVG du costume (tous si pas de nom)'
    }
};

/** French / short aliases accepted for each tool. */
const TOOL_ALIASES = {
    list: ['list', 'liste', 'ls', 'sprites'],
    read: ['read', 'lire', 'sprite', 'show'],
    vars: ['vars', 'variables', 'var'],
    search: ['search', 'cherche', 'grep', 'find'],
    costume: ['costume', 'costumes', 'svg', 'lirecostume', 'backdrop']
};

/**
 * Builds the documentation block listing the tools.
 * @returns {string} doc
 */
const agentToolsDoc = () => {
    const lines = Object.values(AGENT_TOOLS).map(tool => `  ${tool.doc}`);
    return lines.join('\n');
};

/**
 * Extracts the tool calls from an AI answer.
 * A call is a line starting with `/` (optionally inside a ```text fence or a
 * sentence), e.g. `/read Balle`. Unknown `/commands` are reported so the user
 * can see the AI tried something we do not support.
 * @param {string} text raw AI answer
 * @returns {{requests: Array<{tool: string, arg: string, raw: string}>, unknown: Array<string>}} parsed calls
 */
const parseAgentRequests = text => {
    const requests = [];
    const unknown = [];
    const aliasToTool = {};
    for (const [tool, aliases] of Object.entries(TOOL_ALIASES)) {
        for (const alias of aliases) aliasToTool[alias] = tool;
    }

    const lines = String(text || '').split(/\r?\n/);
    for (const line of lines) {
        const match = line.match(/^\s*(?:[-*>]\s*)?\/([a-z]+)\b\s*(.*)$/i);
        if (!match) continue;
        const raw = line.trim();
        const word = match[1].toLowerCase();
        const bare = match[2].trim();
        const arg = bare.replace(/^["']|["']$/g, '').replace(/["']/g, '');
        const tool = aliasToTool[word];
        if (!tool) {
            unknown.push(raw);
            continue;
        }
        requests.push({tool, arg, raw});
    }
    return {requests, unknown};
};

/**
 * Removes the tool-call lines from an answer, leaving the code to execute.
 * @param {string} text raw AI answer
 * @returns {string} the same answer without the /commands
 */
const stripAgentRequests = text => String(text || '')
    .split(/\r?\n/)
    .filter(line => !/^\s*(?:[-*>]\s*)?\/[a-z]+\b/i.test(line))
    .join('\n')
    .trim();

/**
 * Light project overview: what each sprite IS, without a single line of code.
 * @param {object} vm Scratch VM
 * @returns {string} overview
 */
const formatProjectOverview = vm => {
    const targets = readAllTargets(vm);
    if (!targets.length) return 'Le projet Scratch est vide.';

    const stage = targets.find(t => t.isStage);
    const sprites = targets.filter(t => !t.isStage);
    const out = [`Sprites : ${sprites.length} | Arrière-plans : ${stage ? stage.costumes.length : 0}`];

    if (stage) {
        out.push(`  [SCÈNE] scripts=${stage.scripts.length} blocs=${stage.blocksCount} ` +
            `arrière-plans=${stage.costumes.length || 0} variables=${stage.variables.length}`);
    }
    for (const sp of sprites) {
        out.push(`  [SPRITE] "${sp.name}" x=${sp.x} y=${sp.y} taille=${sp.size}% ` +
            `scripts=${sp.scripts.length} blocs=${sp.blocksCount} ` +
            `costumes=${sp.costumes.length} variables=${sp.variables.length}` +
            `${sp.visible ? '' : ' (caché)'}`);
    }
    return out.join('\n');
};

/**
 * One detailed read of a single target, with addressed scripts so the AI can
 * target an edit like `edit 1/3.1 move 25`.
 * @param {object} vm Scratch VM
 * @param {string} name sprite name (or "stage")
 * @returns {?string} detail, or null when the sprite does not exist
 */
/**
 * Finds a real VM target by name (case-insensitive), accepting "stage"/"scène".
 * Shared by `/read` and `/costume` so both resolve names exactly the same way.
 * @param {object} vm Scratch VM
 * @param {string} name sprite name
 * @returns {?object} the VM target, or null
 */
const findTargetByName = (vm, name) => {
    const vmTargets = (vm && vm.runtime && vm.runtime.targets) || [];
    const bare = String(name || '').trim();
    const wanted = bare.toLowerCase();
    let target = vmTargets.find(t => {
        const targetName = t.getName ? t.getName() : '';
        return String(targetName).toLowerCase() === wanted;
    });
    if (!target && /^(stage|sc[èe]ne)$/.test(wanted)) {
        target = vmTargets.find(t => t.isStage) || null;
    }
    return target || null;
};

/**
 * Lists the sprite names, for the "not found" messages.
 * @param {object} vm Scratch VM
 * @returns {string} quoted names
 */
const listSpriteNames = vm => {
    const names = readAllTargets(vm).map(t => `"${t.name}"`);
    return names.join(', ') || 'aucun';
};

const readTargetDetail = (vm, name) => {
    const real = findTargetByName(vm, name);
    if (!real) {
        return `⚠ Sprite "${name}" introuvable. Sprites disponibles : ${listSpriteNames(vm)}`;
    }
    const target = readTarget(real);
    const lines = [
        `=== SPRITE "${target.name}" (ID: ${target.id})${target.isStage ? ' — SCÈNE' : ''} ===`,
        `- Position : x=${target.x}, y=${target.y}, direction=${target.direction}°, ` +
            `taille=${target.size}%, visible=${target.visible ? 'oui' : 'non'}`,
        `- Costumes : ${target.costumes.map(c => c.name).join(', ') || 'aucun'}`,
        `- Sons : ${target.sounds.join(', ') || 'aucun'}`,
        `- Variables locales : ${
            target.variables.map(v => `${v.name} = ${JSON.stringify(v.value)}`).join(', ') || 'aucune'}`,
        `- Scripts : ${target.scripts.length} (${target.blocksCount} blocs)`
    ];
    const addressed = real ? formatAddressedScripts(real, '  ') : '';
    lines.push(addressed || '  (aucun script)');
    lines.push('Rappel : pour modifier un script, utilise les adresses ci-dessus, ex. `edit 1/3.1 move 25`.');
    if (target.costumes.length) {
        lines.push(`Pour LIRE ou modifier le dessin d'un costume : /costume ${target.name} ` +
            `<${target.costumes.map(c => c.name).join('|')}>`);
    }
    return lines.join('\n');
};

/**
 * Global variables and lists with their current values.
 * @param {object} vm Scratch VM
 * @returns {string} listing
 */
const readGlobalVariables = vm => {
    const targets = readAllTargets(vm);
    const stage = targets.find(t => t.isStage);
    if (!stage || !stage.variables.length) return 'Aucune variable globale.';
    const vars = stage.variables.filter(v => v.type !== 'list');
    const lists = stage.variables.filter(v => v.type === 'list');
    const out = ['=== VARIABLES GLOBALES ==='];
    out.push(vars.length ?
        vars.map(v => `  ${v.name} = ${JSON.stringify(v.value)}`).join('\n') :
        '  (aucune)');
    out.push('=== LISTES GLOBALES ===');
    out.push(lists.length ?
        lists.map(v => `  ${v.name} = [${(Array.isArray(v.value) ? v.value : []).join(', ')}]`).join('\n') :
        '  (aucune)');
    return out.join('\n');
};

/**
 * Reads the SVG source of one costume (or of all of them when no name is given).
 * This is what lets the AI *modify* an existing drawing instead of redrawing it
 * blind: it reads the SVG, edits the shapes, sends it back with
 * `costume "nom" = <svg .../>` which replaces the costume of that name.
 * @param {object} vm Scratch VM
 * @param {string} spriteName sprite owning the costume
 * @param {string} [costumeName] costume name or index; all costumes when empty
 * @returns {string} the SVG, or a listing
 */
const readCostumes = (vm, spriteName, costumeName = '') => {
    const real = findTargetByName(vm, spriteName);
    if (!real) {
        return `⚠ Sprite "${spriteName}" introuvable. Sprites disponibles : ${listSpriteNames(vm)}`;
    }
    const target = readTarget(real);
    if (!target.costumes.length) return `Le sprite "${target.name}" n'a aucun costume.`;

    const wanted = String(costumeName || '').trim();
    const names = wanted ? [wanted] : target.costumes.map(c => c.name);
    const out = [`=== COSTUMES DE "${target.name}" ===`];

    for (const name of names) {
        const info = getCostumeSvg(vm, real, name);
        if (!info) {
            out.push(`⚠ Costume "${name}" introuvable. Costumes : ${target.costumes.map(c => c.name).join(', ')}`);
            continue;
        }
        if (!info.svg) {
            out.push(`--- ${info.name} (index ${info.index + 1}) ---`);
            out.push(`⚠ Costume ${info.kind} : pas de code SVG à lire. ` +
                'Tu peux le remplacer par un SVG avec `costume "nom" = <svg .../>`.');
            continue;
        }
        out.push(`--- ${info.name} (index ${info.index + 1}, ${info.width}×${info.height}) ---`);
        out.push(info.svg);
        out.push(`Pour le modifier : costume "${info.name}" = <svg .../> ` +
            '(le costume de ce nom est remplacé, les autres sont conservés).');
    }
    return out.join('\n');
};

/**
 * Finds every sprite / script line mentioning a word. This is the tool that
 * makes a huge project navigable: the AI looks for "rebond" instead of reading
 * 40 sprites.
 * @param {object} vm Scratch VM
 * @param {string} query text to look for
 * @returns {string} matches grouped by sprite
 */
const searchProject = (vm, query) => {
    const bare = String(query || '').trim();
    const needle = bare.toLowerCase();
    if (!needle) return '⚠ /search demande un mot à chercher. Ex : /search rebond';

    const vmTargets = (vm && vm.runtime && vm.runtime.targets) || [];
    const targets = readAllTargets(vm);
    const out = [];
    let hits = 0;

    for (const target of targets) {
        const real = vmTargets.find(t => t.id === target.id);
        const found = [];

        const targetName = String(target.name).toLowerCase();
        if (targetName.includes(needle)) {
            found.push('  (le NOM du sprite correspond)');
        }
        for (const v of target.variables) {
            const varName = v.name.toLowerCase();
            if (varName.includes(needle)) {
                found.push(`  variable ${v.name} = ${JSON.stringify(v.value)}`);
            }
        }
        for (const c of target.costumes) {
            const costumeName = String(c.name).toLowerCase();
            if (costumeName.includes(needle)) found.push(`  costume ${c.name}`);
        }
        const addressed = real ? formatAddressedScripts(real, '') : '';
        for (const line of addressed.split('\n')) {
            if (line && line.toLowerCase().includes(needle)) found.push(`  ${line.trim()}`);
        }

        if (found.length) {
            hits += found.length;
            out.push(`SPRITE "${target.name}" :`, ...found);
        }
    }

    if (!hits) return `Aucun résultat pour "${query}".`;
    return `=== RÉSULTATS POUR "${query}" (${hits}) ===\n${out.join('\n')}`;
};

/**
 * Runs one tool call.
 * @param {{tool: string, arg: string}} request parsed call
 * @param {object} vm Scratch VM
 * @returns {string} answer
 */
const runAgentRequest = (request, vm) => {
    switch (request.tool) {
    case 'list':
        return formatProjectOverview(vm);
    case 'read':
        return request.arg ?
            readTargetDetail(vm, request.arg) :
            '⚠ /read demande un nom de sprite. Ex : /read Balle';
    case 'vars':
        return readGlobalVariables(vm);
    case 'search':
        return searchProject(vm, request.arg);
    case 'costume': {
        const parts = request.arg.split(/\s+/);
        const sprite = parts[0] || '';
        const costume = parts.slice(1).join(' ');
        return sprite ?
            readCostumes(vm, sprite, costume) :
            '⚠ /costume demande un nom de sprite. Ex : /costume Balle visage';
    }
    default:
        return `⚠ Outil inconnu : ${request.raw}`;
    }
};

/**
 * Runs every tool call of an answer, in order, and dedupes identical calls.
 * @param {string} text raw AI answer
 * @param {object} vm Scratch VM
 * @returns {{answers: Array<string>, requests: Array<object>, unknown: Array<string>}} results
 */
const runAgentRequests = (text, vm) => {
    const {requests, unknown} = parseAgentRequests(text);
    const answers = [];
    const seen = new Set();
    for (const request of requests) {
        const key = `${request.tool} ${request.arg}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        answers.push(`--- ${request.raw} ---\n${runAgentRequest(request, vm)}`);
    }
    return {answers, requests, unknown};
};

export {
    AGENT_TOOLS,
    agentToolsDoc,
    parseAgentRequests,
    stripAgentRequests,
    runAgentRequest,
    runAgentRequests,
    formatProjectOverview,
    readTargetDetail,
    readGlobalVariables,
    searchProject,
    readCostumes,
    findTargetByName
};
