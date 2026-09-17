"""Accès à la grammaire ScratchScript extraite de l'IDE (`grammar.json`).

La grammaire est produite par `sorax/tools/dump_grammar.mjs` à partir des
sources réelles de l'IDE (`src/lib/ai-agent/block-schema.js` et
`dsl-parser.js`) : c'est donc *exactement* la liste des blocs que le
compilateur ScratchScript sait construire.
"""

from __future__ import annotations

import json
import os
import random
from dataclasses import dataclass
from typing import Dict, List, Optional

from .configs import PATHS


@dataclass
class Param:
    """Paramètre positionnel d'un bloc."""

    name: str
    kind: str          # number | text | menu | boolean | branch | field | unknown
    default: object = None
    menu: Optional[str] = None
    shadow: Optional[str] = None


@dataclass
class Block:
    """Description d'un bloc (opcode, catégorie, paramètres, branches)."""

    opcode: str
    category: str
    suffix: str
    hat: bool
    params: List[Param]
    branches: List[str]

    def __str__(self) -> str:  # pragma: no cover - confort de debug
        args = ' '.join(p.name for p in self.params)
        return f'{self.opcode}({args})'


class Grammar:
    """Grammaire complète : opcodes, alias du DSL, ordre des paramètres."""

    def __init__(self, data: dict):
        self.raw = data
        self.opcodes: Dict[str, Block] = {}
        for opcode, info in data['opcodes'].items():
            self.opcodes[opcode] = Block(
                opcode=opcode,
                category=info['category'],
                suffix=info['suffix'],
                hat=info['hat'],
                params=[Param(**p) for p in info['params']],
                branches=info['branches'],
            )
        self.aliases: Dict[str, dict] = data['aliases']

    # ------------------------------------------------------------------ #

    @classmethod
    def load(cls, path: Optional[str] = None) -> 'Grammar':
        path = path or PATHS.GRAMMAR
        if not os.path.exists(path):
            raise FileNotFoundError(
                f'{path} introuvable — lancez d\'abord : node sorax/tools/dump_grammar.mjs'
            )
        with open(path, 'r', encoding='utf-8') as fh:
            return cls(json.load(fh))

    # ------------------------------------------------------------------ #

    def block(self, opcode: str) -> Optional[Block]:
        return self.opcodes.get(opcode)

    def alias_of(self, opcode: str) -> List[str]:
        """Noms courts du DSL pointant vers un opcode."""
        return [a for a, info in self.aliases.items() if info['opcode'] == opcode]

    def primary_alias(self, opcode: str) -> str:
        """Nom court le plus « naturel » pour un opcode (sinon son suffixe)."""
        names = self.alias_of(opcode)
        if not names:
            blk = self.opcodes.get(opcode)
            return blk.suffix if blk else opcode
        names.sort(key=len)
        return names[0]

    def usage(self, opcode: str) -> str:
        """Signature lisible : ``nom <ARG1> <ARG2>`` (branches exclues)."""
        blk = self.opcodes.get(opcode)
        if not blk:
            return opcode
        parts = [self.primary_alias(opcode)]
        for p in blk.params:
            if p.kind == 'branch':
                parts.append(f'[{p.name.lower()}]')
            else:
                parts.append(f'<{p.name}>')
        return ' '.join(parts)

    def all_categories(self) -> Dict[str, List[str]]:
        out: Dict[str, List[str]] = {}
        for opcode, blk in self.opcodes.items():
            out.setdefault(blk.category, []).append(opcode)
        return out


# --------------------------------------------------------------------------- #
# Valeurs de menus (utilisables telles quelles dans le DSL)
# --------------------------------------------------------------------------- #

MENU_VALUES: Dict[str, List[str]] = {
    'motion_goto_menu': ['_random_', '_mouse_', 'Ennemi', 'Balle', 'Joueur'],
    'motion_glideto_menu': ['_random_', '_mouse_', 'Ennemi', 'Balle'],
    'motion_pointtowards_menu': ['_mouse_', 'Ennemi', 'Balle', 'Joueur'],
    'looks_costume': ['costume1', 'costume2'],
    'looks_backdrops': ['backdrop1', 'backdrop2'],
    'sensing_touchingobjectmenu': ['_edge_', '_mouse_', 'Ennemi', 'Balle', 'Joueur'],
    'sensing_distancetomenu': ['_mouse_', 'Ennemi', 'Balle'],
    'sensing_keyoptions': ['space', 'up arrow', 'down arrow', 'left arrow', 'right arrow', 'a', 'd', 'w', 'z', 's'],
    'sensing_of_object_menu': ['Stage', 'Ennemi', 'Balle', 'Sorax'],
    'control_create_clone_of_menu': ['_myself_', 'Balle', 'Ennemi'],
    'sound_sounds_menu': ['pop', 'coin', 'victoire'],
    'event_broadcast_menu': ['message1', 'partie', 'gagne', 'recommence'],
    'sensing_keypressed_key': ['space', 'up arrow', 'down arrow', 'left arrow', 'right arrow', 'z', 'q', 's', 'd'],
}

#: Valeurs acceptées par les champs « menu » rendus directement sur le bloc.
FIELD_VALUES: Dict[str, List[str]] = {
    'KEY_OPTION': ['space', 'up arrow', 'down arrow', 'left arrow', 'right arrow', 'a', 'b', 'z', 's', 'd', 'q'],
    'WHENGREATERTHANMENU': ['LOUDNESS', 'TIMER'],
    'STOP_OPTION': ['all', 'this script', 'other scripts in sprite'],
    'STYLE': ['left-right', 'don\'t rotate', 'all around'],
    'EFFECT': ['COLOR', 'GHOST', 'BRIGHTNESS', 'SATURATION'],
    'NUMBER_NAME': ['x position', 'y position', 'direction', 'costume number', 'size'],
    'PROPERTY': ['x position', 'y position', 'direction', 'size', 'costume number'],
    'CURRENTMENU': ['YEAR', 'MONTH', 'DATE', 'DAY', 'HOUR', 'MINUTE', 'SECOND'],
    'OPERATOR': ['abs', 'floor', 'ceiling', 'sqrt', 'sin', 'cos', 'round', 'ln'],
    'COLOR_PARAM': ['color', 'saturation', 'brightness', 'transparency'],
    'FRONT_BACK': ['front', 'back'],
    'FORWARD_BACKWARD': ['forward', 'backward'],
    'ALIGNMENT': ['bottom-left', 'top-left'],
}


def menu_value(menu: Optional[str], rng: random.Random) -> str:
    """Valeur de menu aléatoire mais toujours valide pour un menu donné."""
    if not menu:
        return '_random_'
    values = MENU_VALUES.get(menu)
    if values:
        return rng.choice(values)
    # menus de variables / listes / diffusions : gérés par le builder
    if menu in ('data_variable', 'data_listcontents'):
        return 'score'
    return rng.choice(['1', '10', 'costume1'])
