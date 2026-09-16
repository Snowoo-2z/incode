"""Implémentation NumPy de référence de Sorax : forward, cache et backward.

Elle sert à trois choses :

1. **entraîner** un petit palier sans GPU (le palier *demo* local) ;
2. **vérifier** le runtime JavaScript : le test de parité compare les logits
   NumPy et les logits JS sur le même checkpoint quantifié ;
3. **documenter** la sémantique exacte de chaque opération, y compris
   l'arithmétique int8 du runtime (voir `quantize.matvec_int8`).

Aucune dépendance au framework : uniquement NumPy, pour que la même référence
puisse tourner partout (Colab, CI, machine locale).
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import numpy as np

from .configs import ModelConfig
from .model_spec import (
    FINAL_NORM, TOK_EMB, attn_norm, ffn_norm, w1, w2, wo, wqkv,
)


# --------------------------------------------------------------------------- #
# Opérations de base (partagées avec le runtime JS dans leur définition)
# --------------------------------------------------------------------------- #

def rmsnorm(x: np.ndarray, weight: np.ndarray, eps: float) -> np.ndarray:
    """RMSNorm : ``x / sqrt(moyenne(x²) + eps) * poids`` (pas de moyenne retirée)."""
    scale = 1.0 / np.sqrt(np.mean(x * x, axis=-1, keepdims=True) + eps)
    return x * scale * weight


def silu(x: np.ndarray) -> np.ndarray:
    """SiLU / swish : ``x * sigmoid(x)``."""
    return x / (1.0 + np.exp(-x))


def softmax(x: np.ndarray, axis: int = -1) -> np.ndarray:
    """Softmax numériquement stable."""
    z = x - np.max(x, axis=axis, keepdims=True)
    e = np.exp(z)
    return e / np.sum(e, axis=axis, keepdims=True)


def rope_cache(seq_len: int, head_dim: int, theta: float) -> Tuple[np.ndarray, np.ndarray]:
    """Cosinus/sinus de RoPE pour les paires (2i, 2i+1) de chaque tête.

    Convention retenue (identique dans le runtime JS et dans PyTorch) :
    les dimensions sont appariées **deux à deux**, ``x[2i]`` tourne avec ``x[2i+1]``.
    """
    half = head_dim // 2
    inv_freq = 1.0 / (theta ** (np.arange(half, dtype=np.float32) / half))
    pos = np.arange(seq_len, dtype=np.float32)
    angles = np.outer(pos, inv_freq)               # (T, half)
    return np.cos(angles).astype(np.float32), np.sin(angles).astype(np.float32)


def apply_rope(x: np.ndarray, cos: np.ndarray, sin: np.ndarray) -> np.ndarray:
    """Applique RoPE à ``x`` de forme ``(..., T, H, dh)``."""
    x1 = x[..., 0::2]
    x2 = x[..., 1::2]
    c = cos[:, None, :]           # (T, 1, half)
    s = sin[:, None, :]
    out = np.empty_like(x)
    out[..., 0::2] = x1 * c - x2 * s
    out[..., 1::2] = x1 * s + x2 * c
    return out


# --------------------------------------------------------------------------- #
# Modèle
# --------------------------------------------------------------------------- #

class NumpySorax:
    """Transformer décodeur minimal (pre-norm, RMSNorm, RoPE, poids liés)."""

    def __init__(self, cfg: ModelConfig, params: Dict[str, np.ndarray]):
        self.cfg = cfg
        self.p = params

    # ------------------------------------------------------------------ #
    # Forward
    # ------------------------------------------------------------------ #

    def forward(
        self,
        tokens: np.ndarray,
        targets: Optional[np.ndarray] = None,
        cache: Optional[List[dict]] = None,
    ) -> Tuple[np.ndarray, Optional[float], dict]:
        """Passe avant complet.

        :param tokens: ``(B, T)`` identifiants d'entrée
        :param targets: ``(B, T)`` cibles pour la perte (optionnel)
        :param cache: cache KV (liste de dicts ``{'k': .., 'v': ..}``) pour le
            décodage incrémental ; il est **muté** et renvoyé dans le résultat.
        :returns: ``(logits (B, T, V), perte ou None, caches)``
        """
        cfg = self.cfg
        p = self.p
        B, T = tokens.shape
        E, H = cfg.d_model, cfg.n_heads
        dh = E // H

        # Position de départ : longueur déjà en cache (décodage incrémental)
        pos_offset = 0 if not cache else cache[0]['k'].shape[1]
        cos, sin = rope_cache(pos_offset + T, dh, cfg.rope_theta)
        cos = cos[pos_offset:pos_offset + T]
        sin = sin[pos_offset:pos_offset + T]

        x = p[TOK_EMB][tokens]                      # (B, T, E)
        new_cache: List[dict] = []
        for k in range(cfg.n_layers):
            if cache is not None and k < len(cache):
                layer_cache = cache[k]
            else:
                layer_cache = {'k': None, 'v': None}

            h = rmsnorm(x, p[attn_norm(k)], cfg.rms_eps)
            qkv = h @ p[wqkv(k)].T                  # (B, T, 3E)
            q, kk, v = np.split(qkv, 3, axis=-1)
            q = q.reshape(B, T, H, dh)
            kk = kk.reshape(B, T, H, dh)
            v = v.reshape(B, T, H, dh)
            q = apply_rope(q, cos, sin)
            kk = apply_rope(kk, cos, sin)

            if layer_cache['k'] is not None:
                kk = np.concatenate([layer_cache['k'], kk], axis=1)
                v = np.concatenate([layer_cache['v'], v], axis=1)
            Tk = kk.shape[1]

            # scores (B, H, T, Tk) + masque causal (une requête ne voit jamais
            # une clé située après elle, y compris avec un cache KV).
            scores = np.einsum('bthd,bshd->bhts', q, kk) / np.sqrt(dh)
            q_pos = pos_offset + np.arange(T)
            k_pos = np.arange(Tk)
            causal = k_pos[None, :] > q_pos[:, None]      # (T, Tk)
            scores = np.where(causal[None, None], -1e9, scores)
            attn = softmax(scores, axis=-1)
            out = np.einsum('bhts,bshd->bthd', attn, v).reshape(B, T, E)
            x = x + out @ p[wo(k)].T

            h2 = rmsnorm(x, p[ffn_norm(k)], cfg.rms_eps)
            x = x + silu(h2 @ p[w1(k)].T) @ p[w2(k)].T

            new_cache.append({'k': kk, 'v': v})

        h = rmsnorm(x, p[FINAL_NORM], cfg.rms_eps)
        logits = h @ p[TOK_EMB].T                   # (B, T, V) — poids liés

        loss = None
        if targets is not None:
            logits_flat = logits.reshape(-1, cfg.vocab_size)
            tgt_flat = targets.reshape(-1)
            logits_flat = logits_flat - logits_flat.max(axis=-1, keepdims=True)
            log_probs = logits_flat - np.log(np.exp(logits_flat).sum(axis=-1, keepdims=True))
            loss = float(-log_probs[np.arange(tgt_flat.size), tgt_flat].mean())

        return logits, loss, new_cache

    # ------------------------------------------------------------------ #
    # Backward (utilisé par l'entraîneur NumPy local)
    # ------------------------------------------------------------------ #

    def loss_and_grads(
        self, tokens: np.ndarray, targets: np.ndarray, loss_mask: Optional[np.ndarray] = None
    ) -> Tuple[float, Dict[str, np.ndarray]]:
        """Perte + gradients pour un lot ``(B, T)`` (backprop manuelle).

        :param loss_mask: masque booléen ``(B, T)`` ; les positions à ``False``
            ne contribuent ni à la perte ni aux gradients (c'est ainsi qu'on
            n'entraîne le modèle que sur la *réponse*, pas sur la consigne).

        Cette implémentation est volontairement directe : elle privilégie la
        lisibilité et l'exactitude plutôt que la vitesse. Le vrai entraînement
        long se fait avec PyTorch (voir `model_torch.py`).
        """
        cfg = self.cfg
        p = self.p
        B, T = tokens.shape
        E, H = cfg.d_model, cfg.n_heads
        dh = E // H
        V = cfg.vocab_size
        cache: List[dict] = []
        acts: List[dict] = []

        cos, sin = rope_cache(T, dh, cfg.rope_theta)

        x = p[TOK_EMB][tokens]
        for k in range(cfg.n_layers):
            x_in = x                                      # entrée de la couche
            n1 = rmsnorm(x, p[attn_norm(k)], cfg.rms_eps)
            qkv = n1 @ p[wqkv(k)].T
            q, kk, v = np.split(qkv, 3, axis=-1)
            q = apply_rope(q.reshape(B, T, H, dh), cos, sin)
            kk_r = apply_rope(kk.reshape(B, T, H, dh), cos, sin)
            v_r = v.reshape(B, T, H, dh)
            scores = np.einsum('bthd,bshd->bhts', q, kk_r) / np.sqrt(dh)
            mask = np.triu(np.ones((T, T), dtype=bool), k=1)
            scores = np.where(mask[None, None], -1e9, scores)
            attn = softmax(scores, axis=-1)
            o = np.einsum('bhts,bshd->bthd', attn, v_r).reshape(B, T, E)
            x_mid = x + o @ p[wo(k)].T
            n2 = rmsnorm(x_mid, p[ffn_norm(k)], cfg.rms_eps)
            pre = n2 @ p[w1(k)].T
            act = silu(pre)
            x = x_mid + act @ p[w2(k)].T
            acts.append(dict(x_in=x_in, n1=n1, q=q, k=kk_r, v=v_r, attn=attn,
                             o=o, x_mid=x_mid, n2=n2, pre=pre, act=act))
            cache.append({})

        final = rmsnorm(x, p[FINAL_NORM], cfg.rms_eps)
        logits = final @ p[TOK_EMB].T

        # ---- perte et gradient des logits --------------------------------
        flat = logits.reshape(-1, V)
        tgt = targets.reshape(-1)
        flat = flat - flat.max(axis=-1, keepdims=True)
        exp = np.exp(flat)
        denom = exp.sum(axis=-1, keepdims=True)
        probs = exp / denom
        n = tgt.size
        rows = np.arange(n)
        valid = None
        if loss_mask is not None:
            valid = loss_mask.reshape(-1).astype(bool)
            if not valid.any():
                valid = np.ones_like(valid)
        picked = np.clip(probs[rows, np.clip(tgt, 0, V - 1)], 1e-9, None)
        if valid is None:
            loss = float(-np.log(picked).mean())
            dlogits = probs.copy()
            dlogits[rows, tgt] -= 1.0
            dlogits /= n
        else:
            n_valid = float(valid.sum())
            loss = float(-np.log(picked[valid]).sum() / n_valid)
            dlogits = np.zeros_like(probs)
            dlogits[rows] = probs
            dlogits[rows, tgt] -= 1.0
            dlogits *= valid[:, None] / n_valid
        dlogits = dlogits.reshape(B, T, V)

        grads: Dict[str, np.ndarray] = {name: np.zeros_like(val) for name, val in p.items()}

        # ---- tête liée ---------------------------------------------------
        grads[TOK_EMB] += np.einsum('btv,btd->vd', dlogits, final)
        dfinal = dlogits @ p[TOK_EMB]                       # (B, T, E)

        # ---- norme finale ------------------------------------------------
        dx = _rmsnorm_backward(dfinal, final, x, p[FINAL_NORM], cfg.rms_eps,
                               grads, FINAL_NORM)

        # ---- couches -----------------------------------------------------
        for k in range(cfg.n_layers - 1, -1, -1):
            a = acts[k]
            # FFN
            grads[w2(k)] += np.einsum('bte,btf->ef', dx, a['act'])
            dact = dx @ p[w2(k)]
            dpre = dact * _silu_grad(a['pre'])
            grads[w1(k)] += np.einsum('btf,bte->fe', dpre, a['n2'])
            dn2 = dpre @ p[w1(k)]
            dx_mid = dx + _rmsnorm_backward(
                dn2, a['n2'], a['x_mid'], p[ffn_norm(k)], cfg.rms_eps, grads, ffn_norm(k)
            )
            # Attention
            grads[wo(k)] += np.einsum('bte,btd->ed', dx_mid, a['o'])
            do = dx_mid @ p[wo(k)]                           # (B,T,E)
            do = do.reshape(B, T, H, dh)
            # grad sur attn et v
            dattn = np.einsum('bthd,bshd->bhts', do, a['v'])
            dv = np.einsum('bhts,bthd->bshd', a['attn'], do)
            dscores = a['attn'] * (dattn - np.sum(dattn * a['attn'], axis=-1, keepdims=True))
            dscores = dscores / np.sqrt(dh)
            dscores = np.where(mask[None, None], 0.0, dscores)
            dq = np.einsum('bhts,bshd->bthd', dscores, a['k'])
            dk = np.einsum('bhts,bthd->bshd', dscores, a['q'])
            dq, dk = _rope_backward(dq, cos, sin), _rope_backward(dk, cos, sin)
            # IMPORTANT : le forward empile [Q | K | V] par blocs de E dimensions.
            # Il faut donc replier l'axe des têtes de chaque bloc *avant* de les
            # concaténer — concaténer puis replier entrelacerait les têtes.
            dqkv = np.concatenate(
                [dq.reshape(B, T, E), dk.reshape(B, T, E), dv.reshape(B, T, E)], axis=-1
            )
            grads[wqkv(k)] += np.einsum('bto,bte->oe', dqkv, a['n1'])
            dn1 = dqkv @ p[wqkv(k)]
            dx = dx_mid + _rmsnorm_backward(
                dn1, a['n1'], a['x_in'], p[attn_norm(k)], cfg.rms_eps, grads, attn_norm(k)
            )

        # ---- embeddings (tokens) ----------------------------------------
        np.add.at(grads[TOK_EMB], tokens.reshape(-1), dx.reshape(-1, E))

        return loss, grads


def _silu_grad(pre: np.ndarray) -> np.ndarray:
    """Dérivée de SiLU : ``sigmoid(x) * (1 + x * (1 - sigmoid(x)))``."""
    sig = 1.0 / (1.0 + np.exp(-pre))
    return sig * (1.0 + pre * (1.0 - sig))


def _rmsnorm_backward(
    dout: np.ndarray,
    normed: np.ndarray,
    x: np.ndarray,
    weight: np.ndarray,
    eps: float,
    grads: Dict[str, np.ndarray],
    weight_name: str,
) -> np.ndarray:
    """Gradient de RMSNorm par rapport à l'entrée (et cumul sur le poids)."""
    E = x.shape[-1]
    ms = np.mean(x * x, axis=-1, keepdims=True) + eps
    inv = 1.0 / np.sqrt(ms)
    grads[weight_name] += (dout * normed / weight).sum(axis=(0, 1))
    dx = dout * weight
    # d(x * inv) = dout*w*inv - x * inv^3 * moyenne(dout*w*x)
    dot = np.sum(dx * x, axis=-1, keepdims=True) / E
    return dx * inv - x * (inv ** 3) * dot


def _rope_backward(x: np.ndarray, cos: np.ndarray, sin: np.ndarray) -> np.ndarray:
    """Transposée de la rotation RoPE."""
    x1 = x[..., 0::2]
    x2 = x[..., 1::2]
    c = cos[:, None, :]
    s = sin[:, None, :]
    out = np.empty_like(x)
    out[..., 0::2] = x1 * c + x2 * s
    out[..., 1::2] = -x1 * s + x2 * c
    return out


__all__ = [
    'NumpySorax', 'rmsnorm', 'silu', 'softmax', 'rope_cache', 'apply_rope',
]
