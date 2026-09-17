"""Tests NumPy : gradient analytique vs gradient numérique, cache KV, RoPE.

    python -m pytest sorax/tests -q       (ou)   python sorax/tests/test_nn_numpy.py
"""

from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sorax.configs import ModelConfig                      # noqa: E402
from sorax.model_spec import init_params                   # noqa: E402
from sorax.nn_numpy import NumpySorax, apply_rope, rope_cache, rmsnorm  # noqa: E402

TINY = ModelConfig(
    name='test', vocab_size=48, d_model=16, n_layers=2, n_heads=2, d_ff=32,
    max_seq_len=16, scratch_runnable=False,
)


def _tiny_model(seed: int = 0) -> NumpySorax:
    return NumpySorax(TINY, init_params(TINY, seed=seed))


def test_forward_shapes():
    model = _tiny_model()
    tokens = np.random.randint(0, TINY.vocab_size, size=(2, 5))
    logits, loss, cache = model.forward(tokens)
    assert logits.shape == (2, 5, TINY.vocab_size)
    assert loss is None
    assert len(cache) == TINY.n_layers
    assert cache[0]['k'].shape == (2, 5, TINY.n_heads, TINY.d_model // TINY.n_heads)


def test_gradients_match_numeric():
    """Backprop manuelle vérifiée par différences finies sur ~40 paramètres."""
    rng = np.random.default_rng(3)
    model = _tiny_model(seed=5)
    tokens = rng.integers(0, TINY.vocab_size, size=(2, 4))
    targets = rng.integers(0, TINY.vocab_size, size=(2, 4))

    loss, grads = model.loss_and_grads(tokens, targets)
    eps = 1e-3
    checked = 0
    max_rel = 0.0
    for name, grad in grads.items():
        flat_idx = np.argsort(np.abs(grad).ravel())[-6:]     # les plus significatifs
        for idx in flat_idx:
            idx_tuple = np.unravel_index(idx, grad.shape)
            base = model.p[name][idx_tuple]
            model.p[name][idx_tuple] = base + eps
            l_plus, _ = model.loss_and_grads(tokens, targets)
            model.p[name][idx_tuple] = base - eps
            l_minus, _ = model.loss_and_grads(tokens, targets)
            model.p[name][idx_tuple] = base
            numeric = (l_plus - l_minus) / (2 * eps)
            analytic = grad[idx_tuple]
            denom = max(1e-4, abs(numeric) + abs(analytic))
            rel = abs(numeric - analytic) / denom
            max_rel = max(max_rel, rel)
            checked += 1
            assert rel < 5e-2, f'{name}{idx_tuple}: numérique={numeric:.6f} analytique={analytic:.6f}'
    assert checked >= 30
    print(f'  gradients vérifiés : {checked} (erreur relative max {max_rel:.4f})')


def test_rope_is_a_rotation():
    """RoPE conserve la norme des paires concernées."""
    cos, sin = rope_cache(4, 8, 10000.0)
    x = np.random.randn(1, 4, 2, 8).astype(np.float32)
    y = apply_rope(x, cos, sin)
    np.testing.assert_allclose(np.sqrt((x ** 2).sum(-1)), np.sqrt((y ** 2).sum(-1)), rtol=1e-4)


def test_cache_matches_full_forward():
    """Le décodage incrémental (cache KV) doit donner les mêmes logits."""
    model = _tiny_model(seed=9)
    tokens = np.array([[3, 9, 12, 5, 7]])
    full, _, _ = model.forward(tokens)

    cache = None
    step_logits = []
    for t in range(tokens.shape[1]):
        cache = [] if cache is None else cache
        logits, _, cache = model.forward(tokens[:, t:t + 1], cache=cache if t else None)
        step_logits.append(logits[:, -1])
    stacked = np.stack(step_logits, axis=1)
    np.testing.assert_allclose(full, stacked, atol=2e-3)


def test_rmsnorm_scale():
    x = np.array([[3.0, 4.0]], dtype=np.float32)
    w = np.ones(2, dtype=np.float32)
    out = rmsnorm(x, w, 1e-12)
    np.testing.assert_allclose(np.sqrt(np.mean(out ** 2)), np.array([1.0]), rtol=1e-3)


if __name__ == '__main__':
    failures = 0
    for name, fn in sorted(list(globals().items())):
        if name.startswith('test_') and callable(fn):
            try:
                fn()
                print(f'✔ {name}')
            except AssertionError as exc:  # pragma: no cover
                failures += 1
                print(f'✘ {name} : {exc}')
    raise SystemExit(failures)
