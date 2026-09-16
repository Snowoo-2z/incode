"""Paliers de modèles, chemins et constantes partagées.

Tout ce qui doit rester identique entre Python (entraînement/export) et
JavaScript (inférence) est défini ici : ordre des tenseurs, jetons spéciaux,
format binaire, regex de découpage du tokenizer.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field, asdict
from typing import Dict, List

# --------------------------------------------------------------------------- #
# Chemins
# --------------------------------------------------------------------------- #

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))          # .../sorax
REPO = os.path.abspath(os.path.join(ROOT, '..'))          # racine du dépôt Git


class PATHS:
    """Chemins canoniques des artefacts générés."""

    ROOT = ROOT
    REPO = REPO
    ASSETS = os.path.join(ROOT, 'assets')
    GRAMMAR = os.path.join(ASSETS, 'grammar.json')
    TOKENIZER = os.path.join(ASSETS, 'tokenizer.json')
    CORPUS = os.path.join(ASSETS, 'corpus')
    CHECKPOINTS = os.path.join(ASSETS, 'checkpoints')
    EXPORT = os.path.join(ASSETS, 'export')
    DIST = os.path.join(REPO, 'dist_sorax')
    STATIC = os.path.join(REPO, 'static', 'sorax')
    NOTEBOOKS = os.path.join(ROOT, 'colab')

    @staticmethod
    def ensure(*paths: str) -> None:
        for p in paths:
            os.makedirs(p, exist_ok=True)


# --------------------------------------------------------------------------- #
# Tokenizer
# --------------------------------------------------------------------------- #

#: Jetons spéciaux — les identifiants 0..4 sont réservés, les octets occupent
#: 5..260 (octet ``b`` -> ``5 + b``), les fusions BPE démarrent à 261.
SPECIAL_TOKENS: List[str] = [
    '<pad>',        # 0
    '<bos>',        # 1
    '<eos>',        # 2
    '<user>',       # 3
    '<assistant>',  # 4
]
PAD_ID, BOS_ID, EOS_ID, USER_ID, ASSISTANT_ID = 0, 1, 2, 3, 4
BYTE_BASE = len(SPECIAL_TOKENS)          # 5
MERGE_BASE = BYTE_BASE + 256             # 261

#: Découpage identique en Python et en JavaScript (drapeau `u` côté JS).
CHUNK_REGEX = r"[0-9]+|[A-Za-z\u00C0-\u024F_][A-Za-z\u00C0-\u024F0-9_]*|[ \t\n\r]+|."

#: Balises de tâche : elles précèdent toujours la demande de l'utilisateur.
TASK_TAGS: Dict[str, str] = {
    'code': '<code>',
    'edit': '<edit>',
    'explain': '<explain>',
    'fix': '<fix>',
    'doc': '<doc>',
    'chat': '<chat>',
}
TASK_FROM_TAG = {v: k for k, v in TASK_TAGS.items()}


# --------------------------------------------------------------------------- #
# Paliers
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class ModelConfig:
    """Hyper-paramètres d'un palier de modèle.

    L'architecture est un transformer décodeur *pre-norm*, sans biais, à
    normalisation RMS et embeddings RoPE — choisie parce qu'elle se traduit en
    un très petit nombre de blocs Scratch (pas de moyenne, pas de biais, pas
    d'embedding positionnel appris).
    """

    name: str
    vocab_size: int = 384
    d_model: int = 64
    n_layers: int = 3
    n_heads: int = 4
    d_ff: int = 192
    max_seq_len: int = 192
    rope_theta: float = 10000.0
    rms_eps: float = 1e-5
    activation: str = 'silu'
    tie_embeddings: bool = True
    #: Palier exécutable en blocs Scratch purs (poids copiés dans des listes).
    scratch_runnable: bool = True
    #: Cible d'exécution (documentaire).
    target: str = 'Scratch / TurboWarp'

    @property
    def n_params(self) -> int:
        """Nombre de paramètres (hors fusions de tenseurs partagés)."""
        emb = self.vocab_size * self.d_model
        per_layer = (
            3 * self.d_model * self.d_model      # Wqkv
            + self.d_model * self.d_model        # Wo
            + 2 * self.d_model * self.d_ff       # W1 / W2
            + 2 * self.d_model                   # 2 x RMSNorm
        )
        head = 0 if self.tie_embeddings else self.vocab_size * self.d_model
        return emb + self.n_layers * per_layer + self.d_model + head

    @property
    def size_int8_mb(self) -> float:
        """Taille approximative des poids quantifiés (Mo)."""
        return self.n_params / (1024 * 1024)

    def to_dict(self) -> dict:
        return asdict(self)


CONFIGS: Dict[str, ModelConfig] = {
    # ---- Scratch pur -----------------------------------------------------
    'pico': ModelConfig(
        name='pico', d_model=48, n_layers=2, n_heads=4, d_ff=144,
        max_seq_len=128, target='Scratch vanilla (scratch.mit.edu)',
    ),
    'nano': ModelConfig(
        name='nano', d_model=64, n_layers=3, n_heads=4, d_ff=192,
        max_seq_len=384, target='Scratch / TurboWarp (palier par défaut)',
    ),
    # ---- TurboWarp + runtime JS -----------------------------------------
    'mini': ModelConfig(
        name='mini', d_model=256, n_layers=8, n_heads=8, d_ff=768,
        max_seq_len=384, scratch_runnable=False, target='TurboWarp (runtime JS)',
    ),
    'plus': ModelConfig(
        name='plus', d_model=384, n_layers=8, n_heads=12, d_ff=1152,
        max_seq_len=512, scratch_runnable=False, target='Navigateur (runtime JS)',
    ),
}


def get_config(name: str) -> ModelConfig:
    """Retourne un palier par son nom (``pico``, ``nano``, ``mini``, ``plus``)."""
    if name not in CONFIGS:
        raise KeyError(f"palier inconnu : {name!r} (choix : {', '.join(CONFIGS)})")
    return CONFIGS[name]


# --------------------------------------------------------------------------- #
# Génération
# --------------------------------------------------------------------------- #

DEFAULT_GEN = dict(
    temperature=0.7,
    top_k=40,
    repeat_penalty=1.05,
    max_new_tokens=160,
)
