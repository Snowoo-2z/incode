/**
 * @fileoverview HTML/CSS -> visual scene extraction for the web mode.
 *
 * WHY THIS EXISTS
 * The web mode lets an AI (or a user) write a game as a tiny HTML/CSS/JS page
 * and turn it into real Scratch blocks. Instead of *parsing* CSS ourselves
 * (flexbox, gradients, border-radius... would each need a reimplementation), we
 * let the BROWSER do the layout: the document is loaded inside a hidden iframe
 * sized exactly like the Scratch stage (480x360). We then read every element's
 * computed position and turn the visible look of each game object into an SVG
 * costume. The result: the Scratch stage looks like the web page, pixel for
 * pixel, while the logic side (JS -> blocks) lives in `html-transpiler.js`.
 *
 * This module only runs in a browser (DOMParser, iframe, getComputedStyle).
 * `html-transpiler.js` holds the pure logic and is unit-testable in Node.
 */

/** Scratch stage size, in CSS pixels = Scratch units. */
export const STAGE_WIDTH = 480;
export const STAGE_HEIGHT = 360;

/**
 * Elements matching one of these become Sprites. Everything else is either
 * folded into a parent's costume (plain decorative divs) or ignored.
 */
const SPRITE_TAGS = new Set(['button', 'img', 'input', 'a']);
/** Elements that may wrap sprites but are never sprites themselves. */
const CONTAINER_TAGS = new Set(['html', 'body', 'head', 'style', 'script', 'link', 'meta', 'title']);

/**
 * Splits a raw paste into html / css / js parts.
 * Accepts either a full HTML document (the `<style>` and `<script>` contents
 * are pulled out) OR already-separated fields.
 * @param {{html?: string, css?: string, js?: string, code?: string}} input
 * @returns {{html: string, css: string, js: string}} parts
 */
const splitSource = input => {
    const raw = String((input && (input.code || input.html)) || '');
    let css = String((input && input.css) || '');
    let js = String((input && input.js) || '');

    // Pull <style> / <script> blocks out of a full document.
    const styleMatches = raw.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
    for (const m of styleMatches) {
        css += '\n' + m.replace(/<\/?style[^>]*>/gi, '');
    }
    const scriptMatches = raw.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const m of scriptMatches) {
        js += '\n' + m.replace(/<\/?script[^>]*>/gi, '');
    }
    // The HTML body is everything that is not head/style/script.
    let html = raw
        .replace(/<head[\s\S]*?<\/head>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '');

    // When the paste is a bare fragment (no <html>/<body>), wrap it so the
    // iframe has a proper document.
    if (!/<body[\s>]/i.test(html)) {
        const fragment = html
            .replace(/<\/?html[^>]*>/gi, '')
            .trim();
        html = `<!DOCTYPE html><html><body>${fragment}</body></html>`;
    }
    return {html: html.trim(), css: css.trim(), js: js.trim()};
};

/**
 * Loads a document into a hidden 480x360 iframe and waits for layout.
 * @param {string} html full document
 * @param {string} css extra stylesheet
 * @returns {{iframe: HTMLIFrameElement, doc: Document, cleanup: Function}}
 */
const renderDocument = (html, css) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText =
        'position:fixed;left:-99999px;top:0;width:480px;height:360px;' +
        'border:0;visibility:hidden;pointer-events:none;';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    doc.open();
    doc.write(html);
    doc.close();

    if (css) {
        const styleEl = doc.createElement('style');
        styleEl.textContent = css;
        doc.head.appendChild(styleEl);
    }
    // Force a stage-like viewport: margin 0, dark background by default (the
    // Scratch stage is not white), absolute positioning context.
    const base = doc.createElement('style');
    base.textContent = `
        html, body { margin: 0; padding: 0; width: 480px; height: 360px; overflow: hidden; }
        body { background: #0f1b2d; }
        * { box-sizing: border-box; }
    `;
    doc.head.insertBefore(base, doc.head.firstChild);

    return {
        iframe,
        doc,
        cleanup: () => {
            if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        }
    };
};

/**
 * Decides whether an element should become its own Sprite.
 * Rule: it has an `id`, OR it is an inherently interactive/visual tag
 * (`<button>`, `<img>`...). Decorative elements (a coloured `<div>` panel with
 * no id, a title `<h1>`...) are NOT sprites: they are painted into the stage
 * backdrop so the scene keeps its background look without flooding the sprite
 * list with non-interactive objects.
 * @param {Element} el DOM element
 * @returns {boolean}
 */
