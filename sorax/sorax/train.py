"""Entraîneur NumPy (sans GPU) — paliers pico/nano sur machine locale.

Le même modèle peut être entraîné de deux façons :

* ``tools/train.py`` (ce module) : **NumPy pur**, lent mais universel ; sert à
  vérifier toute la chaîne (corpus -> poids -> quantification -> Scratch) et à
  produire un checkpoint de démonstration ;
* ``tools/train_torch.py`` : **PyTorch + CUDA**, celui des notebooks Colab T4.

Les deux écrivent le *même* format de checkpoint `.npz`, donc tout ce qui suit
(export, quantification, .sb3) est indépendant du moteur d'entraînement.
"""

from __future__ import annotations

import json
import math
import os
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np

from .configs import ModelConfig
from .dataset import TokenStream
from .model_spec import init_params
from .nn_numpy import NumpySorax


@dataclass
class TrainConfig:
    """Hyper-paramètres d'entraînement."""

    steps: int = 2000
    batch_size: int = 16
    lr: float = 3e-3
    min_lr_ratio: float = 0.1
    warmup_steps: int = 100
    weight_decay: float = 0.01
    grad_clip: float = 1.0
    beta1: float = 0.9
    beta2: float = 0.95
    eps: float = 1e-8
    eval_every: int = 200
    eval_batches: int = 8
    log_every: int = 20
    seed: int = 0
    resume: Optional[str] = None


class AdamW:
    """Optimiseur AdamW minimal (identique à celui utilisé côté PyTorch)."""

    def __init__(self, params: Dict[str, np.ndarray], cfg: TrainConfig):
        self.cfg = cfg
        self.m: Dict[str, np.ndarray] = {k: np.zeros_like(v) for k, v in params.items()}
        self.v: Dict[str, np.ndarray] = {k: np.zeros_like(v) for k, v in params.items()}
        self.t = 0

    def step(self, params: Dict[str, np.ndarray], grads: Dict[str, np.ndarray], lr: float) -> None:
        self.t += 1
        cfg = self.cfg
        b1, b2 = cfg.beta1, cfg.beta2
        bc1 = 1.0 - b1 ** self.t
        bc2 = 1.0 - b2 ** self.t
        for name, grad in grads.items():
            if name not in params:
                continue
            m = self.m[name]
            v = self.v[name]
            m *= b1
            m += (1 - b1) * grad
            v *= b2
            v += (1 - b2) * (grad * grad)
            m_hat = m / bc1
            v_hat = v / bc2
            update = m_hat / (np.sqrt(v_hat) + cfg.eps)
            if cfg.weight_decay:
                update += cfg.weight_decay * params[name]
            params[name] -= lr * update


def lr_at(step: int, cfg: TrainConfig) -> float:
    """Échauffement linéaire puis décroissance cosinus."""
    if step < cfg.warmup_steps:
        return cfg.lr * (step + 1) / max(1, cfg.warmup_steps)
    progress = (step - cfg.warmup_steps) / max(1, cfg.steps - cfg.warmup_steps)
    progress = min(1.0, progress)
    cos = 0.5 * (1 + math.cos(math.pi * progress))
    return cfg.lr * (cfg.min_lr_ratio + (1 - cfg.min_lr_ratio) * cos)


def clip_grads(grads: Dict[str, np.ndarray], max_norm: float) -> float:
    """Écrêtage par norme globale ; renvoie la norme avant écrêtage."""
    total = 0.0
    for g in grads.values():
        total += float(np.sum(g.astype(np.float64) ** 2))
    norm = math.sqrt(total)
    if norm > max_norm and norm > 0:
        scale = max_norm / (norm + 1e-6)
        for g in grads.values():
            g *= scale
    return norm


