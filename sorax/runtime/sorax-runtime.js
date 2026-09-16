/**
 * @fileoverview Sorax — moteur d'inférence JavaScript (projet Snowoo-).
 *
 * Ce fichier est LE moteur : le même code sert
 *  - dans l'IDE (assistant Sorax local, via import ES module ou global) ;
 *  - dans TurboWarp (extension / bloc JavaScript non sandboxé) ;
 *  - dans les tests de parité Node (`tools/check_runtime_parity.mjs`).
 *
 * Il implémente exactement les opérations du forward quantifié de référence
 * (`sorax/sorax/quantized_forward.py`) :
 *   embed(int8) -> [ RMSNorm -> qkv(int8) -> RoPE -> attention -> wo(int8) -> ]
 *              -> [ RMSNorm -> w1(int8) -> SiLU -> w2(int8) ] -> RMSNorm
 *              -> logits(int8, embeddings liés) -> échantillonnage
 *
 * Contraintes de conception :
 *  - **aucune dépendance** : ni module npm, ni `fetch` implicite ;
 *  - compatible ES5+ (variables `var`, pas de classes obligatoires) pour
 *    pouvoir être collé tel quel dans un bloc JavaScript ;
 *  - les poids restent en `Int8Array` (1 octet/paramètre) et les activations
 *    sont quantifiées dynamiquement : c'est ce qui rend le modèle exécutable
 *    sur un téléphone comme dans un projet Scratch.
 */

