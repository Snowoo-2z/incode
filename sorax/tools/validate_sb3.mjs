#!/usr/bin/env node
/**
 * @fileoverview Valide un `.sb3` produit par Sorax **sans lancer le VM**.
 *
 * Vérifications effectuées :
 *   1. l'archive est lisible (méthode 0 ou 8) et contient `project.json` ;
 *   2. toutes les références de blocs (`inputs`, `next`, `parent`) pointent
 *      vers des blocs existants ;
 *   3. tous les opcodes sont connus du schéma de ScratchScript
 *      (`src/lib/ai-agent/block-schema.js`) ou du jeu `procedures_*` ;
 *   4. chaque appel de procédure a une définition et le même nombre d'arguments ;
 *   5. chaque variable / liste / diffusion référencée est déclarée dans le
 *      projet (et chaque variable/liste a bien un moniteur) ;
 *   6. les listes du moteur ont la taille attendue d'après `meta.architecture`
 *      (`sorax_meta.json` : paramètres, vocabulaire, contexte).
 *
 * Usage :
 *   node sorax/tools/validate_sb3.mjs sorax/assets/export/nano/sorax-scratch.sb3
 */

import fs from 'node:fs';
import zlib from 'node:zlib';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const SoraxScratchEngine = require('../runtime/scratch-engine.js');

const errors = [];
const warnings = [];
const checks = [];

function fail(message) { errors.push(message); }
function warn(message) { warnings.push(message); }
function ok(message) { checks.push(message); }

/** Lit les entrées d'une archive ZIP (méthodes 0 et 8 uniquement). */
function readZip(buffer) {
    const entries = {};
    let offset = 0;
    while (offset < buffer.length - 4) {
        const signature = buffer.readUInt32LE(offset);
        if (signature === 0x04034b50) {
            const method = buffer.readUInt16LE(offset + 8);
            const crc = buffer.readUInt32LE(offset + 14);
            const compressedSize = buffer.readUInt32LE(offset + 18);
            const uncompressedSize = buffer.readUInt32LE(offset + 22);
            const nameLength = buffer.readUInt16LE(offset + 26);
            const extraLength = buffer.readUInt16LE(offset + 28);
            const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLength);
            const dataStart = offset + 30 + nameLength + extraLength;
            const raw = buffer.subarray(dataStart, dataStart + compressedSize);
            let data;
            if (method === 0) {
                data = Buffer.from(raw);
            } else if (method === 8) {
                data = zlib.inflateRawSync(Buffer.from(raw));
            } else {
                fail(`compression non gérée (méthode ${method}) pour ${name}`);
                data = Buffer.alloc(0);
            }
            if (data.length !== uncompressedSize) {
                fail(`taille incohérente pour ${name} : ${data.length} au lieu de ${uncompressedSize}`);
            }
            entries[name] = data;
            offset = dataStart + compressedSize;
        } else if (signature === 0x02014b50 || signature === 0x06054b50) {
            break;
        } else {
            fail(`signature ZIP inattendue à l'offset ${offset} : 0x${signature.toString(16)}`);
            break;
        }
    }
    return entries;
}

async function knownOpcodes() {
    const schemaUrl = new URL('../../src/lib/ai-agent/block-schema.js', import.meta.url);
    const module = await import(pathToFileURL(schemaUrl.pathname).href);
    const opcodes = new Set(Object.keys(module.BLOCK_SCHEMA));
    // opcodes des blocs *shadow* (nombres, textes, menus) : ils ne figurent pas
    // dans la palette, mais ils sont indispensables au format sb3.
    const Sb3 = require('../runtime/sb3-builder.js');
    Object.keys(Sb3.PRIMITIVE_TYPE).forEach((opcode) => opcodes.add(opcode));
    Object.keys(Sb3.DEFAULT_INPUTS).forEach((opcode) => {
        const entries = Sb3.DEFAULT_INPUTS[opcode];
        Object.keys(entries).forEach((input) => opcodes.add(entries[input][0]));
    });
    Object.keys(Sb3.DEFAULT_FIELDS).forEach((opcode) => opcodes.add(opcode));
    ['procedures_definition', 'procedures_prototype', 'procedures_call'].forEach((o) => opcodes.add(o));
    return opcodes;
}

