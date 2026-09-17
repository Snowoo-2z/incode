"""Quantification int8 et format binaire `sorax_core.bin`.

Le format est **la** frontière entre l'entraînement (Python) et l'exécution
(JavaScript, Scratch). Il est défini une seule fois, ici, et vérifié par
`sorax/tests/test_runtime_parity.py` : les logits NumPy et JS doivent coïncider
à 1e-3 près sur le même fichier.

Choix techniques
----------------
* **Poids** : quantification symétrique **par ligne** (un facteur d'échelle par
  neurone de sortie). C'est ce qui préserve le mieux la qualité pour un coût
  nul à l'exécution : ``y[o] = acc[o] · s_w[o] · s_a``.
* **Activations** : quantification dynamique **par vecteur** (un facteur par
  multiplication), recalculée à chaque appel — comme un vrai moteur int8.
* **Norms** : conservées en float32 (32 à 384 valeurs, négligeable).
* Les produits scalaires sont faits en **entiers** (int32) : en Scratch comme
  en JavaScript, l'addition d'entiers est exacte et rapide.
"""

from __future__ import annotations

import json
import struct
from typing import Dict, List, Tuple

import numpy as np

from .configs import ModelConfig, SPECIAL_TOKENS
from .model_spec import TOK_EMB, tensor_layout

MAGIC = b'SORAX1\x00\x00'
FORMAT_VERSION = 1
SCALE_FLOOR = 1e-8
ACT_SCALE_FLOOR = 1e-8


# --------------------------------------------------------------------------- #
# Quantification
# --------------------------------------------------------------------------- #

def quantize_int8(weights: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """Quantifie une matrice ``[O, I]`` : renvoie ``(int8, échelles [O])``."""
    w = weights.astype(np.float32)
    scales = np.abs(w).max(axis=1)
    scales = np.where(scales < SCALE_FLOOR, SCALE_FLOOR, scales) / 127.0
    q = np.clip(np.round(w / scales[:, None]), -127, 127).astype(np.int8)
    return q, scales.astype(np.float32)


def dequantize_int8(q: np.ndarray, scales: np.ndarray) -> np.ndarray:
    """Reconstruit la matrice flottante (utilisé par les tests de fidélité)."""
    return q.astype(np.float32) * scales[:, None]


def quantize_activations(x: np.ndarray) -> Tuple[np.ndarray, float]:
    """Quantifie un vecteur d'activation en int8 (échelle unique)."""
    peak = float(np.abs(x).max()) if x.size else 0.0
    scale = peak / 127.0 if peak > ACT_SCALE_FLOOR else ACT_SCALE_FLOOR
    q = np.clip(np.round(x / scale), -127, 127).astype(np.int8)
    return q, scale


def matvec_int8(wq: np.ndarray, w_scales: np.ndarray, x: np.ndarray) -> np.ndarray:
    """``y = W @ x`` avec le même chemin de calcul que le runtime JS.

    1. quantifier ``x`` en int8 (échelle unique) ;
    2. produits scalaires **entiers** ;
    3. re-mise à l'échelle ``acc · s_w[o] · s_x``.

    Cette fonction est la référence *bit à bit* du moteur Scratch : si le
    résultat JS diffère, c'est un bug du runtime, pas de la quantification.
    """
    xq, sx = quantize_activations(x)
    acc = (wq.astype(np.int32) @ xq.astype(np.int32)).astype(np.float32)
    return acc * w_scales * sx


def quantize_model(params: Dict[str, np.ndarray], cfg: ModelConfig) -> Dict[str, np.ndarray]:
    """Quantifie toutes les matrices d'un modèle ; garde les norms en float32.

    Chaque matrice ``w`` produit ``w`` (int8) et ``w__scale`` (f32 par ligne) :
    les deux sont écrits côte à côte dans le binaire.
    """
    out: Dict[str, np.ndarray] = {}
    for name, shape, dtype in tensor_layout(cfg):
        if name not in params:
            raise KeyError(f'tenseur manquant dans le checkpoint : {name}')
        value = params[name].astype(np.float32).reshape(shape)
        if dtype == 'i8':
            q, scales = quantize_int8(value)
            out[name] = q
            out[f'{name}__scale'] = scales
        else:
            out[name] = value
    return out


# --------------------------------------------------------------------------- #
# Format binaire
# --------------------------------------------------------------------------- #

def _pad4(n: int) -> int:
    return (4 - (n % 4)) % 4


def write_model_bin(
    path: str,
    params: Dict[str, np.ndarray],
    cfg: ModelConfig,
    tokenizer: dict,
    extra: dict | None = None,
) -> dict:
    """Écrit `sorax_core.bin` : en-tête JSON + tenseurs binaires alignés sur 4.

    :param params: poids **quantifiés** (sortie de `quantize_model`)
    :returns: l'en-tête effectivement écrit (utile pour le rapport d'export)
    """
    tensors: List[dict] = []
    payload = bytearray()

    for name, shape, dtype in tensor_layout(cfg):
        if dtype == 'i8':
            entries = [(name, shape, 'i8', params[name].astype(np.int8).tobytes())]
            scale_name = f'{name}__scale'
            if scale_name in params:
                entries.append((scale_name, (shape[0],), 'f32',
                                params[scale_name].astype('<f4').tobytes()))
        else:
            entries = [(name, shape, 'f32', params[name].astype('<f4').tobytes())]
        for tname, tshape, ttype, raw in entries:
            while len(payload) % 4:
                payload.append(0)
            offset = len(payload)
            payload += raw
            tensors.append({
                'name': tname,
                'dtype': ttype,
                'shape': list(tshape),
                'offset': offset,
                'length': len(raw),
            })

    header = {
        'format': 'sorax-core',
        'version': FORMAT_VERSION,
        'arch': cfg.to_dict(),
        'tokenizer': tokenizer,
        'specials': SPECIAL_TOKENS,
        'tensors': tensors,
        'payload_bytes': len(payload),
        'extra': extra or {},
    }
    header_bytes = json.dumps(header, ensure_ascii=False, separators=(',', ':')).encode('utf-8')

    with open(path, 'wb') as fh:
        fh.write(MAGIC)
        fh.write(struct.pack('<I', len(header_bytes)))
        fh.write(header_bytes)
        fh.write(bytes(payload))
    return header


def read_model_bin(path: str) -> Tuple[dict, Dict[str, np.ndarray]]:
    """Relit un `sorax_core.bin` (utilisé par les tests et le débogage)."""
    with open(path, 'rb') as fh:
        blob = fh.read()
    assert blob[:8] == MAGIC, 'magie invalide'
    (header_len,) = struct.unpack('<I', blob[8:12])
    header = json.loads(blob[12:12 + header_len].decode('utf-8'))
    payload = blob[12 + header_len:]
    tensors: Dict[str, np.ndarray] = {}
    for t in header['tensors']:
        raw = payload[t['offset']:t['offset'] + t['length']]
        if t['dtype'] == 'i8':
            arr = np.frombuffer(raw, dtype=np.int8).reshape(t['shape'])
        else:
            arr = np.frombuffer(raw, dtype='<f4').reshape(t['shape'])
        tensors[t['name']] = arr
    return header, tensors


def model_size_mb(path: str) -> float:
    """Taille du fichier en Mo."""
    return round(len(open(path, 'rb').read()) / (1024 * 1024), 3)


__all__ = [
    'quantize_int8', 'dequantize_int8', 'quantize_activations', 'matvec_int8',
    'quantize_model', 'write_model_bin', 'read_model_bin', 'model_size_mb',
    'MAGIC', 'FORMAT_VERSION',
]
