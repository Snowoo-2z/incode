/**
 * @fileoverview Pre-built project templates for instant testing with the AI Agent Terminal.
 */

const PONG_GAME_TEMPLATE = {
    name: 'Jeu de Pong (2 Joueurs & Score)',
    description: 'Crée deux raquettes (Paddle1 et Paddle2), une balle avec rebonds, et deux variables de score.',
    actions: [
        // 1. Create variables
        { type: 'CREATE_VAR', name: 'score1', value: 0 },
        { type: 'CREATE_VAR', name: 'score2', value: 0 },

        // 2. Create Paddle1 (left paddle, controls: W / S)
        { type: 'CREATE_SPRITE', name: 'Paddle1', x: -200, y: 0, shape: 'paddle', color: '#4C97FF' },
        { type: 'CLEAR_BLOCKS', sprite: 'Paddle1' },
        {
            type: 'ADD_SCRIPT',
            sprite: 'Paddle1',
            blocks: [
                { opcode: 'event_whenflagclicked' },
                { opcode: 'motion_setrotationstyle', fields: { STYLE: "don't rotate" } },
                { opcode: 'motion_gotoxy', inputs: { X: -200, Y: 0 } },
                {
                    opcode: 'control_forever',
                    inputs: {
                        SUBSTACK: [
                            {
                                opcode: 'control_if',
                                inputs: {
                                    CONDITION: { opcode: 'sensing_keypressed', key: 'w' },
                                    SUBSTACK: [
                                        { opcode: 'motion_changeyby', inputs: { DY: 10 } }
                                    ]
                                }
                            },
                            {
                                opcode: 'control_if',
                                inputs: {
                                    CONDITION: { opcode: 'sensing_keypressed', key: 's' },
                                    SUBSTACK: [
                                        { opcode: 'motion_changeyby', inputs: { DY: -10 } }
                                    ]
                                }
                            }
                        ]
                    }
                }
            ]
        },

        // 3. Create Paddle2 (right paddle, controls: Up arrow / Down arrow)
        { type: 'CREATE_SPRITE', name: 'Paddle2', x: 200, y: 0, shape: 'paddle', color: '#FF6680' },
        { type: 'CLEAR_BLOCKS', sprite: 'Paddle2' },
        {
            type: 'ADD_SCRIPT',
            sprite: 'Paddle2',
            blocks: [
                { opcode: 'event_whenflagclicked' },
                { opcode: 'motion_setrotationstyle', fields: { STYLE: "don't rotate" } },
                { opcode: 'motion_gotoxy', inputs: { X: 200, Y: 0 } },
                {
                    opcode: 'control_forever',
                    inputs: {
                        SUBSTACK: [
                            {
                                opcode: 'control_if',
                                inputs: {
                                    CONDITION: { opcode: 'sensing_keypressed', key: 'up arrow' },
                                    SUBSTACK: [
                                        { opcode: 'motion_changeyby', inputs: { DY: 10 } }
                                    ]
                                }
                            },
                            {
                                opcode: 'control_if',
                                inputs: {
                                    CONDITION: { opcode: 'sensing_keypressed', key: 'down arrow' },
                                    SUBSTACK: [
                                        { opcode: 'motion_changeyby', inputs: { DY: -10 } }
                                    ]
                                }
                            }
                        ]
                    }
                }
            ]
        },

        // 4. Create Ball
        { type: 'CREATE_SPRITE', name: 'Ball', x: 0, y: 0, shape: 'ball', color: '#FFAB19' },
        { type: 'CLEAR_BLOCKS', sprite: 'Ball' },
        {
            type: 'ADD_SCRIPT',
            sprite: 'Ball',
            blocks: [
                { opcode: 'event_whenflagclicked' },
                { opcode: 'data_setvariableto', variable: 'score1', inputs: { VALUE: 0 } },
                { opcode: 'data_setvariableto', variable: 'score2', inputs: { VALUE: 0 } },
                { opcode: 'data_showvariable', variable: 'score1' },
                { opcode: 'data_showvariable', variable: 'score2' },
                { opcode: 'motion_setrotationstyle', fields: { STYLE: "don't rotate" } },
                { opcode: 'motion_gotoxy', inputs: { X: 0, Y: 0 } },
                { opcode: 'motion_pointindirection', inputs: { DIRECTION: 45 } },
                {
                    opcode: 'control_forever',
                    inputs: {
                        SUBSTACK: [
                            { opcode: 'motion_movesteps', inputs: { STEPS: 7 } },
                            { opcode: 'motion_ifonedgebounce' },
                            // Bounce off the paddles.
                            {
                                opcode: 'control_if',
                                inputs: {
                                    CONDITION: { opcode: 'sensing_touchingobject', target: 'Paddle1' },
                                    SUBSTACK: [
                                        { opcode: 'motion_pointindirection', inputs: { DIRECTION: 60 } },
                                        { opcode: 'motion_movesteps', inputs: { STEPS: 12 } }
                                    ]
                                }
                            },
                            {
                                opcode: 'control_if',
                                inputs: {
                                    CONDITION: { opcode: 'sensing_touchingobject', target: 'Paddle2' },
                                    SUBSTACK: [
                                        { opcode: 'motion_pointindirection', inputs: { DIRECTION: -60 } },
                                        { opcode: 'motion_movesteps', inputs: { STEPS: 12 } }
                                    ]
                                }
                            },
                            // Player 2 scores when the ball passes the left edge.
                            {
                                opcode: 'control_if',
                                inputs: {
                                    CONDITION: {
                                        opcode: 'operator_lt',
                                        inputs: { OPERAND1: { opcode: 'motion_xposition' }, OPERAND2: -230 }
                                    },
                                    SUBSTACK: [
                                        { opcode: 'data_changevariableby', variable: 'score2', inputs: { VALUE: 1 } },
                                        { opcode: 'motion_gotoxy', inputs: { X: 0, Y: 0 } },
                                        { opcode: 'motion_pointindirection', inputs: { DIRECTION: 45 } },
                                        { opcode: 'control_wait', inputs: { DURATION: 0.5 } }
                                    ]
                                }
                            },
                            // Player 1 scores when the ball passes the right edge.
                            {
                                opcode: 'control_if',
                                inputs: {
                                    CONDITION: {
                                        opcode: 'operator_gt',
                                        inputs: { OPERAND1: { opcode: 'motion_xposition' }, OPERAND2: 230 }
                                    },
                                    SUBSTACK: [
                                        { opcode: 'data_changevariableby', variable: 'score1', inputs: { VALUE: 1 } },
                                        { opcode: 'motion_gotoxy', inputs: { X: 0, Y: 0 } },
                                        { opcode: 'motion_pointindirection', inputs: { DIRECTION: -135 } },
                                        { opcode: 'control_wait', inputs: { DURATION: 0.5 } }
                                    ]
                                }
                            }
                        ]
                    }
                }
            ]
        }
    ]
};

