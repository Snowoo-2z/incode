"""Implémentation PyTorch de Sorax (entraînement sur GPU Colab T4).

Le modèle est volontairement « plat » : il n'utilise ni `nn.Linear` ni
`nn.RMSNorm`, seulement des tenseurs nommés exactement comme dans
`model_spec.py`. Un checkpoint PyTorch est donc directement transposable en
NumPy / int8 / JavaScript, sans étape de conversion qui pourrait dériver.

Équivalence vérifiée par `sorax/tests/test_parity_torch.py` :
mêmes logits, mêmes gradients que l'implémentation NumPy de référence.
"""

from __future__ import annotations

import math
import os
from typing import Dict, Optional, Tuple

import numpy as np
import torch
import torch.nn.functional as F

from .configs import ModelConfig
from .model_spec import (
    FINAL_NORM, TOK_EMB, attn_norm, ffn_norm, w1, w2, wo, wqkv,
)


def _rope_tables(seq_len: int, head_dim: int, theta: float, device, dtype) -> Tuple[torch.Tensor, torch.Tensor]:
    """Tables cos/sin de RoPE (appariement (2i, 2i+1), identique au runtime JS)."""
    half = head_dim // 2
    inv_freq = 1.0 / (theta ** (torch.arange(half, device=device, dtype=torch.float32) / half))
    pos = torch.arange(seq_len, device=device, dtype=torch.float32)
    angles = torch.outer(pos, inv_freq)
    return torch.cos(angles).to(dtype), torch.sin(angles).to(dtype)


