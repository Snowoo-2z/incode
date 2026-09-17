#!/usr/bin/env python3
"""Exporte un checkpoint Sorax vers `sorax_core.bin` (int8) + rapport.

    python sorax/tools/export.py --config nano \
        --ckpt sorax/assets/checkpoints/nano-local/last.npz \
        --out sorax/assets/export/nano
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sorax.configs import PATHS, get_config                 # noqa: E402
from sorax.dataset import read_samples                      # noqa: E402
from sorax.export import default_demo_prompts, export_model  # noqa: E402
from sorax.tokenizer import Tokenizer                       # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default='nano')
    parser.add_argument('--ckpt', default=None, help='checkpoint .npz (défaut : <palier>-local/last.npz)')
    parser.add_argument('--out', default=None, help='dossier de sortie (défaut : assets/export/<palier>)')
    parser.add_argument('--corpus', default=PATHS.CORPUS)
    parser.add_argument('--tokenizer', default=PATHS.TOKENIZER)
    parser.add_argument('--no-demo', action='store_true', help='ne pas générer d\'exemples')
    args = parser.parse_args()

    cfg = get_config(args.config)
    ckpt = args.ckpt or os.path.join(PATHS.CHECKPOINTS, f'{args.config}-local', 'last.npz')
    out_dir = args.out or os.path.join(PATHS.EXPORT, args.config)
    if not os.path.exists(ckpt):
        print(f'✘ checkpoint introuvable : {ckpt}')
        return 1

    tokenizer = Tokenizer.load(args.tokenizer)
    val_samples = read_samples([os.path.join(args.corpus, 'val.jsonl')], limit=32)
    manifest = export_model(
        ckpt, cfg, tokenizer, out_dir,
        val_samples=val_samples,
        demo_prompts=[] if args.no_demo else default_demo_prompts(),
    )
    print(json.dumps({k: v for k, v in manifest.items()
                      if k in ('palier', 'mo', 'parametres', 'sha256', 'evaluation')},
                     ensure_ascii=False, indent=1)[:2000])
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
