// A creature moving on the ground against a strong wind (GM Core: "particularly strong winds might require a creature to succeed at an
// Athletics check to move, knocking the creature back and prone on a critical failure"). In a fight, its first move each round waits for
// that check (the user, 2026-10-25: the card only when it moves, not every turn): Foundry's preMoveToken on the moving client stops the move
// and posts the card; a success lets it move for the rest of the round, a failure keeps it where it is, a critical failure knocks it back
// and prone (the card's Apply). Its own drags and keys only — a push, a teleport or another module's move isn't stopped.

import { creatureOf, isCreature, sceneState } from "./foundry.js";
import { effectiveWeather, ignoresWeather } from "../../pf2e-resolution-core/src/environment/weather.js";
import { levelOf } from "../../pf2e-resolution-core/src/environment/catalog.js";
import { cardOf, postCard } from "./cards.js";

const USER_MOVES = new Set(["dragging", "keyboard"]);
const SIZE_PENALTY = { tiny: -2, sm: -1 };
const posting = new Set();

// The wind that troubles this creature on the ground, or null: { wind (the level), dc, direction, size }.
export function groundWind(tokenDoc) {
    if (!isCreature(tokenDoc?.actor)) return null;
    const weather = effectiveWeather(sceneState(tokenDoc.parent));
    const wind = weather.wind ? levelOf("wind", weather.wind.level) : null;
    if (!wind?.groundDC) return null;
    const creature = creatureOf(tokenDoc);
    if (!creature || creature.flying || creature.sheltered || ignoresWeather(creature, "wind-movement") || (wind.groundSizes && !wind.groundSizes.includes(creature.size))) return null;
    return { wind, dc: weather.wind.groundDC, direction: weather.wind.direction, size: creature.size };
}

export function windCard(tokenDoc, trouble, { combatantId, round }) {
    const penalty = SIZE_PENALTY[trouble.size];
    return {
        key: "wind-ground",
        title: `${trouble.wind.label}: moving against it`,
        check: { statistic: "athletics", dc: trouble.dc, basic: false, ...(penalty ? { penalties: { t0: { value: penalty, label: "Size in the wind" } } } : {}) },
        damage: [],
        degrees: { criticalSuccess: {}, success: {}, failure: {}, criticalFailure: { pushed: { feet: 10, direction: trouble.direction }, conditions: [{ slug: "prone" }] } },
        groundWind: { combatantId, round },
        notes: ["Success: it moves this round. Failure: it can't move against the wind this round. Critical failure: knocked back 10 feet and prone."]
    };
}

// The preMoveToken hook: false stops the move.
export function windMoveGate(tokenDoc, movement) {
    if (!USER_MOVES.has(movement?.method)) return;
    if ((movement.passed?.waypoints ?? []).length && movement.passed.waypoints.every((point) => point.action === "displace")) return;
    const combat = game.combat;
    const combatant = combat?.started ? combat.combatants.find((entry) => entry.tokenId === tokenDoc.id && entry.sceneId === tokenDoc.parent?.id) : null;
    if (!combatant) return;
    const trouble = groundWind(tokenDoc);
    if (!trouble) return;
    const card = game.messages.contents.findLast((message) => cardOf(message)?.groundWind?.combatantId === combatant.id && cardOf(message).groundWind.round === combat.round);
    const degree = cardOf(card)?.targets?.[0]?.degree ?? null;
    if (degree === "success" || degree === "criticalSuccess") return;
    if (!card) {
        const key = `${combatant.id}:${combat.round}`;
        if (!posting.has(key)) {
            posting.add(key);
            postCard(windCard(tokenDoc, trouble, { combatantId: combatant.id, round: combat.round }), [tokenDoc.object ?? tokenDoc]).finally(() => posting.delete(key));
        }
        ui.notifications.info(`${trouble.wind.label}: ${tokenDoc.name} needs Athletics (DC ${trouble.dc}) to move. Roll it on the card in chat, then move.`);
        return false;
    }
    if (!degree) ui.notifications.warn(`${tokenDoc.name}: roll the wind's Athletics check on its card first.`);
    else ui.notifications.warn(`${tokenDoc.name} can't move against the ${trouble.wind.label.toLowerCase()} this round.`);
    return false;
}
