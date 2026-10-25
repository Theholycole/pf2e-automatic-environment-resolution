// Foundry and PF2e glue: the module's ids, the scene's environment state, a creature as the rules see it (src/rules/weather.js), and
// damage rolled and applied through PF2e.

import { normalizeState } from "../src/rules/weather.js";

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

// The GM's new toggles: what started now gets its start time (temperature, ash and storms count their intervals from it).
export async function setSceneState(scene, raw) {
    const before = sceneData(scene);
    const next = normalizeState(raw);
    const now = game.time.worldTime;
    const since = {};
    for (const key of ["temperature", "ash", "thunderstorm", "smoke", "sandstorm"]) {
        const on = key === "temperature" ? next.temperature !== "normal" : Boolean(next[key]);
        if (on) since[key] = before.since[key] ?? now;
    }
    return scene.setFlag(MODULE_ID, FLAG, { ...before, state: raw, since, clock: before.clock ?? now });
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
        flying: speedOf(actor, "fly") > 0 && Number(token.elevation ?? token.document?.elevation) > 0,
        breathesWater: traits.includes("aquatic") || traits.includes("amphibious") || names.some((name) => /water breathing|amphibious/.test(name)) || slugs.some((slug) => /water-breathing/.test(slug)),
        noBreath: names.some((name) => /doesn't need to breathe|does not breathe|no breath/.test(name)) || (traits.includes("construct") && !traits.includes("eidolon")) || traits.includes("undead"),
        snowVision: names.some((name) => /snow vision/.test(name)),
        gear: {
            coldWeather: worn.some((item) => (item.slug ?? item.system?.slug) === "clothing-cold-weather" || /cold-weather|winter clothing/i.test(item.name)),
            endurance: slugs.some((slug) => /environmental-endurance/.test(slug)) || names.some((name) => /environmental endurance/.test(name))
        },
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

// A persistent damage condition on the creature.
export async function persistentDamage(actor, formula, type) {
    const condition = game.pf2e?.ConditionManager?.getCondition?.("persistent-damage")?.toObject?.();
    if (!condition) return;
    condition.system.persistent = { formula, damageType: type, dc: 15 };
    await actor.createEmbeddedDocuments("Item", [condition]);
}

// Tokens on a scene with an actor and hit points (the dead and defeated left out).
export function livingTokens(scene) {
    return [...(scene?.tokens ?? [])].filter((token) => token.actor && Number(token.actor.system?.attributes?.hp?.max) > 0 && !token.combatant?.defeated && !token.actor.isDead);
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
