import React from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';

import ModalComponent from '../modal/modal.jsx';
import AIAgent, {
    PONG_GAME_TEMPLATE,
    WEB_PONG_TEMPLATE,
    WEB_CLICKER_TEMPLATE
} from '../../lib/ai-agent/index.js';
import ProjectDocumentation from '../../lib/project-documentation.js';
import styles from './ai-agent-modal.css';

class AIAgentModalComponent extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            activeTab: 'assistant', // 'assistant' | 'agent'
            userGoal: 'Créer un jeu de Pong à 2 joueurs : Paddle1 (touches W/S), Paddle2 (flèches Haut/Bas), une balle qui rebondit et compte les scores.',
            aiCodeInput: '',
            executionLogs: [
                '🤖 Bienvenue dans le Terminal Agent IA !',
                '1. Décrivez votre idée ou objectif.',
                '2. Cliquez sur "Copier le prompt pour l\'IA" et collez-le dans ChatGPT ou Claude.',
                '3. Collez la réponse de l\'IA ici et cliquez sur "Exécuter".',
                'Ou cliquez sur "Charger Pong Démo" pour tester immédiatement !'
            ],
            promptCopied: false,
            followUpCopied: false,
            reportCopied: false,
            // --- Mode agent : l'IA explore le projet elle-même avec des outils.
            agentGoal: '',
            agentResponse: '',
            agentLogs: [
                '🛰️ Mode agent — pensé pour les GROS projets.',
                'L\'IA ne reçoit qu\'un aperçu du projet (une ligne par sprite).',
                'Elle demande ce dont elle a besoin : /list, /read <sprite>, /vars, /search <mot>.',
                'Collez sa réponse ci-dessous : les outils sont exécutés, le code est appliqué,',
                'puis un texte « à renvoyer dans la même conversation » vous est proposé.'
            ],
            agentOverview: '',
            agentFollowUp: '',
            agentCopied: false,
            agentPromptCopied: false,
            agentBusy: false,
            targets: [],
            // --- Mode web : HTML/CSS/JS -> blocs Scratch (rendu + capture).
            webCode: '',
            webGoal: "Crée un petit jeu en HTML/CSS/JS (l'IA code une page web, elle devient des blocs).",
            webLogs: [
                '🌐 Mode HTML/JS — l\'IA code une mini-page web, elle devient des BLOCS Scratch.',
                '1. Colle du HTML/CSS/JS vanilla (ou charge un exemple).',
                '2. Clique sur « Convertir en blocs » : la page est rendue dans une iframe 480×360,',
                '   chaque élément avec un id devient un sprite (son look est capturé en costume),',
                '   et le JS (whenFlag/forever/if/keyPressed...) est traduit en blocs.',
                'Les <button> avec :hover/:active reçoivent plusieurs costumes permutés par des blocs.'
            ],
            webPromptCopied: false,
            webBusy: false,
            webStats: null
        };

        this.handleCopyPrompt = this.handleCopyPrompt.bind(this);
        this.handleCopyFollowUp = this.handleCopyFollowUp.bind(this);
        this.handleExecute = this.handleExecute.bind(this);
        this.handleLoadPong = this.handleLoadPong.bind(this);
        this.handleCopyReport = this.handleCopyReport.bind(this);
        this.handleCopyAgentPrompt = this.handleCopyAgentPrompt.bind(this);
        this.handleRunAgentTurn = this.handleRunAgentTurn.bind(this);
        this.handleCopyAgentFollowUp = this.handleCopyAgentFollowUp.bind(this);
        this.refreshTargets = this.refreshTargets.bind(this);
        this.refreshOverview = this.refreshOverview.bind(this);
        this.handleConvertWeb = this.handleConvertWeb.bind(this);
        this.handleLoadWebPong = this.handleLoadWebPong.bind(this);
        this.handleLoadWebClicker = this.handleLoadWebClicker.bind(this);
        this.handleCopyWebPrompt = this.handleCopyWebPrompt.bind(this);
    }

    componentDidMount () {
        if (this.props.vm) {
            AIAgent.setVM(this.props.vm);
        }
        ProjectDocumentation.bindToProject(this.props.projectTitle);
        this.refreshTargets();
        this.refreshOverview();
    }

    componentDidUpdate (prevProps) {
        if (prevProps.projectTitle !== this.props.projectTitle) {
            ProjectDocumentation.bindToProject(this.props.projectTitle);
        }
    }

    refreshTargets () {
        this.setState({
            targets: AIAgent.getTargets()
        });
    }

    /** Refreshes the light overview shown in the agent tab. */
    refreshOverview () {
        this.setState({agentOverview: AIAgent.getProjectOverview()});
    }

    /**
     * Copies a prompt to the clipboard and flashes the button that asked for it.
     * @param {string} text prompt to copy
     * @param {string} stateKey state flag driving the "✓ copié" label
     * @param {string} label fallback message when the clipboard is unavailable
     * @returns {Promise<void>} resolves once the copy attempt is done
     */
    async copyPrompt (text, stateKey, label) {
        try {
            await navigator.clipboard.writeText(text);
            this.setState({[stateKey]: true});
            setTimeout(() => this.setState({[stateKey]: false}), 2500);
        } catch (e) {
            alert(`${label} (copie manuelle) :\n${text.substring(0, 300)}...`);
        }
    }

    /** Full prompt: documentation + project state. First message of a chat. */
    async handleCopyPrompt () {
        await this.copyPrompt(
            AIAgent.generatePrompt(this.state.userGoal),
            'promptCopied',
            'Prompt « nouvelle conversation » généré'
        );
    }

    /** Short prompt: project state only, for an ongoing chat (no docs). */
    async handleCopyFollowUp () {
        await this.copyPrompt(
            AIAgent.generateContinuationPrompt(this.state.userGoal),
            'followUpCopied',
            'Prompt « suite de la conversation » généré'
        );
    }

    async handleExecute () {
        if (!this.state.aiCodeInput.trim()) {
            this.setState({
                executionLogs: [...this.state.executionLogs, '⚠ Veuillez d\'abord coller la réponse de l\'IA.']
            });
            return;
        }

        const report = await AIAgent.execute(this.state.aiCodeInput);
        this.setState({
            executionLogs: [...this.state.executionLogs, '--- Nouvelle exécution ---', ...report.logs]
        });
        this.refreshTargets();
    }

    async handleLoadPong () {
        const pongJson = JSON.stringify({ actions: PONG_GAME_TEMPLATE.actions }, null, 2);
        this.setState({
            aiCodeInput: pongJson,
            executionLogs: [...this.state.executionLogs, '🚀 Modèle Pong chargé. Exécution en cours...']
        });
        const report = await AIAgent.execute(pongJson);
        this.setState({
            executionLogs: [...this.state.executionLogs, ...report.logs]
        });
        this.refreshTargets();
    }

    async handleCopyReport () {
        await this.copyPrompt(
            AIAgent.generateContinuationPrompt(
                'Voici le résultat de l\'exécution. Corrige ce qui a échoué, puis propose les prochaines améliorations.'
            ),
            'reportCopied',
            'Rapport copié'
        );
    }

    /** Agent mode: documentation + light overview + the tools it may call. */
    async handleCopyAgentPrompt () {
        const goal = this.state.agentGoal.trim() || this.state.userGoal;
        await this.copyPrompt(
            AIAgent.generateAgentPrompt(goal),
            'agentPromptCopied',
            'Prompt agent généré'
        );
    }

    /**
     * Runs one agent turn: the `/…` tool calls are executed, the rest of the
     * answer is applied as ScratchScript/JSON, and the follow-up prompt is
     * shown so the user can paste it back in the same conversation.
     * @returns {Promise<void>} resolves when the turn is done
     */
    async handleRunAgentTurn () {
        const response = this.state.agentResponse;
        if (!response.trim()) {
            this.setState({
                agentLogs: [...this.state.agentLogs, '⚠ Collez d\'abord la réponse de l\'IA.']
            });
            return;
        }

        this.setState({agentBusy: true});
        const turn = await AIAgent.runAgentTurn(response);
        this.setState({agentBusy: false});

        const logs = [...this.state.agentLogs];
        logs.push(`\n--- Tour ${logs.filter(l => l.startsWith('\n--- Tour')).length + 1} ---`);
        if (turn.requests.length) {
            logs.push(`🔎 ${turn.requests.length} outil(s) demandé(s) : ` +
                turn.requests.map(r => r.raw).join(' | '));
            logs.push(...turn.answers);
        } else {
            logs.push('🔎 Aucun outil demandé.');
        }
        if (turn.unknown.length) {
            logs.push(`⚠ Commande(s) inconnue(s) ignorée(s) : ${turn.unknown.join(' | ')}`);
        }
        if (turn.report) {
            logs.push(...turn.report.logs);
        } else {
            logs.push('ℹ Aucun code à exécuter dans cette réponse.');
        }
        logs.push('👉 Copiez le texte ci-dessous et renvoyez-le à l\'IA dans la même conversation.');

        // The box is emptied so the NEXT paste is clean: leaving the previous
        // answer in place would re-run its /read and re-apply its code.
        this.setState({agentLogs: logs, agentFollowUp: turn.followUp, agentResponse: ''});
        this.refreshTargets();
        this.refreshOverview();
    }

    async handleCopyAgentFollowUp () {
        await this.copyPrompt(
            this.state.agentFollowUp,
            'agentCopied',
            'Réponse à renvoyer à l\'IA'
        );
    }

    /** Web mode: transpiles the HTML/CSS/JS paste and applies the actions. */
    async handleConvertWeb (overrideCode) {
        const code = typeof overrideCode === 'string' ? overrideCode : this.state.webCode;
        if (!code || !code.trim()) {
            this.setState({
                webLogs: [...this.state.webLogs, '⚠ Collez d\'abord du code HTML/CSS/JS.']
            });
            return;
        }
        this.setState({webBusy: true});
        try {
            const report = await AIAgent.executeWeb({code});
            const stats = report.stats;
            const summary = stats ? [
                '🌐 Conversion terminée :',
                `   ${stats.sprites} sprite(s) / ${stats.costumes} costume(s) capturé(s),`,
                `   ${stats.scripts} script(s) en blocs, ${stats.variables} variable(s), ${stats.lists} liste(s).`
            ].join('\n') : '';
            this.setState({
                webLogs: [...this.state.webLogs, '--- Nouvelle conversion ---',
                    summary, ...report.logs].filter(Boolean),
                webStats: stats
            });
        } catch (e) {
            this.setState({
                webLogs: [...this.state.webLogs, `❌ Erreur de conversion : ${e.message}`]
            });
        }
        this.setState({webBusy: false});
        this.refreshTargets();
    }

    /** Loads the web-mode Pong example and converts it immediately. */
    async handleLoadWebPong () {
        this.setState({webCode: WEB_PONG_TEMPLATE.code});
        await this.handleConvertWeb(WEB_PONG_TEMPLATE.code);
    }

    /** Loads the web-mode clicker example and converts it immediately. */
    async handleLoadWebClicker () {
        this.setState({webCode: WEB_CLICKER_TEMPLATE.code});
        await this.handleConvertWeb(WEB_CLICKER_TEMPLATE.code);
    }

    /** Copies the prompt that makes an external AI answer in the web dialect. */
    async handleCopyWebPrompt () {
        await this.copyPrompt(
            AIAgent.generateWebPrompt(this.state.webGoal),
            'webPromptCopied',
            'Prompt mode web généré'
        );
    }

    renderAssistantTab () {
        return (
            <React.Fragment>
                {/* Step 1: Goal & Copy Prompt */}
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionTitle}>
                            <span className={styles.stepNumber}>{'1'}</span>
                            <span>Que souhaitez-vous créer ?</span>
                        </div>
                    </div>
                    <p className={styles.sectionDesc}>
                        {'Le terminal analyse l\'état de votre projet Scratch et génère le prompt à coller dans ' +
                            'ChatGPT ou Claude. Deux modes : « Nouvelle conversation » envoie toute la ' +
                            'documentation (comment coder, costumes SVG, éditions ciblées) plus l\'état du projet — ' +
                            'c\'est le premier message. « Suite de la conversation » n\'envoie que l\'état actuel du ' +
                            'projet, pour ne pas renvoyer la documentation à chaque tour.'}
                    </p>
                    <textarea
                        className={styles.textarea}
                        rows={3}
                        value={this.state.userGoal}
                        onChange={e => this.setState({userGoal: e.target.value})}
                        placeholder="Ex: Créer un jeu de Pong avec 2 raquettes et une balle qui compte les points..."
                    />
                    <div className={styles.buttonRow}>
                        <button
                            className={classNames(
                                styles.actionBtn,
                                this.state.promptCopied ? styles.successBtn : styles.primaryBtn
                            )}
                            onClick={this.handleCopyPrompt}
                            title={'Prompt complet : la documentation du langage + l\'état du projet. ' +
                                'À utiliser comme PREMIER message d\'une conversation.'}
                        >
                            {this.state.promptCopied ?
                                '✓ Prompt complet copié !' :
                                '🆕 Nouvelle conversation (doc + projet)'}
                        </button>
                        <button
                            className={classNames(
                                styles.actionBtn,
                                this.state.followUpCopied ? styles.successBtn : styles.secondaryBtn
                            )}
                            onClick={this.handleCopyFollowUp}
                            title={'Prompt court : uniquement l\'état actuel du projet, sans la documentation. ' +
                                'À utiliser dans une conversation déjà commencée.'}
                        >
                            {this.state.followUpCopied ?
                                '✓ État du projet copié !' :
                                '💬 Suite de la conversation (état du projet)'}
                        </button>
                        <button
                            className={classNames(styles.actionBtn, styles.templateBtn)}
                            onClick={this.handleLoadPong}
                            title="Charge immédiatement le code complet d'un jeu de Pong pour tester"
                        >
                            🚀 Charger l'exemple Pong
                        </button>
                    </div>
                </div>

                {/* Step 2: Paste AI Response */}
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionTitle}>
                            <span className={styles.stepNumber}>{'2'}</span>
                            <span>Collez la réponse de l'IA</span>
                        </div>
                    </div>
                    <p className={styles.sectionDesc}>
                        Collez la réponse de l'IA (format compact ScratchScript OU JSON), puis cliquez sur Exécuter.
                        Les deux formats sont détectés automatiquement.
                    </p>
                    <textarea
                        className={classNames(styles.textarea, styles.textareaCode)}
                        rows={6}
                        value={this.state.aiCodeInput}
                        onChange={e => this.setState({aiCodeInput: e.target.value})}
                        placeholder={'Collez ici la réponse de l\'IA.\nExemple ScratchScript :\nsprite Balle:\n  whenflagclicked\n  forever:\n    move 10\n    bounce'}
                    />
                    <div className={styles.buttonRow}>
                        <button
                            className={classNames(styles.actionBtn, styles.primaryBtn)}
                            onClick={this.handleExecute}
                        >
                            ▶ Exécuter le code sur Scratch
                        </button>
                        <button
                            className={classNames(styles.actionBtn, styles.secondaryBtn)}
                            onClick={() => this.setState({aiCodeInput: ''})}
                        >
                            Effacer
                        </button>
                    </div>
                </div>

                {/* Step 3: Logs & Next Step */}
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionTitle}>
                            <span className={styles.stepNumber}>{'3'}</span>
                            <span>Journal d'exécution & Suivi</span>
                        </div>
                    </div>
                    <div className={styles.terminalBox}>
                        {this.state.executionLogs.join('\n')}
                    </div>
                    <div className={styles.buttonRow}>
                        <button
                            className={classNames(styles.actionBtn, this.state.reportCopied ? styles.successBtn : styles.secondaryBtn)}
                            onClick={this.handleCopyReport}
                        >
                            {this.state.reportCopied ? '✓ Rapport copié !' : '📋 Copier le rapport pour l\'étape suivante de l\'IA'}
                        </button>
                    </div>
                </div>
            </React.Fragment>
        );
    }

    renderAgentTab () {
        const hasFollowUp = Boolean(this.state.agentFollowUp);

        return (
            <React.Fragment>
                {/* Step 1: goal + what the AI will actually receive */}
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionTitle}>
                            <span className={styles.stepNumber}>{'1'}</span>
                            <span>Objectif de l'agent</span>
                        </div>
                        <button
                            className={classNames(styles.actionBtn, styles.secondaryBtn)}
                            onClick={this.refreshOverview}
                            title="Relit le projet et met à jour l'aperçu envoyé à l'IA"
                        >
                            🔄 Aperçu
                        </button>
                    </div>
                    <p className={styles.sectionDesc}>
                        {'Ici l\'IA ne reçoit PAS le code du projet, seulement l\'aperçu ci-dessous : elle demande ' +
                            'elle-même les sprites dont elle a besoin avec /read. Idéal quand le projet est trop ' +
                            'gros pour tenir dans un seul prompt.'}
                    </p>
                    <textarea
                        className={styles.textarea}
                        rows={3}
                        value={this.state.agentGoal}
                        onChange={e => this.setState({agentGoal: e.target.value})}
                        placeholder="Ex: Le score ne s'incrémente pas quand la balle touche la raquette — trouve et corrige le bug."
                    />
                    <div className={styles.overviewBox}>
                        {this.state.agentOverview || 'Aucun sprite dans le projet.'}
                    </div>
                    <div className={styles.buttonRow}>
                        <button
                            className={classNames(
                                styles.actionBtn,
                                this.state.agentPromptCopied ? styles.successBtn : styles.primaryBtn
                            )}
                            onClick={this.handleCopyAgentPrompt}
                            title={'Prompt agent : documentation du langage + aperçu du projet + outils ' +
                                '/list, /read, /vars, /search. À utiliser comme PREMIER message.'}
                        >
                            {this.state.agentPromptCopied ?
                                '✓ Prompt agent copié !' :
                                '🛰️ Copier le prompt agent (contexte léger)'}
                        </button>
                    </div>
                </div>

                {/* Step 2: paste the answer, run its tools + its code */}
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionTitle}>
                            <span className={styles.stepNumber}>{'2'}</span>
                            <span>Collez la réponse de l'IA</span>
                        </div>
                    </div>
                    <p className={styles.sectionDesc}>
                        {'La réponse peut contenir des outils (/read Balle, /vars, /search rebond...) et du code. ' +
                            'Les outils sont exécutés, le code est appliqué au projet.'}
                    </p>
                    <textarea
                        className={classNames(styles.textarea, styles.textareaCode)}
                        rows={6}
                        value={this.state.agentResponse}
                        onChange={e => this.setState({agentResponse: e.target.value})}
                        placeholder={'Collez ici la réponse de l\'IA.\nExemple :\n/read Balle\n/vars\n```scratch\non Balle:\n  edit 1/3.1 move 25\n```'}
                    />
                    <div className={styles.buttonRow}>
                        <button
                            className={classNames(styles.actionBtn, styles.primaryBtn)}
                            onClick={this.handleRunAgentTurn}
                            disabled={this.state.agentBusy}
                        >
                            {this.state.agentBusy ?
                                '⏳ Exécution en cours…' :
                                '▶ Exécuter les outils + le code'}
                        </button>
                        <button
                            className={classNames(styles.actionBtn, styles.secondaryBtn)}
                            onClick={() => this.setState({agentResponse: ''})}
                        >
                            Effacer
                        </button>
                    </div>
                </div>

                {/* Step 3: what the tools answered */}
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionTitle}>
                            <span className={styles.stepNumber}>{'3'}</span>
                            <span>Journal de l'agent</span>
                        </div>
                    </div>
                    <div className={styles.terminalBox}>
                        {this.state.agentLogs.join('\n')}
                    </div>
                </div>

                {/* Step 4: the loop — send this back in the SAME conversation */}
                {hasFollowUp && (
                    <div className={classNames(styles.section, styles.followUpSection)}>
                        <div className={styles.sectionHeader}>
                            <div className={styles.sectionTitle}>
                                <span className={styles.stepNumber}>{'4'}</span>
                                <span>Envoyer ceci à l'IA dans la même conversation</span>
                            </div>
                        </div>
                        <p className={styles.sectionDesc}>
                            {'Copiez ce texte et collez-le à la suite de la conversation déjà ouverte : il contient ' +
                                'les réponses aux outils demandés et l\'état du projet après exécution.'}
                        </p>
                        <div className={styles.followUpBox}>
                            {this.state.agentFollowUp}
                        </div>
                        <div className={styles.buttonRow}>
                            <button
                                className={classNames(
                                    styles.actionBtn,
                                    this.state.agentCopied ? styles.successBtn : styles.primaryBtn
                                )}
                                onClick={this.handleCopyAgentFollowUp}
                                title="Copie le texte à renvoyer à l'IA dans la même conversation"
                            >
                                {this.state.agentCopied ?
                                    '✓ Copié ! Collez-le chez l\'IA' :
                                    '📋 Copier la réponse à renvoyer à l\'IA'}
                            </button>
                        </div>
                    </div>
                )}
            </React.Fragment>
        );
    }

    renderWebTab () {
        return (
            <React.Fragment>
                {/* Step 1: goal -> prompt for an external AI */}
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionTitle}>
                            <span className={styles.stepNumber}>{'1'}</span>
                            <span>{'Demander à l\'IA de coder en HTML/CSS/JS'}</span>
                        </div>
                    </div>
                    <p className={styles.sectionDesc}>
                        {'Copiez ce prompt dans ChatGPT ou Claude : il demande à l\'IA d\'écrire une ' +
                            'mini-page web (480×360) dans un dialecte JS simple. Chaque élément avec un ' +
                            'id devient un sprite, son look (couleurs, dégradés, :hover, texte, emojis) ' +
                            'est capturé en costume, et le JS est traduit en blocs.'}
                    </p>
                    <textarea
                        className={styles.textarea}
                        rows={2}
                        value={this.state.webGoal}
                        onChange={e => this.setState({webGoal: e.target.value})}
                        placeholder="Ex: Un petit jeu de clicker avec un bouton qui grossit..."
                    />
                    <div className={styles.buttonRow}>
                        <button
                            className={classNames(
                                styles.actionBtn,
                                this.state.webPromptCopied ? styles.successBtn : styles.primaryBtn
                            )}
                            onClick={this.handleCopyWebPrompt}
                        >
                            {this.state.webPromptCopied ?
                                '✓ Prompt web copié !' :
                                '📋 Copier le prompt (mode HTML/JS)'}
                        </button>
                    </div>
                </div>

                {/* Step 2: paste / load web code */}
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionTitle}>
                            <span className={styles.stepNumber}>{'2'}</span>
                            <span>{'Code HTML/CSS/JS à transformer en blocs'}</span>
                        </div>
                    </div>
                    <p className={styles.sectionDesc}>
                        {'Collez une page HTML autonome (avec <style> et <script>), puis convertissez. ' +
                            'Le rendu est fidèle à la page : la mise en page est faite par le navigateur, ' +
                            'chaque objet devient un sprite à sa place, avec son costume.'}
                    </p>
                    <textarea
                        className={classNames(styles.textarea, styles.textareaCode)}
                        rows={12}
                        value={this.state.webCode}
                        onChange={e => this.setState({webCode: e.target.value})}
                        placeholder={
                            '<style>\n  body { background: #0f1b2d; }\n' +
                            '  #balle { position:absolute; left:229px; top:169px; width:22px; height:22px;\n' +
                            '            background:#FFAB19; border-radius:50%; }\n</style>\n' +
                            '<div id="balle"></div>\n<script>\n' +
                            'whenFlag(() => {\n  balle.gotoXy(0, 0);\n' +
                            '  forever(() => { balle.move(7); balle.bounce(); });\n});\n</script>'
                        }
                    />
                    <div className={styles.buttonRow}>
                        <button
                            className={classNames(styles.actionBtn, styles.primaryBtn)}
                            onClick={() => this.handleConvertWeb()}
                            disabled={this.state.webBusy}
                        >
                            {this.state.webBusy ?
                                '⏳ Conversion en cours…' :
                                '🌐 Convertir la page en blocs Scratch'}
                        </button>
                        <button
                            className={classNames(styles.actionBtn, styles.templateBtn)}
                            onClick={this.handleLoadWebPong}
                            title="Pong complet écrit en HTML/CSS/JS, converti puis appliqué"
                        >
                            🏓 Exemple Pong (web)
                        </button>
                        <button
                            className={classNames(styles.actionBtn, styles.templateBtn)}
                            onClick={this.handleLoadWebClicker}
                            title="Un bouton web avec états :hover/:active devenu sprite interactif"
                        >
                            🔘 Exemple Bouton
                        </button>
                        <button
                            className={classNames(styles.actionBtn, styles.secondaryBtn)}
                            onClick={() => this.setState({webCode: ''})}
                        >
                            Effacer
                        </button>
                    </div>
                </div>

                {/* Step 3: conversion journal */}
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionTitle}>
                            <span className={styles.stepNumber}>{'3'}</span>
                            <span>{'Journal de conversion'}</span>
                        </div>
                    </div>
                    <div className={styles.terminalBox}>
                        {this.state.webLogs.join('\n')}
                    </div>
                </div>
            </React.Fragment>
        );
    }

    render () {
        return (
            <ModalComponent
                className={styles.modalContent}
                contentLabel="Terminal Agent IA"
                onRequestClose={this.props.onClose}
            >
                <div className={styles.hero}>
                    <div className={styles.headerIcon}>{'🤖'}</div>
                    <div className={styles.headerText}>
                        <span className={styles.headerTitle}>{'Votre assistant de code Scratch'}</span>
                        <span className={styles.headerSubtitle}>
                            {'Générez un prompt, exécutez la réponse de l\'IA — ou laissez l\'agent explorer ' +
                                `le projet (${this.state.targets.length} cible(s)).`}
                        </span>
                    </div>
                </div>
                <div className={styles.body}>
                    {/* Navigation Tabs */}
                    <div className={styles.tabs}>
                        <button
                            className={classNames(styles.tabButton, {
                                [styles.tabActive]: this.state.activeTab === 'assistant'
                            })}
                            onClick={() => this.setState({activeTab: 'assistant'})}
                        >
                            {'🤖 Assistant IA'}
                        </button>
                        <button
                            className={classNames(styles.tabButton, {
                                [styles.tabActive]: this.state.activeTab === 'agent'
                            })}
                            onClick={() => this.setState({activeTab: 'agent'})}
                        >
                            {'🛰️ Mode agent (gros projets)'}
                        </button>
                        <button
                            className={classNames(styles.tabButton, {
                                [styles.tabActive]: this.state.activeTab === 'web'
                            })}
                            onClick={() => this.setState({activeTab: 'web'})}
                            title="L'IA code en HTML/CSS/JS : la page devient des sprites, des costumes et des blocs"
                        >
                            {'🌐 Mode HTML/JS → blocs'}
                        </button>
                    </div>

                    {/* Tab Content */}
                    {this.state.activeTab === 'assistant' && this.renderAssistantTab()}
                    {this.state.activeTab === 'agent' && this.renderAgentTab()}
                    {this.state.activeTab === 'web' && this.renderWebTab()}
                </div>
            </ModalComponent>
        );
    }
}

AIAgentModalComponent.propTypes = {
    onClose: PropTypes.func.isRequired,
    projectTitle: PropTypes.string,
    vm: PropTypes.shape({
        runtime: PropTypes.shape({
            targets: PropTypes.array
        })
    })
};

export default AIAgentModalComponent;
