/**
 * @fileoverview Micro-interpréteur Scratch : exécute les blocs d'un `.sb3`
 * (listes, variables, opérateurs, boucles, procédures, diffusion) sans
 * `node_modules`. Sert de banc d'essai au moteur de Sorax.
 *
 * `readZip(buffer)` lit l'archive, `ScratchVM(project, options)` expose
 * `runFlag()`, `runBroadcast(nom)`, `number(valeur)` et les crochets
 * `options.hooks.afterCall(proccode, vm)`.
 */

import zlib from 'node:zlib';

function readZip(buffer) {
    const entries = {};
    let offset = 0;
    while (offset < buffer.length - 4) {
        const signature = buffer.readUInt32LE(offset);
        if (signature !== 0x04034b50) break;
        const method = buffer.readUInt16LE(offset + 8);
        const compressedSize = buffer.readUInt32LE(offset + 18);
        const nameLength = buffer.readUInt16LE(offset + 26);
        const extraLength = buffer.readUInt16LE(offset + 28);
        const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLength);
        const dataStart = offset + 30 + nameLength + extraLength;
        const raw = buffer.subarray(dataStart, dataStart + compressedSize);
        entries[name] = method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(Buffer.from(raw));
        offset = dataStart + compressedSize;
    }
    return entries;
}

/* ---------------------------------------------------------------------- */
/* Micro-interpréteur Scratch                                             */
/* ---------------------------------------------------------------------- */

class ScratchVM {
    constructor(project, options) {
        this.project = project;
        this.target = project.targets.find((t) => !t.isStage);
        this.stage = project.targets.find((t) => t.isStage);
        this.blocks = this.target.blocks;
        this.variables = {};
        this.lists = {};
        this.broadcasts = {};
        this.say = '';
        this.askAnswer = options.askAnswer || '';
        this.hooks = options.hooks || {};
        this.forcedTokens = (options.forcedTokens || []).slice();
        this.budget = options.budget || 40000000;

        const collect = (target) => {
            Object.keys(target.variables).forEach((id) => {
                this.variables[target.variables[id][0]] = target.variables[id][1];
            });
            Object.keys(target.lists).forEach((id) => {
                this.lists[target.lists[id][0]] = target.lists[id][1].slice();
            });
            Object.keys(target.broadcasts).forEach((id) => {
                this.broadcasts[target.broadcasts[id]] = true;
            });
        };
        collect(this.stage);
        collect(this.target);

        // procédures : proccode -> {prototype, definition, body}
        this.procedures = {};
        Object.keys(this.blocks).forEach((id) => {
            const block = this.blocks[id];
            if (block.opcode !== 'procedures_definition') return;
            const protoId = block.inputs.custom_block[1];
            const prototype = this.blocks[protoId];
            this.procedures[prototype.mutation.proccode] = {
                prototype: prototype,
                definition: block,
                body: block.next,
                argumentNames: JSON.parse(prototype.mutation.argumentnames),
                argumentIds: JSON.parse(prototype.mutation.argumentids)
            };
        });
        this.args = [];
        this.callStack = [];
    }

    /* ------------------------------ outillage ------------------------------ */

    value(v) { return v === undefined || v === null ? '' : v; }

    number(v) {
        if (typeof v === 'number') return v;
        const text = String(this.value(v)).trim();
        if (text === '') return 0;
        const n = Number(text);
        return Number.isNaN(n) ? 0 : n;
    }

    text(v) {
        const value = this.value(v);
        if (typeof value === 'number') {
            if (Number.isInteger(value)) return String(value);
            return String(Number(value.toPrecision(14)));
        }
        return String(value);
    }

    list(name) {
        if (!this.lists[name]) this.lists[name] = [];
        return this.lists[name];
    }

    getVariable(name) { return this.variables[name]; }

    item(list, index) {
        const i = Math.trunc(this.number(index));
        const values = this.list(list);
        if (i < 1 || i > values.length) return '';
        return values[i - 1];
    }

