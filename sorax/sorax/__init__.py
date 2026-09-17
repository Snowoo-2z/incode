"""Sorax — moteur d'IA embarquable dans Scratch (projet Snowoo-).

Le paquet expose les briques utilisées par les scripts de `sorax/tools/` et par
les notebooks Colab :

- :mod:`sorax.configs`    — paliers de modèles (pico / nano / mini / plus) et chemins
- :mod:`sorax.tokenizer`  — BPE au niveau octet (vocabulaire partagé, décodable)
- :mod:`sorax.grammar`    — lecture de la grammaire ScratchScript extraite de l'IDE
- :mod:`sorax.corpus`     — génération du corpus d'entraînement (tâches code/edit/explain/fix)
- :mod:`sorax.nn_numpy`   — forward/backward de référence en NumPy
- :mod:`sorax.quantize`   — quantification int8 par canal + format binaire `sorax_core.bin`
"""

__version__ = '1.0.0'
__author__ = 'Snowoo-'

from .configs import CONFIGS, get_config, PATHS  # noqa: F401

__all__ = ['CONFIGS', 'get_config', 'PATHS', '__version__']
