#!/usr/bin/env node
/**
 * @fileoverview Exécute le runtime JavaScript sur un `sorax_core.bin` et
 * imprime les logits en JSON — utilisé par `tools/check_runtime_parity.py`
 * pour vérifier que JS et Python calculent exactement la même chose.
 *
 *   node sorax/tools/parity_js.mjs sorax/assets/export/nano/sorax_core.bin "1,42,100,7"
 */

import fs from 'fs';
import path from 'path';
import {createRequire} from 'module';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const require = createRequire(import.meta.url);

const Sorax = require(path.join(ROOT, 'sorax/runtime/sorax-runtime.js'));

const binPath = process.argv[2];
const tokenArg = process.argv[3] || '1,42,100,7';
if (!binPath || !fs.existsSync(binPath)) {
    console.error('✘ fichier .bin introuvable : ' + binPath);
    process.exit(2);
}

const tokens = tokenArg.split(',').map(t => parseInt(t, 10));
const model = Sorax.load(fs.readFileSync(binPath));
const info = model.info();
model.reset();

let logits = null;
for (let pos = 0; pos < tokens.length; pos++) {
    logits = model.forwardToken(tokens[pos], pos);
}

const out = {
    tokens,
    logits: Array.from(logits),
    info: {
        parametres: info.parametres,
        vocabulaire: info.vocabulaire,
        arch: info.arch
    },
    // aller-retour du tokenizer : garantit que l'encodage JS == encodage Python
    encode: model.tokenizer.encode('sprite Balle 0 0:\n  whenflagclicked', false, false),
    decode: model.tokenizer.decode(model.tokenizer.encode('sprite Balle 0 0:', false, false))
};

process.stdout.write(JSON.stringify(out));
