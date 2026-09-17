#!/usr/bin/env python3
"""Entraîne Sorax **sur GPU** (PyTorch + CUDA) — le script des notebooks Colab T4.

    python sorax/tools/train_torch.py --config nano \\
        --corpus  /content/drive/MyDrive/sorax/corpus \\
        --tokenizer /content/drive/MyDrive/sorax/tokenizer.json \\
        --out     /content/drive/MyDrive/sorax/checkpoints/nano \\
        --steps 4000 --batch-size 32

Le modèle PyTorch est strictement le même que le NumPy (`sorax/model_torch.py`,
parité des logits et des gradients vérifiée par `tests/test_parity_torch.py`) :
les checkpoints `.npz` produits ici sont donc directement exportables avec
`tools/export.py`, sans conversion.

La perte ne porte que sur la **réponse** (`loss_mask` du corpus) : Sorax
apprend à écrire la suite, pas à recopier la consigne.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from typing import Dict, List, Optional

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sorax.configs import PATHS, get_config                       # noqa: E402
from sorax.dataset import TokenStream, read_samples               # noqa: E402
from sorax.dataset import build_stream                            # noqa: E402
from sorax.model_torch import SoraxTorch, param_count             # noqa: E402
from sorax.tokenizer import Tokenizer                             # noqa: E402


def lr_at(step: int, steps: int, lr: float, warmup: int, min_ratio: float = 0.1) -> float:
    """Échauffement linéaire puis décroissance cosinus (comme la version NumPy)."""
    if step < warmup:
        return lr * (step + 1) / max(1, warmup)
    progress = (step - warmup) / max(1, steps - warmup)
    cosine = 0.5 * (1.0 + math.cos(math.pi * min(1.0, progress)))
    return lr * (min_ratio + (1.0 - min_ratio) * cosine)


def batches(stream: TokenStream, batch_size: int, seq_len: int, rng):
    """Générateur infini de lots (jetons, cibles masquées)."""
    while True:
        x, y = stream.batch(batch_size, seq_len, rng)
        yield x, y


def evaluate(model: SoraxTorch, stream: TokenStream, batch_size: int, seq_len: int,
             n_batches: int, rng) -> float:
    """Perte moyenne de validation (mêmes lots qu'en NumPy : tirage aléatoire)."""
    import torch

    model.eval()
    losses: List[float] = []
    with torch.no_grad():
        for _ in range(n_batches):
            x, y = stream.batch(batch_size, seq_len, rng)
            mask = y >= 0
            if not mask.any():
                continue
            tokens = torch.tensor(x, dtype=torch.long, device=_device())
            targets = torch.tensor(y, dtype=torch.long, device=_device())
            logits, _ = model(tokens)
            flat_logits = logits.reshape(-1, logits.shape[-1])
            flat_targets = targets.reshape(-1)
            keep = torch.tensor(mask.reshape(-1), dtype=torch.bool, device=_device())
            if not bool(keep.any()):
                continue
            loss = torch.nn.functional.cross_entropy(flat_logits[keep], flat_targets[keep])
            losses.append(float(loss.item()))
    model.train()
    return float(sum(losses) / len(losses)) if losses else float('nan')


def _device():
    import torch

    return torch.device('cuda' if torch.cuda.is_available() else 'cpu')


def save_npz(model: SoraxTorch, path: str, meta: dict) -> None:
    """Écrit le format `.npz` attendu par `tools/export.py`."""
    import numpy as np

    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    arrays = model.to_numpy()
    arrays['__meta__'] = np.array(
        [json.dumps({'config': model.cfg.to_dict(), 'meta': meta}, ensure_ascii=False)],
        dtype=object,
    )
    np.savez_compressed(path, **arrays)


def load_into(model: SoraxTorch, path: str) -> int:
    """Recharge des poids `.npz` (entraînement NumPy -> reprise GPU, ou coupure Colab)."""
    import numpy as np

    data = np.load(path, allow_pickle=True)
    params = {k: data[k].astype('float32') for k in data.files if k != '__meta__'}
    model.load_from_numpy(params)
    return len(params)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--config', default='nano', help='pico | nano | mini | plus')
    parser.add_argument('--corpus', default=PATHS.CORPUS)
    parser.add_argument('--tokenizer', default=PATHS.TOKENIZER)
    parser.add_argument('--out', default=None, help='dossier des checkpoints')
    parser.add_argument('--steps', type=int, default=4000)
    parser.add_argument('--batch-size', type=int, default=32)
    parser.add_argument('--lr', type=float, default=3e-3)
    parser.add_argument('--warmup', type=int, default=100)
    parser.add_argument('--weight-decay', type=float, default=0.01)
    parser.add_argument('--grad-clip', type=float, default=1.0)
    parser.add_argument('--eval-every', type=int, default=200)
    parser.add_argument('--eval-batches', type=int, default=8)
    parser.add_argument('--log-every', type=int, default=20)
    parser.add_argument('--limit', type=int, default=None, help="limite d'échantillons de train")
    parser.add_argument('--resume', default=None, help='checkpoint .npz à reprendre')
    parser.add_argument('--seed', type=int, default=0)
    parser.add_argument('--compile', action='store_true', help='torch.compile (Colab récent)')
    args = parser.parse_args()

    import numpy as np
    import torch

    device = _device()
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    cfg = get_config(args.config)
    out_dir = args.out or os.path.join(PATHS.CHECKPOINTS, f'{args.config}-torch')
    os.makedirs(out_dir, exist_ok=True)

    tokenizer = Tokenizer.load(args.tokenizer)
    train_samples = read_samples([os.path.join(args.corpus, 'train.jsonl')], limit=args.limit)
    val_samples = read_samples([os.path.join(args.corpus, 'val.jsonl')], limit=64)
    if not train_samples:
        print('✘ corpus vide — lancez make_corpus.py')
        return 1
    t0 = time.time()
    train_stream, stats = build_stream(train_samples, tokenizer, max_seq_len=cfg.max_seq_len)
    val_stream = build_stream(val_samples, tokenizer, max_seq_len=cfg.max_seq_len)[0] if val_samples else None
    print(f'données : {stats["exemples"]} exemples, {stats["jetons"]:,} jetons '
          f'({stats["jetons_reponse"]:,} sur la réponse) en {time.time() - t0:.1f}s')

    model = SoraxTorch(cfg).to(device)
    print(f'modèle {cfg.name} : {param_count(model):,} paramètres, contexte {cfg.max_seq_len}, '
          f'sur {torch.cuda.get_device_name(0) if device.type == "cuda" else "CPU"}')

    start_step = 0
    if args.resume and os.path.exists(args.resume):
        loaded = load_into(model, args.resume)
        print(f'reprise depuis {args.resume} ({loaded} tenseurs)')
        meta = json.loads(str(np.load(args.resume, allow_pickle=True)['__meta__'][0]))
        start_step = int(meta.get('meta', {}).get('step', 0)) if isinstance(meta, dict) else 0

    if args.compile:
        model = torch.compile(model)     # type: ignore[assignment]

    decay, no_decay = [], []
    for name, param in model.named_parameters():
        (no_decay if name.endswith('norm') else decay).append(param)
    optimizer = torch.optim.AdamW(
        [{'params': decay, 'weight_decay': args.weight_decay},
         {'params': no_decay, 'weight_decay': 0.0}],
        lr=args.lr, betas=(0.9, 0.95), eps=1e-8,
    )

    rng = np.random.default_rng(args.seed)
    stream = batches(train_stream, args.batch_size, cfg.max_seq_len, rng)
    history: List[dict] = []
    best_val = float('inf')
    t0 = time.time()

    for local_step in range(args.steps):
        step = start_step + local_step
        lr = lr_at(step, start_step + args.steps, args.lr, args.warmup)
        for group in optimizer.param_groups:
            group['lr'] = lr

        x, y = next(stream)
        mask = y >= 0
        if not mask.any():
            continue
        tokens = torch.tensor(x, dtype=torch.long, device=device)
        targets = torch.tensor(y, dtype=torch.long, device=device)
        keep = torch.tensor(mask.reshape(-1), dtype=torch.bool, device=device)

        logits, _ = model(tokens)
        loss = torch.nn.functional.cross_entropy(
            logits.reshape(-1, logits.shape[-1])[keep], targets.reshape(-1)[keep]
        )
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        norm = torch.nn.utils.clip_grad_norm_(model.parameters(), args.grad_clip)
        optimizer.step()

        if (local_step + 1) % args.log_every == 0:
            dt = time.time() - t0
            per_step = dt / (local_step + 1)
            eta = per_step * (args.steps - local_step - 1)
            mem = torch.cuda.max_memory_allocated() / 2 ** 20 if device.type == 'cuda' else 0
            print(f'  step {step + 1:5d}/{start_step + args.steps} | perte {loss.item():.4f} | '
                  f'lr {lr:.2e} | |g| {float(norm):.2f} | {per_step * 1000:.0f} ms/step | '
                  f'{mem:.0f} Mo | reste ~{eta / 60:.1f} min', flush=True)

        if (local_step + 1) % args.eval_every == 0:
            record = {'step': step + 1, 'train_loss': float(loss.item()), 'lr': lr}
            if val_stream is not None:
                record['val_loss'] = evaluate(
                    model, val_stream, args.batch_size, cfg.max_seq_len, args.eval_batches, rng
                )
                if record['val_loss'] < best_val:
                    best_val = record['val_loss']
                    save_npz(model, os.path.join(out_dir, 'best.npz'), record)
                    print(f'    nouveau meilleur val_loss {best_val:.4f} -> best.npz', flush=True)
            history.append(record)
            # sauvegarde de sûreté : une coupure Colab ne coûte pas la session
            save_npz(model, os.path.join(out_dir, 'last.npz'), record)

    save_npz(model, os.path.join(out_dir, 'last.npz'), {'final': True, 'step': start_step + args.steps})
    report = {
        'config': cfg.to_dict(),
        'train': vars(args),
        'steps': args.steps,
        'history': history,
        'best_val_loss': None if best_val == float('inf') else best_val,
        'final_train_loss': history[-1]['train_loss'] if history else None,
        'duree_min': round((time.time() - t0) / 60, 2),
        'parametres': param_count(model),
        'appareil': str(device),
    }
    with open(os.path.join(out_dir, 'rapport_entrainement.json'), 'w', encoding='utf-8') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    print(f'entraînement terminé en {report["duree_min"]} min — checkpoints : {out_dir}')
    if best_val != float('inf'):
        print(f'meilleure perte de validation : {best_val:.4f}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
