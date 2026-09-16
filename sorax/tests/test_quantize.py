"""Tests de quantification : fidélité int8, format binaire, aller-retour."""

from __future__ import annotations

import os
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sorax.configs import ModelConfig                       # noqa: E402
from sorax.model_spec import init_params, param_count       # noqa: E402
from sorax.nn_numpy import NumpySorax                       # noqa: E402
from sorax.quantize import (                                # noqa: E402
    dequantize_int8, matvec_int8, quantize_int8, quantize_model,
    read_model_bin, write_model_bin,
)

TINY = ModelConfig(
    name='qt', vocab_size=48, d_model=16, n_layers=2, n_heads=2, d_ff=32,
    max_seq_len=16, scratch_runnable=False,
)


def test_int8_roundtrip_error_is_small():
    """L'erreur relative de quantification reste sous 1 %."""
    rng = np.random.default_rng(0)
    w = rng.normal(size=(32, 64)).astype(np.float32)
    q, s = quantize_int8(w)
    w2 = dequantize_int8(q, s)
    err = np.abs(w - w2).max() / np.abs(w).max()
    assert err < 0.01, err
    assert q.dtype == np.int8
    assert (np.abs(q.astype(np.int32)) <= 127).all()


def test_matvec_int8_matches_float():
    """Le produit matriciel int8 reste proche du produit flottant."""
    rng = np.random.default_rng(1)
    w = rng.normal(size=(24, 32)).astype(np.float32)
    x = rng.normal(size=32).astype(np.float32)
    q, s = quantize_int8(w)
    y_int = matvec_int8(q, s, x)
    y_ref = w @ x
    rel = np.abs(y_int - y_ref).max() / max(1e-6, np.abs(y_ref).max())
    assert rel < 0.03, rel


def test_quantized_model_keeps_logits():
    """Un modèle entièrement quantifié garde des logits proches du float."""
    params = init_params(TINY, seed=3)
    model = NumpySorax(TINY, params)
    tokens = np.array([[1, 7, 12, 20, 4]])
    logits_ref, _, _ = model.forward(tokens)

    q_params = quantize_model(params, TINY)
    logits_q = _forward_quantized(q_params, TINY, tokens)
    ref_last = logits_ref[0, -1]                     # même position que le cache
    rel = np.abs(logits_q - ref_last).max() / np.abs(ref_last).max()
    assert rel < 0.12, rel
    print(f'  écart logits quantifiés : {rel * 100:.2f} %')


def _forward_quantized(qp, cfg: ModelConfig, tokens: np.ndarray) -> np.ndarray:
    """Logits sur poids quantifiés (chemin exact du runtime JS)."""
    from sorax.quantized_forward import QuantizedSorax
    model = QuantizedSorax(cfg, qp)
    cache = model.new_cache()
    logits = None
    for pos, tok in enumerate(tokens[0].tolist()):
        logits = model.forward_token(tok, pos, cache)
    return logits


def test_binary_roundtrip():
    """`sorax_core.bin` doit se relire à l'identique, tenseurs et en-tête."""
    params = quantize_model(init_params(TINY, seed=5), TINY)
    tokenizer = {'specials': ['<pad>'], 'byte_base': 5, 'merges': [[5, 6], [261, 7]]}
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, 'sorax_core.bin')
        header = write_model_bin(path, params, TINY, tokenizer)
        assert os.path.getsize(path) > 1000
        header2, tensors = read_model_bin(path)
        assert header2['version'] == header['version']
        assert header2['arch']['d_model'] == TINY.d_model
        assert header2['tokenizer']['merges'] == tokenizer['merges']
        for name, arr in tensors.items():
            if name.endswith('__scale'):
                continue
            np.testing.assert_array_equal(arr, params[name])
        # les échelles sont bien présentes et positives
        scales = [n for n in tensors if n.endswith('__scale')]
        assert scales and all((tensors[s] > 0).all() for s in scales)


def test_param_count_is_consistent():
    params = init_params(TINY)
    assert param_count(params) == TINY.n_params, (param_count(params), TINY.n_params)


if __name__ == '__main__':
    failures = 0
    for name, fn in sorted(list(globals().items())):
        if name.startswith('test_') and callable(fn):
            try:
                fn()
                print(f'✔ {name}')
            except AssertionError as exc:
                failures += 1
                print(f'✘ {name} : {exc}')
    raise SystemExit(failures)
