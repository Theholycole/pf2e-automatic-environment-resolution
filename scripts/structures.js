// Doors, walls, windows and portcullises as things on the scene (the user, 2026-10-26: "post checks or track damage done to structures …
// a simple actor to represent the object for players to target"; then "make the foundry walls/doors/windows interactable … the default
// wall/door/windows behave as normal for foundry"). A structure is either a Foundry wall the GM made breakable (its Structure section in
// the wall's settings: every other wall is as Foundry has it), or a token placed on no wall. Its numbers are GM Core's for its kind, or its
// material's (GM Core's materials and the precious ones by grade: an adamantine door). To be Struck it needs a token: a PF2e hazard actor
// with its Hardness and Hit Points (one actor for each kind and material, in the "Environment: structures" folder; the tokens unlinked,
// so each keeps its own Hit Points), made on the wall when it's first wanted. PF2e's own damage takes its Hardness off. Broken, a locked
// door's lock no longer holds; destroyed, the wall stops blocking (what it blocked kept, and back when it's repaired). The cards (the core's
// src/environment/structures.js): Climb, Force Open (open, broken open, jammed) and Pick a Lock (its successes counted). The state lives on
// the wall (`flags[MODULE_ID].structure`), or on the token placed on none. Changes run on the active GM's client.

import { MODULE_ID, escapeHTML, isActiveGM } from "./foundry.js";
import { postCard } from "./cards.js";
import { FORCE_OPEN } from "../../pf2e-resolution-core/src/environment/catalog.js";
import { STRUCTURE_AC, STRUCTURE_KINDS, climbCard, defaultKind, forceOpenCard, forceOpenDC, pickLockCard, structureCondition, structureOutcome, structureStats } from "../../pf2e-resolution-core/src/environment/structures.js";

export const STRUCTURE = "structure";
const FOLDER = "Environment: structures";
export const OWN_ICONS = { wall: `modules/${MODULE_ID}/icons/wall.svg`, window: `modules/${MODULE_ID}/icons/window.svg` };
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
    "portcullis-iron": "icons/environment/settlement/castle-gatehouse.webp",
    window: OWN_ICONS.window
};
const WALL_KEYS = ["move", "sight", "light", "sound", "door", "ds"];
const DOOR = { CLOSED: 0, OPEN: 1, LOCKED: 2 };
// (A locked Foundry door with no lock picked in its settings: a simple lock.)
const DEFAULT_LOCK = "simple";

const docOf = (target) => target?.document ?? target;
const flagOf = (doc) => doc?.flags?.[MODULE_ID]?.[STRUCTURE] ?? null;
const path = (key) => `flags.${MODULE_ID}.${STRUCTURE}.${key}`;
const prefixed = (changes) => Object.fromEntries(Object.entries(changes).map(([key, value]) => [path(key), value]));

// A wall the GM made breakable. Every other wall is Foundry's as ever.
export const isStructureWall = (wall) => Boolean(flagOf(docOf(wall))?.on);
export const structureOf = (token) => flagOf(docOf(token));

// A structure: { holder (the document its state is on), wall, token, data, stats }, or null.
export function structureRecord(target) {
    const doc = docOf(target);
    if (!doc) return null;
    if (doc.documentName === "Wall") {
        const data = flagOf(doc);
        if (!data?.on) return null;
        const token = [...(doc.parent?.tokens ?? [])].find((token) => flagOf(token)?.wall === doc.id) ?? null;
        return record(doc, doc, token, data);
    }
    if (doc.documentName !== "Token") return null;
    const data = flagOf(doc);
    if (!data) return null;
    if (data.wall) {
        const wall = doc.parent?.walls?.get(data.wall);
        return wall && flagOf(wall)?.on ? record(wall, wall, doc, flagOf(wall)) : null;
    }
    return record(doc, null, doc, data);
}

function record(holder, wall, token, data) {
    const kind = data.kind || defaultKind(wall ? (wall._source ?? wall) : {});
    const stats = structureStats({ kind, material: data.material || null });
    return { holder, wall, token, data: { ...data, kind, condition: data.condition || "intact" }, stats, name: token?.name ?? stats.label };
}

// Its Hit Points now: its token's, else what the wall keeps (full when it keeps none).
export function hitPointsOf(entry) {
    const actorHP = entry?.token?.actor?.system?.attributes?.hp;
    if (actorHP) return { value: Number(actorHP.value) || 0, max: Number(actorHP.max) || entry.stats.hp };
    return { value: Number.isFinite(entry?.data?.hp) ? entry.data.hp : entry?.stats?.hp ?? 0, max: entry?.stats?.hp ?? 0 };
}

