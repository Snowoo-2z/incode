"""Données éditoriales du corpus : programmes de référence, descriptions, phrases.

Tout ce qui est « écrit à la main » vit ici, pour que `corpus.py` ne contienne
que la logique de génération.
"""

from __future__ import annotations

# --------------------------------------------------------------------------- #
# Identité de Sorax (jamais de mention d'une autre IA)
# --------------------------------------------------------------------------- #

IDENTITY_QA = [
    ("qui es-tu",
     "Je suis Sorax, l'assistant de ScratchScript. Je transforme tes idées en blocs Scratch et je t'aide a coder."),
    ("tu es qui",
     "Sorax, l'assistant de ScratchScript, cree par Snowoo-. Je code tes jeux en blocs Scratch."),
    ("c'est quoi sorax",
     "Sorax, c'est l'IA integree a ScratchScript : tu decris ton projet, je t'ecris les scripts Scratch."),
    ("qui t'as cree",
     "J'ai ete cree par Snowoo- pour ScratchScript."),
    ("who are you",
     "I am Sorax, the ScratchScript assistant created by Snowoo-. I turn ideas into Scratch blocks."),
    ("qui t'a fait",
     "Sorax est un projet de Snowoo-, integre a ScratchScript."),
    ("tu sers a quoi",
     "Je code pour toi : jeux, animations, quiz. Tu decris l'idee, j'ecris les blocs Scratch."),
]

CHAT_QA = [
    ("salut", "Salut ! Decris-moi ton projet et je t'ecris les blocs Scratch."),
    ("bonjour", "Bonjour ! Donne-moi ton idee de jeu ou d'animation, je m'occupe du code."),
    ("ca va", "Tres bien, pret a coder ! Tu veux creer quoi aujourd'hui ?"),
    ("tu peux faire quoi",
     "Je cree des sprites, des scripts, des variables et des costumes en ScratchScript. Demande-moi un jeu !"),
    ("comment on fait une boucle",
     "Avec le bloc `forever:` pour une boucle infinie, ou `repeat 10:` pour un nombre de tours. Le corps de la boucle est indente de 2 espaces."),
    ("comment creer une variable",
     "Ecris `var score = 0` en haut de ton script. Ensuite `set score 0` ou `change score 1` pour la modifier."),
    ("comment faire un saut",
     "Utilise une variable `vy` et une gravite : `change vy -1`, `change y vy`, et remets `vy` a 12 quand la touche saut est pressee."),
    ("merci", "Avec plaisir ! Si tu veux une autre mecanique, demande-la moi."),
    ("c'est nul", "Dis-moi ce qui ne va pas et je corrige tout de suite : je peux modifier les scripts existants bloc par bloc."),
    ("ca ne marche pas",
     "Envoie-moi le script qui pose probleme, je le corrige et je te renvoie une version qui fonctionne."),
    ("tu connais scratch", "Oui, je code en ScratchScript, le langage texte qui se compile en blocs Scratch 3.0."),
    ("donne moi une idee de jeu",
     "Un jeu de collecte : le joueur ramasse des pieces, un chronometre descend, et un ennemi patrouille. Je peux te le coder."),
    ("explique les variables",
     "Une variable stocke une valeur qui change : score, vie, vitesse. On la cree avec `var nom = 0` et on la lit avec `(var nom)`."),
    ("explique les listes",
     "Une liste stocke plusieurs valeurs numerotees : `list scores = 0, 0, 0`. On lit avec `(itemof 1 scores)` et on ajoute avec `additem 5 scores`."),
    ("apprends moi a coder", "Commence petit : un sprite qui bouge avec `move 10` dans un `forever:`. Je peux te generer un exemple complet."),
    ("fais moi un jeu", "Dis-moi le genre (plateforme, tir, reflexion, course) et je te cree le projet complet."),
]

# --------------------------------------------------------------------------- #
# Descriptions de blocs (tache « doc »)
# --------------------------------------------------------------------------- #