const CLICKER_GAME_TEMPLATE = {
    name: 'Jeu Clicker Simple',
    description: 'Crée un sprite cliquable avec animation et compteur de points.',
    actions: [
        { type: 'CREATE_VAR', name: 'points', value: 0 },
        { type: 'CREATE_SPRITE', name: 'Bouton', x: 0, y: 0, shape: 'circle', color: '#9966FF' },
        { type: 'CLEAR_BLOCKS', sprite: 'Bouton' },
        {
            type: 'ADD_SCRIPT',
            sprite: 'Bouton',
            x: 50,
            y: 50,
            blocks: [
                { opcode: 'event_whenflagclicked' },
                { opcode: 'data_setvariableto', variable: 'points', inputs: { VALUE: 0 } },
                { opcode: 'looks_setsizeto', inputs: { SIZE: 100 } },
                { opcode: 'motion_gotoxy', inputs: { X: 0, Y: 0 } }
            ]
        },
        {
            type: 'ADD_SCRIPT',
            sprite: 'Bouton',
            x: 50,
            y: 220,
            blocks: [
                { opcode: 'event_whenthisspriteclicked' },
                { opcode: 'data_changevariableby', variable: 'points', inputs: { VALUE: 1 } },
                { opcode: 'looks_setsizeto', inputs: { SIZE: 120 } },
                { opcode: 'control_wait', inputs: { DURATION: 0.1 } },
                { opcode: 'looks_setsizeto', inputs: { SIZE: 100 } }
            ]
        }
    ]
};