// The lock that holds it shut now, or null: a Foundry door's while it's locked (its settings' lock, else a simple one); a structure on no
// door's until it's picked or forced.
export function lockOf(entry) {
    if (!entry) return null;
    if (entry.wall?.door) return entry.wall.ds === DOOR.LOCKED ? entry.data.lock || DEFAULT_LOCK : null;
    return entry.data.lock && !entry.data.unlocked ? entry.data.lock : null;
}

// Every structure on a scene: its breakable walls and the structures placed on none.
export function sceneStructures(scene) {
    const walls = [...(scene?.walls ?? [])].filter((wall) => isStructureWall(wall)).map((wall) => structureRecord(wall));
    const free = [...(scene?.tokens ?? [])].filter((token) => flagOf(token) && !flagOf(token).wall).map((token) => structureRecord(token));
    return [...walls, ...free].filter(Boolean);
}
export const structureTokens = (scene) => [...(scene?.tokens ?? [])].filter((token) => flagOf(token));

// The hazard actor for a kind (and material): the world's, or made the first time.
async function baseActor(kind, material = null) {
    const key = `${kind}|${material ?? ""}`;
    const found = game.actors.find((actor) => actor.getFlag?.(MODULE_ID, "structureKind") === key);
    if (found) return found;
    const stats = structureStats({ kind, material });
    let folder = game.folders.find((each) => each.type === "Actor" && each.getFlag?.(MODULE_ID, "structures"));
    folder ??= await Folder.create({ name: FOLDER, type: "Actor", color: "#6f8fa8", flags: { [MODULE_ID]: { structures: true } } });
    const img = ICONS[kind] ?? OWN_ICONS.wall;
    const modes = CONST.TOKEN_DISPLAY_MODES;
    return Actor.create({
        name: stats.label,
        type: "hazard",
        img,
        folder: folder.id,
        system: {
            attributes: { ac: { value: STRUCTURE_AC }, hardness: stats.hardness, hp: { value: stats.hp, max: stats.hp }, immunities: [{ type: "object-immunities" }], emitsSound: false },
            details: { level: { value: 0 }, description: `<p>${stats.climb ? `Climb DC ${stats.climb}; ` : ""}Hardness ${stats.hardness}, HP ${stats.hp} (BT ${stats.bt})${stats.lift ? `; Force Open DC ${stats.lift} to lift` : ""}. AC ${STRUCTURE_AC}: no rule gives an unattended object one (the GM may change it).</p>` },
            traits: { value: [], rarity: "common", size: { value: "med" } }
        },
        prototypeToken: { name: stats.label, actorLink: false, width: 1, height: 1, texture: { src: img }, disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL, displayName: modes.HOVER, displayBars: modes.HOVER, bar1: { attribute: "attributes.hp" } },
        flags: { [MODULE_ID]: { structureKind: key } }
    });
}

async function tokenData(kind, material, { x, y, ac, hp = null, flag }) {
    const actor = await baseActor(kind, material);
    const size = canvas?.scene?.grid?.size ?? 100;
    const token = (await actor.getTokenDocument({ x: Math.round(x - size / 2), y: Math.round(y - size / 2) })).toObject();
    token.flags = foundry.utils.mergeObject(token.flags ?? {}, { [MODULE_ID]: { [STRUCTURE]: flag } });
    const attributes = {};
    if (Number.isFinite(Number(ac)) && ac !== null && ac !== "" && Number(ac) !== STRUCTURE_AC) attributes.ac = { value: Number(ac) };
    if (Number.isFinite(hp)) attributes.hp = { value: hp };
    if (Object.keys(attributes).length) token.delta = { system: { attributes } };
    return token;
}

// A breakable wall's token, made on its middle when it's first wanted (the GM's client).
export async function ensureToken(entry) {
    if (!entry?.wall || entry.token) return entry?.token ?? null;
    const wall = entry.wall;
    const [x, y] = [(wall.c[0] + wall.c[2]) / 2, (wall.c[1] + wall.c[3]) / 2];
    const hp = Number.isFinite(entry.data.hp) ? entry.data.hp : null;
    const [token] = await wall.parent.createEmbeddedDocuments("Token", [await tokenData(entry.data.kind, entry.data.material || null, { x, y, ac: entry.data.ac, hp, flag: { wall: wall.id } })]);
    return token;
}

