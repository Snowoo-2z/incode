"""Forward **quantifié** de référence : le jumeau Python du runtime JavaScript.

Ce module exécute Sorax comme le fera le moteur Scratch/JS : poids int8, une
échelle par neurone, activations quantifiées dynamiquement, produits scalaires
en entiers. C'est :

* la **référence** avec laquelle le runtime JS est comparé
  (`tools/check_runtime_parity.mjs`) ;
* la **spécification exécutable** du pseudo-code Scratch
  (`docs/03_SCRATCH_RUNTIME.md`) ;
* l'outil pour mesurer la perte de qualité due à la quantification.

Règle d'or : toute opération listée ici doit exister à l'identique dans
`sorax/runtime/sorax-runtime.js`, dans le même ordre.
"""

from __future__ import annotations

import math
from typing import Dict, List, Optional, Tuple

import numpy as np

from .configs import EOS_ID, ModelConfig
from .model_spec import FINAL_NORM, TOK_EMB, attn_norm, ffn_norm, w1, w2, wo, wqkv
from .quantize import ACT_SCALE_FLOOR, SCALE_FLOOR


# --------------------------------------------------------------------------- #
# Opérations élémentaires (miroir exact du runtime JS)
# --------------------------------------------------------------------------- #

def rms_scale(x: np.ndarray, eps: float) -> float:
    """``1 / sqrt(moyenne(x²) + eps)`` — une seule valeur par vecteur."""
    ms = float(np.mean(x.astype(np.float64) ** 2))
    return 1.0 / math.sqrt(ms + eps)


def quantize_vec(x: np.ndarray) -> Tuple[np.ndarray, float]:
    """Quantifie un vecteur en int8 avec une échelle unique (comme le JS)."""
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    scale = peak / 127.0 if peak > ACT_SCALE_FLOOR else ACT_SCALE_FLOOR
    q = np.clip(np.rint(x / scale), -127, 127).astype(np.int32)
    return q, scale


def matvec(wq: np.ndarray, w_scales: np.ndarray, x: np.ndarray) -> np.ndarray:
    """``W(int8) · x`` : quantifie x, accumule en entiers, remet à l'échelle."""
    xq, sx = quantize_vec(x)
    acc = wq.astype(np.int32) @ xq
    return acc.astype(np.float32) * (w_scales * np.float32(sx))


def silu(x: np.ndarray) -> np.ndarray:
    return x / (1.0 + np.exp(-x))


def softmax(x: np.ndarray) -> np.ndarray:
    z = x - np.max(x)
    e = np.exp(z)
    return e / np.sum(e)


def rope_tables(seq_len: int, head_dim: int, theta: float) -> Tuple[List[float], List[float]]:
    """Tables cos/sin par position (paires (2i, 2i+1))."""
    half = head_dim // 2
    inv = [1.0 / (theta ** (i / half)) for i in range(half)]
    cos_t, sin_t = [], []
    for pos in range(seq_len):
        cos_t.append([math.cos(pos * f) for f in inv])
        sin_t.append([math.sin(pos * f) for f in inv])
    return cos_t, sin_t


# --------------------------------------------------------------------------- #
# Modèle quantifié
# --------------------------------------------------------------------------- #