/**
 * Web mode demo: the SAME Pong game, but written as a tiny HTML/CSS/JS page.
 * The HTML/CSS becomes sprites + SVG costumes (the browser lays the page out
 * in a hidden 480x360 iframe, then each game object is captured); the JS is
 * transpiled into blocks. Exercised through the "🌐 Mode HTML/JS" tab.
 */
const WEB_PONG_TEMPLATE = {
    name: 'Pong en HTML/CSS/JS (mode web)',
    description: 'Une mini-page web convertie en sprites, costumes et blocs Scratch.',
    code: `<!-- La "page" fait 480x360, comme la scène Scratch -->
<style>
  body { background: #0f1b2d; overflow: hidden; }
  .raquette { position: absolute; width: 14px; height: 80px; background: #ffffff; border-radius: 6px; }
  #balle { position: absolute; width: 22px; height: 22px; background: #FFAB19;
           border-radius: 50%; left: 229px; top: 169px; }
  #raquetteG { left: 20px; top: 140px; background: #4C97FF; }
  #raquetteD { left: 446px; top: 140px; background: #FF6680; }
  #titre { position: absolute; left: 140px; top: 16px; width: 200px; text-align: center;
           color: #ffffff; font-size: 20px; font-weight: bold; }
</style>

<div id="titre">Pong HTML</div>
<div id="raquetteG" class="raquette"></div>
<div id="raquetteD" class="raquette"></div>
<div id="balle"></div>

<script>
let score1 = 0;
let score2 = 0;
showVariable('score1');
showVariable('score2');

whenFlag(() => {
  score1 = 0;
  score2 = 0;
  raquetteG.gotoXy(-215, 0);
  raquetteD.gotoXy(215, 0);
  balle.gotoXy(0, 0);
  balle.pointInDirection(45);

  forever(() => {
    // Raquette gauche : W / S
    if (keyPressed('w')) raquetteG.changeY(8);
    if (keyPressed('s')) raquetteG.changeY(-8);
    // Raquette droite : flèches haut / bas
    if (keyPressed('up arrow')) raquetteD.changeY(8);
    if (keyPressed('down arrow')) raquetteD.changeY(-8);

    balle.move(7);
    balle.bounce();

    if (balle.touching(raquetteG)) {
      balle.pointInDirection(60);
      balle.move(12);
    }
    if (balle.touching(raquetteD)) {
      balle.pointInDirection(-60);
      balle.move(12);
    }

    // Point pour le joueur de droite quand la balle franchit le bord gauche
    if (balle.x < -230) {
      score2 += 1;
      balle.gotoXy(0, 0);
      balle.pointInDirection(45);
      wait(0.5);
    }
    // Point pour le joueur de gauche quand elle franchit le bord droit
    if (balle.x > 230) {
      score1 += 1;
      balle.gotoXy(0, 0);
      balle.pointInDirection(-135);
      wait(0.5);
    }
  });
});
</script>`
};

/**
 * Tiny clicker demo for the web mode: a button with :hover/:active CSS states
 * that become extra costumes swapped by generated blocks.
 */
const WEB_CLICKER_TEMPLATE = {
    name: 'Bouton cliquable en HTML/CSS/JS',
    description: 'Un bouton web avec états survol/cliqué, transformé en sprite interactif.',
    code: `<style>
  body { background: #1a1030; overflow: hidden; }
  #bouton {
    position: absolute; left: 160px; top: 130px; width: 160px; height: 100px;
    background: #9966FF; border-radius: 18px; color: #ffffff;
    font-size: 22px; font-weight: bold; text-align: center; line-height: 100px;
    cursor: pointer;
  }
  #bouton:hover { background: #B58CFF; }
  #bouton:active { background: #7744DD; transform: scale(0.95); }
</style>

<button id="bouton">Clique-moi !</button>

<script>
let points = 0;
showVariable('points');

whenFlag(() => {
  points = 0;
  bouton.gotoXy(0, 0);
  bouton.say('Clique sur moi !');
});

bouton.onClick(() => {
  points += 1;
  bouton.say(join('Points : ', points));
});
</script>`
};

export {
    PONG_GAME_TEMPLATE,
    CLICKER_GAME_TEMPLATE,
    WEB_PONG_TEMPLATE,
    WEB_CLICKER_TEMPLATE
};
