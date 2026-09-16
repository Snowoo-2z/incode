/**
 * @fileoverview Génère le **projet Scratch pur** de Sorax (projet Snowoo-).
 *
 * Entrée : le modèle exporté (`sorax_core.bin` déjà quantifié int8).
 * Sortie : des blocs Scratch ordinaires — aucune extension, aucun JavaScript,
 * aucune dépendance. Le réseau de neurones devient des listes, et le calcul
 * devient des procédures « sans rafraîchissement d'écran » (warp).
 *
 * Correspondance avec le runtime JS (`sorax-runtime.js`) — mêmes formules,
 * mêmes échelles, mêmes arrondis :
 *
 *   matvec()            -> `Matvec BASE SBASE LIGNES COLONNES`  (Out = W · X)
 *   rmsnorm()           -> `Norme BASE`                         (X = H/… · N)
 *   applyRope()         -> rotations en ligne dans `Passe`
 *   silu()              -> `Silu N`
 *   attention causale   -> `Attention POS`
 *   encode_greedy()     -> `Encode TEXTE`
 *   decode_token()      -> `Decode ID`
 *   échantillonnage     -> `Echantillonne`
 *   generate()          -> script `SoraxGenere` (un jeton par itération)
 *
 * Le forward d'un jeton est la procédure `Passe TETE` : c'est elle qui contient
 * la boucle sur les couches, les rotations RoPE et le cache K/V.
 *
 * Validation : `tools/validate_sb3.mjs` (structure + complétude des listes).
 */

