import React from 'react';
import {shallow} from 'enzyme';

import AIAgent from '../../../src/lib/ai-agent/index';
import SoraxChat from '../../../src/components/sorax-chat/sorax-chat';

/* ---------------------------------------------------------------------- */
/* Harnais : un VM minimal, un faux serveur compatible OpenAI              */
/* ---------------------------------------------------------------------- */

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
        this.blocks = {_blocks: {}, getScripts: () => [], createBlock () {}, deleteBlock () {}};
        this.sprite = {costumes: [{name: 'costume1'}]};
    }

    getName () {
        return this.name;
    }

    getCostumes () {
        return this.sprite.costumes;
    }

    getSounds () {
        return [];
    }

    lookupVariableByNameAndType (name, type) {
        return Object.values(this.variables).find(v => v.name === name && v.type === type) || null;
    }

    createVariable (id, name, type) {
        this.variables[id] = {id, name, type, value: 0};
    }
}

/** VM minimal + journal de ce que le tchat applique vraiment au projet. */
const makeVM = () => {
    const stage = new FakeTarget('Scène', {isStage: true});
    const sprite = new FakeTarget('Sprite1');
    const journal = {blocs: [], sprites: []};
    const vm = {
        runtime: {
            targets: [stage, sprite],
            getTargetForStage: () => stage,
            emitProjectChanged: () => {},
            requestBlocksUpdate: () => {}
        },
        editingTarget: sprite,
        emitTargetsUpdate: () => {},
        refreshWorkspace: () => {},
        // Comme le vrai VM : les blocs arrivent avec l'identifiant de la cible.
        shareBlocksToTarget: (blocks, targetId) => {
            const cible = vm.runtime.targets.find(t => t.id === targetId);
            if (!cible) throw new Error(`cible inconnue : ${targetId}`);
            blocks.forEach(b => {
                cible.blocks._blocks[b.id] = b;
            });
            journal.blocs.push({target: cible.getName(), blocks});
            return Promise.resolve();
        },
        addSprite: json => {
            // `emptySprite` décrit le sprite au format « objName » de Scratch 2.
            const item = JSON.parse(json);
            const nom = item.objName || item.name;
            const nouveau = new FakeTarget(nom);
            journal.sprites.push(nom);
            vm.runtime.targets.push(nouveau);
            return Promise.resolve();
        }
    };
    return {vm, journal};
};

const config = {
    preset: 'custom',
    baseUrl: 'https://exemple.test/v1',
    apiKey: 'sk-test',
    model: 'modele-test',
    temperature: 0.3
};

const REPONSE = 'Bien sûr ! Je crée le sprite « Balle » et je le fais rebondir.\n' +
    '```scratchscript\n' +
    'var score = 0\n' +
    'sprite Balle 0 0:\n' +
    '  whenflagclicked\n' +
    '  gotoxy 0 0\n' +
    '  forever:\n' +
    '    move 10\n' +
    '    if (touching _edge_):\n' +
    '      change score 1\n' +
    '```\n' +
    'Dis-moi si tu veux un son à chaque point.';

/** Fausse réponse HTTP qui streamée, morceau par morceau. */
const fakeFetch = () => {
    const encodeur = new TextEncoder();
    const morceaux = [REPONSE.slice(0, 40), REPONSE.slice(40, 120), REPONSE.slice(120)]
        .map(texte => `data: ${JSON.stringify({choices: [{delta: {content: texte}}]})}\n\n`);
    let index = 0;
    return (url, options) => {
        fakeFetch.derniereRequete = {url, options};
        return Promise.resolve({
            ok: true,
            status: 200,
            body: {
                getReader: () => ({
                    read: () => Promise.resolve(index < morceaux.length ? {
                        done: false,
                        value: encodeur.encode(morceaux[index++])
                    } : {done: true})
                })
            }
        });
    };
};

const flush = async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
};

const bouton = (wrapper, texte) => wrapper
    .findWhere(node => node.type() === 'button' && node.text() === texte)
    .first();

