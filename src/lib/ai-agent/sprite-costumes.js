/**
 * @fileoverview Costumes for the sprites created (or edited) by the AI Agent.
 *
 * Two jobs:
 *  - `emptySprite()` gives a sprite a completely blank costume, so every sprite
 *    the agent created was invisible on the stage (a Pong with invisible
 *    paddles...). `applyDefaultCostume()` gives those sprites a visible shape.
 *  - the agent can also draw its own costumes: the AI writes SVG code, and
 *    `addSvgCostume()` turns it into a real costume (or backdrop) on any
 *    target. `renameCostume()` / `deleteCostume()` / `selectCostume()` cover the
 *    rest of the costume life cycle.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const svg = (width, height, body) =>
    `<svg xmlns="${SVG_NS}" version="1.1" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">${body}</svg>`;

const SHAPES = {
    rectangle: (color = '#4C97FF') => ({
        width: 20,
        height: 100,
        svg: svg(20, 100, `<rect x="0" y="0" width="20" height="100" rx="6" fill="${color}"/>`)
    }),
    paddle: (color = '#4C97FF') => ({
        width: 16,
        height: 90,
        svg: svg(16, 90, `<rect x="0" y="0" width="16" height="90" rx="8" fill="${color}"/>`)
    }),
    ball: (color = '#FFAB19') => ({
        width: 24,
        height: 24,
        svg: svg(24, 24, `<circle cx="12" cy="12" r="12" fill="${color}"/>`)
    }),
    circle: (color = '#FFAB19') => ({
        width: 40,
        height: 40,
        svg: svg(40, 40, `<circle cx="20" cy="20" r="20" fill="${color}"/>`)
    }),
    square: (color = '#9966FF') => ({
        width: 50,
        height: 50,
        svg: svg(50, 50, `<rect x="0" y="0" width="50" height="50" rx="6" fill="${color}"/>`)
    }),
    star: (color = '#FFBF00') => ({
        width: 50,
        height: 48,
        svg: svg(50, 48, `<polygon points="25,0 32,17 50,18 36,30 41,48 25,38 9,48 14,30 0,18 18,17" fill="${color}"/>`)
    })
};

/**
 * Guesses a shape from the sprite name so "Paddle1" / "Balle" look right
 * without the AI having to say anything.
 * @param {string} name sprite name
 * @returns {string} shape key
 */
const guessShape = name => {
    const n = String(name || '').toLowerCase();
    if (/(paddle|raquette|barre|platform|plateforme|mur|wall)/.test(n)) return 'paddle';
    if (/(ball|balle|balloon|bille|pomme|apple)/.test(n)) return 'ball';
    if (/(star|etoile|étoile)/.test(n)) return 'star';
    if (/(box|caisse|bloc|brick|brique|carre|carré)/.test(n)) return 'square';
    return 'square';
};

/**
 * Builds a costume descriptor usable with `vm.addCostume`.
 * @param {string} shapeName shape key, or unknown to fall back on a square
 * @param {string} [color] fill colour
 * @returns {{name: string, svgText: string, rotationCenterX: number, rotationCenterY: number}} costume
 */
const makeShapeCostume = (shapeName, color) => {
    const factory = SHAPES[shapeName] || SHAPES.square;
    const shape = factory(color);
    return {
        name: 'costume1',
        svgText: shape.svg,
        rotationCenterX: shape.width / 2,
        rotationCenterY: shape.height / 2
    };
};

/**
 * Reads an SVG's intrinsic size from its `width`/`height`, falling back on the
 * `viewBox`. Used to centre the rotation point when the AI does not say where
 * the costume should pivot.
 * @param {string} svgText SVG source
 * @returns {{width: number, height: number}} size in SVG units
 */
