import JSZip from '@turbowarp/jszip';
import downloadBlob from './download-blob';
import {formatProjectSummary} from './ai-agent/sprite-reader.js';
import {formatProjectOverview} from './ai-agent/agent-protocol.js';

/**
 * Documentation companion for a Scratch / TurboWarp project.
 *
 * It is deliberately a "silent" sidecar: the user sees a Documentation button in
 * the menu bar, but the text itself is not a block or a Scratch comment. It is
 * meant to be given to the AI (together with the project prompt) so that the AI
 * does not have to re-discover the whole project on every conversation.
 *
 * The sidecar is kept in localStorage keyed by the project title so it survives
 * page reloads in the editor, and it is exported next to the .sb3 when the user
 * presses "Sauvegarder sur votre ordinateur".
 */

const DOC_EXTENSION = 'md';
const MAX_IMPORT_BYTES = 10 * 1024 * 1024; // 10 MB, enough for giant projects.
const SIDECAR_EXTENSIONS = ['md', 'txt', 'json', 'sb3'];

const sanitizeFileName = name => {
    const cleaned = String(name || '')
        .trim()
        .replace(/[^a-z0-9._-]/gi, '_')
        .slice(0, 80);
    if (!cleaned || /^[.\s]*$/.test(cleaned)) return 'projet';
    return cleaned;
};

const normalizeText = text =>
    String(text || '')
        .trim()
        .replace(/\r\n/g, '\n');

/**
 * Builds a small markdown draft from the current project. It is only a
 * skeleton (section headings and placeholders) — the AI fills the content.
 * @param {object} vm Scratch VM
 * @param {string} title project title
 * @returns {string} draft
 */
const buildDraftFromProject = (vm, title) => {
    const overview = formatProjectOverview(vm);
    const summary = formatProjectSummary(vm);
    return `# Documentation du projet "${title || 'sans titre'}"

> Fichier compagnon "invisible" pour l'IA. Il n'appartient pas au projet Scratch, il décrit ce que fait le projet.

## Vue d'ensemble

${overview}

## Détail des sprites, variables et messages

${summary}

## Rôles et dépendances

- (à remplir par l'IA)

## Costumes / textes SVG importants

- (l'IA peut lire les costumes avec /costume et y chercher du texte)

## Notes de développement

- (libre)
`;
};

class ProjectDocumentation {
    constructor () {
        this._text = '';
        this._source = 'none'; // none | imported | ai | manual
        this._filename = '';
        this._title = '';
        this._updatedAt = null;
        this._aiStage = 1;
        this._loaded = false;
    }

    _storageKey (title = this._title) {
        return `scratch-gui.documentation.${encodeURIComponent(String(title || 'sans-titre'))}`;
    }

    bindToProject (title) {
        const nextTitle = String(title || 'sans-titre').trim();
        if (this._loaded && nextTitle === this._title) return;
        this._title = nextTitle;
        this._load();
    }

    _load () {
        this._loaded = true;
        this._text = '';
        this._source = 'none';
        this._filename = '';
        this._aiStage = 1;
        try {
            const raw = typeof localStorage === 'undefined' ?
                null : localStorage.getItem(this._storageKey());
            const parsed = raw ? JSON.parse(raw) : null;
            if (parsed && typeof parsed.text === 'string') {
                this._text = parsed.text;
                this._source = parsed.source || 'manual';
                this._filename = parsed.filename || '';
                this._aiStage = Number.isFinite(parsed.aiStage) ? parsed.aiStage : 1;
                this._updatedAt = parsed.updatedAt || null;
            }
        } catch (e) {
            // Corrupted entry: start empty.
            this._text = '';
        }
    }

    _save () {
        if (typeof localStorage === 'undefined') return;
        try {
            localStorage.setItem(this._storageKey(), JSON.stringify({
                text: this._text,
                source: this._source,
                filename: this._filename,
                aiStage: this._aiStage,
                updatedAt: new Date().toISOString()
            }));
        } catch (e) {
            // Storage may be full; the doc stays in memory for this session.
        }
    }

