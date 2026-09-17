#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Construit `sorax-ai.sb3` : le projet Scratch complet avec
  - les listes COMPRESSED / DICT / ALPHA embarquées (données compressées),
  - la liste DATA (vide, remplie au lancement),
  - le décompresseur (blocs vanilla Scratch 3, aucun extension),
  - la vérification d'intégrité + la variable STATUS.

Émet aussi les fichiers .txt pour la voie "importation manuelle".

Usage :  python3 build_sb3.py [--dataset ../data/dataset.txt] [--out ../data/sorax-ai.sb3]
"""

from __future__ import annotations
import argparse
import hashlib
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'compress'))
from sxp import compress_lines, ALPHA, validate_line  # noqa: E402

# ------------------------------------------------------------------ constantes

BACKDROP_SVG = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" '
    'viewBox="0 0 480 360">'
    '<rect width="480" height="360" fill="#0b1026"/>'
    '<circle cx="90" cy="70" r="34" fill="#e8f4ff" opacity="0.9"/>'
    '<circle cx="80" cy="62" r="30" fill="#0b1026"/>'
    '<circle cx="384" cy="52" r="2.5" fill="#ffffff"/>'
    '<circle cx="428" cy="96" r="2" fill="#ffffff"/>'
    '<circle cx="342" cy="118" r="1.6" fill="#ffffff"/>'
    '<circle cx="52" cy="150" r="1.8" fill="#ffffff"/>'
    '<circle cx="452" cy="182" r="1.5" fill="#ffffff"/>'
    '<text x="240" y="205" font-family="sans-serif" font-size="34" '
    'font-weight="bold" fill="#7fd4ff" text-anchor="middle">SORAX 1</text>'
    '<text x="240" y="232" font-family="sans-serif" font-size="14" '
    'fill="#bfe3ff" text-anchor="middle">AI assistant by Snowoo-</text>'
    '</svg>'
)

# ------------------------------------------------------------------ builder


class Sb3Builder:
    """Petit constructeur de project.json (format sb3)."""

    def __init__(self):
        self.blocks: dict[str, dict] = {}
        self._n = 0

    # ------------------------------------------------------------- création
    def _id(self) -> str:
        self._n += 1
        return f"@sbx{self._n:05d}"

    def add(self, opcode, *, inputs=None, fields=None, parent=None,
            shadow=False, mutation=None, top=False, x=0, y=0) -> str:
        bid = self._id()
        blk = {
            "opcode": opcode,
            "next": None,
            "parent": parent,
            "inputs": inputs or {},
            "fields": fields or {},
            "shadow": shadow,
            "topLevel": top,
        }
        if top:
            blk["x"] = x
            blk["y"] = y
        if mutation is not None:
            blk["mutation"] = mutation
        # tout bloc référencé dans un input a ce bloc pour parent
        # (requis par scratch-blocks pour l'affichage, et invariant
        # vérifié par _audit_single_parent)
        for iv in (inputs or {}).values():
            if isinstance(iv, list):
                for d in iv[1:]:
                    if isinstance(d, str) and d in self.blocks:
                        self.blocks[d]["parent"] = bid
        self.blocks[bid] = blk
        return bid

    def chain(self, *ids) -> str:
        """Relie des blocs séquentiels ; retourne le premier."""
        for a, b in zip(ids, ids[1:]):
            self.blocks[a]["next"] = b
            self.blocks[b]["parent"] = a
        return ids[0]

    # ------------------------------------------------------------- entrées
    # descripteurs d'input sb3 :
    #   texte littéral : [1, [10, "v"]]      nombre : [1, [4, "v"]]
    #   variable       : [3, [12, nom, id], [10|4, ""]]  (NOM PUIS ID !)
    #   bloc rapporteur: [3, blockId, [10|4, ""]]
    #   booléen        : [2, blockId]        sous-pile : [2, blockId]

    @staticmethod
    def txt(v) -> list:
        return [1, [10, str(v)]]

    @staticmethod
    def num(v) -> list:
        return [1, [4, str(v)]]

    def var(self, name, numeric=False) -> list:
        vid = self.var_ids[name]
        return [3, [12, name, vid], [4 if numeric else 10, "1" if numeric else ""]]

    def rep(self, bid, numeric=False) -> list:
        return [3, bid, [4 if numeric else 10, "1" if numeric else ""]]

    @staticmethod
    def bool_(bid) -> list:
        return [2, bid]

    @staticmethod
    def sub(bid) -> list:
        return [2, bid]

    # variables et listes du projet
    var_ids: dict[str, str] = {}
    list_ids: dict[str, str] = {}


# ------------------------------------------------------------------ reporters


def r_var(b: Sb3Builder, name):
    """data_variable en tant que bloc (utilisé en topLevel rarement)."""
    return b.add("data_variable", fields={"VARIABLE": [name, b.var_ids[name]]})


def r_join(b: Sb3Builder, d1, d2):
    """join ; d1/d2 = descripteurs d'input OU (bloc) -> utilise rep()."""
    return b.add("operator_join", inputs={"STRING1": d1, "STRING2": d2})


