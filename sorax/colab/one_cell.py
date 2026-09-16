#@title Sorax — toute la chaîne (Drive → corpus → entraînement T4 → .sb3 → vérifications) { display-mode: "form" }
# Projet Snowoo- · moteur Sorax · langage cible ScratchScript
# Un seul bouton « Exécuter » : tout se fait ici, et tout atterrit sur Google Drive.

import os
import shutil
import subprocess
import sys
import time

# ─────────────────────────────── PARAMÈTRES ────────────────────────────────
PALIER        = 'nano'                    # pico | nano | mini | plus
CORPUS_PRESET = 'colab'                   # demo (2 000) | colab (40 000) | maxi (120 000)
STEPS         = '4000'                    # pas d'entraînement GPU (~25 min en nano/T4)
BATCH_SIZE    = '32'
REPO          = '/content/incode'
BRANCHE       = 'arena/01a0aa1f-incode'   # mets 'develop' après le merge de la PR #9
REPO_URL      = 'https://github.com/Snowoo-2z/incode.git'
DRIVE         = '/content/drive/MyDrive/sorax'
# ───────────────────────────────────────────────────────────────────────────

DEMANDES = [
    'Cree un jeu de Pong avec un score',
    'Un personnage qui saute sur des plateformes',
    'Ajoute un chronometre de 30 secondes',
]


def titre(texte):
    print('\n' + '═' * 66 + f'\n  {texte}\n' + '═' * 66, flush=True)


def lancer(commande, tolerant=False, cwd=None):
    """Exécute une commande en laissant la sortie défiler en direct."""
    print(f'$ {" ".join(commande)}\n', flush=True)
    resultat = subprocess.run(commande, cwd=cwd or REPO)
    if resultat.returncode != 0:
        if tolerant:
            print(f'⚠️  code {resultat.returncode} (on continue)', flush=True)
            return resultat.returncode
        raise SystemExit(f'✘ échec ({resultat.returncode}) : {" ".join(commande)}')
    return 0


debut = time.time()

# ── 0. Google Drive : les artefacts survivent à la fermeture du navigateur ─
titre('0. Google Drive')
try:
    from google.colab import drive
    if not os.path.ismount('/content/drive'):
        drive.mount('/content/drive')
    sur_colab = True
except Exception as erreur:                                     # exécution hors Colab
    print(f'(pas sur Colab : {erreur} — on continue sans Drive)')
    sur_colab = False
    DRIVE = os.environ.get('SORAX_DRIVE', DRIVE)
for sous in ('corpus', f'checkpoints/{PALIER}', f'export/{PALIER}', 'sb3'):
    os.makedirs(os.path.join(DRIVE, sous), exist_ok=True)
print('espace de travail :', DRIVE)

# ── 1. Le dépôt ────────────────────────────────────────────────────────────
titre('1. Le dépôt')
if os.path.isdir(os.path.join(REPO, '.git')):
    lancer(['git', '-C', REPO, 'fetch', '--depth', '1', 'origin', BRANCHE], tolerant=True)
    lancer(['git', '-C', REPO, 'checkout', '-q', BRANCHE], tolerant=True)
    lancer(['git', '-C', REPO, 'reset', '--hard', f'origin/{BRANCHE}'], tolerant=True)
    lancer(['git', '-C', REPO, 'clean', '-fd', 'sorax/tools'], tolerant=True)
else:
    lancer(['git', 'clone', '--depth', '1', '--branch', BRANCHE, REPO_URL, REPO],
           cwd=os.path.dirname(REPO) or '/')
lancer(['git', '-C', REPO, 'log', '--oneline', '-1'], tolerant=True)
sys.path.insert(0, os.path.join(REPO, 'sorax'))

# ── 2. Environnement ───────────────────────────────────────────────────────
titre('2. Environnement')
try:
    import torch
    print('torch', torch.__version__, '| CUDA :', torch.cuda.is_available())
    if torch.cuda.is_available():
        print('GPU :', torch.cuda.get_device_name(0))
    elif sur_colab:
        print("⚠️  pas de GPU : Exécution ▸ Modifier le type d'exécution ▸ T4 GPU")
except ImportError:
    print('⚠️  torch absent : installe-le (pip install torch) — sans GPU, utilise STEPS réduit')
print('node', subprocess.run(['node', '--version'], capture_output=True, text=True).stdout.strip())

# ── 3. Grammaire, corpus, tokenizer ────────────────────────────────────────
titre('3. Grammaire, corpus, tokenizer')
lancer(['node', 'sorax/tools/dump_grammar.mjs', '--out',
        os.path.join(DRIVE, 'grammar.json')])
if not os.path.exists(os.path.join(DRIVE, 'corpus', 'train.jsonl')):
    lancer(['python', 'sorax/tools/make_corpus.py', '--preset', CORPUS_PRESET,
            '--out', os.path.join(DRIVE, 'corpus')])
else:
    print('corpus déjà présent :',
          sum(1 for _ in open(os.path.join(DRIVE, 'corpus', 'train.jsonl'), encoding='utf-8')),
          'exemples d\'entraînement')
if not os.path.exists(os.path.join(DRIVE, 'tokenizer.json')):
    lancer(['python', 'sorax/tools/build_tokenizer.py', '--corpus',
            os.path.join(DRIVE, 'corpus'), '--out', os.path.join(DRIVE, 'tokenizer.json')])
else:
    print('tokenizer déjà présent')
