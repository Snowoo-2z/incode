/**
 * @fileoverview JS -> Scratch blocks transpiler for the web mode.
 *
 * WHY THIS EXISTS
 * In the web mode the AI writes vanilla HTML/CSS/JS like for a tiny web game:
 *
 *     let score = 0;
 *     whenFlag(() => {
 *       forever(() => {
 *         balle.move(7);
 *         if (balle.touching(raquette)) score = score + 1;
 *         if (keyPressed('up arrow')) raquette.changeY(8);
 *       });
 *     });
 *     balle.onClick(() => { score += 1; });
 *
 * Acorn (vendored in ./vendor/acorn.js) parses this into an AST; this module
 * walks the AST and produces the SAME action objects the JSON/DSL paths already
 * produce (CREATE_VAR / CREATE_SPRITE / ADD_SCRIPT ...), so the battle-tested
 * code-interpreter + block-builder pipeline turns them into real blocks.
 *
 * Pipeline:
 *   statements -> stmt() -> array of *items*
 * An item is either:
 *   - a block spec      {opcode, inputs, fields, __sprite?}
 *   - a hat marker      {__hat: opcode, key?, message?, body: blocks}
 *   - a var marker      {__var: name, value?} / {__changeVar: name, delta}
 *   - a list marker     {__list: name, items}
 *   - a control marker  {__control: 'forever'|'repeat'|..., ...} (resolved by
 *     controlBlock() into the matching C-block with its SUBSTACK filled)
 * `finalizeStack()` flattens everything, wires hats into scripts, and collects
 * variable/list declarations. Nothing leaves this file with a `__` marker.
 */

import acorn from './vendor/acorn.js';

const KEY_ALIASES = {
    arrowup: 'up arrow',
    arrowdown: 'down arrow',
    arrowleft: 'left arrow',
    arrowright: 'right arrow',
    ' ': 'space',
    spacebar: 'space',
    enter: 'enter',
    return: 'enter',
    escape: 'escape',
    esc: 'escape',
    shift: 'shift',
    control: 'control',
    ctrl: 'control',
    alt: 'alt',
    tab: 'tab'
};

/** Normalizes a JS key name into a Scratch key option. */
const normalizeKey = raw => {
    const key = String(raw == null ? '' : raw).toLowerCase();
    if (KEY_ALIASES[key]) return KEY_ALIASES[key];
    return key;
};

/** Block spec factory. */
const blk = (opcode, inputs, fields) => {
    const spec = {opcode};
    if (inputs) spec.inputs = inputs;
    if (fields) spec.fields = fields;
    return spec;
};

/** Tags a block with the sprite it belongs to (used for routing). */
const onSprite = (sprite, spec) => {
    if (spec && typeof spec === 'object' && !Array.isArray(spec) && sprite) {
        spec.__sprite = String(sprite).toLowerCase();
    }
    return spec;
};

const VAR_FIELD = name => ({VARIABLE: {variable: true, value: name}});
const LIST_FIELD = name => ({LIST: {list: true, value: name}});
const MSG_FIELD = name => ({BROADCAST_OPTION: {broadcast: true, value: name}});

class Transpiler {
    constructor (spriteNames) {
        /** Known sprite names (from the HTML extraction), lowercased. */
        this.spriteNames = new Set((spriteNames || []).map(n => String(n).toLowerCase()));
        this.warnings = [];
        /** Hoisted functions: name -> {params, body, node, active}. */
        this.functions = new Map();
        /** Declared variables/lists, in order. */
        this.varDecls = new Map(); // name -> initial value (block/literal) or null
        this.listDecls = new Map(); // name -> items
        /** Scripts per sprite key (lowercased; '__stage__' for the stage). */
        this.scripts = new Map();
        /** Variables the JS wants shown on stage monitors. */
        this.shownVars = new Set();
        /**
         * Custom-block ("mes blocs") definitions, generated lazily:
         * name -> {proccode, paramIds: [id...], params: [name...], body: blocks,
         *          targets: Set<spriteKey>, stub: boolean}
         * Every JS function the code CALLS as a statement becomes a real
         * Scratch custom block: known functions get their body converted,
         * unknown calls get a stub that says `TODO: ...` so nothing fails.
         */
        this.customDefs = new Map();
        /** Params in scope while converting a custom block body:
         * paramName -> {id, block} argument reporter. */
        this.procContext = null;
    }

    /* ------------------------------------------------ custom blocks ("mes blocs")
     * A `define f(a, b)` + `f(1, 2)` pair maps to Scratch custom blocks:
     *   - procedures_definition (hat) referencing a procedures_prototype label
     *     whose proccode is `f %s %s`;
     *   - procedures_call stack blocks at every call site, each input slot
     *     filled by the call argument (shadowed by the matching argument
     *     reporter).
     * Argument ids are derived from the block name so the prototype, the call
     * inputs and the body reporters always agree. */

    /** Deterministic argument id for (procName, paramIndex). */
    procArgId (name, index) {
        const slug = String(name || 'p').toLowerCase().replace(/[^a-z0-9]/g, '') || 'fn';
        return `arg-${slug}-${index}`;
    }

    /** Builds (once) the custom-block definition for a called function. */
    ensureCustomDef (name, callArgCount = 0, node = null) {
        if (this.customDefs.has(name)) return this.customDefs.get(name);
        const fn = this.functions.get(name);
        const params = fn ? fn.params.slice() : [];
        // Unknown functions get generic `argument` params, one per call arg.
        const argCount = Math.max(params.length, fn ? 0 : callArgCount);
        const paramNames = params.slice();
        while (paramNames.length < argCount) paramNames.push(`argument ${paramNames.length + 1}`);
        const paramIds = paramNames.map((_, i) => this.procArgId(name, i));
        const proccode = `${name} ${paramNames.map(() => '%s').join(' ')}`.trim();
        const def = {
            name,
            proccode,
            params: paramNames,
            paramIds,
            body: null,
            targets: new Set(),
            stub: !fn
        };
        this.customDefs.set(name, def);

        // Convert the body (if we know it) with params mapped to argument
        // reporters; unknown functions get a visible TODO stub body.
        const previousContext = this.procContext;
        this.procContext = new Map(paramNames.map((p, i) => [p, {
            id: paramIds[i],
            block: {opcode: 'argument_reporter_string_number', fields: {VALUE: p}}
        }]));
        let body;
        if (fn) {
            body = this.stmts(fn.body.body);
        } else {
            this.warn(node || fn && fn.node,
                `fonction "${name}()" inconnue : bloc personnalisé stub créé ` +
                '(remplace son corps par les vrais blocs).');
            body = [blk('looks_say', {MESSAGE: `TODO: ${name}()`})];
        }
        this.procContext = previousContext;
        def.body = body;
        return def;
    }

    /** procedures_call block for a call site. */
    customCallBlock (name, argExprs) {
        const def = this.ensureCustomDef(name, argExprs.length, null);
        const inputs = {};
        def.paramIds.forEach((id, i) => {
            // Value slots on a custom block call: the call argument (a block
            // spec or a literal). block-builder shadows the slot with a
            // number/text block; the VM uses the real argument value at
            // runtime regardless of the shadow's visual default.
            inputs[id] = argExprs[i] ? this.expr(argExprs[i]) : '';
        });
        const block = blk('procedures_call', inputs);
        block.mutation = {
            tagName: 'mutation',
            proccode: def.proccode,
            argumentids: JSON.stringify(def.paramIds),
            argumentnames: JSON.stringify(def.params),
            argumentdefaults: JSON.stringify(def.params.map(() => '')),
            warp: 'false',
            children: []
        };
        block.__customName = name;
        return block;
    }

    warn (node, message) {
        const line = node && node.loc ? node.loc.start.line : '?';
        this.warnings.push(`⚠ Ligne ${line} : ${message}`);
    }

    isSprite (name) {
        return this.spriteNames.has(String(name || '').toLowerCase());
    }

    /**
     * Registers a sprite name lazily. The HTML extraction normally provides
     * the list, but JS may reference sprites on its own (or run without a DOM
     * in tests): the first sprite-method call on an identifier IMPLICITLY
     * creates the sprite, exactly like `ADD_SCRIPT` auto-creates its target.
     */
    registerSprite (name) {
        if (!name) return;
        const key = String(name).toLowerCase();
        if (!this.spriteNames.has(key)) this.spriteNames.add(key);
    }

    /* ============================================================== EXPRESSIONS */

