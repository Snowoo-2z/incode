/**
 * @fileoverview Safe previews for Scratch variable / list values.
 *
 * A list can contain hundreds of thousands of items. Sending all of them to the
 * AI is both useless and dangerous (it eats the context window and can make the
 * prompt construction freeze). These helpers always emit a compact preview:
 * the first few items, how many there are, and a note when more were omitted.
 */

const MAX_LIST_ITEMS = 30;
const MAX_SCALAR_CHARS = 60;
const MAX_TEXT_CHARS = 320;

/**
 * Shortens one scalar for display.
 * @param {*} value scalar (string, number, boolean, null)
 * @returns {string} display string
 */
const formatScalarPreview = value => {
    if (typeof value === 'string') {
        if (value.length <= MAX_SCALAR_CHARS) return `"${value}"`;
        return `"${value.slice(0, MAX_SCALAR_CHARS)}…" (${value.length} caractères)`;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
        return String(value);
    }
    try {
        const json = JSON.stringify(value);
        if (json.length <= MAX_SCALAR_CHARS) return json;
        return `${json.slice(0, MAX_SCALAR_CHARS)}…`;
    } catch (e) {
        return '[non sérialisable]';
    }
};

/**
 * Formats a variable value. Arrays (Scratch lists) are always shown as a
 * preview; object values are also truncated.
 * @param {*} value variable value
 * @param {object} [options]
 * @param {number} [options.maxItems] maximum items shown in a list
 * @param {number} [options.maxChars] maximum chars for a single text value
 * @returns {string} compact preview
 */
/**
 * Formats one item of a Scratch list. Strings stay readable (no quotes) for
 * small lists, matching the previous "human readable" behaviour; huge lists are
 * still only previewed.
 * @param {*} value list item
 * @returns {string} display string
 */
const formatListItem = value => {
    if (typeof value === 'string') {
        if (value.length <= MAX_SCALAR_CHARS) return value;
        return `${value.slice(0, MAX_SCALAR_CHARS)}…`;
    }
    return formatScalarPreview(value);
};

const formatValuePreview = (value, options = {}) => {
    const maxItems = Number.isFinite(options.maxItems) ? options.maxItems : MAX_LIST_ITEMS;
    const maxChars = Number.isFinite(options.maxChars) ? options.maxChars : MAX_TEXT_CHARS;

    if (Array.isArray(value)) {
        const total = value.length;
        const shown = value.slice(0, maxItems).map(formatListItem);
        let preview = `[${shown.join(', ')}]`;
        if (total > maxItems) preview += `, … (+${total - maxItems} autres) — ${total} éléments`;
        return preview;
    }

    if (value && typeof value === 'object') {
        let json;
        try {
            json = JSON.stringify(value);
        } catch (e) {
            return '[objet non sérialisable]';
        }
        if (json.length <= maxChars) return json;
        return `${json.slice(0, maxChars)}… (${json.length} caractères)`;
    }

    const text = String(value ?? '');
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}… (${text.length} caractères)`;
};

/**
 * Creates a warning line for an overly long value.
 * @param {*} value value
 * @returns {string} help text
 */
const oversizedValueNote = value => {
    if (!Array.isArray(value) || value.length <= MAX_LIST_ITEMS) return '';
    return ` (liste trop grande pour être affichée entièrement : ${value.length} éléments)`;
};

export {
    formatScalarPreview,
    formatValuePreview,
    oversizedValueNote,
    MAX_LIST_ITEMS,
    MAX_SCALAR_CHARS,
    MAX_TEXT_CHARS
};

export default formatValuePreview;