    /** Évalue un bloc utilisé comme reporter (valeur). */
    evaluateBlock(block) {
        if (!block) return '';
        if (block.opcode === 'data_variable') return this.getVariable(block.fields.VARIABLE[0]);
        if (block.opcode === 'data_listcontents') return this.list(block.fields.LIST[0]).join(' ');
        if (block.opcode === 'sensing_answer') return this.askAnswer;
        if (block.opcode === 'data_itemoflist') {
            return this.item(block.fields.LIST[0], this.input(block, 'INDEX'));
        }
        const value = this.execute(block);
        return value === undefined ? '' : value;
    }

    evaluate(input) {
        if (input === undefined || input === null) return '';
        if (Array.isArray(input)) {
            // primitive : [type, valeur] ou [type, valeur, id]
            if (Array.isArray(input[1])) return this.evaluate(input[1]);
            if (typeof input[1] === 'object' && input[1] !== null) {
                if (input[1].opcode) return this.evaluateBlock(input[1]);
                return '';
            }
            if (input[0] === 12 || input[0] === 13) {
                return input[0] === 12 ? this.getVariable(input[1]) : this.list(input[1]).join(' ');
            }
            return input[1] === undefined ? '' : input[1];
        }
        return input;
    }

    input(block, name) {
        const entry = block.inputs[name];
        if (entry === undefined) return '';
        const first = entry[1];
        if (first === undefined || first === null) return '';
        if (Array.isArray(first)) return this.evaluate(first);
        const referenced = this.blocks[first];
        if (!referenced) return '';
        return this.evaluateBlock(referenced);
    }

    /* ---------------------------- exécution ------------------------------- */

    run(blockId) {
        if (!blockId) return;
        let id = blockId;
        while (id) {
            const block = this.blocks[id];
            if (!block) return;
            if (this.budget-- <= 0) throw new Error('budget d\'exécution dépassé');
            const stopped = this.execute(block);
            if (stopped === 'stop') return;
            id = block.next;
        }
    }

    runBranch(block, name) {
        const entry = block.inputs[name];
        if (!entry || !entry[1]) return;
        this.run(entry[1]);
    }

