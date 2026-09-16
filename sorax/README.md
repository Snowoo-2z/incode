# Sorax — le LLM qui tourne dans Scratch

> Projet **Snowoo-** · moteur **Sorax** · langage cible **ScratchScript**

Sorax est un **grand modèle de langage (LLM) entraîné de zéro**, puis **compressé en données**
pour être exécuté à l'intérieur d'un projet Scratch : pas d'API, pas de serveur, pas de
connexion — le réseau de neurones est *dans le `.sb3`*.

```
   Colab T4                     dump (int8)                  Scratch / TurboWarp
┌──────────────┐   export    ┌──────────────┐   build    ┌──────────────────────┐
│ corpus       │ ─────────▶  │ sorax_core   │ ─────────▶ │ Sorax.sb3            │
│ tokenizer    │             │ .bin + meta  │            │  → liste poids       │
│ pré-entraîné │             │  (int8)      │            │  → blocs = forward() │
└──────────────┘             └──────────────┘            │  → « ask » = chat    │
                                                        └──────────────────────┘
```

## Ce que sait faire Sorax

| Tâche | Entrée (français) | Sortie |
|---|---|---|
| `code` | « Crée un jeu de Pong avec un score » | programme **ScratchScript** valide |
| `edit` | « Ajoute un chronomètre au projet » | directives d'édition ciblées |
| `explain` | « Explique ce que fait ce script » | explication en français |
| `fix` | « Corrige ce script » | script réparé |
| `doc` | « À quoi sert le bloc `glidexy` ? » | réponse courte |

Toutes les sorties `code` sont **validées par le compilateur réel** de l'IDE
(`src/lib/ai-agent/dsl-parser.js` → `block-builder.js`) : le corpus d'entraînement est refusé
si un échantillon ne compile pas. Sorax ne peut donc pas inventer de blocs inexistants.

## Paliers de taille

| Palier | Params | Contexte | Où il tourne | Poids |
|---|---|---|---|---|
| **Pico** | ~90 k | 128 | Scratch vanilla (scratch.mit.edu) | ~0,4 Mo |
| **Nano** | ~150 k | 192 | Scratch / TurboWarp — *palier par défaut* | ~0,7 Mo |
| **Mini** | ~5 M | 384 | TurboWarp + runtime JS (ou extension) | ~5 Mo |
| **Plus** | ~14 M | 512 | navigateur (assistant Sorax intégré à l'IDE) | ~14 Mo |

Le palier **Scratch pur** stocke chaque poids en int8 dans des **listes Scratch** et exécute
le *forward pass* avec de vrais blocs (multiplications matricielles, RMSNorm, RoPE, softmax,
échantillonnage). Aucune extension n'est requise.

## Démarrage rapide

```bash
# 1. (une fois) installer l'outillage
pip install -r sorax/requirements.txt          # numpy (local) — torch sur Colab

# 2. extraire la grammaire réelle des blocs depuis le dépôt
node sorax/tools/dump_grammar.mjs

# 3. générer le corpus + l'entraîner (ou passer par les notebooks Colab)
python sorax/tools/make_corpus.py --preset demo
python sorax/tools/train.py --config nano --preset demo --out sorax/assets/checkpoints/nano-demo

# 4. exporter + construire le projet Scratch
python sorax/tools/export.py --config nano --ckpt sorax/assets/checkpoints/nano-demo
python sorax/tools/build_sb3.py --config nano            # -> dist_sorax/Sorax-Nano.sb3
```

Sur Colab (T4), tout se fait depuis les notebooks de `sorax/colab/` — voir
[`docs/01_PIPELINE.md`](docs/01_PIPELINE.md).

## Structure

```
sorax/
├── sorax/            paquet Python (tokenizer, corpus, modèles, quantification, export)
├── tools/            scripts CLI (dump_grammar, make_corpus, train, export, build_sb3…)
├── runtime/          moteur d'inférence JavaScript (navigateur + TurboWarp)
├── assets/           artefacts générés (grammaire, tokenizer, corpus, poids, checkpoints)
├── colab/            notebooks T4 prêts à l'emploi
├── tests/            tests unitaires + parité numpy ↔ JS
└── docs/             documentation détaillée (FR)
```

Dans l'IDE, le moteur est exposé par le bouton **« Download Sorax »** (à gauche du drapeau vert)
et par le menu **Sorax**. Voir [`docs/04_GUI.md`](docs/04_GUI.md).
