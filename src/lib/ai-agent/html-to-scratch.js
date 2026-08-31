/**
 * @fileoverview Web mode entry point: HTML/CSS/JS -> agent actions.
 *
 * Combines:
 *  - `html-render.js`: loads the page in a hidden 480x360 iframe (the Scratch
 *    stage size), reads the layout the browser computed, and turns every game
 *    object into a sprite with SVG costume(s) (including :hover/:active looks
 *    for buttons).
 *  - `html-transpiler.js`: parses the JS with Acorn and compiles it to block
 *    specs / hats.
 *
 * The output is the very same action list the JSON & DSL paths feed into
 * `interpretAndExecute()`: CREATE_VAR / CREATE_SPRITE (with costumes) /
 * ADD_SCRIPT ... so nothing downstream changes.
 */

import {extractScene, STAGE_WIDTH, STAGE_HEIGHT} from './html-render.js';
import {Transpiler} from './html-transpiler.js';

/**
 * Turns a lowercased script key back into a readable sprite name
 * (JS-only sprites never existed in the HTML, so their casing was lost).
 * @param {string} key script key, e.g. "raquetteg"
 * @returns {string} readable name, e.g. "Raquetteg"
 */
const prettySpriteName = key => {
    const name = String(key || 'sprite');
    return name.charAt(0).toUpperCase() + name.slice(1);
};

/**
 * Extracts the JS out of a full document even when html-render could not build
 * an iframe (Node unit tests): looks for the last <script> block.
 * @param {string} raw full paste
 * @returns {string} js
 */
const fallbackJs = raw => {
    const matches = String(raw || '').match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
    return matches.map(m => m.replace(/<\/?script[^>]*>/gi, '')).join('\n');
};

/**
 * Transpiles a web project (HTML + CSS + JS) into agent actions.
 *
 * @param {{code?: string, html?: string, css?: string, js?: string}} source
 * @returns {{
 *   actions: Array<object>,
 *   warnings: Array<string>,
 *   stats: {sprites: number, scripts: number, variables: number, lists: number, costumes: number}
 * }}
 */
const transpileWebProject = source => {
    const warnings = [];
    const scene = extractScene(source);
    // The rendered iframe is only needed for extraction: free it immediately
    // so conversions do not leave hidden 480x360 documents in the DOM.
    try {
        if (scene.cleanup) scene.cleanup();
    } catch (e) {
        warnings.push(`⚠ Nettoyage de l'iframe de rendu impossible : ${e.message}`);
    }
    warnings.push(...(scene.warnings || []));
    const js = scene.js || fallbackJs(source && (source.code || source.html) || '');

    const spriteNames = (scene.sprites || []).map(s => s.name);
    const transpiler = new Transpiler(spriteNames);
    const result = transpiler.transpile(js);
    warnings.push(...(result.warnings || []));

    const actions = [];

    // ---- 1. Variables and lists (declared first so every block resolves) --
    for (const v of result.variables) {
        const value = normalizeLiteral(v.value);
        actions.push({type: 'CREATE_VAR', name: v.name, value});
    }
    for (const list of result.lists) {
        actions.push({
            type: 'CREATE_LIST',
            name: list.name,
            value: (list.items || []).map(normalizeLiteral)
        });
    }
    // Note: showVariable('x') calls are already compiled to data_showvariable
    // blocks that run under the green-flag hat, so no runtime action is needed.

    // ---- 2. Sprites (visual look from the rendered page) ------------------
    for (const sprite of scene.sprites || []) {
        actions.push({
            type: 'CREATE_SPRITE',
            name: sprite.name,
            x: sprite.x,
            y: sprite.y,
            direction: sprite.direction,
            visible: sprite.visible,
            // Ship the costumes: costume1 is the normal look; buttons also get
            // their hover/active looks so blocks can swap costumes.
            costumes: sprite.costumes.map(c => ({name: c.name, svg: c.svg})),
            // Do NOT apply a default shape: the SVG costume is the visual.
            shape: null
        });
        // Initial position / direction are set by CREATE_SPRITE; also add a
        // "don't rotate" rotation style so motion blocks never tilt the
        // pixel-captured costume when direction changes are not intended.
        // (Done as a block below only when scripts exist for this sprite.)
    }

    // ---- 2b. Implicit sprites: referenced by the JS (sprite methods,
    // .x/.y assignments, hats...) without an HTML element, e.g. when the
    // page has no matching id (or the extraction ran without a DOM). Create
    // them with a default visible shape so they exist on the stage.
    const htmlSpriteKeys = new Set(
        (scene.sprites || []).map(s => s.name.toLowerCase()));
    for (const spriteKey of result.scripts.keys()) {
        if (spriteKey === '__stage__') continue;
        if (!htmlSpriteKeys.has(spriteKey)) {
            actions.push({
                type: 'CREATE_SPRITE',
                // Script keys are lowercased; give the sprite a readable name.
                name: prettySpriteName(spriteKey),
                x: 0,
                y: 0
            });
        }
    }

    // ---- 3. Stage backdrop (painted page background) ----------------------
    if (scene.backdrop) {
        actions.push({
            type: 'CREATE_COSTUME',
            sprite: 'stage',
            name: 'backdrop1',
            svg: scene.backdrop.svg
        });
    }

    // ---- 4. Scripts (one ADD_SCRIPT per hat stack) ------------------------
    let scriptsCount = 0;
    // Map script keys to the actual sprite names (HTML keeps its id casing).
    const spriteNameByKey = new Map();
    for (const s of scene.sprites || []) spriteNameByKey.set(s.name.toLowerCase(), s.name);
    for (const [spriteKey, stacks] of result.scripts.entries()) {
        const actualName = spriteNameByKey.get(spriteKey) ||
            (spriteKey === '__stage__' ? 'stage' : prettySpriteName(spriteKey));
        for (const stack of stacks) {
            if (!stack || !stack.length) continue;
            // Prepend the rotation-style safety for moving sprites that carry
            // a captured costume (so it never tilts from direction changes).
            const finalStack = maybeRotationStyle(actualName, stack, spriteNames);
            actions.push({
                type: 'ADD_SCRIPT',
                sprite: actualName,
                blocks: finalStack
            });
            scriptsCount++;
        }
    }

    // ---- 5. Button hover/active costume swapping --------------------------
    for (const sprite of scene.sprites || []) {
        if (!sprite.button || sprite.costumes.length < 2) continue;
        const hasHover = sprite.costumes.some(c => c.name === 'survol');
        const hasActive = sprite.costumes.some(c => c.name === 'actif');
        const blocks = [
            {opcode: 'event_whenflagclicked'},
            {opcode: 'looks_switchcostumeto', inputs: {COSTUME: 'costume1'}},
            {
                opcode: 'control_forever',
                inputs: {
                    SUBSTACK: buildButtonStateBlocks(hasHover, hasActive)
                }
            }
        ];
        actions.push({type: 'ADD_SCRIPT', sprite: sprite.name, blocks});
        scriptsCount++;
    }

    // Stats (sprite count includes JS-only/implicit sprites)
    const costumes = (scene.sprites || []).reduce((n, s) => n + s.costumes.length, 0);
    const implicitSpriteCount = [...result.scripts.keys()]
        .filter(k => k !== '__stage__' && !htmlSpriteKeys.has(k)).length;
    return {
        actions,
        warnings,
        stats: {
            sprites: (scene.sprites || []).length + implicitSpriteCount,
            scripts: scriptsCount,
            variables: result.variables.length,
            lists: result.lists.length,
            costumes
        },
        scene
    };
};

