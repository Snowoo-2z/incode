import {
    PRESETS, DEFAULT_CONFIG, loadConfig, saveConfig, isConfigured, presetById, normalizeBaseUrl,
    parseSseEvents, deltaOf, streamChat, extractCodeBlocks, looksLikeScratchScript, segments
} from '../../../src/lib/sorax-chat';

/** Construit une fausse réponse HTTP qui streame des événements SSE. */
const fakeStreamResponse = morceaux => {
    let index = 0;
    const encodeur = new TextEncoder();
    return {
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
    };
};

const sse = texte => `data: ${JSON.stringify({choices: [{delta: {content: texte}}]})}\n\n`;

describe('Sorax chat — réglages', () => {
    // jsdom ne fournit pas localStorage sur une origine « about:blank » :
    // on installe un petit stockage en mémoire, comme celui du navigateur.
    beforeAll(() => {
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

    test('les valeurs par défaut pointent sur un fournisseur gratuit sans clé en dur', () => {
        expect(PRESETS.some(p => p.id === 'groq')).toBe(true);
        expect(PRESETS.some(p => p.id === 'ollama')).toBe(true);
        const config = loadConfig();
        expect(config.apiKey).toBe('');
        expect(config.model).toBe(DEFAULT_CONFIG.model);
    });

    test('les réglages enregistrés sont relus', () => {
        saveConfig(Object.assign({}, DEFAULT_CONFIG, {model: 'modele-test', apiKey: 'sk-test'}));
        const relu = loadConfig();
        expect(relu.model).toBe('modele-test');
        expect(relu.apiKey).toBe('sk-test');
        saveConfig(Object.assign({}, DEFAULT_CONFIG));
    });

    test('un serveur local se passe de clé, une API distante non', () => {
        expect(isConfigured({baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', apiKey: ''})).toBe(true);
        expect(isConfigured({baseUrl: 'https://api.groq.com/openai/v1', model: 'x', apiKey: ''})).toBe(false);
        expect(isConfigured({baseUrl: 'https://api.groq.com/openai/v1', model: 'x', apiKey: 'k'})).toBe(true);
        expect(isConfigured({baseUrl: 'https://api.groq.com/openai/v1', model: '', apiKey: 'k'})).toBe(false);
    });

    test('presetById retombe sur « Autre »', () => {
        expect(presetById('ollama').model).toBe('llama3.1');
        expect(presetById('inconnu').id).toBe('custom');
    });

    test('normalizeBaseUrl nettoie les adresses saisies à la main', () => {
        expect(normalizeBaseUrl('https://api.groq.com/openai/v1/')).toBe('https://api.groq.com/openai/v1');
        expect(normalizeBaseUrl('https://exemple.com')).toBe('https://exemple.com/v1');
        expect(normalizeBaseUrl('')).toBe('');
    });
});

describe('Sorax chat — protocole de streaming', () => {
    test('parseSseEvents ignore les lignes vides, [DONE] et le JSON incomplet', () => {
        const events = parseSseEvents('data: {"a":1}\n\ndata: [DONE]\n\ndata: {"b":\n');
        expect(events).toEqual([{a: 1}]);
    });

    test('deltaOf lit les réponses streamées comme les réponses d\'un coup', () => {
        expect(deltaOf({choices: [{delta: {content: 'salut'}}]})).toBe('salut');
        expect(deltaOf({choices: [{message: {content: 'salut'}}]})).toBe('salut');
        expect(deltaOf({choices: [{delta: {role: 'assistant'}}]})).toBe('');
        expect(deltaOf(null)).toBe('');
    });

    test('streamChat assemble les morceaux, même coupés au milieu d\'une ligne', async () => {
        const vus = [];
        const texte = await streamChat({
            config: {baseUrl: 'https://exemple.com/v1', model: 'm', apiKey: 'k'},
            messages: [{role: 'user', content: 'bonjour'}],
            onDelta: (morceau, complet) => vus.push(complet),
            fetchImpl: () => Promise.resolve(fakeStreamResponse([
                sse('Bon'),
                sse('jour').slice(0, 20), // ligne coupée : le reste arrive après
                sse('jour').slice(20),
                sse(' !')
            ]))
        });
        expect(texte).toBe('Bonjour !');
        expect(vus[vus.length - 1]).toBe('Bonjour !');
    });

    test('streamChat envoie la clé API et le modèle au bon format', async () => {
        let requete = null;
        await streamChat({
            config: {baseUrl: 'https://exemple.com/v1', model: 'mon-modele', apiKey: 'sk-123'},
            messages: [{role: 'system', content: 'sys'}, {role: 'user', content: 'coucou'}],
            fetchImpl: (url, options) => {
                requete = {url, options};
                return Promise.resolve(fakeStreamResponse([sse('ok')]));
            }
        });
        expect(requete.url).toBe('https://exemple.com/v1/chat/completions');
        expect(requete.options.headers.Authorization).toBe('Bearer sk-123');
        const corps = JSON.parse(requete.options.body);
        expect(corps.model).toBe('mon-modele');
        expect(corps.stream).toBe(true);
        expect(corps.messages).toHaveLength(2);
    });

    test('streamChat explique une erreur 401 au lieu de laisser « undefined »', async () => {
        await expect(streamChat({
            config: {baseUrl: 'https://exemple.com/v1', model: 'm', apiKey: 'mauvaise'},
            messages: [],
            fetchImpl: () => Promise.resolve({
                ok: false,
                status: 401,
                text: () => Promise.resolve('{"error": {"message": "Invalid API key"}}')
            })
        })).rejects.toThrow(/401.*clé API.*Invalid API key/s);
    });

    test('sans streaming disponible, la réponse est lue d\'un coup', async () => {
        const texte = await streamChat({
            config: {baseUrl: 'https://exemple.com/v1', model: 'm', apiKey: 'k'},
            messages: [],
            fetchImpl: () => Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({choices: [{message: {content: 'réponse directe'}}]})
            })
        });
        expect(texte).toBe('réponse directe');
    });
});

describe('Sorax chat — lecture des réponses', () => {
    test('extractCodeBlocks récupère langage et contenu', () => {
        const blocs = extractCodeBlocks('Voici :\n```scratchscript\nmove 10\n```\nVoilà.');
        expect(blocs).toEqual([{language: 'scratchscript', code: 'move 10'}]);
    });

    test('looksLikeScratchScript accepte les blocs ScratchScript et rejette le reste', () => {
        expect(looksLikeScratchScript({language: 'scratchscript', code: 'move 10'})).toBe(true);
        expect(looksLikeScratchScript({language: 'scratch', code: 'move 10'})).toBe(true);
        expect(looksLikeScratchScript({language: 'python', code: 'print(1)'})).toBe(false);
        expect(looksLikeScratchScript({language: '', code: 'sprite Balle 0 0:\n  move 10'})).toBe(true);
        expect(looksLikeScratchScript({language: '', code: 'bonjour tout le monde'})).toBe(false);
    });

    test('segments alterne texte et code, et signale un bloc encore ouvert', () => {
        const parties = segments('Salut !\n```scratchscript\nmove 10\n```\nFini.');
        expect(parties.map(p => p.type)).toEqual(['text', 'code', 'text']);
        expect(parties[1].content).toBe('move 10');
        expect(parties[1].open).toBe(false);

        const enCours = segments('Je prépare :\n```scratchscript\nmove ');
        expect(enCours[enCours.length - 1].type).toBe('code');
        expect(enCours[enCours.length - 1].open).toBe(true);
    });

    test('segments ne perd rien du texte affiché', () => {
        const texte = 'Un **plan** :\n1. créer le sprite\n```scratch\nsay "hi"\n```';
        const rendu = segments(texte).map(p => p.content).join('\n');
        expect(rendu).toContain('**plan**');
        expect(rendu).toContain('say "hi"');
    });
});
