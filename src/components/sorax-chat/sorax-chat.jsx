import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';

import AIAgent from '../../lib/ai-agent/index.js';
import {
    PRESETS, loadConfig, saveConfig, isConfigured, presetById, normalizeBaseUrl,
    streamChat, looksLikeScratchScript, segments
} from '../../lib/sorax-chat.js';
import styles from './sorax-chat.css';

const SUGGESTIONS = [
    'Crée un jeu de Pong avec un score',
    'Un personnage qui saute sur des plateformes',
    'Ajoute un chronomètre de 30 secondes',
    'Explique ce que fait le sprite principal'
];

/**
 * Le tchat Sorax : une conversation normale, avec le projet Scratch sous les
 * yeux du modèle. Chaque bloc de ScratchScript qu'il produit peut être appliqué
 * au projet d'un clic (c'est le même compilateur que le Terminal IA).
 */
class SoraxChat extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            config: loadConfig(),
            messages: [], // {role, content}
            input: '',
            busy: false,
            error: null,
            settingsOpen: false,
            applied: null, // {index, message, ok}
            copied: null
        };
        this.controller = null;
        this.messagesRef = React.createRef();
        this.handleSend = this.handleSend.bind(this);
        this.handleStop = this.handleStop.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleInput = this.handleInput.bind(this);
        this.handleReset = this.handleReset.bind(this);
        this.handleConfigChange = this.handleConfigChange.bind(this);
        this.handlePresetChange = this.handlePresetChange.bind(this);
        this.handleApply = this.handleApply.bind(this);
        this.handleCopy = this.handleCopy.bind(this);
        this.toggleSettings = this.toggleSettings.bind(this);
    }

    componentDidMount () {
        if (this.props.vm) AIAgent.setVM(this.props.vm);
    }

    componentDidUpdate () {
        if (this.messagesRef.current) {
            this.messagesRef.current.scrollTop = this.messagesRef.current.scrollHeight;
        }
    }

    getConfig () {
        return this.state.config;
    }

    handleConfigChange (champ, valeur) {
        const config = Object.assign({}, this.state.config, {[champ]: valeur});
        this.setState({config: config});
        saveConfig(config);
    }

    handlePresetChange (id) {
        const preset = presetById(id);
        const config = Object.assign({}, this.state.config, {
            preset: id,
            baseUrl: preset.baseUrl || this.state.config.baseUrl,
            model: preset.model || this.state.config.model
        });
        this.setState({config: config});
        saveConfig(config);
    }

    handleInput (e) {
        this.setState({input: e.target.value});
    }

    handleKeyDown (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.handleSend();
        }
    }

    handleStop () {
        if (this.controller) this.controller.abort();
        this.setState({busy: false});
    }

    handleReset () {
        this.handleStop();
        this.setState({messages: [], error: null, applied: null});
    }

    handleCopy (texte) {
        if (navigator.clipboard) navigator.clipboard.writeText(texte);
        this.setState({copied: texte});
        if (this.copiedTimer) clearTimeout(this.copiedTimer);
        this.copiedTimer = setTimeout(() => this.setState({copied: null}), 1500);
    }

    /**
     * Applique un bloc de ScratchScript au projet, avec le compilateur de l'IDE.
     * @param {string} code code ScratchScript produit par Sorax
     * @param {number} indexMessage index du message d'où vient le code
     * @returns {Promise<void>} rien, l'état du composant porte le compte rendu
     */
    async handleApply (code, indexMessage) {
        const rapport = await AIAgent.execute(code);
        const logs = rapport.logs || [];
        // Le journal est verbeux : on ne garde que les lignes de résultat.
        const retenus = logs.filter(ligne => /^[✓⚠]/.test(ligne)).slice(0, 3).join(' · ');
        const dernier = logs.length ? logs[logs.length - 1] : '';
        this.setState({
            applied: {
                index: indexMessage,
                ok: rapport.success,
                resume: retenus || dernier || (rapport.success ? 'Blocs créés ✓' : 'Aucun bloc créé')
            }
        });
    }

    buildMessages (historique, question) {
        const systeme = AIAgent.getChatSystemPrompt();
        return [{role: 'system', content: systeme}]
            .concat(historique, [{role: 'user', content: question}]);
    }

    /**
     * Envoie un message à Sorax et affiche la réponse au fil de l'eau.
     * @param {string=} texteForce message imposé (boutons de suggestion)
     * @returns {Promise<void>} rien
     */
    async handleSend (texteForce) {
        const question = (typeof texteForce === 'string' ? texteForce : this.state.input).trim();
        if (!question || this.state.busy) return;
        if (!isConfigured(this.state.config)) {
            this.setState({settingsOpen: true,
                error: 'Choisis d\'abord un modèle et colle ta clé API ' +
                '(ou lance Ollama en local : aucune clé n\'est nécessaire).'});
            return;
        }

        const historique = this.state.messages.slice();
        const messages = historique.concat([{role: 'user', content: question}]);
        const indexAssistant = messages.length;
        this.setState({
            messages: messages.concat([{role: 'assistant', content: '', pending: true}]),
            input: '',
            busy: true,
            error: null,
            applied: null
        });

        this.controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const options = {
            config: this.state.config,
            messages: this.buildMessages(historique, question),
            onDelta: (morceau, complet) => {
                this.setState(etat => {
                    const copie = etat.messages.slice();
                    copie[indexAssistant] = {role: 'assistant', content: complet, pending: true};
                    return {messages: copie};
                });
            }
        };
        if (this.controller) options.signal = this.controller.signal;
        try {
            const reponse = await streamChat(options);
            this.setState(etat => {
                const copie = etat.messages.slice();
                copie[indexAssistant] = {role: 'assistant', content: reponse, pending: false};
                return {messages: copie, busy: false};
            });
        } catch (erreur) {
            const annule = erreur && erreur.name === 'AbortError';
            this.setState(etat => {
                const copie = etat.messages.slice();
                if (annule) {
                    copie[indexAssistant] = {
                        role: 'assistant',
                        content: `${copie[indexAssistant].content || ''}\n\n_(arrêté)_`,
                        pending: false
                    };
                } else {
                    copie.pop();
                }
                return {
                    messages: copie,
                    busy: false,
                    error: annule ? null : String(erreur.message || erreur)
                };
            });
        } finally {
            this.controller = null;
        }
    }

    toggleSettings () {
        this.setState(etat => ({settingsOpen: !etat.settingsOpen}));
    }

    renderSettings () {
        const config = this.state.config;
        return (
            <div className={styles.settings}>
                <label className={styles.field}>
                    <span className={styles.fieldLabel}>{'Fournisseur'}</span>
                    <select
                        className={styles.select}
                        value={config.preset}
                        onChange={e => this.handlePresetChange(e.target.value)}
                    >
                        {PRESETS.map(preset => (
                            <option
                                key={preset.id}
                                value={preset.id}
                            >{preset.label}</option>
                        ))}
                    </select>
                </label>
                <label className={styles.field}>
                    <span className={styles.fieldLabel}>{'Adresse de l\'API'}</span>
                    <input
                        className={styles.input}
                        type="text"
                        value={config.baseUrl}
                        onChange={e => this.handleConfigChange('baseUrl', e.target.value)}
                        placeholder="https://api.exemple.com/v1"
                    />
                </label>
                <label className={styles.field}>
                    <span className={styles.fieldLabel}>{'Modèle'}</span>
                    <input
                        className={styles.input}
                        type="text"
                        value={config.model}
                        onChange={e => this.handleConfigChange('model', e.target.value)}
                        placeholder="nom-du-modele"
                    />
                </label>
                <label className={styles.field}>
                    <span className={styles.fieldLabel}>{'Clé API'}</span>
                    <input
                        className={styles.input}
                        type="password"
                        value={config.apiKey}
                        onChange={e => this.handleConfigChange('apiKey', e.target.value)}
                        placeholder="colle ta clé (gardée dans ton navigateur)"
                    />
                </label>
                <p className={styles.hint}>
                    {presetById(config.preset).help}
                    {' · '}
                    {'Les réglages restent dans ton navigateur : aucune clé n\'est enregistrée dans le projet.'}
                </p>
                <p className={styles.hint}>
                    {normalizeBaseUrl(config.baseUrl) || '(adresse vide)'}
                    {'/chat/completions'}
                </p>
            </div>
        );
    }

    renderMessage (message, index) {
        const estUtilisateur = message.role === 'user';
        return (
            <div
                key={index}
                className={classNames(styles.message, {
                    [styles.userMessage]: estUtilisateur,
                    [styles.assistantMessage]: !estUtilisateur
                })}
            >
                <div className={styles.bubble}>
                    {estUtilisateur ? (
                        <div className={styles.text}>{message.content}</div>
                    ) : segments(message.content).map((partie, i) => (
                        partie.type === 'text' ? (
                            <div
                                key={i}
                                className={styles.text}
                            >{partie.content.trim()}</div>
                        ) : (
                            <div key={i}>
                                <pre className={styles.code}>{partie.content}</pre>
                                <div className={styles.codeActions}>
                                    <button
                                        className={styles.miniButton}
                                        type="button"
                                        onClick={() => this.handleCopy(partie.content)}
                                    >{this.state.copied === partie.content ? 'Copié ✓' : 'Copier'}</button>
                                    {looksLikeScratchScript(partie) ? (
                                        <button
                                            className={classNames(styles.miniButton, styles.primaryMini)}
                                            disabled={partie.open}
                                            type="button"
                                            onClick={() => this.handleApply(partie.content, index)}
                                        >{'Créer les blocs'}</button>
                                    ) : null}
                                </div>
                            </div>
                        )
                    ))}
                    {message.pending && !message.content ? (
                        <div className={styles.thinking}>{'Sorax réfléchit…'}</div>
                    ) : null}
                </div>
                {this.state.applied && this.state.applied.index === index ? (
                    <div
                        className={classNames(styles.applied, {
                            [styles.appliedError]: !this.state.applied.ok
                        })}
                    >{this.state.applied.resume}</div>
                ) : null}
            </div>
        );
    }

    renderEmpty () {
        return (
            <div className={styles.empty}>
                <p className={styles.emptyTitle}>{'Salut ! Je suis Sorax 👋'}</p>
                <p className={styles.emptyText}>
                    {'Dis-moi ce que tu veux construire : je connais le langage des blocs ' +
                        'et je peux les créer directement dans ton projet.'}
                </p>
                <div className={styles.chips}>
                    {SUGGESTIONS.map(suggestion => (
                        <button
                            key={suggestion}
                            className={styles.chip}
                            type="button"
                            onClick={() => this.handleSend(suggestion)}
                        >{suggestion}</button>
                    ))}
                </div>
                {!isConfigured(this.state.config) ? (
                    <p className={styles.emptyHint}>
                        {'Dernière étape : ouvre '}
                        <button
                            className={styles.linkButton}
                            type="button"
                            onClick={this.toggleSettings}
                        >{'les réglages'}</button>
                        {' et colle une clé API gratuite (Groq, Google AI Studio…), ' +
                            'ou lance Ollama sur ton ordinateur.'}
                    </p>
                ) : null}
            </div>
        );
    }

    render () {
        const config = this.state.config;
        return (
            <div className={styles.chat}>
                <div className={styles.bar}>
                    <span className={styles.model}>
                        {config.model || 'aucun modèle choisi'}
                    </span>
                    <span className={styles.barSpacer} />
                    <button
                        className={styles.barButton}
                        type="button"
                        onClick={this.handleReset}
                    >{'Nouveau'}</button>
                    <button
                        className={classNames(styles.barButton, {[styles.barButtonOn]: this.state.settingsOpen})}
                        type="button"
                        onClick={this.toggleSettings}
                    >{'Réglages'}</button>
                </div>

                {this.state.settingsOpen ? this.renderSettings() : null}

                <div
                    className={styles.messages}
                    ref={this.messagesRef}
                >
                    {this.state.messages.length ? this.state.messages.map((m, i) => this.renderMessage(m, i)) :
                        this.renderEmpty()}
                </div>

                {this.state.error ? (
                    <div className={styles.error}>{this.state.error}</div>
                ) : null}

                <div className={styles.composer}>
                    <textarea
                        className={styles.textarea}
                        rows={2}
                        value={this.state.input}
                        placeholder="Demande à Sorax… (Entrée = envoyer, Maj+Entrée = nouvelle ligne)"
                        onChange={this.handleInput}
                        onKeyDown={this.handleKeyDown}
                    />
                    {this.state.busy ? (
                        <button
                            className={classNames(styles.sendButton, styles.stopButton)}
                            type="button"
                            onClick={this.handleStop}
                        >{'Arrêter'}</button>
                    ) : (
                        <button
                            className={styles.sendButton}
                            type="button"
                            onClick={() => this.handleSend()}
                        >{'Envoyer'}</button>
                    )}
                </div>
            </div>
        );
    }
}

SoraxChat.propTypes = {
    vm: PropTypes.shape({
        runtime: PropTypes.shape({
            targets: PropTypes.array
        })
    })
};

export default SoraxChat;