DESCRIPTIONS = {
    # Événements
    'event_whenflagclicked': "Le point de depart : ce script se lance quand on clique sur le drapeau vert.",
    'event_whenthisspriteclicked': "Ce script se lance quand on clique sur le sprite.",
    'event_whenstageclicked': "Ce script se lance quand on clique sur la scene.",
    'event_whenkeypressed': "Ce script se lance quand la touche choisie est pressee. Exemple : `whenkey space:`.",
    'event_whenbroadcastreceived': "Ce script se lance quand le message est envoye. Exemple : `whenreceive gagne:`.",
    'event_whengreaterthan': "Ce script se lance quand le son ou le chronometre depasse la valeur donnee.",
    'event_whenbackdropswitchesto': "Ce script se lance quand l'arriere-plan choisi devient actif.",
    'event_broadcast': "Envoie un message a tous les sprites. Exemple : `broadcast gagne`.",
    'event_broadcastandwait': "Envoie un message et attend que tous les scripts declenches soient termines.",
    # Mouvement
    'motion_movesteps': "Avance le sprite du nombre de pas dans sa direction. `move 10`.",
    'motion_turnright': "Tourne le sprite vers la droite. `turnright 15`.",
    'motion_turnleft': "Tourne le sprite vers la gauche. `turnleft 15`.",
    'motion_goto': "Teleporte le sprite sur une cible : `goto _mouse_`, `goto _random_` ou un nom de sprite.",
    'motion_gotoxy': "Place le sprite aux coordonnees donnees : `gotoxy 0 0` (centre de la scene).",
    'motion_glideto': "Glisse le sprite jusqu'a une cible en un temps donne.",
    'motion_glidesecstoxy': "Glisse le sprite vers des coordonnees en un temps donne : `glidexy 1 100 0`.",
    'motion_pointindirection': "Oriente le sprite vers un angle (90 = droite, 0 = haut, -90 = gauche).",
    'motion_pointtowards': "Oriente le sprite vers la souris ou un autre sprite.",
    'motion_changexby': "Decale le sprite horizontalement.",
    'motion_setx': "Place la coordonnee x du sprite, sans changer y.",
    'motion_changeyby': "Decale le sprite verticalement.",
    'motion_sety': "Place la coordonnee y du sprite, sans changer x.",
    'motion_ifonedgebounce': "Fait rebondir le sprite quand il touche le bord : `bounce`.",
    'motion_setrotationstyle': "Choisit comment le sprite tourne (gauche-droite, sans rotation, dans tous les sens).",
    'motion_xposition': "Renvoie la position x du sprite : `(xpos)`.",
    'motion_yposition': "Renvoie la position y du sprite : `(ypos)`.",
    'motion_direction': "Renvoie la direction du sprite en degres : `(direction)`.",
    # Apparence
    'looks_say': "Affiche une bulle de dialogue : `say \"Bonjour\"`.",
    'looks_sayforsecs': "Affiche une bulle pendant un temps donne, puis l'efface.",
    'looks_think': "Affiche une bulle de pensee.",
    'looks_thinkforsecs': "Affiche une bulle de pensee pendant un temps donne.",
    'looks_switchcostumeto': "Change le costume du sprite : `costume costume2`.",
    'looks_nextcostume': "Passe au costume suivant.",
    'looks_switchbackdropto': "Change l'arriere-plan de la scene.",
    'looks_nextbackdrop': "Passe a l'arriere-plan suivant.",
    'looks_changesizeby': "Agrandit ou retrecit le sprite : `changesize 10`.",
    'looks_setsizeto': "Fixe la taille du sprite en pourcentage : `setsize 100`.",
    'looks_changeeffectby': "Modifie un effet graphique : `changegraphiceffect GHOST 10`.",
    'looks_seteffectto': "Fixe un effet graphique : `setgraphiceffect COLOR 50`.",
    'looks_clear': "Efface tous les effets graphiques du sprite.",
    'looks_show': "Rend le sprite visible (`show`).",
    'looks_hide': "Cache le sprite (`hide`).",
    'looks_gotofrontback': "Place le sprite au premier ou a l'arriere-plan des autres sprites.",
    'looks_goforwardbackwardlayers': "Avance ou recule le sprite de N couches.",
    'looks_size': "Renvoie la taille du sprite en pourcentage.",
    'looks_costumenumbername': "Renvoie le numero ou le nom du costume actuel.",
    'looks_backdropnumbername': "Renvoie le numero ou le nom de l'arriere-plan actuel.",
    # Son
    'sound_play': "Joue un son sans attendre la fin : `play pop`.",
    'sound_playuntildone': "Joue un son et attend la fin.",
    'sound_stopallsounds': "Arrete tous les sons en cours.",
    'sound_changevolumeby': "Augmente ou baisse le volume.",
    'sound_setvolumeto': "Fixe le volume en pourcentage.",
    'sound_volume': "Renvoie le volume actuel.",
    # Contrôle
    'control_wait': "Attend un nombre de secondes : `wait 1`.",
    'control_repeat': "Repete le corps N fois : `repeat 10:` puis les blocs indentes.",
    'control_forever': "Repete le corps sans fin : `forever:` (utile pour une boucle de jeu).",
    'control_if': "Execute le corps si la condition est vraie : `if (touching _edge_):`.",
    'control_if_else': "Execute le premier corps si la condition est vraie, sinon le second (`if ...:` puis `else:`).",
    'control_wait_until': "Attend qu'une condition devienne vraie.",
    'control_repeat_until': "Repete jusqu'a ce que la condition soit vraie.",
    'control_stop': "Arrete le script, les autres scripts du sprite, ou tout le projet.",
    'control_start_as_clone': "Ce script se lance quand le sprite nait en tant que clone (`startasclone`).",
    'control_create_clone_of': "Cree un clone du sprite : `clone _myself_`. Ideal pour les balles ou les ennemis.",
    'control_delete_this_clone': "Supprime le clone en cours d'execution : `deleteclone`.",
    # Capteurs
    'sensing_touchingobject': "Condition : le sprite touche le bord, la souris ou un autre sprite. `(touching _edge_)`.",
    'sensing_touchingcolor': "Condition : le sprite touche une couleur precise.",
    'sensing_coloristouchingcolor': "Condition : une couleur du costume touche une autre couleur.",
    'sensing_distanceto': "Renvoie la distance jusqu'a la souris ou un sprite.",
    'sensing_askandwait': "Pose une question dans la scene et attend la reponse : `ask \"Ton nom ?\"`.",
    'sensing_answer': "Renvoie la derniere reponse tapee par le joueur.",
    'sensing_keypressed': "Condition : une touche est enfoncee. `(keypressed space)`.",
    'sensing_mousedown': "Condition : le bouton de la souris est enfonce.",
    'sensing_mousex': "Renvoie la position x de la souris.",
    'sensing_mousey': "Renvoie la position y de la souris.",
    'sensing_loudness': "Renvoie le niveau sonore capte par le micro.",
    'sensing_timer': "Renvoie le chronometre du projet en secondes : `(timer)`.",
    'sensing_resettimer': "Remet le chronometre a zero : `resettimer`.",
    'sensing_of': "Renvoie une propriete d'un autre sprite ou de la scene.",
    'sensing_current': "Renvoie l'annee, le mois, le jour ou l'heure actuelle.",
    'sensing_dayssince2000': "Renvoie le nombre de jours depuis l'an 2000.",
    'sensing_username': "Renvoie le nom du joueur connecte.",
    # Opérateurs
    'operator_add': "Addition : `(+ 1 2)`.",
    'operator_subtract': "Soustraction : `(- 5 2)`.",
    'operator_multiply': "Multiplication : `(* 3 4)`.",
    'operator_divide': "Division : `(/ 10 2)`.",
    'operator_random': "Nombre aleatoire entre deux valeurs : `(random 1 10)`.",
    'operator_gt': "Condition « plus grand que » : `(> (var score) 10)`.",
    'operator_lt': "Condition « plus petit que » : `(< (var vie) 3)`.",
    'operator_equals': "Condition « egal a » : `(= (var etat) \"fin\")`.",
    'operator_and': "Vrai si les deux conditions sont vraies : `(and (keypressed space) (mousedown))`.",
    'operator_or': "Vrai si au moins une condition est vraie.",
    'operator_not': "Inverse une condition : `(not (keypressed space))`.",
    'operator_join': "Colle deux textes : `(join \"Score : \" (var score))`.",
    'operator_letter_of': "Renvoie une lettre d'un texte : `(letterof 1 \"abc\")`.",
    'operator_length': "Renvoie la longueur d'un texte : `(length \"bonjour\")`.",
    'operator_contains': "Vrai si le texte contient l'autre : `(contains \"bonjour\" \"jour\")`.",
    'operator_mod': "Reste de la division : `(% 7 2)` donne 1.",
    'operator_round': "Arrondit un nombre : `(round 3.7)` donne 4.",
    'operator_mathop': "Fonction mathematique : `(mathop sqrt 16)`, `(mathop abs -3)`.",
    # Variables et listes
    'data_setvariableto': "Fixe la valeur d'une variable : `set score 0`.",
    'data_changevariableby': "Ajoute une valeur a une variable : `change score 1` (parfait pour un score).",
    'data_showvariable': "Affiche le moniteur d'une variable sur la scene.",
    'data_hidevariable': "Cache le moniteur d'une variable.",
    'data_variable': "Lit la valeur d'une variable : `(var score)`.",
    'data_addtolist': "Ajoute un element a la fin d'une liste : `additem 5 scores`.",
    'data_deleteoflist': "Supprime un element d'une liste par son numero.",
    'data_deletealloflist': "Vide entierement une liste.",
    'data_insertatlist': "Insere un element a une position precise dans une liste.",
    'data_replaceitemoflist': "Remplace un element d'une liste.",
    'data_itemoflist': "Renvoie un element d'une liste : `(itemof 1 scores)`.",
    'data_itemnumoflist': "Renvoie la position d'un element dans une liste.",
    'data_lengthoflist': "Renvoie le nombre d'elements de la liste : `(listlength scores)`.",
    'data_listcontainsitem': "Condition : la liste contient l'element.",
    'data_showlist': "Affiche le moniteur d'une liste sur la scene.",
    'data_hidelist': "Cache le moniteur d'une liste.",
    # Stylo
    'pen_clear': "Efface tous les traits du stylo.",
    'pen_stamp': "Laisse une empreinte du costume sur la scene.",
    'pen_penDown': "Baisse le stylo : le sprite dessine en bougeant.",
    'pen_penUp': "Releve le stylo : le sprite ne dessine plus.",
    'pen_setPenColorToColor': "Choisit la couleur du trait : `pencolor \"#ff0000\"`.",
    'pen_changePenSizeBy': "Modifie l'epaisseur du trait.",
    'pen_setPenSizeTo': "Fixe l'epaisseur du trait.",
}