const parseSvgSize = svgText => {
    const source = String(svgText || '');
    const attr = name => {
        const m = source.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
        return m ? m[1] : null;
    };
    let width = parseFloat(attr('width'));
    let height = parseFloat(attr('height'));
    if (!isFinite(width) || !isFinite(height)) {
        const viewBox = attr('viewBox');
        if (viewBox) {
            const parts = viewBox.split(/[\s,]+/).map(Number);
            if (parts.length === 4) {
                if (!isFinite(width)) width = parts[2];
                if (!isFinite(height)) height = parts[3];
            }
        }
    }
    return {
        width: isFinite(width) && width > 0 ? width : 100,
        height: isFinite(height) && height > 0 ? height : 100
    };
};

/**
 * Makes AI-written SVG loadable by scratch-svg-renderer: models built by the AI
 * often forget the `xmlns` namespace (the renderer then refuses the asset) or
 * the size attributes (the rotation center cannot be computed).
 * @param {string} svgText raw SVG coming from the AI
 * @returns {?string} normalized SVG, or null when it does not look like SVG
 */
const normalizeSvg = svgText => {
    let text = String(svgText || '').trim();
    if (!/<svg[\s>]/i.test(text)) return null;

    if (!/xmlns\s*=/i.test(text)) {
        text = text.replace(/<svg/i, `<svg xmlns="${SVG_NS}"`);
    }
    const size = parseSvgSize(text);
    if (!/\sviewBox\s*=/i.test(text)) {
        text = text.replace(/<svg/i, `<svg viewBox="0 0 ${size.width} ${size.height}"`);
    }
    if (!/\swidth\s*=/i.test(text)) {
        text = text.replace(/<svg/i, `<svg width="${size.width}"`);
    }
    if (!/\sheight\s*=/i.test(text)) {
        text = text.replace(/<svg/i, `<svg height="${size.height}"`);
    }
    if (!/<\/svg>\s*$/i.test(text)) {
        text += '</svg>';
    }
    return text;
};

/**
 * Resolves the SVG of a costume from either inline SVG code or a preset shape.
 * @param {{svg: ?string, shape: ?string, color: ?string}} spec costume spec
 * @returns {?string} SVG source, or null when nothing usable was given
 */
const resolveSvg = ({svg: rawSvg, shape, color} = {}) => {
    if (rawSvg && String(rawSvg).trim()) return normalizeSvg(rawSvg);
    const key = String(shape || '').toLowerCase();
    if (SHAPES[key]) return makeShapeCostume(key, color).svgText;
    return null;
};

/**
 * Adds an SVG costume to ANY target (sprite or stage backdrop).
 * A costume that already carries the same name is replaced, so the AI can
 * iterate on a drawing without piling up duplicates.
 * @param {object} vm Scratch VM
 * @param {object} target the target receiving the costume
 * @param {object} spec costume spec
 * @param {string} [spec.name] costume name (defaults to costumeN / backdropN)
 * @param {string} [spec.svg] SVG source written by the AI
 * @param {string} [spec.shape] preset shape name, used when `svg` is absent
 * @param {string} [spec.color] preset shape colour
 * @param {number} [spec.rotationCenterX] pivot X (defaults to the SVG centre)
 * @param {number} [spec.rotationCenterY] pivot Y (defaults to the SVG centre)
 * @returns {Promise<?{name: string, svgText: string, width: number, height: number, index: number}>}
 *     the added costume, or null when it could not be created
 */
