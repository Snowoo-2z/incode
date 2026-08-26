import React from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';

import ModalComponent from '../modal/modal.jsx';
import AIAgent, {PONG_GAME_TEMPLATE} from '../../lib/ai-agent/index.js';
import styles from './ai-agent-modal.css';

class AIAgentModalComponent extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            activeTab: 'assistant', // 'assistant' | 'cli' | 'inspector'
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
            reportCopied: false,
            cliInput: '',
            cliLogs: [
                'Terminal Scratch CLI initialisé.',
                'Tapez "help" pour voir les commandes disponibles.'
            ],
            targets: []
        };

        this.handleCopyPrompt = this.handleCopyPrompt.bind(this);
        this.handleExecute = this.handleExecute.bind(this);
        this.handleLoadPong = this.handleLoadPong.bind(this);
        this.handleCopyReport = this.handleCopyReport.bind(this);
        this.handleCliKeyDown = this.handleCliKeyDown.bind(this);
        this.refreshTargets = this.refreshTargets.bind(this);
    }

    componentDidMount () {
        if (this.props.vm) {
            AIAgent.setVM(this.props.vm);
        }
        this.refreshTargets();
    }

    refreshTargets () {
        this.setState({
            targets: AIAgent.getTargets()
        });
    }

    async handleCopyPrompt () {
        const prompt = AIAgent.generatePrompt(this.state.userGoal);
        try {
            await navigator.clipboard.writeText(prompt);
            this.setState({promptCopied: true});
            setTimeout(() => this.setState({promptCopied: false}), 2500);
        } catch (e) {
            alert('Prompt généré (copie manuelle) :\n' + prompt.substring(0, 300) + '...');
        }
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
        const followUp = AIAgent.generateFollowUpPrompt('Tout a été exécuté. Quelles sont les prochaines améliorations ?');
        try {
            await navigator.clipboard.writeText(followUp);
            this.setState({reportCopied: true});
            setTimeout(() => this.setState({reportCopied: false}), 2500);
        } catch (e) {
            alert('Rapport copié !');
        }
    }

    async handleCliKeyDown (e) {
        if (e.key !== 'Enter') return;
        const cmdText = this.state.cliInput.trim();
        if (!cmdText) return;

        const newLogs = [...this.state.cliLogs, `> ${cmdText}`];
        this.setState({cliInput: ''});

        const parts = cmdText.split(/\s+/);
        const cmd = parts[0].toLowerCase();

        switch (cmd) {
        case 'help':
            newLogs.push(
                'Commandes disponibles :',
                '  status               : Afficher le résumé complet du projet',
                '  read <sprite>        : Lire les scripts et propriétés d\'un sprite',
                '  create-sprite <nom>  : Créer un nouveau sprite',
                '  create-var <nom>     : Créer une variable globale',
                '  clear <sprite>       : Supprimer les blocs d\'un sprite',
                '  pong                 : Générer le jeu Pong complet',
                '  clear-console        : Vider l\'affichage du terminal'
            );
            break;

        case 'clear-console':
            this.setState({cliLogs: []});
            return;

        case 'status':
            newLogs.push(AIAgent.getProjectSummary());
            break;

        case 'read':
            if (!parts[1]) {
                newLogs.push('Usage: read <nom_sprite>');
            } else {
                const sp = AIAgent.readSprite(parts[1]);
                if (!sp) {
                    newLogs.push(`Sprite "${parts[1]}" introuvable.`);
                } else {
                    newLogs.push(
                        `Sprite "${sp.name}" : x=${sp.x}, y=${sp.y}, direction=${sp.direction}, taille=${sp.size}%`,
                        `Scripts (${sp.scripts.length}) :`,
                        ...sp.scripts.map((s, i) => `[Script ${i + 1}]\n${s.text}`)
                    );
                }
            }
            break;

        case 'create-sprite':
            if (!parts[1]) {
                newLogs.push('Usage: create-sprite <nom>');
            } else {
                const rep = await AIAgent.execute(`CREATE_SPRITE ${parts[1]}`);
                newLogs.push(...rep.logs);
                this.refreshTargets();
            }
            break;

        case 'create-var':
            if (!parts[1]) {
                newLogs.push('Usage: create-var <nom>');
            } else {
                const rep = await AIAgent.execute(`CREATE_VAR ${parts[1]}`);
                newLogs.push(...rep.logs);
                this.refreshTargets();
            }
            break;

        case 'clear':
            if (!parts[1]) {
                newLogs.push('Usage: clear <nom_sprite>');
            } else {
                const rep = await AIAgent.execute(`CLEAR_BLOCKS ${parts[1]}`);
                newLogs.push(...rep.logs);
                this.refreshTargets();
            }
            break;

        case 'pong':
            newLogs.push('Création du jeu de Pong...');
            {
                const rep = await AIAgent.execute(JSON.stringify({ actions: PONG_GAME_TEMPLATE.actions }));
                newLogs.push(...rep.logs);
                this.refreshTargets();
            }
            break;

        default:
            newLogs.push(`Commande inconnue : "${cmd}". Tapez "help" pour la liste des commandes.`);
            break;
        }

        this.setState({cliLogs: newLogs});
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
                        Le terminal analyse l'état de votre projet Scratch et génère un prompt complet
                        contenant les instructions précises pour ChatGPT ou Claude.
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
                            className={classNames(styles.actionBtn, this.state.promptCopied ? styles.successBtn : styles.primaryBtn)}
                            onClick={this.handleCopyPrompt}
                        >
                            {this.state.promptCopied ? '✓ Prompt copié dans le presse-papier !' : '📋 Copier le prompt pour l\'IA'}
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
                        Collez le code JSON ou les commandes reçues de l'IA, puis cliquez sur Exécuter.
                    </p>
                    <textarea
                        className={classNames(styles.textarea, styles.textareaCode)}
                        rows={6}
                        value={this.state.aiCodeInput}
                        onChange={e => this.setState({aiCodeInput: e.target.value})}
                        placeholder="Collez ici la réponse de l'IA (format JSON avec les actions)..."
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

    renderCliTab () {
        return (
            <div className={styles.cliContainer}>
                <div className={styles.cliToolbar}>
                    <span className={classNames(styles.cliDot, styles.cliDotRed)} />
                    <span className={classNames(styles.cliDot, styles.cliDotYellow)} />
                    <span className={classNames(styles.cliDot, styles.cliDotGreen)} />
                    <span className={styles.cliToolbarTitle}>{'scratch-cli — bash'}</span>
                </div>
                <div className={styles.cliOutput}>
                    {this.state.cliLogs.join('\n')}
                </div>
                <div className={styles.cliInputRow}>
                    <span className={styles.cliPromptSymbol}>&gt;</span>
                    <input
                        className={styles.cliInput}
                        type="text"
                        value={this.state.cliInput}
                        onChange={e => this.setState({cliInput: e.target.value})}
                        onKeyDown={this.handleCliKeyDown}
                        placeholder="Tapez une commande (ex: help, status, read Sprite1, create-sprite Paddle1, pong)..."
                        autoFocus
                    />
                </div>
            </div>
        );
    }

    renderInspectorTab () {
        return (
            <div className={styles.section}>
                <div className={styles.sectionHeader}>
                    <div className={styles.sectionTitle}>
                        <span>Inspecteur des Sprites du Projet ({this.state.targets.length})</span>
                    </div>
                    <button
                        className={classNames(styles.actionBtn, styles.secondaryBtn)}
                        onClick={this.refreshTargets}
                    >
                        🔄 Rafraîchir
                    </button>
                </div>
                {this.state.targets.length === 0 ? (
                    <div className={styles.emptyState}>
                        <span className={styles.emptyStateIcon}>{'📭'}</span>
                        <span>{'Aucun sprite pour le moment. Créez-en un ou chargez un projet.'}</span>
                    </div>
                ) : (
                    <div className={styles.spriteList}>
                        {this.state.targets.map(t => (
                            <div key={t.id} className={styles.spriteCard}>
                                <div className={styles.spriteCardHeader}>
                                    <span>{t.isStage ? '🎭 Scène' : `🐱 ${t.name}`}</span>
                                    <span className={styles.badge}>{t.scripts.length} script(s) · {t.blocksCount} blocs</span>
                                </div>
                                {!t.isStage && (
                                    <div className={styles.spriteMeta}>
                                        <span className={styles.metaChip}>{`x: ${t.x}`}</span>
                                        <span className={styles.metaChip}>{`y: ${t.y}`}</span>
                                        <span className={styles.metaChip}>{`Taille: ${t.size}%`}</span>
                                        <span className={styles.metaChip}>{`Direction: ${t.direction}°`}</span>
                                    </div>
                                )}
                                {t.variables.length > 0 && (
                                    <div className={styles.spriteMeta}>
                                        {t.variables.map(v => (
                                            <span key={v.name} className={styles.metaChip}>{`${v.name} = ${v.value}`}</span>
                                        ))}
                                    </div>
                                )}
                                {t.scripts.length > 0 ? (
                                    t.scripts.map((s, idx) => (
                                        <div key={idx} className={styles.scriptPreview}>
                                            {`// Script ${idx + 1} à (x: ${s.x}, y: ${s.y})\n${s.text}`}
                                        </div>
                                    ))
                                ) : (
                                    <div className={styles.scriptEmpty}>{'Aucun script sur ce sprite.'}</div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
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
                            {'Générez un prompt, exécutez la réponse de l\'IA et inspectez vos sprites.'}
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
                                [styles.tabActive]: this.state.activeTab === 'cli'
                            })}
                            onClick={() => this.setState({activeTab: 'cli'})}
                        >
                            {'💻 Console CLI'}
                        </button>
                        <button
                            className={classNames(styles.tabButton, {
                                [styles.tabActive]: this.state.activeTab === 'inspector'
                            })}
                            onClick={() => {
                                this.setState({activeTab: 'inspector'});
                                this.refreshTargets();
                            }}
                        >
                            {'🔍 Inspecteur'}
                        </button>
                    </div>

                    {/* Tab Content */}
                    {this.state.activeTab === 'assistant' && this.renderAssistantTab()}
                    {this.state.activeTab === 'cli' && this.renderCliTab()}
                    {this.state.activeTab === 'inspector' && this.renderInspectorTab()}
                </div>
            </ModalComponent>
        );
    }
}

AIAgentModalComponent.propTypes = {
    onClose: PropTypes.func.isRequired,
    vm: PropTypes.shape({
        runtime: PropTypes.shape({
            targets: PropTypes.array
        })
    })
};

export default AIAgentModalComponent;
