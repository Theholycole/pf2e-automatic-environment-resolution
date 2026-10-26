// Terrain: a region the GM gives one of GM Core's environmental features (the core's src/environment/terrain.js featureRules), or the whole scene's ground.
// The region gets PF2e's movement costs and environment types, and a script behavior whose events come here: the Effect a creature holds
// while inside (off-guard on uneven ground or a narrow surface, cover), Balance for each move on it, hazard damage for each move into or
// through it, a current's push. Stairs' cost going up is scripts/stairs.js's.

import { MODULE_ID, creatureOf, isActiveGM, isCreature, persistentDamage } from "./foundry.js";
import { featureRules } from "../../pf2e-resolution-core/src/environment/terrain.js";
import { DIRECTIONS, FEATURES } from "../../pf2e-resolution-core/src/environment/catalog.js";
import { disasterCard } from "../../pf2e-resolution-core/src/environment/disasters.js";
import { hitTokens, postCard } from "./cards.js";
import { pushToken } from "./movement.js";

const SCRIPT = `if (game.users.activeGM?.id !== game.user.id) return;\nawait game.modules.get(${JSON.stringify(MODULE_ID)})?.api?.regionEvent?.(region, behavior, event);`;
// (Moves into and within it: each one a Balance and a hazard's damage — 2026-10-25, the user: no longer once on entering.)
const EVENTS = ["tokenEnter", "tokenExit", "tokenMoveIn", "tokenMoveWithin", "tokenTurnStart", "tokenTurnEnd"];
const SCRIPTED = ["balance", "hazard", "part", "explodes", "current"];
const handledMoves = new Set();
const TERRAIN = "terrain";
const GROUND = "groundRegion";

export const regionFeature = (region) => region?.getFlag?.(MODULE_ID, TERRAIN) ?? null;
const insideEffects = (actor, regionUuid) => (actor?.itemTypes?.effect ?? []).filter((effect) => effect.flags?.[MODULE_ID]?.region === regionUuid);
const tokensIn = (region) => [...(region?.tokens ?? [])];

// Give a region a feature (key null: take it away). current: { feet, direction } for flowing water; up: the direction stairs go up.
export async function setRegionFeature(region, key, { dc = null, current = null, up = null } = {}) {
    const ours = [...region.behaviors].filter((behavior) => behavior.flags?.[MODULE_ID]?.[TERRAIN]);
    if (ours.length) await region.deleteEmbeddedDocuments("RegionBehavior", ours.map((behavior) => behavior.id));
    for (const token of tokensIn(region)) {
        const held = insideEffects(token.actor, region.uuid);
        if (held.length) await token.actor.deleteEmbeddedDocuments("Item", held.map((item) => item.id));
    }
    const rules = key ? featureRules(key, { dc }) : null;
    if (!rules) return region.unsetFlag(MODULE_ID, TERRAIN);
    const flags = { [MODULE_ID]: { [TERRAIN]: true } };
    const costs = Object.fromEntries(Object.entries(rules.costs).filter(([, cost]) => cost > 1));
    const behaviors = [
        ...(Object.keys(costs).length ? [{ type: "modifyMovementCost", name: `${rules.label}: movement`, system: { difficulties: costs }, flags }] : []),
        ...(rules.environment.length ? [{ type: "environment", name: `${rules.label}: environment`, system: { environmentTypes: rules.environment, mode: "add" }, flags }] : []),
        ...(rules.effect || SCRIPTED.some((kind) => rules.events[kind]) ? [{ type: "executeScript", name: `${rules.label}: events`, system: { source: SCRIPT, events: EVENTS }, flags }] : [])
    ];
    if (behaviors.length) await region.createEmbeddedDocuments("RegionBehavior", behaviors);
    await region.setFlag(MODULE_ID, TERRAIN, { key, dc: rules.dc, ...(current ? { current } : {}), ...(rules.events.stairs ? { up: DIRECTIONS[up] ? up : "N" } : {}) });
    // (Those already inside: its Effect now.)
    if (rules.effect) for (const token of tokensIn(region)) await addInside(token, region, rules);
}

// The whole scene's ground: a region over all of it, with the feature (null: none).
export async function setSceneGround(scene, key, options = {}) {
    let region = [...scene.regions].find((entry) => entry.flags?.[MODULE_ID]?.[GROUND]);
    if (!key) {
        if (region) await scene.deleteEmbeddedDocuments("Region", [region.id]);
        return null;
    }
    if (!region) {
        const { width, height } = scene.dimensions;
        [region] = await scene.createEmbeddedDocuments("Region", [{ name: "Environment: ground", color: "#7a5c3a", shapes: [{ type: "rectangle", x: 0, y: 0, width, height }], visibility: 0, flags: { [MODULE_ID]: { [GROUND]: true } } }]);
    }
    await setRegionFeature(region, key, options);
    return region;
}
export const sceneGround = (scene) => regionFeature([...(scene?.regions ?? [])].find((entry) => entry.flags?.[MODULE_ID]?.[GROUND]));

async function addInside(token, region, rules) {
    if (!rules.effect || insideEffects(token.actor, region.uuid).length) return;
    await token.actor.createEmbeddedDocuments("Item", [{
        name: rules.effect.name,
        type: "effect",
        img: "icons/environment/wilderness/terrain-rocky-ground.webp",
        system: { slug: "environment-terrain", duration: { value: -1, unit: "unlimited", expiry: null, sustained: false }, rules: rules.effect.rules, description: { value: `<ul>${rules.summary.map((line) => `<li>${line}</li>`).join("")}</ul>` } },
        flags: { [MODULE_ID]: { region: region.uuid } }
    }]);
}

