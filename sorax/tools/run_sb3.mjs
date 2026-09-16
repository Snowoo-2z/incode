#!/usr/bin/env node
/**
 * @fileoverview Déroule `sorax-scratch.sb3` **pour de vrai**, échantillonnage
 * compris, et affiche la réponse de Sorax. Sert de test de bout en bout du
 * projet Scratch (le drapeau vert, la question, la génération, le décodage).
 *
 * Usage :
 *   node sorax/tools/run_sb3.mjs [--sb3 fichier.sb3] [--bin modele.bin] "ta demande"
 *
 * Le micro-interpréteur est celui de `test_scratch_engine.mjs` : il n'y a pas
 * besoin de `node_modules`.
 */

import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

import {ScratchVM, readZip} from './scratch-vm.mjs';

const require = createRequire(import.meta.url);
const SoraxRuntime = require('../runtime/sorax-runtime.js');

function parseArgs(argv) {
    const args = {_positional: []};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) {
            args[argv[i].slice(2)] = argv[++i];
        } else {
            args._positional.push(argv[i]);
        }
    }
    return args;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const sb3Path = args.sb3 || 'sorax/assets/export/nano/sorax-scratch.sb3';
    const prompt = args._positional.join(' ') || 'Cree un jeu de plateforme avec un score';

    if (!fs.existsSync(sb3Path)) {
        console.error(`projet introuvable : ${sb3Path}\n` +
            'construis-le avec : node sorax/tools/build_sb3.mjs');
        process.exit(1);
    }

    const project = JSON.parse(readZip(fs.readFileSync(sb3Path))['project.json'].toString('utf8'));
    const vm = new ScratchVM(project, {askAnswer: prompt, budget: 4e8});

    vm.runFlag();
    if (Number(vm.variables['sx pret']) !== 1) {
        console.error('le drapeau vert n\'a pas armé Sorax');
        process.exit(1);
    }

    console.log(`projet  : ${sb3Path}`);
    console.log(`demande : ${prompt}`);
    vm.variables['sx demande'] = prompt;

    const started = Date.now();
    vm.runBroadcast('SoraxGenere');
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);

    const entree = vm.lists.JetonsEntree.map((v) => Math.round(Number(v)));
    const sortie = vm.lists.JetonsSortie.map((v) => Math.round(Number(v)));
    console.log(`durée   : ${elapsed} s (${sortie.length} jetons genérés, micro-VM non optimisé)`);
    console.log(`jetons  : entrée ${entree.length} | sortie ${sortie.length}`);
    console.log(`\nSorax : ${vm.variables['sx reponse']}`);

    // contrôle croisé : le runtime doit décoder la même chose
    const model = SoraxRuntime.load(fs.readFileSync(args.bin ||
        path.join(path.dirname(path.dirname(sb3Path)), 'nano', 'sorax_core.bin')));
    if (Array.isArray(sortie) && sortie.length) {
        const reference = model.tokenizer.decode(sortie, false);
        if (reference !== String(vm.variables['sx reponse'])) {
            console.error(`\nÉCHEC : le runtime décode ${JSON.stringify(reference)} ` +
                `mais le projet Scratch a écrit ${JSON.stringify(String(vm.variables['sx reponse']))}`);
            process.exit(1);
        }
        console.log('\nDécodage identique à celui du runtime.');
    }
}

main();
