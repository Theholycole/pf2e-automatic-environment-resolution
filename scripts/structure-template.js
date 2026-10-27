// A structure from a template (2026-10-27, for the item module's Warding Escutcheon and Instant Fortress): breakable walls round a point
// (a square room) or along a line, with a door that can be locked, of a kind or material or the item's own numbers, the creatures in its
// space pushed out, and gone again on command. Its walls are ordinary breakable walls (scripts/structures.js): Strike them, Force Open
// or pick the door's lock, climb them. The layout and the push are the core's (src/environment/structures.js). Run on a GM's client.

import { MODULE_ID } from "./foundry.js";
import { STRUCTURE } from "./structures.js";
import { STRUCTURE_KINDS, pushedOut, structureLayout } from "../../pf2e-resolution-core/src/environment/structures.js";

const NORMAL = 20;
const DOOR = { NONE: 0, DOOR: 1 };
const STATE = { CLOSED: 0, LOCKED: 2 };

// Its id on each of its walls: flags[MODULE_ID].structure.placed = { id, name, source }.
const placedOf = (wall) => wall?.flags?.[MODULE_ID]?.[STRUCTURE]?.placed ?? null;
const randomId = () => foundry.utils.randomID();

// Each part's state (a wall's or its door's): { kind, material, stats, lock, lockDC, lockSuccesses, forceDC, height }.
function partState(part, defaults) {
    const lock = part.lock && typeof part.lock === "object" ? part.lock : part.lock ? { key: part.lock } : null;
    return {
        on: true,
        kind: STRUCTURE_KINDS[part.kind] ? part.kind : defaults.kind,
        material: part.material ?? null,
        stats: part.stats ?? null,
        lock: lock ? lock.key ?? "custom" : null,
        lockDC: Number(lock?.dc) > 0 ? Number(lock.dc) : null,
        lockSuccesses: Number(lock?.successes) > 0 ? Number(lock.successes) : null,
        forceDC: Number(part.forceOpen) > 0 ? Number(part.forceOpen) : null,
        stuck: "stuck",
        ac: null,
        successes: 0,
        unlocked: false,
        jammed: false,
        condition: "intact",
        hp: null,
        saved: null
    };
}

/**
 * Place it. template: {
 *   name, at: { x, y } (its middle, pixels) or token (its middle), shape: "square" | "line", feet, rotation? (a line's: 0 east–west, 90
 *   north–south), height? (feet, kept for its Climb), kind? (a wall kind, "wall-masonry" when none), material?, stats? { hardness, hp, bt },
 *   door?: { side?, feet?, kind? ("door-iron" when none), material?, stats?, lock? (a GM Core lock key, or { dc, successes }), forceOpen?
 *   (its own Force Open DC), locked? (true when it has a lock) },
 *   pushOut? (true, or { except: [token ids] }; a square's default: true), source? { actorUuid, itemUuid, name }
 * }. → { id, walls: [wall ids], door: wall id | null, pushed: [token ids] }.
 */
export async function placeStructure(scene, template = {}) {
    if (!game.user.isGM) throw new Error("Only a GM places a structure.");
    if (!scene) throw new Error("No scene to place it on.");
    const at = template.token ? centreOf(template.token, scene) : template.at;
    if (!Number.isFinite(Number(at?.x)) || !Number.isFinite(Number(at?.y))) throw new Error("A structure needs a point to stand at (at { x, y } or a token).");
    const grid = { size: scene.grid.size, distance: scene.grid.distance };
    const layout = structureLayout({ ...template, at }, grid);
    const id = randomId();
    const placed = { id, name: template.name ?? "Structure", source: template.source ?? null };
    const height = Number(template.height) > 0 ? Number(template.height) : null;
    const wallState = partState(template, { kind: "wall-masonry" });
    const doorState = template.door ? partState({ kind: "door-iron", ...template.door }, { kind: "door-iron" }) : null;
    const data = layout.walls.map((wall) => {
        const state = wall.door && doorState ? doorState : wallState;
        const locked = wall.door && doorState && (template.door.locked ?? Boolean(doorState.lock));
        return {
            c: wall.c.map((value) => Math.round(value)),
            move: NORMAL,
            sight: NORMAL,
            light: NORMAL,
            sound: NORMAL,
            door: wall.door && doorState ? DOOR.DOOR : DOOR.NONE,
            ds: locked ? STATE.LOCKED : STATE.CLOSED,
            flags: { [MODULE_ID]: { [STRUCTURE]: { ...state, name: wall.door && doorState ? `${placed.name}: door` : `${placed.name}: ${wall.side === "line" ? "wall" : `${wall.side} wall`}`, height, placed } } }
        };
    });
    // (The creatures in its space out first, so no wall is made through one.)
    const push = template.pushOut ?? template.shape !== "line";
    const except = new Set(push?.except ?? []);
    const tokens = [...scene.tokens].filter((token) => !except.has(token.id) && !token.flags?.[MODULE_ID]?.[STRUCTURE]);
    const moves = push ? pushedOut(tokens.map((token) => ({ id: token.id, x: token.x, y: token.y, width: token.width, height: token.height })), layout.inside, grid) : [];
    if (moves.length) await scene.updateEmbeddedDocuments("Token", moves.map(({ id: tokenId, x, y }) => ({ _id: tokenId, x, y })), { teleport: true, animate: false, [MODULE_ID]: { forced: true } });
    const made = await scene.createEmbeddedDocuments("Wall", data);
    const door = made.find((wall) => wall.door === DOOR.DOOR) ?? null;
    return { id, walls: made.map((wall) => wall.id), door: door?.id ?? null, pushed: moves.map((move) => move.id) };
}

// Its middle, from a token (pixels).
function centreOf(token, scene) {
    const doc = token?.document ?? token;
    const size = scene.grid.size;
    return { x: doc.x + ((Number(doc.width) || 1) * size) / 2, y: doc.y + ((Number(doc.height) || 1) * size) / 2 };
}

// The structures placed from templates on a scene: [{ id, name, source, walls: [wall ids] }].
export function placedStructures(scene) {
    const found = new Map();
    for (const wall of scene?.walls ?? []) {
        const placed = placedOf(wall);
        if (!placed?.id) continue;
        if (!found.has(placed.id)) found.set(placed.id, { ...placed, walls: [] });
        found.get(placed.id).walls.push(wall.id);
    }
    return [...found.values()];
}

// Gone on command: its walls (and with them their tokens, scripts/structures.js onWallDeleted). → the walls removed.
export async function removeStructure(scene, id) {
    if (!game.user.isGM) throw new Error("Only a GM removes a structure.");
    const walls = [...(scene?.walls ?? [])].filter((wall) => placedOf(wall)?.id === id).map((wall) => wall.id);
    if (walls.length) await scene.deleteEmbeddedDocuments("Wall", walls);
    return walls;
}
