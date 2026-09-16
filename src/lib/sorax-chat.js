/**
 * @fileoverview Le moteur du tchat Sorax : réglages, appels au modèle et
 * petits utilitaires de texte.
 *
 * Sorax parle à n'importe quelle API **compatible OpenAI** (`/chat/completions`
 * en streaming) : OpenAI, Groq, Google AI Studio, OpenRouter, Ollama ou
 * LM Studio tournent toutes sur ce format. Les réglages (adresse, clé, modèle)
 * sont stockés dans le navigateur de l'utilisateur — aucune clé n'est écrite
 * dans le code du projet.
 */

const STORAGE_KEY = 'sorax.chat.config';

/**
 * Fournisseurs prêts à l'emploi. Les quatre premiers proposent une offre
 * gratuite : il suffit d'y créer une clé.
 */
export const PRESETS = [
    {
        id: 'groq',
        label: 'Groq (gratuit, très rapide)',
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'llama-3.3-70b-versatile',
        help: 'Clé gratuite sur console.groq.com/keys'
    },
    {
        id: 'google',
        label: 'Google AI Studio (gratuit)',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'gemini-2.0-flash',
        help: 'Clé gratuite sur aistudio.google.com/apikey'
    },
    {
        id: 'openrouter',
        label: 'OpenRouter (modèles gratuits)',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'meta-llama/llama-3.3-70b-instruct:free',
        help: 'Clé sur openrouter.ai/keys'
    },
    {
        id: 'openai',
        label: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        help: 'Clé sur platform.openai.com/api-keys'
    },
    {
        id: 'ollama',
        label: 'Ollama, chez moi (aucune clé)',
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.1',
        help: 'Lance « ollama serve » sur ton ordinateur'
    },
    {
        id: 'lmstudio',
        label: 'LM Studio, chez moi (aucune clé)',
        baseUrl: 'http://localhost:1234/v1',
        model: 'local-model',
        help: 'Démarre le serveur local de LM Studio'
    },
    {
        id: 'custom',
        label: 'Autre (adresse personnalisée)',
        baseUrl: '',
        model: '',
        help: 'Toute API compatible OpenAI'
    }
];

export const DEFAULT_CONFIG = {
    preset: 'groq',
    baseUrl: PRESETS[0].baseUrl,
    apiKey: '',
    model: PRESETS[0].model,
    temperature: 0.3
};

/**
 * Lit les réglages enregistrés (avec les valeurs par défaut en secours).
 * @returns {object} réglages du tchat
 */
export const loadConfig = function () {
    if (typeof localStorage === 'undefined') return Object.assign({}, DEFAULT_CONFIG);
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return Object.assign({}, DEFAULT_CONFIG);
        return Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw));
    } catch (e) {
        return Object.assign({}, DEFAULT_CONFIG);
    }
};

/**
 * Enregistre les réglages dans le navigateur.
 * @param {object} config réglages à conserver
 * @returns {void} rien
 */
export const saveConfig = function (config) {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
        // navigation privée : on garde les réglages en mémoire seulement
    }
};

/**
 * Vrai si les réglages permettent d'envoyer un message.
 * @param {object} config réglages du tchat
 * @returns {boolean} vrai si un message peut partir
 */
export const isConfigured = function (config) {
    if (!config || !config.baseUrl || !config.model) return false;
    // un serveur local n'a pas besoin de clé
    const local = /localhost|127\.0\.0\.1/.test(config.baseUrl);
    return Boolean(config.apiKey) || local;
};

/**
 * Le fournisseur correspondant à un identifiant de preset.
 * @param {string} id identifiant du fournisseur
 * @returns {object} le fournisseur (le dernier, « Autre », par défaut)
 */
export const presetById = function (id) {
    return PRESETS.find(p => p.id === id) || PRESETS[PRESETS.length - 1];
};

/**
 * Nettoie une adresse d'API (enlève le « / » final, ajoute « /v1 » si besoin).
 * @param {string} url adresse saisie par l'utilisateur
 * @returns {string} adresse prête pour « /chat/completions »
 */
export const normalizeBaseUrl = function (url) {
    let base = String(url || '').trim()
        .replace(/\/+$/, '');
    if (!base) return base;
    if (!/\/v\d+$/.test(base) && !/\/openai$/.test(base)) base += '/v1';
    return base;
};

/**
 * Découpe un bloc de texte streamé en événements SSE exploitables.
 * Exposé pour être testable sans navigateur.
 * @param {string} texte données reçues (peut contenir plusieurs lignes)
 * @returns {Array<object>} événements JSON valides
 */
export const parseSseEvents = function (texte) {
    const events = [];
    String(texte || '').split('\n')
        .forEach(ligne => {
            const propre = ligne.trim();
            if (!propre.startsWith('data:')) return;
            const charge = propre.slice(5).trim();
            if (!charge || charge === '[DONE]') return;
            try {
                events.push(JSON.parse(charge));
            } catch (e) {
            // morceau incomplet : il arrivera au prochain passage
            }
        });
    return events;
};

/**
 * Extrait le texte d'un événement de streaming compatible OpenAI.
 * @param {object} event événement SSE déjà analysé
 * @returns {string} morceau de texte (chaîne vide si l'événement n'en porte pas)
 */
