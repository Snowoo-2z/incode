"""
SXP-1 — "Sorax eXchange Pack" v1  (modèle "pend")
=================================================
Format de compression pensé pour être décompressé PAR UN SCRIPT SCRATCH,
bloc par bloc, vite et simplement.

PRINCIPE
--------
Chaque "phrase" du dictionnaire (mot, groupe de mots, ou ligne entière du
dataset) est remplacée par un code de 2 ou 3 caractères ASCII imprimables.

Alphabet de chiffres : 68 caractères ASCII imprimables SANS AUCUNE PAIRE
majuscule/minuscule : 0x21..0x60 puis {|}~.  Pourquoi : Scratch compare
les chaînes de façon INSENSIBLE À LA CASSE (Cast.compare fait toLowerCase),
donc 'a' et 'A' sont indiscernables côté opérateurs ET pour
"item # de (c) dans ALPHA".  Un alphabet sans jumeaux de casse rend chaque
comparaison exacte.

CODES (base 68)
-----
  [lead][d2]        token "mot"   -> id = v1*68 + v2         (0..4283)
  '{' [d2] [d3]     token "mot"   -> id = 4284 + v2*68 + v3  (4284..8907)
  '}' [d2] [d3]     token LIGNE   -> lineIdx = v2*68 + v3    (0..4623)
  '`' [d2] [d3]     token LIGNE   -> lineIdx = 4624 + v2*68 + v3
  '|'                             séparateur de ligne (flush)
  '~' <mot brut> '~'              échappement : copie littérale d'un mot

Plombs réservés (jamais en tête d'un code 2-chars) : '`' '{' '|' '}' '~'
(les 5 derniers caractères de l'alphabet -> aucun trou à combler).
Le seul caractère INTERDIT dans le dataset est '~'.

MODÈLE "pend" (l'astuce centrale)
---------------------------------
Toute ligne du dataset est une suite de "mots" (chunks sans espace) séparés
par des espaces SIMPLES. Donc : chaque mot est suivi d'une espace, SAUF le
dernier de la ligne. Au lieu de stocker l'espace dans le dictionnaire :

  - le décodeur garde une variable `pend` ('' ou ' ') ;
  - quand il ajoute un entry : buf = join(join(buf, pend), entry), pend = ' ' ;
  - au séparateur de ligne '|' : il ajoute buf à DATA tel quel (l'espace
    en attente dans pend est simplement jetée) et remet pend à ''.

Ainsi un même entry marche au milieu d'une ligne ET en fin de ligne, et le
dictionnaire ne contient jamais d'espace finale.

RÈGLE D'ALIGNEMENT (encodeur)
-----------------------------
Un entry ne peut être appliqué que s'il commence au début d'un mot et se
termine sur une frontière de mot (fin de ligne ou espace suivante).

DÉCODAGE CÔTÉ SCRATCH (miroir exact de decode() ci-dessous)
-----------------------------------------------------------
  d  = (item # de (lettre i de s) dans ALPHA)      -- 1..68 (boucle JS rapide)
  2 chars : élément ((d1*68)+(d2)-(68)) de DICT
  '{'     : élément ((d2*68)+(d3)+(4216)) de DICT
  '}'     : élément ((d2*68)+(d3)-(68)+(WORD_TOTAL)) de DICT  puis flush
  '`'     : élément ((d2*68)+(d3)+(4556)+(WORD_TOTAL)) de DICT puis flush
  '|'     : ajouter buf à DATA ; buf = '' ; pend = ''
  '~'     : copier les lettres suivantes dans buf jusqu'au prochain '~'
  après chaque ajout (token ou échappement) : pend = ' '
"""

from __future__ import annotations
import hashlib
import random
from collections import Counter, defaultdict

# ---------------------------------------------------------------- constantes

ALPHA = [chr(c) for c in range(0x21, 0x61)] + ['{', '|', '}', '~']  # 68
AVAL = {ch: i for i, ch in enumerate(ALPHA)}          # char -> valeur 0..67