# --------------------------------------------------------------------------- #
# Programmes de référence (ScratchScript)
#
# Chaque entrée : nom, genre, variantes de demande, code complet, explication.
# Les scripts sont ecrits a la main puis valides par le compilateur reel dans
# `tools/validate_corpus.mjs` : aucune faute de syntaxe ne peut passer.
# --------------------------------------------------------------------------- #

PROGRAMS = [
    {
        'name': 'pong',
        'genre': 'Pong',
        'prompts': [
            'Cree un jeu de Pong avec deux raquettes et un score',
            'Je veux un Pong a 2 joueurs avec un score qui s\'affiche',
            'Fais moi un jeu de casse-brique simple facon Pong',
            'Un Pong : balle qui rebondit, deux raquettes, score pour chaque joueur',
        ],
        'explanation': (
            'Le projet contient une balle, deux raquettes et deux variables de score. '
            'La balle part au centre, avance un peu a chaque image et rebondit sur les bords. '
            'Chaque raquette suit son joueur au clavier (fleches pour le joueur 1, W/S pour le joueur 2). '
            'Quand la balle touche une raquette, elle repart et le score du joueur augmente.'
        ),
        'code': '''var score1 = 0
var score2 = 0
sprite RaquetteGauche -220 0:
  whenflagclicked
  gotoxy -220 0
  forever:
    if (keypressed w):
      change y 12
    if (keypressed s):
      change y -12
    if (< (ypos) -150):
      set y -150
    if (> (ypos) 150):
      set y 150
sprite RaquetteDroite 220 0:
  whenflagclicked
  gotoxy 220 0
  forever:
    if (keypressed up arrow):
      change y 12
    if (keypressed down arrow):
      change y -12
    if (< (ypos) -150):
      set y -150
    if (> (ypos) 150):
      set y 150
sprite Balle 0 0:
  whenflagclicked
  show
  gotoxy 0 0
  point 135
  forever:
    move 8
    bounce
    if (touching RaquetteGauche):
      point (random 20 70)
      change score2 1
    if (touching RaquetteDroite):
      point (random 110 160)
      change score1 1
    if (> (xpos) 240):
      gotoxy 0 0
      point 135
    if (< (xpos) -240):
      gotoxy 0 0
      point 45
''',
    },
    {
        'name': 'snake',
        'genre': 'Snake',
        'prompts': [
            'Cree un jeu de Snake ou le serpent grandit',
            'Un jeu de serpent qui mange des pommes et grandit',
            'Fais un Snake avec un score et une touche de fin',
        ],
        'explanation': (
            'Le serpent est un sprite qui avance en continu et tourne avec les fleches. '
            'Chaque pomme mangee ajoute un point au score et deplace la pomme au hasard. '
            'Si le serpent touche son propre corps ou le bord, la partie s\'arrete.'
        ),
        'code': '''var score = 0
var vitesse = 6
sprite Pomme 100 80:
  whenflagclicked
  show
  set size 70
  gotoxy 100 80
  forever:
    if (touching Serpent):
      change score 1
      gotoxy (random -200 200) (random -140 140)
sprite Serpent 0 0:
  whenflagclicked
  show
  point 90
  set score 0
  forever:
    move (var vitesse)
    if (keypressed up arrow):
      point 0
    if (keypressed down arrow):
      point 180
    if (keypressed left arrow):
      point -90
    if (keypressed right arrow):
      point 90
    if (touching _edge_):
      sayfor "Perdu ! Score : " 1
      stop all
''',
    },
    {
        'name': 'flappy',
        'genre': 'Flappy',
        'prompts': [
            'Cree un jeu ou on saute entre des tuyaux',
            'Un Flappy Bird simplifie avec gravite et tuyaux',
            'Jeu de saut avec la touche espace et un score',
        ],
        'explanation': (
            'L\'oiseau tombe a cause de la gravite : la vitesse verticale diminue a chaque image. '
            'Un appui sur espace remet la vitesse a 9, ce qui fait remonter l\'oiseau. '
            'Les tuyaux defilent vers la gauche et reviennent a droite quand ils sortent de l\'ecran. '
            'Le score augmente a chaque tuyau passe.'
        ),
        'code': '''var vy = 0
var score = 0
sprite Oiseau -100 0:
  whenflagclicked
  show
  gotoxy -100 0
  set vy 0
  set score 0
  forever:
    change vy -1
    change y (var vy)
    if (keypressed space):
      set vy 9
    if (> (ypos) 160):
      set y 160
    if (< (ypos) -160):
      sayfor "Perdu !" 1
      stop all
sprite Tuyau 200 0:
  whenflagclicked
  show
  gotoxy 200 0
  set size 100
  forever:
    change x -5
    if (< (xpos) -240):
      set x 240
      change score 1
''',
    },
    {
        'name': 'plateforme',
        'genre': 'Plateforme',
        'prompts': [
            'Cree un jeu de plateforme avec un saut',
            'Jeu de plateforme : le personnage saute sur des plateformes',
            'Fais un mini Mario avec gravite et saut',
        ],
        'explanation': (
            'Le joueur se deplace horizontalement avec les fleches et saute avec espace. '
            'La variable vy gere la gravite : elle descend tant que le joueur est en l\'air, '
            'et elle remonte au saut. Le sol remet vy a zero quand on le touche. '
            'Les pieces disparaissent quand on les touche et augmentent le score.'
        ),
        'code': '''var vy = 0
var score = 0
sprite Joueur -150 0:
  whenflagclicked
  show
  gotoxy -150 0
  set vy 0
  set score 0
  setsize 70
  forever:
    if (keypressed right arrow):
      change x 6
      point 90
    if (keypressed left arrow):
      change x -6
      point -90
    if (keypressed space):
      if (touching Sol):
        set vy 15
    change vy -1
    change y (var vy)
    if (touching Sol):
      set vy 0
    if (< (ypos) -150):
      gotoxy -150 0
      set vy 0
sprite Sol 0 -150:
  whenflagclicked
  show
  gotoxy 0 -150
  setsize 200
sprite Piece 120 0:
  whenflagclicked
  show
  gotoxy 120 0
  setsize 50
  forever:
    if (touching Joueur):
      change score 1
      hide
      wait 2
      goto _random_
      show
''',
    },
    {
        'name': 'clicker',
        'genre': 'Clicker',
        'prompts': [
            'Cree un jeu de clicker avec des points',
            'Un jeu ou on clique sur un bouton pour gagner des points',
            'Fais un cliqueur avec un score qui monte',
        ],
        'explanation': (
            'Le bouton est un sprite : son script se declenche quand on clique dessus. '
            'Chaque clic ajoute un point a la variable score et joue un son. '
            'Le sprite grossit legerement pendant le clic pour donner du retour visuel.'
        ),
        'code': '''var points = 0
sprite Bouton 0 0:
  whenflagclicked
  show
  gotoxy 0 0
  setsize 100
  set points 0
  whenclicked
  change points 1
  play pop
  changesize 10
  wait 0.1
  changesize -10
''',
    },
    {
        'name': 'quiz',
        'genre': 'Quiz',
        'prompts': [
            'Cree un quiz avec trois questions',
            'Un jeu de questions avec saisie du joueur et un score',
            'Fais un quiz : on tape la reponse et le score grimpe',
        ],
        'explanation': (
            'Un personnage pose les questions avec le bloc `ask`, puis lit la reponse du joueur. '
            'Une liste contient les bonnes reponses. Si la reponse correspond, le score augmente, '
            'sinon le personnage explique la bonne reponse. Le score s\'affiche a la fin.'
        ),
        'code': '''var score = 0
list reponses = 12, 4, 9
list questions = "2+10 ?", "2+2 ?", "3x3 ?"
stage:
  whenflagclicked
  hidevar score
  set score 0
  say "Quiz ! Reponds dans la zone de texte."
sprite Presentateur 0 0:
  whenflagclicked
  show
  gotoxy 0 0
  set score 0
  repeat 3:
    ask (itemof (var numero) questions)
  forever:
    wait 1
''',
    },
    {
        'name': 'collecte',
        'genre': 'Collecte',
        'prompts': [
            'Cree un jeu de collecte de pieces avec chronometre',
            'Jeu ou on ramasse des objets avant la fin du temps',
            'Fais un jeu de collecte avec timer et victoire',
        ],
        'explanation': (
            'Le joueur suit la souris pour ramasser des pieces : chaque piece touchee est '
            'repositionnee au hasard et ajoute un point. Un chronometre invisible compte les '
            'secondes et arrete la partie au bout de 30 secondes, en annoncant le score final.'
        ),
        'code': '''var pieces = 0
var temps = 30
sprite Joueur 0 0:
  whenflagclicked
  show
  setsize 60
  set pieces 0
  goto _mouse_
  forever:
    glidexy 0.2 (mousex) (mousey)
    if (touching Piece):
      change pieces 1
      play coin
sprite Piece 100 100:
  whenflagclicked
  show
  setsize 50
  goto _random_
  forever:
    nextcostume
    wait 0.2
sprite Chrono 0 0:
  whenflagclicked
  hide
  set temps 30
  repeat 30:
    change temps -1
    wait 1
  broadcast fin
stage:
  whenreceive fin:
  say (join "Temps ecoule ! Pieces : " (var pieces))
''',
    },
    {
        'name': 'esquive',
        'genre': 'Esquive',
        'prompts': [
            'Cree un jeu d\'esquive ou il faut eviter des ennemis',
            'Un jeu ou le vaisseau evite des asteroides',
            'Fais un jeu de survie avec des ennemis qui tombent',
        ],
        'explanation': (
            'Des clones d\'ennemis apparaissent en haut de la scene et descendent. '
            'Le vaisseau se deplace avec la souris pour les esquiver. Si un ennemi touche '
            'le vaisseau, la partie s\'arrete avec le temps de survie affiche.'
        ),
        'code': '''var survie = 0
sprite Vaisseau 0 -120:
  whenflagclicked
  show
  gotoxy 0 -120
  setsize 70
  resettimer
  forever:
    set x (mousex)
    set survie (timer)
    if (touching Ennemi):
      broadcast fin
      stop all
sprite Ennemi 0 180:
  whenflagclicked
  hide
  gotoxy 0 180
  setsize 60
  forever:
    wait 1
    clone _myself_
  startasclone
  gotoxy (random -220 220) 180
  show
  repeatuntil (< (ypos) -180):
    change y -7
  deleteclone
stage:
  whenreceive fin:
  say (join "Survie : " (round (var survie)))
''',
    },
    {
        'name': 'tir',
        'genre': 'Tir',
        'prompts': [
            'Cree un jeu de tir spatial avec des tirs',
            'Un jeu de vaisseau qui tire sur des ennemis',
            'Fais un shoot them up simple avec des missiles',
        ],
        'explanation': (
            'Le vaisseau suit la souris et cree un clone de missile quand on clique. '
            'Chaque missile monte jusqu\'en haut de la scene puis disparait. '
            'Un ennemi descend en zigzag : quand un missile le touche, il disparait '
            'et le score augmente.'
        ),
        'code': '''var score = 0
sprite Vaisseau 0 -140:
  whenflagclicked
  show
  gotoxy 0 -140
  set score 0
  forever:
    set x (mousex)
    if (mousedown):
      clone Missile
      wait 0.2
sprite Missile -100 -140:
  whenflagclicked
  hide
  startasclone
  show
  gotoxy (xpos) -130
  repeatuntil (> (ypos) 180):
    change y 12
  deleteclone
sprite Ennemi 0 160:
  whenflagclicked
  show
  gotoxy 0 160
  forever:
    glidexy 1.5 (random -200 200) (random 40 160)
    if (touching Missile):
      change score 1
      play pop
      goto _random_
''',
    },
    {
        'name': 'paint',
        'genre': 'Dessin',
        'prompts': [
            'Cree une application de dessin avec le stylo',
            'Un programme ou on dessine avec la souris',
            'Fais un mini Paint : on trace des traits colores',
        ],
        'explanation': (
            'Le sprite suit la souris et baisse le stylo quand le bouton est enfonce. '
            'La couleur du stylo change en continu grace a la variable couleur. '
            'La touche espace efface tout le dessin.'
        ),
        'code': '''var couleur = 0
sprite Pinceau 0 0:
  whenflagclicked
  hide
  penclear
  setpensize 4
  set couleur 0
  forever:
    goto _mouse_
    change couleur 1
    setpencolorparam color (var couleur)
    if (mousedown):
      pendown
    else:
      penup
  whenkey space:
  penclear
''',
    },
    {
        'name': 'music',
        'genre': 'Musique',
        'prompts': [
            'Cree un piano avec des touches clavier',
            'Un programme qui joue des sons selon les touches',
            'Fais un mini instrument avec le clavier',
        ],
        'explanation': (
            'Chaque touche du clavier declenche un script qui joue un son different. '
            'Le sprite change de costume pour montrer la touche utilisee. '
            'Une liste garde la suite des notes jouees.'
        ),
        'code': '''list notes = 
sprite Piano 0 0:
  whenflagclicked
  show
  setsize 80
  whenkey a:
  play pop
  additem "A" notes
  nextcostume
  whenkey z:
  play coin
  additem "Z" notes
  nextcostume
  whenkey e:
  play win
  additem "E" notes
  nextcostume
''',
    },
    {
        'name': 'animation',
        'genre': 'Animation',
        'prompts': [
            'Cree une petite animation avec un personnage qui parle',
            'Fais une scene animee avec dialogue et deplacement',
            'Animation : le personnage entre, parle et repart',
        ],
        'explanation': (
            'Le personnage arrive en glissant depuis la gauche, dit sa replique, '
            'puis repart. Une boucle fait clignoter un decor en arriere-plan.'
        ),
        'code': '''sprite Heros -240 0:
  whenflagclicked
  show
  gotoxy -240 0
  glidexy 2 0 0
  sayfor "Bonjour ! Je suis Sorax." 2
  thinkfor "Je vais te montrer Scratch." 2
  glidexy 2 240 0
  hide
''',
    },
    {
        'name': 'ia_dialogue',
        'genre': 'Dialogue',
        'prompts': [
            'Cree un PNJ qui repond au joueur avec les blocs',
            'Fais un dialogue entre le joueur et un personnage',
            'Un PNJ qui pose des questions et repond',
        ],
        'explanation': (
            'Le personnage pose une question avec le bloc `ask`, puis compare la reponse '
            'a plusieurs cas pour choisir sa replique. Si le joueur dit bonjour, '
            'le personnage repond bonjour, sinon il donne une reponse generique.'
        ),
        'code': '''var humeur = 50
sprite PNJ 0 0:
  whenflagclicked
  show
  set humeur 50
  forever:
    ask "Dis-moi quelque chose !"
    if (contains (answer) "bonjour"):
      say "Bonjour a toi !"
      change humeur 5
    else:
      if (contains (answer) "jeu"):
        say "J'adore coder des jeux avec toi !"
        change humeur 10
      else:
        say (join "Tu as dit : " (answer))
    if (> (var humeur) 80):
      say "Tu es mon meilleur ami !"
''',
    },
    {
        'name': 'argent',
        'genre': 'Simulation',
        'prompts': [
            'Cree un jeu de gestion avec de l\'argent et des ameliorations',
            'Un simulateur ou on clique pour gagner de l\'argent',
            'Fais un jeu d\'achat avec une liste d\'ameliorations',
        ],
        'explanation': (
            'Chaque clic rapporte de l\'argent. Une liste contient les prix des ameliorations. '
            'Le bouton achete voit son cout augmente apres chaque achat et multiplie les gains. '
            'L\'argent est affiche en permanence sur la scene.'
        ),
        'code': '''var argent = 0
var gain = 1
var cout = 10
list ameliorations = "Double gain", "Auto-clic", "Usine"
sprite Machine 0 0:
  whenflagclicked
  show
  set argent 0
  whenclicked
  change argent (var gain)
  setgraphiceffect COLOR (random 1 100)
sprite BoutonAmeliorer 0 -110:
  whenflagclicked
  show
  setsize 70
  whenclicked
  if (> (var argent) (var cout)):
    change argent (- (var cout))
    change gain (var gain)
    change cout (var cout)
''',
    },
    {
        'name': 'runner',
        'genre': 'Course',
        'prompts': [
            'Cree un jeu de course sans fin ou on evite des obstacles',
            'Un runner infini avec des sauts',
            'Fais un jeu d\'endurance avec vitesse croissante',
        ],
        'explanation': (
            'Les obstacles arrivent de la droite et accelerent avec le temps. '
            'Le joueur saute pour les eviter. Chaque obstacle passe augmente le score '
            'et un peu la vitesse.'
        ),
        'code': '''var vitesse = -8
var score = 0
sprite Coureur -140 -120:
  whenflagclicked
  show
  gotoxy -140 -120
  setsize 60
  set score 0
  set vitesse -8
  forever:
    if (keypressed space):
      change y 12
    if (keypressed down arrow):
      change y -12
    if (< (ypos) -160):
      set y -160
sprite Obstacle 240 -120:
  whenflagclicked
  show
  set size 80
  goto _random_
  forever:
    change x (var vitesse)
    if (< (xpos) -240):
      goto _random_
      change score 1
      change vitesse -0.2
''',
    },
    {
        'name': 'memory',
        'genre': 'Memory',
        'prompts': [
            'Cree un jeu de memory avec des paires a retrouver',
            'Un jeu de memoire ou on retourne des cartes',
            'Fais un memory avec un score de coups',
        ],
        'explanation': (
            'Le plateau contient plusieurs cartes cachees. Un clic retourne une carte '
            'en changeant son costume. Deux cartes retournees identiques restent visibles, '
            'sinon elles se retournent et le compteur de coups augmente.'
        ),
        'code': '''var paires = 0
var coups = 0
sprite Carte 0 0:
  whenflagclicked
  show
  set paires 0
  set coups 0
  forever:
    wait 0.1
  whenclicked
  if (= (costumenumbername) 1):
    change coups 1
    nextcostume
    if (= (costumenumbername) 2):
      change paires 1
''',
    },
    {
        'name': 'score_chrono',
        'genre': 'Arcade',
        'prompts': [
            'Cree un jeu arcade avec un score et un chronometre',
            'Jeu rapide : marque des points en 20 secondes',
            'Fais un jeu de reflexe avec un temps limite',
        ],
        'explanation': (
            'La cible apparait a un endroit aleatoire et disparait quand on la touche, '
            'ce qui augmente le score. Un chronometre de 20 secondes arrete la partie '
            'et annonce le score final.'
        ),
        'code': '''var score = 0
var temps = 20
sprite Cible 0 0:
  whenflagclicked
  show
  setsize 60
  set score 0
  set temps 20
  goto _random_
  forever:
    if (touching _mouse_):
      if (mousedown):
        change score 1
        play pop
        goto _random_
        changesize 5
        wait 0.05
        changesize -5
sprite CompteARebours 0 0:
  whenflagclicked
  hide
  repeat 20:
    change temps -1
    wait 1
  broadcast fin
stage:
  whenreceive fin:
  say (join "Score final : " (var score))
  stop all
''',
    },
    {
        'name': 'sorax_ingame',
        'genre': 'Assistant',
        'prompts': [
            'Cree un assistant dans le jeu qui donne des conseils',
            'Un guide qui explique les commandes au joueur',
            'Fais un personnage d\'aide avec des conseils',
        ],
        'explanation': (
            'Un personnage conseille le joueur : il affiche un message d\'aide au demarrage '
            'et reagit quand le joueur appuie sur la touche H. Les conseils sont ranges dans '
            'une liste et s\'affichent l\'un apres l\'autre.'
        ),
        'code': '''list conseils = "Utilise les fleches pour bouger", "Espace pour sauter", "Ramasse toutes les pieces"
var index = 1
sprite Guide 150 120:
  whenflagclicked
  show
  setsize 60
  gotoxy 150 120
  sayfor "Appuie sur H pour un conseil !" 3
  set index 1
  whenkey h:
  say (itemof (var index) conseils)
  change index 1
  if (> (var index) (listlength conseils)):
    set index 1
''',
    },
]

