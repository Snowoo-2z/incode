#!/usr/bin/env node
/**
 * @fileoverview Fabrique `sorax-scratch.sb3` : le modèle Sorax **en blocs
 * Scratch purs**, prêt à ouvrir dans Scratch ou TurboWarp.
 *
 * Usage :
 *   node sorax/tools/build_sb3.mjs \
 *     --bin sorax/assets/export/nano/sorax_core.bin \
 *     --out sorax/assets/export/nano/sorax-scratch.sb3 \
 *     --context 128 --max-new 48 [--store]
 *
 * Aucune dépendance : le `.bin` est lu par le runtime JS de Sorax, les blocs
 * sont produits par `runtime/scratch-engine.js` et l'archive par
 * `runtime/sb3-builder.js`. Le script fonctionne donc aussi bien en local qu'en
 * Node dans un environnement vierge.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const SoraxRuntime = require('../runtime/sorax-runtime.js');
const SoraxScratchEngine = require('../runtime/scratch-engine.js');
const Sb3 = require('../runtime/sb3-builder.js');

/** Arguments `--nom valeur` / `--drapeau`. */
function parseArgs(argv) {
    const args = {_flags: new Set()};
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (!token.startsWith('--')) continue;
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
            args._flags.add(key);
        } else {
            args[key] = next;
            i++;
        }
    }
    return args;
}

/** Costume de Sorax : un petit robot violet, dessiné par le script. */
function soraxCostume() {
    const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="64" height="64" viewBox="0 0 64 64">',
        '<rect x="8" y="14" width="48" height="40" rx="12" fill="#8b5cf6"/>',
        '<rect x="16" y="24" width="32" height="18" rx="6" fill="#ede9fe"/>',
        '<circle cx="24" cy="33" r="4" fill="#4c1d95"/>',
        '<circle cx="40" cy="33" r="4" fill="#4c1d95"/>',
        '<rect x="30" y="4" width="4" height="10" rx="2" fill="#a78bfa"/>',
        '<circle cx="32" cy="4" r="4" fill="#a78bfa"/>',
        '<path d="M22 48 L32 54 L42 48" stroke="#c4b5fd" stroke-width="3" fill="none" stroke-linecap="round"/>',
        '</svg>'
    ].join('');
    return {name: 'sorax.svg', data: Sb3.utf8(svg), format: 'svg'};
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const binPath = args.bin || 'sorax/assets/export/nano/sorax_core.bin';
    const outPath = args.out || binPath.replace(/sorax_core\.bin$/, 'sorax-scratch.sb3');
    const maxContext = parseInt(args.context, 10) || 128;
    const maxNew = parseInt(args['max-new'], 10) || 48;

    console.log(`Lecture ${binPath}`);
    const model = SoraxRuntime.load(fs.readFileSync(binPath));
    const arch = model.arch;
    const palier = args.palier || model.header.extra?.palier || 'nano';
    console.log(`  palier ${palier} : ${arch.n_layers} couches, d_model ${arch.d_model}, ` +
        `vocabulaire ${arch.vocab_size}, contexte max ${arch.max_seq_len}`);

    const engine = SoraxScratchEngine.build({
        arch: arch,
        tensors: model.tensors,
        tokenizer: model.header.tokenizer,
        maxNewTokens: maxNew,
        maxContext: maxContext,
        palier: palier
    });

    const project = new Sb3.Project({
        name: 'Sorax',
        author: 'Snowoo-',
        extensions: [],
        visibleVariables: {'sx progression': true},
        visibleLists: {'Historique': true},
        meta: engine.meta
    });

    // variables et listes globales (scène) : les moniteurs s'y réfèrent
    Object.keys(engine.variables).forEach((name) => project.globalVar(name, engine.variables[name]));
    Object.keys(engine.lists).forEach((name) => project.globalList(name, engine.lists[name]));

    project.addStage({costumeName: 'backdrop1'});
    project.addSprite('Sorax', {
        scripts: engine.scripts,
        costume: soraxCostume()
    });

    const compress = args._flags.has('store') ? null : (bytes) => zlib.deflateRawSync(Buffer.from(bytes));
    const sb3 = Sb3.buildSb3(project, compress);
    fs.mkdirSync(path.dirname(outPath), {recursive: true});
    fs.writeFileSync(outPath, Buffer.from(sb3));

    const json = JSON.stringify(project.toProjectJson());
    const blockCount = Object.keys(project.targets[1].blocks).length;
    console.log(`  blocs : ${blockCount}`);
    console.log(`  project.json : ${(json.length / 1024).toFixed(0)} Ko`);
    console.log(`  écris ${outPath} (${(sb3.length / 1024).toFixed(0)} Ko)`);
    console.log('  liste des variables :', Object.keys(engine.variables).length,
        '| listes :', Object.keys(engine.lists).length);
}

main();