// Place a structure: on each wall selected on the Walls layer (made breakable, with a token to target), else one token at the middle of
// the view. { ac, lock, material }: a lock on a door locks it.
export async function placeStructures(scene, kind, { ac = STRUCTURE_AC, lock = null, material = null } = {}) {
    if (!STRUCTURE_KINDS[kind] || !scene) return [];
    const walls = canvas?.scene === scene ? [...(canvas.walls?.controlled ?? [])].map((wall) => wall.document) : [];
    const state = { lock: lock || null, material: material || null, ac: Number(ac) === STRUCTURE_AC ? null : Number(ac) || null, successes: 0, unlocked: false, jammed: false, condition: "intact", hp: null, saved: null };
    if (!walls.length) {
        const [x, y] = [canvas?.stage?.pivot?.x ?? scene.dimensions.width / 2, canvas?.stage?.pivot?.y ?? scene.dimensions.height / 2];
        return scene.createEmbeddedDocuments("Token", [await tokenData(kind, state.material, { x, y, ac: state.ac, flag: { kind, ...state, wall: null } })]);
    }
    const tokens = [];
    for (const wall of walls) {
        // (Its old token goes: the new kind or material makes its own.)
        const old = structureRecord(wall)?.token;
        if (old) await old.delete();
        await wall.update({ ...prefixed({ on: true, kind, ...state }), ...(wall.door && state.lock && wall.ds !== DOOR.LOCKED ? { ds: DOOR.LOCKED } : {}) });
        tokens.push(await ensureToken(structureRecord(wall)));
    }
    return tokens.filter(Boolean);
}

// (One change at a time for each structure.)
const chains = new Map();
function inTurn(key, task) {
    const next = (chains.get(key) ?? Promise.resolve()).then(task);
    chains.set(key, next.catch(() => {}));
    return next;
}

// Its token's Hit Points changed (PF2e's updateActor for its token's actor): broken, destroyed or repaired, and its wall with it.
export function onStructureActor(actor, change) {
    const token = actor?.token;
    if (!isActiveGM() || !token || !flagOf(token) || !foundry.utils.hasProperty(change ?? {}, "system.attributes.hp")) return;
    inTurn(token.uuid, async () => {
        const entry = structureRecord(token);
        if (entry) await settle(entry, hitPointsOf(entry).value);
    }).catch((error) => console.warn(`${MODULE_ID} | ${token.name}:`, error));
}

// Its condition from these Hit Points, kept on it, its token and its wall.
async function settle(entry, hp) {
    const { holder, wall, token, data, stats } = entry;
    const condition = structureCondition(hp, stats.bt);
    const changes = {};
    if (holder === wall) changes.hp = hp >= stats.hp ? null : hp;
    if (condition !== data.condition) {
        const actor = token?.actor;
        const broken = condition !== "intact";
        if (actor) {
            if (broken && !actor.hasCondition?.("broken")) await actor.increaseCondition?.("broken");
            else if (!broken && actor.hasCondition?.("broken")) await actor.decreaseCondition?.("broken", { forceRemove: true });
            try {
                await actor.toggleStatusEffect?.("dead", { active: condition === "destroyed", overlay: true });
            } catch (error) {
                console.warn(`${MODULE_ID} | the destroyed marker on ${token.name}:`, error);
            }
        }
        const wasLocked = Boolean(wall?.door && wall.ds === DOOR.LOCKED);
        let saved = data.saved ?? null;
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
        Object.assign(changes, { condition, saved });
        const said = { broken: `${entry.name} is broken${wasLocked ? ": its lock no longer holds" : ""}.`, destroyed: `${entry.name} is destroyed${wall ? ": it no longer blocks the way" : ""}.`, intact: `${entry.name} is whole again${data.saved ? ": it blocks the way again" : ""}.` }[condition];
        await ChatMessage.create({ content: `<div class="pf2e-env-card"><header><strong>${escapeHTML(entry.name)}</strong></header><p>${escapeHTML(said)}</p></div>`, speaker: { alias: "Environment" } });
    }
    const current = Object.fromEntries(Object.keys(changes).map((key) => [key, data[key] ?? null]));
    if (JSON.stringify(current) !== JSON.stringify(changes)) await holder.update(prefixed(changes));
}

// A card's degree on its structure (cards.js applyRow): opened, broken open, jammed, a success toward its lock.
export async function applyStructure(uuid, effect) {
    const doc = uuid ? await fromUuid(uuid).catch(() => null) : null;
    const entry = structureRecord(doc);
    if (!entry) return;
    await inTurn(entry.holder.uuid, async () => {
        const fresh = structureRecord(doc);
        const lock = lockOf(fresh);
        const { next, opens, breaks, unlocks } = structureOutcome({ lock, successes: fresh.data.successes ?? 0, unlocked: !lock }, effect);
        // (A Foundry door's lock is its door's state: opened, it starts afresh if it's locked again.)
        if (unlocks && fresh.wall?.door) Object.assign(next, { successes: 0, unlocked: false });
        if (Object.keys(next).length) await fresh.holder.update(prefixed(next));
        const wall = fresh.wall;
        if (wall?.door) {
            if (opens) await wall.update({ ds: DOOR.OPEN });
            else if (unlocks && wall.ds === DOOR.LOCKED) await wall.update({ ds: DOOR.CLOSED });
        }
        if (!breaks) return;
        const { value } = hitPointsOf(fresh);
        if (value <= fresh.stats.bt) return;
        if (fresh.token?.actor) await fresh.token.actor.update({ "system.attributes.hp.value": fresh.stats.bt });
        else await settle(structureRecord(doc), fresh.stats.bt);
    });
}

