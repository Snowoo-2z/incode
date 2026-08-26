/**
 * @fileoverview Stable, compact block addressing for targeted edits.
 *
 * The AI needs a way to point at ONE existing block ("change just the speed of
 * the ball") without re-sending the whole sprite. Raw VM block ids are 20-char
 * random strings — unreadable and token-heavy. Instead we use human-readable
 * *path addresses* that are re-derived from the workspace on every read:
 *
 *   <scriptIndex>/<pos>[.<pos>...]
 *
 *   - scriptIndex : 1-based index of the top-level script (deterministic order)
 *   - pos         : 1-based position of a statement inside its stack
 *   - descending into a C-block's body just appends another ".pos"
 *   - the else-branch (SUBSTACK2) is marked with "~2" on the C-block segment
 *
 * Examples (for a script "when flag / goto / forever [ move / if [...] ]"):
 *   1/1      -> when flag clicked
 *   1/3      -> forever
 *   1/3.1    -> move (first block inside forever)
 *   1/3.2    -> the if inside forever
 *   1/3.2.1  -> first block inside that if
 *   1/3.2~2.1 -> first block inside that if's ELSE branch
 *
 * The SAME walker powers both the project summary (so the AI sees each address)
 * and the editor (so it can resolve an address back to a real block id). That
 * shared source of truth is what keeps them from drifting apart.
 */

/** Branch input names, indexed by branch number (1 -> SUBSTACK, 2 -> SUBSTACK2). */
const BRANCH_INPUTS = {1: 'SUBSTACK', 2: 'SUBSTACK2'};

/**
 * Returns the target's top-level (script head) block ids in a deterministic
 * order. Uses the VM's own `_scripts` array when available (insertion order),
 * falling back to the block map keys.
 * @param {object} target VM target
 * @returns {Array<string>} ordered top-level block ids
 */
const orderedTopBlockIds = target => {
    if (!target || !target.blocks) return [];
    const container = target.blocks;
    const blocksMap = container._blocks || {};
    if (Array.isArray(container._scripts) && container._scripts.length) {
        // Keep only ids that still exist and are non-shadow top-level blocks.
        return container._scripts.filter(id => blocksMap[id] && !blocksMap[id].shadow);
    }
    return Object.keys(blocksMap).filter(id => blocksMap[id].topLevel && !blocksMap[id].shadow);
};

/**
 * Collects the ordered statement block ids of a stack (following `next`).
 * @param {object} blocksMap target block map
 * @param {?string} headId id of the first block of the stack
 * @returns {Array<string>} ordered block ids
 */
const stackIds = (blocksMap, headId) => {
    const ids = [];
    let curr = headId;
    while (curr && blocksMap[curr]) {
        ids.push(curr);
        curr = blocksMap[curr].next;
    }
    return ids;
};

/**
 * The branch head id (first block) of a C-block's branch.
 * @param {object} block C-block
 * @param {number} branch branch number (1 or 2)
 * @returns {?string} head block id or null
 */
const branchHeadId = (block, branch) => {
    const inputName = BRANCH_INPUTS[branch] || 'SUBSTACK';
    const input = block && block.inputs && block.inputs[inputName];
    return input ? input.block : null;
};

/**
 * Walks every statement block of a script, invoking `visit` with rich context.
 * Descends into SUBSTACK / SUBSTACK2 branches, extending the path.
 * @param {object} blocksMap target block map
 * @param {string} headId script head id
 * @param {number} scriptIndex 1-based script index
 * @param {function(object): void} visit visitor
 */
const walkScript = (blocksMap, headId, scriptIndex, visit) => {
    const walkStack = (stackHead, pathPrefix, depth) => {
        const ids = stackIds(blocksMap, stackHead);
        ids.forEach((id, i) => {
            const block = blocksMap[id];
            const pos = i + 1;
            const path = pathPrefix ? `${pathPrefix}.${pos}` : String(pos);
            visit({id, block, scriptIndex, path, depth, address: `${scriptIndex}/${path}`});
            // Descend into branches.
            for (const branch of [1, 2]) {
                const head = branchHeadId(block, branch);
                if (head) {
                    const segMarker = branch === 2 ? `${path}~2` : path;
                    walkStack(head, segMarker, depth + 1);
                }
            }
        });
    };
    walkStack(headId, '', 0);
};

/**
 * Parses one path segment "3" or "3~2" into {index, branch}.
 * @param {string} seg segment
 * @returns {?{index: number, branch: number}} parsed segment
 */
