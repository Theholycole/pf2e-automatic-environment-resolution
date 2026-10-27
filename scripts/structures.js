// Doors, walls and portcullises as things on the scene (the user, 2026-10-26: "post checks or track damage done to structures … a simple
// actor to represent the object for players to target"). A structure is a token of a PF2e hazard actor with GM Core's Hardness and Hit
// Points for it (one actor for each kind, in the "Environment: structures" folder; its tokens unlinked, so each keeps its own Hit Points):
// players target it and Strike it, and PF2e's own damage takes its Hardness off. Placed on the walls the GM selected, it follows its
// wall: broken, a locked door's lock no longer holds; destroyed, the wall stops blocking (what it blocked kept, and back when it's
// repaired). The cards (the core's src/environment/structures.js): Climb, Force Open (open, broken open, jammed) and Pick a Lock (its
// successes counted). Run on the active GM's client, the cards by the GM.

import { MODULE_ID, escapeHTML, isActiveGM } from "./foundry.js";
import { postCard } from "./cards.js";
import { FORCE_OPEN, LOCKS, STRUCTURES } from "../../pf2e-resolution-core/src/environment/catalog.js";
import { STRUCTURE_AC, climbCard, forceOpenCard, forceOpenDC, pickLockCard, structureCondition, structureOutcome } from "../../pf2e-resolution-core/src/environment/structures.js";

export const STRUCTURE = "structure";
const FOLDER = "Environment: structures";
const ICONS = {
    "door-wood": "icons/svg/door-closed.svg",
    "door-stone": "icons/svg/door-steel.svg",
    "door-reinforced": "icons/svg/door-closed.svg",
    "door-iron": "icons/svg/door-steel.svg",
    "wall-crumbling": "icons/environment/wilderness/wall-ruins.webp",
    "wall-slats": "icons/environment/settlement/fence-wooden-picket.webp",
    "wall-masonry": "icons/environment/settlement/fence-stone-brick.webp",
    "wall-hewn": "icons/environment/settlement/city-wall.webp",
    "wall-iron": "icons/environment/settlement/city-wall.webp",
    "portcullis-wood": "icons/environment/settlement/castle-gatehouse.webp",
    "portcullis-iron": "icons/environment/settlement/castle-gatehouse.webp"
};
const WALL_KEYS = ["move", "sight", "light", "sound", "door", "ds"];
const DOOR = { CLOSED: 0, OPEN: 1, LOCKED: 2 };

export const structureOf = (token) => (token?.document ?? token)?.flags?.[MODULE_ID]?.[STRUCTURE] ?? null;
export const structureTokens = (scene) => [...(scene?.tokens ?? [])].filter((token) => structureOf(token));
const wallOf = (tokenDoc, flag = structureOf(tokenDoc)) => (flag?.wall ? tokenDoc.parent?.walls?.get(flag.wall) ?? null : null);

// The hazard actor for a kind of structure: the world's, or made the first time.
async function baseActor(kind) {
    const found = game.actors.find((actor) => actor.getFlag?.(MODULE_ID, "structureKind") === kind);
    if (found) return found;
    const entry = STRUCTURES[kind];
    let folder = game.folders.find((each) => each.type === "Actor" && each.getFlag?.(MODULE_ID, "structures"));
    folder ??= await Folder.create({ name: FOLDER, type: "Actor", color: "#6f8fa8", flags: { [MODULE_ID]: { structures: true } } });
    const img = ICONS[kind] ?? "icons/svg/door-closed.svg";
    const modes = CONST.TOKEN_DISPLAY_MODES;
    return Actor.create({
        name: entry.label,
        type: "hazard",
        img,
        folder: folder.id,
        system: {
            attributes: { ac: { value: STRUCTURE_AC }, hardness: entry.hardness, hp: { value: entry.hp, max: entry.hp }, immunities: [{ type: "object-immunities" }], emitsSound: false },
            details: { level: { value: 0 }, description: `<p>Climb DC ${entry.climb}; Hardness ${entry.hardness}, HP ${entry.hp} (BT ${entry.bt})${entry.force ? `; Force Open DC ${entry.force} to lift` : ""}. AC ${STRUCTURE_AC}: no rule gives an unattended object one (the GM may change it).</p>` },
            traits: { value: [], rarity: "common", size: { value: "med" } }
        },
        prototypeToken: { name: entry.label, actorLink: false, width: 1, height: 1, texture: { src: img }, disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL, displayName: modes.HOVER, displayBars: modes.HOVER, bar1: { attribute: "attributes.hp" } },
        flags: { [MODULE_ID]: { structureKind: kind } }
    });
}