// Whole again: its Hit Points back to full (the wall back with them).
export async function repairStructure(target) {
    const entry = structureRecord(target);
    if (!entry) return;
    if (entry.token?.actor) await entry.token.actor.update({ "system.attributes.hp.value": hitPointsOf(entry).max });
    else await inTurn(entry.holder.uuid, () => settle(structureRecord(target), entry.stats.hp));
}

// A breakable wall gone: its token with it.
export async function onWallDeleted(wall) {
    if (!isActiveGM() || !flagOf(wall)?.on) return;
    const tokens = [...(wall.parent?.tokens ?? [])].filter((token) => flagOf(token)?.wall === wall.id);
    if (tokens.length) await wall.parent.deleteEmbeddedDocuments("Token", tokens.map((token) => token.id));
}

// --- Cards: for the creatures that try it. ---

// The creatures trying it: the controlled tokens that aren't structures (a player's own).
export const tryingCreatures = () => (canvas?.tokens?.controlled ?? []).filter((token) => !flagOf(token) && (game.user.isGM || token.actor?.isOwner));

// how: "climb" | "force" | "lock". target: a structure (its wall or token), or none: kind is then a STRUCTURE_KINDS key, or for forcing
// open a FORCE_OPEN key (a stuck door, bars).
export async function postStructureCard(kind, how, { target = null, token = null, dc = null, height = 0, tokens = null } = {}) {
    const entry = structureRecord(target ?? token);
    const kindEntry = STRUCTURE_KINDS[entry?.data.kind ?? kind];
    const stuck = entry?.data.stuck || (FORCE_OPEN[kind] && !STRUCTURE_KINDS[kind] ? kind : "stuck");
    const label = entry?.name ?? kindEntry?.label ?? FORCE_OPEN[stuck]?.label ?? "Structure";
    const structure = entry?.holder?.uuid ?? null;
    const lock = lockOf(entry);
    const card = how === "climb" ? ((dc ?? entry?.stats.climb ?? kindEntry?.climb) ? climbCard({ label, dc: dc ?? entry?.stats.climb ?? kindEntry.climb, height }) : null)
        : how === "force" ? forceOpenCard({ label, dc: dc ?? forceOpenDC(entry?.data.kind ?? kind, { lock, stuck }), jammed: Boolean(entry?.data.jammed), structure })
        : how === "lock" ? pickLockCard({ label, lock, successes: entry?.data.successes, structure })
        : null;
    if (!card) {
        ui.notifications.warn(how === "climb" ? `${label} has no Climb DC.` : `${label} has no lock to pick.`);
        return null;
    }
    const creatures = tokens ?? tryingCreatures();
    if (!creatures.length) {
        ui.notifications.warn("Select the creatures that try it (not the structure).");
        return null;
    }
    return postCard(card, creatures);
}

// --- A player's Strike: the wall's token made by the GM, then targeted on the player's client. ---

const awaiting = new Set();
export async function targetStructure(wall) {
    const entry = structureRecord(wall);
    if (!entry) return;
    if (entry.token?.object) return entry.token.object.setTarget(true, { releaseOthers: true });
    if (game.user.isGM) {
        const token = await ensureToken(entry);
        setTimeout(() => token?.object?.setTarget(true, { releaseOthers: true }), 300);
        return;
    }
    awaiting.add(entry.wall.id);
    await ChatMessage.create({
        content: `<div class="pf2e-env-card"><p>${escapeHTML(game.user.name)} targets ${escapeHTML(entry.name)}.</p></div>`,
        speaker: { alias: "Environment" },
        whisper: game.users.filter((user) => user.isGM).map((user) => user.id),
        flags: { [MODULE_ID]: { structureRequest: { wall: entry.wall.uuid } } }
    });
}

// The GM's client: a player's request for a wall's token.
export async function onStructureRequest(message) {
    const request = message.flags?.[MODULE_ID]?.structureRequest;
    if (!request || !isActiveGM()) return;
    const wall = await fromUuid(request.wall).catch(() => null);
    const entry = structureRecord(wall);
    if (entry) await inTurn(entry.holder.uuid, () => ensureToken(structureRecord(wall)));
    await message.delete();
}

// The player's client: its token made, targeted.
export function onStructureToken(token) {
    const wallId = flagOf(token)?.wall;
    if (!wallId || !awaiting.has(wallId)) return;
    awaiting.delete(wallId);
    setTimeout(() => token.object?.setTarget(true, { releaseOthers: true }), 300);
}
