/**
 * @fileoverview Constructeur de projets Scratch (.sb3) — projet Snowoo-.
 *
 * Écrit un `.sb3` **sans aucune dépendance** (ni JSZip, ni scratch-vm) :
 *
 *  - `serializeBlocks()` transforme des descriptions de blocs « à plat »
 *    (`{opcode, inputs, fields}`) au format sérialisé de Scratch 3, en créant
 *    automatiquement les blocs *shadow* attendus (nombres, textes, menus) ;
 *  - `Project` assemble cibles, variables, listes, costumes et scripts ;
 *  - `zip()` fabrique l'archive (méthode 8/deflate si un compresseur est fourni,
 *    sinon 0/store) ;
 *  - `buildSb3()` produit les octets du projet complet.
 *
 * Le même code tourne dans Node (`tools/build_sb3.mjs`) et dans le navigateur
 * (bouton **Download Sorax** de l'IDE) : une seule implémentation, donc aucune
 * divergence possible entre le fichier livré et celui téléchargé.
 *
 * Référence de format : `scratch-vm/src/serialization/sb3.js` (primitives 4..13,
 * états d'entrée 1/2/3).
 */

/* eslint-disable no-bitwise, no-var, vars-on-top, prefer-const */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else {
        root.SoraxSb3 = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ------------------------------------------------------------------ */
    /* Schéma minimal des shadows (extrait de src/lib/ai-agent/block-schema) */
    /* ------------------------------------------------------------------ */

    /** Types de primitives scratch-vm : math_number = 4 … list = 13. */
    var PRIMITIVE_TYPE = {
        math_number: 4,
        math_positive_number: 5,
        math_whole_number: 6,
        math_integer: 7,
        math_angle: 8,
        colour_picker: 9,
        text: 10,
        broadcast: 11,
        data_variable: 12,
        data_listcontents: 13
    };

    /**
     * Décrit une entrée qui n'est PAS remplie par un bloc (shadow implicite).
     * `{inputName: [opcodeShadow, fieldName, valeurParDéfaut]}`
     */
    var DEFAULT_INPUTS = {
        motion_movesteps: {STEPS: ['math_number', 'NUM', '10']},
        motion_turnright: {DEGREES: ['math_number', 'NUM', '15']},
        motion_turnleft: {DEGREES: ['math_number', 'NUM', '15']},
        motion_goto: {TO: ['motion_goto_menu', 'TO', '_random_']},
        motion_gotoxy: {X: ['math_number', 'NUM', '0'], Y: ['math_number', 'NUM', '0']},
        motion_glideto: {
            SECS: ['math_number', 'NUM', '1'],
            TO: ['motion_glideto_menu', 'TO', '_random_']
        },
        motion_glidesecstoxy: {
            SECS: ['math_number', 'NUM', '1'],
            X: ['math_number', 'NUM', '0'],
            Y: ['math_number', 'NUM', '0']
        },
        motion_pointindirection: {DIRECTION: ['math_angle', 'NUM', '90']},
        motion_pointtowards: {TOWARDS: ['motion_pointtowards_menu', 'TOWARDS', '_mouse_']},
        motion_changexby: {DX: ['math_number', 'NUM', '10']},
        motion_setx: {X: ['math_number', 'NUM', '0']},
        motion_changeyby: {DY: ['math_number', 'NUM', '10']},
        motion_sety: {Y: ['math_number', 'NUM', '0']},
        looks_say: {MESSAGE: ['text', 'TEXT', 'Bonjour !']},
        looks_sayforsecs: {MESSAGE: ['text', 'TEXT', 'Bonjour !'], SECS: ['math_number', 'NUM', '2']},
        looks_think: {MESSAGE: ['text', 'TEXT', 'Hmm…']},
        looks_thinkforsecs: {MESSAGE: ['text', 'TEXT', 'Hmm…'], SECS: ['math_number', 'NUM', '2']},
        looks_switchcostumeto: {COSTUME: ['looks_costume', 'COSTUME', 'costume1']},
        looks_switchbackdropto: {BACKDROP: ['looks_backdrops', 'BACKDROP', 'backdrop1']},
        looks_changesizeby: {CHANGE: ['math_number', 'NUM', '10']},
        looks_setsizeto: {SIZE: ['math_number', 'NUM', '100']},
        looks_changeeffectby: {CHANGE: ['math_number', 'NUM', '25']},
        looks_seteffectto: {VALUE: ['math_number', 'NUM', '0']},
        sound_play: {SOUND_MENU: ['sound_sounds_menu', 'SOUND_MENU', 'pop']},
        sound_playuntildone: {SOUND_MENU: ['sound_sounds_menu', 'SOUND_MENU', 'pop']},
        sound_changevolumeby: {VOLUME: ['math_number', 'NUM', '-10']},
        sound_setvolumeto: {VOLUME: ['math_number', 'NUM', '100']},
        control_wait: {DURATION: ['math_positive_number', 'NUM', '1']},
        control_repeat: {TIMES: ['math_whole_number', 'NUM', '10']},
        control_repeat_until: {},
        control_wait_until: {},
        control_create_clone_of: {
            CLONE_OPTION: ['control_create_clone_of_menu', 'CLONE_OPTION', '_myself_']
        },
        sensing_touchingobject: {
            TOUCHINGOBJECTMENU: ['sensing_touchingobjectmenu', 'TOUCHINGOBJECTMENU', '_mouse_']
        },
        sensing_distanceto: {DISTANCETOMENU: ['sensing_distancetomenu', 'DISTANCETOMENU', '_mouse_']},
        sensing_touchingcolor: {COLOR: ['colour_picker', 'COLOR', '#4c97ff']},
        sensing_keypressed: {KEY_OPTION: ['sensing_keyoptions', 'KEY_OPTION', 'space']},
        sensing_askandwait: {QUESTION: ['text', 'TEXT', 'Quel est ton nom ?']},
        sensing_of: {
            PROPERTY: ['sensing_of_property_menu', 'PROPERTY', 'x position'],
            OBJECT: ['sensing_of_object_menu', 'OBJECT', '_stage_']
        },
        sensing_current: {},
        operator_add: {NUM1: ['math_number', 'NUM', ''], NUM2: ['math_number', 'NUM', '']},
        operator_subtract: {NUM1: ['math_number', 'NUM', ''], NUM2: ['math_number', 'NUM', '']},
        operator_multiply: {NUM1: ['math_number', 'NUM', ''], NUM2: ['math_number', 'NUM', '']},
        operator_divide: {NUM1: ['math_number', 'NUM', ''], NUM2: ['math_number', 'NUM', '']},
        operator_random: {FROM: ['math_number', 'NUM', '1'], TO: ['math_number', 'NUM', '10']},
        operator_gt: {OPERAND1: ['text', 'TEXT', ''], OPERAND2: ['text', 'TEXT', '50']},
        operator_lt: {OPERAND1: ['text', 'TEXT', ''], OPERAND2: ['text', 'TEXT', '50']},
        operator_equals: {OPERAND1: ['text', 'TEXT', ''], OPERAND2: ['text', 'TEXT', '50']},
        operator_and: {}, operator_or: {}, operator_not: {},
        operator_join: {STRING1: ['text', 'TEXT', 'apple'], STRING2: ['text', 'TEXT', 'banana']},
        operator_letter_of: {LETTER: ['math_whole_number', 'NUM', '1'], STRING: ['text', 'TEXT', 'apple']},
        operator_length: {STRING: ['text', 'TEXT', 'apple']},
        operator_contains: {STRING1: ['text', 'TEXT', 'apple'], STRING2: ['text', 'TEXT', 'a']},
        operator_mod: {NUM1: ['math_number', 'NUM', ''], NUM2: ['math_number', 'NUM', '']},
        operator_round: {NUM: ['math_number', 'NUM', '']},
        operator_mathop: {NUM: ['math_number', 'NUM', '']},
        data_setvariableto: {VALUE: ['text', 'TEXT', '0']},
        data_changevariableby: {VALUE: ['math_number', 'NUM', '1']},
        data_addtolist: {ITEM: ['text', 'TEXT', 'thing']},
        data_deleteoflist: {INDEX: ['math_integer', 'NUM', '1']},
        data_insertatlist: {ITEM: ['text', 'TEXT', 'thing'], INDEX: ['math_integer', 'NUM', '1']},
        data_replaceitemoflist: {INDEX: ['math_integer', 'NUM', '1'], ITEM: ['text', 'TEXT', 'thing']},
        data_itemoflist: {INDEX: ['math_integer', 'NUM', '1']},
        data_itemnumoflist: {ITEM: ['text', 'TEXT', 'thing']},
        data_listcontainsitem: {ITEM: ['text', 'TEXT', 'thing']},
        event_broadcast: {BROADCAST_INPUT: ['event_broadcast_menu', 'BROADCAST_OPTION', 'message1']},
        event_broadcastandwait: {BROADCAST_INPUT: ['event_broadcast_menu', 'BROADCAST_OPTION', 'message1']},
        event_whengreaterthan: {VALUE: ['math_number', 'NUM', '10']},
        pen_clear: {}, pen_stamp: {}, pen_penDown: {}, pen_penUp: {},
        pen_setPenColorToColor: {COLOR: ['colour_picker', 'COLOR', '#4c97ff']},
        pen_changePenSizeBy: {SIZE: ['math_number', 'NUM', '1']},
        pen_setPenSizeTo: {SIZE: ['math_number', 'NUM', '1']},
        pen_changePenColorParamBy: {VALUE: ['math_number', 'NUM', '10']},
        pen_setPenColorParamTo: {VALUE: ['math_number', 'NUM', '50']}
    };

    /** Champs par défaut des blocs qui en ont (menus rendus sur le bloc). */
    var DEFAULT_FIELDS = {
        event_whenkeypressed: {KEY_OPTION: 'space'},
        event_whenbackdropswitchesto: {BACKDROP: 'backdrop1'},
        event_whengreaterthan: {WHENGREATERTHANMENU: 'LOUDNESS'},
        motion_setrotationstyle: {STYLE: 'left-right'},
        looks_changeeffectby: {EFFECT: 'COLOR'},
        looks_seteffectto: {EFFECT: 'COLOR'},
        sound_changeeffectby: {EFFECT: 'PITCH'},
        sound_seteffectto: {EFFECT: 'PITCH'},
        control_stop: {STOP_OPTION: 'all'},
        control_create_clone_of: {},
        sensing_current: {CURRENTMENU: 'YEAR'},
        sensing_of: {},
        operator_mathop: {OPERATOR: 'abs'},
        pen_changePenColorParamBy: {COLOR_PARAM: 'color'},
        pen_setPenColorParamTo: {COLOR_PARAM: 'color'},
        looks_gotofrontback: {FRONT_BACK: 'front'},
        looks_goforwardbackwardlayers: {FORWARD_BACKWARD: 'forward'},
        motion_align_scene: {ALIGNMENT: 'bottom-left'}
    };

    /** Champs qui référencent une variable / liste / diffusion (id requis). */
    var ID_FIELDS = {VARIABLE: 'var', LIST: 'list', BROADCAST_OPTION: 'broadcast'};

    var idCounter = 0;

    /** Identifiant de bloc stable et unique (sans Math.random pour être reproductible). */
    function nextId(prefix) {
        idCounter += 1;
        return (prefix || 'b') + idCounter.toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    }

    function resetIds() {
        idCounter = 0;
    }

    /* ------------------------------------------------------------------ */
    /* Sérialisation des blocs                                            */
    /* ------------------------------------------------------------------ */

    /**
     * Construit le dictionnaire `blocks` d'une cible au format sb3.
     * @param {Array<object>} scripts liste de scripts, chacun étant une liste de specs
     * @param {object} ctx contexte : variables / listes / diffusions connues
     * @returns {object} map id -> bloc sérialisé
     */
    function serializeBlocks(scripts, ctx) {
        var blocks = {};
        scripts.forEach(function (stack, index) {
            var x = (stack.x !== undefined) ? stack.x : 50;
            var y = (stack.y !== undefined) ? stack.y : 50 + index * 260;
            serializeStack(stack.blocks || stack, null, x, y, blocks, ctx, true);
        });
        return blocks;
    }

    function serializeStack(specs, parentId, x, y, blocks, ctx, topLevel) {
        if (!specs || !specs.length) return null;
        var headId = null;
        var prevId = null;
        specs.forEach(function (spec, i) {
            if (!spec || !spec.opcode) return;
            var id = nextId('s');
            if (i === 0) headId = id;
            blocks[id] = serializeOne(spec, id, prevId, blocks, ctx);
            if (topLevel && i === 0) {
                blocks[id].topLevel = true;
                blocks[id].x = x;
                blocks[id].y = y;
            }
            if (prevId) blocks[prevId].next = id;
            prevId = id;
        });
        if (parentId && headId) blocks[headId].parent = parentId;
        return headId;
    }

    function serializeOne(spec, id, parentId, blocks, ctx) {
        var block = {
            opcode: spec.opcode,
            next: null,
            parent: parentId || null,
            inputs: {},
            fields: {},
            shadow: spec.shadow === true,
            topLevel: false
        };
        if (spec.mutation) block.mutation = spec.mutation;

        var inputs = spec.inputs || {};
        var fields = spec.fields || {};
        var defaults = DEFAULT_INPUTS[spec.opcode] || {};
        // branche(s) du bloc (SUBSTACK / SUBSTACK2)
        Object.keys(inputs).forEach(function (name) {
            var value = inputs[name];
            if (name === 'SUBSTACK' || name === 'SUBSTACK2') {
                if (Array.isArray(value) && value.length) {
                    var branchId = serializeStack(value, id, 0, 0, blocks, ctx, false);
                    if (branchId) block.inputs[name] = [2, branchId];
                }
                return;
            }
            if (value === null || value === undefined) return;
            // 1) bloc imbriqué (condition ou reporter fourni comme spec)
            if (typeof value === 'object' && value.opcode) {
                var childId = serializeInto(value, id, blocks, ctx);
                // scratch-blocks : le prototype d'un bloc personnalisé occupe à la
                // fois la place du bloc et celle du shadow -> état 1.
                if (name === 'custom_block' && value.opcode === 'procedures_prototype') {
                    block.inputs[name] = [1, childId];
                    return;
                }
                // un bloc recouvre éventuellement un shadow : état 3 = [bloc, shadow],
                // et le shadow primitif est *inliné* (`[10, "texte"]`), comme dans
                // les fichiers produits par Scratch.
                var primitive = defaults[name] ?
                    primitiveFor(defaults[name][0], defaults[name][1], defaults[name][2]) : null;
                block.inputs[name] = primitive ? [3, childId, primitive] : [2, childId];
                return;
            }
            // 2) valeur simple
            var entry = defaults[name] || ['text', 'TEXT', ''];
            if (entry[0] === 'data_variable' || entry[0] === 'data_listcontents' ||
                entry[0] === 'event_broadcast_menu') {
                // menu de variable/liste/diffusion : on fabrique le bloc-menu shadow
                var menu = createMenuShadow(entry, value, ctx);
                block.inputs[name] = [1, menu[0]];
                if (menu[1]) blocks[menu[0]] = menu[1];
                return;
            }
            var primitive = primitiveFor(entry[0], entry[1], value);
            block.inputs[name] = [1, primitive];
        });

        // champs : fusionne les valeurs fournies avec les valeurs par défaut
        var mergedFields = {};
        var defs = DEFAULT_FIELDS[spec.opcode] || {};
        Object.keys(defs).forEach(function (name) {
            mergedFields[name] = defs[name];
        });
        Object.keys(fields).forEach(function (name) {
            mergedFields[name] = fields[name];
        });
        Object.keys(mergedFields).forEach(function (name) {
            var value = mergedFields[name];
            var kind = ID_FIELDS[name];
            if (kind) {
                var ref = ctx.resolve(kind, value);
                block.fields[name] = [ref.name, ref.id];
            } else if (value && typeof value === 'object' && value.name) {
                block.fields[name] = [value.name, value.id || null];
            } else {
                block.fields[name] = [String(value), null];
            }
        });
        return block;
    }

    /** Sérialise un bloc utilisé comme valeur d'entrée (reporter/condition). */
    function serializeInto(spec, parentId, blocks, ctx) {
        var id = nextId('v');
        blocks[id] = serializeOne(spec, id, parentId, blocks, ctx);
        return id;
    }

    /** Crée un bloc shadow à partir d'une description de schéma. */
    function createShadowFor(entry, ctx) {
        if (!entry) return null;
        var id = nextId('sh');
        var shadowBlock = {
            opcode: entry[0],
            next: null,
            parent: null,
            inputs: {},
            fields: {},
            shadow: true,
            topLevel: false
        };
        if (entry[0] === 'text') shadowBlock.fields.TEXT = [String(entry[2]), null];
        else shadowBlock.fields[entry[1]] = [String(entry[2]), null];
        return [id, [1, primitiveFor(entry[0], entry[1], entry[2])], shadowBlock];
    }

    /** Crée un bloc-menu shadow (variables, listes, diffusions). */
    function createMenuShadow(entry, value, ctx) {
        var id = nextId('menu');
        var kind = entry[0] === 'event_broadcast_menu' ? 'broadcast' :
            (entry[0] === 'data_listcontents' ? 'list' : 'var');
        var ref = ctx.resolve(kind, value);
        var block = {
            opcode: entry[0],
            next: null,
            parent: null,
            inputs: {},
            fields: {},
            shadow: true,
            topLevel: false
        };
        block.fields[entry[1]] = [ref.name, ref.id];
        return [id, block];
    }

    /** Représentation primitive `[type, valeur…]` d'un shadow. */
    function primitiveFor(shadowOpcode, fieldName, value) {
        var type = PRIMITIVE_TYPE[shadowOpcode];
        if (type === undefined) {
            // shadow non primitif (menu) : renvoyé comme identifiant par l'appelant
            return [10, String(value)];
        }
        return [type, String(value === undefined || value === null ? '' : value)];
    }

    /* ------------------------------------------------------------------ */
    /* Projet                                                             */
    /* ------------------------------------------------------------------ */

    var EMPTY_COSTUME_SVG =
        '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="2" height="2" ' +
        'viewBox="0 0 2 2"><rect width="2" height="2" fill="none"/></svg>';

    /**
     * Un projet Scratch en construction.
     * @param {object} [options] {name, author}
     * @constructor
     */
    function Project(options) {
        options = options || {};
        this.name = options.name || 'Sorax';
        this.author = options.author || 'Snowoo-';
        this.stage = null;
        this.targets = [];
        this.assets = [];        // {name, data(Uint8Array), type}
        this.broadcasts = {};
        this.variables = {};     // globales (scène)
        this.lists = {};
        this._assetIndex = 0;
        this.extensions = options.extensions || [];
        this.soraxMeta = options.meta || null;
        this.visibleVariables = options.visibleVariables || {};
        this.visibleLists = options.visibleLists || {};
        this._projectVariables = {vars: {}, lists: {}, broadcasts: {}};
    }

    /** Déclare une variable globale. */
    Project.prototype.globalVar = function (name, value) {
        var id = 'var_' + name.replace(/[^A-Za-z0-9_]/g, '_');
        this.variables[id] = [name, value === undefined ? 0 : value];
        this._projectVariables.vars[id] = [name, value === undefined ? 0 : value];
        return {name: name, id: id};
    };

    /** Déclare une liste globale (valeurs déjà sérialisées en chaînes). */
    Project.prototype.globalList = function (name, values) {
        var id = 'list_' + name.replace(/[^A-Za-z0-9_]/g, '_');
        this.lists[id] = [name, values || []];
        this._projectVariables.lists[id] = [name, values || []];
        return {name: name, id: id};
    };

    /** Déclare une diffusion. */
    Project.prototype.broadcast = function (name) {
        var id = 'msg_' + name.replace(/[^A-Za-z0-9_]/g, '_');
        this.broadcasts[id] = name;
        this._projectVariables.broadcasts[id] = name;
        return {name: name, id: id};
    };

    /**
     * Contexte de résolution des références pour un ensemble de cibles.
     * @returns {object} {resolve(kind, ref)}
     */
    Project.prototype.context = function () {
        var self = this;
        return {
            resolve: function (kind, ref) {
                var name = (ref && typeof ref === 'object') ? ref.name : String(ref === undefined ? '' : ref);
                var existing = null;
                if (kind === 'var') existing = self.variables[ref && ref.id];
                if (kind === 'list') existing = self.lists[ref && ref.id];
                if (kind === 'broadcast') {
                    // les diffusions sont créées à la volée si inconnues
                    var found = null;
                    Object.keys(self.broadcasts).forEach(function (key) {
                        if (self.broadcasts[key] === name) found = {name: name, id: key};
                    });
                    return found || self.broadcast(name);
                }
                if (ref && typeof ref === 'object' && ref.id) return ref;
                var match = null;
                var table = kind === 'var' ? self.variables : self.lists;
                Object.keys(table).forEach(function (key) {
                    if (table[key][0] === name) match = {name: name, id: key};
                });
                if (match) return match;
                return kind === 'var' ? self.globalVar(name, 0) : self.globalList(name, []);
            }
        };
    };

    /** Ajoute un média (costume / son) et renvoie la référence d'asset sb3. */
    Project.prototype.addAsset = function (name, data, dataFormat) {
        this._assetIndex += 1;
        var md5 = md5Hex(data);
        var ext = name.split('.').pop();
        var assetName = md5 + '.' + ext;
        this.assets.push({
            name: assetName,
            data: data,
            dataFormat: dataFormat || ext,
            assetId: md5,
            costumeName: name
        });
        return {assetId: md5, name: assetName, dataFormat: dataFormat || ext, md5ext: assetName};
    };

    /**
     * Ajoute la scène.
     * @param {object} [options] {costume: {name, data}}
     */
    Project.prototype.addStage = function (options) {
        options = options || {};
        var asset = null;
        if (options.costume) {
            asset = this.addAsset(options.costume.name, options.costume.data, options.costume.format);
        } else {
            asset = this.addAsset('backdrop1.svg', str2bytes(EMPTY_COSTUME_SVG), 'svg');
        }
        this.stage = {
            isStage: true,
            name: 'Stage',
            variables: this.variables,
            lists: this.lists,
            broadcasts: this.broadcasts,
            blocks: {},
            comments: {},
            currentCostume: 0,
            costumes: [{
                name: options.costumeName || 'backdrop1',
                bitmapResolution: 1,
                dataFormat: asset.dataFormat,
                assetId: asset.assetId,
                md5ext: asset.md5ext,
                rotationCenterX: 240,
                rotationCenterY: 180
            }],
            sounds: [],
            volume: 100,
            layerOrder: 0,
            tempo: 60,
            videoTransparency: 50,
            videoState: 'off',
            textToSpeechLanguage: null
        };
        this.targets.push(this.stage);
        return this.stage;
    };

    /**
     * Ajoute un sprite.
     * @param {string} name nom du sprite
     * @param {object} [options] {x, y, size, visible, costume:{name,data}, scripts, locals}
     */
    Project.prototype.addSprite = function (name, options) {
        options = options || {};
        var asset = this.addAsset(
            options.costume && options.costume.name ? options.costume.name : name + '.svg',
            options.costume ? options.costume.data : str2bytes(EMPTY_COSTUME_SVG),
            'svg'
        );
        var sprite = {
            isStage: false,
            name: name,
            variables: {},
            lists: {},
            broadcasts: {},
            blocks: {},
            comments: {},
            currentCostume: 0,
            costumes: [{
                name: (options.costume && options.costume.costumeName) || name + '-a',
                bitmapResolution: 1,
                dataFormat: 'svg',
                assetId: asset.assetId,
                md5ext: asset.md5ext,
                rotationCenterX: options.centerX === undefined ? 24 : options.centerX,
                rotationCenterY: options.centerY === undefined ? 24 : options.centerY
            }],
            sounds: [],
            volume: 100,
            layerOrder: this.targets.length,
            visible: options.visible !== false,
            x: options.x === undefined ? 0 : options.x,
            y: options.y === undefined ? 0 : options.y,
            size: options.size === undefined ? 100 : options.size,
            direction: 90,
            draggable: false,
            rotationStyle: 'all around'
        };
        if (options.scripts) {
            sprite.blocks = serializeBlocks(options.scripts, this.context());
        }
        this.targets.push(sprite);
        return sprite;
    };

    /**
     * Construit la liste `monitors` : chaque variable et chaque liste doit y
     * figurer pour que les blocs `cacher/afficher` fonctionnent (l'identifiant
     * d'un moniteur de variable est l'identifiant de la variable elle-même).
     */
    Project.prototype.buildMonitors = function () {
        var self = this;
        var monitors = [];
        var visibleVars = this.visibleVariables || {};
        var visibleLists = this.visibleLists || {};
        function add(id, name, isList) {
            var visible = (isList ? visibleLists : visibleVars)[name] === true;
            var monitor = {
                id: id,
                mode: isList ? 'list' : 'default',
                opcode: isList ? 'data_listcontents' : 'data_variable',
                params: isList ? {LIST: name} : {VARIABLE: name},
                spriteName: null,
                value: isList ? [] : 0,
                width: 0,
                height: 0,
                x: isList ? 5 : 5,
                y: 5,
                visible: visible
            };
            if (!isList) {
                monitor.sliderMin = 0;
                monitor.sliderMax = 100;
                monitor.isDiscrete = true;
            }
            monitors.push(monitor);
        }
        Object.keys(this.variables).forEach(function (id) { add(id, self.variables[id][0], false); });
        Object.keys(this.lists).forEach(function (id) { add(id, self.lists[id][0], true); });
        return monitors;
    };

    /** Sérialise le projet complet en `project.json`. */
    Project.prototype.toProjectJson = function () {
        return {
            targets: this.targets,
            monitors: this.buildMonitors(),
            extensions: this.extensions || [],
            extensionURLs: {},
            meta: {
                semver: '3.0.0',
                vm: '1.0.0',
                agent: this.author,
                platform: {name: 'Sorax', url: 'https://scratch.mit.edu'},
                sorax: this.soraxMeta || undefined
            }
        };
    };

    /** Liste des fichiers à zipper : `project.json` + assets. */
    Project.prototype.files = function () {
        var files = [{
            path: 'project.json',
            data: utf8(JSON.stringify(this.toProjectJson()))   // UTF-8, pas latin-1
        }];
        this.assets.forEach(function (asset) {
            files.push({path: asset.name, data: asset.data});
        });
        return files;
    };

    /* ------------------------------------------------------------------ */
    /* ZIP (méthode 8 deflate si un compresseur est fourni, sinon store)   */
    /* ------------------------------------------------------------------ */

    var CRC_TABLE = (function () {
        var table = new Int32Array(256);
        for (var n = 0; n < 256; n++) {
            var c = n;
            for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            table[n] = c;
        }
        return table;
    }());

    function crc32(bytes) {
        var crc = -1;
        for (var i = 0; i < bytes.length; i++) {
            crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
        }
        return (crc ^ -1) >>> 0;
    }

    function str2bytes(str) {
        var out = new Uint8Array(str.length);
        for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xFF;
        return out;
    }

    /** Encode une chaîne en UTF-8 (pour les noms de fichiers de l'archive). */
    function utf8(str) {
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
        var out = [];
        for (var i = 0; i < str.length; i++) {
            var c = str.charCodeAt(i);
            if (c < 0x80) out.push(c);
            else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
            else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        }
        return new Uint8Array(out);
    }

    /**
     * Fabrique une archive ZIP.
     * @param {Array<{path: string, data: Uint8Array}>} files
     * @param {function(Uint8Array): Uint8Array} [compress] compresseur (deflate brut)
     * @returns {Uint8Array}
     */
    function zip(files, compress) {
        var chunks = [];
        var central = [];
        var offset = 0;

        function u16(v) { return [v & 0xFF, (v >> 8) & 0xFF]; }
        function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }

        files.forEach(function (file) {
            var nameBytes = utf8(file.path);
            var data = file.data;
            var crc = crc32(data);
            var method = 0;
            var stored = data;
            if (compress) {
                var deflated = compress(data);
                if (deflated && deflated.length < data.length) {
                    method = 8;
                    stored = deflated;
                }
            }
            var local = [].concat(
                u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0),
                u32(crc), u32(stored.length), u32(data.length), u16(nameBytes.length), u16(0)
            );
            chunks.push(new Uint8Array(local), nameBytes, stored);
            central.push({nameBytes: nameBytes, crc: crc, method: method,
                compressed: stored.length, uncompressed: data.length, offset: offset});
            offset += local.length + nameBytes.length + stored.length;
        });

        var centralStart = offset;
        central.forEach(function (entry) {
            var header = [].concat(
                u32(0x02014b50), u16(20), u16(20), u16(0), u16(entry.method), u16(0), u16(0),
                u32(entry.crc), u32(entry.compressed), u32(entry.uncompressed),
                u16(entry.nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
                u32(entry.offset)
            );
            chunks.push(new Uint8Array(header), entry.nameBytes);
            offset += header.length + entry.nameBytes.length;
        });

        var eocd = [].concat(
            u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
            u32(offset - centralStart), u32(centralStart), u16(0)
        );
        chunks.push(new Uint8Array(eocd));

        var total = chunks.reduce(function (sum, chunk) { return sum + chunk.length; }, 0);
        var out = new Uint8Array(total);
        var cursor = 0;
        chunks.forEach(function (chunk) {
            out.set(chunk, cursor);
            cursor += chunk.length;
        });
        return out;
    }

    /* ------------------------------------------------------------------ */
    /* MD5 (nécessaire pour nommer les assets comme le fait Scratch)       */
    /* ------------------------------------------------------------------ */

    /** MD5 hexadécimal d'un Uint8Array (implémentation compacte, sans dépendance). */
    function md5Hex(bytes) {
        return md5(bytes);
    }

    function md5(bytes) {
        function rl(n, c) { return (n << c) | (n >>> (32 - c)); }
        function au(x, y) { var l = (x & 0xFFFF) + (y & 0xFFFF); return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xFFFF); }
        function cmn(q, a, b, x, s, t) { return au(rl(au(au(a, q), au(x, t)), s), b); }
        function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
        function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
        function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
        function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }

        var len = bytes.length;
        var words = [];
        for (var i = 0; i < len; i++) words[i >> 2] = (words[i >> 2] || 0) | (bytes[i] << ((i % 4) * 8));
        words[len >> 2] = (words[len >> 2] || 0) | (0x80 << ((len % 4) * 8));
        var wordCount = (((len + 8) >> 6) + 1) * 16;
        while (words.length < wordCount) words.push(0);
        words[(((len + 8) >> 6) * 16) + 14] = len * 8;
        words[(((len + 8) >> 6) * 16) + 15] = 0;

        var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
        for (i = 0; i < words.length; i += 16) {
            var oa = a, ob = b, oc = c, od = d;
            a = ff(a, b, c, d, words[i], 7, -680876936);
            d = ff(d, a, b, c, words[i + 1], 12, -389564586);
            c = ff(c, d, a, b, words[i + 2], 17, 606105819);
            b = ff(b, c, d, a, words[i + 3], 22, -1044525330);
            a = ff(a, b, c, d, words[i + 4], 7, -176418897);
            d = ff(d, a, b, c, words[i + 5], 12, 1200080426);
            c = ff(c, d, a, b, words[i + 6], 17, -1473231341);
            b = ff(b, c, d, a, words[i + 7], 22, -45705983);
            a = ff(a, b, c, d, words[i + 8], 7, 1770035416);
            d = ff(d, a, b, c, words[i + 9], 12, -1958414417);
            c = ff(c, d, a, b, words[i + 10], 17, -42063);
            b = ff(b, c, d, a, words[i + 11], 22, -1990404162);
            a = ff(a, b, c, d, words[i + 12], 7, 1804603682);
            d = ff(d, a, b, c, words[i + 13], 12, -40341101);
            c = ff(c, d, a, b, words[i + 14], 17, -1502002290);
            b = ff(b, c, d, a, words[i + 15], 22, 1236535329);

            a = gg(a, b, c, d, words[i + 1], 5, -165796510);
            d = gg(d, a, b, c, words[i + 6], 9, -1069501632);
            c = gg(c, d, a, b, words[i + 11], 14, 643717713);
            b = gg(b, c, d, a, words[i], 20, -373897302);
            a = gg(a, b, c, d, words[i + 5], 5, -701558691);
            d = gg(d, a, b, c, words[i + 10], 9, 38016083);
            c = gg(c, d, a, b, words[i + 15], 14, -660478335);
            b = gg(b, c, d, a, words[i + 4], 20, -405537848);
            a = gg(a, b, c, d, words[i + 9], 5, 568446438);
            d = gg(d, a, b, c, words[i + 14], 9, -1019803690);
            c = gg(c, d, a, b, words[i + 3], 14, -187363961);
            b = gg(b, c, d, a, words[i + 8], 20, 1163531501);
            a = gg(a, b, c, d, words[i + 13], 5, -1444681467);
            d = gg(d, a, b, c, words[i + 2], 9, -51403784);
            c = gg(c, d, a, b, words[i + 7], 14, 1735328473);
            b = gg(b, c, d, a, words[i + 12], 20, -1926607734);

            a = hh(a, b, c, d, words[i + 5], 4, -378558);
            d = hh(d, a, b, c, words[i + 8], 11, -2022574463);
            c = hh(c, d, a, b, words[i + 11], 16, 1839030562);
            b = hh(b, c, d, a, words[i + 14], 23, -35309556);
            a = hh(a, b, c, d, words[i + 1], 4, -1530992060);
            d = hh(d, a, b, c, words[i + 4], 11, 1272893353);
            c = hh(c, d, a, b, words[i + 7], 16, -155497632);
            b = hh(b, c, d, a, words[i + 10], 23, -1094730640);
            a = hh(a, b, c, d, words[i + 13], 4, 681279174);
            d = hh(d, a, b, c, words[i], 11, -358537222);
            c = hh(c, d, a, b, words[i + 3], 16, -722521979);
            b = hh(b, c, d, a, words[i + 6], 23, 76029189);
            a = hh(a, b, c, d, words[i + 9], 4, -640364487);
            d = hh(d, a, b, c, words[i + 12], 11, -421815835);
            c = hh(c, d, a, b, words[i + 15], 16, 530742520);
            b = hh(b, c, d, a, words[i + 2], 23, -995338651);

            a = ii(a, b, c, d, words[i], 6, -198630844);
            d = ii(d, a, b, c, words[i + 7], 10, 1126891415);
            c = ii(c, d, a, b, words[i + 14], 15, -1416354905);
            b = ii(b, c, d, a, words[i + 5], 21, -57434055);
            a = ii(a, b, c, d, words[i + 12], 6, 1700485571);
            d = ii(d, a, b, c, words[i + 3], 10, -1894986606);
            c = ii(c, d, a, b, words[i + 10], 15, -1051523);
            b = ii(b, c, d, a, words[i + 1], 21, -2054922799);
            a = ii(a, b, c, d, words[i + 8], 6, 1873313359);
            d = ii(d, a, b, c, words[i + 15], 10, -30611744);
            c = ii(c, d, a, b, words[i + 6], 15, -1560198380);
            b = ii(b, c, d, a, words[i + 13], 21, 1309151649);
            a = ii(a, b, c, d, words[i + 4], 6, -145523070);
            d = ii(d, a, b, c, words[i + 11], 10, -1120210379);
            c = ii(c, d, a, b, words[i + 2], 15, 718787259);
            b = ii(b, c, d, a, words[i + 9], 21, -343485551);

            a = au(a, oa); b = au(b, ob); c = au(c, oc); d = au(d, od);
        }
        function hex(n) {
            var s = '';
            for (var k = 0; k < 4; k++) {
                s += ('0' + ((n >> (k * 8)) & 0xFF).toString(16)).slice(-2);
            }
            return s;
        }
        return hex(a) + hex(b) + hex(c) + hex(d);
    }

    /**
     * Assemble un `.sb3` complet.
     * @param {Project} project projet
     * @param {function(Uint8Array): Uint8Array} [compress] deflate (optionnel)
     * @returns {Uint8Array}
     */
    function buildSb3(project, compress) {
        resetIds();
        return zip(project.files(), compress);
    }

    return {
        Project: Project,
        buildSb3: buildSb3,
        serializeBlocks: serializeBlocks,
        zip: zip,
        crc32: crc32,
        md5: md5,
        md5Hex: md5Hex,
        utf8: utf8,
        str2bytes: str2bytes,
        resetIds: resetIds,
        DEFAULT_INPUTS: DEFAULT_INPUTS,
        DEFAULT_FIELDS: DEFAULT_FIELDS,
        PRIMITIVE_TYPE: PRIMITIVE_TYPE
    };
}));