// Place a structure: one on each wall selected on the Walls layer (at its middle, following it), else one at the middle of the view.
// { ac, lock }: a lock on a door locks it.
export async function placeStructures(scene, kind, { ac = STRUCTURE_AC, lock = null } = {}) {
    const entry = STRUCTURES[kind];
    if (!entry || !scene) return [];
    const actor = await baseActor(kind);
    const walls = canvas?.scene === scene ? [...(canvas.walls?.controlled ?? [])].map((wall) => wall.document) : [];
    const size = scene.grid?.size ?? 100;
    const spots = walls.length ? walls.map((wall) => ({ wall, x: (wall.c[0] + wall.c[2]) / 2, y: (wall.c[1] + wall.c[3]) / 2 })) : [{ wall: null, x: canvas?.stage?.pivot?.x ?? scene.dimensions.width / 2, y: canvas?.stage?.pivot?.y ?? scene.dimensions.height / 2 }];
    const locked = LOCKS[lock] ? lock : null;
    const data = [];
    for (const spot of spots) {
        const token = (await actor.getTokenDocument({ x: Math.round(spot.x - size / 2), y: Math.round(spot.y - size / 2) })).toObject();
        token.flags = foundry.utils.mergeObject(token.flags ?? {}, { [MODULE_ID]: { [STRUCTURE]: { kind, bt: entry.bt, lock: locked, successes: 0, unlocked: false, jammed: false, wall: spot.wall?.id ?? null, saved: null, condition: "intact" } } });
        if (Number(ac) !== STRUCTURE_AC && Number.isFinite(Number(ac))) token.delta = { system: { attributes: { ac: { value: Number(ac) } } } };
        data.push(token);
    }
    const created = await scene.createEmbeddedDocuments("Token", data);
    for (const spot of spots) if (spot.wall?.door && locked && spot.wall.ds !== DOOR.LOCKED) await spot.wall.update({ ds: DOOR.LOCKED });
    return created;
}

// (One change at a time for each structure.)
const chains = new Map();
function inTurn(key, task) {
    const next = (chains.get(key) ?? Promise.resolve()).then(task);
    chains.set(key, next.catch(() => {}));
    return next;
}

// Its Hit Points changed (PF2e's updateActor for its token's actor): broken, destroyed or repaired, and its wall with it.
export function onStructureActor(actor, change) {
    const token = actor?.token;
    if (!isActiveGM() || !token || !structureOf(token) || !foundry.utils.hasProperty(change ?? {}, "system.attributes.hp")) return;
    inTurn(token.uuid, () => syncStructure(token)).catch((error) => console.warn(`${MODULE_ID} | ${token.name}:`, error));
}

