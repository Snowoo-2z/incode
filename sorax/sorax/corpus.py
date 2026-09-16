"""Génération du corpus d'entraînement de Sorax.

Le corpus est **entièrement dérivé de sources vérifiables** :

* les programmes de référence et les fragments (`corpus_data.py`) sont du
  ScratchScript écrit à la main ;
* les descriptions de blocs proviennent de la même table que la documentation
  intégrée à l'IDE ;
* **tout** échantillon est re-parsé par le vrai compilateur ScratchScript
  (`tools/validate_corpus.mjs`) avant d'être accepté dans le corpus — un
  échantillon qui ne compile pas est rejeté, pas corrigé.

Tâches produites :

============  ==========================================================
``code``      demande en français -> programme ScratchScript complet
``edit``      état du projet (avec adresses) + consigne -> édition ciblée
``explain``   code -> explication en français
``fix``       code cassé + symptôme -> code réparé
``doc``       question sur un bloc -> réponse courte
``chat``      petite conversation d'assistance
============  ==========================================================
"""

from __future__ import annotations

import json
import os
import random
import re
from dataclasses import dataclass, field, asdict
from typing import Dict, Iterable, Iterator, List, Optional, Sequence, Tuple

from . import corpus_data as D
from .configs import TASK_TAGS
from .grammar import Grammar, MENU_VALUES
from .tokenizer import normalize_prompt

# --------------------------------------------------------------------------- #
# Structure d'un échantillon
# --------------------------------------------------------------------------- #


@dataclass
class Sample:
    """Un exemple d'entraînement (demande -> réponse)."""

    task: str
    prompt: str
    answer: str
    meta: Dict[str, object] = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, separators=(',', ':'))

    @classmethod
    def from_json(cls, line: str) -> 'Sample':
        data = json.loads(line)
        return cls(**data)


# --------------------------------------------------------------------------- #
# Mini-parseur ScratchScript (indentation -> arbre) + adresses
# --------------------------------------------------------------------------- #


@dataclass
class Stmt:
    """Une instruction du DSL avec ses branches éventuelles."""

    text: str
    depth: int
    children: List['Stmt'] = field(default_factory=list)
    children2: List['Stmt'] = field(default_factory=list)
    address: str = ''

    def walk(self) -> Iterator['Stmt']:
        yield self
        for child in self.children:
            yield from child.walk()
        for child in self.children2:
            yield from child.walk()