/* eslint-disable no-bitwise, prefer-const, vars-on-top, no-var */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else {
        root.Sorax = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ------------------------------------------------------------------ */
    /* Constantes du format binaire                                        */
    /* ------------------------------------------------------------------ */

    var MAGIC = 'SORAX1\u0000\u0000';
    var BYTE_BASE = 5;          // 5 jetons spéciaux : <pad> <bos> <eos> <user> <assistant>
    var MERGE_BASE = 261;       // BYTE_BASE + 256
    var ACT_FLOOR = 1e-8;
    var SCALE_FLOOR = 1e-8;

    /* ------------------------------------------------------------------ */
    /* Utilitaires                                                         */
    /* ------------------------------------------------------------------ */

    /** Décode un tampon UTF-8 en chaîne (sans dépendre de TextDecoder). */
    function utf8Decode(bytes) {
        var out = '';
        var i = 0, n = bytes.length;
        while (i < n) {
            var c = bytes[i++];
            if (c < 0x80) {
                out += String.fromCharCode(c);
            } else if (c < 0xE0) {
                out += String.fromCharCode(((c & 0x1F) << 6) | (bytes[i++] & 0x3F));
            } else if (c < 0xF0) {
                out += String.fromCharCode(
                    ((c & 0x0F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F)
                );
            } else {
                var cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3F) << 12) |
                         ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F);
                cp -= 0x10000;
                out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
            }
        }
        return out;
    }

    /** Encode une chaîne en octets UTF-8. */
    function utf8Encode(str) {
        var bytes = [];
        for (var i = 0; i < str.length; i++) {
            var c = str.charCodeAt(i);
            if (c < 0x80) {
                bytes.push(c);
            } else if (c < 0x800) {
                bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
            } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
                var c2 = str.charCodeAt(i + 1);
                if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
                    var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
                    bytes.push(
                        0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F),
                        0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F)
                    );
                    i++;
                    continue;
                }
                bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
            } else {
                bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
            }
        }
        return bytes;
    }

    /* ------------------------------------------------------------------ */
    /* Tokenizer (BPE octet)                                               */
    /* ------------------------------------------------------------------ */

    /**
     * Tokenizer BPE au niveau octet, construit depuis l'en-tête du modèle.
     * Il doit être **identique** au tokenizer Python (voir `tokenizer.py`).
     * @param {object} spec {specials, byte_base, merges}
     * @constructor
     */
    function Tokenizer(spec) {
        this.specials = spec.specials || ['<pad>', '<bos>', '<eos>', '<user>', '<assistant>'];
        this.byteBase = spec.byte_base || BYTE_BASE;
        this.merges = spec.merges || [];
        this.mergeBase = this.byteBase + 256;
        this.rank = {};
        this.bytesOf = {};
        for (var b = 0; b < 256; b++) {
            this.bytesOf[this.byteBase + b] = [b];
        }
        for (var i = 0; i < this.merges.length; i++) {
            var pair = this.merges[i];
            this.rank[pair[0] + ',' + pair[1]] = i;
            this.bytesOf[this.mergeBase + i] = this.bytesOf[pair[0]].concat(this.bytesOf[pair[1]]);
        }
        this.vocabSize = this.mergeBase + this.merges.length;
        // Découpage strictement identique à la regex Python `CHUNK_REGEX`.
        this.chunkRegex = /[0-9]+|[A-Za-z\u00C0-\u024F_][A-Za-z\u00C0-\u024F0-9_]*|[ \t\n\r]+|./gu;
    }

    /** Applique les fusions BPE sur les jetons-octets d'un chunk. */
    Tokenizer.prototype.mergeChunk = function (ids) {
        if (ids.length < 2) return ids;
        while (true) {
            var bestRank = null;
            for (var i = 0; i < ids.length - 1; i++) {
                var rank = this.rank[ids[i] + ',' + ids[i + 1]];
                if (rank !== undefined && (bestRank === null || rank < bestRank)) bestRank = rank;
            }
            if (bestRank === null) return ids;
            var merged = this.mergeBase + bestRank;
            var out = [];
            var j = 0;
            while (j < ids.length) {
                if (j < ids.length - 1 && this.rank[ids[j] + ',' + ids[j + 1]] === bestRank) {
                    out.push(merged);
                    j += 2;
                } else {
                    out.push(ids[j]);
                    j++;
                }
            }
            ids = out;
            if (ids.length < 2) return ids;
        }
    };

    /** Texte -> identifiants. */
    Tokenizer.prototype.encode = function (text, addBos, addEos) {
        var ids = [];
        if (addBos) ids.push(1);
        var chunks = String(text || '').match(this.chunkRegex) || [];
        for (var i = 0; i < chunks.length; i++) {
            var bytes = utf8Encode(chunks[i]);
            var byteIds = [];
            for (var b = 0; b < bytes.length; b++) byteIds.push(this.byteBase + bytes[b]);
            ids = ids.concat(this.mergeChunk(byteIds));
        }
        if (addEos) ids.push(2);
        return ids;
    };

    /**
     * Encodage par **appariement glouton** : identique à l'encodage du moteur
     * Scratch (`tokenizer.py::encode_greedy`), qui ne dispose que de la table
     * des jetons. Les octets produits sont les mêmes que ceux du BPE.
     */
    Tokenizer.prototype.encodeGreedy = function (text, addBos, addEos) {
        var ids = [];
        if (addBos) ids.push(1);
        var data = utf8Encode(String(text || ''));
        // jetons triés du plus long au plus court, précalculé une fois
        if (!this._sortedTokens) {
            this._sortedTokens = [];
            for (var key in this.bytesOf) {
                if (Object.prototype.hasOwnProperty.call(this.bytesOf, key)) {
                    var id = parseInt(key, 10);
                    if (id >= this.byteBase) {
                        this._sortedTokens.push([id, this.bytesOf[key]]);
                    }
                }
            }
            this._sortedTokens.sort(function (a, b) { return b[1].length - a[1].length; });
        }
        var i = 0;
        var n = data.length;
        while (i < n) {
            var matched = false;
            for (var k = 0; k < this._sortedTokens.length; k++) {
                var tokenId = this._sortedTokens[k][0];
                var tokenBytes = this._sortedTokens[k][1];
                var len = tokenBytes.length;
                if (len && i + len <= n) {
                    var ok = true;
                    for (var b = 0; b < len; b++) {
                        if (tokenBytes[b] !== data[i + b]) { ok = false; break; }
                    }
                    if (ok) {
                        ids.push(tokenId);
                        i += len;
                        matched = true;
                        break;
                    }
                }
            }
            if (!matched) {
                ids.push(this.byteBase + data[i]);
                i++;
            }
        }
        if (addEos) ids.push(2);
        return ids;
    };

    /** Identifiants -> texte. */
    Tokenizer.prototype.decode = function (ids) {
        var bytes = [];
        for (var i = 0; i < ids.length; i++) {
            var part = this.bytesOf[ids[i]];
            if (part) bytes = bytes.concat(part);
        }
        return utf8Decode(bytes);
    };

    /** Texte d'un seul jeton (décodage au fil de l'eau). */
    Tokenizer.prototype.decodeToken = function (id) {
        var part = this.bytesOf[id];
        return part ? utf8Decode(part) : '';
    };

    /* ------------------------------------------------------------------ */
    /* Modèle                                                              */
    /* ------------------------------------------------------------------ */

    /**
     * Charge un modèle depuis les octets de `sorax_core.bin`.
     * @param {ArrayBuffer|Uint8Array} buffer contenu du fichier
     * @returns {SoraxModel}
     */
    function load(buffer) {
        var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        var magic = '';
        for (var i = 0; i < 8; i++) magic += String.fromCharCode(bytes[i]);
        if (magic !== MAGIC) throw new Error('Sorax : fichier invalide (magie incorrecte)');
        var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        var headerLen = view.getUint32(8, true);
        var header = JSON.parse(utf8Decode(bytes.subarray(12, 12 + headerLen)));
        var payload = bytes.subarray(12 + headerLen);
        return new SoraxModel(header, payload);
    }

    /**
     * Modèle Sorax exécutable.
     * @param {object} header en-tête JSON du fichier
     * @param {Uint8Array} payload données binaires
     * @constructor
     */
    function SoraxModel(header, payload) {
        this.header = header;
        this.arch = header.arch;
        this.tokenizer = new Tokenizer(header.tokenizer || {});
        this.tensors = {};
        var i, t;
        for (i = 0; i < header.tensors.length; i++) {
            t = header.tensors[i];
            var slice = payload.subarray(t.offset, t.offset + t.length);
            if (t.dtype === 'i8') {
                // copie : alignement garanti pour Int8Array
                this.tensors[t.name] = new Int8Array(
                    slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.length)
                );
            } else {
                var f = new Float32Array(t.shape.reduce(function (a, b) { return a * b; }, 1));
                var dv = new DataView(slice.buffer, slice.byteOffset, slice.length);
                for (var k = 0; k < f.length; k++) f[k] = dv.getFloat32(k * 4, true);
                this.tensors[t.name] = f;
            }
        }
        var E = this.arch.d_model;
        var H = this.arch.n_heads;
        this.headDim = E / H;
        this.kvCache = null;
        this.ropeCos = null;
        this.ropeSin = null;
        this._prepareRope();
        var scratchSize = Math.max(3 * E, this.arch.d_ff, this.arch.vocab_size);
        this.scratch = {
            h: new Float32Array(E),
            n: new Float32Array(E),
            q: new Float32Array(E),
            k: new Float32Array(E),
            v: new Float32Array(E),
            // `out` et `hidden` doivent pouvoir contenir 3E valeurs (qkv) ou d_ff
            out: new Float32Array(scratchSize),
            hidden: new Float32Array(scratchSize),
            qx: new Int8Array(scratchSize),
            acc: new Int32Array(scratchSize),
            logits: new Float32Array(this.arch.vocab_size)
                };
    }

    /** Statistiques lisibles (taille, paramètres). */
    SoraxModel.prototype.info = function () {
        var params = 0;
        for (var name in this.tensors) {
            if (Object.prototype.hasOwnProperty.call(this.tensors, name) && name.indexOf('__scale') === -1) {
                params += this.tensors[name].length;
            }
        }
        return {
            nom: 'Sorax',
            auteur: 'Snowoo-',
            arch: this.arch,
            parametres: params,
            vocabulaire: this.tokenizer.vocabSize,
            contexte: this.arch.max_seq_len
        };
    };

    SoraxModel.prototype._prepareRope = function () {
        var half = this.headDim / 2;
        var theta = this.arch.rope_theta || 10000;
        var T = this.arch.max_seq_len + 8;
        this.ropeCos = new Float32Array(T * half);
        this.ropeSin = new Float32Array(T * half);
        for (var pos = 0; pos < T; pos++) {
            for (var i = 0; i < half; i++) {
                var freq = 1.0 / Math.pow(theta, i / half);
                this.ropeCos[pos * half + i] = Math.cos(pos * freq);
                this.ropeSin[pos * half + i] = Math.sin(pos * freq);
            }
        }
    };

    /** Réinitialise le cache KV (nouvelle conversation). */
    SoraxModel.prototype.reset = function () {
        var L = this.arch.n_layers;
        var E = this.arch.d_model;
        var T = this.arch.max_seq_len;
        this.kvCache = [];
        for (var l = 0; l < L; l++) {
            this.kvCache.push({
                k: new Float32Array(T * E),
                v: new Float32Array(T * E),
                len: 0
            });
        }
        return this;
    };

    /* ---------------------------- opérations ---------------------------- */

    /**
     * Produit matrice-vecteur int8 : `y[o] = sum_i W[o,i] * x[i]`.
     * @param {Int8Array} wq poids quantifiés (ligne par ligne)
     * @param {Float32Array} scales échelle par ligne
     * @param {Float32Array} x entrée (taille = colonnes)
     * @param {number} rows nombre de lignes
     * @param {number} cols nombre de colonnes
     * @param {Int8Array} qx tampon réutilisable pour x quantifié
     * @param {Int32Array} acc tampon réutilisable pour l'accumulateur
     * @param {Float32Array} out sortie (taille = lignes)
     * @returns {Float32Array} out
     */
    function matvec(wq, scales, x, rows, cols, qx, acc, out) {
        // 1) échelle d'activation (dynamique, comme un vrai moteur int8)
        var peak = 0;
        var i;
        for (i = 0; i < cols; i++) {
            var a = x[i] < 0 ? -x[i] : x[i];
            if (a > peak) peak = a;
        }
        var scaleA = peak > ACT_FLOOR ? peak / 127 : ACT_FLOOR;
        var inv = 1 / scaleA;
        for (i = 0; i < cols; i++) {
            var q = Math.round(x[i] * inv);
            qx[i] = q > 127 ? 127 : (q < -127 ? -127 : q);
        }
        // 2) produits scalaires entiers
        var row, base = 0, sum;
        for (row = 0; row < rows; row++) {
            sum = 0;
            for (i = 0; i < cols; i++) sum += wq[base + i] * qx[i];
            acc[row] = sum;
            base += cols;
        }
        // 3) re-mise à l'échelle par ligne
        for (row = 0; row < rows; row++) out[row] = acc[row] * scales[row] * scaleA;
        return out;
    }

    /** RMSNorm appliquée en place sur `dst` depuis `src`. */
    function rmsnorm(src, weight, eps, E, dst) {
        var ms = 0;
        for (var i = 0; i < E; i++) ms += src[i] * src[i];
        ms /= E;
        var s = 1 / Math.sqrt(ms + eps);
        for (var j = 0; j < E; j++) dst[j] = src[j] * s * weight[j];
        return dst;
    }

    /** RoPE sur un vecteur de dimension E (appariement (2i, 2i+1) par tête). */
    function applyRope(vec, cos, sin, heads, headDim) {
        var half = headDim / 2;
        for (var h = 0; h < heads; h++) {
            var base = h * headDim;
            for (var i = 0; i < half; i++) {
                var a = vec[base + 2 * i];
                var b = vec[base + 2 * i + 1];
                vec[base + 2 * i] = a * cos[i] - b * sin[i];
                vec[base + 2 * i + 1] = a * sin[i] + b * cos[i];
            }
        }
        return vec;
    }

    /**
     * Un pas de décodage complet : renvoie les logits de la position courante.
     * @param {number} token identifiant du jeton d'entrée
     * @param {number} pos position dans la séquence
     * @returns {Float32Array} logits (taille vocabulaire)
     */
    SoraxModel.prototype.forwardToken = function (token, pos) {
        var arch = this.arch;
        var E = arch.d_model;
        var H = arch.n_heads;
        var F = arch.d_ff;
        var V = arch.vocab_size;
        var dh = this.headDim;
        var tensors = this.tensors;
        var sc = this.scratch;
        var cache = this.kvCache;

        // ---- embedding (déquantifié ligne par ligne) --------------------
        var emb = tensors.tok_emb;
        var embScale = tensors.tok_emb__scale;
        var off = token * E;
        var s0 = embScale[token];
        var h = sc.h;
        for (var i = 0; i < E; i++) h[i] = emb[off + i] * s0;

        for (var layer = 0; layer < arch.n_layers; layer++) {
            var prefix = 'layers.' + layer + '.';
            // ---- attention -------------------------------------------
            rmsnorm(h, tensors[prefix + 'attn_norm'], arch.rms_eps, E, sc.n);
            var wqkv = tensors[prefix + 'wqkv'];
            var sqkv = tensors[prefix + 'wqkv__scale'];
            var qkv = sc.out;
            // qkv a besoin de 3E sorties : on réutilise acc/logits si trop petit
            matvec(wqkv, sqkv, sc.n, 3 * E, E, sc.qx, sc.acc, qkv);
            for (i = 0; i < E; i++) {
                sc.q[i] = qkv[i];
                sc.k[i] = qkv[E + i];
                sc.v[i] = qkv[2 * E + i];
            }
            var cos = this.ropeCos.subarray(pos * (dh / 2), pos * (dh / 2) + dh / 2);
            var sin = this.ropeSin.subarray(pos * (dh / 2), pos * (dh / 2) + dh / 2);
            applyRope(sc.q, cos, sin, H, dh);
            applyRope(sc.k, cos, sin, H, dh);

            var layerCache = cache[layer];
            var slot = layerCache.len * E;
            for (i = 0; i < E; i++) {
                layerCache.k[slot + i] = sc.k[i];
                layerCache.v[slot + i] = sc.v[i];
            }
            layerCache.len += 1;

            var nPos = layerCache.len;
            var invSqrt = 1 / Math.sqrt(dh);
            for (i = 0; i < E; i++) sc.out[i] = 0;
            for (var head = 0; head < H; head++) {
                var hb = head * dh;
                // scores
                var maxScore = -1e30;
                var scores = sc.logits.length >= nPos ? sc.logits : new Float32Array(nPos);
                for (var j = 0; j < nPos; j++) {
                    var kb = j * E + hb;
                    var dot = 0;
                    for (var d = 0; d < dh; d++) dot += sc.q[hb + d] * layerCache.k[kb + d];
                    dot *= invSqrt;
                    scores[j] = dot;
                    if (dot > maxScore) maxScore = dot;
                }
                var total = 0;
                for (j = 0; j < nPos; j++) {
                    var e = Math.exp(scores[j] - maxScore);
                    scores[j] = e;
                    total += e;
                }
                var invTotal = 1 / total;
                for (j = 0; j < nPos; j++) {
                    var w = scores[j] * invTotal;
                    var vb = j * E + hb;
                    for (d = 0; d < dh; d++) sc.out[hb + d] += w * layerCache.v[vb + d];
                }
            }
            var wo = tensors[prefix + 'wo'];
            var swo = tensors[prefix + 'wo__scale'];
            var attnOut = sc.q;                    // q n'est plus nécessaire
            matvec(wo, swo, sc.out, E, E, sc.qx, sc.acc, attnOut);
            for (i = 0; i < E; i++) h[i] += attnOut[i];

            // ---- feed-forward ----------------------------------------
            rmsnorm(h, tensors[prefix + 'ffn_norm'], arch.rms_eps, E, sc.n);
            var pre = sc.hidden;                   // v n'est plus nécessaire
            matvec(tensors[prefix + 'w1'], tensors[prefix + 'w1__scale'], sc.n, F, E,
                sc.qx, sc.acc, pre);
            for (i = 0; i < F; i++) pre[i] = pre[i] / (1 + Math.exp(-pre[i]));   // SiLU
            var down = sc.n;
            matvec(tensors[prefix + 'w2'], tensors[prefix + 'w2__scale'], pre, E, F,
                sc.qx, sc.acc, down);
            for (i = 0; i < E; i++) h[i] += down[i];
        }

        rmsnorm(h, tensors.final_norm, arch.rms_eps, E, sc.n);
        matvec(tensors.tok_emb, tensors.tok_emb__scale, sc.n, V, E, sc.qx, sc.acc, sc.logits);
        return sc.logits;
    };

    /* ---------------------------- génération ---------------------------- */

    /** Échantillonne un identifiant à partir des logits. */
    function sample(logits, options) {
        var temperature = options.temperature;
        var topK = options.topK;
        var i, j;
        if (!temperature || temperature <= 0) {
            var best = 0;
            for (i = 1; i < logits.length; i++) if (logits[i] > logits[best]) best = i;
            return best;
        }
        var V = logits.length;
        var idx = new Array(V);
        for (i = 0; i < V; i++) idx[i] = i;
        var scaled = new Float32Array(V);
        for (i = 0; i < V; i++) scaled[i] = logits[i] / temperature;
        var keep = Math.min(topK || V, V);
        idx.sort(function (a, b) { return scaled[b] - scaled[a]; });
        var cutoff = scaled[idx[keep - 1]];
        var max = scaled[idx[0]];
        var sum = 0;
        var probs = new Float32Array(V);
        for (i = 0; i < live(idx, scaled, cutoff, keep); i++) {
            j = idx[i];
            probs[j] = Math.exp(scaled[j] - max);
            sum += probs[j];
        }
        var r = (options.random || Math.random)() * sum;
        var acc = 0;
        for (i = 0; i < keep; i++) {
            j = idx[i];
            acc += probs[j];
            if (r <= acc) return j;
        }
        return idx[0];
    }

    /** Rend le tableau de tri « vivant » jusqu'à la coupure top-k. */
    function live(idx, scaled, cutoff, keep) {
        var n = 0;
        for (var i = 0; i < keep; i++) if (scaled[idx[i]] >= cutoff) n++;
        return n || 1;
    }

    /**
     * Génère une réponse complète.
     * @param {string} prompt demande (sans la balise de tâche)
     * @param {object} [options] {task, maxNewTokens, temperature, topK, repeatPenalty,
     *                            onToken, random, shouldStop}
     * @returns {string} réponse décodée
     */
    SoraxModel.prototype.generate = function (prompt, options) {
        var opts = options || {};
        var task = opts.task || 'code';
        var tags = {
            code: '<code>', edit: '<edit>', explain: '<explain>',
            fix: '<fix>', doc: '<doc>', chat: '<chat>'
        };
        var maxNew = opts.maxNewTokens || 160;
        var temperature = opts.temperature === undefined ? 0.7 : opts.temperature;
        var topK = opts.topK === undefined ? 40 : opts.topK;
        var repeatPenalty = opts.repeatPenalty === undefined ? 0.05 : opts.repeatPenalty;
        var random = opts.random || Math.random;

        this.reset();
        var encode = opts.greedy ? this.tokenizer.encodeGreedy.bind(this.tokenizer)
            : this.tokenizer.encode.bind(this.tokenizer);
        var ids = encode((tags[task] || '<code>') + prompt, true, false);
        var logits = null;
        var pos;
        for (pos = 0; pos < ids.length; pos++) logits = this.forwardToken(ids[pos], pos);

        var recent = {};
        var out = [];
        var text = '';
        for (var step = 0; step < maxNew; step++) {
            for (var tok in recent) {
                if (Object.prototype.hasOwnProperty.call(recent, tok)) {
                    logits[tok] -= repeatPenalty * recent[tok];
                }
            }
            var next = sample(logits, {
                temperature: temperature, topK: topK, random: random
            });
            if (next === 2) break;                       // <eos>
            var piece = this.tokenizer.decodeToken(next);
            out.push(next);
            text += piece;
            if (opts.onToken) opts.onToken(piece, text, step);
            if (opts.shouldStop && opts.shouldStop(text, step)) break;
            recent[next] = (recent[next] || 0) + 1;
            if (Object.keys(recent).length > 64) recent = {};
            logits = this.forwardToken(next, pos++);
        }
        return text;
    };

    /* ---------------------------- façade -------------------------------- */

    return {
        version: '1.0.0',
        author: 'Snowoo-',
        load: load,
        SoraxModel: SoraxModel,
        Tokenizer: Tokenizer,
        matvec: matvec,
        rmsnorm: rmsnorm,
        applyRope: applyRope,
        sample: sample,
        // constante utilitaire pour le texte injecté dans Scratch
        MAGIC: MAGIC
    };
}));