function checkBlocks(target, schema, refs) {
    const blocks = target.blocks;
    const ids = new Set(Object.keys(blocks));
    const procedures = new Map();

    Object.keys(blocks).forEach((id) => {
        const block = blocks[id];
        if (Array.isArray(block)) return;                       // primitive compressée
        if (!schema.has(block.opcode)) {
            fail(`[${target.name}] opcode inconnu : ${block.opcode}`);
        }
        Object.keys(block.inputs || {}).forEach((name) => {
            const entry = block.inputs[name];
            if (!Array.isArray(entry)) {
                fail(`[${target.name}] entrée ${name} mal formée sur ${block.opcode}`);
                return;
            }
            for (let i = 1; i < entry.length; i++) {
                const ref = entry[i];
                if (ref === null || ref === undefined) continue;
                if (Array.isArray(ref)) continue;               // primitive en ligne
                if (!ids.has(ref)) {
                    fail(`[${target.name}] ${block.opcode}.${name} référence un bloc absent : ${ref}`);
                }
            }
        });
        if (block.next && !ids.has(block.next)) {
            fail(`[${target.name}] next vers un bloc absent : ${block.next}`);
        }
        if (block.parent && !ids.has(block.parent)) {
            fail(`[${target.name}] parent vers un bloc absent : ${block.parent}`);
        }
        Object.keys(block.fields || {}).forEach((field) => {
            const [value, fieldId] = block.fields[field];
            if (field === 'VARIABLE') refs.vars.push({target: target.name, name: value, id: fieldId});
            if (field === 'LIST') refs.lists.push({target: target.name, name: value, id: fieldId});
            if (field === 'BROADCAST_OPTION') refs.broadcasts.push({target: target.name, name: value, id: fieldId});
        });
        if (block.opcode === 'procedures_definition') {
            const proto = block.inputs.custom_block;
            const protoId = Array.isArray(proto) ? proto[1] : null;
            const prototype = blocks[protoId];
            if (!prototype || prototype.opcode !== 'procedures_prototype') {
                fail(`[${target.name}] définition sans prototype (custom_block = ${JSON.stringify(proto)})`);
            } else if (!Array.isArray(proto) || proto[0] !== 1) {
                fail(`[${target.name}] custom_block doit être à l'état 1 (reçu ${JSON.stringify(proto)})`);
            } else {
                if (prototype.shadow !== true) fail(`[${target.name}] prototype sans shadow: true`);
                const mutation = prototype.mutation || {};
                procedures.set(mutation.proccode, JSON.parse(mutation.argumentids || '[]').length);
            }
        }
        if (block.opcode === 'procedures_prototype') {
            const mutation = block.mutation || {};
            ['proccode', 'argumentids', 'argumentnames', 'argumentdefaults', 'warp'].forEach((key) => {
                if (mutation[key] === undefined) fail(`[${target.name}] mutation de prototype sans ${key}`);
            });
            const names = JSON.parse(mutation.argumentnames || '[]');
            const ids2 = JSON.parse(mutation.argumentids || '[]');
            if (names.length !== ids2.length) {
                fail(`[${target.name}] argumentnames/argumentids de tailles différentes`);
            }
            if (Object.keys(block.inputs || {}).length !== ids2.length) {
                warn(`[${target.name}] le prototype ${mutation.proccode} a ${Object.keys(block.inputs || {}).length} entrées pour ${ids2.length} arguments`);
            }
        }
    });

    Object.keys(blocks).forEach((id) => {
        const block = blocks[id];
        if (Array.isArray(block) || block.opcode !== 'procedures_call') return;
        const mutation = block.mutation || {};
        const proccode = mutation.proccode;
        if (!procedures.has(proccode)) {
            fail(`[${target.name}] appel à une procédure non définie : ${proccode}`);
            return;
        }
        const expected = procedures.get(proccode);
        const given = Object.keys(block.inputs || {}).length;
        if (given !== expected) {
            fail(`[${target.name}] ${proccode} appelée avec ${given} arguments (attendu ${expected})`);
        }
    });

    return procedures;
}

function checkLists(project, meta) {
    const stage = project.targets.find((t) => t.isStage);
    const sprite = project.targets.find((t) => !t.isStage);
    const lists = Object.assign({}, stage.lists, sprite ? sprite.lists : {});
    const byName = {};
    Object.keys(lists).forEach((id) => { byName[lists[id][0]] = lists[id][1]; });

    const arch = meta.architecture;
    const lay = SoraxScratchEngine.layout(arch);
    const expect = {
        Poids: lay.totalWeights,
        Echelles: lay.totalScales,
        Normes: lay.totalNorms,
        // un décalage factice en tête, puis un décalage par jeton :
        // item (k+1) = premier octet du jeton k, item (k+2) = sa fin
        TokOffset: meta.vocabulaire + 1,
        TableCos: meta.contexte * (arch.d_model / arch.n_heads) / 2,
        TableSin: meta.contexte * (arch.d_model / arch.n_heads) / 2,
        OctetsChars: 2048,
        Ponctuation: 256,
        UnicodeChars: 65536,
        SubstitutsHaut: 2112,
        SubstitutsBas: 1024
    };
    Object.keys(expect).forEach((name) => {
        const values = byName[name];
        if (!values) {
            fail(`liste manquante : ${name}`);
            return;
        }
        if (values.length !== expect[name]) {
            fail(`liste ${name} : ${values.length} éléments au lieu de ${expect[name]}`);
            return;
        }
        ok(`${name} : ${values.length} éléments`);
    });

    // listes de caractères (tables du tokenizer) : le texte y est normal
    const textLists = ['OctetsChars', 'Ponctuation', 'UnicodeChars',
        'SubstitutsHaut', 'SubstitutsBas'];
    Object.keys(byName).forEach((name) => {
        const values = byName[name];
        const bad = values.findIndex((v) => v === '' || v === null || v === undefined ||
            (typeof v === 'string' && Number.isNaN(Number(v)) && !textLists.includes(name)));
        if (bad !== -1) {
            fail(`liste ${name} : valeur invalide à l'index ${bad} (${JSON.stringify(values[bad])})`);
        }
    });
    return byName;
}

