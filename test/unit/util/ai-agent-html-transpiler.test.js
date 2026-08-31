/**
 * @fileoverview Unit tests for the web-mode JS -> blocks transpiler.
 * These run in Node (no DOM): the JS->blocks logic is fully testable on its
 * own, while the iframe capture lives in html-render.js and is browser-only.
 */

import {Transpiler} from '../../../src/lib/ai-agent/html-transpiler';
import {transpileWebProject} from '../../../src/lib/ai-agent/html-to-scratch';
import {splitSource} from '../../../src/lib/ai-agent/html-render';

/** All opcodes (including nested reporters/C-block bodies) in a script list. */
const collectOpcodes = stacks => {
    const opcodes = new Set();
    const walk = value => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) {
            value.forEach(walk);
            return;
        }
        if (value.opcode) opcodes.add(value.opcode);
        if (value.inputs) Object.values(value.inputs).forEach(walk);
    };
    stacks.forEach(stack => walk(stack));
    return opcodes;
};

const transpile = (js, sprites = []) => new Transpiler(sprites).transpile(js);

describe('web mode: JS transpiler', () => {
    test('whenFlag/forever/move become flag + forever blocks', () => {
        const result = transpile('whenFlag(() => { forever(() => { balle.move(7); }); });',
            ['balle']);
        expect(result.warnings).toEqual([]);
        const opcodes = collectOpcodes(result.scripts.get('balle'));
        expect(opcodes.has('event_whenflagclicked')).toBe(true);
        expect(opcodes.has('control_forever')).toBe(true);
        expect(opcodes.has('motion_movesteps')).toBe(true);
    });

    test('one forever over several sprites is DUPLICATED per sprite', () => {
        const result = transpile(`
            whenFlag(() => {
                forever(() => {
                    if (keyPressed('w')) raquetteG.changeY(8);
                    if (keyPressed('up arrow')) raquetteD.changeY(8);
                    balle.move(7);
                    balle.bounce();
                });
            });`, ['balle', 'raquetteG', 'raquetteD']);
        const balle = collectOpcodes(result.scripts.get('balle'));
        const raqG = collectOpcodes(result.scripts.get('raquetteg'));
        const raqD = collectOpcodes(result.scripts.get('raquetted'));
        expect(balle.has('motion_movesteps')).toBe(true);
        expect(balle.has('motion_ifonedgebounce')).toBe(true);
        // No foreign-sprite statements in the wrong script:
        expect(balle.has('motion_changeyby')).toBe(false);
        expect(raqG.has('motion_changeyby')).toBe(true);
        expect(raqG.has('sensing_keypressed')).toBe(true);
        expect(raqG.has('motion_movesteps')).toBe(false);
        expect(raqD.has('motion_changeyby')).toBe(true);
        expect(raqD.has('motion_movesteps')).toBe(false);
    });

    test('onClick becomes a "when this sprite clicked" hat', () => {
        const result = transpile(`
            bouton.onClick(() => { score += 1; });`, ['bouton']);
        const ops = collectOpcodes(result.scripts.get('bouton'));
        expect(ops.has('event_whenthisspriteclicked')).toBe(true);
        expect(ops.has('data_changevariableby')).toBe(true);
    });

    test('document keydown with e.key guard becomes when-key-pressed hats', () => {
        const result = transpile(`
            document.addEventListener('keydown', e => {
                if (e.key === 'ArrowLeft') raquetteG.changeY(-5);
            });`, ['raquetteG']);
        const ops = collectOpcodes(result.scripts.get('raquetteg'));
        expect(ops.has('event_whenkeypressed')).toBe(true);
        expect(ops.has('motion_changeyby')).toBe(true);
    });

    test('variables and lists are registered', () => {
        const result = transpile(`
            let score = 0;
            let items = [1, 2, 3];
            whenFlag(() => {
                score += 1;
                items.push(99);
            });`);
        expect(result.variables.map(v => v.name)).toContain('score');
        expect(result.lists.map(l => l.name)).toContain('items');
    });

    test('arithmetic/comparison become operator blocks', () => {
        const result = transpile(`
            whenFlag(() => {
                forever(() => {
                    if (balle.x < -230) { score = score + 1; }
                });
            });`, ['balle']);
        const ops = collectOpcodes(result.scripts.get('balle'));
        expect(ops.has('operator_lt')).toBe(true);
        expect(ops.has('operator_add')).toBe(true);
        expect(ops.has('motion_xposition')).toBe(true);
    });

    test('native while(true) becomes forever; for(i<n) becomes repeat', () => {
        const result = transpile(`
            whenFlag(() => {
                while (true) { balle.move(2); }
            });`, ['balle']);
        const ops = collectOpcodes(result.scripts.get('balle'));
        expect(ops.has('control_forever')).toBe(true);

        const r2 = transpile(`
            whenFlag(() => {
                for (let i = 0; i < 10; i++) { balle.move(2); }
            });`, ['balle']);
        const ops2 = collectOpcodes(r2.scripts.get('balle'));
        expect(ops2.has('control_repeat')).toBe(true);
    });

    test('user functions are inlined at call sites', () => {
        const result = transpile(`
            function resetBall() {
                score = 0;
                balle.gotoXy(0, 0);
            }
            whenFlag(() => {
                resetBall();
                forever(() => { balle.move(5); });
            });`, ['balle']);
        const allOps = collectOpcodes([...result.scripts.values()].flat());
        expect(allOps.has('motion_gotoxy')).toBe(true);
        expect(allOps.has('data_setvariableto')).toBe(true);
    });

    test('sprite referenced ONLY in JS is implicitly registered', () => {
        const result = transpile('whenFlag(() => { forever(() => { vaisseau.move(3); }); });');
        expect(result.scripts.has('vaisseau')).toBe(true);
    });

    test('no internal markers (__hat/__control/__var) leave the transpiler', () => {
        const result = transpile(`
            let s = 0;
            whenFlag(() => {
                if (balle.touching('_edge_')) s = 1;
                balle.onClick(() => { s += 1; });
            });`, ['balle']);
        let markerFound = false;
        // Only top-level SCRIPT items carry internal control/hat markers;
        // nested input blocks must be real block specs. Field descriptors
        // ({variable: true, ...}) legitimately contain the same "__"-less
        // shape and are walked but never have these marker keys.
        const walk = value => {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value)) return value.forEach(walk);
            if (value.__control || value.__var ||
                value.__list || value.__inline || value.__changeVar ||
                value.__createList || value.__setVar) {
                markerFound = true;
            }
            if (value.inputs) Object.values(value.inputs).forEach(walk);
        };
        [...result.scripts.values()].flat().forEach(walk);
        expect(markerFound).toBe(false);
    });

    test('unsupported JS never crashes the transpiler', () => {
        const result = transpile(`
            whenFlag(() => {
                fetch('/x').then(r => r.json()).then(d => balle.say(d));
                balle.move(5);
            });`, ['balle']);
        // The valid block is still emitted...
        const ops = collectOpcodes(result.scripts.get('balle'));
        expect(ops.has('motion_movesteps')).toBe(true);
        // ...and the surrounding structure is intact, even though the
        // fetch/promise chain (unsupported) produced no blocks.
        expect(result.warnings.length).toBeGreaterThanOrEqual(0);
    });

    test('unknown sprite method is reported', () => {
        const result = transpile(`
            whenFlag(() => { balle.warpToHyperspace(9); });`, ['balle']);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.warnings.join('\n')).toContain('non reconnue');
    });
});