/* eslint-disable no-var, vars-on-top, prefer-const, max-len */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else {
        root.SoraxScratchEngine = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ================================================================== */
    /* 1. Petite bibliothèque de blocs                                     */
    /* ================================================================== */

    /**
     * Une chaîne qui commence par « sx » est un **nom de variable** : on la
     * remplace par un bloc rapporteur (`data_variable`). Sans cette conversion,
     * le constructeur la sérialiserait en constante texte — bug silencieux
     * (le bloc calculerait avec la chaîne « sx i » au lieu de la valeur de i).
     */
    function vref(value) {
        if (typeof value === 'string' && value.indexOf('sx ') === 0) return V(value);
        return value;
    }

    function call(opcode, inputs, fields) {
        var converted = {};
        var source = inputs || {};
        Object.keys(source).forEach(function (key) {
            converted[key] = vref(source[key]);
        });
        return {opcode: opcode, inputs: converted, fields: fields || {}};
    }
    function V(name) { return {opcode: 'data_variable', fields: {VARIABLE: name}}; }
    function ITEM(list, index) {
        return call('data_itemoflist', {INDEX: index}, {LIST: list});
    }
    function LEN(list) { return {opcode: 'data_lengthoflist', fields: {LIST: list}}; }
    function OP(name, args) { return call('operator_' + name, args); }
    function add(a, b) { return OP('add', {NUM1: a, NUM2: b}); }
    function sub(a, b) { return OP('subtract', {NUM1: a, NUM2: b}); }
    function mul(a, b) { return OP('multiply', {NUM1: a, NUM2: b}); }
    function div(a, b) { return OP('divide', {NUM1: a, NUM2: b}); }
    function mod(a, b) { return OP('mod', {NUM1: a, NUM2: b}); }
    function gt(a, b) { return OP('gt', {OPERAND1: a, OPERAND2: b}); }
    function lt(a, b) { return OP('lt', {OPERAND1: a, OPERAND2: b}); }
    function eq(a, b) { return OP('equals', {OPERAND1: a, OPERAND2: b}); }
    function and(a, b) { return OP('and', {OPERAND1: a, OPERAND2: b}); }
    function not(a) { return OP('not', {OPERAND: a}); }
    function join(a, b) { return OP('join', {STRING1: a, STRING2: b}); }
    function round(a) { return OP('round', {NUM: a}); }
    function random(a, b) { return OP('random', {FROM: a, TO: b}); }
    function mathop(kind, a) { return call('operator_mathop', {NUM: a}, {OPERATOR: kind}); }
    function exp(x) { return mathop('e ^', x); }
    function floorDiv(a, b) { return mathop('floor', div(a, b)); }

    function sv(name, value) {
        return call('data_setvariableto', {VALUE: value}, {VARIABLE: name});
    }
    function cv(name, value) {
        return call('data_changevariableby', {VALUE: value}, {VARIABLE: name});
    }
    function listAdd(list, item) { return call('data_addtolist', {ITEM: item}, {LIST: list}); }
    function listSet(list, index, item) {
        return call('data_replaceitemoflist', {INDEX: index, ITEM: item}, {LIST: list});
    }
    function listDeleteAll(list) { return call('data_deletealloflist', {}, {LIST: list}); }
    function listDelete(list, index) { return call('data_deleteoflist', {INDEX: index}, {LIST: list}); }
    /** Un corps de bloc peut être un bloc seul : on le normalise en liste. */
    function branch(body) {
        if (!body) return [];
        return Array.isArray(body) ? body : [body];
    }

    function ifThen(cond, body) { return call('control_if', {CONDITION: cond, SUBSTACK: branch(body)}); }
    function ifElse(cond, body, body2) {
        return call('control_if_else', {CONDITION: cond, SUBSTACK: branch(body), SUBSTACK2: branch(body2)});
    }
    function repeat(times, body) { return call('control_repeat', {TIMES: times, SUBSTACK: branch(body)}); }
    function repeatUntil(cond, body) {
        return call('control_repeat_until', {CONDITION: cond, SUBSTACK: branch(body)});
    }
    function waitUntil(cond) { return call('control_wait_until', {CONDITION: cond}); }
    function say(text) { return call('looks_say', {MESSAGE: text}); }
    function sayFor(text, secs) { return call('looks_sayforsecs', {MESSAGE: text, SECS: secs}); }
    function ask(q) { return call('sensing_askandwait', {QUESTION: q}); }
    function ans() { return call('sensing_answer'); }
    function strLen(s) { return OP('length', {STRING: s}); }
    function strLetter(i, s) { return call('operator_letter_of', {LETTER: i, STRING: s}); }
    function itemNum(list, item) {
        return call('data_itemnumoflist', {ITEM: item}, {LIST: list});
    }
    function argRep(name) {
        return {opcode: 'argument_reporter_string_number', inputs: {}, fields: {VALUE: name}};
    }
    function absOf(expr) { return mathop('abs', expr); }
    function sqrtOf(expr) { return mathop('sqrt', expr); }

    /** Bloc « définir » (procédure personnalisée) en mode warp. */
    function define(proccode, argNames, body) {
        var argIds = argNames.map(function (_n, i) { return 'arg_' + i; });
        var protoInputs = {};
        argNames.forEach(function (name, i) {
            protoInputs[argIds[i]] = {
                opcode: 'argument_reporter_string_number',
                inputs: {}, fields: {VALUE: name}, shadow: true
            };
        });
        return {
            opcode: 'procedures_definition',
            inputs: {
                custom_block: {
                    opcode: 'procedures_prototype',
                    inputs: protoInputs, fields: {}, shadow: true,
                    mutation: {
                        tagName: 'mutation', children: [], proccode: proccode,
                        argumentids: JSON.stringify(argIds),
                        argumentnames: JSON.stringify(argNames),
                        argumentdefaults: JSON.stringify(argNames.map(function () { return ''; })),
                        warp: 'true'
                    }
                }
            },
            fields: {},
            proccode: proccode,
            proccodeIds: argIds,
            body: body
        };
    }

    /** Appel de procédure. */
    function invoke(def, values) {
        var inputs = {};
        // `vref` comme dans `call()` : un nom de variable passé en argument doit
        // devenir une *référence* de variable, pas un texte littéral.
        def.proccodeIds.forEach(function (id, i) { inputs[id] = vref(values[i]); });
        return {
            opcode: 'procedures_call', inputs: inputs, fields: {},
            mutation: {
                tagName: 'mutation', children: [], proccode: def.proccode,
                argumentids: JSON.stringify(def.proccodeIds), warp: 'true'
            }
        };
    }

    /* ================================================================== */
    /* 2. Disposition des poids (identique à model_spec.tensor_layout)     */
    /* ================================================================== */

    function layout(arch) {
        var E = arch.d_model, V = arch.vocab_size, F = arch.d_ff, L = arch.n_layers;
        var weights = {}, scales = {}, norms = {};
        var wOff = 0, sOff = 0, nOff = 0;

        weights.tok_emb = {offset: wOff, rows: V, cols: E};
        scales.tok_emb = {offset: sOff, len: V};
        wOff += V * E; sOff += V;

        for (var k = 0; k < L; k++) {
            weights['layers.' + k + '.wqkv'] = {offset: wOff, rows: 3 * E, cols: E};
            scales['layers.' + k + '.wqkv'] = {offset: sOff, len: 3 * E};
            wOff += 3 * E * E; sOff += 3 * E;

            weights['layers.' + k + '.wo'] = {offset: wOff, rows: E, cols: E};
            scales['layers.' + k + '.wo'] = {offset: sOff, len: E};
            wOff += E * E; sOff += E;

            weights['layers.' + k + '.w1'] = {offset: wOff, rows: F, cols: E};
            scales['layers.' + k + '.w1'] = {offset: sOff, len: F};
            wOff += F * E; sOff += F;

            weights['layers.' + k + '.w2'] = {offset: wOff, rows: E, cols: F};
            scales['layers.' + k + '.w2'] = {offset: sOff, len: E};
            wOff += E * F; sOff += E;

            norms['layers.' + k + '.attn_norm'] = {offset: nOff, len: E};
            nOff += E;
            norms['layers.' + k + '.ffn_norm'] = {offset: nOff, len: E};
            nOff += E;
        }
        norms.final_norm = {offset: nOff, len: E};
        nOff += E;
        return {weights: weights, scales: scales, norms: norms,
            totalWeights: wOff, totalScales: sOff, totalNorms: nOff};
    }

    function flatten(tensors, arch, kind) {
        var lay = layout(arch);
        var order = ['tok_emb'];
        for (var k = 0; k < arch.n_layers; k++) {
            order.push('layers.' + k + '.wqkv', 'layers.' + k + '.wo',
                'layers.' + k + '.w1', 'layers.' + k + '.w2');
        }
        var out;
        if (kind === 'weights') {
            out = new Array(lay.totalWeights);
            order.forEach(function (name) {
                var tensor = tensors[name], info = lay.weights[name];
                for (var i = 0; i < tensor.length; i++) out[info.offset + i] = String(tensor[i]);
            });
        } else {
            out = new Array(lay.totalScales);
            order.forEach(function (name) {
                var tensor = tensors[name + '__scale'], info = lay.scales[name];
                for (var i = 0; i < tensor.length; i++) out[info.offset + i] = precision(tensor[i]);
            });
        }
        return out;
    }

    /** Norms à plat : attn_norm0, ffn_norm0, …, final_norm. */
    function flattenNorms(tensors, arch) {
        var lay = layout(arch);
        var out = new Array(lay.totalNorms);
        for (var k = 0; k < arch.n_layers; k++) {
            writeFlat(out, lay.norms['layers.' + k + '.attn_norm'], tensors['layers.' + k + '.attn_norm']);
            writeFlat(out, lay.norms['layers.' + k + '.ffn_norm'], tensors['layers.' + k + '.ffn_norm']);
        }
        writeFlat(out, lay.norms.final_norm, tensors.final_norm);
        return out;
    }

    function writeFlat(target, info, tensor) {
        for (var i = 0; i < tensor.length; i++) {
            target[info.offset + i] = precision(tensor[i]);
        }
    }

    /** Nombre en texte court : `0.0234375` et non `0.023437500000000001`. */
    function precision(value) {
        var text = Number(value).toPrecision(9);
        if (text.indexOf('.') !== -1) text = text.replace(/0+$/, '').replace(/\.$/, '');
        if (text === '-0') text = '0';
        return text;
    }

    /* ================================================================== */
    /* 3. Tables du tokenizer                                              */
    /* ================================================================== */

    /**
     * Tables embarquées dans la liste `OctetsChars` / `Ponctuation` :
     *  - `OctetsChars` : les 2048 premiers caractères Unicode (décodage des
     *    séquences UTF-8 à 2 octets, qui couvrent tout le français) ;
     *  - `Ponctuation` : codes 0x2000-0x20FF (tirets longs, apostrophes
     *    typographiques, points de suspension…) ;
     *  - `TokOctets` / `TokOffset` : les octets de chaque jeton, à plat.
     */
    function tokenizerTables(spec) {
        var byteBase = spec.byte_base || 5;
        var merges = spec.merges || [];
        var mergeBase = byteBase + 256;
        var bytesOf = {};
        for (var b = 0; b < 256; b++) bytesOf[byteBase + b] = [b];
        for (var i = 0; i < merges.length; i++) {
            bytesOf[mergeBase + i] = bytesOf[merges[i][0]].concat(bytesOf[merges[i][1]]);
        }
        var vocabSize = mergeBase + merges.length;

        var chars = [];
        for (var cp = 0; cp < 2048; cp++) chars.push(String.fromCharCode(cp));
        var punct = [];
        for (var cp2 = 0x2000; cp2 < 0x2100; cp2++) punct.push(String.fromCharCode(cp2));

        var flat = [];
        // `offsets[0]` est un décalage factice : ainsi
        //   item (k+1) de TokOffset = premier octet du jeton k
        //   item (k+2) de TokOffset = premier octet du jeton k+1 (donc la fin)
        var offsets = [1];
        var index = 1;                     // Scratch compte à partir de 1
        for (i = 0; i < vocabSize; i++) {
            var list = bytesOf[i] || [];
            for (var j = 0; j < list.length; j++) {
                flat.push(list[j] + byteBase);   // valeur = octet + byteBase
                index++;
            }
            offsets.push(index);
        }

        return {
            byteBase: byteBase,
            mergeBase: mergeBase,
            vocabSize: vocabSize,
            OctetsChars: chars,
            Ponctuation: punct,
            TokOctets: flat,
            TokOffset: offsets
        };
    }

    /* ================================================================== */
    /* 4. Noms                                                             */
    /* ================================================================== */

    var L = {
        W: 'Poids', ECH: 'Echelles', NOR: 'Normes',
        KC: 'CacheK', VC: 'CacheV',
        LOG: 'Logits', SCORES: 'Scores', CAND: 'Candidats',
        ENTREE: 'JetonsEntree', SORTIE: 'JetonsSortie', HIST: 'Historique',
        H: 'VecteurH', X: 'VecteurX', OUT: 'VecteurOut',
        VQ: 'VecteurQ', VK: 'VecteurK', VV: 'VecteurV',
        OCTETS: 'Octets',
        COS: 'TableCos', SIN: 'TableSin',
        CHARS: 'OctetsChars', PONCT: 'Ponctuation',
        TOKOCT: 'TokOctets', TOKOFF: 'TokOffset'
    };

    var G = {
        i: 'sx i', j: 'sx j', k: 'sx k', r: 'sx r',
        somme: 'sx somme', maximum: 'sx maximum', echelle: 'sx echelle',
        position: 'sx position', progression: 'sx progression',
        reponse: 'sx reponse', jeton: 'sx jeton', pret: 'sx pret', demande: 'sx demande',
        longueur: 'sx longueur', meilleur: 'sx meilleur', rang: 'sx rang',
        total: 'sx total', tirage: 'sx tirage', acc: 'sx accumulateur',
        temp: 'sx temp', temp2: 'sx temp2', octet: 'sx octet',
        maxLogit: 'sx maxLogit', a: 'sx a', b: 'sx b',
        cos: 'sx cos', sin: 'sx sin', debut: 'sx debut', compteur: 'sx compteur',
        drapeau: 'sx drapeau', tete: 'sx tete', cosTrace: 'sx dernierCos'
    };

    /* ================================================================== */
    /* 5. Construction                                                     */
    /* ================================================================== */

    /**
     * @param {object} options {arch, tensors, tokenizer, maxNewTokens, maxContext, palier}
     * @returns {object} {name, lists, variables, scripts, meta}
     */
    function build(options) {
        var arch = options.arch;
        var E = arch.d_model, H = arch.n_heads, DH = E / H, F = arch.d_ff;
        var V = arch.vocab_size, LAYERS = arch.n_layers, eps = arch.rms_eps;
        var maxNew = options.maxNewTokens || 48;
        var maxCtx = Math.min(options.maxContext || 128, arch.max_seq_len);
        var lay = layout(arch);
        var tab = tokenizerTables(options.tokenizer || {});
        var half = DH / 2;

        /* ---------------- listes ---------------- */
        var lists = {};
        lists[L.W] = flatten(options.tensors, arch, 'weights');
        lists[L.ECH] = flatten(options.tensors, arch, 'scales');
        lists[L.NOR] = flattenNorms(options.tensors, arch);
        lists[L.KC] = [];
        lists[L.VC] = [];
        lists[L.LOG] = fill(V, '0');
        lists[L.SCORES] = fill(maxCtx, '0');
        lists[L.CAND] = fill(V, '0');
        lists[L.ENTREE] = [];
        lists[L.SORTIE] = [];
        lists[L.HIST] = [];
        lists[L.H] = fill(E, '0');
        // X doit accueillir la plus grande entrée de `Matvec` (E ou F) :
        // `replace item of list` n'étend pas une liste, écrire au-delà serait perdu.
        lists[L.X] = fill(Math.max(E, F), '0');
        lists[L.OUT] = fill(Math.max(3 * E, F, V), '0');
        lists[L.VQ] = fill(E, '0');
        lists[L.VK] = fill(E, '0');
        lists[L.VV] = fill(E, '0');
        lists[L.OCTETS] = [];
        var cosTable = [], sinTable = [];
        for (var p = 0; p < maxCtx; p++) {
            for (var q = 0; q < half; q++) {
                var angle = p / Math.pow(arch.rope_theta, q / half);
                cosTable.push(precision(Math.cos(angle)));
                sinTable.push(precision(Math.sin(angle)));
            }
        }
        lists[L.COS] = cosTable;
        lists[L.SIN] = sinTable;
        lists[L.CHARS] = tab.OctetsChars;
        lists[L.PONCT] = tab.Ponctuation;
        lists[L.TOKOCT] = tab.TokOctets;
        lists[L.TOKOFF] = tab.TokOffset;

        var variables = {};
        Object.keys(G).forEach(function (key) { variables[G[key]] = 0; });
        variables[G.demande] = '';
        variables[G.reponse] = '';
        variables[G.pret] = 0;

        /* ---------------- procédures ---------------- */

        // Matvec BASE SBASE LIGNES COLONNES : Out[1..LIGNES] = W · X
        var defMatvec = define('Matvec %s %s %s %s', ['BASE', 'SBASE', 'LIGNES', 'COLONNES'], [
            sv(G.maximum, 0),
            sv(G.i, 1),
            repeat(argRep('COLONNES'), [
                ifThen(gt(absOf(ITEM(L.X, G.i)), G.maximum), sv(G.maximum, absOf(ITEM(L.X, G.i)))),
                cv(G.i, 1)
            ]),
            // identique à matvec() du runtime : peak > 1e-8 ? peak/127 : 1e-8
            ifElse(gt(G.maximum, 0.00000001), [
                sv(G.echelle, div(G.maximum, 127))
            ], [
                sv(G.echelle, 0.00000001)
            ]),
            sv(G.i, 1),
            repeat(argRep('COLONNES'), [
                sv(G.temp, round(div(ITEM(L.X, G.i), G.echelle))),
                ifThen(gt(G.temp, 127), sv(G.temp, 127)),
                ifThen(lt(G.temp, -127), sv(G.temp, -127)),
                listSet(L.X, G.i, G.temp),
                cv(G.i, 1)
            ]),
            sv(G.debut, add(argRep('BASE'), 1)),
            sv(G.r, 1),
            repeat(argRep('LIGNES'), [
                sv(G.somme, 0),
                sv(G.i, 1),
                repeat(argRep('COLONNES'), [
                    sv(G.somme, add(G.somme, mul(ITEM(L.W, G.debut), ITEM(L.X, G.i)))),
                    cv(G.debut, 1),
                    cv(G.i, 1)
                ]),
                listSet(L.OUT, G.r, mul(G.somme, mul(ITEM(L.ECH, add(argRep('SBASE'), G.r)), G.echelle))),
                cv(G.r, 1)
            ])
        ]);

        // Norme BASE : X = H / rms(H) · N[BASE..]
        var defNorme = define('Norme %s', ['BASE'], [
            sv(G.somme, 0),
            sv(G.i, 1),
            repeat(E, [
                sv(G.somme, add(G.somme, mul(ITEM(L.H, G.i), ITEM(L.H, G.i)))),
                cv(G.i, 1)
            ]),
            sv(G.echelle, div(1, sqrtOf(add(div(G.somme, E), eps)))),
            sv(G.i, 1),
            repeat(E, [
                listSet(L.X, G.i, mul(ITEM(L.H, G.i),
                    mul(G.echelle, ITEM(L.NOR, add(argRep('BASE'), G.i))))),
                cv(G.i, 1)
            ])
        ]);

        // Ajoute N : H += Out
        var defAjoute = define('Ajoute %s', ['NOMBRE'], [
            sv(G.i, 1),
            repeat(argRep('NOMBRE'), [
                listSet(L.H, G.i, add(ITEM(L.H, G.i), ITEM(L.OUT, G.i))),
                cv(G.i, 1)
            ])
        ]);

        // Copie N : X = Out
        var defCopie = define('Copie %s', ['NOMBRE'], [
            sv(G.i, 1),
            repeat(argRep('NOMBRE'), [
                listSet(L.X, G.i, ITEM(L.OUT, G.i)),
                cv(G.i, 1)
            ])
        ]);

        // Silu N : X = silu(X)
        var defSilu = define('Silu %s', ['NOMBRE'], [
            sv(G.i, 1),
            repeat(argRep('NOMBRE'), [
                listSet(L.X, G.i, div(ITEM(L.X, G.i), add(1, exp(mul(-1, ITEM(L.X, G.i)))))),
                cv(G.i, 1)
            ])
        ]);

        // Attention POS : Out = attention causale de la position POS-1
        var defAttention = define('Attention %s %s', ['POS', 'BASE'], [
            sv(G.i, 1),
            repeat(E, [listSet(L.OUT, G.i, 0), cv(G.i, 1)]),
            sv(G.tete, 0),
            repeat(H, [
                sv(G.maximum, -1000000000),
                sv(G.i, 1),
                repeat(argRep('POS'), [
                    sv(G.somme, 0),
                    sv(G.j, 0),
                    repeat(DH, [
                        sv(G.somme, add(G.somme,
                            mul(ITEM(L.VQ, add(mul(G.tete, DH), add(G.j, 1))),
                                ITEM(L.KC, add(add(mul(sub(G.i, 1), LAYERS * E), argRep('BASE')),
                                    add(mul(G.tete, DH), add(G.j, 1))))))),
                        cv(G.j, 1)
                    ]),
                    sv(G.somme, div(G.somme, sqrtOf(DH))),
                    listSet(L.SCORES, G.i, G.somme),
                    ifThen(gt(G.somme, G.maximum), sv(G.maximum, G.somme)),
                    cv(G.i, 1)
                ]),
                sv(G.total, 0),
                sv(G.i, 1),
                repeat(argRep('POS'), [
                    sv(G.temp, exp(sub(ITEM(L.SCORES, G.i), G.maximum))),
                    listSet(L.SCORES, G.i, G.temp),
                    sv(G.total, add(G.total, G.temp)),
                    cv(G.i, 1)
                ]),
                sv(G.i, 1),
                repeat(argRep('POS'), [
                    sv(G.temp, div(ITEM(L.SCORES, G.i), G.total)),
                    sv(G.j, 0),
                    repeat(DH, [
                        sv(G.debut, add(mul(G.tete, DH), add(G.j, 1))),
                        listSet(L.OUT, G.debut, add(ITEM(L.OUT, G.debut),
                            mul(G.temp, ITEM(L.VC, add(add(mul(sub(G.i, 1), LAYERS * E), argRep('BASE')),
                                add(mul(G.tete, DH), add(G.j, 1))))))),
                        cv(G.j, 1)
                    ]),
                    cv(G.i, 1)
                ]),
                cv(G.tete, 1)
            ])
        ]);

        // Tete : norme finale + projection sur le vocabulaire -> Logits
        var defTete = define('Tete', [], [
            invoke(defNorme, [lay.norms.final_norm.offset]),
            invoke(defMatvec, [lay.weights.tok_emb.offset, lay.scales.tok_emb.offset, V, E]),
            sv(G.i, 1),
            repeat(V, [
                listSet(L.LOG, G.i, ITEM(L.OUT, G.i)),
                cv(G.i, 1)
            ])
        ]);

        // Echantillonne : température 0,7 → `sx jeton`
        var defEchantillonne = define('Echantillonne', [], [
            sv(G.maxLogit, ITEM(L.LOG, 1)),
            sv(G.i, 1),
            repeat(V, [
                ifThen(gt(ITEM(L.LOG, G.i), G.maxLogit), sv(G.maxLogit, ITEM(L.LOG, G.i))),
                cv(G.i, 1)
            ]),
            sv(G.total, 0),
            sv(G.i, 1),
            repeat(V, [
                sv(G.temp, exp(div(sub(ITEM(L.LOG, G.i), G.maxLogit), 0.7))),
                listSet(L.CAND, G.i, G.temp),
                sv(G.total, add(G.total, G.temp)),
                cv(G.i, 1)
            ]),
            sv(G.tirage, mul(random(0, 1), G.total)),
            sv(G.acc, 0),
            sv(G.i, 1),
            sv(G.jeton, -1),
            repeatUntil(gt(G.jeton, -1), [
                sv(G.acc, add(G.acc, ITEM(L.CAND, G.i))),
                // Logits[i] correspond au jeton i-1 (les listes Scratch sont 1-based)
                ifThen(gt(G.acc, G.tirage), sv(G.jeton, sub(G.i, 1))),
                ifThen(gt(G.i, V), sv(G.jeton, 0)),
                cv(G.i, 1)
            ])
        ]);

        // Encode TEXTE : texte -> octets UTF-8 -> jetons (appariement glouton)
        var defEncode = define('Encode %s', ['TEXTE'], buildEncodeBody(L, G, tab, maxCtx));

        // Decode ID : ajoute le texte du jeton à `sx reponse`
        var defDecode = define('Decode %s', ['ID'], buildDecodeBody(L, G, tab));

        // Passe TETE : un jeton complet dans le réseau (cache K/V compris)
        var defPasse = define('Passe %s', ['TETE'],
            buildForwardBody(L, G, {
                arch: arch, lay: lay, defs: {matvec: defMatvec, norme: defNorme,
                    ajoute: defAjoute, copie: defCopie, silu: defSilu,
                    attention: defAttention, tete: defTete},
                half: half, defPasseRef: null
            }));

        var defs = {
            matvec: defMatvec, norme: defNorme, ajoute: defAjoute, copie: defCopie,
            silu: defSilu, attention: defAttention, tete: defTete,
            echantillonne: defEchantillonne, encode: defEncode, decode: defDecode,
            passe: defPasse
        };

        /* ---------------- scripts ---------------- */
        var scripts = [];

        // 1) drapeau vert : initialisation
        scripts.push({x: 40, y: 40, blocks: [
            call('event_whenflagclicked'),
            sv(G.pret, 0),
            call('data_hidevariable', {}, {VARIABLE: G.pret}),
            call('data_showvariable', {}, {VARIABLE: G.progression}),
            call('data_showlist', {}, {LIST: L.HIST}),
            call('data_hidelist', {}, {LIST: L.OUT}),
            call('data_hidelist', {}, {LIST: L.X}),
            call('data_hidelist', {}, {LIST: L.H}),
            call('data_hidelist', {}, {LIST: L.VQ}),
            call('data_hidelist', {}, {LIST: L.VK}),
            call('data_hidelist', {}, {LIST: L.VV}),
            call('data_hidelist', {}, {LIST: L.KC}),
            call('data_hidelist', {}, {LIST: L.VC}),
            call('data_hidelist', {}, {LIST: L.LOG}),
            call('data_hidelist', {}, {LIST: L.CAND}),
            call('data_hidelist', {}, {LIST: L.SCORES}),
            call('data_hidelist', {}, {LIST: L.W}),
            call('data_hidelist', {}, {LIST: L.ECH}),
            call('data_hidelist', {}, {LIST: L.NOR}),
            call('data_hidelist', {}, {LIST: L.OCTETS}),
            call('data_hidelist', {}, {LIST: L.SORTIE}),
            call('data_hidelist', {}, {LIST: L.CHARS}),
            call('data_hidelist', {}, {LIST: L.COS}),
            call('data_hidelist', {}, {LIST: L.SIN}),
            call('data_hidelist', {}, {LIST: L.PONCT}),
            call('data_hidelist', {}, {LIST: L.TOKOCT}),
            call('data_hidelist', {}, {LIST: L.TOKOFF}),
            listDeleteAll(L.SORTIE),
            listDeleteAll(L.OCTETS),
            sayFor('Sorax est pret : clique sur moi ou appuie sur ESPACE', 3),
            sv(G.pret, 1)
        ]});

        // 2) touche espace
        scripts.push({x: 40, y: 700, blocks: [
            call('event_whenkeypressed', {}, {KEY_OPTION: 'space'}),
            waitUntil(eq(G.pret, 1)),
            sv(G.pret, 0),
            ask('Que veux-tu que Sorax fasse ?'),
            sv(G.demande, ans()),
            call('event_broadcast', {BROADCAST_INPUT: 'SoraxGenere'})
        ]});

        // 3) clic sur le sprite
        scripts.push({x: 40, y: 1000, blocks: [
            call('event_whenthisspriteclicked'),
            waitUntil(eq(G.pret, 1)),
            sv(G.pret, 0),
            ask('Que veux-tu que Sorax fasse ?'),
            sv(G.demande, ans()),
            call('event_broadcast', {BROADCAST_INPUT: 'SoraxGenere'})
        ]});

        // 4) génération
        scripts.push({x: 40, y: 1300, blocks: buildGenerateScript(L, G, tab, defs, {
            maxNew: maxNew, maxCtx: maxCtx, byteBase: tab.byteBase
        })});

        // 5) définitions
        [defPasse, defMatvec, defNorme, defSilu, defAjoute, defCopie, defAttention,
            defTete, defEchantillonne, defEncode, defDecode].forEach(function (def, index) {
            scripts.push({
                x: 900 + (index % 3) * 480,
                y: 60 + Math.floor(index / 3) * 900,
                // le corps d'une procédure est la chaîne `next` de sa définition
                blocks: [def].concat(def.body || [])
            });
        });

        return {
            name: 'Sorax',
            lists: lists,
            variables: variables,
            scripts: scripts,
            meta: {
                palier: options.palier || 'nano',
                parametres: lay.totalWeights,
                vocabulaire: tab.vocabSize,
                couches: LAYERS,
                contexte: maxCtx,
                maxNouveauxJetons: maxNew,
                architecture: arch
            }
        };
    }

    function fill(n, value) {
        var out = new Array(n);
        for (var i = 0; i < n; i++) out[i] = value;
        return out;
    }

    /* ------------------------------------------------------------------ */
    /* Forward d'un jeton                                                  */
    /* ------------------------------------------------------------------ */

    /**
     * Construit le corps de `Passe TETE` : embedding du jeton `sx jeton`
     * placé en position `sx position`, puis les couches, puis (si TETE = 1)
     * la projection sur le vocabulaire.
     */
    function buildForwardBody(L, G, ctx) {
        var arch = ctx.arch, E = arch.d_model, H = arch.n_heads, DH = E / H, F = arch.d_ff;
        var lay = ctx.lay, defs = ctx.defs, half = ctx.half;
        var body = [];

        // H = X = embedding · échelle de la ligne
        body.push(sv(G.i, 1));
        body.push(repeat(E, [
            // ligne `sx jeton` (identifiant 0-based) : item (jeton·E + i)
            listSet(L.X, G.i, mul(ITEM(L.W, add(mul(G.jeton, E), G.i)),
                ITEM(L.ECH, add(G.jeton, 1)))),
            listSet(L.H, G.i, ITEM(L.X, G.i)),
            cv(G.i, 1)
        ]));

        for (var k = 0; k < arch.n_layers; k++) {
            // ---- attention ----
            body.push(invoke(defs.norme, [lay.norms['layers.' + k + '.attn_norm'].offset]));
            body.push(invoke(defs.matvec,
                [lay.weights['layers.' + k + '.wqkv'].offset,
                    lay.scales['layers.' + k + '.wqkv'].offset, 3 * E, E]));
            body.push(sv(G.i, 1));
            body.push(repeat(E, [
                listSet(L.VQ, G.i, ITEM(L.OUT, G.i)),
                listSet(L.VK, G.i, ITEM(L.OUT, add(E, G.i))),
                listSet(L.VV, G.i, ITEM(L.OUT, add(mul(2, E), G.i))),
                cv(G.i, 1)
            ]));
            // RoPE : rotation par paires (2j, 2j+1), Q puis K, tête par tête
            body.push(sv(G.tete, 0));
            body.push(repeat(H, [
                sv(G.j, 0),
                repeat(half, [
                    sv(G.debut, add(mul(G.tete, DH), add(mul(G.j, 2), 1))),
                    sv(G.k, add(mul(G.position, half), add(G.j, 1))),
                    sv(G.a, ITEM(L.VQ, G.debut)),
                    sv(G.b, ITEM(L.VQ, add(G.debut, 1))),
                    listSet(L.VQ, G.debut,
                        sub(mul(G.a, ITEM(L.COS, G.k)), mul(G.b, ITEM(L.SIN, G.k)))),
                    listSet(L.VQ, add(G.debut, 1),
                        add(mul(G.a, ITEM(L.SIN, G.k)), mul(G.b, ITEM(L.COS, G.k)))),
                    sv(G.a, ITEM(L.VK, G.debut)),
                    sv(G.b, ITEM(L.VK, add(G.debut, 1))),
                    listSet(L.VK, G.debut,
                        sub(mul(G.a, ITEM(L.COS, G.k)), mul(G.b, ITEM(L.SIN, G.k)))),
                    listSet(L.VK, add(G.debut, 1),
                        add(mul(G.a, ITEM(L.SIN, G.k)), mul(G.b, ITEM(L.COS, G.k)))),
                    cv(G.j, 1)
                ]),
                cv(G.tete, 1)
            ]));
            // cache K/V
            body.push(sv(G.i, 1));
            body.push(repeat(E, [
                listAdd(L.KC, ITEM(L.VK, G.i)),
                listAdd(L.VC, ITEM(L.VV, G.i)),
                cv(G.i, 1)
            ]));
            // attention -> Out, puis projection Wo (Matvec lit toujours X), résidu
            body.push(invoke(defs.attention, [add(G.position, 1), mul(k, E)]));
            body.push(invoke(defs.copie, [E]));                    // X = sortie d'attention
            body.push(invoke(defs.matvec,
                [lay.weights['layers.' + k + '.wo'].offset,
                    lay.scales['layers.' + k + '.wo'].offset, E, E]));
            body.push(invoke(defs.ajoute, [E]));

            // ---- feed-forward ----
            body.push(invoke(defs.norme, [lay.norms['layers.' + k + '.ffn_norm'].offset]));
            body.push(invoke(defs.matvec,
                [lay.weights['layers.' + k + '.w1'].offset,
                    lay.scales['layers.' + k + '.w1'].offset, F, E]));
            body.push(invoke(defs.copie, [F]));
            body.push(invoke(defs.silu, [F]));
            body.push(invoke(defs.matvec,
                [lay.weights['layers.' + k + '.w2'].offset,
                    lay.scales['layers.' + k + '.w2'].offset, E, F]));
            body.push(invoke(defs.ajoute, [E]));
        }

        body.push(ifThen(eq(argRep('TETE'), 1), [invoke(defs.tete, [])]));
        return body;
    }

    /* ------------------------------------------------------------------ */
    /* Script de génération                                                */
    /* ------------------------------------------------------------------ */

    function buildGenerateScript(L, G, tab, defs, opt) {
        var blocks = [];
        blocks.push(call('event_whenbroadcastreceived', {}, {BROADCAST_OPTION: 'SoraxGenere'}));
        blocks.push(sv(G.reponse, ''));
        blocks.push(sv(G.position, 0));
        blocks.push(sv(G.progression, 0));
        blocks.push(sv(G.drapeau, 0));
        blocks.push(sv(G.pret, 0));
        [L.KC, L.VC, L.ENTREE, L.SORTIE, L.OCTETS].forEach(function (list) {
            blocks.push(listDeleteAll(list));
        });
        blocks.push(invoke(defs.encode, [join('<code>', G.demande)]));
        blocks.push(call('data_insertatlist', {ITEM: 1, INDEX: 1}, {LIST: L.ENTREE}));   // <bos>
        blocks.push(listAdd(L.ENTREE, tab.byteBase + 4));       // <assistant>
        // préremplissage : chaque jeton du prompt passe dans le réseau.
        // `sx compteur` est dédié à ce script : les procédures utilisent `sx i`
        // pour leurs propres boucles.
        blocks.push(sv(G.compteur, 1));
        blocks.push(repeat(LEN(L.ENTREE), [
            sv(G.jeton, ITEM(L.ENTREE, G.compteur)),
            sv(G.position, sub(G.compteur, 1)),
            invoke(defs.passe, [0]),
            sv(G.progression, round(div(mul(G.compteur, 40), LEN(L.ENTREE)))),
            cv(G.compteur, 1)
        ]));
        blocks.push(invoke(defs.tete, []));                       // logits du dernier jeton
        blocks.push(repeat(opt.maxNew, [
            ifThen(eq(G.drapeau, 0), [
                invoke(defs.echantillonne, []),
                ifElse(eq(G.jeton, 2), [
                    sv(G.drapeau, 1)
                ], [
                    listAdd(L.SORTIE, G.jeton),
                    invoke(defs.decode, [G.jeton]),
                    sv(G.progression,
                        add(40, round(div(mul(LEN(L.SORTIE), 55), opt.maxNew)))),
                    say(join('Sorax : ', G.reponse)),
                    cv(G.position, 1),                 // position du jeton à venir
                    invoke(defs.passe, [1])
                ])
            ])
        ]));
        blocks.push(sv(G.progression, 100));
        blocks.push(listAdd(L.HIST, join(join(G.demande, ' -> '), G.reponse)));
        blocks.push(say(G.reponse));
        blocks.push(sv(G.pret, 1));
        return blocks;
    }

    /* ------------------------------------------------------------------ */
    /* Encode / Decode                                                     */
    /* ------------------------------------------------------------------ */

    /** Encode : texte -> octets UTF-8 (arithmétique) -> appariement glouton. */
    function buildEncodeBody(L, G, tab, maxCtx) {
        var byteBase = tab.byteBase, vocabSize = tab.vocabSize;
        var body = [];
        body.push(listDeleteAll(L.ENTREE));
        body.push(listDeleteAll(L.OCTETS));
        body.push(sv(G.longueur, strLen(argRep('TEXTE'))));
        body.push(sv(G.i, 1));
        body.push(repeat(G.longueur, [
            sv(G.temp, sub(itemNum(L.CHARS, strLetter(G.i, argRep('TEXTE'))), 1)),
            ifThen(lt(G.temp, 0), [                                   // hors table de base
                sv(G.temp2, itemNum(L.PONCT, strLetter(G.i, argRep('TEXTE')))),
                ifElse(gt(G.temp2, 0), sv(G.temp, add(8191, G.temp2)), sv(G.temp, 63))
            ]),
            ifThen(gt(G.temp, 65535), sv(G.temp, 63)),                // hors BMP -> « ? »
            ifThen(lt(G.temp, 128), [
                listAdd(L.OCTETS, add(byteBase, G.temp))
            ]),
            ifThen(and(gt(G.temp, 127), lt(G.temp, 2048)), [
                listAdd(L.OCTETS, add(byteBase, add(192, floorDiv(G.temp, 64)))),
                listAdd(L.OCTETS, add(byteBase, add(128, mod(G.temp, 64))))
            ]),
            ifThen(gt(G.temp, 2047), [
                listAdd(L.OCTETS, add(byteBase, add(224, floorDiv(G.temp, 4096)))),
                listAdd(L.OCTETS, add(byteBase, add(128, floorDiv(mod(G.temp, 4096), 64)))),
                listAdd(L.OCTETS, add(byteBase, add(128, mod(G.temp, 64))))
            ]),
            cv(G.i, 1)
        ]));
        // appariement glouton : le plus long jeton qui correspond
        body.push(sv(G.i, 1));
        body.push(repeatUntil(gt(G.i, LEN(L.OCTETS)), [
            sv(G.jeton, ITEM(L.OCTETS, G.i)),                 // repli : un seul octet
            sv(G.meilleur, 0),
            sv(G.j, byteBase),
            repeat(sub(vocabSize, byteBase), [
                sv(G.temp, sub(ITEM(L.TOKOFF, add(G.j, 2)), ITEM(L.TOKOFF, add(G.j, 1)))),
                ifThen(lt(G.temp, add(sub(LEN(L.OCTETS), G.i), 2)), [
                    sv(G.acc, 0),
                    sv(G.k, 0),
                    repeat(G.temp, [
                        ifThen(eq(ITEM(L.TOKOCT,
                            add(sub(ITEM(L.TOKOFF, add(G.j, 1)), 1), add(G.k, 1))),
                            ITEM(L.OCTETS, add(G.i, G.k))), cv(G.acc, 1)),
                        cv(G.k, 1)
                    ]),
                    ifThen(eq(G.acc, G.temp), [
                        ifThen(gt(G.temp, G.meilleur), [
                            sv(G.meilleur, G.temp),
                            sv(G.rang, G.j)
                        ])
                    ])
                ]),
                cv(G.j, 1)
            ]),
            ifElse(gt(G.meilleur, 0), [
                sv(G.jeton, G.rang),
                sv(G.i, add(G.i, G.meilleur))
            ], [
                sv(G.i, add(G.i, 1))          // aucun jeton connu : un octet seul
            ]),
            listAdd(L.ENTREE, G.jeton)
        ]));
        // garde-fou : on garde au plus `maxCtx` jetons
        body.push(sv(G.longueur, sub(maxCtx, 4)));
        body.push(repeat(4, [
            ifThen(gt(LEN(L.ENTREE), G.longueur), listDelete(L.ENTREE, LEN(L.ENTREE)))
        ]));
        return body;
    }

    /** Decode : jeton -> octets -> caractères (UTF-8). */
    function buildDecodeBody(L, G, tab) {
        var byteBase = tab.byteBase;
        var body = [];
        body.push(sv(G.debut, ITEM(L.TOKOFF, add(argRep('ID'), 2))));      // fin (exclue)
        body.push(sv(G.i, ITEM(L.TOKOFF, add(argRep('ID'), 1))));          // début
        body.push(repeatUntil(gt(G.i, sub(G.debut, 1)), [
            sv(G.octet, sub(ITEM(L.TOKOCT, G.i), byteBase)),       // octet brut 0..255
            ifThen(lt(G.octet, 128), [                              // 1 octet
                sv(G.temp, add(G.octet, 1)),
                listSet(L.OCTETS, 1, G.temp),
                sv(G.reponse, join(G.reponse, ITEM(L.CHARS, G.temp)))
            ]),
            ifThen(and(gt(G.octet, 191), lt(G.octet, 224)), [        // 2 octets
                sv(G.temp, add(mul(sub(G.octet, 192), 64),
                    sub(sub(ITEM(L.TOKOCT, add(G.i, 1)), byteBase), 128))),
                sv(G.reponse, join(G.reponse, ITEM(L.CHARS, add(G.temp, 1)))),
                cv(G.i, 1)
            ]),
            ifThen(gt(G.octet, 223), [                              // 3 octets
                sv(G.temp, add(mul(add(mul(sub(G.octet, 224), 64),
                    sub(sub(ITEM(L.TOKOCT, add(G.i, 1)), byteBase), 128)), 64),
                    sub(sub(ITEM(L.TOKOCT, add(G.i, 2)), byteBase), 128))),
                ifThen(lt(G.temp, 8192), [
                    sv(G.reponse, join(G.reponse, ITEM(L.CHARS, add(G.temp, 1))))
                ]),
                ifThen(and(gt(G.temp, 8191), lt(G.temp, 8448)), [
                    sv(G.reponse, join(G.reponse, ITEM(L.PONCT, sub(G.temp, 8191))))
                ]),
                cv(G.i, 2)
            ]),
            cv(G.i, 1)
        ]));
        return body;
    }

    return {
        build: build,
        layout: layout,
        tokenizerTables: tokenizerTables,
        precision: precision,
        LIST_NAMES: L,
        VAR_NAMES: G
    };
}));
