#!/usr/bin/env python3
"""Génère le corpus d'entraînement de Sorax (JSONL) + son rapport.

    python sorax/tools/make_corpus.py --preset demo      # ~2 000 échantillons (test local)
    python sorax/tools/make_corpus.py --preset colab     # ~40 000 échantillons (T4)
    python sorax/tools/make_corpus.py --preset maxi --out /content/drive/MyDrive/sorax/corpus
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sorax.configs import PATHS                       # noqa: E402
from sorax.corpus import CorpusGenerator, stats, write_corpus  # noqa: E402
from sorax.grammar import Grammar                     # noqa: E402

PRESETS = {
    'demo': 2_000,
    'colab': 40_000,
    'maxi': 120_000,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preset', choices=sorted(PRESETS), default='demo')
    parser.add_argument('--size', type=int, default=None, help='taille cible explicite')
    parser.add_argument('--seed', type=int, default=1337)
    parser.add_argument('--out', default=PATHS.CORPUS)
    parser.add_argument('--report', default=None, help='chemin du rapport JSON')
    args = parser.parse_args()

    target = args.size or PRESETS[args.preset]
    grammar = Grammar.load()
    generator = CorpusGenerator(grammar, seed=args.seed)

    t0 = time.time()
    samples = list(generator.all_samples(target_size=target))
    print(f'génération : {len(samples)} échantillons en {time.time() - t0:.1f}s')

    counts = write_corpus(samples, args.out, seed=args.seed)
    report = stats(samples)
    report['splits'] = counts
    report['preset'] = args.preset
    report['seed'] = args.seed

    report_path = args.report or os.path.join(args.out, 'rapport.json')
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, 'w', encoding='utf-8') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)

    print(json.dumps(report, ensure_ascii=False, indent=1))
    total_chars = sum(len(s.answer) + len(s.prompt) for s in samples)
    print(f'volume total : {total_chars / 1e6:.2f} M caractères '
          f'(~{total_chars / 4 / 1e6:.2f} M jetons)')
    print(f'écrit dans {args.out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