class QuantizedSorax:
    """Sorax exécuté sur des poids int8 (jumeau Python du runtime JS)."""

    def __init__(self, cfg: ModelConfig, tensors: Dict[str, np.ndarray]):
        self.cfg = cfg
        self.t = tensors
        self._rope_cos, self._rope_sin = rope_tables(
            cfg.max_seq_len + 8, cfg.d_model // cfg.n_heads, cfg.rope_theta
        )
        for name in (TOK_EMB, FINAL_NORM, attn_norm(0), ffn_norm(0), wqkv(0), wo(0), w1(0), w2(0)):
            if name not in tensors:
                raise KeyError(f'tenseur manquant : {name}')

    # ------------------------------------------------------------------ #

    def _w(self, name: str) -> Tuple[np.ndarray, np.ndarray]:
        return self.t[name], self.t[f'{name}__scale']

    def _norm(self, h: np.ndarray, weight: np.ndarray, eps: float) -> np.ndarray:
        s = rms_scale(h, eps)
        return h * np.float32(s) * weight

    def _attn(self, h: np.ndarray, layer: int, pos: int,
              cache: List[dict]) -> np.ndarray:
        """Attention d'une position, avec cache KV (décodage incrémental)."""
        cfg = self.cfg
        E, H = cfg.d_model, cfg.n_heads
        dh = E // H
        w_qkv, s_qkv = self._w(wqkv(layer))
        qkv = matvec(w_qkv, s_qkv, h)                # [3E]

        q = np.empty(E, dtype=np.float32)
        k = np.empty(E, dtype=np.float32)
        v = np.empty(E, dtype=np.float32)
        q[:] = qkv[:E]
        k[:] = qkv[E:2 * E]
        v[:] = qkv[2 * E:]

        cos, sin = self._rope_cos[pos], self._rope_sin[pos]
        q = _rope_apply(q, cos, sin, H, dh)
        k = _rope_apply(k, cos, sin, H, dh)

        cache[layer]['k'].append(k)
        cache[layer]['v'].append(v)
        keys = np.stack(cache[layer]['k'])
        vals = np.stack(cache[layer]['v'])
        n_pos = keys.shape[0]

        out = np.zeros(E, dtype=np.float32)
        inv_sqrt = 1.0 / math.sqrt(dh)
        for head in range(H):
            qh = q[head * dh:(head + 1) * dh]
            scores = np.empty(n_pos, dtype=np.float32)
            for j in range(n_pos):
                kh = keys[j][head * dh:(head + 1) * dh]
                scores[j] = float(np.dot(qh.astype(np.float64), kh.astype(np.float64))) * inv_sqrt
            weights = softmax(scores)
            acc = np.zeros(dh, dtype=np.float32)
            for j in range(n_pos):
                acc += weights[j] * vals[j][head * dh:(head + 1) * dh]
            out[head * dh:(head + 1) * dh] = acc

        w_o, s_o = self._w(wo(layer))
        return matvec(w_o, s_o, out)

    def forward_token(self, token: int, pos: int, cache: List[dict]) -> np.ndarray:
        """Un pas de décodage : renvoie les logits (float32) de la position."""
        cfg = self.cfg
        E = cfg.d_model
        emb, emb_scale = self._w(TOK_EMB)
        h = emb[token].astype(np.float32) * emb_scale[token]

        for layer in range(cfg.n_layers):
            n1 = self._norm(h, self.t[attn_norm(layer)], cfg.rms_eps)
            h = h + self._attn(n1, layer, pos, cache)

            n2 = self._norm(h, self.t[ffn_norm(layer)], cfg.rms_eps)
            w1m, w1s = self._w(w1(layer))
            w2m, w2s = self._w(w2(layer))
            pre = matvec(w1m, w1s, n2)
            h = h + matvec(w2m, w2s, silu(pre).astype(np.float32))

        h = self._norm(h, self.t[FINAL_NORM], cfg.rms_eps)
        logits = matvec(emb, emb_scale, h.astype(np.float32))
        return logits

    # ------------------------------------------------------------------ #

    def new_cache(self) -> List[dict]:
        return [{'k': [], 'v': []} for _ in range(self.cfg.n_layers)]

    def logits_for(self, tokens: List[int]) -> np.ndarray:
        """Logits de la dernière position d'une séquence complète (test/éval)."""
        cache = self.new_cache()
        logits = None
        for pos, tok in enumerate(tokens):
            logits = self.forward_token(tok, pos, cache)
        return logits

    def generate(
        self,
        tokenizer,
        prompt: str,
        task: str = 'code',
        max_new_tokens: int = 160,
        temperature: float = 0.7,
        top_k: int = 40,
        repeat_penalty: float = 1.05,
        seed: int = 0,
    ) -> str:
        """Génère une réponse complète (mêmes réglages que le runtime JS)."""
        from .configs import TASK_TAGS
        ids = (tokenizer.encode(TASK_TAGS.get(task, '<code>') + prompt, add_bos=True))
        rng = np.random.default_rng(seed)
        cache = self.new_cache()
        out_ids: List[int] = []
        recent: Dict[int, int] = {}
        for step, tok in enumerate(ids):
            logits = self.forward_token(tok, step, cache)
        pos = len(ids)
        for _ in range(max_new_tokens):
            # pénalité de répétition sur la fenêtre récente
            for tok_id, count in recent.items():
                logits[tok_id] -= repeat_penalty * count
            if temperature <= 0:
                nxt = int(np.argmax(logits))
            else:
                z = logits.astype(np.float64) / temperature
                if top_k:
                    keep = np.argsort(z)[-top_k:]
                    masked = np.full_like(z, -1e30)
                    masked[keep] = z[keep]
                    z = masked
                z -= z.max()
                p = np.exp(z)
                p /= p.sum()
                nxt = int(rng.choice(len(p), p=p))
            if nxt == EOS_ID:
                break
            out_ids.append(nxt)
            recent = {k: v for k, v in recent.items() if k != nxt}
            recent[nxt] = min(3, recent.get(nxt, 0) + 1)
            if len(out_ids) >= 12:
                recent.pop(out_ids[-12], None)
            logits = self.forward_token(nxt, pos, cache)
            pos += 1
        return tokenizer.decode(out_ids)


def _rope_apply(vec: np.ndarray, cos: List[float], sin: List[float], heads: int, dh: int) -> np.ndarray:
    """Applique RoPE tête par tête, en appariant (2i, 2i+1)."""
    out = vec.copy()
    for head in range(heads):
        base = head * dh
        for i in range(dh // 2):
            a = vec[base + 2 * i]
            b = vec[base + 2 * i + 1]
            c = cos[i]
            s = sin[i]
            out[base + 2 * i] = a * c - b * s
            out[base + 2 * i + 1] = a * s + b * c
    return out


__all__ = ['QuantizedSorax', 'matvec', 'quantize_vec', 'rms_scale', 'rope_tables']
