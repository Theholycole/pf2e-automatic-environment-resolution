// The weather as time passes (the active GM's client). In a fight: at the start of each turn, the damage that comes each round (a heavy
// sandstorm, a wildfire's heat) and a flier's Maneuver in Flight in the wind; at the end of each turn, its air, the current's push, and a
// flier that found no footing in the wind blown away (a creature on the ground the wind troubles rolls Athletics as it first moves in a
// round: scripts/wind.js). On the world clock (PF2e and Foundry advance it 6 seconds a round): temperature, hot ash, burial, lightning,
// travel fatigue — the user's choice, 2026-10-25.

import { FLAG, MODULE_ID, creatureOf, escapeHTML, isActiveGM, isCreature, livingTokens, noteToGM, sceneData, sceneState } from "./foundry.js";
import { clockDamage, fatigueHours, lightningChances, turnStartDamage } from "../../pf2e-resolution-core/src/environment/ticks.js";
import { categoryDice, levelOf } from "../../pf2e-resolution-core/src/environment/catalog.js";
import { effectiveWeather, ignoresWeather } from "../../pf2e-resolution-core/src/environment/weather.js";
import { disasterCard } from "../../pf2e-resolution-core/src/environment/disasters.js";
import { applyCard, cardOf, hitTokens, postCard } from "./cards.js";
import { syncToken } from "./sync.js";
import { breathTurnEnd } from "./breath.js";
import { pushToken } from "./movement.js";
import { burialHits } from "./burial.js";


// PF2e's pf2e.startTurn and pf2e.endTurn (Foundry 14's combatTurnChange gives the new turn as the old one too), one at a time.
// (The round a turn ends in: the one PF2e noted as it started, flags.pf2e.roundOfLastTurn.)
let queue = Promise.resolve();
const serially = (run) => (queue = queue.then(() => safely(run)));
export function onTurnStart(combatant, encounter) {
    if (isActiveGM()) return serially(() => turnStart(encounter, combatant, encounter?.round ?? 0));
}
export function onTurnEnd(combatant, encounter) {
    if (isActiveGM()) return serially(() => turnEnd(encounter, combatant, combatant?.flags?.pf2e?.roundOfLastTurn ?? encounter?.round ?? 0));
}

async function safely(run) {
    try {
        await run();
    } catch (error) {
        console.error(`${MODULE_ID} |`, error);
    }
}

async function turnStart(combat, combatant, round) {
    const token = combatant.token;
    const scene = token?.parent;
    if (!isCreature(token?.actor) || !scene || combatant.defeated) return;
    const state = sceneState(scene);
    await syncToken(token, state);
    const creature = creatureOf(token, scene);
    for (const hit of turnStartDamage(state, creature)) await hitTokens([token], { formula: categoryDice(hit.category), type: hit.type, label: hit.label });

    const weather = effectiveWeather(state);
    const wind = weather.wind ? levelOf("wind", weather.wind.level) : null;
    if (!wind || creature.sheltered) return;
    if (wind.flightDC && creature.flying && !ignoresWeather(creature, "wind-movement")) {
        await postCard({
            key: "wind-flight",
            title: `${wind.label}: Maneuver in Flight`,
            check: { statistic: "acrobatics", dc: weather.wind.flightDC, basic: false },
            damage: [],
            degrees: { criticalSuccess: {}, success: {}, failure: {}, criticalFailure: {} },
            wind: { combatantId: combatant.id, round, feet: weather.wind.blownFeet, direction: weather.wind.direction },
            notes: [`It must succeed at a Maneuver in Flight this turn, or be blown ${weather.wind.blownFeet} feet ${weather.wind.direction} at its end (at once on a critical failure). Flying is ${wind.flying === 3 ? "greater " : ""}difficult terrain.`]
        }, [token]);
    }
    // (On the ground: the wind's Athletics when it first moves in a round — scripts/wind.js.)
}

async function turnEnd(combat, combatant, round) {
    const token = combatant.token;
    const scene = token?.parent;
    if (!isCreature(token?.actor) || !scene) return;
    await breathTurnEnd(token);
    const state = sceneState(scene);
    const weather = effectiveWeather(state);
    const creature = creatureOf(token, scene);
    if (weather.current && !creature.flying) await pushToken(token, weather.current.feet, weather.current.direction);
    // (The wind's card for this turn: no success, and still aloft — blown away.)
    const card = game.messages.contents.findLast((message) => cardOf(message)?.wind?.combatantId === combatant.id && cardOf(message).wind.round === round);
    const wind = cardOf(card);
    if (wind && creature.flying && !ignoresWeather(creature, "wind-movement") && !["success", "criticalSuccess"].includes(wind.targets[0]?.degree) && !wind.targets[0]?.applied) {
        const moved = await pushToken(token, wind.wind.feet, wind.wind.direction);
        await card.update({ [`flags.${MODULE_ID}.card.targets`]: wind.targets.map((target) => ({ ...target, applied: true })) });
        await noteToGM(`<p>${escapeHTML(token.name)} ${moved ? `is blown ${wind.wind.feet} feet ${wind.wind.direction}` : `would be blown ${wind.wind.feet} feet ${wind.wind.direction}, but something stops it`}.</p>`, { title: "Wind" });
    }
}

