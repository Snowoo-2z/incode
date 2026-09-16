"""Spécification unique des tenseurs de Sorax.

Ce module est **la** source de vérité du nommage et de l'ordre des tenseurs. Il
est utilisé par les trois implémentations (PyTorch sur Colab, NumPy en local,
JavaScript dans le runtime Scratch) : c'est ce qui garantit qu'un checkpoint
entraîné sur GPU s'exécute à l'identique dans le navigateur et dans Scratch.

Conventions
-----------
* tout est **sans biais** ;
* les matrices sont stockées en ``[sortie, entrée]`` : ``y = W @ x`` ;
* ``wqkv`` empile les trois projections dans une seule matrice ``[3E, E]``
  (une seule multiplication dans Scratch au lieu de trois) ;
* RMSNorm et RoPE remplacent LayerNorm et les embeddings positionnels appris :
  moins de paramètres, moins d'opérations, décodage plus simple côté Scratch ;
* les embeddings sont partagés avec la tête de sortie (poids liés).
"""

from __future__ import annotations

from typing import Dict, List, Tuple

import numpy as np

from .configs import ModelConfig


# --------------------------------------------------------------------------- #
# Noms de tenseurs
# --------------------------------------------------------------------------- #

def attn_norm(k: int) -> str:
    return f'layers.{k}.attn_norm'


def wqkv(k: int) -> str:
    return f'layers.{k}.wqkv'


def wqkv_scale(k: int) -> str:
    return f'layers.{k}.wqkv_scale'


def wo(k: int) -> str:
    return f'layers.{k}.wo'


def wo_scale(k: int) -> str:
    return f'layers.{k}.wo_scale'


def ffn_norm(k: int) -> str:
    return f'layers.{k}.ffn_norm'


def w1(k: int) -> str:
    return f'layers.{k}.w1'


def w1_scale(k: int) -> str:
    return f'layers.{k}.w1_scale'


def w2(k: int) -> str:
    return f'layers.{k}.w2'


def w2_scale(k: int) -> str:
    return f'layers.{k}.w2_scale'


FINAL_NORM = 'final_norm'
TOK_EMB = 'tok_emb'
TOK_EMB_SCALE = 'tok_emb_scale'


def tensor_layout(cfg: ModelConfig) -> List[Tuple[str, Tuple[int, ...], str]]:
    """Liste ordonnée ``(nom, forme, dtype)`` des tenseurs **stockés**.

    ``dtype`` vaut ``i8`` (poids quantifiés) ou ``f32`` (norms). Les facteurs
    d'échelle ne figurent pas ici : ils sont **dérivés** de la quantification et
    écrits juste après leur tenseur (`<nom>__scale`), ce qui empêche toute
    désynchronisation entre un poids et son échelle.
    """
    layout: List[Tuple[str, Tuple[int, ...], str]] = [
        (TOK_EMB, (cfg.vocab_size, cfg.d_model), 'i8'),
    ]
    for k in range(cfg.n_layers):
        layout += [
            (attn_norm(k), (cfg.d_model,), 'f32'),
            (wqkv(k), (3 * cfg.d_model, cfg.d_model), 'i8'),
            (wo(k), (cfg.d_model, cfg.d_model), 'i8'),
            (ffn_norm(k), (cfg.d_model,), 'f32'),
            (w1(k), (cfg.d_ff, cfg.d_model), 'i8'),
            (w2(k), (cfg.d_model, cfg.d_ff), 'i8'),
        ]
    layout.append((FINAL_NORM, (cfg.d_model,), 'f32'))
    return layout


def weight_names(cfg: ModelConfig) -> List[str]:
    """Noms des seuls tenseurs quantifiables (matrices int8)."""
    return [name for name, _shape, dtype in tensor_layout(cfg) if dtype == 'i8']


# --------------------------------------------------------------------------- #
# Initialisation
# --------------------------------------------------------------------------- #

def init_params(cfg: ModelConfig, seed: int = 0) -> Dict[str, np.ndarray]:
    """Initialisation des poids flottants (utilisée par les deux entraîneurs).

    Écart-type ``0.02`` pour les matrices, sortie de FFN atténuée par
    ``1/sqrt(2·n_layers)`` (recette GPT-2) pour éviter l'explosion des résidus.
    """
    rng = np.random.default_rng(seed)
    params: Dict[str, np.ndarray] = {}

    def normal(shape, std=0.02):
        return (rng.standard_normal(shape) * std).astype(np.float32)

    params[TOK_EMB] = normal((cfg.vocab_size, cfg.d_model))
    for k in range(cfg.n_layers):
        params[attn_norm(k)] = np.ones(cfg.d_model, dtype=np.float32)
        params[wqkv(k)] = normal((3 * cfg.d_model, cfg.d_model))
        params[wo(k)] = normal((cfg.d_model, cfg.d_model))
        params[ffn_norm(k)] = np.ones(cfg.d_model, dtype=np.float32)
        params[w1(k)] = normal((cfg.d_ff, cfg.d_model))
        params[w2(k)] = normal(
            (cfg.d_model, cfg.d_ff), 0.02 / np.sqrt(2 * cfg.n_layers)
        )
    params[FINAL_NORM] = np.ones(cfg.d_model, dtype=np.float32)
    return params


def param_count(params: Dict[str, np.ndarray]) -> int:
    """Nombre total de paramètres d'un dictionnaire de poids."""
    return int(sum(v.size for v in params.values()))


__all__ = [
    'tensor_layout', 'weight_names', 'init_params', 'param_count',
    'attn_norm', 'wqkv', 'wo', 'ffn_norm', 'w1', 'w2', 'wqkv_scale',
    'wo_scale', 'w1_scale', 'w2_scale', 'FINAL_NORM', 'TOK_EMB', 'TOK_EMB_SCALE',
]