    /**
     * Converts an expression node to a reporter block spec, a literal
     * (number/string/boolean), or null when unsupported.
     */
    expr (node) {
        if (!node) return 0;

        switch (node.type) {
        case 'Literal':
            return node.value;

        case 'TemplateLiteral': {
            // `a${x}b` -> nested operator_join.
            let result = null;
            for (let i = 0; i < node.quasis.length; i++) {
                const quasi = node.quasis[i];
                if (quasi.value.cooked) {
                    result = result === null ? quasi.value.cooked :
                        blk('operator_join', {STRING1: result, STRING2: quasi.value.cooked});
                }
                if (node.expressions[i]) {
                    const sub = this.expr(node.expressions[i]);
                    result = result === null ? sub :
                        blk('operator_join', {STRING1: result, STRING2: sub});
                }
            }
            return result === null ? '' : result;
        }

        case 'Identifier': {
            if (node.name === 'true') return true;
            if (node.name === 'false') return false;
            if (this.isSprite(node.name)) return node.name;
            // Custom-block parameter: reference the block's argument reporter.
            if (this.procContext && this.procContext.has(node.name)) {
                return this.procContext.get(node.name).block;
            }
            if (this.functions.has(node.name)) {
                this.warn(node, `"${node.name}" utilisée comme valeur : les fonctions ne peuvent ` +
                    'pas renvoyer de valeur en blocs (utilise une variable globale).');
                return 0;
            }
            return blk('data_variable', null, VAR_FIELD(node.name));
        }

        case 'BinaryExpression':
        case 'LogicalExpression': {
            const left = this.expr(node.left);
            const right = this.expr(node.right);
            if (node.operator === '&&') {
                return blk('operator_and', {OPERAND1: left, OPERAND2: right});
            }
            if (node.operator === '||') {
                return blk('operator_or', {OPERAND1: left, OPERAND2: right});
            }
            const arith = {'+': 'operator_add', '-': 'operator_subtract',
                '*': 'operator_multiply', '/': 'operator_divide', '%': 'operator_mod'};
            const compare = {'>': 'operator_gt', '<': 'operator_lt',
                '==': 'operator_equals', '===': 'operator_equals'};
            if (arith[node.operator]) {
                return blk(arith[node.operator], {NUM1: left, NUM2: right});
            }
            if (compare[node.operator]) {
                return blk(compare[node.operator], {OPERAND1: left, OPERAND2: right});
            }
            if (node.operator === '!=' || node.operator === '!==') {
                return blk('operator_not',
                    {OPERAND: blk('operator_equals', {OPERAND1: left, OPERAND2: right})});
            }
            this.warn(node, `opérateur "${node.operator}" non supporté.`);
            return 0;
        }

        case 'UnaryExpression': {
            if (node.operator === '!') {
                return blk('operator_not', {OPERAND: this.expr(node.argument)});
            }
            if (node.operator === '-') {
                return blk('operator_subtract', {NUM1: 0, NUM2: this.expr(node.argument)});
            }
            this.warn(node, `opérateur unaire "${node.operator}" non supporté.`);
            return 0;
        }

        case 'ParenthesizedExpression':
            return this.expr(node.expression);

        case 'CallExpression':
            return this.callExpr(node);

        case 'MemberExpression':
            return this.memberReporter(node);

        case 'ArrayExpression':
            this.warn(node, 'tableau en expression non supporté (utilise les listes par index).');
            return 0;

        case 'ConditionalExpression': {
            // ternary cond ? a : b -> not directly expressible; approximate
            this.warn(node, 'ternaire (cond ? a : b) non supporté : utilise if/else.');
            return this.expr(node.consequent);
        }

        default:
            this.warn(node, `expression "${node.type}" non supportée.`);
            return 0;
        }
    }

    /** obj.prop / obj['prop'] reader. */
    memberInfo (node) {
        if (!node || node.type !== 'MemberExpression') return null;
        const objectName = node.object.type === 'Identifier' ? node.object.name : null;
        let property = null;
        if (!node.computed && node.property.type === 'Identifier') {
            property = node.property.name;
        } else if (node.computed && node.property.type === 'Literal') {
            property = node.property.value;
        }
        return {objectName, property, object: node.object, node};
    }

    /** Member expression used as a reporter value. */
    memberReporter (node) {
        const info = this.memberInfo(node);
        if (!info) {
            this.warn(node, 'accès membre non supporté en expression.');
            return 0;
        }
        const {objectName: obj, property: prop} = info;

        // Math constants.
        if (obj === 'Math' || obj === 'math') {
            if (prop === 'PI') return Math.PI;
            if (prop === 'E') return Math.E;
            this.warn(node, `Math.${prop} : constante non reconnue.`);
            return 0;
        }

        // A `<identifier>.x/.y/.direction/...` read IMPLICITLY names a sprite.
        const spriteProps = new Set(['x', 'y', 'direction', 'size', 'costume', 'costumeNumber']);
        if (this.isSprite(obj) || (obj && spriteProps.has(prop) &&
            !/^(math|console|window|document)$/i.test(obj))) {
            this.registerSprite(obj);
            switch (prop) {
            // Reporters about a sprite are tagged with it: the block only
            // means the right thing when it lives on that sprite's scripts.
            case 'x': return onSprite(obj, blk('motion_xposition'));
            case 'y': return onSprite(obj, blk('motion_yposition'));
            case 'direction': return onSprite(obj, blk('motion_direction'));
            case 'size': return onSprite(obj, blk('looks_size'));
            case 'costume': case 'costumeNumber':
                return onSprite(obj, blk('looks_costumenumbername', null, {NUMBER_NAME: 'number'}));
            default:
                this.warn(node, `propriété "${obj}.${prop}" non lisible.`);
                return 0;
            }
        }
        if (prop === 'length') {
            return blk('data_lengthoflist', null, LIST_FIELD(obj));
        }
        if (node.computed) {
            return blk('data_itemoflist',
                {INDEX: this.expr(node.property)}, LIST_FIELD(obj));
        }
        this.warn(node, `propriété "${obj}.${prop}" non supportée.`);
        return 0;
    }

