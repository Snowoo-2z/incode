# -*- coding: utf-8 -*-
"""
SORAX 1 — Générateur de dataset.

Produit dataset.txt : ligne 1 = prompt, ligne 2 = réponse, etc.

Usage :
    python3 gen_dataset.py [--scale 1.0] [--seed 1337] [--out ../data/dataset.txt]

Le générateur est déterministe (seed fixe) : deux exécutions donnent le
même dataset, pour pouvoir re-régénérer et comparer.

Sections :
  1. familles manuelles (content_*.py) avec poids
  2. familles "pool" (blagues, énigmes, faits...) : prompts x émissions
  3. familles programmables : math, comptines, alphabet, orthographe, noms
  4. variantes avec fautes de frappe (le "correcteur" passif)
  5. variantes capitalisées
  6. mélange + validation + stats
"""

from __future__ import annotations
import argparse
import os
import random
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from content_identity import FAMILIES_IDENTITY
from content_chat import FAMILIES_CHAT
import content_knowledge as K

CREATOR = "Snowoo-"
MODEL = "Sorax 1"

# ----------------------------------------------------------- fautes de frappe

# substitutions "langage SMS" (mot -> variante), appliquées avec proba
SLANG = {
    'you': 'u', 'are': 'r', 'your': 'ur', 'what': 'wat', 'whats': 'wats',
    'thanks': 'thx', 'thank': 'thx', 'please': 'pls', 'because': 'cuz',
    'okay': 'ok', 'love': 'luv', 'right': 'rite', 'with': 'wit',
    'have': 'hav', 'doing': 'doin', 'going': 'gonna', 'before': 'b4',
    'though': 'tho', 'through': 'thru', 'tonight': 'tonite',
    'about': 'abt', 'really': 'rly', 'something': 'smth', 'guess': 'gess',
    'hello': 'helo', 'hey': 'hay', 'there': 'thre', 'would': 'wud',
    'could': 'cud', 'what': 'whut', 'know': 'kno', 'little': 'lil',
    'maybe': 'mabey', 'favorite': 'faverite', 'awesome': 'awsome',
    'because': 'becuz', 'people': 'ppl', 'want': 'wnt', 'good': 'gud',
    'night': 'nite', 'sure': 'shure', 'cool': 'kool', 'school': 'skool',
}

# voisins de clavier (approximation QWERTY)
KEY_NBRS = {
    'a': 'sq', 'b': 'vn', 'c': 'xv', 'd': 'sf', 'e': 'rw', 'f': 'dg',
    'g': 'fh', 'h': 'gj', 'i': 'ou', 'j': 'hk', 'k': 'jl', 'l': 'k',
    'm': 'n', 'n': 'bm', 'o': 'ip', 'p': 'o', 'q': 'wa', 'r': 'et',
    's': 'ad', 't': 'ry', 'u': 'yi', 'v': 'cb', 'w': 'qe', 'x': 'zc',
    'y': 'tu', 'z': 'x',
}


def _typo_drop_letter(rng, w):
    if len(w) < 4:
        return w
    doubles = [i for i in range(1, len(w)) if w[i] == w[i - 1]]
    if doubles:
        i = rng.choice(doubles)
        return w[:i] + w[i + 1:]
    i = rng.randrange(1, len(w) - 1)
    return w[:i] + w[i + 1:]


def _typo_swap(rng, w):
    if len(w) < 4:
        return w
    i = rng.randrange(len(w) - 1)
    if w[i] == w[i + 1]:
        return w
    return w[:i] + w[i + 1] + w[i] + w[i + 2:]


def _typo_neighbor(rng, w):
    for i, ch in enumerate(w):
        if ch in KEY_NBRS:
            if rng.random() < 0.4:
                n = rng.choice(KEY_NBRS[ch])
                return w[:i] + n + w[i + 1:]
    return w


def _typo_double(rng, w):
    return w + w[-1]