// The world clock moved: each scene in play (the active one, the fight's) with weather or a buried creature ticks from where it last did.
export async function onWorldTime(worldTime) {
    if (!isActiveGM()) return;
    const scenes = new Set([game.scenes.active, game.combat?.scene].filter(Boolean));
    for (const scene of scenes) await safely(() => tickScene(scene, worldTime));
}

// (Nothing set on a scene and no one buried there: nothing to do, and nothing written to it.)
const quiet = (scene) => !scene.getFlag(MODULE_ID, FLAG) && ![...scene.tokens].some((token) => (token.actor?.itemTypes?.effect ?? []).some((effect) => effect.flags?.[MODULE_ID]?.buried));

export async function tickScene(scene, now) {
    if (quiet(scene)) return;
    const data = sceneData(scene);
    const from = data.clock ?? now;
    await scene.setFlag(MODULE_ID, FLAG, { ...data, clock: now });
    if (!(now > from)) return;
    const state = sceneState(scene);
    const long = now - from > Number(game.settings.get(MODULE_ID, "askAfter") || 3600);
    // (Hits of a kind grouped: one card each, its damage rolled once for all the creatures it hits.)
    const groups = new Map();
    for (const token of livingTokens(scene)) {
        const creature = creatureOf(token, scene);
        for (const hit of clockDamage(state, creature, { from, to: now, since: data.since })) {
            const key = `${hit.label}|${hit.category}|${hit.type}|${hit.count}`;
            if (!groups.has(key)) groups.set(key, { ...hit, tokens: [] });
            groups.get(key).tokens.push(token);
        }
        for (const chance of lightningChances(state, creature, { from, to: now, since: data.since })) {
            let struck = false;
            for (let minute = 0; minute < chance.count && !struck; minute++) struck = Math.floor(Math.random() * chance.chance) === 0;
            if (struck) await strike(token, chance);
        }
    }
    for (const { token, hits } of burialHits(scene, from, now)) for (const hit of hits) {
        const key = `${hit.label}|${hit.category}|${hit.type}|${hit.count}|${token.id}`;
        groups.set(key, { ...hit, tokens: [token] });
    }
    for (const group of groups.values()) {
        const message = await postCard({
            key: "clock",
            title: `${group.label}${group.count > 1 ? ` (${group.count} times)` : ""}`,
            check: null,
            damage: [{ formula: group.formula ?? categoryDice(group.category, null, { times: group.count }), type: group.type }],
            automatic: { damage: 1 },
            notes: long ? [`${Math.round((now - from) / 60)} minutes passed at once: the GM applies it.`] : []
        }, group.tokens);
        if (!long && message) await applyCard(message);
    }
    await travelFatigue(scene, state, now);
}

// Struck by lightning: the card for that creature (a basic save only when the GM gave the storm a DC).
async function strike(token, chance) {
    const card = disasterCard("lightning", { category: chance.category, ...(chance.dc ? { save: true, dc: chance.dc } : {}) });
    const message = await postCard({ ...card, title: `${chance.label}: lightning strikes ${token.name}` }, [token]);
    if (!card.check && message) await applyCard(message);
}

// On a journey, fatigued after the hours the weather allows (the PCs — characters, however they're owned; once each journey).
async function travelFatigue(scene, state, now) {
    if (!state.travel?.on) return;
    const data = sceneData(scene);
    const done = new Set(data.fatigued ?? []);
    const hours = (now - state.travel.since) / 3600;
    const fresh = [];
    for (const token of livingTokens(scene)) {
        if (token.actor.type !== "character" || done.has(token.id)) continue;
        if (hours < fatigueHours(state, creatureOf(token, scene))) continue;
        await token.actor.increaseCondition?.("fatigued");
        fresh.push(token);
        done.add(token.id);
    }
    if (!fresh.length) return;
    await scene.setFlag(MODULE_ID, FLAG, { ...sceneData(scene), fatigued: [...done] });
    await noteToGM(`<p>Fatigued from travel: ${fresh.map((token) => escapeHTML(token.name)).join(", ")}.</p>`, { title: "Travel" });
}