def r_letter(b: Sb3Builder, d_index, d_string):
    return b.add("operator_letter_of",
                 inputs={"LETTER": d_index, "STRING": d_string})


def r_length(b: Sb3Builder, d_string):
    return b.add("operator_length", inputs={"STRING": d_string})


def r_add(b: Sb3Builder, d1, d2):
    return b.add("operator_add", inputs={"NUM1": d1, "NUM2": d2})


def r_sub(b: Sb3Builder, d1, d2):
    return b.add("operator_subtract", inputs={"NUM1": d1, "NUM2": d2})


def r_mul(b: Sb3Builder, d1, d2):
    return b.add("operator_multiply", inputs={"NUM1": d1, "NUM2": d2})


def r_div(b: Sb3Builder, d1, d2):
    return b.add("operator_divide", inputs={"NUM1": d1, "NUM2": d2})


def r_round(b: Sb3Builder, d1):
    return b.add("operator_round", inputs={"NUM": d1})


def r_eq(b: Sb3Builder, d1, d2):
    return b.add("operator_equals", inputs={"OPERAND1": d1, "OPERAND2": d2})


def r_lt(b: Sb3Builder, d1, d2):
    return b.add("operator_lt", inputs={"OPERAND1": d1, "OPERAND2": d2})


def r_gt(b: Sb3Builder, d1, d2):
    return b.add("operator_gt", inputs={"OPERAND1": d1, "OPERAND2": d2})


def r_item_of_list(b: Sb3Builder, list_name, d_index):
    return b.add("data_itemoflist",
                 inputs={"INDEX": d_index},
                 fields={"LIST": [list_name, b.list_ids[list_name]]})


def r_itemnum(b: Sb3Builder, list_name, d_item):
    return b.add("data_itemnumoflist",
                 inputs={"ITEM": d_item},
                 fields={"LIST": [list_name, b.list_ids[list_name]]})


def r_len_of_list(b: Sb3Builder, list_name):
    return b.add("data_lengthoflist",
                 fields={"LIST": [list_name, b.list_ids[list_name]]})


def r_arg(b: Sb3Builder, arg_name):
    return b.add("argument_reporter_string_number",
                 fields={"VALUE": [arg_name]}, shadow=True)


def arg_in(b: Sb3Builder, name, numeric=False) -> list:
    """Argument de procédure branché dans un input (bloc rapporteur)."""
    rid = r_arg(b, name)
    return [3, rid, [4 if numeric else 10, "1" if numeric else ""]]


# ------------------------------------------------------------------ commandes


def c_setvar(b: Sb3Builder, name, d_value):
    return b.add("data_setvariableto",
                 inputs={"VALUE": d_value},
                 fields={"VARIABLE": [name, b.var_ids[name]]})


def c_changevar(b: Sb3Builder, name, d_value):
    # NB : ce scratch-vm (5.0.300 / TurboWarp) lit l'input "VALUE",
    # pas "NUM" comme le vanilla.
    return b.add("data_changevariableby",
                 inputs={"VALUE": d_value},
                 fields={"VARIABLE": [name, b.var_ids[name]]})