def make_typos(rng, prompt, n):
    """Génère jusqu'à n variantes fautes de frappe distinctes d'un prompt."""
    out = set()
    tries = 0
    while len(out) < n and tries < 60:
        tries += 1
        words = prompt.split(' ')
        new = []
        budget = rng.choice([1, 1, 2])
        for w in words:
            w2 = w
            # apostrophes -> toujours collées
            if "'" in w2:
                w2 = w2.replace("'", "")
            # JAMAIS de faute dans un mot qui contient un chiffre
            # (sinon "10x6" peut devenir "1x6" et la réponse devient fausse!)
            if any(c.isdigit() for c in w2):
                new.append(w2)
                continue
            if budget > 0:
                r = rng.random()
                low = w2.lower()
                if r < 0.22 and low in SLANG:
                    w2 = SLANG[low] if w2.islower() else SLANG[low].capitalize()
                    budget -= 1
                elif r < 0.40:
                    w2 = _typo_drop_letter(rng, w2)
                    budget -= 1
                elif r < 0.52:
                    w2 = _typo_swap(rng, w2)
                    budget -= 1
                elif r < 0.62:
                    w2 = _typo_neighbor(rng, w2)
                    budget -= 1
                elif r < 0.68 and len(w2) <= 6:
                    w2 = _typo_double(rng, w2)
                    budget -= 1
            new.append(w2)
        cand = ' '.join(new)
        if cand != prompt and cand.strip() != '':
            out.add(cand)
    return list(out)[:n]


# ------------------------------------------------------- familles "pool"