def _apply_rope(x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
    x1, x2 = x[..., 0::2], x[..., 1::2]
    c, s = cos[:, None, :], sin[:, None, :]
    out = torch.empty_like(x)
    out[..., 0::2] = x1 * c - x2 * s
    out[..., 1::2] = x1 * s + x2 * c
    return out


class SoraxTorch(torch.nn.Module):
    """Transformer décodeur pre-norm, RMSNorm + RoPE, poids d'embedding liés."""

    def __init__(self, cfg: ModelConfig):
        super().__init__()
        self.cfg = cfg
        E, V, F = cfg.d_model, cfg.vocab_size, cfg.d_ff
        self.tok_emb = torch.nn.Parameter(torch.empty(V, E))
        layers = []
        for _ in range(cfg.n_layers):
            layers.append(torch.nn.ParameterDict({
                'attn_norm': torch.nn.Parameter(torch.ones(E)),
                'wqkv': torch.nn.Parameter(torch.empty(3 * E, E)),
                'wo': torch.nn.Parameter(torch.empty(E, E)),
                'ffn_norm': torch.nn.Parameter(torch.ones(E)),
                'w1': torch.nn.Parameter(torch.empty(F, E)),
                'w2': torch.nn.Parameter(torch.empty(E, F)),
            }))
        self.layers = torch.nn.ModuleList(layers)
        self.final_norm = torch.nn.Parameter(torch.ones(E))
        self.reset_parameters()

    def reset_parameters(self) -> None:
        """Même distribution que `model_spec.init_params` (NumPy)."""
        std_out = 0.02 / math.sqrt(2 * self.cfg.n_layers)
        with torch.no_grad():
            torch.nn.init.normal_(self.tok_emb, mean=0.0, std=0.02)
            for layer in self.layers:
                torch.nn.init.normal_(layer['wqkv'], mean=0.0, std=0.02)
                torch.nn.init.normal_(layer['wo'], mean=0.0, std=0.02)
                torch.nn.init.normal_(layer['w1'], mean=0.0, std=0.02)
                torch.nn.init.normal_(layer['w2'], mean=0.0, std=std_out)
                layer['attn_norm'].fill_(1.0)
                layer['ffn_norm'].fill_(1.0)
            self.final_norm.fill_(1.0)

    # ------------------------------------------------------------------ #
    # Poids
    # ------------------------------------------------------------------ #

    def load_from_numpy(self, params: Dict[str, np.ndarray]) -> None:
        """Charge un dictionnaire NumPy (mêmes noms que `model_spec`)."""
        with torch.no_grad():
            self.tok_emb.copy_(torch.tensor(params[TOK_EMB]))
            for k in range(self.cfg.n_layers):
                layer = self.layers[k]
                layer['attn_norm'].copy_(torch.tensor(params[attn_norm(k)]))
                layer['wqkv'].copy_(torch.tensor(params[wqkv(k)]))
                layer['wo'].copy_(torch.tensor(params[wo(k)]))
                layer['ffn_norm'].copy_(torch.tensor(params[ffn_norm(k)]))
                layer['w1'].copy_(torch.tensor(params[w1(k)]))
                layer['w2'].copy_(torch.tensor(params[w2(k)]))
            self.final_norm.copy_(torch.tensor(params[FINAL_NORM]))

    def to_numpy(self) -> Dict[str, np.ndarray]:
        """Exporte les poids en dictionnaire NumPy (float32)."""
        out: Dict[str, np.ndarray] = {
            TOK_EMB: self.tok_emb.detach().float().cpu().numpy().astype(np.float32),
            FINAL_NORM: self.final_norm.detach().float().cpu().numpy().astype(np.float32),
        }
        for k in range(self.cfg.n_layers):
            layer = self.layers[k]
            out[attn_norm(k)] = layer['attn_norm'].detach().float().cpu().numpy().astype(np.float32)
            out[wqkv(k)] = layer['wqkv'].detach().float().cpu().numpy().astype(np.float32)
            out[wo(k)] = layer['wo'].detach().float().cpu().numpy().astype(np.float32)
            out[ffn_norm(k)] = layer['ffn_norm'].detach().float().cpu().numpy().astype(np.float32)
            out[w1(k)] = layer['w1'].detach().float().cpu().numpy().astype(np.float32)
            out[w2(k)] = layer['w2'].detach().float().cpu().numpy().astype(np.float32)
        return out

    # ------------------------------------------------------------------ #
    # Forward
    # ------------------------------------------------------------------ #

    def forward(
        self, tokens: torch.Tensor, targets: Optional[torch.Tensor] = None
    ) -> Tuple[torch.Tensor, Optional[torch.Tensor]]:
        cfg = self.cfg
        B, T = tokens.shape
        E, H = cfg.d_model, cfg.n_heads
        dh = E // H
        cos, sin = _rope_tables(T, dh, cfg.rope_theta, tokens.device, torch.float32)

        x = self.tok_emb[tokens]
        for k in range(cfg.n_layers):
            layer = self.layers[k]
            n1 = x / torch.sqrt((x * x).mean(-1, keepdim=True) + cfg.rms_eps) * layer['attn_norm']
            qkv = n1 @ layer['wqkv'].T
            q, kk, v = torch.split(qkv, E, dim=-1)
            q = _apply_rope(q.reshape(B, T, H, dh), cos, sin)
            kk = _apply_rope(kk.reshape(B, T, H, dh), cos, sin)
            v = v.reshape(B, T, H, dh)
            scores = torch.einsum('bthd,bshd->bhts', q, kk) / math.sqrt(dh)
            mask = torch.triu(
                torch.ones(T, T, dtype=torch.bool, device=tokens.device), diagonal=1
            )
            scores = scores.masked_fill(mask[None, None], -1e9)  # même constante que le runtime JS
            attn = torch.softmax(scores, dim=-1)
            o = torch.einsum('bhts,bshd->bthd', attn, v).reshape(B, T, E)
            x = x + o @ layer['wo'].T

            n2 = x / torch.sqrt((x * x).mean(-1, keepdim=True) + cfg.rms_eps) * layer['ffn_norm']
            pre = n2 @ layer['w1'].T
            x = x + F.silu(pre) @ layer['w2'].T

        h = x / torch.sqrt((x * x).mean(-1, keepdim=True) + cfg.rms_eps) * self.final_norm
        logits = h @ self.tok_emb.T
        loss = None
        if targets is not None:
            loss = F.cross_entropy(logits.reshape(-1, cfg.vocab_size), targets.reshape(-1))
        return logits, loss

    # ------------------------------------------------------------------ #
    # Génération
    # ------------------------------------------------------------------ #

    @torch.no_grad()
    def generate(
        self,
        token_ids: list,
        max_new_tokens: int = 160,
        temperature: float = 0.7,
        top_k: int = 40,
        eos_id: int = 2,
        rng: Optional[np.random.Generator] = None,
    ) -> list:
        """Génération autoregressive simple (greedy si ``temperature == 0``)."""
        self.eval()
        rng = rng or np.random.default_rng()
        ids = list(token_ids)
        for _ in range(max_new_tokens):
            window = ids[-self.cfg.max_seq_len:]
            tokens = torch.tensor([window], dtype=torch.long)
            logits, _ = self(tokens)
            last = logits[0, -1].float().numpy()
            if temperature <= 0:
                nxt = int(np.argmax(last))
            else:
                logits_t = last / temperature
                if top_k:
                    keep = np.argsort(logits_t)[-top_k:]
                    mask = np.full_like(logits_t, -np.inf)
                    mask[keep] = logits_t[keep]
                    logits_t = mask
                probs = np.exp(logits_t - logits_t.max())
                probs /= probs.sum()
                nxt = int(rng.choice(len(probs), p=probs))
            ids.append(nxt)
            if nxt == eos_id:
                break
        return ids


def param_count(model: SoraxTorch) -> int:
    return sum(p.numel() for p in model.parameters())


def save_checkpoint(model: SoraxTorch, path: str, extra: Optional[dict] = None) -> None:
    """Sauvegarde un checkpoint `.npz` (poids en float32 + métadonnées)."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    arrays = model.to_numpy()
    arrays['__meta__'] = np.array(
        [str(extra or {'config': model.cfg.to_dict()})], dtype=object
    )
    np.savez_compressed(path, **arrays)


def load_checkpoint(path: str, cfg: ModelConfig) -> 'SoraxTorch':
    """Recharge un checkpoint `.npz` dans un modèle PyTorch."""
    data = np.load(path, allow_pickle=True)
    params = {k: data[k] for k in data.files if k != '__meta__'}
    model = SoraxTorch(cfg)
    model.load_from_numpy(params)
    return model


__all__ = ['SoraxTorch', 'save_checkpoint', 'load_checkpoint', 'param_count']
