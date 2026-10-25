// The weather on the creatures: each token's Effect (src/rules/weather.js creatureEffect), kept in step with the scene's toggles; PF2e's
// Remaining Air for those who must hold their breath; and the scene-wide region for what the weather does to movement (wind on fliers)
// and the environment types it adds (aquatic underwater). Run on the active GM's client.

import { MODULE_ID, creatureOf, isActiveGM, sceneState } from "./foundry.js";
import { REMAINING_AIR, breathlessIn, creatureEffect, effectiveWeather, sceneMovementCosts } from "../src/rules/weather.js";

const ICON = "icons/magic/air/wind-weather-sailing-ship.webp";
const AIR_FLAG = "air";
const WEATHER_FLAG = "weather";
const REGION_FLAG = "weatherRegion";

const ours = (actor, flag) => (actor?.itemTypes?.effect ?? []).filter((effect) => effect.flags?.[MODULE_ID]?.[flag]);

function effectData(effect, sceneId) {
    const signature = JSON.stringify([effect.name, effect.rules, effect.summary]);
    return {
        name: effect.name,
        type: "effect",
        img: ICON,
        system: {
            slug: "environment-weather",
            duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
            rules: effect.rules,
            description: { value: `<ul>${effect.summary.map((line) => `<li>${foundry.utils.escapeHTML?.(line) ?? line}</li>`).join("")}</ul>` }
        },
        flags: { [MODULE_ID]: { [WEATHER_FLAG]: true, scene: sceneId, signature } }
    };
}

// One token's weather Effect: made, remade when it changed, removed when the weather does nothing to it.
export async function syncToken(token, state = sceneState(token.parent)) {
    const actor = token?.actor;
    if (!actor || !isActiveGM()) return;
    const creature = creatureOf(token);
    const effect = creatureEffect(state, creature);
    const held = ours(actor, WEATHER_FLAG);
    const data = effect ? effectData(effect, token.parent?.id) : null;
    if (data && held.length === 1 && held[0].flags[MODULE_ID].signature === data.flags[MODULE_ID].signature) {
        await syncAir(token, state, creature);
        return;
    }
    if (held.length) await actor.deleteEmbeddedDocuments("Item", held.map((item) => item.id));
    if (data) await actor.createEmbeddedDocuments("Item", [data]);
    await syncAir(token, state, creature);
}

// PF2e's Effect: Remaining Air while it must hold its breath (its counter the module's to lower, scripts/breath.js); gone once it can breathe.
async function syncAir(token, state, creature) {
    const actor = token.actor;
    const held = [...ours(actor, AIR_FLAG), ...(breathlessIn(state, creature).length ? [] : ours(actor, "suffocating"))];
    const breathless = breathlessIn(state, creature).length > 0;
    // (Out of air already: the Suffocating Effect stands in for it, scripts/breath.js.)
    if (breathless && !held.length && !ours(actor, "suffocating").length) {
        const source = (await fromUuid(REMAINING_AIR).catch(() => null))?.toObject?.();
        if (!source) return;
        source.flags = { ...(source.flags ?? {}), [MODULE_ID]: { [AIR_FLAG]: true } };
        await actor.createEmbeddedDocuments("Item", [source]);
    } else if (!breathless && held.length) await actor.deleteEmbeddedDocuments("Item", held.map((item) => item.id));
}

// Every token on the scene, and its region.
export async function syncScene(scene) {
    if (!scene || !isActiveGM()) return;
    const state = sceneState(scene);
    for (const token of [...scene.tokens]) {
        try {
            await syncToken(token, state);
        } catch (error) {
            console.warn(`${MODULE_ID} | ${token.name}'s weather couldn't be set.`, error);
        }
    }
    await syncRegion(scene, state);
}

// A linked actor leaving the scene keeps none of its weather.
export async function clearActor(actor) {
    if (!actor || !isActiveGM()) return;
    const held = [...ours(actor, WEATHER_FLAG), ...ours(actor, AIR_FLAG), ...ours(actor, "suffocating")];
    if (held.length) await actor.deleteEmbeddedDocuments("Item", held.map((item) => item.id));
}

// The scene-wide region: PF2e's movement costs (strong wind on fliers) and environment types (aquatic underwater).
async function syncRegion(scene, state) {
    const costs = sceneMovementCosts(state);
    const weather = effectiveWeather(state);
    const environment = weather.underwater ? ["aquatic"] : [];
    const behaviors = [
        ...(Object.keys(costs).length ? [{ type: "modifyMovementCost", name: "Weather: movement", system: { difficulties: costs } }] : []),
        ...(environment.length ? [{ type: "environment", name: "Weather: environment", system: { environmentTypes: environment, mode: "add" } }] : [])
    ];
    const existing = [...scene.regions].filter((region) => region.flags?.[MODULE_ID]?.[REGION_FLAG]);
    const signature = JSON.stringify(behaviors);
    if (existing.length === 1 && existing[0].flags[MODULE_ID].signature === signature) return;
    if (existing.length) await scene.deleteEmbeddedDocuments("Region", existing.map((region) => region.id));
    if (!behaviors.length) return;
    const { width, height } = scene.dimensions ?? { width: scene.width, height: scene.height };
    await scene.createEmbeddedDocuments("Region", [{
        name: "Environment: weather",
        color: "#6f8fa8",
        shapes: [{ type: "rectangle", x: 0, y: 0, width, height }],
        visibility: 0,
        behaviors,
        flags: { [MODULE_ID]: { [REGION_FLAG]: true, signature } }
    }]);
}
