# Sorax 1 — une IA sur Scratch 🤖

> Assistant à base de mots-clés pour Scratch : **29 936 paires prompt/réponse**
> compressées dans un fichier `.sb3` de **198 Ko** (project.json 476 Ko,
> loin sous la limite de ~5 Mo), décompressées **au drapeau vert** dans une
> seule liste `DATA`, prête pour ton script d'inférence.

Créateur : **Snowoo-** · Modèle : **Sorax 1**

---

## 1. Les idées de compression (le « pourquoi ça marche »)

### Idée 1 — le dictionnaire n-grammes (LZ à la Scratch)
On mine dans le dataset les suites de mots (1 à 6 mots) qui reviennent le
plus souvent, et on remplace chaque occurrence par un **code de 2 caractères**
(ou 3 pour les lignes entières répétées). C'est l'idée de LZ77/ZIP adaptée à
Scratch : au lieu de pointeurs « distance/longueur », un index dans une liste.
Le score de sélection imite le gain réel :
`score = usages × (longueur + bonus_token) − (longueur + coût_entry)`.

### Idée 2 — l'astuce « pend » (l'espace en attente)
Un même mot du dictionnaire doit marcher **au milieu** d'une ligne ( suivi
d'une espace) **et en fin** de ligne (pas d'espace). Au lieu de stocker
l'espace dans le dictionnaire, le décodeur garde `pend` ('' ou ' ') :
`buf = join(join(buf, pend), entrée)` puis `pend = " "`. Au flush, l'espace
en attente est jetée. Résultat : chaque entrée de dict est réutilisable
partout, et le dict ne contient jamais d'espaces parasites.