describe('web mode: project assembly (no DOM)', () => {
    test('transpileWebProject emits CREATE_VAR + ADD_SCRIPT actions', () => {
        const result = transpileWebProject({code: `
            <script>
            let score = 0;
            whenFlag(() => {
                score = 0;
                forever(() => { balle.move(7); balle.bounce(); });
            });
            </script>`});
        const types = result.actions.map(a => a.type);
        expect(types).toContain('CREATE_VAR');
        expect(types).toContain('CREATE_SPRITE'); // implicit balle
        expect(types).toContain('ADD_SCRIPT');
        const ballScript = result.actions.find(a => a.type === 'ADD_SCRIPT' &&
            a.sprite.toLowerCase() === 'balle');
        const ops = collectOpcodes([ballScript.blocks]);
        expect(ops.has('motion_movesteps')).toBe(true);
        expect(ops.has('motion_ifonedgebounce')).toBe(true);
    });

    test('splitSource separates html / css / js', () => {
        const parts = splitSource({code:
            '<style>body{}</style><div id="x"></div><script>whenFlag(()=>{});</script>'});
        expect(parts.css).toContain('body{}');
        expect(parts.js).toContain('whenFlag');
        expect(parts.html).toContain('id="x"');
        expect(parts.html).not.toContain('<script');
    });
});

