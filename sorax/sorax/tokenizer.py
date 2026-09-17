"""Tokenizer BPE au niveau octet, partagé à l'identique avec le runtime JS.

Pourquoi un BPE au niveau octet ?

* **Aucun jeton inconnu** : n'importe quelle chaîne (emoji, accent, faute de
  frappe) se décompose en octets. Sorax ne peut donc jamais échouer sur une
  entrée imprévue.
* **Vocabulaire minuscule** : 256 octets + quelques centaines de fusions. Le
  projecteur de sortie (``vocab × d_model``) est le poste de calcul le plus
  lourd dans Scratch ; le garder petit est essentiel.
* **Décodage trivial côté Scratch** : un jeton n'est qu'une *liste d'octets*,
  obtenue en remontant l'arbre des fusions (voir `sorax/runtime/`).

Le fichier `tokenizer.json` est **la** référence : le même fichier est lu par
Python (entraînement) et par JavaScript (inférence).
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter
from typing import Dict, Iterable, List, Sequence, Tuple

from .configs import (
    ASSISTANT_ID,
    BOS_ID,
    BYTE_BASE,
    CHUNK_REGEX,
    EOS_ID,
    MERGE_BASE,
    PAD_ID,
    SPECIAL_TOKENS,
    USER_ID,
)

_CHUNK_RE = re.compile(CHUNK_REGEX)


def to_bytes(text: str) -> List[int]:
    """Chaîne -> octets UTF-8 (liste d'entiers)."""
    return list(text.encode('utf-8'))


def from_bytes(data: Iterable[int]) -> str:
    """Octets UTF-8 -> chaîne (les séquences invalides sont remplacées)."""
    return bytes(bytearray(b & 0xFF for b in data)).decode('utf-8', errors='replace')


class Tokenizer:
    """Tokenizer BPE octet minimaliste, sérialisable en JSON."""

    def __init__(self, merges: Sequence[Sequence[int]] | None = None):
        self.merges: List[Tuple[int, int]] = [tuple(m) for m in (merges or [])]
        #: jeton -> octets (calculé paresseusement, mis en cache)
        self._id_to_bytes: Dict[int, bytes] = {}
        self._rank: Dict[Tuple[int, int], int] = {
            pair: i for i, pair in enumerate(self.merges)
        }
        self._rebuild_cache()

    # ------------------------------------------------------------------ #
    # Sérialisation
    # ------------------------------------------------------------------ #

    @property
    def vocab_size(self) -> int:
        """Taille totale du vocabulaire (spéciaux + octets + fusions)."""
        return MERGE_BASE + len(self.merges)

    def to_dict(self) -> dict:
        return {
            'version': 1,
            'specials': SPECIAL_TOKENS,
            'byte_base': BYTE_BASE,
            'merge_base': MERGE_BASE,
            'merges': [[a, b] for a, b in self.merges],
            'vocab_size': self.vocab_size,
        }

    def save(self, path: str) -> None:
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(self.to_dict(), fh, ensure_ascii=False, separators=(',', ':'))
        # Un doublon « compact » décodable en latin-1 est plus pratique pour
        # embarquer le tokenizer dans un projet Scratch ou un .bin.
        with open(path.replace('.json', '.min.json'), 'w', encoding='utf-8') as fh:
            json.dump(
                {'specials': SPECIAL_TOKENS, 'merges': [[a, b] for a, b in self.merges]},
                fh, separators=(',', ':'),
            )

    @classmethod
    def load(cls, path: str) -> 'Tokenizer':
        with open(path, 'r', encoding='utf-8') as fh:
            data = json.load(fh)
        tok = cls(data['merges'])
        assert data.get('byte_base', BYTE_BASE) == BYTE_BASE
        return tok

    # ------------------------------------------------------------------ #
    # Décodage
    # ------------------------------------------------------------------ #

    def _rebuild_cache(self) -> None:
        self._id_to_bytes = {BYTE_BASE + b: bytes([b]) for b in range(256)}
        for i, (a, b) in enumerate(self.merges):
            self._id_to_bytes[MERGE_BASE + i] = (
                self._id_to_bytes[a] + self._id_to_bytes[b]
            )

    def token_bytes(self, token_id: int) -> bytes:
        """Octets représentés par un jeton (les spéciaux n'en ont pas)."""
        return self._id_to_bytes.get(token_id, b'')

    def decode(self, ids: Iterable[int], skip_special: bool = True) -> str:
        """Identifiants -> texte."""
        out = bytearray()
        for i in ids:
            if i < BYTE_BASE:
                if not skip_special and i < len(SPECIAL_TOKENS):
                    out += SPECIAL_TOKENS[i].encode('utf-8')
                continue
            out += self.token_bytes(i)
        return bytes(out).decode('utf-8', errors='replace')

    def decode_stream(self, token_id: int) -> str:
        """Texte d'un jeton isolé (utilisé par le runtime qui décode au fil de l'eau)."""
        if token_id < BYTE_BASE:
            return ''
        return self.token_bytes(token_id).decode('utf-8', errors='replace')

    # ------------------------------------------------------------------ #
    # Encodage
    # ------------------------------------------------------------------ #

    def _merge_chunk(self, ids: List[int]) -> List[int]:
        """Applique les fusions BPE sur la suite de jetons-octets d'un chunk."""
        if len(ids) < 2:
            return ids
        while True:
            best_rank = None
            best_pos = -1
            for i in range(len(ids) - 1):
                rank = self._rank.get((ids[i], ids[i + 1]))
                if rank is not None and (best_rank is None or rank < best_rank):
                    best_rank = rank
                    best_pos = i
            if best_rank is None:
                return ids
            merged = MERGE_BASE + best_rank
            out: List[int] = []
            i = 0
            while i < len(ids):
                if i < len(ids) - 1 and self._rank.get((ids[i], ids[i + 1])) == best_rank:
                    out.append(merged)
                    i += 2
                else:
                    out.append(ids[i])
                    i += 1
            ids = out
            if len(ids) < 2:
                return ids

    def encode_greedy(self, text: str, add_bos: bool = False, add_eos: bool = False) -> List[int]:
        """Encodage par **appariement glouton** (plus long jeton d'abord).

        Pourquoi une seconde méthode d'encodage ?

        Le BPE (`encode`) est appris par fusions : il ne peut pas être reproduit
        sans la liste complète des fusions *et* la même découpe en morceaux. Le
        moteur Scratch, lui, possède la table des jetons (jeton -> suite
        d'octets) : il peut donc segmenter par « plus long jeton qui correspond ».

        Les deux encodages donnent des suites **d'octets identiques** (seule la
        segmentation change). En entraînant Sorax sur un mélange des deux, il
        devient insensible à la méthode d'encodage : le mode Scratch fonctionne
        aussi bien que le mode navigateur.
        """
        ids: List[int] = []
        if add_bos:
            ids.append(BOS_ID)
        data = to_bytes(text)
        # table triée du plus long au plus court : première correspondance = la bonne
        candidates = sorted(self._id_to_bytes.items(), key=lambda kv: -len(kv[1]))
        i = 0
        n = len(data)
        while i < n:
            for token_id, token_bytes in candidates:
                if token_id < BYTE_BASE:
                    continue
                length = len(token_bytes)
                if length and i + length <= n and data[i:i + length] == list(token_bytes):
                    ids.append(token_id)
                    i += length
                    break
            else:  # pragma: no cover - les octets sont toujours couverts
                ids.append(BYTE_BASE + data[i])
                i += 1
        if add_eos:
            ids.append(EOS_ID)
        return ids

    def encode(self, text: str, add_bos: bool = False, add_eos: bool = False) -> List[int]:
        """Texte -> identifiants."""
        ids: List[int] = []
        if add_bos:
            ids.append(BOS_ID)
        for chunk in _CHUNK_RE.findall(text):
            if not chunk:
                continue
            byte_ids = [BYTE_BASE + b for b in chunk.encode('utf-8')]
            ids.extend(self._merge_chunk(byte_ids))
        if add_eos:
            ids.append(EOS_ID)
        return ids

    # ------------------------------------------------------------------ #
    # Entraînement
    # ------------------------------------------------------------------ #

    @classmethod
    def train(
        cls,
        texts: Iterable[str],
        vocab_size: int = 384,
        max_chars: int = 4_000_000,
        min_frequency: int = 2,
        verbose: bool = True,
    ) -> 'Tokenizer':
        """Apprend les fusions BPE sur un échantillon de texte.

        :param vocab_size: taille totale visée (spéciaux + octets + fusions)
        :param max_chars: budget de caractères pour l'apprentissage (vitesse)
        :param min_frequency: une paire doit apparaître au moins N fois
        """
        n_merges_target = max(0, vocab_size - MERGE_BASE)
        counts: Counter = Counter()
        total = 0
        for text in texts:
            for chunk in _CHUNK_RE.findall(text):
                if not chunk:
                    continue
                counts[chunk.encode('utf-8')] += 1
            total += len(text)
            if total >= max_chars:
                break
        # Représentation mutable : octets -> jetons
        words: Dict[bytes, List[int]] = {}
        freq: Dict[bytes, int] = {}
        for word, count in counts.items():
            if len(word) == 0:
                continue
            words[word] = [BYTE_BASE + b for b in word]
            freq[word] = count

        tok = cls([])
        pair_counts: Counter = Counter()
        pair_words: Dict[Tuple[int, int], set] = {}
        for word, ids in words.items():
            f = freq[word]
            for i in range(len(ids) - 1):
                pair = (ids[i], ids[i + 1])
                pair_counts[pair] += f
                pair_words.setdefault(pair, set()).add(word)

        for step in range(n_merges_target):
            if not pair_counts:
                break
            best = max(pair_counts.items(), key=lambda kv: (kv[1], -kv[0][0], -kv[0][1]))
            (a, b), count = best
            if count < min_frequency:
                break
            new_id = MERGE_BASE + len(tok.merges)
            tok.merges.append((a, b))
            tok._rank[(a, b)] = len(tok.merges) - 1
            tok._id_to_bytes[new_id] = tok._id_to_bytes[a] + tok._id_to_bytes[b]

            for word in list(pair_words.get((a, b), ())):  # mots touchés
                old_ids = words[word]
                f = freq[word]
                # retire les anciennes paires du mot
                for i in range(len(old_ids) - 1):
                    pair = (old_ids[i], old_ids[i + 1])
                    pair_counts[pair] -= f
                    if pair_counts[pair] <= 0:
                        del pair_counts[pair]
                    s = pair_words.get(pair)
                    if s is not None:
                        s.discard(word)
                # fusionne toutes les occurrences de (a, b)
                new_ids: List[int] = []
                i = 0
                while i < len(old_ids):
                    if i < len(old_ids) - 1 and old_ids[i] == a and old_ids[i + 1] == b:
                        new_ids.append(new_id)
                        i += 2
                    else:
                        new_ids.append(old_ids[i])
                        i += 1
                words[word] = new_ids
                for i in range(len(new_ids) - 1):
                    pair = (new_ids[i], new_ids[i + 1])
                    pair_counts[pair] += f
                    pair_words.setdefault(pair, set()).add(word)
            if verbose and (step + 1) % 50 == 0:
                print(f'  [bpe] fusion {step + 1}/{n_merges_target} '
                      f'({a},{b}) ×{count}', flush=True)

        tok._rebuild_cache()
        return tok

    # ------------------------------------------------------------------ #
    # Utilitaires
    # ------------------------------------------------------------------ #

    def pretty_token(self, token_id: int) -> str:
        """Représentation lisible d'un jeton (pour la documentation / le debug)."""
        if token_id < len(SPECIAL_TOKENS) and token_id < BYTE_BASE:
            return SPECIAL_TOKENS[token_id]
        raw = self.token_bytes(token_id)
        try:
            text = raw.decode('utf-8')
            text = text.replace('\n', '\\n')
            return text if text.strip() else repr(text)
        except UnicodeDecodeError:
            return repr(raw)


def normalize_prompt(text: str) -> str:
    """Normalise une demande utilisateur destinée au modèle.

    Les espaces multiples et les caractères de contrôle sont neutralisés : sur un
    modèle de ~150 k paramètres, chaque caractère compte.
    """
    text = unicodedata.normalize('NFC', text or '')
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def tokens_to_ids(*ids: int) -> List[int]:
    """Petit utilitaire de lisibilité pour les tests."""
    return list(ids)


__all__ = [
    'Tokenizer', 'normalize_prompt', 'to_bytes', 'from_bytes',
    'PAD_ID', 'BOS_ID', 'EOS_ID', 'USER_ID', 'ASSISTANT_ID', 'tokens_to_ids',
]