def parse_dsl(code: str) -> Dict[str, List[List[Stmt]]]:
    """Découpe un programme ScratchScript en ``cible -> [script, ...]``.

    Reproduit la logique du vrai parser : un nouveau script commence à chaque
    bloc-chapeau ou après une ligne vide ; ``if``/``else`` deviennent un seul
    bloc à deux branches.
    """
    hats = {
        'whenflagclicked', 'whenclicked', 'whenkey', 'whenreceive', 'whenclone',
        'whentimer', 'whenloudness', 'broadcastreceived', 'whenbackdrop',
    }
    targets: Dict[str, List[List[Stmt]]] = {}
    current_target = 'Stage'
    current_script: List[Stmt] = []
    stack: List[Tuple[int, Stmt]] = []

    def flush_script() -> None:
        nonlocal current_script
        if current_script:
            targets.setdefault(current_target, []).append(current_script)
            current_script = []

    for raw in code.split('\n'):
        line = raw.replace('\t', '  ')
        stripped = line.strip()
        indent = len(line) - len(line.lstrip(' '))
        if not stripped or stripped.startswith('#'):
            flush_script()
            stack = []
            continue

        # hors indentation : déclarations et en-têtes de cible
        if indent == 0:
            flush_script()
            stack = []
            if stripped.startswith(('sprite ', 'stage', 'scène', 'scene')):
                name = stripped.split(':', 1)[0].strip()
                current_target = 'Stage' if name in ('stage', 'scene', 'scène') else name[7:].strip()
                continue
            if stripped.startswith(('var ', 'variable ', 'list ')):
                continue
            if re.match(r'^(on|target)\s', stripped):
                continue

        depth = max(0, indent // 2 - 1)
        while stack and stack[-1][0] >= depth:
            stack.pop()
        text = stripped.rstrip(':').strip()
        node = Stmt(text=text, depth=depth)
        if stack:
            parent = stack[-1][1]
            (parent.children2 if text.lower() == 'else' else parent.children).append(node)
        else:
            head = text.split(' ', 1)[0].lower()
            if current_script and head in hats:
                flush_script()
            current_script.append(node)
        # une instruction conteneur ouvre une branche indentée
        if stripped.endswith(':'):
            stack.append((depth, node))
    flush_script()
    return targets


def address_scripts(scripts: Sequence[List[Stmt]]) -> List[Stmt]:
    """Renseigne ``address`` (format ``1/3.2~2.1``) sur tous les blocs d'une cible."""
    flat: List[Stmt] = []

    def walk_stack(nodes: Sequence[Stmt], prefix: str) -> None:
        for i, node in enumerate(nodes, start=1):
            node.address = f'{prefix}{i}'
            flat.append(node)
            if node.children:
                walk_stack(node.children, f'{node.address}.')
            if node.children2:
                walk_stack(node.children2, f'{node.address}~2.')

    for script_index, script in enumerate(scripts, start=1):
        walk_stack(script, f'{script_index}/')
    return flat


def addressed_listing(target: str, scripts: Sequence[List[Stmt]]) -> str:
    """Rendu « read <sprite> » : chaque bloc précédé de son adresse."""
    out = [f'{target} :']
    for i, script in enumerate(scripts, start=1):
        out.append(f'  Script {i} (x:50, y:50) :')
        for node in script:
            for sub in node.walk():
                out.append(f'    [{sub.address}] {"  " * sub.depth}{sub.text}')
    return '\n'.join(out)


# --------------------------------------------------------------------------- #
# Générateur
# --------------------------------------------------------------------------- #


FIX_MUTATIONS = [
    dict(
        find=r'^(\s*)bounce$',
        replace=r'\1change x 1',
        symptom="la balle sort de l'ecran et ne revient jamais",
        why="il manque le bloc qui fait rebondir la balle sur les bords",
    ),
    dict(
        find=r'^(\s*)change (score|points|pieces) 1$',
        replace=r'\1set \2 1',
        symptom="le score reste bloque a 1",
        why="il faut ajouter 1 au score, pas le fixer a 1",
    ),
    dict(
        find=r'^(\s*)change vy -1$',
        replace=r'\1change vy 1',
        symptom="le personnage monte vers le ciel au lieu de tomber",
        why="la gravite doit faire diminuer la vitesse verticale",
    ),
    dict(
        find=r'^(\s*)move (\d+)$',
        replace=r'\1move 0',
        symptom="le sprite ne se deplace plus du tout",
        why="la distance du deplacement est nulle",
    ),
    dict(
        find=r'^(\s*)wait (\d+)$',
        replace=r'\1wait 0',
        symptom="l'action se repete tellement vite qu'on ne voit rien",
        why="il manque le temps d'attente dans la boucle",
    ),
    dict(
        find=r'^(\s*)forever:$',
        replace=r'\1repeat 1:',
        symptom="l'action ne se repete qu'une seule fois",
        why="une boucle infinie est necessaire pour un mouvement continu",
    ),
    dict(
        find=r'^(\s*)if \(keypressed (\w+)\):$',
        replace=r'\1if (keypressed space):',
        symptom="le sprite ne repond plus a la touche demandee",
        why="ce n'est pas la bonne touche qui est testee",
    ),
    dict(
        find=r'^(\s*)if \(touching _edge_\):$',
        replace=r'\1if (touching _mouse_):',
        symptom="le personnage perd la partie alors qu'il ne touche rien",
        why="la condition de bord a ete remplacee par la souris",
    ),
    dict(
        find=r'^(\s*)setsize (\d+)$',
        replace=r'\1setsize 5',
        symptom="le sprite est minuscule a l'ecran",
        why="la taille a ete mise a 5% au lieu de la valeur voulue",
    ),
    dict(
        find=r'^(\s*)set vy ([\d.]+)$',
        replace=r'\1set vy -5',
        symptom="le saut envoie le joueur vers le bas",
        why="la vitesse de saut doit etre positive",
    ),
]

EXPLAIN_INTROS = [
    'Explique ce que fait ce script',
    'Que fait ce code ?',
    'Peux-tu m\'expliquer ce programme ?',
    'Decris ce script en francais',
    'Explique-moi ce projet Scratch',
]

FIX_INTROS = [
    'Mon jeu ne marche pas : {symptom}. Corrige le script',
    'Aide moi : {symptom}',
    'Ca bug, {symptom}. Peux-tu reparer ce code ?',
    'Je ne comprends pas, {symptom}',
]

EDIT_INTROS = [
    'Modifie {bloc} comme demande',
    'Change juste {bloc} dans mon projet',
    'Edite la valeur de {bloc}',
    'Je veux modifier {bloc} sans tout refaire',
]

DOC_INTROS = [
    'A quoi sert le bloc {bloc} ?',
    'Explique moi {bloc}',
    'Comment on utilise {bloc} ?',
    'C\'est quoi {bloc} en Scratch ?',
    'Donne moi un exemple avec {bloc}',
]


class CorpusGenerator:
    """Fabrique des `Sample` de façon déterministe pour une graine donnée."""

    def __init__(self, grammar: Grammar, seed: int = 1):
        self.grammar = grammar
        self.rng = random.Random(seed)
        self.doc_opcodes = [op for op, blk in grammar.opcodes.items()
                            if op in D.DESCRIPTIONS and not blk.hat]

    # ------------------------------------------------------------------ #
    # Utilitaires
    # ------------------------------------------------------------------ #

    PLAYER_NAMES = ['Joueur', 'Heros', 'Robot', 'Ninja', 'Vaisseau', 'Chat', 'Dragon', 'Sorax']
    OBJECT_NAMES = [
        'Balle', 'Ennemi', 'Piece', 'Cible', 'Fantome', 'Etoile', 'Cristal',
        'Pomme', 'Coffre', 'Cle', 'Gemme', 'Bonus', 'Bouclier',
    ]

    def _rand_name(self) -> str:
        return self.rng.choice(self.PLAYER_NAMES + self.OBJECT_NAMES)

    def _unique_name(self, used: set) -> str:
        """Nom de sprite libre (évite les collisions dans un même programme)."""
        for _ in range(50):
            name = self._rand_name()
            if name not in used:
                return name
        return f'Sprite{len(used)}'

    def _sample(self, task: str, prompt: str, answer: str, **meta) -> Sample:
        return Sample(
            task=task,
            prompt=normalize_prompt(prompt),
            answer=answer.strip(),
            meta=meta,
        )

    # ------------------------------------------------------------------ #
    # Tâche « code » : programmes de référence
    # ------------------------------------------------------------------ #

    def flagship_samples(self) -> Iterator[Sample]:
        for program in D.PROGRAMS:
            for prompt in program['prompts']:
                yield self._sample(
                    'code', prompt, program['code'],
                    program=program['name'], genre=program['genre'], source='flagship',
                )
                yield self._sample(
                    'code', f'Tu peux me faire {prompt[0].lower()}{prompt[1:]} ?',
                    program['code'], program=program['name'], source='flagship-variant',
                )

    # ------------------------------------------------------------------ #
    # Tâche « code » : assemblages combinatoires
    # ------------------------------------------------------------------ #

    def _fill_fragment(self, key: str, ctx: Dict[str, str]) -> Tuple[str, str]:
        """Remplit un fragment avec des valeurs aléatoires cohérentes."""
        template = D.FRAGMENTS[key]['code']
        desc = D.FRAGMENTS[key]['desc']
        values = dict(ctx)
        values.setdefault('nom', self._rand_name())
        values.setdefault('joueur', ctx.get('nom', 'Joueur'))
        values.setdefault('sol', 'Sol')
        values.setdefault('taille', str(self.rng.choice([50, 60, 70, 80, 100])))
        values.setdefault('pas', str(self.rng.choice([4, 5, 6, 8, 10])))
        values.setdefault('vitesse', str(self.rng.choice([2, 3, 4, 5, 6, 7, 8])))
        values.setdefault('force', str(self.rng.choice([9, 10, 12, 15])))
        values.setdefault('saut', str(self.rng.choice([10, 12, 15])))
        values.setdefault('angle', str(self.rng.choice([30, 45, 60, 135, 150])))
        values.setdefault('intervalle', str(self.rng.choice([0.5, 1, 1.5, 2])))
        values.setdefault('delai', str(self.rng.choice([0.1, 0.2, 0.3, 0.5])))
        values.setdefault('epaisseur', str(self.rng.choice([2, 3, 4, 6])))
        values.setdefault('secondes', str(self.rng.choice([15, 20, 30, 45])))
        values.setdefault('score', 'score')
        values.setdefault('temps', 'temps')
        values.setdefault('touche', self.rng.choice(['h', 'space', 'a', 'z', 'e']))
        # Les fragments peuvent renommer leurs sprites pour rester lisibles.
        for token in ('joueur', 'sol', 'nom'):
            values.setdefault(token, values[token])
        return template.format(**values), desc.format(**values) if '{' in desc else desc

    def assembled_samples(self, count: int) -> Iterator[Sample]:
        for _ in range(count):
            recipe = self.rng.choice(D.RECIPES)
            pieces = list(recipe['pieces'])
            ctx: Dict[str, str] = {}
            if 'chrono' in pieces:
                ctx['secondes'] = str(self.rng.choice([15, 20, 30, 45]))
            # Le nom du joueur et celui du sol sont fixés en amont pour que les
            # fragments qui les référencent pointent bien sur le même sprite.
            joueur = self.rng.choice(self.PLAYER_NAMES)
            tir = self.rng.choice([n for n in self.OBJECT_NAMES if n not in ('Balle',)]) + 'Tir'
            ctx['joueur'] = joueur
            ctx['sol'] = 'Sol'
            ctx['tir'] = tir
            bodies: List[str] = []
            declarations: List[str] = []
            if 'score' in recipe['vars']:
                declarations.append('var score = 0')
            if 'temps' in recipe['vars']:
                declarations.append(f'var temps = {ctx.get("secondes", 30)}')
            used_names = {joueur, 'Sol', 'Chrono', 'Stage'}
            for key in pieces:
                local = dict(ctx)
                if key.startswith(('joueur', 'tireur')):
                    local['nom'] = joueur
                elif key.startswith('missile'):
                    local['nom'] = tir
                    used_names.add(tir)
                elif key == 'chrono':
                    local['nom'] = 'Chrono'
                else:
                    local['nom'] = self._unique_name(used_names)
                    used_names.add(local['nom'])
                code, _desc = self._fill_fragment(key, local)
                bodies.append(code)
            code = '\n'.join(declarations + bodies).strip()
            template = self.rng.choice(D.PROMPT_TEMPLATES)
            prompt = template.format(
                un=D.article(recipe['title']),
                titre=recipe['title'],
                objectif=recipe['objectif'],
            )
            yield self._sample(
                'code', prompt, code,
                genre=recipe['genre'], source='assembled', pieces=pieces,
            )

    # ------------------------------------------------------------------ #
    # Tâche « doc »
    # ------------------------------------------------------------------ #

    def doc_samples(self) -> Iterator[Sample]:
        for opcode in self.doc_opcodes:
            desc = D.DESCRIPTIONS[opcode]
            alias = self.grammar.primary_alias(opcode)
            usage = self.grammar.usage(opcode)
            for intro in DOC_INTROS[:3]:
                yield self._sample(
                    'doc', intro.format(bloc=opcode), desc, opcode=opcode,
                )
            yield self._sample(
                'doc', f'Comment on utilise {alias} ?',
                f'{usage} — {desc}', opcode=opcode,
            )
            yield self._sample(
                'doc', f'Donne moi la syntaxe de {opcode}',
                f'En ScratchScript : `{usage}`. {desc}', opcode=opcode,
            )

    # ------------------------------------------------------------------ #
    # Tâche « explain »
    # ------------------------------------------------------------------ #

    def explain_samples(self) -> Iterator[Sample]:
        for program in D.PROGRAMS:
            intro = self.rng.choice(EXPLAIN_INTROS)
            yield self._sample(
                'explain', f'{intro} :\n{program["code"]}',
                program['explanation'], program=program['name'],
            )
        # explications courtes d'un fragment isolé
        for key, fragment in D.FRAGMENTS.items():
            intro = self.rng.choice(EXPLAIN_INTROS)
            yield self._sample(
                'explain', f'{intro} :\n{fragment["code"]}',
                f'Ce script sert a {fragment["desc"]}.', fragment=key,
            )

    # ------------------------------------------------------------------ #
    # Tâche « fix »
    # ------------------------------------------------------------------ #

    def fix_samples(self) -> Iterator[Sample]:
        for program in D.PROGRAMS:
            for mutation in FIX_MUTATIONS:
                code = program['code']
                if not re.search(mutation['find'], code, flags=re.M):
                    continue
                buggy = re.sub(mutation['find'], mutation['replace'], code, flags=re.M)
                if buggy == code:
                    continue
                intro = self.rng.choice(FIX_INTROS)
                yield self._sample(
                    'fix',
                    f'{intro.format(symptom=mutation["symptom"])} :\n{buggy}',
                    code, program=program['name'], cause=mutation['why'],
                )

    # ------------------------------------------------------------------ #
    # Tâche « edit » : éditions ciblées à partir des adresses
    # ------------------------------------------------------------------ #

    def edit_samples(self) -> Iterator[Sample]:
        for program in D.PROGRAMS:
            targets = parse_dsl(program['code'])
            for target, scripts in targets.items():
                flat = address_scripts(scripts)
                numeric = [n for n in flat if re.search(r'\b\d+\b', n.text)]
                if not numeric:
                    continue
                node = self.rng.choice(numeric)
                old_value = int(re.search(r'\b(\d+)\b', node.text).group(1))
                new_value = old_value + self.rng.choice([5, 10, 20, 50])
                if old_value == 0:
                    new_value = self.rng.choice([1, 5, 10])
                new_text = re.sub(r'\b\d+\b', str(new_value), node.text, count=1)
                listing = addressed_listing(target, scripts)
                prompt = (
                    f'PROJET ACTUEL :\n{listing}\n\n'
                    f'DEMANDE : {self.rng.choice(EDIT_INTROS).format(bloc=node.text)} '
                    f'en {new_value}'
                )
                answer = f'on {target}:\n  edit {node.address} {new_text}'
                yield self._sample(
                    'edit', prompt, answer,
                    program=program['name'], address=node.address,
                )

    # ------------------------------------------------------------------ #
    # Tâche « chat »
    # ------------------------------------------------------------------ #

    def chat_samples(self) -> Iterator[Sample]:
        pairs = D.IDENTITY_QA + D.CHAT_QA
        for prompt, answer in pairs:
            yield self._sample('chat', prompt, answer)
            yield self._sample('chat', prompt.capitalize(), answer)

    # ------------------------------------------------------------------ #
    # Corpus complet
    # ------------------------------------------------------------------ #

    def all_samples(self, target_size: int = 40_000) -> Iterator[Sample]:
        """Produit le corpus complet, complété par des assemblages jusqu'à `target_size`."""
        pools = [
            (list(self.flagship_samples()), 1.0),
            (list(self.doc_samples()), 0.6),
            (list(self.explain_samples()), 0.5),
            (list(self.fix_samples()), 0.5),
            (list(self.edit_samples()), 0.6),
            (list(self.chat_samples()), 0.4),
        ]
        fixed: List[Sample] = []
        for pool, weight in pools:
            repeats = max(1, int(round(weight)))
            for _ in range(repeats):
                fixed.extend(pool)
        self.rng.shuffle(fixed)
        for sample in fixed:
            yield sample

        remaining = max(0, target_size - len(fixed))
        for sample in self.assembled_samples(remaining):
            yield sample


# --------------------------------------------------------------------------- #
# Écriture / lecture
# --------------------------------------------------------------------------- #


def write_corpus(samples: Iterable[Sample], out_dir: str, splits=(0.98, 0.01, 0.01),
                 seed: int = 1) -> Dict[str, int]:
    """Écrit ``train.jsonl`` / ``val.jsonl`` / ``test.jsonl`` dans `out_dir`."""
    os.makedirs(out_dir, exist_ok=True)
    rng = random.Random(seed)
    counts = {'train': 0, 'val': 0, 'test': 0}
    files = {name: open(os.path.join(out_dir, f'{name}.jsonl'), 'w', encoding='utf-8')
             for name in counts}
    seen = set()
    try:
        for sample in samples:
            key = (sample.task, sample.prompt, sample.answer)
            if key in seen:
                continue
            seen.add(key)
            r = rng.random()
            name = 'train' if r < splits[0] else ('val' if r < splits[0] + splits[1] else 'test')
            files[name].write(sample.to_json() + '\n')
            counts[name] += 1
    finally:
        for fh in files.values():
            fh.close()
    return counts


def stats(samples: Iterable[Sample]) -> Dict[str, object]:
    """Statistiques simples (par tâche, longueurs) pour le rapport de corpus."""
    by_task: Dict[str, int] = {}
    prompt_len: List[int] = []
    answer_len: List[int] = []
    for s in samples:
        by_task[s.task] = by_task.get(s.task, 0) + 1
        prompt_len.append(len(s.prompt))
        answer_len.append(len(s.answer))
    n = max(1, len(prompt_len))
    return {
        'total': len(prompt_len),
        'by_task': by_task,
        'moyenne_prompt': round(sum(prompt_len) / n, 1),
        'moyenne_reponse': round(sum(answer_len) / n, 1),
        'max_reponse': max(answer_len) if answer_len else 0,
    }


__all__ = [
    'Sample', 'Stmt', 'CorpusGenerator', 'parse_dsl', 'address_scripts',
    'addressed_listing', 'write_corpus', 'stats',
]