    execute(block) {
        const op = block.opcode;
        switch (op) {
        case 'procedures_definition':
            return undefined;
        case 'procedures_call': {
            const proccode = block.mutation.proccode;
            if (proccode === 'Echantillonne' && this.forcedTokens.length) {
                this.variables['sx jeton'] = this.forcedTokens.shift();
                return undefined;
            }
            const proc = this.procedures[proccode];
            if (!proc) throw new Error(`procédure inconnue : ${proccode}`);
            const binding = {};
            proc.argumentIds.forEach((id, index) => {
                binding[proc.argumentNames[index]] = this.input(block, id);
            });
            this.args.push(binding);
            this.callStack.push(proccode);
            this.run(proc.body);
            this.callStack.pop();
            this.args.pop();
            if (this.hooks.afterCall) this.hooks.afterCall(proccode, this);
            return undefined;
        }
        case 'argument_reporter_string_number': {
            const name = block.fields.VALUE[0];
            for (let i = this.args.length - 1; i >= 0; i--) {
                if (Object.prototype.hasOwnProperty.call(this.args[i], name)) return this.args[i][name];
            }
            return '';
        }
        case 'data_variable':
            return this.getVariable(block.fields.VARIABLE[0]);
        case 'data_setvariableto':
            this.variables[block.fields.VARIABLE[0]] = this.input(block, 'VALUE');
            return undefined;
        case 'data_changevariableby':
            this.variables[block.fields.VARIABLE[0]] =
                this.number(this.getVariable(block.fields.VARIABLE[0])) + this.number(this.input(block, 'VALUE'));
            return undefined;
        case 'data_addtolist':
            this.list(block.fields.LIST[0]).push(this.input(block, 'ITEM'));
            return undefined;
        case 'data_deletealloflist':
            this.lists[block.fields.LIST[0]] = [];
            return undefined;
        case 'data_deleteoflist': {
            const list = this.list(block.fields.LIST[0]);
            const index = Math.trunc(this.number(this.input(block, 'INDEX')));
            if (index >= 1 && index <= list.length) list.splice(index - 1, 1);
            return undefined;
        }
        case 'data_insertatlist': {
            const list = this.list(block.fields.LIST[0]);
            let index = Math.trunc(this.number(this.input(block, 'INDEX')));
            const value = this.input(block, 'ITEM');
            if (index < 1) index = 1;
            if (index > list.length + 1) list.push(value);
            else list.splice(index - 1, 0, value);
            return undefined;
        }
        case 'data_replaceitemoflist': {
            const list = this.list(block.fields.LIST[0]);
            const index = Math.trunc(this.number(this.input(block, 'INDEX')));
            const value = this.input(block, 'ITEM');
            if (index >= 1 && index <= list.length) list[index - 1] = value;
            return undefined;
        }
        case 'data_itemoflist':
            return this.item(block.fields.LIST[0], this.input(block, 'INDEX'));
        case 'data_lengthoflist':
            return this.list(block.fields.LIST[0]).length;
        case 'data_itemnumoflist': {
            const index = this.list(block.fields.LIST[0]).indexOf(this.input(block, 'ITEM'));
            return index === -1 ? 0 : index + 1;
        }
        case 'data_listcontainsitem':
            return this.list(block.fields.LIST[0]).indexOf(this.input(block, 'ITEM')) !== -1;
        case 'data_showvariable': case 'data_hidevariable':
        case 'data_showlist': case 'data_hidelist':
            return undefined;
        case 'event_broadcast':
            this.runBroadcast(this.input(block, 'BROADCAST_INPUT'));
            return undefined;
        case 'control_if':
            if (this.truthy(this.input(block, 'CONDITION'))) this.runBranch(block, 'SUBSTACK');
            return undefined;
        case 'control_if_else':
            if (this.truthy(this.input(block, 'CONDITION'))) this.runBranch(block, 'SUBSTACK');
            else this.runBranch(block, 'SUBSTACK2');
            return undefined;
        case 'control_repeat': {
            const times = Math.max(0, Math.round(this.number(this.input(block, 'TIMES'))));
            for (let i = 0; i < times; i++) {
                this.runBranch(block, 'SUBSTACK');
            }
            return undefined;
        }
        case 'control_repeat_until': {
            let guard = 0;
            while (!this.truthy(this.input(block, 'CONDITION'))) {
                if (guard++ > 20000) {
                    throw new Error('boucle infinie (repeat_until) dans ' +
                        JSON.stringify(this.callStack) + '\n  ' +
                        ['sx i', 'sx j', 'sx k', 'sx meilleur', 'sx rang', 'sx jeton', 'sx longueur']
                            .map((n) => `${n}=${JSON.stringify(this.variables[n])}`).join(' ') +
                        '\n  longueur de Octets=' + this.lists.Octets.length +
                        ' JetonsEntree=' + JSON.stringify(this.lists.JetonsEntree.slice(0, 8)));
                }
                this.runBranch(block, 'SUBSTACK');
            }
            return undefined;
        }
        case 'control_wait_until':
            return undefined;
        case 'looks_say':
            this.say = this.text(this.input(block, 'MESSAGE'));
            return undefined;
        case 'looks_sayforsecs':
            this.say = this.text(this.input(block, 'MESSAGE'));
            return undefined;
        case 'sensing_askandwait':
            return undefined;
        case 'sensing_answer':
            return this.askAnswer;
        case 'operator_add':
            return this.number(this.input(block, 'NUM1')) + this.number(this.input(block, 'NUM2'));
        case 'operator_subtract':
            return this.number(this.input(block, 'NUM1')) - this.number(this.input(block, 'NUM2'));
        case 'operator_multiply':
            return this.number(this.input(block, 'NUM1')) * this.number(this.input(block, 'NUM2'));
        case 'operator_divide':
            return this.number(this.input(block, 'NUM1')) / this.number(this.input(block, 'NUM2'));
        case 'operator_mod':
            return this.number(this.input(block, 'NUM1')) % this.number(this.input(block, 'NUM2'));
        case 'operator_round':
            return Math.round(this.number(this.input(block, 'NUM')));
        case 'operator_random': {
            const from = this.number(this.input(block, 'FROM'));
            const to = this.number(this.input(block, 'TO'));
            return from + Math.random() * (to - from);
        }
        case 'operator_gt':
            return this.compare(this.input(block, 'OPERAND1'), this.input(block, 'OPERAND2')) > 0;
        case 'operator_lt':
            return this.compare(this.input(block, 'OPERAND1'), this.input(block, 'OPERAND2')) < 0;
        case 'operator_equals':
            return this.compare(this.input(block, 'OPERAND1'), this.input(block, 'OPERAND2')) === 0;
        case 'operator_and':
            return this.truthy(this.input(block, 'OPERAND1')) && this.truthy(this.input(block, 'OPERAND2'));
        case 'operator_or':
            return this.truthy(this.input(block, 'OPERAND1')) || this.truthy(this.input(block, 'OPERAND2'));
        case 'operator_not':
            return !this.truthy(this.input(block, 'OPERAND'));
        case 'operator_join':
            return this.text(this.input(block, 'STRING1')) + this.text(this.input(block, 'STRING2'));
        case 'operator_length':
            return this.text(this.input(block, 'STRING')).length;
        case 'operator_letter_of': {
            const index = Math.trunc(this.number(this.input(block, 'LETTER')));
            const text = this.text(this.input(block, 'STRING'));
            return index >= 1 && index <= text.length ? text[index - 1] : '';
        }
        case 'operator_contains':
            return this.text(this.input(block, 'STRING1')).toLowerCase()
                .includes(this.text(this.input(block, 'STRING2')).toLowerCase());
        case 'operator_mathop': {
            const value = this.number(this.input(block, 'NUM'));
            switch (block.fields.OPERATOR[0]) {
            case 'abs': return Math.abs(value);
            case 'floor': return Math.floor(value);
            case 'ceiling': return Math.ceil(value);
            case 'sqrt': return Math.sqrt(value);
            case 'sin': return Math.sin(value * Math.PI / 180);
            case 'cos': return Math.cos(value * Math.PI / 180);
            case 'tan': return Math.tan(value * Math.PI / 180);
            case 'ln': return Math.log(value);
            case 'log': return Math.log(value) / Math.LN10;
            case 'e ^': return Math.exp(value);
            case '10 ^': return Math.pow(10, value);
            default: return 0;
            }
        }
        default:
            throw new Error(`opcode non géré par le micro-VM : ${op}`);
        }
    }