export const deltaOf = function (event) {
    if (!event || !event.choices || !event.choices.length) return '';
    const choix = event.choices[0];
    if (choix.delta && typeof choix.delta.content === 'string') return choix.delta.content;
    if (choix.message && typeof choix.message.content === 'string') return choix.message.content;
    return '';
};

/**
 * Envoie une conversation au modèle et rend le texte au fil de l'eau.
 * @param {object} options {config, messages, signal, onDelta, fetchImpl}
 * @returns {Promise<string>} réponse complète
 */
export const streamChat = async function (options) {
    const config = options.config || {};
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    const doFetch = options.fetchImpl || fetch;
    const entetes = {'Content-Type': 'application/json'};
    if (config.apiKey) entetes.Authorization = `Bearer ${config.apiKey}`;

    const reponse = await doFetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: entetes,
        signal: options.signal,
        body: JSON.stringify({
            model: config.model,
            messages: options.messages,
            temperature: typeof config.temperature === 'number' ? config.temperature : 0.3,
            stream: true
        })
    });

    if (!reponse.ok) {
        let detail = '';
        try {
            const corps = await reponse.text();
            try {
                const json = JSON.parse(corps);
                detail = (json.error && (json.error.message || json.error.code)) || corps;
            } catch (e) {
                detail = corps;
            }
        } catch (e) {
            detail = '';
        }
        const aide = reponse.status === 401 || reponse.status === 403 ?
            ' — vérifie la clé API dans les réglages.' :
            (reponse.status === 404 ? ' — vérifie l\'adresse et le nom du modèle.' : '');
        throw new Error(`Erreur ${reponse.status}${aide}${detail ? `\n${detail}` : ''}`);
    }

    if (!reponse.body || typeof reponse.body.getReader !== 'function') {
        // pas de streaming disponible : on lit la réponse d'un coup
        const json = await reponse.json();
        const texte = (json.choices && json.choices[0] &&
            ((json.choices[0].message && json.choices[0].message.content) || '')) || '';
        if (options.onDelta) options.onDelta(texte);
        return texte;
    }

    const lecteur = reponse.body.getReader();
    const decodeur = new TextDecoder();
    let tampon = '';
    let complet = '';
    for (;;) {
        const {done, value} = await lecteur.read();
        if (done) break;
        tampon += decodeur.decode(value, {stream: true});
        const lignes = tampon.split('\n');
        tampon = lignes.pop(); // garde la ligne incomplète
        parseSseEvents(lignes.join('\n')).forEach(event => {
            const morceau = deltaOf(event);
            if (!morceau) return;
            complet += morceau;
            if (options.onDelta) options.onDelta(morceau, complet);
        });
    }
    if (tampon) {
        parseSseEvents(tampon).forEach(event => {
            const morceau = deltaOf(event);
            if (!morceau) return;
            complet += morceau;
            if (options.onDelta) options.onDelta(morceau, complet);
        });
    }
    return complet;
};

/**
 * Repère les blocs de code ScratchScript d'une réponse.
 * @param {string} texte réponse du modèle
 * @returns {Array<{language: string, code: string}>} blocs trouvés
 */
export const extractCodeBlocks = function (texte) {
    const blocs = [];
    const motif = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
    let trouve = motif.exec(texte || '');
    while (trouve) {
        blocs.push({language: (trouve[1] || '').toLowerCase(), code: trouve[2].replace(/\s+$/, '')});
        trouve = motif.exec(texte || '');
    }
    return blocs;
};

const LANGAGES_DSL = ['scratchscript', 'scratch', 'dsl', 'scratchscript-dsl'];

/**
 * Vrai si un bloc de code ressemble à du ScratchScript applicable au projet.
 * @param {{language: string, code: string}} bloc bloc de code extrait
 * @returns {boolean} vrai si le compilateur de l'IDE saura le lire
 */
export const looksLikeScratchScript = function (bloc) {
    if (LANGAGES_DSL.includes(bloc.language)) return true;
    if (bloc.language && !LANGAGES_DSL.includes(bloc.language)) return false;
    const code = bloc.code || '';
    return /(^|\n)\s*(sprite|stage|var|list|when\w+|forever|si |if |repete|repeat)/i.test(code) ||
        /:\s*\n/.test(code);
};

/**
 * Découpe une réponse en morceaux affichables : texte et blocs de code.
 * @param {string} texte réponse (éventuellement partielle pendant le stream)
 * @returns {Array<{type: string, content: string, language: string}>}
 */
export const segments = function (texte) {
    const source = texte || '';
    const sortie = [];
    const motif = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)(?:```|$)/g;
    let curseur = 0;
    let trouve = motif.exec(source);
    while (trouve) {
        if (trouve.index > curseur) {
            sortie.push({type: 'text', content: source.slice(curseur, trouve.index), language: ''});
        }
        sortie.push({
            type: 'code',
            content: trouve[2].replace(/\s+$/, ''),
            language: (trouve[1] || '').toLowerCase(),
            open: !trouve[0].endsWith('```')
        });
        curseur = trouve.index + trouve[0].length;
        trouve = motif.exec(source);
    }
    if (curseur < source.length) {
        sortie.push({type: 'text', content: source.slice(curseur), language: ''});
    }
    return sortie;
};

export {STORAGE_KEY};
