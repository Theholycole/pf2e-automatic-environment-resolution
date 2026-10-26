// Attacks in the weather (after PF2e's attack roll, on the active GM's client): the flat check against a target the weather conceals or
// hides from the attacker (the core's src/environment/weather.js flatCheckFor), rolled and posted; a physical ranged attack in a windstorm, or a bludgeoning
// or slashing one underwater, that can't hit. PF2e's own roll stands; the card says what the weather made of it.

import { MODULE_ID, creatureOf, distanceBetween, escapeHTML, isActiveGM, sceneState } from "./foundry.js";
import { effectiveWeather, flatCheckFor, rangedInWind } from "../../pf2e-resolution-core/src/environment/weather.js";

const ATTACKS = new Set(["attack-roll", "spell-attack-roll"]);

export async function onAttackMessage(message) {
    if (!isActiveGM()) return;
    const context = message.flags?.pf2e?.context;
    if (!ATTACKS.has(context?.type) || !context.target?.token) return;
    const attacker = message.token ?? (context.origin?.token ? await fromUuid(context.origin.token) : null);
    const target = await fromUuid(context.target.token).catch(() => null);
    const scene = attacker?.parent ?? target?.parent;
    if (!attacker || !target || !scene) return;
    const state = sceneState(scene);
    const weather = effectiveWeather(state);
    const options = new Set(context.options ?? []);
    const domains = new Set(context.domains ?? []);
    const lines = [];
    const ranged = domains.has("ranged-strike-attack-roll") || (context.type === "attack-roll" && options.has("item:ranged"));
    const physical = context.type === "attack-roll" && !options.has("item:trait:impulse");

    if (ranged && physical && !rangedInWind(state).possible) lines.push(`<p><strong>${escapeHTML(rangedInWind(state).label)}</strong>: physical ranged attacks are impossible. The attack misses.</p>`);
    else if (ranged && physical && weather.underwater && !options.has("item:rune:property:underwater") && ["bludgeoning", "slashing"].some((type) => options.has(`item:damage:type:${type}`))) lines.push("<p><strong>Underwater</strong>: a ranged bludgeoning or slashing attack misses.</p>");
    else {
        // (A target PF2e's concealed condition already marks: the spell module rolls a spell's flat check; a Strike's is rolled here. Its
        // weather's own concealment past a distance: rolled here for both.)
        const concealedByWeather = (target.actor?.itemTypes?.condition ?? []).some((condition) => condition.slug === "concealed" && condition.flags?.pf2e?.grantedBy && target.actor.items.get(condition.flags.pf2e.grantedBy.id)?.flags?.[MODULE_ID]?.weather);
        // (The Strike's weapon: one that ignores some of the weather's concealment — Wintershot.)
        const check = flatCheckFor(state, { attacker: creatureOf(attacker), target: creatureOf(target), distance: distanceBetween(attacker, target), weapon: message.item?.id ?? null });
        const strike = context.type === "attack-roll";
        // (A miss needs no flat check.)
        const missed = ["failure", "criticalFailure"].includes(context.outcome);
        if (check && !missed && (strike || !concealedByWeather || check.dc === 11)) lines.push(await flatCheckLine(check, attacker));
    }
    if (!lines.length) return;
    await ChatMessage.create({
        content: `<div class="pf2e-env-card"><header><strong>Weather</strong>: ${escapeHTML(attacker.name)} → ${escapeHTML(target.name)}</header>${lines.join("")}</div>`,
        speaker: { alias: "Environment" },
        flags: { [MODULE_ID]: { attack: message.id } }
    });
}

async function flatCheckLine(check, attacker) {
    const roll = await new Roll("1d20").evaluate();
    if (game.dice3d) await game.dice3d.showForRoll(roll, game.user, true).catch(() => null);
    const hit = roll.total >= check.dc;
    return `<p>${escapeHTML(check.why)}: flat check DC ${check.dc} — <strong>${roll.total}</strong>. ${hit ? "It can target the creature." : `${escapeHTML(attacker.name)}'s attack misses (the flat check failed).`}</p>`;
}