tokenizer_src = os.path.join(DRIVE, 'tokenizer.json')
shutil.copyfile(tokenizer_src, os.path.join(REPO, 'sorax/assets/tokenizer.json'))

# ── 4. Entraînement GPU ────────────────────────────────────────────────────
titre(f'4. Entraînement GPU — palier {PALIER}, {STEPS} pas')
checkpoints = os.path.join(DRIVE, 'checkpoints', PALIER)
commande = ['python', 'sorax/tools/train_torch.py',
            '--config', PALIER,
            '--corpus', os.path.join(DRIVE, 'corpus'),
            '--tokenizer', tokenizer_src,
            '--out', checkpoints,
            '--steps', STEPS, '--batch-size', BATCH_SIZE]
dernier = os.path.join(checkpoints, 'last.npz')
if os.path.exists(dernier):
    print('reprise depuis', dernier, '(relance autant de fois que tu veux)')
    commande += ['--resume', dernier]
lancer(commande, tolerant=True)

# ── 5. Export int8 + projet Scratch ────────────────────────────────────────
titre('5. Export int8 + projet Scratch')
export = os.path.join(DRIVE, 'export', PALIER)
checkpoint = os.path.join(checkpoints, 'best.npz')
if not os.path.exists(checkpoint):
    checkpoint = dernier
lancer(['python', 'sorax/tools/export.py',
        '--config', PALIER, '--ckpt', checkpoint,
        '--corpus', os.path.join(DRIVE, 'corpus'), '--tokenizer', tokenizer_src,
        '--out', export], tolerant=True)
sb3_local = os.path.join(REPO, 'sorax/assets/export', PALIER, 'sorax-scratch.sb3')
lancer(['node', 'sorax/tools/build_sb3.mjs',
        '--bin', os.path.join(export, 'sorax_core.bin'),
        '--out', sb3_local,
        '--context', '128', '--max-new', '48'], tolerant=True)
if os.path.exists(sb3_local):
    cible = os.path.join(DRIVE, 'sb3', f'sorax-scratch-{PALIER}.sb3')
    shutil.copyfile(sb3_local, cible)
    static = os.path.join(REPO, 'static/sorax')
    os.makedirs(static, exist_ok=True)
    shutil.copyfile(sb3_local, os.path.join(static, 'sorax-scratch.sb3'))
    print(f'\n✔ projet Scratch : {cible} ({os.path.getsize(cible) / 1024:.0f} Ko)')

# ── 6. Vérifications ───────────────────────────────────────────────────────
titre('6. Vérifications (NumPy ↔ JS ↔ blocs Scratch)')
bin_final = os.path.join(export, 'sorax_core.bin')
if os.path.exists(bin_final):
    print('── structure du .sb3');                 lancer(['node', 'sorax/tools/validate_sb3.mjs'], tolerant=True)
    print('── parité NumPy ↔ JS');                 lancer(['python', 'sorax/tools/check_runtime_parity.py', bin_final], tolerant=True)
    print('── parité blocs Scratch ↔ JS');         lancer(['node', 'sorax/tools/test_scratch_engine.mjs',
                                                          '--sb3', sb3_local, '--bin', bin_final,
                                                          '--prompt', 'abc', '--tokens', '3'], tolerant=True)
    print('── décodeur, jeton par jeton');         lancer(['node', 'sorax/tools/test_decode.mjs',
                                                          '--sb3', sb3_local, '--bin', bin_final], tolerant=True)

# ── 7. Sorax répond ────────────────────────────────────────────────────────
titre('7. Sorax répond (le projet s\'exécute pour de vrai)')
for demande in DEMANDES:
    print(f'\n▸ « {demande} »', flush=True)
    lancer(['node', 'sorax/tools/run_sb3.mjs', '--sb3', sb3_local, '--bin', bin_final,
            demande], tolerant=True)

# ── 8. Archive ─────────────────────────────────────────────────────────────
titre('8. Tout ranger sur Drive')
import zipfile
archive = os.path.join(DRIVE, 'sb3', f'sorax-{PALIER}.zip')
a_ranger = [(os.path.join(export, 'sorax_core.bin'), 'sorax_core.bin'),
            (os.path.join(export, 'sorax_meta.json'), 'sorax_meta.json'),
            (os.path.join(DRIVE, 'sb3', f'sorax-scratch-{PALIER}.sb3'),
             f'sorax-scratch-{PALIER}.sb3'),
            (tokenizer_src, 'tokenizer.json'),
            (os.path.join(checkpoints, 'best.npz'), 'checkpoints/best.npz'),
            (dernier, 'checkpoints/last.npz'),
            (os.path.join(checkpoints, 'rapport_entrainement.json'),
             'checkpoints/rapport_entrainement.json')]
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
    for chemin, nom in a_ranger:
        if os.path.exists(chemin):
            z.write(chemin, nom)
print('archive :', archive, f'({os.path.getsize(archive) / 1e6:.1f} Mo)')

print(f'''
{'═' * 66}
  Terminé en {(time.time() - debut) / 60:.1f} min
{'═' * 66}
  Projet Scratch : {os.path.join(DRIVE, 'sb3', f'sorax-scratch-{PALIER}.sb3')}
  Poids int8     : {bin_final}
  Archive        : {archive}

  Ouvre le .sb3 dans TurboWarp (ou Scratch), clique sur le drapeau vert,
  clique sur Sorax, tape ta demande : le réseau s'explique en blocs.
  Relance cette cellule autant de fois que tu veux : l'entraînement reprend
  là où il s'est arrêté (last.npz sur Drive).
{'═' * 66}''')