/**
 * Builds the forever-loop blocks that mimic :hover/:active with costumes.
 */
const buildButtonStateBlocks = (hasHover, hasActive) => {
    const blocks = [];
    if (hasActive) {
        blocks.push({
            opcode: 'control_if',
            inputs: {
                CONDITION: {
                    opcode: 'operator_and',
                    inputs: {
                        OPERAND1: {opcode: 'sensing_mousedown'},
                        OPERAND2: mouseOverReporter()
                    }
                },
                SUBSTACK: [
                    {opcode: 'looks_switchcostumeto', inputs: {COSTUME: 'actif'}}
                ]
            }
        });
    }
    if (hasHover) {
        blocks.push({
            opcode: 'control_if',
            inputs: {
                CONDITION: mouseOverReporter(),
                SUBSTACK: [
                    {opcode: 'looks_switchcostumeto', inputs: {COSTUME: hasActive ? 'survol' : 'survol'}}
                ]
            }
        });
    }
    // Fall back to normal look when the mouse is away.
    blocks.push({
        opcode: 'control_if',
        inputs: {
            CONDITION: {
                opcode: 'operator_not',
                inputs: {OPERAND: mouseOverReporter()}
            },
            SUBSTACK: [
                {opcode: 'looks_switchcostumeto', inputs: {COSTUME: 'costume1'}}
            ]
        }
    });
    return blocks;
};

/**
 * "Mouse over this sprite" -> Scratch has no direct block; approximate with
 * distance to mouse pointer < half the costume diagonal.
 */
const mouseOverReporter = () => ({
    opcode: 'operator_lt',
    inputs: {
        OPERAND1: {opcode: 'sensing_distanceto', fields: {DISTANCETOMENU: '_mouse_'}},
        OPERAND2: 60
    }
});

/**
 * Adds a "don't rotate" style block at the start of flag scripts of sprites,
 * so captured costumes never tilt when the code sets a direction.
 */
const maybeRotationStyle = (targetName, stack, spriteNames) => {
    if (targetName === 'stage') return stack;
    // Scripts are routed with LOWERCASED sprite keys; compare case-insensitively.
    const lower = String(targetName).toLowerCase();
    if (!spriteNames.map(n => n.toLowerCase()).includes(lower)) {
        return stack;
    }
    // Only when the script starts with the flag hat.
    if (stack[0] && stack[0].opcode === 'event_whenflagclicked') {
        const hasStyle = stack.some(b => b.opcode === 'motion_setrotationstyle');
        if (!hasStyle) {
            return [
                stack[0],
                {opcode: 'motion_setrotationstyle', fields: {STYLE: "don't rotate"}},
                ...stack.slice(1)
            ];
        }
    }
    return stack;
};

/**
 * Reduces transpiled values to JSON-safe literals for CREATE_VAR. Reporter
 * blocks can't be initial values; they are replaced by 0 (the block-builder
 * only runs inside scripts).
 */
const normalizeLiteral = value => {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    if (Array.isArray(value)) return value.map(normalizeLiteral);
    // A block spec ({opcode}) as an initializer: default to 0/''.
    if (typeof value === 'object' && value.opcode) return 0;
    return String(value);
};

export {
    transpileWebProject,
    STAGE_WIDTH,
    STAGE_HEIGHT
};