def c_add_to_list(b: Sb3Builder, list_name, d_item):
    return b.add("data_addtolist",
                 inputs={"ITEM": d_item},
                 fields={"LIST": [list_name, b.list_ids[list_name]]})


def c_delete_all(b: Sb3Builder, list_name):
    return b.add("data_deletealloflist",
                 fields={"LIST": [list_name, b.list_ids[list_name]]})


def c_say(b: Sb3Builder, d_msg):
    return b.add("looks_say", inputs={"MESSAGE": d_msg})


def c_if(b: Sb3Builder, cond_id, substack_id):
    return b.add("control_if",
                 inputs={"CONDITION": b.bool_(cond_id),
                         "SUBSTACK": b.sub(substack_id)})


# ------------------------------------------------------------------ le script


def build_decompressor(b: Sb3Builder, word_total: int,
                       expected_lines: int, expected_chars: int):
    """Construit les 3 scripts : drapeau vert + 2 procédures WFR."""

    # ================================================ procédure "process item %s"
    def_id = b.add("procedures_definition", top=True, x=40, y=560)
    proto_id = b.add("procedures_prototype", parent=def_id, shadow=True,
                     mutation={
                         "tagName": "mutation", "children": [],
                         "proccode": "process item %s",
                         "argumentids": '["arg_n"]',
                         "argumentnames": '["n"]',
                         "argumentdefaults": '["1"]',
                         "warp": "true",
                     })
    b.blocks[def_id]["inputs"] = {"custom_block": [1, proto_id]}

    s0 = c_setvar(b, "s", b.rep(r_item_of_list(b, "COMPRESSED", arg_in(b, "n", True))))
    s1 = c_setvar(b, "L", b.rep(r_length(b, b.var("s"))))
    s2 = c_setvar(b, "ci", b.num(1))
    body_first = _process_body(b)
    loop_id = b.add("control_repeat_until",
                    inputs={"CONDITION": b.bool_(
                        r_gt(b, b.var("ci", True), b.var("L", True))),
                        "SUBSTACK": b.sub(body_first)})
    body = b.chain(s0, s1, s2, loop_id)
    b.blocks[def_id]["next"] = body
    b.blocks[body]["parent"] = def_id

    # ================================================== procédure "verify data"
    vdef_id = b.add("procedures_definition", top=True, x=680, y=560)
    vproto_id = b.add("procedures_prototype", parent=vdef_id, shadow=True,
                      mutation={
                          "tagName": "mutation", "children": [],
                          "proccode": "verify data",
                          "argumentids": "[]",
                          "argumentnames": "[]",
                          "argumentdefaults": "[]",
                          "warp": "true",
                      })
    b.blocks[vdef_id]["inputs"] = {"custom_block": [1, vproto_id]}

    v0 = c_setvar(b, "CHECK1", b.rep(r_len_of_list(b, "DATA")))
    v1 = c_setvar(b, "CHECK2", b.num(0))
    v2 = c_setvar(b, "jj", b.num(1))
    v_body = b.chain(
        c_changevar(b, "CHECK2", b.rep(r_length(
            b, b.rep(r_item_of_list(b, "DATA", b.var("jj", True)))))),
        c_changevar(b, "jj", b.num(1)),
    )
    v_loop = b.add("control_repeat",
                   inputs={"TIMES": b.rep(r_len_of_list(b, "DATA")),
                           "SUBSTACK": b.sub(v_body)})
    inner_if = c_if(b, r_eq(b, b.var("CHECK2", True), b.num(expected_chars)),
                    c_setvar(b, "READY", b.num(1)))
    outer_if = c_if(b, r_eq(b, b.var("CHECK1", True), b.num(expected_lines)),
                    inner_if)
    vbody = b.chain(v0, v1, v2, v_loop, outer_if)
    b.blocks[vdef_id]["next"] = vbody
    b.blocks[vbody]["parent"] = vdef_id

    # ================================================== script drapeau vert
    f0 = b.add("event_whenflagclicked", top=True, x=40, y=40)
    f1 = c_delete_all(b, "DATA")
    f2 = c_setvar(b, "buf", b.txt(""))
    f3 = c_setvar(b, "pend", b.txt(""))
    f4 = c_setvar(b, "ii", b.num(1))
    f5 = c_setvar(b, "READY", b.num(0))
    f6 = c_setvar(b, "STATUS", b.txt("Loading data... 0%"))

    outer_cond = r_gt(b, b.var("ii", True),
                      b.rep(r_len_of_list(b, "COMPRESSED")))
    call_id = b.add("procedures_call",
                    mutation={"tagName": "mutation", "children": [],
                              "proccode": "process item %s",
                              "argumentids": '["arg_n"]',
                              "warp": "true"},
                    inputs={"arg_n": b.var("ii", True)})
    pct = r_round(b, b.rep(r_mul(
        b, b.rep(r_div(b, b.var("ii", True),
                       b.rep(r_len_of_list(b, "COMPRESSED")))),
        b.num(100))))
    status = c_setvar(b, "STATUS",
                      b.rep(r_join(b,
                                   b.rep(r_join(b, b.txt("Loading... "),
                                                b.rep(pct))),
                                   b.txt("%"))))
    inc = c_changevar(b, "ii", b.num(1))
    outer_body = b.chain(call_id, status, inc)
    outer_loop = b.add("control_repeat_until",
                       inputs={"CONDITION": b.bool_(outer_cond),
                               "SUBSTACK": b.sub(outer_body)})

    vcall = b.add("procedures_call",
                  mutation={"tagName": "mutation", "children": [],
                            "proccode": "verify data",
                            "argumentids": "[]",
                            "warp": "true"})

    ok_then = b.chain(
        c_setvar(b, "STATUS", b.txt("Ready! Ask me anything.")),
        c_say(b, b.rep(r_join(
            b, b.rep(r_join(b, b.txt("Ready! "),
                            b.rep(r_len_of_list(b, "DATA")))),
            b.txt(" lines loaded. Ask me anything!")))),
    )
    err_then = b.chain(
        c_setvar(b, "STATUS", b.txt("ERROR: data check failed!")),
        c_say(b, b.txt("Data check FAILED. Re-import the lists!")),
    )
    ready_if = b.add("control_if_else",
                     inputs={"CONDITION": b.bool_(
                         r_eq(b, b.var("READY", True), b.num(1))),
                         "SUBSTACK": b.sub(ok_then),
                         "SUBSTACK2": b.sub(err_then)})
    b.chain(f0, f1, f2, f3, f4, f5, f6, outer_loop, vcall, ready_if)