async function syncStructure(token) {
    const flag = structureOf(token);
    const actor = token.actor;
    if (!flag || !actor) return;
    const condition = structureCondition(actor.system?.attributes?.hp?.value, flag.bt);
    if (condition === flag.condition) return;
    const broken = condition !== "intact";
    if (broken && !actor.hasCondition?.("broken")) await actor.increaseCondition?.("broken");
    else if (!broken && actor.hasCondition?.("broken")) await actor.decreaseCondition?.("broken", { forceRemove: true });
    try {
        await actor.toggleStatusEffect?.("dead", { active: condition === "destroyed", overlay: true });
    } catch (error) {
        console.warn(`${MODULE_ID} | the destroyed marker on ${token.name}:`, error);
    }
    const wall = wallOf(token, flag);
    const wasLocked = Boolean(wall?.door && wall.ds === DOOR.LOCKED);
    let saved = flag.saved;
    if (wall) {
        if (condition === "destroyed" && !saved) {
            saved = Object.fromEntries(WALL_KEYS.map((key) => [key, wall[key]]));
            await wall.update({ move: 0, sight: 0, light: 0, sound: 0, door: 0 });
        } else if (condition !== "destroyed" && saved) {
            await wall.update(saved);
            saved = null;
        }
        if (condition === "broken" && wall.door && wall.ds === DOOR.LOCKED) await wall.update({ ds: DOOR.CLOSED });
    }
    await token.update({ [`flags.${MODULE_ID}.${STRUCTURE}.condition`]: condition, [`flags.${MODULE_ID}.${STRUCTURE}.saved`]: saved });
    const said = { broken: `${token.name} is broken${wasLocked ? ": its lock no longer holds" : ""}.`, destroyed: `${token.name} is destroyed${wall ? ": it no longer blocks the way" : ""}.`, intact: `${token.name} is whole again${flag.saved ? ": it blocks the way again" : ""}.` }[condition];
    await ChatMessage.create({ content: `<div class="pf2e-env-card"><header><strong>${escapeHTML(token.name)}</strong></header><p>${escapeHTML(said)}</p></div>`, speaker: { alias: "Environment" } });
}

// A card's degree on its structure (cards.js applyRow): opened, broken open, jammed, a success toward its lock.
export async function applyStructure(uuid, effect) {
    const token = uuid ? await fromUuid(uuid).catch(() => null) : null;
    const flag = structureOf(token);
    if (!flag) return;
    const { next, opens, breaks, unlocks } = structureOutcome(flag, effect);
    if (Object.keys(next).length) await token.update(Object.fromEntries(Object.entries(next).map(([key, value]) => [`flags.${MODULE_ID}.${STRUCTURE}.${key}`, value])));
    const wall = wallOf(token, flag);
    if (wall?.door) {
        if (opens) await wall.update({ ds: DOOR.OPEN });
        else if (unlocks && wall.ds === DOOR.LOCKED) await wall.update({ ds: DOOR.CLOSED });
    }
    if (breaks && (Number(token.actor?.system?.attributes?.hp?.value) || 0) > flag.bt) await token.actor.update({ "system.attributes.hp.value": flag.bt });
}

// --- The GM window's posts: for the selected creatures (not the structures). ---

const creatures = () => (canvas?.tokens?.controlled ?? []).filter((token) => !structureOf(token));

// how: "climb" | "force" | "lock"; kind: a STRUCTURES key, or for forcing open with no structure a FORCE_OPEN key (a stuck door, bars).
export async function postStructureCard(kind, how, { token = null, dc = null, height = 0 } = {}) {
    const flag = token ? structureOf(token) : null;
    const entry = STRUCTURES[flag?.kind ?? kind];
    const stuck = FORCE_OPEN[kind] && !entry ? kind : "stuck";
    const label = token?.name ?? entry?.label ?? FORCE_OPEN[stuck].label;
    const structure = token ? (token.document ?? token).uuid : null;
    const card = how === "climb" ? climbCard({ label, dc: dc ?? entry?.climb, height })
        : how === "force" ? forceOpenCard({ label, dc: dc ?? forceOpenDC(flag?.kind ?? kind, { lock: flag && !flag.unlocked ? flag.lock : null, stuck }), jammed: Boolean(flag?.jammed), structure })
        : how === "lock" ? pickLockCard({ label, lock: flag?.lock, successes: flag?.successes, structure })
        : null;
    if (!card) return null;
    const tokens = creatures();
    if (!tokens.length) {
        ui.notifications.warn("Select the creatures that try it (not the structure).");
        return null;
    }
    return postCard(card, tokens);
}

// Whole again: its Hit Points back to full (the wall back with them).
export async function repairStructure(token) {
    const actor = (token?.document ?? token)?.actor;
    const max = Number(actor?.system?.attributes?.hp?.max) || 0;
    if (actor && max) await actor.update({ "system.attributes.hp.value": max });
}