const isSpriteElement = el => {
    const tag = el.tagName.toLowerCase();
    if (CONTAINER_TAGS.has(tag)) return false;
    if (SPRITE_TAGS.has(tag)) return true;
    return Boolean(el.id);
};

/**
 * Reads the rotation (degrees, CSS `transform: rotate(...)`) applied to an
 * element. Scratch direction matches CSS degrees (90 = pointing right) for
 * the "all around" rotation style, so the value is passed through.
 * @param {CSSStyleDeclaration} style computed style
 * @returns {number} direction in degrees (90 = default Scratch)
 */
const readRotation = style => {
    const match = String(style && style.transform || '').match(/rotate\(\s*([-\d.]+)deg/);
    if (match) {
        const deg = parseFloat(match[1]);
        if (isFinite(deg)) return ((deg % 360) + 360) % 360;
    }
    return 90;
};

/**
 * Reads the pseudo-state style of an element (`:hover`, `:active`). Returns
 * null when the page defines no rule for that state.
 * @param {Document} doc iframe document
 * @param {Element} el element
 * @param {string} pseudo ':hover' or ':active'
 * @returns {?CSSStyleDeclaration}
 */
const pseudoStyle = (doc, el, pseudo) => {
    try {
        for (const sheet of doc.styleSheets) {
            let rules;
            try {
                rules = sheet.cssRules;
            } catch (e) {
                continue; // cross-origin sheet
            }
            if (!rules) continue;
            for (const rule of rules) {
                if (!rule.selectorText || !rule.selectorText.includes(pseudo)) continue;
                const baseSelector = rule.selectorText.split(',').map(s => s.replace(/:(hover|active)\b/g, '').trim());
                if (baseSelector.some(sel => {
                    try {
                        return el.matches(sel);
                    } catch (e) {
                        return false;
                    }
                })) {
                    return rule.style;
                }
            }
        }
    } catch (e) {
        // CSSOM access can throw on odd inputs; the state is simply skipped.
    }
    return null;
};

const escapeXml = text => String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Converts a CSS color to an SVG-safe color (rgb()/rgba() are fine in SVG).
 * @param {string} color css color
 * @returns {string}
 */
const normalizeColor = color => {
    if (!color || color === 'rgba(0, 0, 0, 0)' || color === 'transparent') return '';
    return color;
};

/**
 * Splits a comma-separated list WITHOUT splitting commas inside parentheses
 * (needed for `rgba(0, 0, 0, 0.5)` and nested `linear-gradient(...)` stops).
 */
const splitTopLevelCommas = text => {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of String(text)) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) {
            parts.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
};

/**
 * Builds an SVG <linearGradient>/<radialGradient> def from a computed
 * `background-image: ...gradient(...)` value. Returns {id, fill} (fill =
 * `url(#id)`) or null when the value is not a supported gradient.
 *
 * Each generated gradient is pushed into `defs` (shared across the whole
 * capture: unused defs are harmless inside an SVG).
 */