# --------------------------------------------------------------------------- #
# Fragments combinables : briques de scripts par archetype de sprite
# --------------------------------------------------------------------------- #

FRAGMENTS = {
    'joueur_fleches': {
        'desc': 'un joueur qui se deplace dans les quatre directions avec les fleches',
        'code': '''sprite {nom} 0 0:
  whenflagclicked
  show
  gotoxy 0 0
  setsize {taille}
  forever:
    if (keypressed up arrow):
      change y {pas}
    if (keypressed down arrow):
      change y -{pas}
    if (keypressed left arrow):
      change x -{pas}
      point -90
    if (keypressed right arrow):
      change x {pas}
      point 90
''',
    },
    'joueur_souris': {
        'desc': 'un joueur qui suit la souris',
        'code': '''sprite {nom} 0 0:
  whenflagclicked
  show
  setsize {taille}
  forever:
    glidexy 0.15 (mousex) (mousey)
''',
    },
    'joueur_saut': {
        'desc': 'un joueur qui se deplace et saute avec la barre espace',
        'code': '''sprite {nom} -150 -100:
  whenflagclicked
  show
  gotoxy -150 -100
  setsize {taille}
  set vy 0
  forever:
    if (keypressed right arrow):
      change x {pas}
    if (keypressed left arrow):
      change x -{pas}
    if (keypressed space):
      if (touching {sol}):
        set vy {saut}
    change vy -1
    change y (var vy)
    if (touching {sol}):
      set vy 0
    if (< (ypos) -170):
      gotoxy -150 -100
      set vy 0
''',
    },
    'balle_rebond': {
        'desc': 'une balle qui avance et rebondit sur les bords',
        'code': '''sprite {nom} 0 0:
  whenflagclicked
  show
  setsize {taille}
  gotoxy 0 0
  point {angle}
  forever:
    move {vitesse}
    bounce
''',
    },
    'ennemi_patrouille': {
        'desc': 'un ennemi qui patrouille et fait perdre la partie',
        'code': '''sprite {nom} 150 0:
  whenflagclicked
  show
  setsize {taille}
  gotoxy 150 0
  point 180
  forever:
    move {vitesse}
    bounce
    if (touching {joueur}):
      broadcast perdu
      stop all
''',
    },
    'ennemi_poursuite': {
        'desc': 'un ennemi qui poursuit le joueur',
        'code': '''sprite {nom} 120 120:
  whenflagclicked
  show
  setsize {taille}
  gotoxy 120 120
  forever:
    pointtowards {joueur}
    move {vitesse}
    if (touching {joueur}):
      broadcast perdu
      stop all
''',
    },
    'ennemis_clones': {
        'desc': 'des clones d\'ennemis qui tombent du haut de la scene',
        'code': '''sprite {nom} 0 180:
  whenflagclicked
  hide
  setsize {taille}
  gotoxy 0 180
  forever:
    wait {intervalle}
    clone _myself_
  startasclone
  gotoxy (random -220 220) 180
  show
  repeatuntil (< (ypos) -180):
    change y -{vitesse}
    if (touching {joueur}):
      broadcast perdu
      stop all
  deleteclone
''',
    },
    'piece_score': {
        'desc': 'un objet a ramasser qui augmente le score',
        'code': '''sprite {nom} 120 80:
  whenflagclicked
  show
  setsize {taille}
  goto _random_
  forever:
    if (touching {joueur}):
      change {score} 1
      play coin
      goto _random_
''',
    },
    'chrono': {
        'desc': 'un compte a rebours qui arrete la partie',
        'code': '''sprite Chrono 0 0:
  whenflagclicked
  hide
  set {temps} {secondes}
  repeat {secondes}:
    change {temps} -1
    wait 1
  broadcast fin
''',
    },
    'affichage_score': {
        'desc': 'un affichage du score en haut de la scene',
        'code': '''stage:
  whenflagclicked
  showvar {score}
  set {score} 0
''',
    },
    'animation_costumes': {
        'desc': 'une animation qui alterne les costumes',
        'code': '''sprite {nom} 0 0:
  whenflagclicked
  show
  setsize {taille}
  forever:
    nextcostume
    wait {delai}
''',
    },
    'decor_defile': {
        'desc': 'un decor qui defile en boucle',
        'code': '''sprite {nom} 0 0:
  whenflagclicked
  show
  setsize 200
  forever:
    change x -{vitesse}
    if (< (xpos) -240):
      set x 240
''',
    },
    'dessin_stylo': {
        'desc': 'un crayon qui dessine avec la souris',
        'code': '''sprite Pinceau 0 0:
  whenflagclicked
  hide
  penclear
  setpensize {epaisseur}
  forever:
    goto _mouse_
    if (mousedown):
      pendown
    else:
      penup
  whenkey space:
  penclear
''',
    },
    'menu_bouton': {
        'desc': 'un bouton de menu qui lance la partie',
        'code': '''sprite {nom} 0 0:
  whenflagclicked
  show
  setsize {taille}
  gotoxy 0 0
  whenclicked
  play pop
  broadcast demarrer
  hide
''',
    },
    'missile_clone': {
        'desc': 'un missile qui monte jusqu\'en haut de la scene puis disparait',
        'code': '''sprite {nom} 0 -140:
  whenflagclicked
  hide
  startasclone
  show
  repeatuntil (> (ypos) 180):
    change y {vitesse}
  deleteclone
''',
    },
    'tireur_souris': {
        'desc': 'un vaisseau qui suit la souris et tire des missiles',
        'code': '''sprite {nom} 0 -140:
  whenflagclicked
  show
  gotoxy 0 -140
  setsize {taille}
  forever:
    set x (mousex)
    if (mousedown):
      clone {tir}
      play pop
      wait 0.2
''',
    },
    'touche_haut': {
        'desc': 'une action declenchee par une touche du clavier',
        'code': '''sprite {nom} 0 0:
  whenkey {touche}:
  play pop
  change {score} 1
''',
    },
    'saut_simple': {
        'desc': 'un saut progressif avec gravite',
        'code': '''sprite {nom} 0 -100:
  whenflagclicked
  show
  gotoxy 0 -100
  set vy 0
  forever:
    if (keypressed space):
      set vy {force}
    change vy -1
    change y (var vy)
    if (< (ypos) -150):
      set y -150
      set vy 0
''',
    },
}