RESERVED_LEADS = ('`', '{', '|', '}', '~')
HOLE_V1 = {AVAL[c] for c in RESERVED_LEADS}           # {63, 64, 65, 66, 67}

WORD3_BASE = 4284                                     # ids '{' ...
LINE_EXT_BASE = 4624                                  # lineIdx '`' ...
TWO_CHAR_LIMIT = 63 * 68                              # 4284 (ids 0..4283)

CAP_3CHAR = 68 * 68                                   # 4624
CAP_LINE = 2 * 68 * 68                                # 9248

MAX_NGRAM = 6          # longueur max des phrases candidates (en mots)
TOKEN_BONUS = 3.0      # bonus (octets) par token économisé -> entrées longues
ENTRY_OVERHEAD = 5     # coût fixe d'une entrée dans DICT (JSON: "",,)


# ------------------------------------------------------------ validation txt

def normalize_line(line: str) -> str:
    line = line.replace('\t', ' ').replace('\r', ' ')
    while '  ' in line:
        line = line.replace('  ', ' ')
    return line.strip()


def validate_line(line: str) -> list[str]:
    """Retourne la liste des problèmes d'une ligne (vide = ok)."""
    problems = []
    if line == '':
        problems.append('ligne vide')
    if '~' in line:
        problems.append("contient '~' (interdit)")
    for ch in line:
        if not (0x20 <= ord(ch) <= 0x7E):
            problems.append(f'caractère non-ASCII-imprimable: {ch!r}')
            break
    if line != line.strip():
        problems.append('espace en début/fin')
    if '  ' in line:
        problems.append('double espace')
    if len(line) > 500:
        problems.append(f'ligne trop longue ({len(line)})')
    return problems


# ------------------------------------------------------------- mining ngrammes

def _mine_counts(lines: list[str]) -> Counter:
    """Compte les n-grammes (1..MAX_NGRAM mots) — un n-gramme compte à chaque
    fois qu'il apparaît comme suite de mots complète (frontières alignées)."""
    cnt: Counter = Counter()
    for line in lines:
        words = line.split(' ')
        n_words = len(words)
        for n in range(1, min(MAX_NGRAM, n_words) + 1):
            for i in range(0, n_words - n + 1):
                cnt[' '.join(words[i:i + n])] += 1
    return cnt


# ------------------------------------------------------------------ matcher

def _aligned(text: str, q: int) -> bool:
    """La position q est-elle une frontière de mot (espace ou fin) ?"""
    return q == len(text) or text[q] == ' '


class _Matcher:
    """Cherche le plus long entry applicable à text[p:] avec alignement sur
    les frontières de mots."""

    def __init__(self, entries: set[str]):
        self.by_prefix: dict[str, list[str]] = defaultdict(list)
        for entry in entries:
            self.by_prefix[entry[:2]].append(entry)
        for key in self.by_prefix:
            self.by_prefix[key].sort(key=len, reverse=True)

    def match(self, text: str, p: int):
        key = text[p:p + 2]
        cands = self.by_prefix.get(key)
        if not cands:
            return None
        for entry in cands:
            q = p + len(entry)
            if text.startswith(entry, p) and _aligned(text, q):
                return entry
        return None


# ------------------------------------------------------------- dictionnaire

