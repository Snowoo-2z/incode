import {parseDSL} from '../../../src/lib/ai-agent/dsl-parser';
import {interpretAndExecute} from '../../../src/lib/ai-agent/code-interpreter';
import {
    normalizeSvg,
    parseSvgSize,
    addSvgCostume
} from '../../../src/lib/ai-agent/sprite-costumes';
import {generateAIPrompt, generateContinuationPrompt} from '../../../src/lib/ai-agent/prompt-generator';

/** Minimal target exposing the costume API the agent relies on. */
class FakeTarget {
    constructor (name, {isStage = false} = {}) {
        this.id = `id-${name}`;
        this.name = name;
        this.isStage = isStage;
        this.x = 0;
        this.y = 0;
        this.size = 100;
        this.direction = 90;
        this.visible = true;
        this.variables = {};
        this.sprite = {costumes: [{name: 'costume1'}]};
        this.currentCostume = 0;
    }

    getName () {
        return this.name;
    }

    getCostumes () {
        return this.sprite.costumes;
    }

    addCostume (costume) {
        this.sprite.costumes.push(costume);
    }

    setCostume (index) {
        this.currentCostume = index;
    }

    renameCostume (index, newName) {
        this.sprite.costumes[index].name = newName;
    }

    deleteCostume (index) {
        if (this.sprite.costumes.length === 1) return null;
        return this.sprite.costumes.splice(index, 1)[0];
    }
}

/** Minimal VM: enough of scratch-vm for the costume actions. */
const makeVM = (targets = []) => {
    const storage = {
        AssetType: {ImageVector: 'ImageVector'},
        DataFormat: {SVG: 'svg'},
        created: [],
        createAsset (type, format, data) {
            const assetId = `asset${this.created.length + 1}`;
            this.created.push({type, format, svg: new TextDecoder().decode(data)});
            return {assetId};
        }
    };
    const vm = {
        runtime: {
            targets,
            storage,
            getTargetForStage: () => targets.find(t => t.isStage) || null,
            emitProjectChanged: () => {},
            requestBlocksUpdate: () => {}
        },
        editingTarget: targets[0] || null,
        emitTargetsUpdate: () => {},
        refreshWorkspace: () => {},
        addCostume: (md5ext, costumeObject, targetId) => {
            const target = targets.find(t => t.id === targetId);
            if (!target) return Promise.reject(new Error('no target'));
            target.addCostume(costumeObject);
            target.setCostume(target.getCostumes().length - 1);
            return Promise.resolve();
        }
    };
    return {vm, storage};
};

describe('SVG helpers', () => {
    test('normalizeSvg adds the namespace and the size the renderer needs', () => {
        const normalized = normalizeSvg('<svg><circle cx="10" cy="10" r="9" fill="#f00"/></svg>');
        expect(normalized).toContain('xmlns="http://www.w3.org/2000/svg"');
        expect(normalized).toContain('width="100"');
        expect(normalized).toContain('viewBox="0 0 100 100"');
    });

    test('normalizeSvg keeps a well-formed SVG untouched', () => {
        const source = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40" viewBox="0 0 60 40">' +
            '<rect width="60" height="40" fill="#123"/></svg>';
        expect(normalizeSvg(source)).toBe(source);
    });

    test('normalizeSvg rejects text that is not SVG', () => {
        expect(normalizeSvg('move 10')).toBeNull();
        expect(normalizeSvg('')).toBeNull();
    });

    test('parseSvgSize reads width/height, then the viewBox', () => {
        expect(parseSvgSize('<svg width="48" height="24"/>')).toEqual({width: 48, height: 24});
        expect(parseSvgSize('<svg viewBox="0 0 480 360"/>')).toEqual({width: 480, height: 360});
        expect(parseSvgSize('<svg/>')).toEqual({width: 100, height: 100});
    });
});

