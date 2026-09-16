"""Export d'un checkpoint vers le format exécutable `sorax_core.bin`.

Étapes :

1. quantification int8 (par canal) des matrices, norms laissées en float32 ;
2. écriture du binaire (en-tête JSON + tenseurs + tokenizer embarqué) ;
3. empreinte SHA-256, rapport lisible `sorax_meta.json` ;
4. évaluation rapide : perte flottante vs quantifiée, et quelques générations,
   pour voir immédiatement si le modèle produit du ScratchScript valide.

Le binaire est autosuffisant : il contient le tokenizer, donc aucun fichier
annexe n'est nécessaire pour l'exécuter (navigateur, TurboWarp ou Scratch).
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Dict, List, Optional

import numpy as np

from .configs import ModelConfig
from .corpus import Sample
from .dataset import read_samples
from .model_spec import TOK_EMB, FINAL_NORM, attn_norm, ffn_norm, w1, w2, wo, wqkv
from .quantize import quantize_model, read_model_bin, write_model_bin
from .quantized_forward import QuantizedSorax
from .tokenizer import Tokenizer


def sha256_file(path: str) -> str:
    """Empreinte SHA-256 d'un fichier (affichée dans le rapport et l'IDE)."""
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def cross_entropy_quantized(model: QuantizedSorax, tokenizer: Tokenizer,
                            samples: List[Sample], limit: int = 24) -> Optional[float]:
    """Perte d'entropie croisée mesurée avec le chemin **quantifié** (référence JS).

    On n'évalue que la fin de séquence (réponse), comme à l'entraînement.
    """
    if not samples:
        return None
    total, count = 0.0, 0
    for sample in samples[:limit]:
        from .configs import ASSISTANT_ID, TASK_TAGS
        tag = TASK_TAGS.get(sample.task, '<chat>')
        ids = tokenizer.encode(tag + sample.prompt, add_bos=True) + [ASSISTANT_ID]
        answer = tokenizer.encode(sample.answer, add_eos=True)
        seq = ids + answer
        if len(seq) > model.cfg.max_seq_len:
            seq = seq[:model.cfg.max_seq_len]
        cache = model.new_cache()
        logits = None
        for pos, tok in enumerate(seq[:-1]):
            logits = model.forward_token(tok, pos, cache)
            target = seq[pos + 1]
            if pos + 1 >= len(ids):            # on ne score que la réponse
                z = logits.astype(np.float64)
                z -= z.max()
                logsumexp = float(np.log(np.exp(z).sum()))
                total += float(logsumexp - z[target])
                count += 1
    return round(total / max(1, count), 4) if count else None


def export_model(
    checkpoint: str,
    cfg: ModelConfig,
    tokenizer: Tokenizer,
    out_dir: str,
    val_samples: Optional[List[Sample]] = None,
    demo_prompts: Optional[List[tuple]] = None,
    verbose: bool = True,
) -> dict:
    """Exporte un checkpoint `.npz` vers `sorax_core.bin` + rapport.

    :param demo_prompts: liste de ``(tâche, demande)`` pour les exemples du rapport
    :returns: manifeste (chemins, tailles, empreinte, statistiques)
    """
    from .train import load_checkpoint

    os.makedirs(out_dir, exist_ok=True)
    t0 = time.time()
    params = load_checkpoint(checkpoint)
    if verbose:
        print(f'  quantification int8 de {cfg.n_params:,} paramètres…')
    quantized = quantize_model(params, cfg)

    bin_path = os.path.join(out_dir, 'sorax_core.bin')
    header = write_model_bin(
        bin_path, quantized, cfg, tokenizer.to_dict(),
        extra={'author': 'Snowoo-', 'checkpoint': os.path.basename(checkpoint)},
    )

    header_out, tensors = read_model_bin(bin_path)
    size_bytes = os.path.getsize(bin_path)
    model = QuantizedSorax(cfg, tensors)

    eval_report: Dict[str, object] = {}
    if val_samples:
        eval_report['perte_quantifiee'] = cross_entropy_quantized(model, tokenizer, val_samples)
    demos = []
    for task, prompt in (demo_prompts or []):
        answer = model.generate(
            tokenizer, prompt, task=task, max_new_tokens=120,
            temperature=0.7, top_k=40, seed=1234,
        )
        demos.append({'tache': task, 'demande': prompt, 'reponse': answer})
    eval_report['exemples'] = demos

    manifest = {
        'nom': 'Sorax',
        'auteur': 'Snowoo-',
        'palier': cfg.name,
        'fichier': os.path.basename(bin_path),
        'octets': size_bytes,
        'mo': round(size_bytes / (1024 * 1024), 3),
        'parametres': cfg.n_params,
        'contexte': cfg.max_seq_len,
        'vocabulaire': tokenizer.vocab_size,
        'sha256': sha256_file(bin_path),
        'quantification': 'int8 par canal (poids) / int8 dynamique (activations)',
        'tensors': len(header_out['tensors']),
        'checkpoint': os.path.abspath(checkpoint),
        'duree_export_s': round(time.time() - t0, 2),
        'evaluation': eval_report,
    }
    meta_path = os.path.join(out_dir, 'sorax_meta.json')
    with open(meta_path, 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)

    manifest['bin'] = bin_path
    manifest['meta'] = meta_path
    if verbose:
        print(f'  ✔ {bin_path} ({manifest["mo"]} Mo, sha256 {manifest["sha256"][:12]}…)')
        for demo in demos:
            first = demo['reponse'].strip().splitlines()[0] if demo['reponse'].strip() else '(vide)'
            print(f'    [{demo["tache"]}] {demo["demande"][:48]}… -> {first[:64]}')
    return manifest


def default_demo_prompts() -> List[tuple]:
    """Demandes d'exemple utilisées dans le rapport d'export."""
    return [
        ('code', 'Cree un jeu de Pong avec deux raquettes et un score'),
        ('code', 'Un jeu de collecte ou on ramasse des pieces avant la fin du chrono'),
        ('doc', 'A quoi sert le bloc bounce ?'),
        ('chat', 'salut'),
    ]


__all__ = ['export_model', 'sha256_file', 'cross_entropy_quantized', 'default_demo_prompts']