// A region event (its script behavior, on the active GM's client).
export async function regionEvent(region, behavior, event) {
    if (!isActiveGM()) return;
    const terrain = regionFeature(region);
    const token = event?.data?.token;
    if (!terrain || !isCreature(token?.actor)) return;
    const rules = featureRules(terrain.key, { dc: terrain.dc });
    if (!rules) return;
    const creature = creatureOf(token);
    const aloft = creature.flying && !FEATURES[terrain.key]?.reachesAir;
    const hazard = rules.events.hazard;
    switch (event.name) {
        case "tokenEnter":
            if (!aloft) await addInside(token, region, rules);
            return;
        // (Each move into it or within it: a Balance — not for a creature moved by force —, and a hazard's damage.)
        case "tokenMoveIn":
        case "tokenMoveWithin": {
            if (aloft) return;
            const movement = event.data.movement;
            // (Foundry splits a move at the region's edge — in, then within, the second a new id on the same subpath: one move, one Balance
            // and one hazard.)
            const key = `${region.id}:${token.id}:${movement?.subpathId ?? movement?.chain?.[0] ?? movement?.id ?? Date.now()}`;
            if (handledMoves.has(key)) return;
            handledMoves.add(key);
            setTimeout(() => handledMoves.delete(key), 60000);
            const forced = (movement?.passed?.waypoints ?? []).every((point) => point.action === "displace");
            if (rules.events.balance && !forced) await postCard(balanceCard(rules, movement?.origin ?? null), [token]);
            if (hazard?.when === "enter") await hazardHit(token, rules);
            return;
        }
        case "tokenExit": {
            const held = insideEffects(token.actor, region.uuid);
            if (held.length) await token.actor.deleteEmbeddedDocuments("Item", held.map((item) => item.id));
            return;
        }
        case "tokenTurnStart":
            if (hazard?.when === "turn" && !aloft) await hazardHit(token, rules);
            return;
        case "tokenTurnEnd":
            if (rules.events.current && terrain.current && !creature.flying) await pushToken(token, terrain.current.feet, terrain.current.direction);
            return;
    }
}

async function hazardHit(token, rules) {
    const hazard = rules.events.hazard;
    await hitTokens([token], { formula: hazard.formula, type: hazard.type, label: rules.label });
    if (hazard.persistent) await persistentDamage(token.actor, hazard.persistent.formula, hazard.persistent.type, token);
}

// The Balance card for a move: a failure keeps it where it started the move (the action wasted), a critical failure there and prone.
export function balanceCard(rules, origin = null) {
    const narrow = rules.events.balance.narrow;
    const back = origin ? { returnTo: { x: origin.x, y: origin.y, elevation: origin.elevation ?? 0 } } : {};
    return {
        key: "balance",
        title: `${rules.label}: Balance`,
        check: { statistic: "acrobatics", dc: rules.events.balance.dc, basic: false },
        damage: [],
        degrees: { criticalSuccess: {}, success: {}, failure: { ...back }, criticalFailure: { ...back, conditions: [{ slug: "prone" }] } },
        notes: [`Critical success: it moves on normally. Success: it moves on, treating it as difficult terrain. Failure: it stays where it was (the action wasted). Critical failure: it falls${narrow ? " off" : " prone"}, and its turn ends.`]
    };
}

// (Regions given a feature before 0.1.2: their script behavior hears each move too.)
export async function migrateRegions() {
    for (const scene of game.scenes) for (const region of scene.regions) {
        if (!regionFeature(region)) continue;
        const stale = [...region.behaviors].filter((behavior) => {
            const events = new Set(behavior.system.events ?? []);
            return behavior.type === "executeScript" && behavior.flags?.[MODULE_ID]?.[TERRAIN] && EVENTS.some((name) => !events.has(name));
        });
        for (const behavior of stale) await behavior.update({ "system.events": EVENTS });
    }
}

// The GM's buttons for a region: part a crowd (the selected creature's check), ignite sewer gas (a card for those inside).
export async function partCrowd(region, token, statistic = "diplomacy") {
    const terrain = regionFeature(region);
    const rules = terrain ? featureRules(terrain.key, { dc: terrain.dc }) : null;
    if (!rules?.events.part || !token?.actor) return null;
    return postCard({ key: "part-crowd", title: `${rules.label}: part the crowd`, check: { statistic, dc: rules.events.part.dc, basic: false }, damage: [], degrees: { criticalSuccess: { part: region.uuid }, success: { part: region.uuid }, failure: {}, criticalFailure: {} }, notes: ["Success: the crowd parts; it's no longer difficult terrain."] }, [token]);
}

export async function igniteGas(region, options = {}) {
    const tokens = tokensIn(region).map((token) => token.object ?? token);
    return postCard(disasterCard("sewer-gas", options), tokens);
}

// A parted crowd: its movement costs off.
export async function partRegion(regionUuid) {
    const region = await fromUuid(regionUuid).catch(() => null);
    const costs = [...(region?.behaviors ?? [])].filter((behavior) => behavior.type === "modifyMovementCost" && behavior.flags?.[MODULE_ID]?.[TERRAIN]);
    for (const behavior of costs) await behavior.update({ disabled: true });
}
