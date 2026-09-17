# Sorax — le LLM qui tourne dans Scratch

> Projet **Snowoo-** · moteur **Sorax** · langage cible **ScratchScript**

Sorax est un **grand modèle de langage entraîné de zéro**, puis **compressé en données**
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

## Le moteur Scratch (palier nano)

`runtime/scratch-engine.js` écrit le réseau **en blocs Scratch** : listes de poids
(`Poids`, `Echelles`, `Normes`), cache `CacheK`/`CacheV`, tables `TableCos`/`TableSin`,
tables du tokenizer (`OctetsChars`, `Ponctuation`, `TokOctets`, `TokOffset`) et les
procédures *warp* `Matvec`, `Norme`, `Ajoute`, `Copie`, `Silu`, `Attention`, `Tete`,
`Echantillonne`, `Encode`, `Decode`, `Passe`.

Propriétés vérifiées :

* **mêmes résultats que le runtime JS** : jetons d'entrée, logits étape par étape et texte
  décodé sont identiques (écart relatif max ~2·10⁻⁵, dû aux seuls arrondis d'affichage
  des listes Scratch → voir `tools/test_scratch_engine.mjs`) ;
* le décodeur reproduit exactement `utf8Decode` du runtime (1 à 4 octets par caractère,
  paires de substitution comprises) ; limite assumée : les points de code au-delà de
  `U+07FF` hors plage de ponctuation sont écrits `?` — le français, l'ASCII et la
  ponctuation sont, eux, restitués à l'identique ;
* **aucune extension**, aucun bloc « hacked » : uniquement des blocs standard, donc le
  projet s'ouvre aussi bien dans Scratch que dans TurboWarp ;
* le projet réellement livré s'exécute de bout en bout, échantillonnage compris :
  `node sorax/tools/run_sb3.mjs "Crée un jeu de Pong"`.

### Boucle d'exécution

| Bloc | Rôle |
|---|---|
| drapeau vert | construit les listes, armé = `sx pret` |
| clic sur le sprite / touche espace | demande la consigne (`ask`), puis diffuse `SoraxGenere` |
| `SoraxGenere` | `Encode` la consigne → préremplissage (`Passe %s` pour chaque jeton) → `Tete` → boucle `Echantillonne` / `Decode` / `Passe %s` |
| `Historique` | garde les demandes précédentes |

## Démarrage rapide

```bash
# 1. (une fois) installer l'outillage Python
pip install -r sorax/requirements.txt          # numpy (local) — torch sur Colab

# 2. extraire la grammaire réelle des blocs depuis le dépôt
node sorax/tools/dump_grammar.mjs

# 3. générer le corpus et le tokenizer
python sorax/tools/make_corpus.py --preset demo
python sorax/tools/build_tokenizer.py

# 4a. entraîner sur GPU (Colab T4) — le chemin normal
python sorax/tools/train_torch.py --config nano \
    --corpus sorax/assets/corpus --tokenizer sorax/assets/tokenizer.json \
    --out sorax/assets/checkpoints/nano-torch --steps 4000

# 4b. ou en NumPy (lent, sans GPU : sert à valider la chaîne)
python sorax/tools/train.py --config nano --steps 300 --out sorax/assets/checkpoints/nano-local

# 5. exporter le dump int8
python sorax/tools/export.py --config nano --ckpt sorax/assets/checkpoints/nano-torch/last.npz

# 5. fabriquer le projet Scratch
node sorax/tools/build_sb3.mjs \
  --bin sorax/assets/export/nano/sorax_core.bin \
  --out sorax/assets/export/nano/sorax-scratch.sb3 \
  --context 128 --max-new 48
```

### Vérifications

```bash
# structure du .sb3 (opcodes, procédures, tailles de listes) — sans VM
node sorax/tools/validate_sb3.mjs

# parité NumPy ↔ runtime JS (tolérance 1e-3)
python sorax/tools/check_runtime_parity.py sorax/assets/export/nano/sorax_core.bin

# parité moteur Scratch ↔ runtime JS (micro-interpréteur, sans node_modules)
node sorax/tools/test_scratch_engine.mjs --prompt "abc" --tokens 3

# exécution réelle du projet livré (drapeau vert → réponse)
node sorax/tools/run_sb3.mjs "Crée un jeu de plates-formes"
```

`tools/scratch-vm.mjs` est le micro-interpréteur Scratch partagé (listes, variables,
opérateurs, boucles, procédures, diffusion) : il sert aux deux derniers scripts et
permet de valider le projet **sans `node_modules`**.

## Intégration à l'IDE

Le bouton **« download sorax »** se trouve juste à gauche du drapeau vert. Il n'est
visible que **hors de l'interface Sorax** (le terminal de l'assistant le masque) et
demande un **mot de passe écrit en dur** (`src/lib/sorax-download.js`) avant de
télécharger le projet. Ce n'est pas une sécurité : juste un sas pendant la bêta.

Le `.sb3` est embarqué par webpack (`file-loader`, règle `\.sb3$`) : il est copié dans
`static/sorax/` à la compilation, donc le téléchargement marche même hors ligne.

### Sur Colab (T4)

* `sorax/colab/one_cell.py` — **tout en une seule cellule** (à coller dans Colab) :
  Drive, corpus, tokenizer, entraînement GPU, export int8, `.sb3`, vérifications de parité,
  réponses de Sorax et archive finale ;
* `sorax/colab/Sorax_T4.ipynb` — la même chaîne découpée en cellules commentées, générée
  par `python sorax/colab/build_notebook.py`.

Dans les deux cas, les artefacts restent **sur Drive** : une coupure de Colab ne coûte
rien, l'entraînement reprend depuis `last.npz`.

```bash
npm install          # à défaut de réseau direct : NODE_EXTRA_CA_CERTS=… npm install
npm start            # éditeur + Sorax sur http://0.0.0.0:8601
npm run build        # build de production dans build/
```

## Structure

```
sorax/
├── sorax/            paquet Python (tokenizer, corpus, modèles, quantification, export)
├── tools/            scripts CLI (dump_grammar, make_corpus, train, train_torch, export,
│                     build_sb3, validate_sb3, test_scratch_engine, run_sb3, scratch-vm)
├── colab/            notebook T4 (Sorax_T4.ipynb) et son générateur
├── runtime/          moteur JS (sorax-runtime.js) + générateur de blocs (scratch-engine.js,
│                     sb3-builder.js)
├── assets/           artefacts générés (grammaire, tokenizer, corpus, poids, checkpoints)
└── tests/            tests unitaires Python + parité numpy ↔ torch
```
