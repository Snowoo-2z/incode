import React from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';

import ModalComponent from '../modal/modal.jsx';
import ProjectDocumentation from '../../lib/project-documentation.js';
import styles from './documentation-modal.css';

class DocumentationModalComponent extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            text: '',
            source: 'none',
            filename: '',
            aiStage: 1,
            aiResponse: '',
            aiPrompt: '',
            copied: false,
            imported: false,
            status: '',
            dragOver: false
        };

        this.inputRef = null;

        this.handleSave = this.handleSave.bind(this);
        this.handleExport = this.handleExport.bind(this);
        this.handleClear = this.handleClear.bind(this);
        this.handleImportFile = this.handleImportFile.bind(this);
        this.handleDrop = this.handleDrop.bind(this);
        this.handleClickImport = this.handleClickImport.bind(this);
        this.handleCopyAiPrompt = this.handleCopyAiPrompt.bind(this);
        this.handleAppendAiResponse = this.handleAppendAiResponse.bind(this);
        this.handleCreateDraft = this.handleCreateDraft.bind(this);
        this.handleResetAiStage = this.handleResetAiStage.bind(this);
        this.setInputRef = this.setInputRef.bind(this);
        this.handleTextChange = this.handleTextChange.bind(this);
        this.handleAiResponseChange = this.handleAiResponseChange.bind(this);
        this.handlePromptChange = this.handlePromptChange.bind(this);
        this.handleFileChange = this.handleFileChange.bind(this);
    }

    componentDidMount () {
        this.bindDocumentation();
    }

    componentDidUpdate (prevProps) {
        if (prevProps.projectTitle !== this.props.projectTitle) {
            this.bindDocumentation();
        }
    }

    setInputRef (ref) {
        this.inputRef = ref;
    }

    bindDocumentation () {
        ProjectDocumentation.bindToProject(this.props.projectTitle);
        this.refreshFromStore();
    }

    refreshFromStore () {
        this.setState({
            text: ProjectDocumentation.getText(),
            source: ProjectDocumentation.getSource(),
            filename: ProjectDocumentation.getFilename(),
            aiStage: ProjectDocumentation.getAiStage()
        });
    }

    setStatus (message) {
        this.setState({status: message});
    }

    handleSave () {
        const source = this.state.text ? 'manual' : 'none';
        ProjectDocumentation.setText(this.state.text, source);
        this.setState({source});
        this.setStatus('Documentation enregistrée.');
    }

    handleExport () {
        if (!this.state.text) {
            this.setStatus('Aucune documentation à exporter.');
            return;
        }
        ProjectDocumentation.bindToProject(this.props.projectTitle);
        ProjectDocumentation.setText(this.state.text, this.state.source);
        const name = ProjectDocumentation.downloadSidecar();
        this.setStatus(
            `Documentation exportée : ${name || 'fichier .md'}. ` +
            'Elle sera aussi téléchargée avec « Sauvegarder sur votre ordinateur ».'
        );
    }

    handleClear () {
        // eslint-disable-next-line no-alert
        if (!window.confirm('Effacer la documentation de ce projet ?')) return;
        ProjectDocumentation.setText('', 'none');
        ProjectDocumentation.setAiStage(1);
        this.setState({
            text: '',
            source: 'none',
            filename: '',
            aiStage: 1,
            aiResponse: '',
            aiPrompt: '',
            status: 'Documentation supprimée.'
        });
    }

    async handleImportFile (file) {
        if (!file) return;
        try {
            const result = await ProjectDocumentation.importFile(file);
            this.setState({
                text: result.text,
                source: 'imported',
                filename: result.filename,
                imported: true,
                status: `Documentation importée (${result.filename}).`
            });
        } catch (e) {
            this.setStatus(`Import impossible : ${e.message || e}`);
        }
    }

    handleFileChange (e) {
        this.handleImportFile(e.target.files && e.target.files[0]);
        e.target.value = '';
    }

    handleDrop (e) {
        e.preventDefault();
        this.setState({dragOver: false});
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        this.handleImportFile(file);
    }

    handleDragOver (e) {
        e.preventDefault();
        this.setState({dragOver: true});
    }

    handleDragLeave () {
        this.setState({dragOver: false});
    }

    handleClickImport () {
        if (this.inputRef) this.inputRef.click();
    }

    handleTextChange (e) {
        this.setState({text: e.target.value, source: 'manual'});
    }

    handleAiResponseChange (e) {
        this.setState({aiResponse: e.target.value});
    }

    handlePromptChange (e) {
        this.setState({aiPrompt: e.target.value});
    }

    async copyPrompt (text, label) {
        try {
            await navigator.clipboard.writeText(text);
            this.setState({copied: true});
            setTimeout(() => this.setState({copied: false}), 2500);
        } catch (e) {
            this.setState({aiPrompt: text});
            this.setStatus(`${label} (copie manuelle) : la réponse est affichée dans le champ ci-dessous.`);
        }
    }

    async handleCopyAiPrompt () {
        const prompt = ProjectDocumentation.generateAiPrompt(this.props.vm, this.state.aiStage);
        await this.copyPrompt(prompt, 'Prompt « documentation » généré');
        this.setState({aiPrompt: prompt});
    }

    handleAppendAiResponse () {
        if (!this.state.aiResponse.trim()) {
            this.setStatus('Collez d\'abord la réponse de l\'IA.');
            return;
        }
        ProjectDocumentation.appendText(this.state.aiResponse, 'ai');
        const nextStage = Math.min(3, this.state.aiStage + 1);
        ProjectDocumentation.setAiStage(nextStage);
        this.setState({
            text: ProjectDocumentation.getText(),
            source: 'ai',
            aiStage: nextStage,
            aiResponse: '',
            aiPrompt: '',
            status: `Section ajoutée. Prochaine étape recommandée : ${nextStage}/3.`
        });
    }

    handleCreateDraft () {
        if (!this.props.vm) return;
        ProjectDocumentation.bindToProject(this.props.projectTitle);
        const draft = ProjectDocumentation.buildDraft(this.props.vm);
        this.setState({text: draft, source: 'ai'});
        ProjectDocumentation.setText(draft, 'ai');
        this.setStatus('Brouillon généré depuis le projet. Complétez-le ou laissez l\'IA l\'écrire.');
    }

    handleResetAiStage () {
        ProjectDocumentation.setAiStage(1);
        this.setState({aiStage: 1, aiPrompt: ''});
    }

    renderEmptyState () {
        return (
            <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>{'📄'}</div>
                <div className={styles.emptyTitle}>{'Aucune documentation pour ce projet'}</div>
                <div className={styles.emptyDesc}>
                    {'La documentation est un fichier "invisible" donné à l\'IA. ' +
                        'Elle décrit le rôle des sprites, des variables, des messages et des costumes. ' +
                        'Vous pouvez l\'importer, la créer avec l\'IA, ou la laisser vide.'}
                </div>
                <div className={styles.buttonRow}>
                    <button
                        className={classNames(styles.actionBtn, styles.primaryBtn)}
                        onClick={this.handleClickImport}
                    >
                        {'📥 Importer une documentation'}
                    </button>
                    <button
                        className={classNames(styles.actionBtn, styles.secondaryBtn)}
                        onClick={this.handleCopyAiPrompt}
                    >
                        {'🤖 Créer avec l\'IA'}
                    </button>
                </div>
            </div>
        );
    }

    renderAiSection () {
        return (
            <div className={styles.aiSection}>
                <div className={styles.sectionTitle}>{'🤖 Créer / mettre à jour avec l\'IA'}</div>
                <div className={styles.sectionDesc}>
                    {'L\'IA peut lire l\'état du projet (sprites, variables, listes, scripts) et les ' +
                        'costumes SVG qui peuvent contenir du texte utile. Le travail se fait en plusieurs ' +
                        'messages pour ne pas dépasser le contexte : 3 étapes suffisent.'}
                </div>
                <div className={styles.stageRow}>
                    <span className={styles.stageBadge}>{`Étape ${this.state.aiStage}/3`}</span>
                    <button
                        className={classNames(styles.actionBtn, styles.secondaryBtn)}
                        onClick={this.handleResetAiStage}
                    >
                        {'Recommencer l\'étape 1'}
                    </button>
                </div>
                <div className={styles.buttonRow}>
                    <button
                        className={classNames(styles.actionBtn, styles.primaryBtn)}
                        onClick={this.handleCopyAiPrompt}
                    >
                        {this.state.copied ? '✓ Prompt copié !' : '📋 Copier le prompt'}
                    </button>
                    <button
                        className={classNames(styles.actionBtn, styles.secondaryBtn)}
                        onClick={this.handleCreateDraft}
                    >
                        {'🗂 Créer un brouillon du projet'}
                    </button>
                </div>
                {this.state.aiPrompt ? (
                    <textarea
                        className={classNames(styles.textarea, styles.codeArea)}
                        rows={4}
                        placeholder={this.state.aiPrompt &&
                            'Si la copie directe échoue, copiez ce texte manuellement…'}
                        value={this.state.aiPrompt}
                        onChange={this.handlePromptChange}
                    />
                ) : null}
                <textarea
                    className={styles.textarea}
                    rows={4}
                    placeholder="Collez ici la réponse de l'IA (Markdown). Cliquez ensuite sur « Ajouter la section »."
                    value={this.state.aiResponse}
                    onChange={this.handleAiResponseChange}
                />
                <div className={styles.buttonRow}>
                    <button
                        className={classNames(styles.actionBtn, styles.templateBtn)}
                        onClick={this.handleAppendAiResponse}
                    >
                        {'➕ Ajouter la section à la documentation'}
                    </button>
                </div>
            </div>
        );
    }

    renderImportSection () {
        const {dragOver} = this.state;
        return (
            <div className={styles.aiSection}>
                <div className={styles.sectionTitle}>{'📥 Importer'}</div>
                <div className={styles.sectionDesc}>
                    {'Glissez un fichier .md, .txt ou .json, ou un .sb3 contenant une documentation ' +
                        'embarquée (documentation.md / .txt / .json).'}
                </div>
                <div
                    className={classNames(styles.dropZone, {[styles.dropZoneActive]: dragOver})}
                    onDragOver={this.handleDragOver}
                    onDragLeave={this.handleDragLeave}
                    onDrop={this.handleDrop}
                >
                    <div className={styles.dropIcon}>{'⬇️'}</div>
                    <div className={styles.dropText}>{'Glissez le fichier ici'}</div>
                    <button
                        className={classNames(styles.actionBtn, styles.secondaryBtn)}
                        onClick={this.handleClickImport}
                    >
                        {'📂 Choisir un fichier'}
                    </button>
                </div>
                <input
                    ref={this.setInputRef}
                    className={styles.hiddenInput}
                    type="file"
                    accept=".md,.txt,.json,.sb3"
                    onChange={this.handleFileChange}
                />
            </div>
        );
    }

    render () {
        const hasText = Boolean(this.state.text.trim());
        return (
            <ModalComponent
                className={styles.modalContent}
                contentLabel="Documentation du projet"
                onRequestClose={this.props.onClose}
            >
                <div className={styles.body}>
                    <div className={styles.header}>
                        <div className={styles.headerTitle}>{'📄 Documentation du projet'}</div>
                        <div className={styles.headerMeta}>
                            {this.state.filename ? (
                                <span className={styles.filename}>{this.state.filename}</span>
                            ) : (
                                <span className={styles.filename}>{'fichier compagnon, pas encore nommé'}</span>
                            )}
                            <span>{hasText ? '✓ présente' : '✗ absente'}</span>
                        </div>
                    </div>

                    {this.state.status ? (
                        <div className={styles.status}>{this.state.status}</div>
                    ) : null}

                    {!hasText && this.renderEmptyState()}

                    {this.renderImportSection()}

                    {this.renderAiSection()}

                    <div className={styles.editorSection}>
                        <div className={styles.editorHeader}>
                            <div className={styles.sectionTitle}>{'✏️ Edition'}</div>
                            <div className={styles.buttonRow}>
                                <button
                                    className={classNames(styles.actionBtn, styles.primaryBtn)}
                                    onClick={this.handleSave}
                                >
                                    {'💾 Enregistrer'}
                                </button>
                                <button
                                    className={classNames(styles.actionBtn, styles.secondaryBtn)}
                                    onClick={this.handleExport}
                                >
                                    {'⬇️ Exporter .md'}
                                </button>
                                <button
                                    className={classNames(styles.actionBtn, styles.dangerBtn)}
                                    onClick={this.handleClear}
                                >
                                    {'🗑 Effacer'}
                                </button>
                            </div>
                        </div>
                        <textarea
                            className={classNames(styles.textarea, styles.codeArea)}
                            rows={22}
                            placeholder={'Écrivez ou modifiez ici la documentation du projet.\n' +
                                'Exemple :\n# Projet Pong\n## Sprites\n- Balle : rebondit...'}
                            value={this.state.text}
                            onChange={this.handleTextChange}
                        />
                    </div>
                </div>
            </ModalComponent>
        );
    }
}

DocumentationModalComponent.propTypes = {
    onClose: PropTypes.func.isRequired,
    projectTitle: PropTypes.string,
    vm: PropTypes.shape({
        runtime: PropTypes.shape({
            targets: PropTypes.array
        })
    })
};

DocumentationModalComponent.defaultProps = {
    projectTitle: ''
};

export default DocumentationModalComponent;