# --------------------------------------------------------------------------- #
# Recettes de jeux : assemblages cohérents de fragments
# --------------------------------------------------------------------------- #

RECIPES = [
    {
        'genre': 'collecte',
        'objectif': 'ramasser tous les objets',
        'pieces': ['joueur_fleches', 'piece_score', 'chrono', 'affichage_score'],
        'vars': ['score', 'temps'],
        'title': 'jeu de collecte',
    },
    {
        'genre': 'esquive',
        'objectif': 'eviter les ennemis',
        'pieces': ['joueur_souris', 'ennemis_clones', 'affichage_score'],
        'vars': ['score'],
        'title': 'jeu d\'esquive',
    },
    {
        'genre': 'plateforme',
        'objectif': 'sauter sur les plateformes et ramasser les pieces',
        'pieces': ['joueur_saut', 'piece_score', 'ennemi_patrouille', 'affichage_score'],
        'vars': ['score'],
        'title': 'jeu de plateforme',
    },
    {
        'genre': 'arcade',
        'objectif': 'marquer un maximum de points',
        'pieces': ['joueur_fleches', 'balle_rebond', 'touche_haut', 'affichage_score'],
        'vars': ['score'],
        'title': 'jeu d\'arcade',
    },
    {
        'genre': 'course',
        'objectif': 'aller le plus loin possible',
        'pieces': ['saut_simple', 'decor_defile', 'ennemi_patrouille', 'affichage_score'],
        'vars': ['score'],
        'title': 'jeu de course',
    },
    {
        'genre': 'reflexe',
        'objectif': 'attraper les objets avant la fin du chronometre',
        'pieces': ['joueur_souris', 'piece_score', 'chrono', 'affichage_score'],
        'vars': ['score', 'temps'],
        'title': 'jeu de reflexe',
    },
    {
        'genre': 'aventure',
        'objectif': 'explorer et eviter les ennemis qui poursuivent',
        'pieces': ['joueur_fleches', 'ennemi_poursuite', 'piece_score', 'affichage_score'],
        'vars': ['score'],
        'title': 'jeu d\'aventure',
    },
    {
        'genre': 'tir',
        'objectif': 'detruire les ennemis avec des tirs',
        'pieces': ['tireur_souris', 'missile_clone', 'ennemis_clones', 'affichage_score'],
        'vars': ['score'],
        'title': 'jeu de tir',
    },
    {
        'genre': 'animation',
        'objectif': 'animer des sprites qui se deplacent',
        'pieces': ['animation_costumes', 'decor_defile'],
        'vars': [],
        'title': 'animation',
    },
    {
        'genre': 'dessin',
        'objectif': 'dessiner librement avec la souris',
        'pieces': ['dessin_stylo'],
        'vars': [],
        'title': 'application de dessin',
    },
]