def _process_body(b: Sb3Builder):
    """Corps de la boucle de décodage : dispatch sur c (lettre ci de s).

    SXP-2 : Scratch compare les chaînes SANS la casse (Cast.compare fait
    toLowerCase).  L'alphabet ALPHA (68 chars) ne contient AUCUNE paire
    majuscule/minuscule et les plombs '}' '~' '|' n'ont pas de jumeau de
    casse : toutes les comparaisons ci-dessous sont exactes.

    Dispatch (par fréquence décroissante) :
      c = "}"  -> ligne du dico (3 chars, append + flush)
      c = "~"  -> échappement littéral
      c = "|"  -> flush simple
      sinon    -> token 2 chars (mot du dico)

    Formules 1-based (item # de ALPHA) :
      2 chars : idx = item#(c)*68 + item#(s[ci+1]) - 68
      '}'     : idx = item#(s[ci+1])*68 + item#(s[ci+2]) + W - 68
    """
    W = b.word_total

    def d2_at(offset):
        """item # de (lettre (ci + offset) de s) dans ALPHA"""
        return r_itemnum(b, "ALPHA",
                         b.rep(r_letter(b,
                                        b.rep(r_add(b, b.var("ci", True),
                                                    b.num(offset))),
                                        b.var("s"))))

    def append_by_index(d_dict_index_block):
        """buf = join(join(buf, pend), item (idx) of DICT)"""
        return c_setvar(b, "buf",
                        b.rep(r_join(
                            b, b.rep(r_join(b, b.var("buf"), b.var("pend"))),
                            b.rep(d_dict_index_block))))

    # -------- token 2 chars (chemin chaud)
    idx2 = r_add(b, b.rep(r_add(
        b, b.rep(r_mul(b, b.rep(r_itemnum(b, "ALPHA", b.var("c"))),
                       b.num(68))),
        b.rep(d2_at(1)))),
        b.num(-68))
    two_char = b.chain(
        append_by_index(r_item_of_list(b, "DICT", b.rep(idx2))),
        c_setvar(b, "pend", b.txt(" ")),
        c_changevar(b, "ci", b.num(2)),
    )

    # -------- '|' : flush simple
    case_pipe = b.chain(
        c_add_to_list(b, "DATA", b.var("buf")),
        c_setvar(b, "buf", b.txt("")),
        c_setvar(b, "pend", b.txt("")),
        c_changevar(b, "ci", b.num(1)),
    )

    # -------- '~' : échappement littéral (miroir de sxp.py :
    # buf += pend + raw ; pend = ' ')
    esc_cond = r_eq(b, b.rep(r_letter(b, b.var("ci", True), b.var("s"))),
                    b.txt("~"))
    esc_body = b.chain(
        c_setvar(b, "buf",
                 b.rep(r_join(
                     b, b.var("buf"),
                     b.rep(r_letter(b, b.var("ci", True), b.var("s")))))),
        c_changevar(b, "ci", b.num(1)),
    )
    esc_loop = b.add("control_repeat_until",
                     inputs={"CONDITION": b.bool_(esc_cond),
                             "SUBSTACK": b.sub(esc_body)})
    case_esc = b.chain(
        c_changevar(b, "ci", b.num(1)),   # saute le '~' ouvrant
        c_setvar(b, "buf",                # consomme pend UNE SEULE FOIS
                 b.rep(r_join(b, b.var("buf"), b.var("pend")))),
        c_setvar(b, "pend", b.txt("")),
        esc_loop,
        c_changevar(b, "ci", b.num(1)),   # saute le '~' fermant
        c_setvar(b, "pend", b.txt(" ")),  # le mot brut est terminé
    )

    # -------- '}' : ligne du dico (3 chars, append + flush)
    idx_line = r_add(b, b.rep(r_add(
        b, b.rep(r_mul(b, b.rep(d2_at(1)), b.num(68))),
        b.rep(d2_at(2)))),
        b.num(W - 68))
    case_rbrace = b.chain(
        append_by_index(r_item_of_list(b, "DICT", b.rep(idx_line))),
        c_add_to_list(b, "DATA", b.var("buf")),
        c_setvar(b, "buf", b.txt("")),
        c_setvar(b, "pend", b.txt("")),
        c_changevar(b, "ci", b.num(3)),
    )

    # ================= dispatch =================
    setc = c_setvar(b, "c", b.rep(r_letter(b, b.var("ci", True),
                                           b.var("s"))))

    pipe_if = b.add("control_if_else",
                    inputs={"CONDITION": b.bool_(
                        r_eq(b, b.var("c"), b.txt("|"))),
                        "SUBSTACK": b.sub(case_pipe),
                        "SUBSTACK2": b.sub(two_char)})
    esc_if = b.add("control_if_else",
                   inputs={"CONDITION": b.bool_(
                       r_eq(b, b.var("c"), b.txt("~"))),
                       "SUBSTACK": b.sub(case_esc),
                       "SUBSTACK2": b.sub(pipe_if)})
    dispatch = b.add("control_if_else",
                     inputs={"CONDITION": b.bool_(
                         r_eq(b, b.var("c"), b.txt("}"))),
                         "SUBSTACK": b.sub(case_rbrace),
                         "SUBSTACK2": b.sub(esc_if)})

    return b.chain(setc, dispatch)