### Idée 3 — l'alphabet « Scratch-proof » (base 68)
Scratch compare les chaînes **sans tenir compte de la casse**
(`Cast.compare` fait `toLowerCase()`), et « item # de (x) dans LISTE » aussi.
Donc `a` et `A` sont indiscernables ! L'alphabet de compression
(**68 caractères** : `!`…`` ` `` puis `{ | } ~`) ne contient **aucune paire
majuscule/minuscule** : chaque comparaison et chaque `item #` est exact.
Les 5 « plombs » (`{|}~` et `` ` ``) sont les 5 derniers caractères de
l'alphabet → aucun « trou » à combler dans le dictionnaire.

### Idée 4 — les lignes entières en 3 caractères
Les lignes qui reviennent au moins 2 fois (prompts populaires, réponses
types) partent dans une 2ᵉ zone du dictionnaire, codées `}` + 2 chars :
une ligne de 60 caractères → 3 caractères (ratio 20×).

### Idée 5 — la vérification intégrée
Le script `verify data` recompte les lignes et les caractères de `DATA` et
les compare aux constantes attendues : la variable `STATUS` passe à
`Ready!` seulement si tout est identique. Le moniteur STATUS affiche la
progression pendant le chargement.

### Idée 6 — l'échappement `~mot~`
Les mots rares (pas assez fréquents pour mériter une entrée de dict) sont
copiés littéralement entre deux `~`. Le contenu brut peut contenir n'importe
quel caractère du dataset (y compris minuscules) : il n'est jamais comparé,
juste recopié lettre par lettre.

### Idée 7 — le découpage en items ~1600 caractères
Le payload est découpé en 166 « items » (chaîne de la liste COMPRESSED).
La procédure `process item %s` (WFR = « run without screen refresh »)
décode un item entier par appel → ~15 ms/item, **chargement total < 1 s**.

---

## 2. Le format SXP-2 en bref

```
ALPHA (68 chars)  = !"#$%&'()*+,-./0123456789:;<=>?@A-Z[\]^_`{|}~
                    (0x21..0x60 puis {|}~ — aucune paire de casse)

XY      token « mot »    id = v1*68 + v2            (0..4283)
}XY     token LIGNE      idx = v2*68 + v3           (0..4623)
|       flush : ajouter buf à DATA, vider buf/pend
~mot~   échappement littéral
```

Côté Scratch (tout en 1-based, `d` = item # dans ALPHA) :
```
2 chars : élément ((d1*68)+(d2)-(68)) de DICT
'}'     : élément ((d2*68)+(d3)-(68)+(WORD_TOTAL)) de DICT puis flush
```

`DICT` = [3668 entrées mot] + [2782 entrées ligne] = 6450 éléments.

---

## 3. Contenu du projet `.sb3`

- **3 scripts** sur la scène :
  - **drapeau vert** : vide `DATA`, boucle `process item (ii)` sur les 166
    items avec STATUS = progression %, puis `verify data`, puis message
    final (Ready / ERROR) ;
  - **`process item %s`** (WFR) : décode un item de COMPRESSED dans DATA ;
  - **`verify data`** (WFR) : CHECK1 = nb lignes, CHECK2 = Σ longueurs.
- **Listes** : `DATA` (vide, remplie au chargement), `COMPRESSED` (166
  items), `DICT` (6450), `ALPHA` (68).
- **Variables** : `READY`, `STATUS`, + internes du décodeur.
- **Moniteur** : `STATUS`.

## 4. Utiliser ton script d'inférence

Au drapeau vert (mode turbo recommandé), `DATA` contient les 59 872 lignes
dans l'ordre : **impaires = prompts, paires = réponses** (ligne 1 = item 1
de DATA). Ton matcher par mots-clés peut tourner directement dessus.

`data/index_prompts.txt` (généré par le build) : pour chaque mot, la liste
des indices 1-based des prompts de DATA qui le contiennent (cap 2500) —
pratique pour pré-filtrer sans tout scanner.

## 5. Fichiers

| chemin | rôle |
|---|---|
| `generator/gen_dataset.py` | génère le dataset (conversations, maths, typos…) |
| `compress/sxp.py` | compresseur SXP-2 + décodeur de référence + fuzz |
| `scratch/build_sb3.py` | fabrique `data/sorax-ai.sb3` + fichiers annexes |
| `data/dataset.txt` | 29 936 paires, 59 872 lignes, ~2 Mo |
| `data/sorax-ai.sb3` | **le projet à importer dans Scratch** (198 Ko) |
| `data/payload.txt` | les 166 items compressés (1/ligne) |
| `data/dict.txt` | les 6450 entrées du dictionnaire (1/ligne) |
| `data/alpha.txt` | l'alphabet 68 caractères |
| `data/constants.json` | word_total, formules, sha256 du dataset… |
| `data/stats.json` | statistiques de compression |
| `data/index_prompts.txt` | index mot → indices des prompts dans DATA |

Reconstruire tout :
```bash
python3 sorax/generator/gen_dataset.py            # (optionnel) regénérer
python3 sorax/scratch/build_sb3.py                # dataset -> sorax-ai.sb3
```

## 6. Résultats mesurés

| métrique | valeur |
|---|---|
| paires prompt/réponse | 29 936 |
| lignes décompressées | 59 872 (10 081 prompts distincts) |
| dataset brut | 1,96 Mo |
| COMPRESSED (payload) | 264 074 octets / 166 items |
| DICT | 188 792 octets / 6450 entrées |
| **project.json** | **475 870 octets (0,45 Mo)** — limite ~5 Mo |
| **fichier .sb3** | **197 865 octets** |
| ratio de compression | ~4,5× |
| temps de décompression (scratch-vm headless, turbo) | **0,9 s** |
| roundtrip | ✅ 59 872/59 872 lignes identiques |

## 7. Pièges Scratch découverts en route (à retenir !)

1. **Comparaisons insensibles à la casse** — voir idée 3. Le bug le plus
   vicieux : `item # de (c) dans ALPHA` renvoyait la position du `T`
   majuscule quand on cherchait `t`.
2. **`change [var] by`** : ce scratch-vm lit l'input `VALUE` (et non `NUM`
   comme le vanilla — renommage TurboWarp).
3. **Primitives variables dans les inputs** : `[12, NOM, ID]` (nom puis id).
4. **Un bloc = un parent**, partout : un même bloc référencé par deux
   inputs (reporter partagé) ou deux SUBSTACK casse le cache d'exécution
   (`BlockCached._parentValues`) → valeurs périmées. Le builder audite
   ça automatiquement (`_audit_single_parent`).
5. **Les nombres sont des chaînes** : comparer `READY = 1` depuis du JS
   externe nécessite une conversion.

## 8. Correcteur orthographique (ta partie)

Le dataset contient déjà des **variantes typo naturelles** (whut/wjat/os…,
`typo_top=2400` familles, les mots contenant des chiffres ne sont jamais
altérés pour ne pas casser les maths). Pistes côté matching :
- normaliser la saisie (minuscules, ponctuation) avant de chercher ;
- si aucun prompt ne matche : distance d'édition (Levenshtein simplifié sur
  les mots) contre les prompts distincts — faisable en Scratch avec des
  boucles par lettre, surtout si tu pré-filtres via `index_prompts.txt` ;
- les prompts en double (typos incluses) partagent la réponse du prompt
  canonique, donc matcher une typo répond déjà correctement.