    has () {
        return Boolean(this._text);
    }

    getText () {
        return this._text;
    }

    getSource () {
        return this._source;
    }

    getFilename () {
        return this._filename;
    }

    getAiStage () {
        return this._aiStage;
    }

    setAiStage (stage) {
        this._aiStage = Math.max(1, Math.min(3, Number(stage) || 1));
        this._save();
    }

    setText (text, source = 'manual') {
        this._text = normalizeText(text);
        this._source = source;
        this._aiStage = this._text ? this._aiStage : 1;
        this._save();
    }

    appendText (text, source = 'ai') {
        const chunk = normalizeText(text);
        if (!chunk) return this._text;
        this._text = this._text ?
            `${this._text}\n\n---\n\n${chunk}` :
            chunk;
        this._source = source;
        this._save();
        return this._text;
    }

    buildDraft (vm) {
        return buildDraftFromProject(vm, this._title);
    }

    downloadSidecar () {
        if (!this._text) return;
        const title = this._title || 'projet';
        const base = sanitizeFileName(title);
        const filename = `${base}.documentation.${DOC_EXTENSION}`;
        const body = this._text.startsWith('# ') ?
            this._text :
            `# Documentation du projet "${title}"\n\n${this._text}`;
        downloadBlob(filename, new Blob([body], {type: 'text/markdown;charset=utf-8'}));
        return filename;
    }

    /**
     * Imports documentation from a File. Supports:
     *  - .md / .txt            plain text
     *  - .json                 `{"documentation": "..."}` / `{"text": "..."}` / `{"description": "..."}`
     *  - .sb3                  a ZIP; looks for documentation.md / documentation.txt / documentation.json inside.
     * @param {File|Blob} file the file to import
     * @returns {Promise<{text: string, filename: string}>} imported text and sidecar filename
     */
    async importFile (file) {
        if (!file || !file.size) throw new Error('Fichier vide');
        if (file.size > MAX_IMPORT_BYTES) throw new Error('Fichier trop volumineux');
        const name = String(file.name || 'documentation');
        const lower = name.toLowerCase();

        if (lower.endsWith('.sb3')) {
            const text = await this._extractFromSb3(file);
            return {text, filename: this._filename || `${name}.documentation.md`};
        }

        let text = await file.text();
        if (lower.endsWith('.json')) {
            try {
                const json = JSON.parse(text);
                text = json.documentation || json.text || json.description || JSON.stringify(json, null, 2);
            } catch (e) {
                // Not JSON? keep as plain text.
            }
        }
        const sourceName = sanitizeFileName(name.replace(/\.[^.]+$/, '') || 'projet');
        this._text = normalizeText(text);
        this._source = 'imported';
        this._filename = `${sourceName}.documentation.${DOC_EXTENSION}`;
        this._aiStage = 1;
        this._save();
        return {text: this._text, filename: this._filename};
    }

    /**
     * Extracts an embedded documentation entry from a .sb3 archive.
     * @param {File} file the .sb3 file
     * @returns {Promise<string>} documentation text
     */
    async _extractFromSb3 (file) {
        const zip = await JSZip.loadAsync(file);
        const candidates = [
            'documentation.md',
            'documentation.txt',
            'documentation.json',
            '.documentation.md',
            'project.documentation.md',
            '.project.documentation.md'
        ];
        let chosen = null;
        for (const candidate of candidates) {
            const entry = zip.file(candidate);
            if (entry) {
                chosen = entry;
                break;
            }
        }
        let content;
        if (chosen) {
            content = await chosen.async('string');
        } else {
            // Fallback: search the archive (read-only metadata).
            const names = Object.keys(zip.files || {});
            const match = names.find(n => /documentation\.(md|txt|json)$/i.test(n));
            if (match) content = await zip.file(match).async('string');
        }
        if (!content) throw new Error('Aucune documentation trouvée dans ce .sb3');
        this._text = normalizeText(content);
        this._source = 'imported';
        this._filename = 'documentation.md';
        this._aiStage = 1;
        this._save();
        return this._text;
    }