def _emit_pool(rng, pairs, prompt, pool, emissions):
    """Émet `emissions` paires pour un prompt, en tournant dans le pool."""
    if emissions <= 0:
        return
    shuffled = pool[:]
    rng.shuffle(shuffled)
    reps = -(-emissions // len(shuffled))
    cycle = (shuffled * reps)[:emissions]
    for resp in cycle:
        pairs.append((prompt, resp))


# ------------------------------------------------------- familles maths etc.

def _math_pairs():
    pairs = []
    # tables de multiplication 2..12 (plusieurs formes de prompt)
    for a in range(2, 13):
        for b in range(2, 13):
            r = f"{a} x {b} = {a * b}."
            pairs.append((f"what is {a}x{b}", r))
            pairs.append((f"{a}x{b}", r))
            pairs.append((f"whats {a} x {b}", r))
            pairs.append((f"{a} times {b}", r))
            if a <= 6:
                pairs.append((f"what is {b}x{a}", r))
    # additions 0..20
    for a in range(0, 21):
        for b in range(0, 21):
            r = f"{a} + {b} = {a + b}."
            pairs.append((f"what is {a}+{b}", r))
            if b > 0:
                pairs.append((f"{a}+{b}", r))
            if a + b <= 12:
                pairs.append((f"whats {a}+{b}", r))
            if a + b <= 20 and b > 0 and a <= 12:
                pairs.append((f"{a} + {b}", r))
    # soustractions 0..20
    for a in range(1, 21):
        for b in range(0, a + 1):
            pairs.append((f"what is {a}-{b}", f"{a} - {b} = {a - b}."))
            if a - b >= 2 and b > 0:
                pairs.append((f"{a}-{b}", f"{a} - {b} = {a - b}."))
    # divisions exactes
    for a in range(2, 13):
        for b in range(2, 13):
            pairs.append((f"what is {a*b}/{a}", f"{a * b} / {a} = {b}."))
            if b <= 6:
                pairs.append((f"{a*b} divided by {a}", f"{a * b} / {a} = {b}."))
    # doubles et moitiés
    for a in range(1, 26):
        pairs.append((f"whats the double of {a}", f"The double of {a} is {a * 2}."))
        if a % 2 == 0:
            pairs.append((f"whats half of {a}", f"Half of {a} is {a // 2}."))
    # classiques
    pairs += [
        ("what is 2+2", "2 + 2 = 4."),
        ("2+2", "2 + 2 = 4."),
        ("2+2?", "2 + 2 = 4."),
        ("whats 2+2", "2 + 2 = 4."),
        ("what is 2 plus 2", "2 + 2 = 4."),
        ("how much is 2+2", "2 + 2 = 4."),
        ("what is 100+100", "100 + 100 = 200."),
        ("what is 1000+1000", "1000 + 1000 = 2000."),
        ("what is 10x10", "10 x 10 = 100."),
        ("what is 5x5", "5 x 5 = 25."),
        ("what is 0+0", "0 + 0 = 0."),
        ("what is 1+1", "1 + 1 = 2."),
        ("1+1", "1 + 1 = 2."),
        ("whats 9+10", "9 + 10 = 19. (Not 21, sorry!)"),
    ]
    return pairs


def _counting_pairs():
    def count_str(n):
        return ' '.join(str(i) for i in range(1, n + 1))
    pairs = []
    for n in (5, 10, 20):
        pairs.append((f"count to {n}", count_str(n) + "."))
        pairs.append((f"can you count to {n}", count_str(n) + "."))
    pairs.append(("count to 50", count_str(50) + "."))
    pairs.append(("count to 100", count_str(100) + "."))
    pairs.append(("can you count to 100", count_str(100) + "."))
    pairs.append(("say the alphabet",
                  "A B C D E F G H I J K L M N O P Q R S T U V W X Y Z!"))
    pairs.append(("alphabet",
                  "A B C D E F G H I J K L M N O P Q R S T U V W X Y Z!"))
    pairs.append(("can you say the alphabet",
                  "A B C D E F G H I J K L M N O P Q R S T U V W X Y Z!"))
    return pairs


def _spell_pairs():
    pairs = []
    for w in K.SPELL_WORDS:
        letters = '-'.join(w.upper())
        pairs.append((f"spell {w}", f"{w} is spelled: {letters}."))
    return pairs


def _name_pairs(rng):
    ADJ = ['Cool', 'Epic', 'Silent', 'Neon', 'Shadow', 'Galaxy', 'Frosty',
           'Turbo', 'Cosmic', 'Crystal', 'Wild', 'Lucky', 'Sparky', 'Mega',
           'Pixel', 'Rapid', 'Ghost', 'Solar', 'Lunar', 'Iron', 'Golden',
           'Stormy', 'Frozen', 'Nova', 'Retro', 'Cyber', 'Hyper', 'Snappy']
    NOUN = ['Fox', 'Wolf', 'Tiger', 'Dragon', 'Panda', 'Nova', 'Blade',
            'Storm', 'Phoenix', 'Coder', 'Gamer', 'Ninja', 'Rocket',
            'Vortex', 'Turtle', 'Falcon', 'Panda', 'Wizard', 'Knight',
            'Comet', 'Byte', 'Pixel', 'Shadow', 'Ranger', 'Rex']
    combos = [a + n for a in ADJ for n in NOUN]
    rng.shuffle(combos)
    combos = combos[:520]
    q = ["give me a username idea", "username ideas", "i need a username",
         "help me pick a username", "any username ideas",
         "give me another username idea"]
    for i, name in enumerate(combos):
        prompt = q[i % len(q)]
        resp = rng.choice([
            f"How about {name}? Sounds cool!",
            f"{name}! That name has style.",
            f"Maybe {name}? It has a nice ring to it!",
            f"{name} is a solid choice!",
        ])
        pairs = []
        yield (prompt, resp)

    PETS = ['Biscuit', 'Mochi', 'Pepper', 'Luna', 'Milo', 'Oreo', 'Ziggy',
            'Noodle', 'Peanut', 'Maple', 'Clover', 'Waffles', 'Pixel',
            'Marshmallow', 'Boba', 'Pickles', 'Cocoa', 'Ginger', 'Olive',
            'Pumpkin', 'Sprout', 'Tofu', 'Zuko', 'Basil', 'Cinnamon',
            'Muffin', 'Nacho', 'Pesto', 'Sushi', 'Waffles']
    q = ["help me name my pet", "pet name ideas", "what should i name my pet",
         "give me a pet name", "i need a name for my pet"]
    for i, name in enumerate(PETS):
        yield (q[i % len(q)],
               rng.choice([f"How about {name}? Adorable!",
                           f"{name}! Perfect pet name.",
                           f"Definitely {name}. It's a classic!"]))

    THEMES = ['Snow', 'Space', 'Pizza', 'Cat', 'Robot', 'Dragon', 'Ocean',
              'Jungle', 'Candy', 'Ghost', 'Pirate', 'Ninja', 'Wizard',
              'Dino', 'Fox', 'Star']
    SUFFIX = ['Rush', 'Quest', 'Escape', 'Adventure', 'Run', 'Jump',
              'Defense', 'Master', 'World', 'Dash', 'Catcher', 'Squad']
    proj = [t + s for t in THEMES for s in SUFFIX]
    rng.shuffle(proj)
    q = ["name ideas for my game", "what should i name my game",
         "game name ideas", "help me name my project",
         "what should i name my project"]
    for i, name in enumerate(proj[:260]):
        yield (q[i % len(q)],
               rng.choice([f"How about {name}?",
                           f"{name} sounds like a hit!",
                           f"Definitely {name}! Great title."]))


# ------------------------------------------------------------- assemblage

def build_pairs(scale=1.0, seed=1337, typo_top=900, typo_per=2):
    rng = random.Random(seed)
    pairs = []

    def W(base):
        return max(1, round(base * scale))

    # 1. familles manuelles
    manual = FAMILIES_IDENTITY + FAMILIES_CHAT
    manual.append(("scratch", K.SCRATCH_HELP, 3))
    manual.append(("knowledge", K.KNOWLEDGE, 3))
    manual.append(("miscqa", K.MISC_QA, 3))
    manual.append(("wyr_answers", K.WYR_ANSWERS, 3))
    for name, fam, weight in manual:
        w = W(weight)
        for prompt, responses in fam:
            picks = []
            pool = responses[:]
            while len(picks) < w:
                rng.shuffle(pool)
                picks.extend(pool)
            for resp in picks[:w]:
                pairs.append((prompt, resp))

    # 2. familles "pool" (les émissions montent avec le scale)
    pools = [
        (K.JOKE_PROMPTS, 15), (K.RIDDLE_PROMPTS, 10), (K.FACT_PROMPTS, 10),
        (K.WYR_PROMPTS, 4), (K.IDEA_PROMPTS, 12),
        (K.STORY_PROMPTS, 12), (K.COMPLIMENT_PROMPTS, 6),
        (K.MOTIVATION_PROMPTS, 6), (K.CHALLENGE_PROMPTS, 6),
        (K.EIGHT_BALL_PROMPTS, 5), (K.RPS_PROMPTS, 5),
        (K.NUMBER_PROMPTS, 5), (K.COIN_PROMPTS, 5),
        ({"what should i draw": K.DRAW_IDEAS,
          "what should i draw today": K.DRAW_IDEAS,
          "draw ideas": K.DRAW_IDEAS,
          "give me drawing ideas": K.DRAW_IDEAS,
          "i want to draw something": K.DRAW_IDEAS}, 6),
    ]
    for pd, emissions in pools:
        e = max(2, round(emissions * scale / 2))
        for prompt, pool in pd.items():
            _emit_pool(rng, pairs, prompt, pool, e)

    # 2bis. apostrophes de l'IA
    SORAX_CALLS = [
        ("sorax", ["Yes? How can I help?", "I'm here! What do you need?"]),
        ("hey sorax", ["Yes? I'm listening!", "Hey! What's up?"]),
        ("yo sorax", ["Yo! What can I do for you?"]),
        ("hey sorax whats up", ["Not much, just being an AI! You?"]),
        ("sorax are you there", ["Always! What do you need?"]),
        ("thanks sorax", ["You're welcome! Anytime!"]),
        ("bye sorax", ["See you later! Come back soon!"]),
        ("good job sorax", ["Thanks! I'm blushing. Well, I would be if I could blush!"]),
        ("i love you sorax", ["Aww! You're a great human. I like you too!"]),
        ("sorax help", ["Help is my middle name! Well, I don't have one, but you get the idea!"]),
    ]
    for prompt, responses in SORAX_CALLS:
        for _ in range(W(3)):
            pairs.append((prompt, rng.choice(responses)))

    # 3. familles programmables
    pairs.extend(_math_pairs())
    pairs.extend(_counting_pairs())
    pairs.extend(_spell_pairs())
    pairs.extend(_name_pairs(rng))

    # 4. variantes capitalisées + exclamations des prompts courants
    prompt_count = Counter(p for p, _ in pairs)
    top_prompts = [p for p, c in prompt_count.most_common(typo_top)
                   if p and p[0].islower()]
    prompt_set = set(prompt_count)
    responses_by_prompt = {}
    for p, r in pairs:
        responses_by_prompt.setdefault(p, []).append(r)

    n_caps = 0
    for p in top_prompts[:500]:
        cap = p[0].upper() + p[1:]
        if cap not in prompt_set:
            prompt_set.add(cap)
            pairs.append((cap, rng.choice(responses_by_prompt[p])))
            n_caps += 1

    n_allcaps = 0
    for p in top_prompts[:160]:
        if len(p) <= 22:
            up = p.upper()
            if up not in prompt_set:
                prompt_set.add(up)
                pairs.append((up, rng.choice(responses_by_prompt[p])))
                n_allcaps += 1

    n_excl = 0
    for p in top_prompts[:250]:
        if len(p) <= 28 and p[-1] not in '!?.':
            cand = p + '!'
            if cand not in prompt_set:
                prompt_set.add(cand)
                pairs.append((cand, rng.choice(responses_by_prompt[p])))
                n_excl += 1

    # 5. variantes avec fautes de frappe
    n_typos = 0
    for p in top_prompts:
        for t in make_typos(rng, p, typo_per):
            if t not in prompt_set and t.strip():
                prompt_set.add(t)
                pairs.append((t, rng.choice(responses_by_prompt[p])))
                n_typos += 1

    # 6. mélange final
    rng.shuffle(pairs)
    print(f"[gen] {len(pairs)} paires | {len(prompt_set)} prompts distincts | "
          f"{n_caps} variantes caps | {n_typos} variantes typos")
    return pairs


def validate(pairs):
    problems = []
    seen = set()
    for i, (p, r) in enumerate(pairs):
        for label, line in (('prompt', p), ('réponse', r)):
            if line == '' or line.strip() == '':
                problems.append(f'paire {i}: {label} vide')
                continue
            if line != line.strip():
                problems.append(f'paire {i}: {label} espaces en bord')
            if '  ' in line:
                problems.append(f'paire {i}: {label} double espace')
            if '~' in line:
                problems.append(f'paire {i}: {label} contient ~')
            for ch in line:
                if not (0x20 <= ord(ch) <= 0x7E):
                    problems.append(f'paire {i}: {label} char {ch!r}')
                    break
            if len(line) > 500:
                problems.append(f'paire {i}: {label} trop longue ({len(line)})')
        # cohérence persona
        low = p.lower()
        if ('who made you' in low or 'who created you' in low
                or 'your creator' in low or 'who built you' in low
                or 'who programmed you' in low):
            if 'snowoo' not in r.lower():
                problems.append(f'paire {i}: créateur sans Snowoo-: {r[:60]}')
        if 'what model' in low:
            if 'sorax 1' not in r.lower():
                problems.append(f'paire {i}: modèle sans Sorax 1: {r[:60]}')
    # dédoublonnage exact (garder, c'est du pondération volontaire)
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scale', type=float, default=8.0)
    ap.add_argument('--seed', type=int, default=1337)
    ap.add_argument('--out', default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', 'data',
        'dataset.txt'))
    ap.add_argument("--typo-top", type=int, default=2400)
    ap.add_argument("--typo-per", type=int, default=4)
    args = ap.parse_args()

    pairs = build_pairs(scale=args.scale, seed=args.seed,
                        typo_top=args.typo_top, typo_per=args.typo_per)
    problems = validate(pairs)
    if problems:
        print(f'[gen] {len(problems)} PROBLÈMES:')
        for p in problems[:30]:
            print('   -', p)
        sys.exit(1)
    print('[gen] validation OK (0 problème)')

    lines = []
    for p, r in pairs:
        lines.append(p)
        lines.append(r)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, 'w', encoding='ascii') as f:
        f.write('\n'.join(lines) + '\n')

    n = len(pairs)
    raw = sum(len(p) + len(r) + 2 for p, r in pairs)
    uniq_p = len(set(p for p, _ in pairs))
    print(f'[gen] écrit {args.out}')
    print(f'[gen] {n} paires ({uniq_p} prompts distincts), '
          f'{raw / 1024 / 1024:.2f} Mo brut, '
          f'{raw / n:.0f} octets/paire en moyenne')


if __name__ == '__main__':
    main()
