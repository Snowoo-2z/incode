#!/usr/bin/env python3
"""Entraîne Sorax en NumPy (local, sans GPU) puis écrit un checkpoint `.npz`.

    python sorax/tools/train.py --config pico --preset demo --steps 300
    python sorax/tools/train.py --config nano --steps 3000 --out sorax/assets/checkpoints/nano-local

Utile pour valider toute la chaîne locale ; l'entraînement sérieux se fait sur
Colab T4 avec `tools/train_torch.py` (notebooks de `sorax/colab/`).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sorax.configs import PATHS, get_config            # noqa: E402
from sorax.dataset import build_stream, read_samples   # noqa: E402
from sorax.tokenizer import Tokenizer                  # noqa: E402
from sorax.train import TrainConfig, load_checkpoint, train  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default='nano', help='pico | nano')
    parser.add_argument('--corpus', default=PATHS.CORPUS)
    parser.add_argument('--tokenizer', default=PATHS.TOKENIZER)
    parser.add_argument('--out', default=None)
    parser.add_argument('--steps', type=int, default=2000)
    parser.add_argument('--batch-size', type=int, default=16)
    parser.add_argument('--lr', type=float, default=3e-3)
    parser.add_argument('--limit', type=int, default=None, help='limite d\'échantillons de train')
    parser.add_argument('--resume', default=None)
    parser.add_argument('--seed', type=int, default=0)
    parser.add_argument('--eval-every', type=int, default=200)
    args = parser.parse_args()

    cfg = get_config(args.config)
    out_dir = args.out or os.path.join(PATHS.CHECKPOINTS, f'{args.config}-local')
    tokenizer = Tokenizer.load(args.tokenizer)

    t0 = time.time()
    train_samples = read_samples([os.path.join(args.corpus, 'train.jsonl')], limit=args.limit)
    val_samples = read_samples([os.path.join(args.corpus, 'val.jsonl')], limit=64)
    if not train_samples:
        print('✘ corpus vide — lancez make_corpus.py')
        return 1
    stream, stats = build_stream(train_samples, tokenizer, max_seq_len=cfg.max_seq_len)
    val_stream = None
    if val_samples:
        val_stream, _ = build_stream(val_samples, tokenizer, max_seq_len=cfg.max_seq_len)
    print(f'données : {stats["exemples"]} exemples, {stats["jetons"]:,} jetons '
          f'({stats["jetons_reponse"]:,} sur la réponse) en {time.time() - t0:.1f}s')
    print(f'modèle {cfg.name} : {cfg.n_params:,} paramètres, contexte {cfg.max_seq_len}')

    train_cfg = TrainConfig(
        steps=args.steps, batch_size=args.batch_size, lr=args.lr,
        eval_every=args.eval_every, seed=args.seed,
    )
    params = load_checkpoint(args.resume) if args.resume else None
    if params:
        print(f'reprise depuis {args.resume}')
    report = train(cfg, stream, val_stream, train_cfg, out_dir=out_dir, params=params)

    with open(os.path.join(out_dir, 'config.json'), 'w', encoding='utf-8') as fh:
        json.dump({'config': cfg.to_dict(), 'data': stats}, fh, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in report.items() if k != 'history'},
                     ensure_ascii=False, indent=1))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
