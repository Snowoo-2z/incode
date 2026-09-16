#!/usr/bin/env python3
"""Vérifie que le runtime JavaScript calcule exactement comme NumPy.

Toute la crédibilité du projet repose sur cette égalité : le modèle exporté doit
produire **les mêmes logits** dans Scratch/TurboWarp et dans l'entraîneur.

    python sorax/tools/check_runtime_parity.py sorax/assets/export/nano/sorax_core.bin
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sorax.configs import ModelConfig             # noqa: E402
from sorax.quantize import read_model_bin         # noqa: E402
from sorax.quantized_forward import QuantizedSorax  # noqa: E402
from sorax.tokenizer import Tokenizer             # noqa: E402

TOLERANCE = 1e-3


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bin', nargs='?', default='sorax/assets/export/nano/sorax_core.bin')
    parser.add_argument('--tokens', default='1,42,100,7,300,260,12,55')
    parser.add_argument('--node', default='node')
    args = parser.parse_args()

    if not os.path.exists(args.bin):
        print(f'✘ {args.bin} introuvable — lancez d\'abord tools/export.py')
        return 1

    header, tensors = read_model_bin(args.bin)
    cfg = ModelConfig(**header['arch'])
    tokens = [int(t) for t in args.tokens.split(',')]
    tokens = [t % cfg.vocab_size for t in tokens]

    model = QuantizedSorax(cfg, tensors)
    cache = model.new_cache()
    reference = None
    for pos, tok in enumerate(tokens):
        reference = model.forward_token(tok, pos, cache)

    js_script = os.path.join(os.path.dirname(__file__), 'parity_js.mjs')
    proc = subprocess.run(
        [args.node, js_script, os.path.abspath(args.bin), ','.join(str(t) for t in tokens)],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        print('✘ le runtime JS a échoué :')
        print(proc.stderr[-2000:])
        return 1
    js = json.loads(proc.stdout)
    js_logits = np.array(js['logits'], dtype=np.float32)

    scale = max(1e-6, float(np.abs(reference).max()))
    rel = float(np.abs(js_logits - reference).max() / scale)
    print(f'logits de référence (NumPy) : {np.round(reference[:6], 4)} …')
    print(f'logits du runtime JS       : {np.round(js_logits[:6], 4)} …')
    print(f'écart relatif max           : {rel:.3e} (tolérance {TOLERANCE:g})')

    # le tokenizer doit aussi être identique octet pour octet
    tok = Tokenizer.load('sorax/assets/tokenizer.json')
    sample = 'sprite Balle 0 0:\n  whenflagclicked'
    py_ids = tok.encode(sample)
    if py_ids != js['encode']:
        print(f'✘ tokenizer divergent :\n  python {py_ids[:16]}\n  js     {js["encode"][:16]}')
        return 1
    if js['decode'] != 'sprite Balle 0 0:':
        print(f'✘ décodage divergent : {js["decode"]!r}')
        return 1
    print(f'tokenizer : identique ({len(py_ids)} jetons pour {len(sample)} caractères)')

    if rel > TOLERANCE:
        print('✘ PARITÉ ROMPUE')
        return 1
    print('✔ parité NumPy ↔ JavaScript vérifiée')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
