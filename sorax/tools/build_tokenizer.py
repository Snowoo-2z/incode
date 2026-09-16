#!/usr/bin/env python3
"""Apprend le tokenizer BPE octet de Sorax sur le corpus.

    python sorax/tools/build_tokenizer.py                 # vocabulaire 384
    python sorax/tools/build_tokenizer.py --vocab 512
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sorax.configs import PATHS                      # noqa: E402

from sorax.tokenizer import Tokenizer                # noqa: E402


def corpus_texts(directory: str):
    """Itère sur tous les textes (demandes + réponses) du corpus."""
    for name in ('train.jsonl', 'val.jsonl', 'test.jsonl'):
        path = os.path.join(directory, name)
        if not os.path.exists(path):
            continue
        with open(path, 'r', encoding='utf-8') as fh:
            for line in fh:
                if not line.strip():
                    continue
                data = json.loads(line)
                yield f"{data['task']} {data['prompt']}\n{data['answer']}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus', default=PATHS.CORPUS)
    parser.add_argument('--vocab', type=int, default=384,
                        help='taille totale du vocabulaire (spéciaux + 256 octets + fusions)')
    parser.add_argument('--max-chars', type=int, default=6_000_000)
    parser.add_argument('--out', default=PATHS.TOKENIZER)
    args = parser.parse_args()

    if not os.path.exists(os.path.join(args.corpus, 'train.jsonl')):
        print(f'✘ corpus introuvable dans {args.corpus} — lancez make_corpus.py d\'abord')
        return 1

    print(f'apprentissage BPE (vocabulaire cible : {args.vocab})…')
    tokenizer = Tokenizer.train(
        corpus_texts(args.corpus), vocab_size=args.vocab, max_chars=args.max_chars
    )
    tokenizer.save(args.out)

    # Rapport : les fusions les plus « parlantes » du domaine Scratch.
    sample = 'sprite Balle 0 0:\n  whenflagclicked\n  forever:\n    move 10'
    ids = tokenizer.encode(sample)
    preview = ' | '.join(tokenizer.pretty_token(i) for i in ids[:24])
    print(f'✔ tokenizer enregistré : {args.out}')
    print(f'  vocabulaire effectif : {tokenizer.vocab_size} jetons')
    print(f'  « {sample.splitlines()[0]} » -> {len(ids)} jetons')
    print(f'  aperçu : {preview}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