const buildGradientDef = (backgroundImage, defs) => {
    const value = String(backgroundImage || '');
    const linear = value.match(/linear-gradient\(([\s\S]*)\)/i);
    const radial = value.match(/radial-gradient\(([\s\S]*)\)/i);
    if (!linear && !radial) return null;

    const id = `grad${defs.length + 1}`;
    const inner = linear ? linear[1] : radial[1];
    const tokens = splitTopLevelCommas(inner);

    // Optional first token: angle ("45deg", "to right") for linear gradients.
    let angle = 180; // CSS default: top -> bottom
    let stops = tokens;
    if (linear) {
        const first = tokens[0] || '';
        const deg = first.match(/^([-\d.]+)deg/i);
        const dir = first.match(/^to\s+(.+)$/i);
        if (deg) {
            angle = parseFloat(deg[1]);
            stops = tokens.slice(1);
        } else if (dir) {
            const directions = {
                top: 0, bottom: 180, left: 270, right: 90,
                'top right': 45, 'right top': 45,
                'bottom right': 135, 'right bottom': 135,
                'bottom left': 225, 'left bottom': 225,
                'top left': 315, 'left top': 315
            };
            const mapped = directions[dir[1].trim().toLowerCase()];
            if (mapped !== undefined) {
                angle = mapped;
                stops = tokens.slice(1);
            }
        }
    }

    const stopMarkup = stops.map((stop, i) => {
        // A stop reads like "rgb(255,0,0) 40%" or "#fff" or "red to ...".
        const posMatch = stop.match(/(\d+(?:\.\d+)?)%\s*$/);
        const offset = posMatch ? parseFloat(posMatch[1]) : (i / Math.max(1, stops.length - 1)) * 100;
        const color = normalizeColor(posMatch ? stop.slice(0, stop.length - posMatch[0].length).trim() : stop);
        return `<stop offset="${Math.max(0, Math.min(100, offset)).toFixed(1)}%" stop-color="${escapeXml(color || '#888888')}"/>`;
    }).join('');

    if (linear) {
        // CSS angle: 0deg = to top, 90deg = to right. SVG y axis points down,
        // so the end vector is (sin, -cos) in objectBoundingBox coordinates.
        const rad = angle * Math.PI / 180;
        const dx = Math.sin(rad);
        const dy = -Math.cos(rad);
        defs.push(`<linearGradient id="${id}" x1="${(0.5 - dx / 2).toFixed(3)}" ` +
            `y1="${(0.5 - dy / 2).toFixed(3)}" x2="${(0.5 + dx / 2).toFixed(3)}" ` +
            `y2="${(0.5 + dy / 2).toFixed(3)}">${stopMarkup}</linearGradient>`);
    } else {
        defs.push(`<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">${stopMarkup}</radialGradient>`);
    }
    return {id, fill: `url(#${id})`};
};

/**
 * Builds an SVG snippet for ONE element inside a capture box.
 * Decorative children (non-sprites) are recursed into; nested sprites are
 * skipped (they get their own costume).
 *
 * @param {Document} doc iframe document
 * @param {Element} el element to paint
 * @param {object} box capture box: {left, top, width, height, __el, __sprites}
 * @param {object} overrides style overrides (used for :hover/:active variants)
 * @param {Array<string>} warnings accumulator
 * @param {Array<string>} defs shared gradient defs accumulator
 * @returns {string} SVG body markup
 */
const paintElement = (doc, el, box, overrides, warnings, defs = []) => {
    const tag = el.tagName.toLowerCase();
    if (CONTAINER_TAGS.has(tag)) return '';
    // A nested element that is its own sprite is NOT painted here: it lives in
    // its own sprite/costume. (`box.__el` is the capture root itself.)
    if (el !== box.__el && box.__sprites && box.__sprites.has(el)) return '';

    const base = getComputedStyle(el);
    const st = name => {
        if (overrides && typeof overrides[name] === 'string' && overrides[name] !== '') {
            return overrides[name];
        }
        return base[name];
    };

    const rect = el.getBoundingClientRect();
    const x = rect.left - box.left;
    const y = rect.top - box.top;
    const w = rect.width;
    const h = rect.height;
    let out = '';

    const bg = normalizeColor(st('backgroundColor'));
    const radius = parseFloat(base.borderTopLeftRadius) || 0;
    const borderColor = normalizeColor(st('borderColor'));
    const borderWidth = parseFloat(st('borderWidth')) || 0;

    // A CSS gradient (background-image) becomes an SVG gradient fill.
    const gradient = buildGradientDef(st('backgroundImage'), defs);
    const hasVisibleBg = bg || gradient;

    if (hasVisibleBg || (borderColor && borderWidth)) {
        const fill = gradient ? gradient.fill : (bg || 'none');
        const stroke = borderColor && borderWidth ?
            ` stroke="${escapeXml(borderColor)}" stroke-width="${borderWidth}"` : '';
        out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" ` +
            `height="${h.toFixed(1)}" rx="${Math.min(radius, w / 2, h / 2).toFixed(1)}" ` +
            `fill="${fill === 'none' ? 'none' : escapeXml(fill)}"${stroke}/>`;
    }

    if (tag === 'img') {
        const src = el.getAttribute('src') || '';
        if (/^data:image\//i.test(src)) {
            out += `<image x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" ` +
                `height="${h.toFixed(1)}" preserveAspectRatio="xMidYMid meet" href="${escapeXml(src)}"/>`;
        } else if (src) {
            warnings.push(`⚠ Image "${src}" ignorée : seules les images data-URI (intégrées) sont ` +
                'supportées dans les costumes.');
        }
    }

    // Text content. Only paint text the element OWNS directly (a text node
    // child of its own), so a wrapper div containing a <p> and a <div id=sprite>
    // does not duplicate the inner text; leaves paint it themselves.
    const directText = [...el.childNodes]
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent)
        .join('')
        .trim();
    if (directText && tag !== 'img') {
        const fontSize = parseFloat(st('fontSize')) || 16;
        const color = normalizeColor(st('color')) || '#ffffff';
        const align = st('textAlign') || 'center';
        const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
        const tx = align === 'left' ? x + 4 : align === 'right' ? x + w - 4 : x + w / 2;
        const ty = y + h / 2 + fontSize * 0.35;
        const weight = st('fontWeight') === 'bold' || parseFloat(st('fontWeight')) >= 600 ?
            ' font-weight="bold"' : '';
        out += `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" ` +
            `font-family="sans-serif" font-size="${fontSize.toFixed(1)}" ` +
            `fill="${escapeXml(color)}" text-anchor="${anchor}"${weight}>${escapeXml(directText)}</text>`;
    }

    // Recurse into decorative descendants.
    for (const child of el.children) {
        out += paintElement(doc, child, box, overrides, warnings, defs);
    }
    return out;
};