class SxpDictionary:
    def __init__(self):
        self.word_entries: list[str] = []    # DENSE : index de liste == id
        self.line_entries: list[str] = []    # index = lineIdx
        self.expansions: dict[str, str] = {}  # phrase -> code émis
        self.line_codes: dict[str, str] = {}  # ligne complète -> code émis

    # ------------------------------------------------------------------
    @staticmethod
    def _code_for_2char(wid: int) -> str:
        v1, v2 = divmod(wid, 68)
        if v1 in HOLE_V1 or v1 > 62:
            raise ValueError(f'id {wid} inutilisable en 2 chars')
        return ALPHA[v1] + ALPHA[v2]

    @staticmethod
    def _code_for_3char(wid: int) -> str:
        v2, v3 = divmod(wid - WORD3_BASE, 68)
        return '{' + ALPHA[v2] + ALPHA[v3]

    @staticmethod
    def _code_for_line(lidx: int) -> str:
        if lidx < LINE_EXT_BASE:
            v2, v3 = divmod(lidx, 68)
            return '}' + ALPHA[v2] + ALPHA[v3]
        v2, v3 = divmod(lidx - LINE_EXT_BASE, 68)
        return '`' + ALPHA[v2] + ALPHA[v3]

    # ------------------------------------------------------------------
    def build(self, lines: list[str], *,
              line_dict_budget: int = 850_000,
              min_word_count: int = 3,
              min_line_count: int = 2,
              refine: bool = True,
              verbose: bool = True) -> None:
        line_counts = Counter(lines)

        def log(*a):
            if verbose:
                print('[sxp]', *a)

        cnt = _mine_counts(lines)

        def quick_score(phrase: str) -> float:
            return cnt[phrase] * (len(phrase) + 1)

        pre = [p for p in cnt if cnt[p] >= min_word_count]
        pre.sort(key=quick_score, reverse=True)
        pre = pre[:40000]
        log(f'candidats pré-filtrés: {len(pre)}')

        # --- sélection itérative (passe 1 = comptages bruts,
        #     passe 2 = usages réels après segmentation greedy)
        usage: Counter = cnt
        pool: list[str] = pre
        selected: set[str] = set()
        for round_i in range(2 if refine else 1):
            scored = []
            for phrase in pool:
                c = usage[phrase]
                if c < min_word_count:
                    continue
                score = c * (len(phrase) + 1 - 2 + TOKEN_BONUS) \
                    - (len(phrase) + ENTRY_OVERHEAD)
                if score > 0:
                    scored.append((score, phrase))
            scored.sort(reverse=True)
            selected = {p for _, p in scored}
            log(f'passe {round_i}: {len(scored)} scorés, {len(selected)} retenus')
            if refine and round_i == 0:
                pool = sorted(selected)
                usage = self._count_usages(lines, selected)

        # --- affectation des ids : meilleurs scores en 2 chars
        rescored = []
        for phrase in selected:
            c = usage[phrase]
            score = c * (len(phrase) + 1 - 2 + TOKEN_BONUS) \
                - (len(phrase) + ENTRY_OVERHEAD)
            rescored.append((score, phrase))
        rescored.sort(reverse=True)

        self.word_entries = []
        self.expansions = {}
        wid = 0
        for score, phrase in rescored:
            if wid >= WORD3_BASE + CAP_3CHAR:
                break
            if wid < TWO_CHAR_LIMIT:
                while wid < TWO_CHAR_LIMIT and (wid // 68) in HOLE_V1:
                    self.word_entries.append('#')   # remplissage (jamais lu)
                    wid += 1
                if wid >= TWO_CHAR_LIMIT:
                    while wid < WORD3_BASE:
                        self.word_entries.append('#')
                        wid += 1
            code = (self._code_for_2char(wid) if wid < TWO_CHAR_LIMIT
                    else self._code_for_3char(wid))
            self.expansions[phrase] = code
            self.word_entries.append(phrase)
            wid += 1
        real = sum(1 for e in self.word_entries if e != '#')
        log(f'entrées mot: {len(self.word_entries)} ids ({real} réels)')

        # --- dictionnaire de lignes (lignes répétées -> 3 octets)
        line_scored = []
        for line, c in line_counts.items():
            if c < min_line_count or len(line) > 250:
                continue
            save = c * (len(line) - 2 + len(line) / 6) - (len(line) + ENTRY_OVERHEAD)
            if save > 0:
                line_scored.append((save, line, c))
        line_scored.sort(reverse=True)
        budget = line_dict_budget
        self.line_entries = []
        self.line_codes = {}
        for save, line, c in line_scored:
            if len(self.line_entries) >= CAP_LINE:
                break
            if budget - (len(line) + 1) < 0:
                break
            budget -= len(line) + 1
            self.line_codes[line] = self._code_for_line(len(self.line_entries))
            self.line_entries.append(line)
        log(f'entrées ligne: {len(self.line_entries)} '
            f'(budget restant {budget} octets)')

    # ------------------------------------------------------------------
    def _count_usages(self, lines: list[str], pool: set[str]) -> Counter:
        """Compte les usages réels des phrases après segmentation greedy avec
        le pool courant (approx : matching aligné, sans échappements)."""
        matcher = _Matcher(pool)
        usage: Counter = Counter()
        line_counts = Counter(lines)
        for line, weight in line_counts.items():
            p = 0
            L = len(line)
            while p < L:
                m = matcher.match(line, p)
                if m:
                    usage[m] += weight
                    p += len(m)
                    if p < L and line[p] == ' ':
                        p += 1
                else:
                    e = line.find(' ', p)
                    p = e + 1 if e != -1 else L
        return usage

    # ------------------------------------------------------------------
    def encode_line(self, line: str, matcher: _Matcher) -> str:
        if line in self.line_codes:
            return self.line_codes[line]
        out = []
        text = line
        L = len(text)
        p = 0
        while p < L:
            m = matcher.match(text, p)
            if m:
                out.append(self.expansions[m])
                p += len(m)
                if p < L and text[p] == ' ':
                    p += 1
            else:
                e = text.find(' ', p)
                chunk = text[p:] if e == -1 else text[p:e]
                out.append('~' + chunk + '~')
                p = p + len(chunk) if e == -1 else e + 1
        out.append('|')
        return ''.join(out)

    def encode(self, lines: list[str], *, item_chars: int = 1600) -> list[str]:
        matcher = _Matcher(set(self.expansions))
        items: list[str] = []
        cur_len = 0
        cur: list[str] = []
        for line in lines:
            enc = self.encode_line(line, matcher)
            if cur_len + len(enc) > item_chars and cur:
                items.append(''.join(cur))
                cur, cur_len = [], 0
            cur.append(enc)
            cur_len += len(enc)
        if cur:
            items.append(''.join(cur))
        return items

    def dict_list(self) -> list[str]:
        return self.word_entries + self.line_entries


# ------------------------------------------------------- décodeur (simulateur)
# MIROIR EXACT du script Scratch (mêmes états : buf, pend, ci).

def decode(items: list[str], dict_list: list[str],
           word_total: int) -> list[str]:
    out: list[str] = []
    buf = ''
    pend = ''
    for s in items:
        ci = 0
        L = len(s)
        while ci < L:
            c = s[ci]
            if c == '|':
                out.append(buf)
                buf = ''
                pend = ''
                ci += 1
            elif c == '~':
                ci += 1
                raw = ''
                while s[ci] != '~':
                    raw += s[ci]
                    ci += 1
                ci += 1
                buf += pend + raw
                pend = ' '
            elif c == '{':
                d2 = AVAL[s[ci + 1]]
                d3 = AVAL[s[ci + 2]]
                wid = WORD3_BASE + d2 * 68 + d3
                buf += pend + dict_list[wid]
                pend = ' '
                ci += 3
            elif c == '}':
                d2 = AVAL[s[ci + 1]]
                d3 = AVAL[s[ci + 2]]
                lidx = d2 * 68 + d3
                buf += pend + dict_list[word_total + lidx]
                out.append(buf)
                buf = ''
                pend = ''
                ci += 3
            elif c == '`':
                d2 = AVAL[s[ci + 1]]
                d3 = AVAL[s[ci + 2]]
                lidx = LINE_EXT_BASE + d2 * 68 + d3
                buf += pend + dict_list[word_total + lidx]
                out.append(buf)
                buf = ''
                pend = ''
                ci += 3
            else:
                d1 = AVAL[c]
                d2 = AVAL[s[ci + 1]]
                wid = d1 * 68 + d2
                buf += pend + dict_list[wid]
                pend = ' '
                ci += 2
    if buf:
        out.append(buf)
    return out


# ------------------------------------------------------------------- driver

def compress_lines(lines: list[str], **kw) -> dict:
    """Compresse des lignes ; vérifie le roundtrip ; retourne tout."""
    item_chars = kw.pop('item_chars', 1600)
    d = SxpDictionary()
    d.build(lines, **kw)
    # le décodeur Scratch n'implémente PAS '{' (mot 3 chars) ni '`' (ligne
    # étendue) -> garantit qu'ils ne sont jamais émis
    assert len(d.word_entries) <= TWO_CHAR_LIMIT, (
        f'{len(d.word_entries)} mots > {TWO_CHAR_LIMIT} : tokens {{ émis !')
    assert len(d.line_entries) <= LINE_EXT_BASE, (
        f'{len(d.line_entries)} lignes > {LINE_EXT_BASE} : tokens ` émis !')
    items = d.encode(lines, item_chars=item_chars)
    dict_list = d.dict_list()
    word_total = len(d.word_entries)
    decoded = decode(items, dict_list, word_total)
    assert decoded == lines, 'ROUNDTRIP ÉCHOUÉ — bug encodeur/décodeur'
    stats = {
        'raw_bytes': sum(len(l) + 1 for l in lines),
        'payload_bytes': sum(len(i) + 1 for i in items),
        'dict_bytes': sum(len(e) + 4 for e in dict_list),
        'n_items': len(items),
        'word_total': word_total,
        'line_total': len(d.line_entries),
        'expected_lines': len(lines),
        'expected_chars': sum(len(l) for l in lines),
        'dataset_sha256': hashlib.sha256('\n'.join(lines).encode()).hexdigest(),
    }
    stats['json_bytes_estimate'] = stats['payload_bytes'] + stats['dict_bytes'] + 2048
    return {
        'items': items,
        'dict_list': dict_list,
        'word_total': word_total,
        'stats': stats,
        'dictionary': d,
    }


def fuzz_test(n_cases: int = 400, seed: int = 42) -> None:
    rng = random.Random(seed)
    vocab = list(ALPHA)
    words = [''.join(rng.choice(vocab) for _ in range(rng.randint(1, 8)))
             for _ in range(500)]
    words += ['hello', 'you?', 'ok', 'a', 'I', '42', 'Mr.', 'e-mail',
              'co-operate', '{weird}', '`ticks`', '|pipes|', '"quotes"',
              "it's", 'CAPS', 'x', 'z z', 'aa']
    lines = []
    for _ in range(n_cases):
        n = rng.randint(1, 25)
        line = ' '.join(rng.choice(words) for _ in range(n))
        line = normalize_line(line).replace('~', '-')
        if line:
            lines.append(line)
    res = compress_lines(lines, verbose=False, line_dict_budget=60_000)
    assert res['stats']['expected_lines'] == len(lines)
    ratio = res['stats']['raw_bytes'] / max(1, res['stats']['json_bytes_estimate'])
    print(f'[sxp] fuzz OK: {len(lines)} lignes aléatoires, '
          f'ratio {ratio:.2f}x (données aléatoires = pire cas)')


if __name__ == '__main__':
    fuzz_test()
    # petit cas réel de smoke test
    demo = [
        'Hi there! I am Sorax 1, an AI assistant made by Snowoo-.',
        'Hi there! I am Sorax 1, an AI assistant made by Snowoo-.',
        'How are you today?',
        'I am doing great, thanks for asking! How are you?',
        'What is your name?',
        'My name is Sorax 1. I was created by Snowoo- on Scratch!',
    ] * 5
    res = compress_lines(demo, verbose=True, line_dict_budget=10_000)
    s = res['stats']
    print(f"[sxp] demo: {s['raw_bytes']} o brut -> {s['json_bytes_estimate']} o "
          f"(x{s['raw_bytes'] / s['json_bytes_estimate']:.2f}), "
          f"dict={len(res['dict_list'])} entrées, items={s['n_items']}")