describe('DSL costume directives', () => {
    test('inline SVG becomes a CREATE_COSTUME action', () => {
        const actions = parseDSL(`
on Balle:
  costume "visage" = <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="9"/></svg>
`);
        expect(actions).toHaveLength(1);
        expect(actions[0].type).toBe('CREATE_COSTUME');
        expect(actions[0].sprite).toBe('Balle');
        expect(actions[0].name).toBe('visage');
        expect(actions[0].svg).toContain('<circle');
    });

    test('an SVG indented under the directive is joined back together', () => {
        const actions = parseDSL(`
sprite Vaisseau 0 -120:
  costume "coque" =
    <svg xmlns="http://www.w3.org/2000/svg" width="60" height="40">
      <polygon points="30,2 58,38 2,38" fill="#4C97FF"/>
    </svg>
`);
        const costume = actions.find(a => a.type === 'CREATE_COSTUME');
        expect(costume).toBeDefined();
        expect(costume.name).toBe('coque');
        expect(costume.svg).toContain('<svg');
        expect(costume.svg).toContain('<polygon');
        expect(costume.svg).toContain('</svg>');
    });

    test('a preset shape with a colour is passed as shape/color', () => {
        const actions = parseDSL(`
on Balle:
  costume "ronde" = circle #FF0000
`);
        expect(actions[0]).toMatchObject({type: 'CREATE_COSTUME', shape: 'circle', color: '#FF0000'});
        expect(actions[0].svg).toBeUndefined();
    });

    test('rename / delete / set directives', () => {
        const actions = parseDSL(`
on Balle:
  renamecostume "costume1" = "visage"
  setcostume "visage"
  deletecostume 2
`);
        expect(actions.map(a => a.type)).toEqual(['RENAME_COSTUME', 'SET_COSTUME', 'DELETE_COSTUME']);
        expect(actions[0]).toMatchObject({sprite: 'Balle', costume: 'costume1', name: 'visage'});
        expect(actions[1]).toMatchObject({sprite: 'Balle', costume: 'visage'});
        expect(actions[2]).toMatchObject({sprite: 'Balle', costume: '2'});
    });

    test('"costume X" without "=" is still the switch-costume BLOCK', () => {
        const actions = parseDSL(`
on Balle:
  whenflagclicked
  costume "visage"
`);
        expect(actions).toHaveLength(1);
        expect(actions[0].type).toBe('ADD_SCRIPT');
        expect(actions[0].blocks.map(b => b.opcode)).toContain('looks_switchcostumeto');
    });

    test('stage costumes are backdrops and keep the stage target', () => {
        const actions = parseDSL(`
stage:
  costume "espace" = <svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360"/></svg>
`);
        expect(actions[0]).toMatchObject({type: 'CREATE_COSTUME', sprite: 'Stage', name: 'espace'});
    });
});

