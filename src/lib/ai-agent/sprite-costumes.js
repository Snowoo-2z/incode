/**
 * @fileoverview Simple vector costumes for sprites created by the AI Agent.
 *
 * `emptySprite()` gives a sprite a completely blank costume, so every sprite the
 * agent created was invisible on the stage (a Pong with invisible paddles...).
 * These tiny SVGs give the generated sprites a visible default shape.
 */

const svg = (width, height, body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}" height="${height}" ` +
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
 * Gives a freshly created sprite a visible costume.
 * @param {object} vm Scratch VM
 * @param {object} target the target to decorate
 * @param {string} [shape] explicit shape, otherwise guessed from the name
 * @param {string} [color] explicit colour
 * @returns {Promise<boolean>} true when a costume was added
 */
const applyDefaultCostume = async (vm, target, shape, color) => {
    const storage = vm && vm.runtime && vm.runtime.storage;
    if (!vm || !target || !vm.addCostume || !storage) return false;

    const name = target.getName ? target.getName() : '';
    const costume = makeShapeCostume(shape || guessShape(name), color);

    const asset = storage.createAsset(
        storage.AssetType.ImageVector,
        storage.DataFormat.SVG,
        new TextEncoder().encode(costume.svgText),
        null,
        true // generate md5
    );

    const md5ext = `${asset.assetId}.svg`;
    await vm.addCostume(md5ext, {
        name: costume.name,
        rotationCenterX: costume.rotationCenterX,
        rotationCenterY: costume.rotationCenterY,
        bitmapResolution: 1,
        dataFormat: 'svg',
        assetId: asset.assetId,
        md5: md5ext,
        asset
    }, target.id);

    // Drop the original blank costume so the shape is the one displayed.
    if (target.getCostumes && target.getCostumes().length > 1) {
        target.deleteCostume(0);
        target.setCostume(0);
    }
    return true;
};

export {
    SHAPES,
    guessShape,
    makeShapeCostume,
    applyDefaultCostume
};