    /** Static string of an argument node (Literal / simple Template / Identifier). */
    staticString (node) {
        if (!node) return '';
        if (node.type === 'Literal') return String(node.value);
        if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
            return node.quasis[0].value.cooked;
        }
        if (node.type === 'Identifier') return node.name;
        return '';
    }

    /** Menu value for touching(): '_edge_' / '_mouse_' / sprite name. */
    touchingMenu (argNode) {
        const raw = this.staticString(argNode) ||
            (argNode && argNode.type === 'Identifier' ? argNode.name : '');
        const low = String(raw).toLowerCase().replace(/['"]/g, '');
        if (low.includes('edge') || low.includes('bord')) return '_edge_';
        if (low.includes('mouse') || low.includes('souris') ||
            low.includes('cursor') || low.includes('pointeur')) return '_mouse_';
        return raw || '_edge_';
    }

    /** Menu value for goto/pointTowards/distance/clone. */
    targetMenu (argNode, fallback = '_random_') {
        const raw = this.staticString(argNode) ||
            (argNode && argNode.type === 'Identifier' ? argNode.name : '');
        const low = String(raw).toLowerCase();
        if (low.includes('random') || low.includes('aléatoire') || low.includes('aleatoire')) {
            return '_random_';
        }
        if (low.includes('mouse') || low.includes('souris')) return '_mouse_';
        return raw || fallback;
    }

    /* ============================================================== CALLS */

    /**
     * Call expression. As a statement this may return a CONTROL/HAT/CUSTOM
     * marker; as a reporter it returns a block spec.
     */
    callExpr (node, asStatement = false) {
        if (node.callee.type === 'Identifier') {
            const result = this.globalCall(node);
            // A custom-block marker is only valid as a STATEMENT (procedures
            // cannot return values in Scratch). As a reporter, inline the
            // declared function body or return 0.
            if (result && result.__custom) {
                if (asStatement) return result;
                const name = result.__custom;
                if (this.functions.has(name)) return {__inline: name, args: node.arguments};
                this.warn(node, `fonction "${name}()" sans équivalent en bloc : ignorée ici.`);
                return 0;
            }
            return result;
        }
        if (node.callee.type === 'MemberExpression') {
            return this.methodCall(node);
        }
        this.warn(node, 'appel de fonction non supporté.');
        return 0;
    }

    /** Global helper functions. */
    globalCall (node) {
        const name = node.callee.name;
        const args = node.arguments;
        const val = i => this.expr(args[i]);
        const str = i => this.staticString(args[i]);
        const body = i => this.callbackBody(args[i]);

        switch (name) {
        // ---- control flow (statement markers) ----
        case 'forever':
        case 'repeatForever':
            return {__control: 'forever', body: body(0)};
        case 'repeat':
            return args.length >= 2 ?
                {__control: 'repeat', times: val(0), body: body(1)} :
                {__control: 'repeat', times: 10, body: body(0)};
        case 'wait':
        case 'sleep':
            return {__control: 'wait', duration: val(0)};
        case 'waitUntil':
            return {__control: 'waitUntil', condition: val(0)};
        case 'stopAll':
        case 'stop':
            return {__control: 'stop'};

        // ---- hats ----
        case 'whenFlag':
        case 'onStart':
            return {__hat: 'event_whenflagclicked', body: body(0)};
        case 'whenKeyPressed':
        case 'onKey':
            return {__hat: 'event_whenkeypressed', key: normalizeKey(str(0)), body: body(1)};
        case 'whenReceive':
        case 'onMessage':
            return {__hat: 'event_whenbroadcastreceived', message: str(0), body: body(1)};
        case 'whenCloned':
        case 'whenStartAsClone':
            return {__hat: 'control_start_as_clone', body: body(0)};

        // ---- events / broadcasts ----
        case 'broadcast':
        case 'sendMessage':
            return blk('event_broadcast', null, MSG_FIELD(str(0)));
        case 'broadcastAndWait':
            return blk('event_broadcastandwait', null, MSG_FIELD(str(0)));

        // ---- sensing reporters ----
        case 'keyPressed':
            return blk('sensing_keypressed', null, {KEY_OPTION: normalizeKey(str(0))});
        case 'touching':
            return blk('sensing_touchingobject', null,
                {TOUCHINGOBJECTMENU: this.touchingMenu(args[0])});
        case 'distanceTo':
            return blk('sensing_distanceto', null, {DISTANCETOMENU: this.targetMenu(args[0], '_mouse_')});
        case 'mouseDown':
            return blk('sensing_mousedown');
        case 'mouseX':
            return blk('sensing_mousex');
        case 'mouseY':
            return blk('sensing_mousey');
        case 'timer':
            return blk('sensing_timer');
        case 'resetTimer':
            return blk('sensing_resettimer');
        case 'answer':
            return blk('sensing_answer');
        case 'ask':
        case 'askAndWait':
            return blk('sensing_askandwait', {QUESTION: val(0)});

        // ---- operators reporters ----
        case 'random':
            return blk('operator_random', {FROM: val(0), TO: val(1)});
        case 'round':
            return blk('operator_round', {NUM: val(0)});
        case 'join':
            return blk('operator_join', {STRING1: val(0), STRING2: val(1)});
        case 'parseInt':
            // parseInt truncates toward zero; floor handles the usual positive case.
            return blk('operator_mathop', {NUM: val(0)}, {OPERATOR: 'floor'});
        case 'parseFloat':
        case 'Number':
            // Scratch number slots coerce automatically; pass the value through.
            return val(0);
        case 'String':
            // Force a string: join with an empty text.
            return blk('operator_join', {STRING1: '', STRING2: val(0)});
        case 'alert':
            // Dialog message -> sprite "say" (routed to the current context).
            return blk('looks_say', {MESSAGE: val(0)});
        case 'length':
            return blk('operator_length', {STRING: val(0)});
        case 'abs': case 'floor': case 'ceiling': case 'sqrt': case 'sin': case 'cos':
        case 'tan': case 'asin': case 'acos': case 'atan': case 'ln': case 'log':
        case 'e ^': case '10 ^':
            return blk('operator_mathop', {NUM: val(0)}, {OPERATOR: name});

        // ---- timers / game loops ----
        case 'setInterval': {
            // setInterval(cb, ms) -> forever { <body>; wait(ms/1000) }
            const seconds = args[1] ?
                blk('operator_divide', {NUM1: val(1), NUM2: 1000}) : 0.03;
            return {__control: 'forever',
                body: [...body(0), blk('control_wait', {DURATION: seconds})]};
        }
        case 'setTimeout': {
            // setTimeout(cb, ms) -> wait(ms/1000) then <body> once.
            const seconds = args[1] ?
                blk('operator_divide', {NUM1: val(1), NUM2: 1000}) : 0;
            return {__sequence: [blk('control_wait', {DURATION: seconds}), ...body(0)]};
        }
        case 'clearInterval':
        case 'clearTimeout':
            return null;
        case 'requestAnimationFrame': {
            // rAF loop: the callback re-schedules itself in browsers, but in
            // Scratch a forever loop is the natural equivalent: run the body
            // at ~60fps.
            const cbBody = body(0) || [];
            return {__control: 'forever',
                body: [...cbBody, blk('control_wait', {DURATION: 0.016})]};
        }

        // ---- variables ----
        case 'showVariable': {
            const vName = str(0);
            this.shownVars.add(vName);
            return blk('data_showvariable', null, VAR_FIELD(vName));
        }
        case 'hideVariable':
            return blk('data_hidevariable', null, VAR_FIELD(str(0)));

        // ---- lists ----
        case 'addToList':
            return blk('data_addtolist', {ITEM: val(0)}, LIST_FIELD(str(1)));
        case 'deleteFromList':
            return blk('data_deleteoflist', {INDEX: val(0)}, LIST_FIELD(str(1)));
        case 'listContains':
            return blk('data_listcontainsitem', {ITEM: val(0)}, LIST_FIELD(str(1)));
        case 'itemOfList':
            return blk('data_itemoflist', {INDEX: val(0)}, LIST_FIELD(str(1)));

        // ---- console ----
        case 'log':
            if (node.callee.type === 'Identifier') {
                // console.log is handled in methodCall; bare log() ignored
                return null;
            }
            return null;

        default:
            // User-declared or unknown function call. In STATEMENT context
            // (exprStatement handles __custom) it becomes a real Scratch
            // custom block ("mes blocs"); used as a reporter it falls back to
            // inline substitution (or 0 + warning for unknown functions).
            if (this.functions.has(name)) {
                return {__custom: name, args, node};
            }
            return {__custom: name, args, node, stub: true};
        }
    }

    /** Method calls: sprite.move(...), list.push(...), document/window events. */
    methodCall (node) {
        const info = this.memberInfo(node.callee);
        const obj = info.objectName;
        const method = info.property;
        const args = node.arguments;
        const val = i => this.expr(args[i]);
        const str = i => this.staticString(args[i]);
        const body = i => this.callbackBody(args[i]);

        // console.log -> ignored
        if (obj === 'console') return null;

        // Math.* static helpers.
        if (obj === 'Math' || obj === 'math') {
            const mathOps = ['abs', 'floor', 'ceiling', 'sqrt', 'sin', 'cos',
                'tan', 'asin', 'acos', 'atan', 'ln', 'log', 'e ^', '10 ^'];
            const opMap = {ceil: 'ceiling', asin: 'asin', acos: 'acos'};
            const blockOp = opMap[method] || method;
            if (mathOps.includes(blockOp)) {
                return blk('operator_mathop', {NUM: val(0)}, {OPERATOR: blockOp});
            }
            if (method === 'random') {
                // Math.random() -> random 0..1 (whole/round semantics preserved).
                return blk('operator_random', {FROM: 0, TO: 1});
            }
            if (method === 'round') {
                return blk('operator_round', {NUM: val(0)});
            }
            if (method === 'min' || method === 'max') {
                // No built-in min/max block: Scratch comparisons are boolean
                // (true=1/false=0), so min(a,b) = (a<b)*a + (a>=b)*b and
                // max(a,b) = (a>b)*a + (a<=b)*b.
                const cmp = method === 'min' ? 'operator_lt' : 'operator_gt';
                const a = val(0);
                const b = args.length > 1 ? val(1) : 0;
                const pickA = blk(cmp, {OPERAND1: a, OPERAND2: b});
                const pickB = {opcode: 'operator_not', inputs: {OPERAND: pickA}};
                return blk('operator_add', {
                    NUM1: blk('operator_multiply', {NUM1: pickA, NUM2: a}),
                    NUM2: blk('operator_multiply', {NUM1: pickB, NUM2: b})
                });
            }
            if (method === 'pow' || method === 'power') {
                // No generic power block: warn (integer exponents could be
                // expanded to repeated multiplies); e^x is available instead.
                this.warn(node, 'Math.pow(base, exp) non supporté ' +
                    '(utilise e^ pour base e, ou des multiplications).');
                return val(0);
            }
            if (method === 'exp') {
                return blk('operator_mathop', {NUM: val(0)}, {OPERATOR: 'e ^'});
            }
            this.warn(node, `Math.${method}() non reconnu.`);
            return 0;
        }

        // Math.PI read as a member reporter.
        // (handled in memberReporter)

        // window timers: window.setInterval(cb, ms).
        if (obj === 'window' && (method === 'setInterval' || method === 'setTimeout')) {
            return this.globalCall({...node,
                callee: {type: 'Identifier', name: method}});
        }
        if (obj === 'window' && (method === 'clearInterval' || method === 'clearTimeout')) {
            return null;
        }

        // list methods (names match Scratch list blocks) - handle BEFORE the
        // implicit-sprite registration so no fake sprite gets created.
        const listOps = {
            push: 'add', add: 'add', append: 'add',
            pop: 'deleteLast', shift: 'deleteFirst',
            clear: 'deleteAll', empty: 'deleteAll',
            insert: 'insert', splice: 'insert',
            get: 'item', index: 'itemOf',
            includes: 'contains', has: 'contains',
            indexOf: 'itemNum'
        };
        const listOp = listOps[method];
        if (listOp) {
            switch (listOp) {
            case 'add':
                return blk('data_addtolist', {ITEM: val(0)}, LIST_FIELD(obj));
            case 'deleteLast':
                return blk('data_deleteoflist',
                    {INDEX: blk('data_lengthoflist', null, LIST_FIELD(obj))}, LIST_FIELD(obj));
            case 'deleteFirst':
                return blk('data_deleteoflist', {INDEX: 1}, LIST_FIELD(obj));
            case 'deleteAll':
                return blk('data_deletealloflist', null, LIST_FIELD(obj));
            case 'insert':
                return blk('data_insertatlist',
                    {ITEM: val(0), INDEX: args.length > 1 ? val(1) : 1}, LIST_FIELD(obj));
            case 'item':
            case 'itemOf':
                return blk('data_itemoflist',
                    {INDEX: val(0)}, LIST_FIELD(obj));
            case 'contains':
                return blk('data_listcontainsitem', {ITEM: val(0)}, LIST_FIELD(obj));
            case 'itemNum':
                return blk('data_itemnumoflist', {ITEM: val(0)}, LIST_FIELD(obj));
            default:
                break;
            }
        }

        // document / window
        if (obj === 'document' || obj === 'window') {
            if (method === 'addEventListener') {
                const eventName = str(0);
                if (eventName === 'keydown' || eventName === 'keyup' || eventName === 'keypress') {
                    return {__multiHat: this.keyHatsFromCallback(null, args[1])};
                }
                if (eventName === 'click') {
                    return {__hat: 'event_whenstageclicked', body: body(1)};
                }
                this.warn(node, `événement document "${eventName}" non supporté.`);
                return null;
            }
            if (method === 'getElementById' || method === 'querySelector') {
                // getElementById('balle') -> a reference to that sprite, so
                // chaining .move(...) or passing it around works: return the
                // sprite NAME (the same thing a bare identifier resolves to).
                const raw = str(0) || '';
                const id = raw.replace(/^#/, '').trim();
                if (id) {
                    this.registerSprite(id);
                    return id;
                }
                return 0;
            }
            this.warn(node, `document.${method}() non supporté.`);
            return null;
        }

        // list.push / list.add
        if (method === 'push' || method === 'add') {
            // Could also be a sprite method "add"? No sprite API uses those
            // names; lists do. (Sprite methods are matched in the switch below.)
            return blk('data_addtolist', {ITEM: val(0)}, LIST_FIELD(obj));
        }

        // Any other `<identifier>.<method>(...)` call IMPLICITLY targets a
        // sprite: the JS often references game objects that the HTML did not
        // declare (or the extraction ran without a DOM). Register it so the
        // block is routed to (and auto-creates) that sprite.
        if (obj && !/^(math|console|window|document)$/i.test(obj)) {
            this.registerSprite(obj);
        }
        if (!this.isSprite(obj)) {
            this.warn(node, `"${obj}.${method}()" : "${obj}" n'est pas un sprite connu.`);
            return 0;
        }

        switch (method) {
        // ---- hats ----
        case 'onClick':
        case 'whenClicked':
            return {__hat: 'event_whenthisspriteclicked', sprite: obj, body: body(0)};
        case 'addEventListener': {
            const eventName = str(0);
            if (eventName === 'click') {
                return {__hat: 'event_whenthisspriteclicked', sprite: obj, body: body(1)};
            }
            if (eventName === 'keydown' || eventName === 'keyup' || eventName === 'keypress') {
                return {__multiHat: this.keyHatsFromCallback(obj, args[1])};
            }
            this.warn(node, `événement "${eventName}" non supporté sur un sprite.`);
            return null;
        }
        case 'whenCloned':
        case 'whenStartAsClone':
            return {__hat: 'control_start_as_clone', sprite: obj, body: body(0)};

        // ---- motion ----
        case 'move': case 'moveSteps':
            return onSprite(obj, blk('motion_movesteps', {STEPS: val(0)}));
        case 'turnRight': case 'turn':
            return onSprite(obj, blk('motion_turnright', {DEGREES: val(0)}));
        case 'turnLeft':
            return onSprite(obj, blk('motion_turnleft', {DEGREES: val(0)}));
        case 'goto':
            return onSprite(obj, blk('motion_goto', null, {TO: this.targetMenu(args[0])}));
        case 'gotoXy': case 'goToXY': case 'setXY':
            return onSprite(obj, blk('motion_gotoxy', {X: val(0), Y: val(1)}));
        case 'glide':
            return onSprite(obj, blk('motion_glidesecstoxy',
                {SECS: val(0), X: val(1), Y: val(2)}));
        case 'glideTo':
            return onSprite(obj, blk('motion_glideto',
                {SECS: val(0)}, {TO: this.targetMenu(args[1], '_random_')}));
        case 'pointInDirection': case 'setDirection':
            return onSprite(obj, blk('motion_pointindirection', {DIRECTION: val(0)}));
        case 'pointTowards':
            return onSprite(obj, blk('motion_pointtowards', null,
                {TOWARDS: this.targetMenu(args[0], '_mouse_')}));
        case 'changeX':
            return onSprite(obj, blk('motion_changexby', {DX: val(0)}));
        case 'changeY':
            return onSprite(obj, blk('motion_changeyby', {DY: val(0)}));
        case 'setX':
            return onSprite(obj, blk('motion_setx', {X: val(0)}));
        case 'setY':
            return onSprite(obj, blk('motion_sety', {Y: val(0)}));
        case 'bounce': case 'ifOnEdgeBounce':
            return onSprite(obj, blk('motion_ifonedgebounce'));
        case 'setRotationStyle':
            return onSprite(obj, blk('motion_setrotationstyle', null, {STYLE: str(0)}));

        // ---- looks ----
        case 'say':
            return onSprite(obj, blk('looks_say', {MESSAGE: val(0)}));
        case 'sayFor':
            return onSprite(obj, blk('looks_sayforsecs', {MESSAGE: val(0), SECS: val(1)}));
        case 'think':
            return onSprite(obj, blk('looks_think', {MESSAGE: val(0)}));
        case 'thinkFor':
            return onSprite(obj, blk('looks_thinkforsecs', {MESSAGE: val(0), SECS: val(1)}));
        case 'switchCostume': case 'setCostume':
            return onSprite(obj, blk('looks_switchcostumeto', {COSTUME: val(0)}));
        case 'nextCostume':
            return onSprite(obj, blk('looks_nextcostume'));
        case 'switchBackdrop':
            return blk('looks_switchbackdropto', {BACKDROP: val(0)});
        case 'changeSize':
            return onSprite(obj, blk('looks_changesizeby', {CHANGE: val(0)}));
        case 'setSize':
            return onSprite(obj, blk('looks_setsizeto', {SIZE: val(0)}));
        case 'show':
            return onSprite(obj, blk('looks_show'));
        case 'hide':
            return onSprite(obj, blk('looks_hide'));
        case 'goToFront':
            return onSprite(obj, blk('looks_gotofrontback', null, {FRONT_BACK: 'front'}));
        case 'goBackLayers':
            return onSprite(obj, blk('looks_goforwardbackwardlayers',
                {NUM: val(0)}, {FORWARD_BACKWARD: 'backward'}));

        // ---- sound ----
        case 'playSound':
            return onSprite(obj, blk('sound_play', null, {SOUND_MENU: str(0)}));
        case 'playSoundUntilDone':
            return onSprite(obj, blk('sound_playuntildone', null, {SOUND_MENU: str(0)}));
        case 'stopAllSounds':
            return onSprite(obj, blk('sound_stopallsounds'));
        case 'setVolume':
            return onSprite(obj, blk('sound_setvolumeto', {VOLUME: val(0)}));
        case 'changeVolume':
            return onSprite(obj, blk('sound_changevolumeby', {VOLUME: val(0)}));

        // ---- clones ----
        case 'clone': case 'createClone':
            return onSprite(obj, blk('control_create_clone_of', null,
                {CLONE_OPTION: args[0] ? this.targetMenu(args[0], '_myself_') : '_myself_'}));
        case 'deleteClone':
            return onSprite(obj, blk('control_delete_this_clone'));

        // ---- sensing reporters (they describe THIS sprite) ----
        case 'touching':
            return onSprite(obj, blk('sensing_touchingobject', null,
                {TOUCHINGOBJECTMENU: this.touchingMenu(args[0])}));
        case 'distanceTo':
            return onSprite(obj, blk('sensing_distanceto', null,
                {DISTANCETOMENU: this.targetMenu(args[0], '_mouse_')}));

        // ---- pen ----
        case 'penDown':
            return onSprite(obj, blk('pen_penDown'));
        case 'penUp':
            return onSprite(obj, blk('pen_penUp'));
        case 'penClear':
            return blk('pen_clear');
        case 'stamp':
            return onSprite(obj, blk('pen_stamp'));

        default:
            this.warn(node, `méthode "${obj}.${method}()" non reconnue (ignorée).`);
            return 0;
        }
    }

    /* ============================================================== KEY EVENTS */

    /** Statement list of a callback (`() => {...}` or `function() {...}`). */
    callbackBody (node) {
        if (!node) return [];
        if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
            if (node.body.type === 'BlockStatement') {
                return this.stmts(node.body.body);
            }
            return this.stmts([{type: 'ExpressionStatement', expression: node.body}]);
        }
        this.warn(node, 'un callback (fonction fléchée) est attendu ici.');
        return [];
    }

    /**
     * Builds one `when key pressed` hat per key found in a keydown callback:
     *   e => { if (e.key === 'ArrowUp') raquette.changeY(8); }
     * Bodies without a key guard fall back to a flag-clicked hat.
     */
    keyHatsFromCallback (sprite, cb) {
        if (!cb || (cb.type !== 'ArrowFunctionExpression' && cb.type !== 'FunctionExpression')) {
            this.warn(cb || {}, "handler clavier : fonction fléchée attendue.");
            return [];
        }
        const bodyStatements = cb.body.type === 'BlockStatement' ? cb.body.body : [cb.body];
        const hats = [];

        for (const stmt of bodyStatements) {
            if (stmt.type === 'IfStatement') {
                const key = this.detectKeyCondition(stmt.test);
                if (key) {
                    const inner = this.stmts(stmt.consequent.type === 'BlockStatement' ?
                        stmt.consequent.body : [stmt.consequent]);
                    hats.push({
                        __hat: 'event_whenkeypressed',
                        key,
                        sprite: sprite || null,
                        body: inner
                    });
                    continue;
                }
            }
            const inner = this.stmts([stmt]);
            if (inner.length) {
                hats.push({
                    __hat: 'event_whenflagclicked',
                    sprite: sprite || null,
                    body: inner
                });
            }
        }
        return hats;
    }

    /** Detects `e.key === 'ArrowUp'` (also e.code / e.keyCode). */
    detectKeyCondition (test) {
        const nodes = [test];
        if (test.type === 'UnaryExpression') nodes.push(test.argument);
        for (const t of nodes) {
            if (t.type !== 'BinaryExpression' || !['==', '==='].includes(t.operator)) continue;
            const memberSide = [t.left, t.right].find(s => s.type === 'MemberExpression' &&
                ['key', 'code', 'keyCode'].includes((this.memberInfo(s) || {}).property));
            const literalSide = [t.left, t.right].find(s => s.type === 'Literal');
            if (memberSide && literalSide) {
                let key = String(literalSide.value);
                if (/^Key([A-Z])$/.test(key)) key = key.slice(1).toLowerCase();
                const arrowMatch = key.match(/^Arrow(Up|Down|Left|Right)$/);
                if (arrowMatch) key = `${arrowMatch[1].toLowerCase()} arrow`;
                if (typeof literalSide.value === 'number') {
                    const codes = {38: 'up arrow', 40: 'down arrow', 37: 'left arrow',
                        39: 'right arrow', 32: 'space', 13: 'enter', 27: 'escape'};
                    key = codes[literalSide.value] || key;
                }
                return normalizeKey(key);
            }
        }
        return null;
    }

    /* ============================================================== STATEMENTS */

    /**
     * Converts a list of statement nodes to a flat list of items:
     * block specs (possibly with __sprite), hat markers, var markers...
     * Control markers ({__control}) are resolved here too, so what comes out
     * only contains block specs and {__hat} markers.
     */
    stmts (statementNodes) {
        const out = [];
        for (const node of statementNodes) {
            const items = this.stmt(node) || [];
            const arr = Array.isArray(items) ? items : [items];
            for (const item of arr) {
                if (item === null || item === undefined) continue;
                if (item.__multiHat) {
                    for (const hat of item.__multiHat) out.push(hat);
                } else {
                    out.push(item);
                }
            }
        }
        return out;
    }

    stmt (node) {
        if (!node) return null;

        if (node.type === 'FunctionDeclaration') {
            this.functions.set(node.id.name, {
                params: node.params.map(p => p.name),
                body: node.body,
                node,
                active: false
            });
            return null;
        }

        switch (node.type) {
        case 'ExpressionStatement':
            return this.exprStatement(node.expression);

        case 'VariableDeclaration': {
            const out = [];
            for (const decl of node.declarations) {
                const name = decl.id.name;
                if (decl.init && decl.init.type === 'ArrayExpression') {
                    const items = decl.init.elements.map(el => this.expr(el));
                    this.listDecls.set(name, items);
                    out.push({__list: name, items});
                } else {
                    const value = decl.init ? this.expr(decl.init) : 0;
                    this.varDecls.set(name, value);
                    out.push({__var: name, value});
                }
            }
            return out;
        }

        case 'IfStatement': {
            const thenBody = this.stmts(node.consequent.type === 'BlockStatement' ?
                node.consequent.body : [node.consequent]);
            const spec = blk(node.alternate ? 'control_if_else' : 'control_if', {
                CONDITION: this.expr(node.test),
                SUBSTACK: thenBody
            });
            if (node.alternate) {
                spec.inputs.SUBSTACK2 = this.stmts(node.alternate.type === 'BlockStatement' ?
                    node.alternate.body : [node.alternate]);
            }
            return spec;
        }

        case 'WhileStatement': {
            const body = this.stmts(node.body.type === 'BlockStatement' ?
                node.body.body : [node.body]);
            if (this.isInfiniteLoop(node.test)) {
                return blk('control_forever', {SUBSTACK: body});
            }
            return blk('control_repeat_until', {
                CONDITION: blk('operator_not', {OPERAND: this.expr(node.test)}),
                SUBSTACK: body
            });
        }

        case 'ForStatement': {
            const body = this.stmts(node.body.type === 'BlockStatement' ?
                node.body.body : [node.body]);
            const times = this.forLoopCount(node);
            if (node.init && node.init.type === 'VariableDeclaration') {
                const decl = node.init.declarations[0];
                this.varDecls.set(decl.id.name, 0);
                return [{__var: decl.id.name, value: 0},
                    blk('control_repeat', {TIMES: times || 10, SUBSTACK: body})];
            }
            if (times) {
                return blk('control_repeat', {TIMES: times, SUBSTACK: body});
            }
            this.warn(node, 'boucle for sans limite numérique -> "répéter indéfiniment".');
            return blk('control_forever', {SUBSTACK: body});
        }

        case 'ForOfStatement':
        case 'ForInStatement': {
            // for (let item of list) { ... } ->
            //   set [indexVar] to 1
            //   repeat (length of list) {
            //     set item to (item (indexVar) of list)   [for...of]
            //     <body>
            //     change [indexVar] by 1
            //   }
            // for...in gives keys (indices) instead of values.
            const listName = node.right.type === 'Identifier' ? node.right.name : null;
            if (!listName || !this.listDecls.has(listName)) {
                this.warn(node, 'boucle for...of/for...in : seul le parcours d\'une ' +
                    'liste déclarée est supporté.');
                return null;
            }
            const decl = node.left.type === 'VariableDeclaration' ?
                node.left.declarations[0] : null;
            const itemVar = decl ? decl.id.name :
                (node.left.type === 'Identifier' ? node.left.name : 'item');
            this.varDecls.set(itemVar, 0);
            const indexVar = `_i_${listName}`;
            this.varDecls.set(indexVar, 1);
            const lenReporter = blk('data_lengthoflist', null, LIST_FIELD(listName));
            const indexRef = blk('data_variable', null, VAR_FIELD(indexVar));
            const body = this.stmts(node.body.type === 'BlockStatement' ?
                node.body.body : [node.body]);
            const itemBlock = node.type === 'ForOfStatement' ?
                blk('data_setvariableto', {
                    VALUE: blk('data_itemoflist', {INDEX: indexRef}, LIST_FIELD(listName))
                }, VAR_FIELD(itemVar)) :
                // for...in: item = index
                blk('data_setvariableto', {VALUE: indexRef}, VAR_FIELD(itemVar));
            const loopBody = [
                itemBlock,
                ...body,
                blk('data_changevariableby', {VALUE: 1}, VAR_FIELD(indexVar))
            ];
            return [
                {__var: indexVar, value: 1},
                blk('control_repeat', {TIMES: lenReporter, SUBSTACK: loopBody})
            ];
        }

        case 'BlockStatement':
            return this.stmts(node.body);

        case 'SwitchStatement': {
            // switch(x) { case 'a': ...; break; case 'b': ...; }
            // -> if (x == 'a') {...} else if (x == 'b') {...} (else: default).
            const discriminant = this.expr(node.discriminant);
            let current = null;
            let defaultBody = null;
            // Build from the LAST case backwards so we can chain else blocks.
            const cases = node.cases;
            for (let i = cases.length - 1; i >= 0; i--) {
                const c = cases[i];
                const statements = this.stmts(c.consequent.filter(s =>
                    s.type !== 'BreakStatement'));
                const body = statements.concat(current || []);
                if (c.test === null) {
                    defaultBody = body;
                    continue;
                }
                const spec = blk(current || defaultBody ? 'control_if_else' : 'control_if', {
                    CONDITION: blk('operator_equals',
                        {OPERAND1: discriminant, OPERAND2: this.expr(c.test)}),
                    SUBSTACK: body
                });
                if (current || defaultBody) {
                    spec.inputs.SUBSTACK2 = current || defaultBody;
                }
                current = [spec];
            }
            if (!current && defaultBody) return defaultBody;
            return current;
        }

        case 'ReturnStatement':
            this.warn(node, 'return non supporté : utilise une variable globale pour sortir une valeur.');
            return null;

        case 'EmptyStatement':
        case 'DebuggerStatement':
            return null;

        default:
            this.warn(node, `instruction "${node.type}" non supportée (ignorée).`);
            return null;
        }
    }

    isInfiniteLoop (test) {
        if (!test) return true;
        if (test.type === 'Literal' && test.value === true) return true;
        if (test.type === 'Identifier' && test.name === 'true') return true;
        return false;
    }

    forLoopCount (node) {
        const test = node.test;
        if (!test || test.type !== 'BinaryExpression') return null;
        if (test.operator === '<' && test.right.type === 'Literal') return test.right.value;
        if (test.operator === '<=' && test.right.type === 'Literal') return test.right.value + 1;
        return null;
    }

    /**
     * Expression used as a statement.
     */
    exprStatement (node) {
        if (node.type === 'AssignmentExpression') return this.assignment(node);
        if (node.type === 'UpdateExpression') return this.update(node);
        if (node.type === 'CallExpression') {
            const result = this.callExpr(node, true);
            if (result === null || result === undefined) return null;
            if (result.__hat) return result;
            if (result.__multiHat) return result.__multiHat;
            if (result.__control) return this.controlBlock(result);
            if (result.__sequence) return result.__sequence;
            if (result.__inline) return this.inlineFunction(result.__inline, result.args);
            if (result.__custom) {
                // Ensure the definition exists (also warns for unknown funcs).
                this.ensureCustomDef(result.__custom, result.args.length, result.node);
                return this.customCallBlock(result.__custom, result.args);
            }
            if (result.opcode) return result;
            return null;
        }
        this.warn(node, `expression en instruction "${node.type}" non supportée.`);
        return null;
    }

    /** Resolves a control marker (forever/repeat/wait/stop) into a block. */
    controlBlock (marker) {
        switch (marker.__control) {
        case 'forever':
            return blk('control_forever', {SUBSTACK: marker.body || []});
        case 'repeat':
            return blk('control_repeat', {TIMES: marker.times, SUBSTACK: marker.body || []});
        case 'wait':
            return blk('control_wait', {DURATION: marker.duration});
        case 'waitUntil':
            return blk('control_wait_until', {CONDITION: marker.condition});
        case 'stop':
            return blk('control_stop', null, {STOP_OPTION: 'all'});
        default:
            return null;
        }
    }

    /**
     * Assignments (see header doc table).
     */
    assignment (node) {
        const target = node.left;

        if (target.type === 'Identifier') {
            const name = target.name;
            const rhs = this.expr(node.right);
            this.varDecls.set(name, this.varDecls.get(name) ?? 0);
            if (node.operator === '+=') {
                return blk('data_changevariableby', {VALUE: rhs}, VAR_FIELD(name));
            }
            if (node.operator === '-=') {
                return blk('data_changevariableby',
                    {VALUE: blk('operator_subtract', {NUM1: 0, NUM2: rhs})}, VAR_FIELD(name));
            }
            // *=, /=, %= : reassign with the binary operation.
            const compound = {'*=': 'operator_multiply', '/=': 'operator_divide',
                '%=': 'operator_mod'};
            const oldRef = () => blk('data_variable', null, VAR_FIELD(name));
            if (compound[node.operator]) {
                return blk('data_setvariableto',
                    {VALUE: blk(compound[node.operator], {NUM1: oldRef(), NUM2: rhs})},
                    VAR_FIELD(name));
            }
            this.varDecls.set(name, rhs);
            return blk('data_setvariableto', {VALUE: rhs}, VAR_FIELD(name));
        }

        if (target.type === 'MemberExpression') {
            const info = this.memberInfo(target);
            const obj = info.objectName;
            const prop = info.property;

            // Assigning to `<identifier>.x/.y/.direction/...` IMPLICITLY targets
            // a sprite (same convention as sprite-method calls).
            const spriteAssignProps = new Set([
                'x', 'y', 'direction', 'size', 'visible', 'shown',
                'costume', 'costumeNumber', 'text', 'textContent', 'innerText', 'innerHTML'
            ]);
            if (obj && !this.isSprite(obj) && spriteAssignProps.has(prop) &&
                !/^(math|console|window|document)$/i.test(obj)) {
                this.registerSprite(obj);
            }

            // list[index] = value (computed member on a non-sprite name)
            if (target.computed && !this.isSprite(obj)) {
                return blk('data_replaceitemoflist',
                    {INDEX: this.expr(target.property), ITEM: this.expr(node.right)},
                    LIST_FIELD(obj));
            }

            if (this.isSprite(obj)) {
                const rhs = this.expr(node.right);
                const plus = node.operator === '+=' ? rhs :
                    node.operator === '-=' ?
                        blk('operator_subtract', {NUM1: 0, NUM2: rhs}) : null;
                switch (prop) {
                case 'x':
                    return onSprite(obj, plus ?
                        blk('motion_changexby', {DX: plus}) :
                        blk('motion_setx', {X: rhs}));
                case 'y':
                    return onSprite(obj, plus ?
                        blk('motion_changeyby', {DY: plus}) :
                        blk('motion_sety', {Y: rhs}));
                case 'direction':
                    return onSprite(obj, blk('motion_pointindirection',
                        {DIRECTION: plus ? blk('operator_add',
                            {NUM1: onSprite(obj, blk('motion_direction')), NUM2: plus}) : rhs}));
                case 'size':
                    return onSprite(obj, plus ?
                        blk('looks_changesizeby', {CHANGE: plus}) :
                        blk('looks_setsizeto', {SIZE: rhs}));
                case 'visible': case 'shown':
                    return onSprite(obj, (rhs === false || rhs === 0) ?
                        blk('looks_hide') : blk('looks_show'));
                case 'costume': case 'costumeNumber':
                    return onSprite(obj, blk('looks_switchcostumeto', {COSTUME: rhs}));
                case 'text': case 'textContent': case 'innerText': case 'innerHTML':
                    return onSprite(obj, blk('looks_say', {MESSAGE: rhs}));
                default:
                    this.warn(node, `propriété "${obj}.${prop}" non modifiable en blocs.`);
                    return null;
                }
            }
        }
        this.warn(node, 'assignation non supportée.');
        return null;
    }

    /** score++ / balle.x++ */
    update (node) {
        const delta = node.operator === '++' ? 1 : -1;
        const target = node.argument;
        if (target.type === 'Identifier') {
            this.varDecls.set(target.name, this.varDecls.get(target.name) ?? 0);
            return blk('data_changevariableby', {VALUE: delta}, VAR_FIELD(target.name));
        }
        if (target.type === 'MemberExpression') {
            const info = this.memberInfo(target);
            if (this.isSprite(info.objectName)) {
                if (info.property === 'x') {
                    return onSprite(info.objectName, blk('motion_changexby', {DX: delta}));
                }
                if (info.property === 'y') {
                    return onSprite(info.objectName, blk('motion_changeyby', {DY: delta}));
                }
            }
        }
        this.warn(node, '++/-- non supporté sur cette cible.');
        return null;
    }

    /**
     * Inlines a call to a user function: parameter assignments followed by the
     * body blocks. Recursion is reported (it would need custom blocks).
     */
    inlineFunction (name, callArgs) {
        const fn = this.functions.get(name);
        if (!fn) return null;
        if (fn.active) {
            this.warn(fn.node, `la fonction "${name}" est récursive : non supporté ` +
                '(utilise des messages « envoyer à tous »).');
            return null;
        }
        fn.active = true;
        const bindings = fn.params.map((param, i) => {
            const value = callArgs[i] ? this.expr(callArgs[i]) : 0;
            this.varDecls.set(param, value);
            return blk('data_setvariableto', {VALUE: value}, VAR_FIELD(param));
        });
        const body = this.stmts(fn.body.body);
        fn.active = false;
        return bindings.concat(body);
    }

    /* ================================================ STACK SPLITTING / ROUTING
     * JS is one flat program while Scratch blocks live PER SPRITE: a motion
     * block runs on the sprite that owns it, and reporters like "touching?"
     * only make sense on the right sprite. A single `forever(...)` that touches
     * several sprites must therefore be DUPLICATED into one loop per sprite,
     * each copy containing only the blocks that belong to it (exactly how a
     * human Scratcher builds a multi-sprite game: one green-flag loop per
     * sprite). The sprite each block belongs to is carried by the __sprite tag
     * set with onSprite(); routing below walks the stack to replicate it.
     */

    /** Most frequent __sprite tag in a stack (or nested inputs). */
    dominantSprite (stack) {
        const counts = new Map();
        const walk = value => {
            if (!value || typeof value !== 'object') return;
            if (value.__sprite) {
                const key = String(value.__sprite).toLowerCase();
                counts.set(key, (counts.get(key) || 0) + 1);
            }
            if (value.inputs) {
                for (const v of Object.values(value.inputs)) {
                    if (Array.isArray(v)) v.forEach(walk);
                    else walk(v);
                }
            }
        };
        (stack || []).forEach(walk);
        let best = null;
        let bestCount = 0;
        for (const [key, count] of counts) {
            if (count > bestCount) {
                best = key;
                bestCount = count;
            }
        }
        return best;
    }

    /** Sprite directly referenced by a block's own reporters (conditions...). */
    blockDirectSprite (block) {
        let found = null;
        const walk = value => {
            if (!value || typeof value !== 'object' || found) return;
            if (value === block) {
                // Walk only the inputs (nested reporters), not the block itself.
                if (value.inputs) {
                    for (const v of Object.values(value.inputs)) {
                        if (Array.isArray(v)) v.forEach(walk);
                        else walk(v);
                    }
                }
                return;
            }
            if (value.__sprite) {
                found = String(value.__sprite).toLowerCase();
                return;
            }
            if (value.inputs) {
                for (const v of Object.values(value.inputs)) {
                    if (Array.isArray(v)) v.forEach(walk);
                    else walk(v);
                }
            }
        };
        walk(block);
        return found;
    }

    /**
     * True for blocks that only run on a sprite (the stage rejects them):
     * motion, looks text/costume/visibility blocks...
     */
    isSpriteOnlyBlock (block) {
        if (!block || typeof block !== 'object') return false;
        const op = block.opcode || '';
        return op.startsWith('motion_') ||
            ['looks_say', 'looks_sayforsecs', 'looks_think', 'looks_thinkforsecs',
                'looks_show', 'looks_hide', 'looks_switchcostumeto', 'looks_nextcostume',
                'looks_changesizeby', 'looks_setsizeto', 'looks_changeeffectby',
                'looks_seteffectto', 'looks_cleargraphiceffects', 'looks_gotofrontback',
                'looks_goforwardbackwardlayers', 'control_create_clone_of',
                'control_delete_this_clone', 'sensing_touchingobject',
                'sensing_distanceto', 'procedures_call'].includes(op);
    }

    /**
     * Neutral blocks that ONLY run on a sprite (say/think, motion...) cannot
     * stay on the stage. When the project has exactly one sprite, retarget them
     * to it (this is the common shape of single-sprite games written entirely
     * in JS: `whenFlag(() => { say('hi'); move(10); })`).
     * Walks nested SUBSTACK blocks (forever/if/repeat bodies).
     */
    retargetSpriteOnly (items) {
        const spriteTargets = [...this.spriteNames].filter(k => k !== '__stage__');
        const only = spriteTargets.length === 1 ? spriteTargets[0] : null;
        if (!only) return;
        const walk = value => {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value)) {
                value.forEach(walk);
                return;
            }
            if (value.opcode && !value.__sprite && this.isSpriteOnlyBlock(value)) {
                value.__sprite = only;
            }
            if (value.inputs) {
                for (const v of Object.values(value.inputs)) {
                    if (Array.isArray(v)) v.forEach(walk);
                    else walk(v);
                }
            }
        };
        walk(items || []);
    }

    /**
     * Replicates a stack of blocks once per referenced sprite, so that each
     * sprite ends up with the loops/calls that concern it.
     * @param {Array<object>} items block specs (already free of markers)
     * @param {Set<string>} spriteKeys all sprite names (lowercased)
     * @param {string} [defaultSprite] where neutral (untagged) blocks go: the
     *   stage for top-level code, or the hat's owner sprite inside a hat body
     *   (so `bouton.onClick(() => { score += 1 })` keeps the variable update on
     *   the button, matching how the block was authored).
     * @returns {Map<string, Array<object>>} sprite key -> its own stack
     */
    splitStack (items, spriteKeys, defaultSprite = '__stage__') {
        const fallback = String(defaultSprite || '__stage__').toLowerCase();
        const out = new Map();
        for (const sprite of spriteKeys) out.set(sprite, []);
        out.set('__stage__', []);
        if (!out.has(fallback)) out.set(fallback, []);

        const add = (sprite, block) => {
            const key = String(sprite || fallback).toLowerCase();
            if (!out.has(key)) out.set(key, []);
            out.get(key).push(block);
        };

        // Neutral blocks (a wait, a score update...) follow the flow they are
        // part of: in a sequence like `wait(1); balle.say('x')`, the wait
        // belongs to the same sprite as the statement right after/before it,
        // so it stays adjacent to it in the generated script.
        const findNearestSprite = index => {
            for (let j = index; j < items.length; j++) {
                const s = items[j] && (items[j].__sprite || this.blockDirectSprite(items[j]));
                if (s) return String(s).toLowerCase();
            }
            for (let j = index; j >= 0; j--) {
                const s = items[j] && (items[j].__sprite || this.blockDirectSprite(items[j]));
                if (s) return String(s).toLowerCase();
            }
            return null;
        };

        const cloneBlock = block => {
            const clean = value => {
                if (!value || typeof value !== 'object') return value;
                const copy = Array.isArray(value) ? value.map(clean) :
                    Object.assign(Object.create(Object.getPrototypeOf(value)), value);
                if (!Array.isArray(copy) && copy.inputs) {
                    const inputs = {};
                    for (const [name, v] of Object.entries(copy.inputs)) {
                        inputs[name] = Array.isArray(v) ? v.map(clean) : clean(v);
                    }
                    copy.inputs = inputs;
                }
                return copy;
            };
            return clean(block);
        };

        for (const item of items) {
            if (!item || typeof item !== 'object') continue;

            // C-blocks (if / forever / repeat / repeat_until): replicate their
            // body per sprite.
            if (item.opcode === 'control_if' || item.opcode === 'control_if_else' ||
                item.opcode === 'control_forever' || item.opcode === 'control_repeat' ||
                item.opcode === 'control_repeat_until') {
                // A condition that directly references a sprite (e.g.
                // `<balle touches raquette?>`) means the whole if belongs to
                // THAT sprite: keep the body intact to preserve Scratch
                // semantics (the touching reporter is intrinsic to its sprite).
                const conditionSprite =
                    (item.opcode === 'control_if' || item.opcode === 'control_if_else') &&
                    item.inputs && item.inputs.CONDITION ?
                        this.blockDirectSprite(item.inputs.CONDITION) : null;

                const bodyPerSprite = new Map();
                const collectBody = (substack, isElse) => {
                    // Inside a C-block, neutral blocks (score updates, waits...)
                    // belong to the same fallback owner as the C-block itself.
                    const cOwner = item.__sprite ?
                        String(item.__sprite).toLowerCase() :
                        (this.blockDirectSprite(item) || fallback);
                    const routing = this.splitStack(substack || [], spriteKeys,
                        cOwner === '__stage__' ? fallback : cOwner);
                    for (const [key, blocks] of routing.entries()) {
                        if (!blocks.length) continue;
                        if (!bodyPerSprite.has(key)) bodyPerSprite.set(key, []);
                        bodyPerSprite.get(key).push({isElse, blocks});
                    }
                };
                collectBody(item.inputs && item.inputs.SUBSTACK, false);
                if (item.inputs && item.inputs.SUBSTACK2) {
                    collectBody(item.inputs.SUBSTACK2, true);
                }

                if (conditionSprite && bodyPerSprite.size) {
                    // Single-owner if: owner is the condition's sprite; keep
                    // the complete body on it (including any other-sprite
                    // statements, which would be invalid anywhere else).
                    const copy = cloneBlock(item);
                    const ownerKey = conditionSprite;
                    if (copy.inputs) {
                        if (copy.inputs.SUBSTACK) {
                            const ownerBody = bodyPerSprite.get(ownerKey);
                            // Rebuild the body from the ORIGINAL substack but
                            // keep it as-is (intact semantics).
                            copy.inputs.SUBSTACK = item.inputs.SUBSTACK;
                        }
                    }
                    add(ownerKey, copy);
                } else if (bodyPerSprite.size) {
                    // Replicate the C-block once per sprite present in its body.
                    for (const [key, groups] of bodyPerSprite.entries()) {
                        const copy = cloneBlock(item);
                        if (copy.inputs) {
                            const thenGroups = groups.filter(g => !g.isElse).map(g => g.blocks);
                            const elseGroups = groups.filter(g => g.isElse).map(g => g.blocks);
                            copy.inputs.SUBSTACK = thenGroups.flat();
                            if (copy.inputs.SUBSTACK2 !== undefined) {
                                copy.inputs.SUBSTACK2 = elseGroups.flat();
                            }
                        }
                        add(key, copy);
                    }
                } else if (fallback !== '__stage__') {
                    // The C-block holds no sprite statement at all: attach it
                    // to the fallback owner (hat sprite), where it reads most
                    // naturally.
                    add(fallback, item);
                }
                // At top level a fully-neutral C-block would just duplicate the
                // stage setup; skip it there.
                continue;
            }

            // Regular statement: route by its own tag, or the sprite directly
            // referenced by its reporters, or a nearby sprite statement in
            // the same sequence (so `wait(1); balle.say('x')` stays together),
            // or the fallback (stage at top level, hat owner inside a hat).
            const index = items.indexOf(item);
            let owner = item.__sprite || this.blockDirectSprite(item) ||
                findNearestSprite(index) || fallback;
            // Sprite-only blocks (motion, looks say/think/show/hide...) are
            // invalid on the stage. When they land there and the project has
            // exactly one sprite, send them to it (common for single-sprite
            // games written entirely in JS).
            if (owner === '__stage__' && this.isSpriteOnlyBlock(item)) {
                const spriteTargets = [...spriteKeys].filter(k => k !== '__stage__');
                if (spriteTargets.length === 1) owner = spriteTargets[0];
            }
            add(owner, item);
        }

        return out;
    }

    /* ============================================================== DRIVER */

    /**
     * Transpiles a whole JS source into per-sprite script stacks.
     * @param {string} code JS source
     * @returns {{
     *   scripts: Map<string, Array<Array<object>>>,
     *   variables: Array<{name: string, value: *}>,
     *   lists: Array<{name: string, items: Array}>,
     *   shownVars: Set<string>,
     *   warnings: Array<string>
     * }}
     */
    transpile (code) {
        let ast;
        try {
            ast = acorn.parse(String(code || ''), {
                ecmaVersion: 2022,
                sourceType: 'script',
                locations: true,
                allowReturnOutsideFunction: true,
                allowAwaitOutsideFunction: true
            });
        } catch (e) {
            this.warnings.push(`❌ Erreur de syntaxe JavaScript : ${e.message}`);
            return this.result();
        }

        // Hoist functions first so calls anywhere can inline them.
        for (const node of ast.body) {
            if (node.type === 'FunctionDeclaration') {
                this.functions.set(node.id.name, {
                    params: node.params.map(p => p.name),
                    body: node.body,
                    node,
                    active: false
                });
            }
        }

        // The set of sprite keys the body may be routed to.
        const spriteKeys = new Set([...this.spriteNames].map(n => String(n).toLowerCase()));

        // Transpile top-level statements into hats + hat-less blocks.
        const loose = []; // block specs appearing outside any hat
        const hats = [];
        for (const node of ast.body) {
            const items = this.stmt(node);
            if (!items) continue;
            const arr = Array.isArray(items) ? items : [items];
            for (const item of arr) {
                if (item === null || item === undefined) continue;
                if (item.__hat) {
                    hats.push(item);
                } else if (item.__multiHat) {
                    hats.push(...item.__multiHat);
                } else if (item.__var || item.__list) {
                    // Already registered during stmt(); nothing to emit.
                } else if (item.opcode) {
                    loose.push(item);
                }
            }
        }

        // ---- Hats: the head block is NOT a sprite statement; only the body
        // is routed. Split the body per sprite, attach the same hat head to
        // every copy.
        for (const hat of hats) {
            const head = blk(hat.__hat);
            if (hat.key) head.fields = Object.assign(head.fields || {}, {KEY_OPTION: hat.key});
            if (hat.message) {
                head.fields = Object.assign(head.fields || {}, MSG_FIELD(hat.message));
            }

            // Hats intrinsically bound to ONE target (clicks, clones, message
            // reception, stage click) must NOT be replicated per sprite: their
            // body is kept intact and routed as a whole. Motion calls on
            // OTHER sprites inside them remain instructions that run when this
            // sprite reacts — valid Scratch practice (sprites can act on
            // anything; sprite-local blocks use the named target only when
            // they are explicitly tagged).
            const localHats = new Set([
                'event_whenthisspriteclicked',
                'control_start_as_clone',
                'event_whenbroadcastreceived',
                'event_whenstageclicked'
            ]);
            if (localHats.has(hat.__hat)) {
                const owner = hat.sprite ?
                    String(hat.sprite).toLowerCase() :
                    (this.dominantSprite(hat.body || []) || '__stage__');
                this.pushScript(owner, this.cleanStack([head, ...(hat.body || [])]));
                continue;
            }

            // Flag / key hats (green flag, "when key pressed" at document
            // level, or a per-key hat with an explicit target): replicate the
            // body per referenced sprite so each sprite runs its own loop,
            // like a hand-built Scratch project.
            const hatOwner = hat.sprite ? String(hat.sprite).toLowerCase() : '__stage__';
            if (hat.sprite && !localHats.has(hat.__hat)) {
                // Explicit target on a key hat: route everything there.
                this.pushScript(hatOwner, this.cleanStack([head, ...(hat.body || [])]));
                continue;
            }
            this.retargetSpriteOnly(hat.body || []);
            const routed = this.splitStack(hat.body || [], spriteKeys, '__stage__');
            for (const [key, body] of routed.entries()) {
                if (!body.length) continue;
                this.pushScript(key, this.cleanStack([head, ...body]));
            }
        }

        // ---- Loose top-level blocks (setup + game loops written without an
        // explicit whenFlag wrapper): wrap each routed stack in a flag hat.
        this.retargetSpriteOnly(loose);
        const looseRouted = this.splitStack(loose, spriteKeys);
        for (const [key, body] of looseRouted.entries()) {
            if (!body.length) continue;
            const head = blk('event_whenflagclicked');
            const existing = this.scripts.get(key) || [];
            // Setup scripts (variables, gotoXY) come BEFORE the loops: but the
            // loose order is already source order; keep it as-is under one hat.
            this.scripts.set(key, [this.cleanStack([head, ...body]), ...existing]);
        }

        // ---- Custom blocks ("mes blocs"): a procedures_definition hat must
        // live on EVERY target that calls it (Scratch resolves calls on the
        // target they run on). Collect call sites from the routed scripts, then
        // prepend each target's own definitions.
        this.emitCustomDefinitions();

        return this.result();
    }

    /** Finds every custom block called in a stack of blocks (walks inputs). */
    static collectCustomCalls (stack) {
        const names = new Set();
        const walk = value => {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value)) {
                value.forEach(walk);
                return;
            }
            if (value.__customName) names.add(value.__customName);
            if (value.inputs) {
                for (const v of Object.values(value.inputs)) {
                    if (Array.isArray(v)) v.forEach(walk);
                    else walk(v);
                }
            }
        };
        walk(stack || []);
        return names;
    }

    /**
     * Builds the procedures_definition hat stack for a custom block.
     * @param {object} def definition record from customDefs
     * @returns {Array<object>} hat stack [definition, ...body]
     */
    buildDefinitionStack (def) {
        // Prototype label: orange `define f %s %s` with shadow argument
        // reporters nested in its inputs.
        const protoInputs = {};
        def.paramIds.forEach((id, i) => {
            protoInputs[id] = {
                opcode: 'argument_reporter_string_number',
                shadow: true,
                fields: {VALUE: def.params[i]}
            };
        });
        const prototype = blk('procedures_prototype', protoInputs);
        prototype.mutation = {
            tagName: 'mutation',
            proccode: def.proccode,
            argumentids: JSON.stringify(def.paramIds),
            argumentnames: JSON.stringify(def.params),
            argumentdefaults: JSON.stringify(def.params.map(() => '')),
            warp: 'false',
            children: []
        };
        const definition = blk('procedures_definition', {CUSTOM_BLOCK: prototype});
        return [definition, ...(def.body || [])];
    }

    /** Force-tags every stack block (and nested reporters) to a sprite. */
    tagStackSprite (stack, sprite) {
        const tag = value => {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value)) {
                value.forEach(tag);
                return;
            }
            if (value.opcode && value.__sprite !== '__keep__') value.__sprite = sprite;
            if (value.inputs) {
                for (const v of Object.values(value.inputs)) {
                    if (Array.isArray(v)) v.forEach(tag);
                    else tag(v);
                }
            }
        };
        tag(stack || []);
    }

    /** Emits each custom block definition on the targets that call it. */
    emitCustomDefinitions () {
        // Determine which targets call which custom blocks.
        const targetsForDef = new Map(); // name -> Set<key>
        for (const [key, stacks] of this.scripts.entries()) {
            for (const stack of stacks) {
                for (const name of Transpiler.collectCustomCalls(stack)) {
                    if (!targetsForDef.has(name)) targetsForDef.set(name, new Set());
                    targetsForDef.get(name).add(key);
                }
            }
        }
        for (const [name, def] of this.customDefs.entries()) {
            const keys = targetsForDef.get(name) || new Set(['__stage__']);
            for (const key of keys) {
                const stack = this.buildDefinitionStack(def);
                // The definition RUNS on this target: untag sprite-less blocks
                // inside the body (say, move...) so they inherit the target,
                // but keep explicit sprite tags that point elsewhere intact.
                for (const block of stack) {
                    if (block && block.opcode &&
                        (!block.__sprite || block.__sprite === '__stage__') &&
                        key !== '__stage__') {
                        block.__sprite = key;
                    }
                }
                const cleaned = this.cleanStack(stack);
                const existing = this.scripts.get(key) || [];
                // Definitions go BEFORE the scripts that call them.
                this.scripts.set(key, [cleaned, ...existing]);
            }
        }
    }

    pushScript (key, stack) {
        if (!stack.length) return;
        if (!this.scripts.has(key)) this.scripts.set(key, []);
        this.scripts.get(key).push(stack);
    }

    /** Removes internal __sprite markers recursively so blocks are VM-ready. */
    cleanStack (stack) {
        const clean = value => {
            if (!value || typeof value !== 'object') return;
            delete value.__sprite;
            if (value.inputs) {
                for (const v of Object.values(value.inputs)) {
                    if (Array.isArray(v)) v.forEach(clean);
                    else clean(v);
                }
            }
        };
        (stack || []).forEach(clean);
        return stack;
    }

    result () {
        return {
            scripts: this.scripts,
            variables: [...this.varDecls.entries()].map(([name, value]) => ({name, value})),
            lists: [...this.listDecls.entries()].map(([name, items]) => ({name, items})),
            shownVars: this.shownVars,
            warnings: this.warnings
        };
    }
}

export {
    Transpiler,
    normalizeKey
};