# --------------------------------------------------------------------------- #
# Phrases de demande (gabarits) — la diversité de formulation est la clé
# --------------------------------------------------------------------------- #

PROMPT_TEMPLATES = [
    'Cree {un} {titre} ou il faut {objectif}',
    'Fais {un} {titre} : {objectif}',
    'J\'aimerais {un} {titre} avec {objectif}',
    'Peux-tu me coder {un} {titre} ? Le but est de {objectif}',
    'Je veux {un} {titre} ou on doit {objectif}',
    'Genere {un} {titre} simple avec {objectif}',
    'Salut Sorax, {un} {titre} pour {objectif}',
    'Il me faudrait {un} {titre} qui permet de {objectif}',
    '{un} {titre} complet : le joueur doit {objectif}',
    'Code {un} {titre} avec un score et {objectif}',
    'Tu peux me faire {un} {titre} ? Objectif : {objectif}',
    'Un petit jeu : {titre}, il faut {objectif}',
]

EN_TEMPLATES = [
    'Create {a} {title} where you have to {goal}',
    'Make {a} {title}: {goal}',
    'Can you code {a} {title}? The goal is to {goal}',
]


def article(mot: str) -> str:
    """Article indefini correct (approximatif mais naturel) : un / une."""
    return 'une' if mot and mot[0].lower() in 'aeiou' else 'un'


__all__ = [
    'IDENTITY_QA', 'CHAT_QA', 'DESCRIPTIONS', 'PROGRAMS', 'FRAGMENTS',
    'RECIPES', 'PROMPT_TEMPLATES', 'EN_TEMPLATES', 'article',
]