const addSvgCostume = async (vm, target, spec = {}) => {
    const storage = vm && vm.runtime && vm.runtime.storage;
    if (!vm || !target || !vm.addCostume || !storage) return null;

    const svgText = resolveSvg(spec);
    if (!svgText) return null;

    const size = parseSvgSize(svgText);
    const costumes = target.getCostumes ? target.getCostumes() : [];
    const fallbackName = `${target.isStage ? 'backdrop' : 'costume'}${costumes.length + 1}`;
    const costumeName = String(spec.name || '').trim() || fallbackName;
    const previous = costumes.find(c => c.name === costumeName) || null;

    const asset = storage.createAsset(
        storage.AssetType.ImageVector,
        storage.DataFormat.SVG,
        new TextEncoder().encode(svgText),
        null,
        true // generate md5
    );
    const md5ext = `${asset.assetId}.svg`;

    const centerX = Number(spec.rotationCenterX);
    const centerY = Number(spec.rotationCenterY);
    await vm.addCostume(md5ext, {
        name: costumeName,
        rotationCenterX: isFinite(centerX) ? centerX : size.width / 2,
        rotationCenterY: isFinite(centerY) ? centerY : size.height / 2,
        bitmapResolution: 1,
        dataFormat: 'svg',
        assetId: asset.assetId,
        md5: md5ext,
        asset
    }, target.id);

    // Replace-by-name: drop the previous costume with that name, if any.
    if (previous) {
        const list = target.getCostumes();
        const oldIndex = list.indexOf(previous);
        if (oldIndex !== -1 && list.length > 1) {
            target.deleteCostume(oldIndex);
        }
    }

    const finalList = target.getCostumes ? target.getCostumes() : [];
    return {
        name: costumeName,
        svgText,
        width: size.width,
        height: size.height,
        index: finalList.findIndex(c => c.name === costumeName)
    };
};

/**
 * Gives a freshly created sprite a visible costume.
 * @param {object} vm Scratch VM
 * @param {object} target the target to decorate
 * @param {string} [shape] explicit shape, otherwise guessed from the name
 * @param {string} [color] explicit colour
 * @returns {Promise<boolean>} true when a costume was added
 */
const applyDefaultCostume = async (vm, target, shape, color) => {
    if (!vm || !target) return false;
    const name = target.getName ? target.getName() : '';
    const added = await addSvgCostume(vm, target, {
        name: 'costume1',
        shape: shape || guessShape(name),
        color
    });
    if (!added) return false;

    // Drop the original blank costume so the shape is the one displayed.
    if (target.getCostumes && target.getCostumes().length > 1) {
        target.deleteCostume(0);
        target.setCostume(0);
    }
    return true;
};

/**
 * Finds a costume by name (case-insensitive) or by position.
 * Positions follow the Scratch UI: the first costume is number 1.
 * @param {object} target VM target
 * @param {(string|number)} nameOrIndex costume name or 1-based position
 * @returns {number} costume index, or -1 when not found
 */
const findCostumeIndex = (target, nameOrIndex) => {
    const costumes = target && target.getCostumes ? target.getCostumes() : [];
    if (!nameOrIndex && nameOrIndex !== 0) return -1;

    if (typeof nameOrIndex === 'number' || /^\d+$/.test(String(nameOrIndex).trim())) {
        const oneBased = parseInt(nameOrIndex, 10) - 1;
        if (oneBased >= 0 && oneBased < costumes.length) return oneBased;
        // Tolerate a 0-based index as well.
        const zeroBased = parseInt(nameOrIndex, 10);
        if (zeroBased >= 0 && zeroBased < costumes.length) return zeroBased;
        return -1;
    }

    const wanted = String(nameOrIndex).trim()
        .toLowerCase();
    return costumes.findIndex(c => String(c.name).toLowerCase() === wanted);
};

/**
 * Renames a costume of a target (the VM helper only works on the editing
 * target, so we go through the target itself).
 * @param {object} target VM target
 * @param {(string|number)} nameOrIndex current costume name or position
 * @param {string} newName desired name
 * @returns {?string} the name actually applied (Scratch de-duplicates), or null
 */
const renameCostume = (target, nameOrIndex, newName) => {
    if (!target || !target.renameCostume) return null;
    const index = findCostumeIndex(target, nameOrIndex);
    const name = String(newName || '').trim();
    if (index === -1 || !name) return null;
    target.renameCostume(index, name);
    const costume = target.getCostumes()[index];
    return costume ? costume.name : null;
};

