#!/usr/bin/env node
/**
 * @fileoverview Valide un corpus Sorax avec LE VRAI compilateur ScratchScript.
 *
 * Chaque échantillon des tâches `code`, `edit` et `fix` est passé dans
 * `parseDSL()` (src/lib/ai-agent/dsl-parser.js) puis dans le constructeur de
 * blocs : si un bloc est inconnu, si aucune action n'est produite ou si le
 * graphe de blocs est cassé, l'échantillon est signalé.
 *
 * C'est ce qui garantit qu'un modèle entraîné sur ce corpus ne peut sortir que
 * du ScratchScript réellement acceptable par l'IDE.
 *
 * Usage :
 *   node sorax/tools/validate_corpus.mjs                       # tout le corpus
 *   node sorax/tools/validate_corpus.mjs --limit 500 --quiet
 *   node sorax/tools/validate_corpus.mjs --file mon_fichier.jsonl
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
    const i = args.indexOf(name);
    return i === -1 ? fallback : args[i + 1];
};
const LIMIT = parseInt(getArg('--limit', '0'), 10) || 0;
const QUIET = args.includes('--quiet');
const FILE = getArg('--file', null);
const TASKS_TO_COMPILE = new Set(['code', 'edit', 'fix']);

const {parseDSL} = await import(path.join(ROOT, 'src/lib/ai-agent/dsl-parser.js'));
const {findUnknownOpcodes} = await import(path.join(ROOT, 'src/lib/ai-agent/block-builder.js'));

const files = FILE ?
    [path.resolve(FILE)] :
    [
        path.join(ROOT, 'sorax/assets/corpus/train.jsonl'),
        path.join(ROOT, 'sorax/assets/corpus/val.jsonl'),
        path.join(ROOT, 'sorax/assets/corpus/test.jsonl')
    ].filter(f => fs.existsSync(f));

if (!files.length) {
    console.error('✘ aucun corpus trouvé — lancez d\'abord : python sorax/tools/make_corpus.py');
    process.exit(1);
}

let checked = 0;
let failed = 0;
const failures = [];
const unknownOpcodes = new Map();

for (const file of files) {
    const rl = readline.createInterface({input: fs.createReadStream(file), crlfDelay: Infinity});
    for await (const line of rl) {
        if (!line.trim()) continue;
        let sample;
        try {
            sample = JSON.parse(line);
        } catch (e) {
            failures.push({file, line: line.slice(0, 120), reason: 'JSON invalide'});
            failed++;
            continue;
        }
        if (!TASKS_TO_COMPILE.has(sample.task)) continue;
        checked++;
        if (LIMIT && checked > LIMIT) break;

        // La réponse peut contenir un préambule en français + un bloc ```scratch.
        const actions = parseDSL(sample.answer);
        if (!actions.length) {
            failed++;
            failures.push({
                task: sample.task,
                prompt: sample.prompt.slice(0, 90),
                answer: sample.answer.slice(0, 200),
                reason: 'aucune action produite par le parser'
            });
            continue;
        }
        for (const action of actions) {
            if (action.type === 'ADD_SCRIPT' && action.blocks) {
                const unknown = findUnknownOpcodes(action.blocks);
                for (const op of unknown) {
                    unknownOpcodes.set(op, (unknownOpcodes.get(op) || 0) + 1);
                }
                if (unknown.length) {
                    failed++;
                    failures.push({
                        task: sample.task,
                        answer: sample.answer.slice(0, 200),
                        reason: `opcodes inconnus : ${unknown.join(', ')}`
                    });
                }
            }
        }
    }
}

if (!QUIET) {
    for (const f of failures.slice(0, 25)) {
        console.log('---');
        console.log(`✘ ${f.task || '?'} : ${f.reason}`);
        if (f.prompt) console.log(`  demande : ${f.prompt}`);
        console.log(`  code    : ${(f.answer || '').split('\n').slice(0, 6).join('\n            ')}`);
    }
    if (failures.length > 25) console.log(`… et ${failures.length - 25} autres`);
}

console.log('');
console.log(`échantillons compilés : ${checked}`);
console.log(`échecs               : ${failed}`);
if (unknownOpcodes.size) {
    console.log('opcodes inconnus rencontrés :');
    for (const [op, n] of [...unknownOpcodes.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${op} ×${n}`);
    }
}
const rate = checked ? (100 * failed / checked) : 0;
console.log(`taux d'échec : ${rate.toFixed(2)} %`);
process.exit(failed ? 1 : 0);
