import {
    normalizeText,
    sanitizeFileName,
    buildDraftFromProject
} from '../../../src/lib/project-documentation';

describe('project documentation helpers', () => {
    test('normalizeText removes carriage returns and trims', () => {
        expect(normalizeText('\r\nhello\r\n')).toBe('hello');
        expect(normalizeText('   ')).toBe('');
    });

    test('sanitizeFileName removes dangerous characters and keeps a fallback', () => {
        expect(sanitizeFileName('Mon jeu 2026!')).toBe('Mon_jeu_2026_');
        expect(sanitizeFileName('')).toBe('projet');
        expect(sanitizeFileName('..')).toBe('projet');
    });

    test('buildDraftFromProject creates a rich skeleton even for an empty project', () => {
        const draft = buildDraftFromProject(null, 'Mon projet');
        expect(draft).toContain('# Documentation du projet "Mon projet"');
        expect(draft).toContain('## Vue d\'ensemble');
        expect(draft).toContain('## Rôles et dépendances');
        expect(draft).toContain('## Costumes / textes SVG importants');
    });
});