describe('Tchat Sorax', () => {
    beforeAll(() => {
        // Le banc de test tourne sans DOM : ni TextDecoder ni localStorage.
        global.TextDecoder = require('util').TextDecoder;
        const donnees = {};
        global.localStorage = {
            getItem: cle => (Object.prototype.hasOwnProperty.call(donnees, cle) ? donnees[cle] : null),
            setItem: (cle, valeur) => {
                donnees[cle] = String(valeur);
            },
            removeItem: cle => {
                delete donnees[cle];
            }
        };
    });

    test('une conversation normale affiche la réponse et propose de créer les blocs', async () => {
        const {vm} = makeVM();
        global.fetch = fakeFetch();
        const wrapper = shallow(<SoraxChat vm={vm} />);
        wrapper.instance().setState({config});

        // L'accueil propose des exemples tant qu'aucun message n'existe.
        expect(wrapper.text()).toContain('Salut ! Je suis Sorax');
        bouton(wrapper, 'Crée un jeu de Pong avec un score').simulate('click');
        await flush();

        const messages = wrapper.instance().state.messages;
        expect(messages.map(m => m.role)).toEqual(['user', 'assistant']);
        expect(messages[1].content).toBe(REPONSE);
        expect(messages[1].pending).toBe(false);
        expect(wrapper.instance().state.busy).toBe(false);

        // Le texte est lisible, le code est dans son propre cadre.
        expect(wrapper.text()).toContain('Bien sûr ! Je crée le sprite « Balle »');
        expect(wrapper.text()).toContain('whenflagclicked');
        expect(wrapper.text()).toContain('Créer les blocs');
        expect(wrapper.text()).toContain('Copier');

        // Le modèle a bien reçu l'état du projet et les règles du langage.
        const corps = JSON.parse(fakeFetch.derniereRequete.options.body);
        expect(corps.messages[0].role).toBe('system');
        expect(corps.messages[0].content).toContain('Sorax');
        expect(corps.messages[0].content).toContain('ScratchScript');
        expect(corps.messages[0].content).toContain('"Sprite1"');
        expect(corps.messages[1]).toEqual({role: 'user', content: 'Crée un jeu de Pong avec un score'});
    });

    test('« Créer les blocs » applique le ScratchScript au projet', async () => {
        const {vm, journal} = makeVM();
        global.fetch = fakeFetch();
        const wrapper = shallow(<SoraxChat vm={vm} />);
        wrapper.instance().setState({config});
        wrapper.instance().setState({input: 'fais rebondir une balle'});
        wrapper.instance().handleSend();
        await flush();

        expect(journal.sprites).toHaveLength(0);
        bouton(wrapper, 'Créer les blocs').simulate('click');
        await flush();

        // Le sprite du code a été créé, avec ses scripts.
        expect(journal.sprites).toContain('Balle');
        expect(journal.blocs.length).toBeGreaterThan(0);
        const balle = vm.runtime.targets.find(t => t.getName() === 'Balle');
        const opcodes = Object.values(balle.blocks._blocks).map(b => b.opcode);
        expect(opcodes).toContain('motion_movesteps');
        expect(opcodes).toContain('control_forever');
        expect(opcodes).toContain('event_whenflagclicked');
        expect(wrapper.instance().state.applied.ok).toBe(true);
        // Le compte rendu reprend les lignes utiles du journal, pas le bruit.
        expect(wrapper.instance().state.applied.resume).toContain('Sprite "Balle" créé');
        expect(wrapper.text()).toContain('Sprite "Balle" créé');
    });

    test('sans clé API, Sorax ouvre les réglages au lieu d\'envoyer un message', async () => {
        const {vm} = makeVM();
        let appels = 0;
        global.fetch = () => {
            appels++;
            return Promise.resolve({ok: true, status: 200, body: null});
        };
        const wrapper = shallow(<SoraxChat vm={vm} />);
        wrapper.instance().setState({input: 'bonjour'});
        await wrapper.instance().handleSend();

        expect(appels).toBe(0);
        expect(wrapper.instance().state.settingsOpen).toBe(true);
        expect(wrapper.text()).toContain('colle ta clé API');
        expect(wrapper.instance().state.messages).toHaveLength(0);

        // Une adresse locale (Ollama) n'a pas besoin de clé : on enregistre et
        // le message part.
        wrapper.instance().setState({config: {
            preset: 'ollama',
            baseUrl: 'http://localhost:11434/v1',
            apiKey: '',
            model: 'llama3.1',
            temperature: 0.3
        }});
        global.fetch = fakeFetch();
        await wrapper.instance().handleSend();
        expect(wrapper.instance().state.messages).toHaveLength(2);
    });

    test('une erreur de l\'API est montrée à l\'utilisateur, pas avalée', async () => {
        const {vm} = makeVM();
        global.fetch = () => Promise.resolve({
            ok: false,
            status: 401,
            text: () => Promise.resolve('{"error": {"message": "Invalid API key"}}')
        });
        const wrapper = shallow(<SoraxChat vm={vm} />);
        wrapper.instance().setState({config});
        wrapper.instance().setState({input: 'bonjour'});
        await wrapper.instance().handleSend();

        expect(wrapper.instance().state.error).toContain('401');
        expect(wrapper.instance().state.error).toContain('clé API');
        expect(wrapper.text()).toContain('Invalid API key');
        // La question reste dans la conversation, la réponse vide est retirée.
        expect(wrapper.instance().state.messages).toHaveLength(1);
        expect(wrapper.instance().state.messages[0].role).toBe('user');
    });

    test('le prompt système décrit le projet courant', () => {
        const {vm} = makeVM();
        AIAgent.setVM(vm);
        const prompt = AIAgent.getChatSystemPrompt();
        expect(prompt).toContain('Sorax');
        expect(prompt).toContain('scène');
        expect(prompt).toContain('ScratchScript');
        expect(prompt).toContain('RÉFÉRENCE DES COMMANDES');
    });
});
