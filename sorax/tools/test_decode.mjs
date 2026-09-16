#!/usr/bin/env node
/**
 * @fileoverview Compare le décodeur du **projet Scratch** (`Decode %s`) au
 * décodeur du runtime, pour **tous** les jetons du vocabulaire.
 *
 * C'est le test qui garantit que le texte affiché dans Scratch est exactement
 * celui du runtime, y compris sur les séquences UTF-8 coupées entre deux jetons.
 *
 * Usage : node sorax/tools/test_decode.mjs [--sb3 fichier.sb3] [--bin modele.bin]
 */

import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

import {ScratchVM, readZip} from './scratch-vm.mjs';

const require = createRequire(import.meta.url);
const SoraxRuntime = require('../runtime/sorax-runtime.js');

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
    }
    return args;
}

const args = parseArgs(process.argv.slice(2));
const sb3Path = args.sb3 || 'sorax/assets/export/nano/sorax-scratch.sb3';
const binPath = args.bin || path.join(path.dirname(path.dirname(sb3Path)), 'nano', 'sorax_core.bin');

const project = JSON.parse(readZip(fs.readFileSync(sb3Path))['project.json'].toString('utf8'));
const model = SoraxRuntime.load(fs.readFileSync(binPath));
const vocab = model.arch.vocab_size;

const defs = {};
for (const id of Object.keys(project.targets[1].blocks)) {
    const block = project.targets[1].blocks[id];
    if (block.opcode !== 'procedures_definition') continue;
    const proto = project.targets[1].blocks[block.inputs.custom_block[1]];
    defs[proto.mutation.proccode] = block;
}

const vm = new ScratchVM(project, {askAnswer: '', budget: 1e9});
const decode = defs['Decode %s'];
if (!decode) {
    console.error('procédure « Decode %s » introuvable dans le projet');
    process.exit(1);
}

let bad = 0;
let premiers = [];
for (let id = 0; id < vocab; id++) {
    vm.variables['sx reponse'] = '';
    vm.args.push({ID: id});
    vm.callStack.push('Decode %s');
    vm.run(decode.next);
    vm.callStack.pop();
    vm.args.pop();
    const scratch = String(vm.variables['sx reponse']);
    const runtime = model.tokenizer.decodeToken(id);
    if (scratch !== runtime) {
        bad++;
        if (premiers.length < 5) {
            premiers.push(`  jeton ${id} : scratch ${JSON.stringify(scratch)} ` +
                `≠ runtime ${JSON.stringify(runtime)}`);
        }
    }
}

// et sur les enchaînements (un caractère peut être coupé entre deux jetons)
const suites = [[1, 65, 355, 67], [200, 201, 202], [151, 152], [3, 4, 5, 6]];
for (const suite of suites) {
    vm.variables['sx reponse'] = '';
    for (const id of suite) {
        vm.args.push({ID: id});
        vm.callStack.push('Decode %s');
        vm.run(decode.next);
        vm.callStack.pop();
        vm.args.pop();
    }
    const scratch = String(vm.variables['sx reponse']);
    const runtime = suite.map((id) => model.tokenizer.decodeToken(id)).join('');
    if (scratch !== runtime) {
        bad++;
        premiers.push(`  suite ${suite.join(',')} : scratch ${JSON.stringify(scratch)} ` +
            `≠ runtime ${JSON.stringify(runtime)}`);
    }
}

console.log(`décodeur : ${vocab} jetons + ${suites.length} enchaînements comparés`);
if (bad) {
    console.log(premiers.join('\n'));
    console.log(`\n${bad} écart(s) : le décodeur Scratch ne reproduit pas le runtime.`);
    process.exit(1);
}
console.log('Décodeur Scratch identique au runtime sur tout le vocabulaire.');