/**
 * Deletes a costume (Scratch refuses to delete the last remaining one).
 * @param {object} target VM target
 * @param {(string|number)} nameOrIndex costume name or position
 * @returns {?string} the deleted costume's name, or null
 */
const deleteCostume = (target, nameOrIndex) => {
    if (!target || !target.deleteCostume) return null;
    const index = findCostumeIndex(target, nameOrIndex);
    if (index === -1) return null;
    const costume = target.getCostumes()[index];
    if (!target.deleteCostume(index)) return null;
    return costume ? costume.name : null;
};

/**
 * Displays a given costume.
 * @param {object} target VM target
 * @param {(string|number)} nameOrIndex costume name or position
 * @returns {?string} the displayed costume's name, or null
 */
const selectCostume = (target, nameOrIndex) => {
    if (!target || !target.setCostume) return null;
    const index = findCostumeIndex(target, nameOrIndex);
    if (index === -1) return null;
    target.setCostume(index);
    const costume = target.getCostumes()[index];
    return costume ? costume.name : null;
};

/**
 * Reads the SVG source of an existing costume.
 *
 * WHY: the agent could already DRAW costumes (see `addSvgCostume`) but never
 * see them. On a big project the costumes are hand-made SVG the AI has no idea
 * about, so "change the ball to a square" meant redrawing blind. This is the
 * read side of the same feature.
 *
 * The SVG text lives in the storage asset, not on the costume object, so we go
 * through `asset.decodeText()` (what `vm.getCostume` does, minus the
 * editing-target restriction). Bitmaps have no SVG: we say so instead of
 * returning a 200 KB data URI that would flood the AI's context.
 * @param {object} vm Scratch VM (for its storage)
 * @param {object} target the target owning the costume
 * @param {string|number} [nameOrIndex] costume name or 1-based index; defaults to the current one
 * @returns {?{name: string, index: number, svg: ?string, kind: string, width: number, height: number}} costume
 */
const getCostumeSvg = (vm, target, nameOrIndex) => {
    const costumes = target && target.getCostumes ? target.getCostumes() : [];
    if (!costumes.length) return null;

    let index = findCostumeIndex(target, nameOrIndex === null ? '' : nameOrIndex);
    if (index === -1) {
        // No (or unknown) name: fall back to the costume currently shown.
        index = typeof target.currentCostume === 'number' ? target.currentCostume : 0;
    }
    const costume = costumes[index];
    if (!costume) return null;

    const size = {width: costume.width || 0, height: costume.height || 0};
    const info = {
        name: costume.name,
        index,
        svg: null,
        kind: 'svg',
        width: size.width,
        height: size.height
    };

    let asset = costume.asset;
    if (!asset && vm && vm.runtime && vm.runtime.storage && costume.md5ext) {
        asset = vm.runtime.storage.get(costume.md5ext) || null;
    }
    if (!asset) {
        info.kind = 'introuvable';
        return info;
    }

    // A costume written by the agent carries `dataFormat: 'svg'` on itself; an
    // asset loaded from a project carries it on the storage side. Trust either.
    const storage = vm && vm.runtime ? vm.runtime.storage : null;
    const format = costume.dataFormat || asset.dataFormat;
    const isSvg = !storage || format === storage.DataFormat.SVG;
    if (isSvg && typeof asset.decodeText === 'function') {
        try {
            info.svg = asset.decodeText();
        } catch (e) {
            info.kind = `illisible (${e.message})`;
        }
    } else {
        // PNG/JPG: no SVG to show, but the AI can still replace it with one.
        info.kind = format || 'bitmap';
    }
    return info;
};

export {
    SHAPES,
    guessShape,
    makeShapeCostume,
    parseSvgSize,
    normalizeSvg,
    resolveSvg,
    addSvgCostume,
    getCostumeSvg,
    applyDefaultCostume,
    findCostumeIndex,
    renameCostume,
    deleteCostume,
    selectCostume
};
