// The module's cards: a disaster's (the core's src/environment/disasters.js) or a terrain check's, posted for the creatures the GM picked. Its damage is
// rolled once as it's posted; each creature rolls its own save or check from the card (its owner or the GM; the result comes back through
// PF2e's roll message, matched by its identifier); the GM's Apply does what each degree says. State in the message's flags.

import { MODULE_ID, dealDamage, escapeHTML, fallEasesOf, isActiveGM, noteToGM, persistentDamage } from "./foundry.js";
import { easedFall } from "../../pf2e-resolution-core/src/environment/disasters.js";
import { pushToken } from "./movement.js";
import { buryCreature, freeCreature } from "./burial.js";
import { partRegion } from "./regions.js";
import { applyStructure } from "./structures.js";

const CARD = "card";
const DEGREES = { criticalSuccess: "Critical success", success: "Success", failure: "Failure", criticalFailure: "Critical failure" };
const STATISTICS = { fortitude: "Fortitude", reflex: "Reflex", will: "Will", athletics: "Athletics", acrobatics: "Acrobatics", diplomacy: "Diplomacy", intimidation: "Intimidation", performance: "Performance", thievery: "Thievery" };

export const cardOf = (message) => message?.getFlag?.(MODULE_ID, CARD) ?? null;
const identifierOf = (messageId, targetId) => `${MODULE_ID}:${messageId}:${targetId}`;

// Post a card: { title, check, damage, degrees, automatic, notes }, for these tokens.
export async function postCard(card, tokens, { speaker = "Environment" } = {}) {
    const rolled = [];
    for (const part of card.damage ?? []) {
        const roll = await new Roll(part.formula).evaluate();
        rolled.push({ formula: part.formula, type: part.type, total: roll.total, dice: roll.dice.flatMap((die) => die.results.map((result) => result.result)) });
    }
    const state = {
        ...card,
        rolled,
        targets: tokens.filter((token) => token?.actor).map((token, index) => ({ id: `t${index}`, tokenUuid: token.document?.uuid ?? token.uuid, actorUuid: token.actor.uuid, name: token.name, degree: card.check ? null : "automatic", total: null, applied: false }))
    };
    return ChatMessage.create({ content: cardHTML(state), speaker: { alias: speaker }, flags: { [MODULE_ID]: { [CARD]: state } } });
}

export function cardHTML(state) {
    const check = state.check ? `<p class="pf2e-env-check">${state.check.basic ? "Basic " : ""}${STATISTICS[state.check.statistic] ?? state.check.statistic} ${["fortitude", "reflex", "will"].includes(state.check.statistic) ? "save" : "check"}, DC ${state.check.dc}</p>` : "";
    const damage = (state.rolled ?? []).length ? `<p class="pf2e-env-damage">Damage: ${state.rolled.map((part) => `<strong>${part.total}</strong> ${escapeHTML(part.type)} (${escapeHTML(part.formula)})`).join(" + ")}</p>` : "";
    const rows = state.targets.map((target) => {
        const degree = target.degree === "automatic" ? "—" : target.degree ? `${DEGREES[target.degree]}${Number.isFinite(target.total) ? ` (${target.total})` : ""}` : `<button type="button" data-env-action="roll" data-target="${target.id}"><i class="fa-solid fa-dice-d20"></i> Roll</button>`;
        return `<tr class="${target.applied ? "applied" : ""}"><td>${escapeHTML(target.name)}</td><td>${degree}</td><td>${target.applied ? '<i class="fa-solid fa-check"></i>' : ""}</td></tr>`;
    }).join("");
    const open = state.targets.some((target) => !target.applied && target.degree);
    const notes = (state.notes ?? []).map((note) => `<p class="pf2e-env-note">${escapeHTML(note)}</p>`).join("");
    return `<div class="pf2e-env-card" data-env-card>
        <header><strong>${escapeHTML(state.title)}</strong></header>
        ${check}${damage}
        <table class="pf2e-env-targets"><tbody>${rows}</tbody></table>
        ${open ? '<button type="button" data-env-action="apply" class="pf2e-env-apply"><i class="fa-solid fa-check-double"></i> Apply (GM)</button>' : ""}
        ${notes}
    </div>`;
}