def train(
    cfg: ModelConfig,
    stream: TokenStream,
    val_stream: Optional[TokenStream] = None,
    train_cfg: Optional[TrainConfig] = None,
    out_dir: str = 'sorax/assets/checkpoints/local',
    params: Optional[Dict[str, np.ndarray]] = None,
    verbose: bool = True,
) -> Dict[str, object]:
    """Boucle d'entraînement NumPy complète (avec sauvegarde de checkpoint)."""
    train_cfg = train_cfg or TrainConfig()
    os.makedirs(out_dir, exist_ok=True)
    rng = np.random.default_rng(train_cfg.seed)
    params = params if params is not None else init_params(cfg, seed=train_cfg.seed)
    model = NumpySorax(cfg, params)
    opt = AdamW(params, train_cfg)

    history: List[dict] = []
    best_val = float('inf')
    t0 = time.time()
    for step in range(train_cfg.steps):
        lr = lr_at(step, train_cfg)
        x, y = stream.batch(train_cfg.batch_size, cfg.max_seq_len, rng)
        mask = y >= 0                                   # perte sur la réponse seulement
        loss, grads = model.loss_and_grads(x, np.where(mask, y, 0), loss_mask=mask)
        norm = clip_grads(grads, train_cfg.grad_clip)
        opt.step(params, grads, lr)

        if verbose and (step + 1) % train_cfg.log_every == 0:
            dt = time.time() - t0
            per_step = dt / (step + 1)
            eta = per_step * (train_cfg.steps - step - 1)
            print(f'  step {step + 1:5d}/{train_cfg.steps} | perte {loss:.4f} | '
                  f'lr {lr:.2e} | |g| {norm:.2f} | {per_step * 1000:.0f} ms/step | '
                  f'reste ~{eta / 60:.1f} min', flush=True)

        if (step + 1) % train_cfg.eval_every == 0:
            record = {'step': step + 1, 'train_loss': loss, 'lr': lr}
            if val_stream is not None:
                val_losses = []
                for _ in range(train_cfg.eval_batches):
                    vx, vy = val_stream.batch(train_cfg.batch_size, cfg.max_seq_len, rng)
                    vmask = vy >= 0
                    _, vloss, _ = model.forward(vx, np.where(vmask, vy, 0))
                    val_losses.append(vloss)
                record['val_loss'] = float(np.mean(val_losses))
                if record['val_loss'] < best_val:
                    best_val = record['val_loss']
                    save_checkpoint(params, cfg, os.path.join(out_dir, 'best.npz'), record)
            history.append(record)
            # sauvegarde de sûreté (permet de reprendre après une coupure Colab)
            save_checkpoint(params, cfg, os.path.join(out_dir, 'last.npz'), record)

    save_checkpoint(params, cfg, os.path.join(out_dir, 'last.npz'), {'final': True})
    report = {
        'config': cfg.to_dict(),
        'train': train_cfg.__dict__,
        'steps': train_cfg.steps,
        'history': history,
        'best_val_loss': None if best_val == float('inf') else best_val,
        'final_train_loss': history[-1]['train_loss'] if history else None,
        'duree_min': round((time.time() - t0) / 60, 2),
        'parametres': cfg.n_params,
    }
    with open(os.path.join(out_dir, 'rapport_entrainement.json'), 'w', encoding='utf-8') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    if verbose:
        print(f'entraînement terminé en {report["duree_min"]} min — '
              f'checkpoint : {out_dir}/last.npz')
    return report


def save_checkpoint(
    params: Dict[str, np.ndarray], cfg: ModelConfig, path: str, meta: Optional[dict] = None
) -> None:
    """Sauvegarde un checkpoint `.npz` (poids float32 + métadonnées)."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    payload = {k: v.astype(np.float32) for k, v in params.items()}
    payload['__meta__'] = np.array(
        [json.dumps({'config': cfg.to_dict(), 'meta': meta or {}}, ensure_ascii=False)],
        dtype=object,
    )
    np.savez_compressed(path, **payload)


def load_checkpoint(path: str, cfg: Optional[ModelConfig] = None) -> Dict[str, np.ndarray]:
    """Recharge un checkpoint `.npz` (ignore la clé de métadonnées)."""
    data = np.load(path, allow_pickle=True)
    return {k: data[k] for k in data.files if k != '__meta__'}


def checkpoint_meta(path: str) -> dict:
    """Lit les métadonnées d'un checkpoint (config + statistiques)."""
    data = np.load(path, allow_pickle=True)
    if '__meta__' not in data.files:
        return {}
    return json.loads(str(data['__meta__'][0]))


__all__ = [
    'TrainConfig', 'AdamW', 'train', 'lr_at', 'clip_grads',
    'save_checkpoint', 'load_checkpoint', 'checkpoint_meta',
]