    setFilename (filename) {
        this._filename = filename;
        this._save();
    }

    /**
     * Generates the prompt used to create or update the documentation with an
     * external LLM. Because the project can be huge, the prompt is split into
     * stages: the user only pastes the whole project once, then the AI writes a
     * few sections per stage.
     * @param {object} vm Scratch VM
     * @param {number} stage 1..3
     * @returns {string} prompt to copy
     */
    generateAiPrompt (vm, stage = this._aiStage || 1) {
        const title = this._title || 'projet sans titre';
        const overview = formatProjectOverview(vm);
        const existing = this._text ?
            `\n\n---\n\nDOCUMENTATION ACTUELLE (tu vas la compléter / l'améliorer) :\n${this._text}` :
            '';
        const instructions = this._getStageInstructions(stage);

        return [
            'Tu es un expert en analyse de projets Scratch 3.0 / TurboWarp.',
            'Tu rédiges la documentation technique d\'un projet pour que l\'IA',
            'et son développeur puissent le comprendre rapidement.',
            '',
            `PROJET : "${title}"`,
            overview,
            '',
            'CONTEXTE LÉGER — le code exact reste disponible si besoin :',
            '- Pour lire un sprite : écris la ligne  /read <nom du sprite>  (ex. /read Balle)',
            '- Pour lire les variables et listes :  /vars',
            '- Pour chercher un mot dans le projet :  /search <mot>',
            '- Pour lire le code SVG d\'un costume (il peut contenir du TEXTE utile) :',
            '  /costume <sprite> [<nom du costume>]',
            existing,
            '',
            'OBJECTIF :',
            instructions,
            '',
            'RÈGLES :',
            '- Tu peux parler et expliquer ce que tu fais, en français, avec des titres Markdown.',
            '- Documente quel sprite sert à quoi, quels messages/broadcasts existent',
            '  et à quoi ils servent, et quels sprites dépendent de quelles variables.',
            '- Utilise les outils ci-dessus uniquement si le contexte léger ne suffit pas',
            '  (ne recopie jamais un sprite entier si tu peux le résumer).',
            '- Réponds UNIQUEMENT avec le contenu de documentation (Markdown),',
            '  sans code Scratch et sans JSON d\'actions.',
            '- Si le projet est gros, va à l\'essentiel : chaque section doit tenir',
            '  dans quelques paragraphes.'
        ].join('\n');
    }

    _getStageInstructions (stage) {
        const sections = [
            [
                'Section 1 : Vue d\'ensemble du projet (genre, objectif, gameplay/but).',
                'Section 2 : Chaque sprite et la scène : son rôle, ses costumes utiles',
                'et les scripts dont il est responsable.'
            ].join('\n'),
            [
                'Section 3 : Variables et listes globales/locales : ce qu\'elles stockent,',
                'qui les lit et qui les modifie.',
                'Section 4 : Messages / diffusions (broadcasts) : qui envoie, qui reçoit,',
                'à quoi cela sert.',
                'Section 5 : Dépendances entre sprites, variables, costumes et messages.'
            ].join('\n'),
            [
                'Section 6 : Rôle des costumes / SVG : les textes ou formes qui portent',
                'de l\'information.',
                'Section 7 : Notes de développement, sections fragiles, pièges, TODO de l\'auteur.'
            ].join('\n')
        ];
        return sections[Math.max(1, Math.min(3, Number(stage) || 1)) - 1];
    }

    continueGeneration (stage) {
        return stage > 1 || false;
    }
}

const ProjectDocumentationSingleton = new ProjectDocumentation();
if (typeof window !== 'undefined') {
    window.ProjectDocumentation = ProjectDocumentationSingleton;
}

export {
    ProjectDocumentation,
    ProjectDocumentationSingleton,
    buildDraftFromProject,
    normalizeText,
    sanitizeFileName,
    SIDECAR_EXTENSIONS
};

export default ProjectDocumentationSingleton;