// The card's buttons (renderChatMessageHTML).
export function bindCard(message, html) {
    const state = cardOf(message);
    if (!state) return;
    // (A player sees the Roll buttons of the creatures they own, and no Apply.)
    if (!game.user.isGM) {
        html.querySelectorAll('[data-env-action="apply"]').forEach((button) => button.remove());
        for (const button of html.querySelectorAll('[data-env-action="roll"]')) {
            const target = state.targets.find((entry) => entry.id === button.dataset.target);
            const actor = target ? fromUuidSync(target.actorUuid) : null;
            if (!actor?.isOwner) button.replaceWith(document.createTextNode("…"));
        }
    }
    html.querySelectorAll("[data-env-action]").forEach((button) => button.addEventListener("click", async (event) => {
        event.preventDefault();
        button.disabled = true;
        try {
            if (button.dataset.envAction === "roll") await rollTarget(message, button.dataset.target);
            else if (button.dataset.envAction === "apply") await applyCard(message);
        } catch (error) {
            ui.notifications.error(error.message);
            console.error(`${MODULE_ID} |`, error);
        } finally {
            button.disabled = false;
        }
    }));
}

async function rollTarget(message, targetId) {
    const state = cardOf(message);
    const target = state.targets.find((entry) => entry.id === targetId);
    const actor = target ? await fromUuid(target.actorUuid) : null;
    if (!actor) throw new Error("That creature isn't there any more.");
    if (!actor.isOwner) throw new Error(`Only ${target.name}'s owner or the GM rolls for it.`);
    const statistic = actor.getStatistic?.(state.check.statistic);
    if (!statistic) throw new Error(`${target.name} has no ${STATISTICS[state.check.statistic] ?? state.check.statistic}.`);
    // (Its own penalty on the check: a Small creature's −1 against the wind, a Tiny one's −2.)
    // (And one on every creature's: a jammed door's −2 to Force it Open.)
    const penalties = [state.check.penalties?.[targetId], state.check.penalty].filter(Boolean);
    const modifiers = game.pf2e?.Modifier ? penalties.map((penalty) => new game.pf2e.Modifier({ label: penalty.label, modifier: penalty.value, type: "circumstance" })) : [];
    // (The action's own roll options too — a crowbar's bonus to Force Open.)
    await statistic.roll({ dc: { value: state.check.dc, label: `${state.title} DC` }, identifier: identifierOf(message.id, targetId), skipDialog: true, extraRollOptions: ["environment", `environment:${state.key ?? "check"}`, ...(state.rollOptions ?? [])], ...(modifiers.length ? { modifiers } : {}) });
}

// A roll's message from a card's button (any client posts it; the active GM records it on the card).
export async function onRollMessage(message) {
    if (!isActiveGM()) return;
    const identifier = message.flags?.pf2e?.context?.identifier;
    if (typeof identifier !== "string" || !identifier.startsWith(`${MODULE_ID}:`)) return;
    const [, messageId, targetId] = identifier.split(":");
    const card = game.messages.get(messageId);
    const state = cardOf(card);
    if (!state) return;
    const outcome = message.flags.pf2e.context.outcome;
    const total = message.rolls?.[0]?.total ?? null;
    const next = { ...state, targets: state.targets.map((target) => (target.id === targetId ? { ...target, degree: outcome ?? target.degree, total } : target)) };
    await card.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${CARD}`]: next });
    // (A degree that drops it: the fall's hook before the GM's Apply, for what answers a fall — the item module's Tumbler's Belt, a Fall
    // Gently. { token, feet, message, targetId }.)
    const row = next.degrees?.[outcome];
    const feet = row?.falls?.feet ?? row?.pickedUp?.falling ?? null;
    const target = next.targets.find((entry) => entry.id === targetId);
    if (feet && target) {
        const token = await fromUuid(target.tokenUuid).catch(() => null);
        if (token) Hooks.callAll(`${MODULE_ID}.falling`, { token, feet, message: card, targetId });
    }
}

// Apply: each creature that has its degree and isn't done yet, marked done as it's applied (a second Apply while one runs does nothing).
// (Exported for the weather's own cards with no check, applied at once.)
const applying = new Set();
export async function applyCard(message) {
    if (!game.user.isGM) throw new Error("Only the GM applies the card.");
    if (applying.has(message.id)) return;
    applying.add(message.id);
    try {
        for (const target of cardOf(message).targets) {
            if (target.applied || !target.degree) continue;
            const token = await fromUuid(target.tokenUuid).catch(() => null);
            const state = cardOf(message);
            const row = target.degree === "automatic" ? state.automatic : state.degrees?.[target.degree];
            if (token?.actor && row) await applyRow(token, row, state);
            const next = { ...cardOf(message), targets: cardOf(message).targets.map((entry) => (entry.id === target.id ? { ...entry, applied: true } : entry)) };
            await message.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${CARD}`]: next });
        }
    } finally {
        applying.delete(message.id);
    }
}