describe('costume actions on the VM', () => {
    test('CREATE_COSTUME stores the SVG and adds the costume', async () => {
        const balle = new FakeTarget('Balle');
        const {vm, storage} = makeVM([balle]);

        const report = await interpretAndExecute(
            'CREATE_COSTUME Balle "visage" <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>',
            vm
        );
        // The legacy line parser does not know costumes: use the JSON path.
        expect(report.logs.join('\n')).toContain('Format non reconnu');

        const jsonReport = await interpretAndExecute(JSON.stringify({
            actions: [{
                type: 'CREATE_COSTUME',
                sprite: 'Balle',
                name: 'visage',
                svg: '<svg width="20" height="20"><circle cx="10" cy="10" r="9" fill="#f00"/></svg>'
            }]
        }), vm);

        expect(jsonReport.success).toBe(true);
        expect(storage.created).toHaveLength(1);
        expect(storage.created[0].svg).toContain('xmlns="http://www.w3.org/2000/svg"');
        expect(balle.getCostumes().map(c => c.name)).toEqual(['costume1', 'visage']);
        expect(balle.getCostumes()[1].rotationCenterX).toBe(10);
        expect(balle.currentCostume).toBe(1);
        expect(jsonReport.logs.join('\n')).toContain('Costume "visage"');
    });

    test('creating a costume with an existing name replaces it', async () => {
        const balle = new FakeTarget('Balle');
        const {vm} = makeVM([balle]);

        await interpretAndExecute(JSON.stringify({
            actions: [{type: 'CREATE_COSTUME', sprite: 'Balle', name: 'visage', shape: 'circle', color: '#0f0'}]
        }), vm);
        await interpretAndExecute(JSON.stringify({
            actions: [{type: 'CREATE_COSTUME', sprite: 'Balle', name: 'visage', shape: 'star', color: '#ff0'}]
        }), vm);

        expect(balle.getCostumes().map(c => c.name)).toEqual(['costume1', 'visage']);
    });

    test('rename, set and delete round-trip through the DSL', async () => {
        const balle = new FakeTarget('Balle');
        const {vm} = makeVM([balle]);
        balle.sprite.costumes.push({name: 'costume2'});

        const report = await interpretAndExecute(`
on Balle:
  renamecostume "costume1" = "visage"
  setcostume "costume2"
  deletecostume "visage"
`, vm);

        expect(report.success).toBe(true);
        expect(balle.getCostumes().map(c => c.name)).toEqual(['costume2']);
        expect(report.logs.join('\n')).toContain('renommé en "visage"');
    });

    test('addSvgCostume reports the parsed size', async () => {
        const balle = new FakeTarget('Balle');
        const {vm} = makeVM([balle]);
        const added = await addSvgCostume(vm, balle, {
            name: 'fond',
            svg: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"/>'
        });
        expect(added).toMatchObject({name: 'fond', width: 480, height: 360});
    });

    test('an unusable SVG is refused instead of creating an empty costume', async () => {
        const balle = new FakeTarget('Balle');
        const {vm} = makeVM([balle]);
        const report = await interpretAndExecute(JSON.stringify({
            actions: [{type: 'CREATE_COSTUME', sprite: 'Balle', name: 'raté', svg: 'pas du svg'}]
        }), vm);
        expect(balle.getCostumes()).toHaveLength(1);
        expect(report.logs.join('\n')).toContain('aucun SVG valide');
    });
});

describe('prompt modes', () => {
    const stage = new FakeTarget('Scène', {isStage: true});
    const {vm} = makeVM([stage, new FakeTarget('Balle')]);

    test('the new-conversation prompt carries the documentation and the state', () => {
        const prompt = generateAIPrompt(vm, 'Faire un Pong');
        expect(prompt).toContain('RÉFÉRENCE DES COMMANDES');
        expect(prompt).toContain('CHEATSHEET DES OPCODES SCRATCH 3.0');
        expect(prompt).toContain('COSTUMES ET ARRIÈRE-PLANS');
        expect(prompt).toContain('renamecostume');
        expect(prompt).toContain('ÉTAT ACTUEL DU PROJET SCRATCH');
        expect(prompt).toContain('Balle');
        expect(prompt).toContain('Faire un Pong');
    });

    test('the continuation prompt sends the state WITHOUT the documentation', () => {
        const prompt = generateContinuationPrompt(vm, 'Ajoute un menu', {logs: ['✓ ok']});
        expect(prompt).toContain('ÉTAT ACTUEL DU PROJET SCRATCH');
        expect(prompt).toContain('Balle');
        expect(prompt).toContain('Ajoute un menu');
        expect(prompt).toContain('✓ ok');
        expect(prompt).not.toContain('RÉFÉRENCE DES COMMANDES');
        expect(prompt).not.toContain('CHEATSHEET DES OPCODES SCRATCH 3.0');
        expect(prompt).not.toContain('COSTUMES ET ARRIÈRE-PLANS');
    });

    test('the continuation prompt is much shorter than the full one', () => {
        const full = generateAIPrompt(vm, 'Faire un Pong');
        const short = generateContinuationPrompt(vm, 'Faire un Pong');
        expect(short.length).toBeLessThan(full.length / 3);
    });
});
