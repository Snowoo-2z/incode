import {
    formatScalarPreview,
    formatValuePreview,
    oversizedValueNote
} from '../../../src/lib/ai-agent/value-preview';

describe('AI agent value previews', () => {
    test('scalar string is shown as a compact preview', () => {
        expect(formatScalarPreview('hello')).toBe('"hello"');
        expect(formatScalarPreview('a'.repeat(500))).toContain('500 caract');
    });

    test('a huge list is never dumped into the prompt', () => {
        const big = Array.from({length: 300000}, (_, i) => `item-${i}`);
        const preview = formatValuePreview(big);
        expect(preview).toContain('300000 éléments');
        expect(preview).toContain('(+299970 autres)');
        // Should not contain the 200000th item; it is enough to know it exists.
        expect(preview).not.toContain('item-299999');
    });

    test('small lists are displayed fully', () => {
        expect(formatValuePreview(['a', 'b'])).toBe('[a, b]');
        expect(formatValuePreview([1, 2, 3])).toBe('[1, 2, 3]');
    });

    test('objects and very long text are truncated', () => {
        const obj = {nested: 'value'};
        expect(formatValuePreview(obj)).toContain('nested');
        expect(formatValuePreview('x'.repeat(10000))).toContain('10000 caract');
    });

    test('oversizedValueNote explains a huge list', () => {
        expect(oversizedValueNote(Array.from({length: 100}, (_, i) => i))).toContain('100 éléments');
        expect(oversizedValueNote([1, 2, 3])).toBe('');
    });
});
