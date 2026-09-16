"""Mise en forme des données : corpus JSONL -> flux de jetons prêt à entraîner.

Format d'un exemple (identique pour l'entraînement, l'évaluation et le runtime) :

    <bos> <code> prompt utilisateur <assistant> réponse <eos>

Seuls les jetons de la **réponse** contribuent à la perte : le modèle apprend à
produire du ScratchScript, pas à recopier la question. C'est ce qui rend un
modèle de quelques centaines de milliers de paramètres réellement utilisable.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Dict, Iterator, List, Optional, Sequence, Tuple

import numpy as np

from .configs import ASSISTANT_ID, BOS_ID, EOS_ID, TASK_TAGS
from .corpus import Sample
from .tokenizer import Tokenizer


@dataclass
class TokenStream:
    """Flux de jetons + masque de perte, sur lequel on échantillonne des fenêtres."""

    ids: np.ndarray          # int32
    loss_mask: np.ndarray    # bool — True là où la perte est calculée

    def __len__(self) -> int:
        return int(self.ids.size)

    def batch(
        self, batch_size: int, seq_len: int, rng: np.random.Generator, offset: int = 0
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Tire un lot de fenêtres aléatoires (x, y) avec ``y = -100`` hors réponse."""
        n = len(self)
        if n <= seq_len + 1:
            raise ValueError('flux de jetons trop court pour cette longueur de séquence')
        starts = rng.integers(0, n - seq_len - 1, size=batch_size)
        x = np.stack([self.ids[s:s + seq_len] for s in starts]).astype(np.int64)
        y = np.stack([self.ids[s + 1:s + seq_len + 1] for s in starts]).astype(np.int64)
        mask = np.stack([self.loss_mask[s + 1:s + seq_len + 1] for s in starts])
        y = np.where(mask, y, -100)
        return x, y


def read_samples(paths: Sequence[str], limit: Optional[int] = None) -> List[Sample]:
    """Lit un ou plusieurs fichiers JSONL d'échantillons."""
    out: List[Sample] = []
    for path in paths:
        if not os.path.exists(path):
            continue
        with open(path, 'r', encoding='utf-8') as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                out.append(Sample.from_json(line))
                if limit and len(out) >= limit:
                    return out
    return out


def encode_sample(
    tokenizer: Tokenizer,
    sample: Sample,
    mode: str = 'bpe',
) -> Tuple[List[int], List[bool]]:
    """Encode un échantillon en jetons + masque de perte (réponse seulement).

    :param mode: ``'bpe'`` (encodage appris) ou ``'greedy'`` (appariement
        glouton, celui du moteur Scratch). Les deux produisent les **mêmes
        octets** : seule la segmentation change. On mélange les deux modes à
        l'entraînement pour que le modèle soit indifférent à la méthode
        d'encodage — c'est ce qui rend le mode 100 % Scratch aussi bon que le
        mode navigateur.
    """
    encode = tokenizer.encode_greedy if mode == 'greedy' else tokenizer.encode
    tag = TASK_TAGS.get(sample.task, '<chat>')
    head = encode(tag + sample.prompt, add_bos=True)
    answer = encode(sample.answer, add_eos=True)
    ids = head + [ASSISTANT_ID] + answer
    mask = [False] * (len(head) + 1) + [True] * len(answer)
    return ids, mask


def build_stream(
    samples: Sequence[Sample],
    tokenizer: Tokenizer,
    max_seq_len: int = 256,
    max_answer_tokens: Optional[int] = None,
    greedy_ratio: float = 0.35,
    seed: int = 0,
) -> Tuple[TokenStream, Dict[str, int]]:
    """Construit le flux de jetons (les exemples trop longs sont tronqués).

    :param max_answer_tokens: tronque la réponse (protège le budget de contexte)
    :returns: (flux, statistiques)
    """
    ids: List[int] = []
    mask: List[bool] = []
    rng = np.random.default_rng(seed)
    stats = {'exemples': 0, 'jetons': 0, 'jetons_reponse': 0, 'tronques': 0,
             'ignores': 0, 'glouton': 0}
    for sample in samples:
        if sample.task in ('doc', 'chat'):
            budget = 128
        else:
            budget = max_seq_len
        mode = 'greedy' if rng.random() < greedy_ratio else 'bpe'
        if mode == 'greedy':
            stats['glouton'] += 1
        s_ids, s_mask = encode_sample(tokenizer, sample, mode=mode)
        if budget and len(s_ids) > budget:
            # on tronque la *réponse* d'abord : la consigne reste entière
            answer_len = sum(1 for m in s_mask if m)
            if answer_len >= budget - 8:
                stats['tronques'] += 1
                keep = budget
                s_ids, s_mask = s_ids[:keep], s_mask[:keep]
                s_ids[-1] = EOS_ID
                s_mask[-1] = True
            else:
                stats['ignores'] += 1
                continue
        ids.extend(s_ids)
        mask.extend(s_mask)
        stats['exemples'] += 1
        stats['jetons'] += len(s_ids)
        stats['jetons_reponse'] += sum(1 for m in s_mask if m)
    return TokenStream(np.array(ids, dtype=np.int32), np.array(mask, dtype=bool)), stats


def truncate_answer(tokenizer: Tokenizer, sample: Sample, max_seq_len: int) -> List[int]:
    """Version courte d'un exemple (utile aux métriques d'évaluation)."""
    ids, _ = encode_sample(tokenizer, sample)
    return ids[:max_seq_len]


def stream_from_jsonl(
    directory: str, tokenizer: Tokenizer, max_seq_len: int = 256, limit: Optional[int] = None
) -> Tuple[TokenStream, Dict[str, int]]:
    """Raccourci : dossier de corpus -> flux de jetons d'entraînement."""
    samples = read_samples([os.path.join(directory, 'train.jsonl')], limit=limit)
    if not samples:
        raise FileNotFoundError(f'aucun échantillon dans {directory}/train.jsonl')
    return build_stream(samples, tokenizer, max_seq_len=max_seq_len)


def save_json(path: str, payload: dict) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)


__all__ = [
    'TokenStream', 'read_samples', 'encode_sample', 'build_stream', 'stream_from_jsonl',
    'save_json', 'truncate_answer',
]
