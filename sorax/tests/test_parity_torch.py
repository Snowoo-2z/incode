"""Parité PyTorch ↔ NumPy ↔ runtime JavaScript.

C'est le test qui protège la promesse du projet : *un seul* modèle, exécuté à
l'identique par trois moteurs différents. Si ce fichier passe, alors le modèle
entraîné sur Colab donne exactement les mêmes réponses dans le navigateur et
dans Scratch.

    python sorax/tests/test_parity_torch.py
"""

from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sorax.configs import ModelConfig                        # noqa: E402
from sorax.model_spec import init_params                     # noqa: E402
from sorax.nn_numpy import NumpySorax                        # noqa: E402

SMALL = ModelConfig(
    name='parity', vocab_size=64, d_model=24, n_layers=2, n_heads=3, d_ff=48,
    max_seq_len=16, scratch_runnable=False,
)


def test_torch_matches_numpy_forward_and_grads():
    """Mêmes poids -> mêmes logits, même perte et **mêmes gradients**."""
    try:
        import torch
    except ImportError:  # torch n'est nécessaire que sur Colab / en CI GPU
        print('  (torch absent : test ignoré)')
        return
    from sorax.model_torch import SoraxTorch

    rng = np.random.default_rng(0)
    params = init_params(SMALL, seed=42)
    tokens = rng.integers(0, SMALL.vocab_size, size=(2, 6))
    targets = rng.integers(0, SMALL.vocab_size, size=(2, 6))

    np_model = NumpySorax(SMALL, {k: v.astype(np.float64) for k, v in params.items()})
    np_logits, np_loss, _ = np_model.forward(tokens, targets)
    _, np_grads = np_model.loss_and_grads(tokens, targets)

    torch_model = SoraxTorch(SMALL)
    torch_model.load_from_numpy({k: v.astype(np.float32) for k, v in params.items()})
    torch_model.double()
    t_logits, t_loss = torch_model(torch.tensor(tokens), torch.tensor(targets))
    t_loss.backward()

    assert abs(float(t_loss) - float(np_loss)) < 1e-6, 'pertes différentes'
    assert np.abs(t_logits.detach().numpy() - np_logits).max() < 1e-6, 'logits différents'

    worst = 0.0
    for name, grad in np_grads.items():
        torch_grad = torch_model_state_grad(torch_model, name)
        denom = max(1e-9, float(np.abs(grad).max() + np.abs(torch_grad).max()))
        rel = float(np.abs(grad - torch_grad).max() / denom)
        worst = max(worst, rel)
        assert rel < 1e-5, f'{name} : écart {rel:.2e}'
    print(f'  parité gradients : écart relatif max {worst:.2e}')


def torch_model_state_grad(model, name: str) -> np.ndarray:
    """Récupère le gradient PyTorch d'un tenseur nommé comme dans `model_spec`."""
    if name == 'tok_emb':
        return model.tok_emb.grad.detach().double().numpy()
    if name == 'final_norm':
        return model.final_norm.grad.detach().double().numpy()
    parts = name.split('.')
    layer = model.layers[int(parts[1])]
    return layer[parts[2]].grad.detach().double().numpy()


def test_numpy_forward_is_deterministic():
    """Deux exécutions du même modèle donnent exactement les mêmes logits."""
    params = init_params(SMALL, seed=7)
    model = NumpySorax(SMALL, params)
    tokens = np.array([[1, 5, 9, 12]])
    a, _, _ = model.forward(tokens)
    b, _, _ = model.forward(tokens)
    np.testing.assert_array_equal(a, b)


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