/** Number of costumes sampled for a CSS-animated sprite. */
const ANIMATION_FRAMES = 6;
/** Longest animation sampled (seconds); longer loops are truncated. */
const MAX_ANIMATION_SECONDS = 3;

/**
 * Returns the Web Animations running on an element itself (not descendants),
 * as plain objects so they can be paused/restored robustly.
 */
const ownAnimations = (el, doc) => {
    if (typeof el.getAnimations !== 'function') return [];
    try {
        return el.getAnimations({subtree: false}).filter(a =>
            a.playState === 'running' || a.playState === 'paused');
    } catch (e) {
        return [];
    }
};

/**
 * Samples an animated sprite into several costumes: CSS `@keyframes` / CSS
 * transitions animate over time; we capture the element (and its descendants,
 * clipped to the sprite box) at N equally spaced points of the animation loop
 * and return one SVG per frame, painted against the UNION box so no frame
 * crops the element.
 *
 * @param {Element} el animated sprite element
 * @param {DOMRect} baseRect element's base rect
 * @param {Set} spriteSet all sprite elements (skip nested sprites)
 * @param {Document} doc iframe document
 * @param {Array<string>} warnings accumulator
 * @returns {?{costumes: Array<{name: string, svg: string}>, box: DOMRect}}
 */
const captureAnimationFrames = (el, baseRect, spriteSet, doc, warnings) => {
    if (typeof el.getAnimations !== 'function') return null;

    const animations = ownAnimations(el, doc);
    if (!animations.length) return null;

    // Only CSS keyframe animations / transitions applied to the element
    // itself (descendant animations animate separate nodes, which are painted
    // in place already).
    const effects = animations.filter(a => a.effect && typeof a.effect.getTiming === 'function');
    if (!effects.length) return null;

    const totalDuration = effects.reduce((max, a) => {
        const timing = a.effect.getTiming();
        // duration is in ms for WAAPI, or null for auto.
        const d = typeof timing.duration === 'number' ? timing.duration / 1000 : 0;
        const iterations = timing.iterations === Infinity ? 1 : (timing.iterations || 1);
        return Math.max(max, d * iterations);
    }, 0);
    const cycleSeconds = Math.min(totalDuration || 1, MAX_ANIMATION_SECONDS);
    const cycleMs = Math.max(100, cycleSeconds * 1000);

    // Measure the union box: the element may translate/scale across frames.
    const pausedStates = effects.map(a => ({a, wasPaused: a.playState === 'paused'}));
    let union = {left: baseRect.left, top: baseRect.top,
        right: baseRect.right, bottom: baseRect.bottom};
    const sampleBox = (offsetMs) => {
        for (const {a} of pausedStates) {
            try {
                a.pause();
                a.currentTime = offsetMs;
            } catch (e) { /* ignore */ }
        }
        const rect = el.getBoundingClientRect();
        union = {
            left: Math.min(union.left, rect.left),
            top: Math.min(union.top, rect.top),
            right: Math.max(union.right, rect.right),
            bottom: Math.max(union.bottom, rect.bottom)
        };
        return rect;
    };
    // Probe the frames once to compute the union box.
    for (let i = 0; i < ANIMATION_FRAMES; i++) {
        sampleBox((cycleMs / ANIMATION_FRAMES) * i);
    }
    const unionW = union.right - union.left;
    const unionH = union.bottom - union.top;

    const box = {
        left: union.left, top: union.top,
        width: unionW, height: unionH,
        __el: el, __sprites: spriteSet, __width: unionW, __height: unionH
    };

    // Paint each frame against the union box.
    const costumes = [];
    for (let i = 0; i < ANIMATION_FRAMES; i++) {
        sampleBox((cycleMs / ANIMATION_FRAMES) * i);
        const defs = [];
        const body = paintElement(doc, el, box, null, warnings, defs);
        costumes.push({
            name: `frame${i + 1}`,
            svg: wrapSvg(unionW, unionH, body, defs)
        });
    }

    // Restore the animations.
    for (const {a, wasPaused} of pausedStates) {
        try {
            if (wasPaused) a.pause();
            else {
                a.play();
                a.currentTime = 0;
            }
        } catch (e) { /* ignore */ }
    }

    return {
        costumes,
        box,
        frameCount: ANIMATION_FRAMES,
        delaySeconds: cycleSeconds / ANIMATION_FRAMES
    };
};