    truthy(value) {
        if (typeof value === 'boolean') return value;
        const text = this.text(value);
        if (text === '' || text === '0' || text.toLowerCase() === 'false') return false;
        return true;
    }

    compare(a, b) {
        const na = this.number(a);
        const nb = this.number(b);
        const bothNumeric = this.text(a).trim() !== '' && this.text(b).trim() !== '' &&
            !Number.isNaN(Number(this.text(a))) && !Number.isNaN(Number(this.text(b)));
        if (bothNumeric) return na === nb ? 0 : (na < nb ? -1 : 1);
        const sa = this.text(a).toLowerCase();
        const sb = this.text(b).toLowerCase();
        return sa === sb ? 0 : (sa < sb ? -1 : 1);
    }

    runBroadcast(name) {
        Object.keys(this.blocks).forEach((id) => {
            const block = this.blocks[id];
            if (block.opcode !== 'event_whenbroadcastreceived') return;
            if (block.fields.BROADCAST_OPTION[0] !== name) return;
            this.run(block.next);
        });
    }

    /** Lance le script du drapeau vert. */
    runFlag() {
        const hats = Object.keys(this.blocks).filter((id) =>
            this.blocks[id].opcode === 'event_whenflagclicked');
        hats.forEach((id) => this.run(this.blocks[id].next));
    }
}

/* ---------------------------------------------------------------------- */
/* Comparaison                                                            */
/* ---------------------------------------------------------------------- */


export {ScratchVM, readZip};
