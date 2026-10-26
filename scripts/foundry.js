// Foundry and PF2e glue: the module's ids, the scene's environment state, a creature as the rules see it (the core's src/environment/weather.js), and
// damage rolled and applied through PF2e.

import { normalizeState } from "../../pf2e-resolution-core/src/environment/weather.js";
import { WEATHER } from "../../pf2e-resolution-core/src/environment/catalog.js";

export const MODULE_ID = "pf2e-automatic-environment-resolution";
export const FLAG = "environment";

export const isActiveGM = () => game.users.activeGM?.isSelf ?? game.user.isGM;
export const escapeHTML = (text) => String(text ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

// The scene's environment: { state (the GM's toggles, raw), since: { toggle: worldTime it started }, clock (the world time last ticked),
// sheltered: [token ids] }.
export function sceneData(scene) {
    const data = scene?.getFlag?.(MODULE_ID, FLAG) ?? {};
    return { state: data.state ?? {}, since: data.since ?? {}, clock: Number.isFinite(data.clock) ? data.clock : null, sheltered: data.sheltered ?? [] };
}
export const sceneState = (scene) => normalizeState(sceneData(scene).state);

// Every key a toggle can hold: written out, null where the GM left it empty, so Foundry's merge of the flag drops what the GM took away.
const TOGGLE_KEYS = ["level", "kind", "beyond", "hiddenBeyond", "direction", "flightDC", "groundDC", "blownFeet", "feet", "chance", "dc", "unbreathable", "heat", "harm"];
const SINCE_KEYS = ["temperature", "ash", "thunderstorm", "smoke", "sandstorm"];
export function fullState(raw = {}) {
    const state = { temperature: raw.temperature ?? "normal", travel: raw.travel?.on ? { on: true, since: Number(raw.travel.since) || 0 } : null };
    for (const toggle of Object.keys(WEATHER)) state[toggle] = raw[toggle]?.level ? Object.fromEntries(TOGGLE_KEYS.map((key) => [key, raw[toggle][key] ?? null])) : null;
    return state;
}

// The GM's new toggles: what started now gets its start time (temperature, ash and storms count their intervals from it).
export async function setSceneState(scene, raw) {
    const before = sceneData(scene);
    const state = fullState(raw);
    const next = normalizeState(state);
    const now = game.time.worldTime;
    const since = {};
    for (const key of SINCE_KEYS) {
        const on = key === "temperature" ? next.temperature !== "normal" : Boolean(next[key]);
        since[key] = on ? before.since[key] ?? now : null;
    }
    // (The clock from now: the module ticks it as the world's moves, so nothing is lost; an old one would count weather that wasn't there.)
    return scene.setFlag(MODULE_ID, FLAG, { ...before, state, since, clock: now });
}

export async function setSheltered(scene, tokenIds) {
    return scene.setFlag(MODULE_ID, FLAG, { ...sceneData(scene), sheltered: [...new Set(tokenIds)] });
}

// Its Speeds (PF2e 8.6: system.movement.speeds; attributes.speed.otherSpeeds before).
export function speedOf(actor, type) {
    const moved = Number(actor?.system?.movement?.speeds?.[type]?.value) || 0;
    if (moved > 0) return moved;
    const speeds = actor?.attributes?.speed?.otherSpeeds ?? actor?.system?.attributes?.speed?.otherSpeeds ?? [];
    const found = speeds.find((speed) => speed?.type === type && (Number(speed.total ?? speed.value) || 0) > 0);
    return found ? Number(found.total ?? found.value) : 0;
}

function sensesOf(actor) {
    const held = actor?.perception?.senses ?? actor?.system?.perception?.senses ?? [];
    const list = Array.isArray(held) ? held : typeof held.values === "function" ? [...held.values()] : Array.isArray(held.contents) ? held.contents : [];
    return list.map((sense) => (typeof sense === "string" ? { type: sense } : { type: sense?.type, acuity: sense?.acuity ?? null, range: Number.isFinite(Number(sense?.range)) ? Number(sense.range) : null })).filter((sense) => sense.type);
}

// (Its own abilities' names: Snow Vision, Water Breathing and the like are actions or features on NPCs, effects on PCs.)
const namesOf = (actor) => [...(actor?.items ?? [])].map((item) => String(item.name ?? "").toLowerCase());
const slugsOf = (actor) => [...(actor?.items ?? [])].map((item) => item.slug ?? item.system?.slug ?? "");

// (2026-10-25, with the item module's session, on the user's word to it: items that protect from the temperature.) Its protections, in
// the core's shape [{ counts: { felt key: the key it counts as }, fatigueHours?, source }]: from its Effects that haven't run out (a
// Cooling Elixir's, a Rime Jar's — flags[MODULE_ID].temperature), and from the item module's api for what it wears, invests or holds.
const ITEM_ID = "pf2e-automatic-item-resolution";
export function protectionsOf(actor, { temperature = null } = {}) {
    const fromEffects = (actor?.itemTypes?.effect ?? []).filter((effect) => !(effect.isExpired ?? effect.system?.expired)).map((effect) => effect.flags?.[MODULE_ID]?.temperature).filter((entry) => entry?.counts);
    let fromItems = [];
    const api = game.modules.get(ITEM_ID)?.active ? game.modules.get(ITEM_ID)?.api : null;
    if (typeof api?.temperatureProtections === "function") {
        try {
            const read = api.temperatureProtections(actor, temperature ? { temperature } : {});
            fromItems = Array.isArray(read) ? read.filter((entry) => entry?.counts) : [];
        } catch (error) {
            console.warn(`${MODULE_ID} | ${ITEM_ID}'s temperature protections for ${actor?.name}:`, error);
        }
    }
    return [...fromEffects, ...fromItems];
}

// The creature as the rules see it.
export function creatureOf(token, scene = token?.parent) {
    const actor = token?.actor;
    if (!actor) return null;
    const traits = [...(actor.system?.traits?.value ?? [])];
    const names = namesOf(actor);
    const slugs = slugsOf(actor);
    const worn = (actor.itemTypes?.equipment ?? []).filter((item) => item.isEquipped ?? item.system?.equipped?.inSlot);
    return {
        name: token.name ?? actor.name,
        size: actor.size ?? actor.system?.traits?.size?.value ?? "med",
        traits,
        senses: sensesOf(actor),
        speeds: { fly: speedOf(actor, "fly"), swim: speedOf(actor, "swim"), burrow: speedOf(actor, "burrow"), climb: speedOf(actor, "climb") },
        // (Foundry 14: a flier's movement action is "fly"; PF2e keeps a walker's elevation at the ground.)
        flying: speedOf(actor, "fly") > 0 && ((token.document ?? token).movementAction === "fly" || Number((token.document ?? token).elevation) > 0),
        breathesWater: traits.includes("aquatic") || traits.includes("amphibious") || names.some((name) => /water breathing|amphibious/.test(name)) || slugs.some((slug) => /water-breathing/.test(slug)),
        noBreath: names.some((name) => /doesn't need to breathe|does not breathe|no breath/.test(name)) || (traits.includes("construct") && !traits.includes("eidolon")) || traits.includes("undead"),
        snowVision: names.some((name) => /snow vision/.test(name)),
        gear: {
            coldWeather: worn.some((item) => (item.slug ?? item.system?.slug) === "clothing-cold-weather" || /cold-weather|winter clothing/i.test(item.name)),
            endurance: slugs.some((slug) => /environmental-endurance/.test(slug)) || names.some((name) => /environmental endurance/.test(name))
        },
        protections: protectionsOf(actor, { temperature: sceneState(scene).temperature }),
        sheltered: sceneData(scene).sheltered.includes(token.id),
        buriedAirless: (actor.itemTypes?.effect ?? []).some((effect) => effect.flags?.[MODULE_ID]?.buried?.airless)
    };
}

// The DamageRoll class PF2e registers.
export const damageRollClass = () => (CONFIG.Dice?.rolls ?? []).find((roll) => roll?.name === "DamageRoll");

// Damage of one type rolled and applied through PF2e (its resistances, weaknesses and immunities): the roll.
export async function dealDamage(token, formula, type, { label = "Environment", persistent = false } = {}) {
    const actor = token?.actor;
    if (!actor || !formula) return null;
    const DamageRoll = damageRollClass();
    const roll = await new DamageRoll(`(${formula})[${persistent ? `persistent,${type}` : type}]`).evaluate();
    await roll.toMessage({ speaker: { alias: label }, flavor: `<strong>${escapeHTML(label)}</strong>: ${escapeHTML(token.name)}` });
    await actor.applyDamage({ damage: roll, token: token.document ?? token });
    return roll;
}

// A persistent damage condition on the creature: PF2e's own, from a persistent damage roll applied (as the ability module's cards give it).
export async function persistentDamage(actor, formula, type, token = null) {
    const DamageRoll = damageRollClass();
    if (!actor || !DamageRoll || !formula) return;
    const roll = await new DamageRoll(`(${formula})[persistent,${type}]`).evaluate();
    await actor.applyDamage({ damage: roll, token: token?.document ?? token ?? undefined });
}

// (2026-10-25: creatures only — PF2e's loot actors can't hold an Effect, and the weather has nothing for a trap.)
const CREATURES = new Set(["character", "npc", "familiar"]);
export const isCreature = (actor) => CREATURES.has(actor?.type);

// Creatures on a scene with hit points (the dead and defeated left out).
export function livingTokens(scene) {
    return [...(scene?.tokens ?? [])].filter((token) => isCreature(token.actor) && Number(token.actor.system?.attributes?.hp?.max) > 0 && !token.combatant?.defeated && !token.actor.isDead);
}

// The distance between two tokens, PF2e's way (feet).
export function distanceBetween(a, b) {
    const from = a?.object ?? a;
    const to = b?.object ?? b;
    if (typeof from?.distanceTo === "function" && to) return from.distanceTo(to);
    return Infinity;
}

// A whisper to the GMs.
export async function noteToGM(content, { title = "Environment" } = {}) {
    return ChatMessage.create({ content: `<div class="pf2e-env-card"><header><strong>${escapeHTML(title)}</strong></header>${content}</div>`, speaker: { alias: title }, whisper: game.users.filter((user) => user.isGM).map((user) => user.id) });
}
