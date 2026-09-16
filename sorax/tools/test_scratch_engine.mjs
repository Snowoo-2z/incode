#!/usr/bin/env node
/**
 * @fileoverview Vérifie que le **projet Scratch pur** calcule exactement ce que
 * calcule le runtime (`sorax-runtime.js`).
 *
 * Plutôt que de lancer le VM (impossible sans `node_modules`), ce script
 * réimplémente un micro-interpréteur Scratch (200 lignes : listes, variables,
 * opérateurs, boucles, procédures) et exécute réellement les blocs du `.sb3`.
 * Il compare ensuite, étape par étape :
 *
 *   1. `JetonsEntree`  ↔ `tokenizer.encodeGreedy()`
 *   2. les `Logits` après chaque `Tete` ↔ les logits du runtime
 *   3. `sx reponse`    ↔ le décodage du runtime
 *
 * L'échantillonnage est forcé (les jetons sont imposés par le test) : la partie
 * aléatoire du script n'est donc jamais déterministe, tout le reste l'est.
 *
 * Usage :
 *   node sorax/tools/test_scratch_engine.mjs \
 *     --sb3 sorax/assets/export/nano/sorax-scratch.sb3 \
 *     --bin sorax/assets/export/nano/sorax_core.bin \
 *     --prompt "Cree un jeu de Pong" --tokens 3
 */

import fs from 'node:fs';
import {createRequire} from 'node:module';

import {ScratchVM, readZip} from './scratch-vm.mjs';

const require = createRequire(import.meta.url);
const SoraxRuntime = require('../runtime/sorax-runtime.js');

/* ---------------------------------------------------------------------- */
/* Lecture d'archive                                                      */
/* ---------------------------------------------------------------------- */

function parseArgs(argv) {
    const args = {_flags: new Set()};
    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) continue;
        const key = argv[i].slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) args._flags.add(key);
        else { args[key] = next; i++; }
    }
    return args;
}

/**
 * Écart normalisé : erreur absolue rapportée à `atol + rtol·|attendu|`.
 * Une valeur <= 1 signifie « dans la tolérance » (les logits proches de zéro ne
 * font pas exploser l'erreur relative).
 */