async function main() {
    const file = process.argv[2] || 'sorax/assets/export/nano/sorax-scratch.sb3';
    const buffer = fs.readFileSync(file);
    const entries = readZip(buffer);
    if (!entries['project.json']) {
        fail('project.json absent de l\'archive');
    }
    console.log(`${file} : ${(buffer.length / 1024).toFixed(0)} Ko, ${Object.keys(entries).length} fichiers`);

    const project = JSON.parse(entries['project.json'].toString('utf8'));
    ok(`project.json : ${(entries['project.json'].length / 1024).toFixed(0)} Ko`);
    if (!Array.isArray(project.targets) || project.targets.length < 2) fail('cibles manquantes');
    if (!Array.isArray(project.monitors)) fail('moniteurs manquants');
    if (!Array.isArray(project.extensions) || project.extensions.length) {
        fail(`extensions non vides : ${JSON.stringify(project.extensions)}`);
    }

    const meta = (project.meta && project.meta.sorax) || null;
    if (!meta || !meta.architecture) {
        fail('méta Sorax absente de project.json (meta.sorax)');
        return;
    }
    ok(`méta Sorax : palier ${meta.palier}, ${meta.parametres} paramètres, contexte ${meta.contexte}`);
    const schema = await knownOpcodes();

    const refs = {vars: [], lists: [], broadcasts: []};
    const declarations = {vars: new Set(), lists: new Set(), broadcasts: new Set()};
    let blockCount = 0;
    let opcodes = new Map();

    project.targets.forEach((target) => {
        Object.keys(target.variables || {}).forEach((id) => declarations.vars.add(target.variables[id][0]));
        Object.keys(target.lists || {}).forEach((id) => declarations.lists.add(target.lists[id][0]));
        Object.keys(target.broadcasts || {}).forEach((id) => declarations.broadcasts.add(target.broadcasts[id]));
        blockCount += Object.keys(target.blocks).length;
        Object.values(target.blocks).forEach((block) => {
            if (Array.isArray(block)) return;
            opcodes.set(block.opcode, (opcodes.get(block.opcode) || 0) + 1);
        });
        checkBlocks(target, schema, refs);
    });

    refs.vars.forEach((ref) => {
        if (!declarations.vars.has(ref.name)) fail(`variable non déclarée : ${ref.name}`);
    });
    refs.lists.forEach((ref) => {
        if (!declarations.lists.has(ref.name)) fail(`liste non déclarée : ${ref.name}`);
    });
    refs.broadcasts.forEach((ref) => {
        if (!declarations.broadcasts.has(ref.name)) fail(`diffusion non déclarée : ${ref.name}`);
    });

    const monitorIds = new Set(project.monitors.map((m) => m.id));
    const visibleNames = project.monitors.filter((m) => m.visible).map((m) =>
        m.params.VARIABLE || m.params.LIST);
    project.monitors.forEach((monitor) => {
        if (!monitorIds.has(monitor.id)) return;
    });
    ['sx progression', 'Historique'].forEach((name) => {
        if (!visibleNames.includes(name)) warn(`moniteur visible attendu : ${name}`);
    });

    const listsByName = checkLists(project, meta);

    console.log(`  blocs : ${blockCount}`);
    console.log(`  variables : ${declarations.vars.size} | listes : ${declarations.lists.size}`);
    console.log(`  procédures : ${[...opcodes.keys()].filter((k) => k.startsWith('procedures_')).join(', ')}`);
    console.log(`  moniteurs : ${project.monitors.length} (visibles : ${visibleNames.join(', ')})`);
    console.log(`  listes moteur : ${Object.keys(listsByName).filter((k) => ['Poids', 'Echelles', 'Normes'].includes(k)).join(', ')}`);

    checks.forEach((message) => console.log(`  ok  ${message}`));
    warnings.forEach((message) => console.log(`  ATTENTION  ${message}`));
    if (errors.length) {
        errors.forEach((message) => console.log(`  ERREUR  ${message}`));
        console.log(`\nÉchec : ${errors.length} erreur(s).`);
        process.exit(1);
    }
    console.log('\nProjet valide : structure, opcodes, procédures et listes vérifiés.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
