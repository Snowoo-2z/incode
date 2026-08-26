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
        { type: 'CREATE_SPRITE', name: 'Paddle1', x: -200, y: 0 },
        { type: 'CLEAR_BLOCKS', sprite: 'Paddle1' },
        {
            type: 'ADD_SCRIPT',
            sprite: 'Paddle1',
            x: 50,
            y: 50,
            blocks: [
                { opcode: 'event_whenflagclicked' },
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
        { type: 'CREATE_SPRITE', name: 'Paddle2', x: 200, y: 0 },
        { type: 'CLEAR_BLOCKS', sprite: 'Paddle2' },
        {
            type: 'ADD_SCRIPT',
            sprite: 'Paddle2',
            x: 50,
            y: 50,
            blocks: [
                { opcode: 'event_whenflagclicked' },
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
        { type: 'CREATE_SPRITE', name: 'Ball', x: 0, y: 0 },
        { type: 'CLEAR_BLOCKS', sprite: 'Ball' },
        {
            type: 'ADD_SCRIPT',
            sprite: 'Ball',
            x: 50,
            y: 50,
            blocks: [
                { opcode: 'event_whenflagclicked' },
                { opcode: 'data_setvariableto', variable: 'score1', inputs: { VALUE: 0 } },
                { opcode: 'data_setvariableto', variable: 'score2', inputs: { VALUE: 0 } },
                { opcode: 'motion_gotoxy', inputs: { X: 0, Y: 0 } },
                { opcode: 'motion_pointindirection', inputs: { DIRECTION: 45 } },
                {
                    opcode: 'control_forever',
                    inputs: {
                        SUBSTACK: [
                            { opcode: 'motion_movesteps', inputs: { STEPS: 7 } },
                            { opcode: 'motion_ifonedgebounce' },
                            {
                                opcode: 'control_if',
                                inputs: {
                                    CONDITION: { opcode: 'sensing_touchingobject', target: 'Paddle1' },
                                    SUBSTACK: [
                                        { opcode: 'motion_pointindirection', inputs: { DIRECTION: 60 } },
                                        { opcode: 'motion_movesteps', inputs: { STEPS: 10 } }
                                    ]
                                }
                            },
                            {
                                opcode: 'control_if',
                                inputs: {
                                    CONDITION: { opcode: 'sensing_touchingobject', target: 'Paddle2' },
                                    SUBSTACK: [
                                        { opcode: 'motion_pointindirection', inputs: { DIRECTION: -60 } },
                                        { opcode: 'motion_movesteps', inputs: { STEPS: 10 } }
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
        { type: 'CREATE_SPRITE', name: 'Bouton', x: 0, y: 0 },
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

export {
    PONG_GAME_TEMPLATE,
    CLICKER_GAME_TEMPLATE
};