function relError(a, b) {
    const atol = 0.02, rtol = 1e-3;
    let worst = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const err = Math.abs((a[i] || 0) - (b[i] || 0)) / (atol + rtol * Math.abs(b[i] || 0));
        worst = Math.max(worst, err);
    }
    return worst;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const sb3Path = args.sb3 || 'sorax/assets/export/nano/sorax-scratch.sb3';
    const binPath = args.bin || 'sorax/assets/export/nano/sorax_core.bin';
    const prompt = args.prompt || 'Cree un jeu de Pong avec un score';
    const nTokens = parseInt(args.tokens, 10) || 3;
    const tolerance = Number(args.tolerance || 1e-3);

    const project = JSON.parse(readZip(fs.readFileSync(sb3Path))['project.json'].toString('utf8'));
    const model = SoraxRuntime.load(fs.readFileSync(binPath));
    const tokenizer = model.tokenizer;
    const assistantId = (model.header.tokenizer.byte_base || 5) + 4;

    /* ---------------- référence : le runtime JS ---------------- */
    const promptIds = tokenizer.encodeGreedy('<code>' + prompt, true, false).concat([assistantId]);
    const reference = [];
    model.reset();
    let logits = null;
    promptIds.forEach((id, pos) => { logits = Float32Array.from(model.forwardToken(id, pos)); });
    // le moteur Scratch ne calcule la tête qu'après le dernier jeton du prompt
    reference.push({kind: 'prompt', token: promptIds[promptIds.length - 1], logits: logits});
    const forced = [];
    for (let step = 0; step < nTokens; step++) {
        let best = 0;
        for (let i = 1; i < logits.length; i++) if (logits[i] > logits[best]) best = i;
        forced.push(best);
        logits = Float32Array.from(model.forwardToken(best, promptIds.length + step));
        reference.push({kind: 'genere', token: best, logits: logits});
    }
    console.log(`référence : ${promptIds.length} jetons de prompt, ${nTokens} jetons générés ` +
        `(force : ${forced.join(', ')})`);

    /* ---------------- exécution du projet Scratch ---------------- */
    const captured = [];
    const vm = new ScratchVM(project, {
        askAnswer: prompt,
        forcedTokens: forced.slice(),
        hooks: {
            afterCall: (proccode, state) => {
                if (proccode === 'Tete') captured.push(Float32Array.from(state.lists.Logits.map(Number)));
            }
        },
        budget: 200000000
    });
    vm.runFlag();
    if (vm.number(vm.variables['sx pret']) !== 1) throw new Error('le drapeau vert n\'a pas armé Sorax');
    vm.variables['sx demande'] = prompt;
    vm.askAnswer = prompt;

    const started = Date.now();
    vm.runBroadcast('SoraxGenere');
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);

    /* ---------------- comparaisons ---------------- */
    const problems = [];
    const listEntree = vm.lists.JetonsEntree.map((v) => Math.round(Number(v)));
    const expectedEntree = promptIds.slice();
    if (listEntree.length !== expectedEntree.length ||
        listEntree.some((v, i) => v !== expectedEntree[i])) {
        problems.push(`JetonsEntree différent :\n  Scratch : ${listEntree.join(' ')}\n  JS      : ${expectedEntree.join(' ')}`);
    } else {
        console.log(`JetonsEntree : identiques (${listEntree.length} jetons)`);
    }

    if (captured.length < reference.length) {
        problems.push(`Logits : ${captured.length} étapes exécutées pour ${reference.length} attendues`);
    } else if (captured.length > reference.length) {
        // le projet embarque `maxNouveauxJetons` itérations : les passes au-delà
        // des jetons comparés sont simplement ignorées
        console.log(`Logits : ${captured.length} étapes mesurées, ` +
            `${reference.length} comparées (maxNouveauxJetons du projet)`);
    }
    const errors = [];
    captured.forEach((values, index) => {
        if (!reference[index]) return;
        const err = relError(values, reference[index].logits);
        errors.push(err);
        if (err > tolerance) {
            problems.push(`Logits étape ${index} (${reference[index].kind}) : écart relatif ${err.toExponential(2)}`);
        }
    });
    if (errors.length) {
        console.log(`Logits : ${errors.length} étapes, écart relatif max ${Math.max(...errors).toExponential(2)}`);
    }

    // Le projet peut générer plus de jetons que les `nTokens` comparés : on
    // vérifie donc `Decode` sur les jetons réellement produits (`JetonsSortie`),
    // puis on contrôle que les jetons forcés ont bien été les premiers.
    const generes = vm.lists.JetonsSortie.map((v) => Math.round(Number(v)));
    const decodedRef = tokenizer.decode(generes, false);
    const reponse = String(vm.variables['sx reponse']);
    if (reponse !== decodedRef) {
        problems.push(`Decode différent :\n  Scratch : ${JSON.stringify(reponse)}\n  JS      : ${JSON.stringify(decodedRef)}`);
    } else {
        console.log(`Decode : identique (${JSON.stringify(reponse)})`);
    }
    if (generes.slice(0, forced.length).join(' ') !== forced.join(' ')) {
        problems.push(`JetonsSortie différent :\n  Scratch : ${generes.slice(0, forced.length).join(' ')}\n  JS      : ${forced.join(' ')}`);
    }

    console.log(`durée de génération : ${elapsed} s (${nTokens} jetons, micro-VM non optimisé)`);
    if (problems.length) {
        console.log('  -- état interne :');
        ['sx longueur', 'sx i', 'sx j', 'sx meilleur', 'sx rang', 'sx position', 'sx jeton'].forEach((name) => {
            console.log(`     ${name} = ${JSON.stringify(vm.variables[name])}`);
        });
        console.log(`     Octets (${vm.lists.Octets.length}) = ${JSON.stringify(vm.lists.Octets.slice(0, 20))}`);
        console.log(`     sx demande = ${JSON.stringify(vm.variables['sx demande'])}`);
        problems.forEach((message) => console.log(`  ÉCHEC  ${message}`));
        console.log(`\n${problems.length} problème(s).`);
        process.exit(1);
    }
    console.log('\nLe projet Scratch calcule exactement la même chose que le runtime.');
}

main();