/**
 * True when the element is contained inside (or is) one of the sprite
 * elements: such elements already belong to a sprite costume, so they must not
 * also be painted into the backdrop.
 */
const isInsideAnySprite = (el, spriteSet) => {
    let node = el;
    while (node && node.nodeType === 1) {
        if (spriteSet.has(node)) return true;
        node = node.parentElement;
    }
    return false;
};

/**
 * Turns a painted body into a full SVG document string.
 * @param {number} width
 * @param {number} height
 * @param {string} body SVG markup
 * @param {Array<string>} [defs] shared <linearGradient>/<radialGradient> defs
 * @returns {string}
 */
const wrapSvg = (width, height, body, defs = []) =>
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ` +
    `width="${Math.max(1, Math.round(width))}" height="${Math.max(1, Math.round(height))}" ` +
    `viewBox="0 0 ${Math.max(1, Math.round(width))} ${Math.max(1, Math.round(height))}">` +
    `${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body}</svg>`;

/**
 * Sanitizes a free-text id into a Scratch-friendly sprite name.
 * @param {string} id element id
 * @param {number} index fallback index
 * @returns {string}
 */
const spriteName = (id, index) => {
    const cleaned = String(id || '').replace(/[^A-Za-z0-9 _-]/g, '').trim() || `Sprite${index}`;
    return cleaned;
};

/**
 * Extracts the scene: sprites with their costumes and the stage backdrop.
 *
 * @param {{html?: string, css?: string, js?: string, code?: string}} source raw paste
 * @returns {{
 *   sprites: Array<{
 *     name: string, x: number, y: number, direction: number, visible: boolean,
 *     costumes: Array<{name: string, svg: string}>, button: boolean
 *   }>,
 *   backdrop: {svg: string, color: string},
 *   js: string, warnings: Array<string>, cleanup: Function
 * }}
 */
const extractScene = source => {
    const {html, css, js} = splitSource(source);
    const warnings = [];

    if (typeof document === 'undefined') {
        // Node (unit tests): nothing visual to extract; the JS side is still
        // fully testable through html-transpiler.
        return {sprites: [], backdrop: null, js, warnings, cleanup: () => {}};
    }

    const {doc, cleanup} = renderDocument(html, css);
    const body = doc.body;

    // --- Collect sprite elements BEFORE painting anything -----------------
    const all = [...body.querySelectorAll('*')];
    const spriteEls = all.filter(isSpriteElement);
    const spriteSet = new Set(spriteEls);

    // --- Backdrop: body background + every DECORATIVE element that is not
    // part of a sprite (a board panel, a title without an id...). Painted in
    // stage coordinates (origin = top-left of the iframe).
    const backdropDefs = [];
    const bodyStyle = getComputedStyle(body);
    const bgColor = normalizeColor(bodyStyle.backgroundColor) || '#0f1b2d';
    const bodyGradient = buildGradientDef(bodyStyle.backgroundImage, backdropDefs);
    let backdropBody = `<rect x="0" y="0" width="${STAGE_WIDTH}" height="${STAGE_HEIGHT}" ` +
        `fill="${escapeXml(bodyGradient ? bodyGradient.fill : bgColor)}"/>`;
    const stageBox = {left: 0, top: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT,
        __el: body, __sprites: spriteSet};
    for (const el of all) {
        if (CONTAINER_TAGS.has(el.tagName.toLowerCase())) continue;
        if (isInsideAnySprite(el, spriteSet)) continue;
        // Only paint something visible (background, gradient or own text).
        const st = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        const hasBg = normalizeColor(st.backgroundColor) ||
            (st.backgroundImage && st.backgroundImage.includes('gradient'));
        const hasOwnText = [...el.childNodes].some(n =>
            n.nodeType === 3 && n.textContent.trim());
        if (!hasBg && !hasOwnText) continue;
        backdropBody += paintElement(doc, el, stageBox, null, warnings, backdropDefs);
    }
    const backdrop = {
        svg: wrapSvg(STAGE_WIDTH, STAGE_HEIGHT, backdropBody, backdropDefs),
        color: bgColor
    };

    const sprites = spriteEls.map((el, index) => {
        const rect = el.getBoundingClientRect();
        const name = spriteName(el.id, index + 1);
        const style = getComputedStyle(el);
        const button = el.tagName.toLowerCase() === 'button' ||
            el.getAttribute('role') === 'button';

        // CSS animations / transitions: capture a sequence of costumes and
        // the frame delay to play them back. Non-interactive (not a button).
        const animation = button ? null :
            captureAnimationFrames(el, rect, spriteSet, doc, warnings);

        const boxRect = animation ? animation.box : rect;

        // CSS coordinates are top-left based; Scratch is center based with Y
        // pointing UP. For animations, the union box's center is the sprite
        // center so all frames share the same rotation point.
        const cx = boxRect.left + boxRect.width / 2 - STAGE_WIDTH / 2;
        const cy = STAGE_HEIGHT / 2 - (boxRect.top + boxRect.height / 2);
        const visible = style.display !== 'none' && style.visibility !== 'hidden' &&
            rect.width > 0 && rect.height > 0;

        let costumes;
        let animationFrames = null;
        let frameDelay = null;
        if (animation) {
            // The captured frames REPLACE the single base costume: they cover
            // the whole loop and are replayed by the generated blocks.
            costumes = animation.costumes;
            animationFrames = animation.frameCount;
            frameDelay = animation.delaySeconds;
        } else {
            // Paint the element (and its decorative children) into a local box.
            const box = rect;
            box.__el = el;
            box.__sprites = spriteSet;
            const defs = [];
            const baseBody = paintElement(doc, el, box, null, warnings, defs);
            costumes = [{
                name: 'costume1',
                svg: wrapSvg(rect.width, rect.height, baseBody, defs)
            }];

            // Interactive states: when the page defines :hover / :active for
            // this element, capture the look as extra costumes so the blocks
            // can swap them like a real button.
            if (button) {
                const hoverRules = pseudoStyle(doc, el, ':hover');
                const activeRules = pseudoStyle(doc, el, ':active');
                if (hoverRules) {
                    const hoverDefs = [];
                    costumes.push({
                        name: 'survol',
                        svg: wrapSvg(rect.width, rect.height,
                            paintElement(doc, el, box, hoverRules, warnings, hoverDefs), hoverDefs)
                    });
                }
                if (activeRules) {
                    const activeDefs = [];
                    costumes.push({
                        name: 'actif',
                        svg: wrapSvg(rect.width, rect.height,
                            paintElement(doc, el, box, activeRules, warnings, activeDefs), activeDefs)
                    });
                }
            }
        }

        return {
            name,
            x: Math.round(cx),
            y: Math.round(cy),
            direction: animation ? readRotation(style) : readRotation(style),
            visible,
            costumes,
            button,
            animationFrames,
            frameDelay
        };
    }).filter(s => {
        // Drop zero-size / display:none elements that could not be measured.
        // (display:none sprites are kept but flagged invisible below.)
        return true;
    });

    return {sprites, backdrop, js, warnings, cleanup, doc};
};

export {
    splitSource,
    extractScene,
    isSpriteElement,
    spriteName,
    wrapSvg,
    paintElement
};