# ------------------------------------------------------------------ assemblage


def _audit_single_parent(b: Sb3Builder):
    refs = {}
    for bid, blk in b.blocks.items():
        for iname, iv in (blk.get('inputs') or {}).items():
            if not isinstance(iv, list):
                continue
            for d in iv[1:]:
                if isinstance(d, str) and d in b.blocks:
                    if d in refs:
                        raise AssertionError(
                            f'bloc {d} reference 2 fois: {refs[d]} et '
                            f'{bid}.{iname} (parent unique requis)')
                    refs[d] = f'{bid}.{iname}'
    # parent coherence : enfant.parent == conteneur
    for bid, blk in b.blocks.items():
        for iname, iv in (blk.get('inputs') or {}).items():
            if not isinstance(iv, list):
                continue
            for d in iv[1:]:
                if isinstance(d, str) and d in b.blocks:
                    if b.blocks[d].get('parent') != bid:
                        raise AssertionError(
                            f'parent incoherent: {d}.parent='
                            f'{b.blocks[d].get("parent")} != {bid} ({iname})')
    print(f'[sb3] audit blocs: {len(b.blocks)} blocs, parent unique OK')


def build_project(dataset_path, out_path, item_chars=1600,
                  line_dict_budget=850_000):
    # 1. lire + valider le dataset
    with open(dataset_path, encoding='ascii') as f:
        lines = [l.rstrip('\n') for l in f]
    lines = [l for l in lines if l != '']
    assert len(lines) % 2 == 0, 'nombre de lignes impair !'
    for i, l in enumerate(lines):
        probs = validate_line(l)
        assert not probs, f'ligne {i}: {probs}'
    print(f'[sb3] dataset: {len(lines) // 2} paires, {len(lines)} lignes')

    # 2. compresser
    res = compress_lines(lines, item_chars=item_chars,
                         line_dict_budget=line_dict_budget)
    stats = res['stats']
    items = res['items']
    dict_list = res['dict_list']
    word_total = res['word_total']
    print(f'[sb3] compressé: payload {stats["payload_bytes"]:,} o + '
          f'dict {stats["dict_bytes"]:,} o = '
          f'~{stats["json_bytes_estimate"]:,} o de project.json')

    # 3. construire les blocs
    b = Sb3Builder()
    b.word_total = word_total

    # variables (id -> [nom, valeur])
    variables = {}
    var_names = {
        'buf': '', 'pend': '', 's': '', 'c': '', 'ci': 0, 'L': 0, 'ii': 0,
        'jj': 0, 'CHECK1': 0, 'CHECK2': 0, 'READY': 0,
        'STATUS': 'Loading data... 0%',
    }
    for i, (name, val) in enumerate(var_names.items()):
        vid = f"@var{i:03d}"
        b.var_ids[name] = vid
        variables[vid] = [name, val]

    # listes
    lists = {}
    for i, (name, val) in enumerate([
            ('DATA', []), ('COMPRESSED', items), ('DICT', dict_list),
            ('ALPHA', ALPHA)]):
        lid = f"@lst{i:03d}"
        b.list_ids[name] = lid
        lists[lid] = [name, val]

    build_decompressor(b, word_total, stats['expected_lines'],
                       stats['expected_chars'])

    # 4bis. AUDIT : aucun bloc ne doit etre reference par deux inputs
    # (le cache d'execution de scratch-vm suppose un parent unique)
    _audit_single_parent(b)

    # 4. costume (SVG minimal)
    md5 = hashlib.md5(BACKDROP_SVG.encode()).hexdigest()
    costume = {
        "name": "sorax backdrop",
        "assetId": md5,
        "md5ext": f"{md5}.svg",
        "dataFormat": "svg",
        "rotationCenterX": 240,
        "rotationCenterY": 180,
    }

    stage = {
        "isStage": True,
        "name": "Stage",
        "variables": variables,
        "lists": lists,
        "broadcasts": {},
        "blocks": b.blocks,
        "comments": {},
        "currentCostume": 0,
        "costumes": [costume],
        "sounds": [],
        "volume": 100,
        "layerOrder": 0,
    }
    status_vid = b.var_ids['STATUS']
    monitors = [
        {
            "id": status_vid,
            "mode": "default",
            "opcode": "data_variable",
            "params": {"VARIABLE": "STATUS"},
            "spriteName": None,
            "value": "Loading data... 0%",
            "width": 0,
            "height": 0,
            "x": 5,
            "y": 5,
            "visible": True,
            "sliderMin": 0,
            "sliderMax": 100,
            "isDiscrete": True,
        },
    ]
    project = {
        "targets": [stage],
        "monitors": monitors,
        "extensions": [],
        "meta": {"semver": "3.0.0", "vm": "5.0.300", "agent": ""},
    }

    project_json = json.dumps(project, ensure_ascii=False,
                              separators=(',', ':'))

    # 5. zipper le .sb3
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('project.json', project_json)
        z.writestr(f'{md5}.svg', BACKDROP_SVG)
    size = os.path.getsize(out_path)
    print(f'[sb3] écrit {out_path} ({size:,} octets, '
          f'project.json {len(project_json.encode("utf-8")):,} octets)')

    # 6. fichiers annexes (importation manuelle + docs)
    data_dir = os.path.dirname(os.path.abspath(out_path))
    with open(os.path.join(data_dir, 'payload.txt'), 'w') as f:
        f.write('\n'.join(items) + '\n')
    with open(os.path.join(data_dir, 'dict.txt'), 'w') as f:
        f.write('\n'.join(dict_list) + '\n')
    with open(os.path.join(data_dir, 'alpha.txt'), 'w') as f:
        f.write('\n'.join(ALPHA) + '\n')
    constants = {
        'format': 'sxp-1',
        'word_total': word_total,
        'line_total': stats['line_total'],
        'expected_lines': stats['expected_lines'],
        'expected_chars': stats['expected_chars'],
        'items': stats['n_items'],
        'alpha': ''.join(ALPHA),
        'dataset_sha256': stats['dataset_sha256'],
        'formula_2char': 'idx = (d1*68)+(d2)-(68)',
        'formula_line': 'idx = (d2*68)+(d3)-(68)+(WORD_TOTAL)',
        'note': 'SXP-2: alphabet 68 chars sans paires de casse ( Scratch compare sans la casse )',
    }
    with open(os.path.join(data_dir, 'constants.json'), 'w') as f:
        json.dump(constants, f, indent=2)
    with open(os.path.join(data_dir, 'stats.json'), 'w') as f:
        json.dump(stats, f, indent=2)

    # 7. index optionnel pour accélérer le matcher de l'utilisateur
    index_prompts = build_prompt_index(lines)
    with open(os.path.join(data_dir, 'index_prompts.txt'), 'w') as f:
        for word, ids in index_prompts:
            f.write(word + '\n')
            f.write(','.join(str(i) for i in ids) + '\n')
    print(f'[sb3] index prompts: {len(index_prompts)} mots')

    return stats


def build_prompt_index(lines, cap=2500):
    """Pour chaque mot apparaissant dans un prompt, la liste (plafonnée)
    des indices (1-based, dans DATA) des prompts qui le contiennent."""
    from collections import defaultdict
    import re
    word_map = defaultdict(set)
    for i in range(0, len(lines), 2):
        prompt = lines[i].lower()
        idx = i + 1  # indice dans DATA (1-based)
        for w in re.findall(r"[a-z']+", prompt):
            word_map[w].add(idx)
    out = []
    for w in sorted(word_map, key=lambda w: -len(word_map[w])):
        ids = sorted(word_map[w])[:cap]
        out.append((w, ids))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dataset', default=os.path.join(
        HERE, '..', 'data', 'dataset.txt'))
    ap.add_argument('--out', default=os.path.join(
        HERE, '..', 'data', 'sorax-ai.sb3'))
    ap.add_argument('--item-chars', type=int, default=1600)
    ap.add_argument('--line-dict-budget', type=int, default=850_000)
    args = ap.parse_args()
    build_project(args.dataset, args.out, args.item_chars,
                  args.line_dict_budget)


if __name__ == '__main__':
    main()