async function applyRow(token, row, state) {
    const actor = token.actor;
    const parts = [];
    if (row.damage) for (const part of state.rolled ?? []) {
        const amount = Math.floor(part.total * row.damage);
        if (amount > 0) parts.push(`${amount}[${part.type}]`);
    }
    // (A fall, eased by what the creature has on it — the item module's Effects: a Tumbler's Belt's feet off, a wingsuit's no damage.)
    const fallFeet = row.falls?.feet ?? row.pickedUp?.falling ?? null;
    const fall = fallFeet === null ? null : easedFall(fallFeet, fallEasesOf(actor));
    if (fall?.damage) parts.push(`${fall.damage}[bludgeoning]`);
    if (fall?.by) {
        const reduced = fall.reductions.map((entry) => `${entry.amount} less from ${escapeHTML(entry.source ?? "an item")}`).join(", ");
        await noteToGM(`<p>${escapeHTML(token.name)}'s fall: ${fallFeet} feet, ${fall.damage ? `${fall.feet === fallFeet ? "" : `as if ${fall.feet}, `}${fall.damage} damage` : "no damage"}${reduced ? ` (${reduced})` : ""} (${escapeHTML(fall.by)}).</p>`, { title: "Falling" });
    }
    const live = parts.filter((part) => !part.startsWith("0["));
    if (live.length) {
        const DamageRoll = (CONFIG.Dice?.rolls ?? []).find((roll) => roll?.name === "DamageRoll");
        const roll = await new DamageRoll(live.length === 1 ? live[0] : `{${live.join(",")}}`).evaluate();
        await actor.applyDamage({ damage: roll, token });
    }
    if (row.persistent) await persistentDamage(actor, row.persistent.formula, row.persistent.type, token);
    for (const condition of row.conditions ?? []) await actor.increaseCondition?.(condition.slug);
    if (fall?.prone) await actor.increaseCondition?.("prone");
    // (A structure's card: what the degree does to it — opened, broken open, jammed, a success toward its lock. scripts/structures.js.)
    if (row.structure && state.structure) await applyStructure(state.structure, row.structure);
    // (2026-10-26, for the item module: the fall done — an Impact Foam Chassis used up, its foam around the creature.)
    if (fall) Hooks.callAll(`${MODULE_ID}.fell`, { token, feet: fallFeet, damage: fall.before, applied: fall.damage, reductions: fall.reductions });
    if (row.buried) await buryCreature(token, { snow: row.buried.snow, title: state.title, dc: state.check?.dc ?? 20, airless: Boolean(state.airless) });
    // (A failed Balance: back where its move started.)
    if (row.returnTo) await (token.document ?? token).update({ x: row.returnTo.x, y: row.returnTo.y, elevation: row.returnTo.elevation }, { teleport: true, animate: false, [MODULE_ID]: { forced: true } });
    if (row.carried) await pushToken(token, row.carried.feet, row.carried.direction);
    if (row.pushed) await pushToken(token, row.pushed.feet, row.pushed.direction);
    if (row.part) await partRegion(row.part);
    // (Dug out: the buried creature the card is for. Dead of suffocation: no Hit Points left, dying at its most for a character.)
    if (row.free) {
        const buried = await fromUuid(row.free).catch(() => null);
        if (buried?.actor) await freeCreature(buried.actor);
    }
    if (row.dies) {
        await actor.update({ "system.attributes.hp.value": 0 });
        if (actor.type === "character") await actor.increaseCondition?.("dying", { value: Number(actor.system?.attributes?.dying?.max) || 4 });
        if (token.combatant) await token.combatant.update({ defeated: true });
        // (PF2e's dead marker on the token, a character's too.)
        try {
            await actor.toggleStatusEffect?.("dead", { active: true, overlay: true });
        } catch (error) {
            console.warn(`${MODULE_ID} | the dead marker on ${actor.name}:`, error);
        }
    }
}

// Damage with no check, applied at once (the weather's ticks): one roll a creature, PF2e's damage message for each.
export async function hitTokens(tokens, { formula, type, label, persistent = false }) {
    for (const token of tokens) {
        try {
            await dealDamage(token, formula, type, { label, persistent });
        } catch (error) {
            console.warn(`${MODULE_ID} | ${label} on ${token.name}:`, error);
        }
    }
}