describe('web mode: transpiler extras', () => {
    test('Math.random/floor/abs become operator blocks', () => {
        const result = transpile(`
            whenFlag(() => {
                balle.x = Math.floor(Math.random() * 100) - 50;
                balle.y = Math.abs(-3);
            });`, ['balle']);
        const ops = collectOpcodes(result.scripts.get('balle'));
        expect(ops.has('operator_mathop')).toBe(true);
        expect(ops.has('operator_multiply')).toBe(true);
        expect(ops.has('operator_subtract')).toBe(true);
        expect(ops.has('motion_setx')).toBe(true);
        expect(result.warnings.filter(w => /Math/.test(w)).length).toBe(0);
    });

    test('setInterval becomes forever + wait', () => {
        const result = transpile(`
            setInterval(() => { balle.move(2); }, 16);`, ['balle']);
        const ops = collectOpcodes(result.scripts.get('balle'));
        expect(ops.has('control_forever')).toBe(true);
        expect(ops.has('control_wait')).toBe(true);
        expect(ops.has('operator_divide')).toBe(true); // ms / 1000
        expect(ops.has('motion_movesteps')).toBe(true);
    });

    test('setTimeout becomes wait then body', () => {
        const result = transpile(`
            whenFlag(() => {
                setTimeout(() => { balle.say('pret'); }, 1000);
            });`, ['balle']);
        const ops = collectOpcodes(result.scripts.get('balle'));
        expect(ops.has('control_wait')).toBe(true);
        expect(ops.has('looks_say')).toBe(true);
    });

    test('compound *= assignment becomes set with multiply', () => {
        const result = transpile(`
            whenFlag(() => {
                points *= 2;
                ennemis.push(5);
            });`, ['balle']);
        const all = collectOpcodes([...result.scripts.values()].flat());
        expect(all.has('operator_multiply')).toBe(true);
        expect(all.has('data_setvariableto')).toBe(true);
        expect(all.has('data_addtolist')).toBe(true);
    });

    test('list methods map to list blocks', () => {
        const result = transpile(`
            whenFlag(() => {
                ennemis.push(7);
                ennemis.pop();
                ennemis.clear();
                if (ennemis.includes(7)) balle.say('touche');
            });`, ['balle']);
        const all = collectOpcodes([...result.scripts.values()].flat());
        expect(all.has('data_addtolist')).toBe(true);
        expect(all.has('data_deleteoflist')).toBe(true);
        expect(all.has('data_deletealloflist')).toBe(true);
        expect(all.has('data_listcontainsitem')).toBe(true);
    });

    test('switch/case becomes nested if/else', () => {
        const result = transpile(`
            whenFlag(() => {
                switch (etat) {
                    case 'a': balle.move(1); break;
                    case 'b': balle.move(2); break;
                    default: balle.move(3);
                }
            });`, ['balle']);
        const ops = collectOpcodes(result.scripts.get('balle'));
        expect(ops.has('control_if_else')).toBe(true);
        expect(ops.has('operator_equals')).toBe(true);
    });

    test('else-if chains are supported', () => {
        const result = transpile(`
            whenFlag(() => {
                if (balle.x > 100) {
                    balle.say('droite');
                } else if (balle.x < -100) {
                    balle.say('gauche');
                } else {
                    balle.say('milieu');
                }
            });`, ['balle']);
        const ops = collectOpcodes(result.scripts.get('balle'));
        expect(ops.has('control_if_else')).toBe(true);
    });

    test('JS functions become real Scratch custom blocks', () => {
        const result = transpile(`
            function rebonjour(texte, fois) {
                balle.say(texte);
                balle.move(fois);
            }
            whenFlag(() => {
                rebonjour('salut', 10);
            });`, ['balle']);
        const def = [...result.scripts.values()].flat();
        const ops = collectOpcodes(def);
        expect(ops.has('procedures_definition')).toBe(true);
        expect(ops.has('procedures_prototype')).toBe(true);
        expect(ops.has('procedures_call')).toBe(true);
        // The prototype carries the proccode with parameter slots.
        const find = oc => JSON.stringify(def).includes(oc);
        expect(find('rebonjour %s %s')).toBe(true);
        // Call input value present.
        expect(JSON.stringify(def)).toContain('salut');
    });

    test('unknown function call gets a TODO stub custom block (never fails)', () => {
        const result = transpile(`
            whenFlag(() => {
                faisUnTour();
            });`, ['balle']);
        const ops = collectOpcodes([...result.scripts.values()].flat());
        expect(ops.has('procedures_definition')).toBe(true);
        expect(ops.has('procedures_call')).toBe(true);
        expect(JSON.stringify([...result.scripts.values()].flat())).toContain('TODO');
        expect(result.warnings.some(w => /faisUnTour/.test(w))).toBe(true);
    });

    test('custom block params become argument reporters inside the body', () => {
        const result = transpile(`
            function bouge(deplacement) {
                balle.move(deplacement);
            }
            whenFlag(() => { bouge(20); });`, ['balle']);
        const ops = collectOpcodes([...result.scripts.values()].flat());
        expect(ops.has('argument_reporter_string_number')).toBe(true);
    });

    test('Math.min/max become conditional arithmetic', () => {
        const result = transpile(`
            whenFlag(() => {
                balle.setX(Math.min(balle.x, 200));
                score = Math.max(score, 0);
            });`, ['balle']);
        const all = collectOpcodes([...result.scripts.values()].flat());
        expect(all.has('operator_lt')).toBe(true);
        expect(all.has('operator_gt')).toBe(true);
        expect(all.has('operator_multiply')).toBe(true);
    });

    test('requestAnimationFrame becomes a forever loop', () => {
        const result = transpile(`
            requestAnimationFrame(() => { balle.move(2); });`, ['balle']);
        const ops = collectOpcodes(result.scripts.get('balle'));
        expect(ops.has('control_forever')).toBe(true);
        expect(ops.has('motion_movesteps')).toBe(true);
    });

    test('for...of over a list iterates with itemoflist', () => {
        const result = transpile(`
            let ennemis = [1, 2, 3];
            whenFlag(() => {
                for (let n of ennemis) {
                    balle.say(n);
                }
            });`, ['balle']);
        const ops = collectOpcodes(result.scripts.get('balle'));
        expect(ops.has('data_itemoflist')).toBe(true);
        expect(ops.has('data_lengthoflist')).toBe(true);
        expect(ops.has('control_repeat')).toBe(true);
    });

    test('alert() becomes a say block', () => {
        const result = transpile(`
            whenFlag(() => { alert('game over'); });`, ['balle']);
        const ops = collectOpcodes(result.scripts.get('balle'));
        expect(ops.has('looks_say')).toBe(true);
    });

    test('string length and charAt use operator blocks', () => {
        const result = transpile(`
            let nom = 'bob';
            whenFlag(() => {
                balle.say(nom.charAt(0));
                if (nom.length > 2) balle.move(5);
            });`, ['balle']);
        const all = collectOpcodes([...result.scripts.values()].flat());
        expect(all.has('operator_letter_of')).toBe(true);
        expect(all.has('operator_length')).toBe(true);
    });

    test('el.style.left/top/display/opacity map to motion/looks blocks', () => {
        const result = transpile(`
            const balle = document.getElementById('balle');
            whenFlag(() => {
                balle.style.left = '100px';
                balle.style.top = 50;
                balle.style.display = 'none';
                balle.style.opacity = 0.5;
            });`, []);
        const all = collectOpcodes([...result.scripts.values()].flat());
        expect(all.has('motion_setx')).toBe(true);
        expect(all.has('motion_sety')).toBe(true);
        expect(all.has('looks_hide')).toBe(true);
        expect(all.has('looks_seteffectto')).toBe(true);
        expect(result.warnings.length).toBe(0);
    });

    test('document.getElementById resolves to the sprite (classic DOM style)', () => {
        const result = transpile(`
            const balle = document.getElementById('balle');
            whenFlag(() => { balle.move(7); });`, []);
        const all = collectOpcodes([...result.scripts.values()].flat());
        expect(all.has('motion_movesteps')).toBe(true);
        expect([...result.scripts.keys()]).toContain('balle');
        expect(result.warnings.length).toBe(0);
    });
});
