// Holding its breath (Player Core 437), for a creature the weather or the water leaves without air (scripts/sync.js gives it PF2e's
// Effect: Remaining Air, 5 + Con rounds): 1 round less at the end of each of its turns, 2 if it attacked or cast a spell that turn, 1 for
// each critical hit it takes; all of it for Casting a Spell that isn't subtle (speaking). Out of air: the module's Suffocating Effect
// (unconscious), and a Fortitude save at the end of each of its turns — DC 20, then 5 more each time; 1d10 damage on a failure, 1d10 more
// each time; death on a critical failure.

import { MODULE_ID, isActiveGM } from "./foundry.js";
import { BREATH } from "../../pf2e-resolution-core/src/environment/catalog.js";
import { postCard } from "./cards.js";

const UNCONSCIOUS = "Compendium.pf2e.conditionitems.Item.fBnFDH2MTzgFijKf";
const airOf = (actor) => (actor?.itemTypes?.effect ?? []).find((effect) => effect.flags?.[MODULE_ID]?.air) ?? null;
export const suffocatingOf = (actor) => (actor?.itemTypes?.effect ?? []).find((effect) => effect.flags?.[MODULE_ID]?.suffocating) ?? null;

// Who attacked or cast this turn (actor uuid → true), cleared as each turn ends.
const strained = new Set();

// An attack or a spell in chat: the attacker strains its air; a critical hit costs the target a round; a spell that isn't subtle, all of it.
export async function onBreathMessage(message) {
    if (!isActiveGM()) return;
    const actor = message.actor;
    const context = message.flags?.pf2e?.context;
    const spell = message.flags?.pf2e?.origin?.type === "spell" && message.flags?.pf2e?.casting;
    if (actor && airOf(actor) && (["attack-roll", "spell-attack-roll"].includes(context?.type) || spell)) strained.add(actor.uuid);
    if (actor && spell && airOf(actor) && !(message.item?.system?.traits?.value ?? []).includes("subtle")) await outOfAir(actor, `${actor.name} spoke to cast ${message.item?.name ?? "a spell"}`);
    if (["attack-roll", "spell-attack-roll"].includes(context?.type) && context.outcome === "criticalSuccess" && context.target?.actor) {
        const target = await fromUuid(context.target.actor).catch(() => null);
        if (airOf(target)) await loseAir(target, 1);
    }
}

async function loseAir(actor, rounds) {
    const air = airOf(actor);
    if (!air) return;
    const left = Math.max(0, (Number(air.system?.badge?.value) || 0) - rounds);
    if (left <= 0) return outOfAir(actor, `${actor.name} is out of air`);
    await air.update({ "system.badge.value": left });
}

async function outOfAir(actor, why) {
    const air = airOf(actor);
    if (air) await actor.deleteEmbeddedDocuments("Item", [air.id]);
    if (suffocatingOf(actor)) return;
    await actor.createEmbeddedDocuments("Item", [{
        name: "Suffocating",
        type: "effect",
        img: "icons/magic/air/air-burst-spiral-pink.webp",
        system: {
            slug: "environment-suffocating",
            duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
            rules: [{ key: "GrantItem", uuid: UNCONSCIOUS, flag: "suffocatingUnconscious", allowDuplicate: true, onDeleteActions: { granter: "cascade", grantee: "cascade" } }],
            description: { value: `<p>${why}: unconscious and suffocating. It can't recover from being unconscious, and attempts a Fortitude save at the end of each of its turns (DC ${BREATH.suffocateDC}, 5 more each time): 1d10 damage on a failure (1d10 more each time), death on a critical failure.</p>` }
        },
        flags: { [MODULE_ID]: { suffocating: { saves: 0 } } }
    }]);
}

// The end of its turn: its air, or its suffocation save.
export async function breathTurnEnd(token) {
    const actor = token?.actor;
    if (!actor || !isActiveGM()) return;
    const attacked = strained.delete(actor.uuid);
    if (airOf(actor)) return loseAir(actor, attacked ? 2 : 1);
    const suffocating = suffocatingOf(actor);
    if (!suffocating) return;
    const saves = Number(suffocating.flags[MODULE_ID].suffocating.saves) || 0;
    await suffocating.update({ [`flags.${MODULE_ID}.suffocating.saves`]: saves + 1 });
    const dice = `${saves + 1}d${BREATH.die}`;
    await postCard({
        key: "suffocation",
        title: `Suffocating: ${token.name}`,
        check: { statistic: "fortitude", dc: BREATH.suffocateDC + BREATH.dcStep * saves, basic: false },
        damage: [{ formula: dice, type: "untyped" }],
        degrees: { criticalSuccess: {}, success: {}, failure: { damage: 1 }, criticalFailure: { damage: 1, dies: true } },
        notes: [`Failure: ${dice} damage. Critical failure: it dies.`]
    }, [token]);
}