const parseSegment = seg => {
    const trimmed = String(seg).trim();
    const m = trimmed.match(/^(\d+)(?:~(\d+))?$/);
    if (!m) return null;
    return {index: Number(m[1]), branch: m[2] ? Number(m[2]) : 1};
};

/**
 * Resolves a path within a script head to a real block id.
 * The branch marker on a segment says which branch to descend into AFTER
 * selecting that block (so "3~2.1" = block 3, then its else-branch, block 1).
 * @param {object} blocksMap target block map
 * @param {string} headId script head id
 * @param {string} pathStr dotted path, e.g. "3.2" or "3~2.1"
 * @returns {?string} resolved block id or null
 */
const resolvePath = (blocksMap, headId, pathStr) => {
    const segments = String(pathStr)
        .split('.')
        .map(s => s.trim())
        .filter(Boolean);
    if (!segments.length) return null;

    let stackHead = headId;
    let resolvedId = null;

    for (let i = 0; i < segments.length; i++) {
        const parsed = parseSegment(segments[i]);
        if (!parsed) return null;
        const ids = stackIds(blocksMap, stackHead);
        const id = ids[parsed.index - 1];
        if (!id) return null;
        resolvedId = id;
        if (i < segments.length - 1) {
            // Descend into the requested branch for the next segment.
            stackHead = branchHeadId(blocksMap[id], parsed.branch);
            if (!stackHead) return null;
        }
    }
    return resolvedId;
};

/**
 * Resolves a full address to a block id and its script head.
 * Accepts "<scriptIndex>/<path>" (path may itself contain "/" or "." — we split
 * on the FIRST slash only).
 * @param {object} target VM target
 * @param {(string|number)} scriptIndexOrAddress script index, or a full address
 * @param {string} [maybePath] path when the first arg is only the script index
 * @returns {?{blockId: string, scriptHeadId: string, scriptIndex: number, path: string}} resolution
 */
const resolveAddress = (target, scriptIndexOrAddress, maybePath) => {
    if (!target || !target.blocks) return null;
    const blocksMap = target.blocks._blocks || {};

    let scriptIndex;
    let path;
    if (typeof maybePath === 'undefined' || maybePath === null || maybePath === '') {
        // Combined "1/3.2" form.
        const str = String(scriptIndexOrAddress);
        const slash = str.indexOf('/');
        if (slash === -1) return null;
        scriptIndex = Number(str.slice(0, slash));
        path = str.slice(slash + 1);
    } else {
        scriptIndex = Number(scriptIndexOrAddress);
        path = String(maybePath);
    }
    if (!scriptIndex || isNaN(scriptIndex)) return null;

    const topIds = orderedTopBlockIds(target);
    const scriptHeadId = topIds[scriptIndex - 1];
    if (!scriptHeadId) return null;

    const blockId = resolvePath(blocksMap, scriptHeadId, path);
    if (!blockId) return null;
    return {blockId, scriptHeadId, scriptIndex, path, address: `${scriptIndex}/${path}`};
};

/**
 * Builds an addressed, flat listing of all statement blocks of a target, using
 * a one-line renderer for each block. Returns an array of scripts, each with a
 * list of {address, path, depth, text, opcode, blockId} entries.
 * @param {object} target VM target
 * @param {function(object, object): string} renderLine renders one block to text
 * @returns {Array<object>} scripts listing
 */
const listAddressedScripts = (target, renderLine) => {
    if (!target || !target.blocks) return [];
    const blocksMap = target.blocks._blocks || {};
    const topIds = orderedTopBlockIds(target);
    return topIds.map((headId, idx) => {
        const scriptIndex = idx + 1;
        const head = blocksMap[headId];
        const entries = [];
        walkScript(blocksMap, headId, scriptIndex, info => {
            entries.push({
                address: info.address,
                path: info.path,
                depth: info.depth,
                blockId: info.id,
                opcode: info.block.opcode,
                text: renderLine(info.block, blocksMap)
            });
        });
        return {
            scriptIndex,
            x: Math.round((head && head.x) || 0),
            y: Math.round((head && head.y) || 0),
            entries
        };
    });
};

export {
    orderedTopBlockIds,
    stackIds,
    branchHeadId,
    walkScript,
    resolvePath,
    resolveAddress,
    listAddressedScripts,
    parseSegment,
    BRANCH_INPUTS
};
