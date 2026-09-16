#!/usr/bin/env node
/**
 * @fileoverview Extrait la grammaire réelle des blocs Scratch depuis l'IDE.
 *
 * Source de vérité : `src/lib/ai-agent/block-schema.js` (schéma des opcodes, des
 * entrées/shadow et des champs) + `src/lib/ai-agent/dsl-parser.js` (alias du DSL
 * ScratchScript, ordre des paramètres positionnels, blocs-chapeaux).
 *
 * Le résultat (`sorax/assets/grammar.json`) est utilisé par :
 *  - le générateur de corpus Python (pour n'écrire QUE du ScratchScript valide) ;
 *  - la documentation embarquée dans le prompt de Sorax ;
 *  - les tests de validation du corpus (`tools/validate_corpus.mjs`).
 *
 * Usage :  node sorax/tools/dump_grammar.mjs [--out sorax/assets/grammar.json]
 */

import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const OUT = path.resolve(
    ROOT,
    outFlag === -1 ? 'sorax/assets/grammar.json' : args[outFlag + 1]
);

const schemaMod = await import(path.join(ROOT, 'src/lib/ai-agent/block-schema.js'));
const dslMod = await import(path.join(ROOT, 'src/lib/ai-agent/dsl-parser.js'));

const {BLOCK_SCHEMA, getDefaultInputs, getDefaultFields} = schemaMod;
const {ALIASES, HAT_OPCODES, getParamOrder} = dslMod;

/**
 * Décrit un paramètre positionnel : son nom, son type, son rôle.
 * @param {object} schema bloc du schéma
 * @param {string} opcode opcode
 * @param {string} name nom du paramètre (input ou field)
 * @returns {object} descripteur
 */
const describeParam = (schema, opcode, name) => {
    const input = (getDefaultInputs(opcode) || {})[name];
    const field = (getDefaultFields(opcode) || {})[name];
    if (input) {
        if (input.branch) return {name, kind: 'branch'};
        if (input.shadow === null) return {name, kind: 'boolean'};
        if (input.shadow === 'text') return {name, kind: 'text'};
        if (input.isMenu) {
            return {
                name,
                kind: 'menu',
                menu: input.shadow,
                default: input.defaultValue
            };
        }
        return {name, kind: 'number', shadow: input.shadow};
    }
    if (field !== undefined) {
        const value = (field && typeof field === 'object') ? field.value : field;
        return {name, kind: 'field', default: value};
    }
    return {name, kind: 'unknown', opcode};
};

const opcodes = {};
for (const opcode of Object.keys(BLOCK_SCHEMA)) {
    const order = getParamOrder(opcode);
    const params = order.map(name => describeParam(BLOCK_SCHEMA[opcode], opcode, name));
    const inputs = getDefaultInputs(opcode) || {};
    const branches = Object.keys(inputs).filter(k => inputs[k] && inputs[k].branch);
    opcodes[opcode] = {
        category: opcode.split('_')[0],
        suffix: opcode.slice(opcode.indexOf('_') + 1),
        hat: HAT_OPCODES.has(opcode),
        params,
        branches
    };
}

// Alias « nom court » du DSL -> opcode, avec l'ordre positionnel résolu : c'est
// exactement ce que le parser attend, donc le corpus ne peut pas se tromper.
const aliases = {};
for (const [alias, opcode] of Object.entries(ALIASES)) {
    aliases[alias] = {
        opcode,
        params: (opcodes[opcode] ? opcodes[opcode].params.map(p => ({
            name: p.name,
            kind: p.kind,
            required: p.kind !== 'branch'
        })) : [])
    };
}

const grammar = {
    generatedAt: new Date().toISOString(),
    source: 'src/lib/ai-agent/{block-schema,dsl-parser}.js',
    opcodeCount: Object.keys(opcodes).length,
    hatOpcodes: [...HAT_OPCODES],
    aliases,
    opcodes
};

fs.mkdirSync(path.dirname(OUT), {recursive: true});
fs.writeFileSync(OUT, JSON.stringify(grammar, null, 1));
const bytes = fs.statSync(OUT).size;
console.log(`✔ grammaire extraite : ${OUT}`);
console.log(`  ${grammar.opcodeCount} opcodes, ${Object.keys(aliases).length} alias`);
console.log(`  ${(bytes / 1024).toFixed(1)} Ko`);
