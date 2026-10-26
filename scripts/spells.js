// A spell aimed at creatures — not an area, and not a spell attack (attacks.js rolls those after the attack roll) — through weather that
// conceals or hides them past a distance: the flat check for each such target, rolled as the spell is cast (the active GM's client). A miss
// is left out of the spell: the spell module (pf2e-automatic-resolution) reads the cast message's `targetMisses` when it resolves the spell,
// and its own features add to that list; this adds the weather's, merged with what's there (its concealed and hidden targets' check writes
// the list whole, so the weather's misses are merged back after it). Targets PF2e marks concealed or hidden are the spell module's to roll.
// Without the spell module, the card tells the GM.

import { MODULE_ID, creatureOf, distanceBetween, escapeHTML, isActiveGM, sceneState } from "./foundry.js";
import { flatCheckFor } from "../../pf2e-resolution-core/src/environment/weather.js";

const SPELL_ID = "pf2e-automatic-resolution";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The weather's flat check between two tokens: { dc, why } or null.
export function targetFlatCheck(casterToken, targetToken) {
    const caster = casterToken?.document ?? casterToken;
    const target = targetToken?.document ?? targetToken;
    if (!caster?.parent || !target || caster.parent !== target.parent) return null;
    return flatCheckFor(sceneState(caster.parent), { attacker: creatureOf(caster), target: creatureOf(target), distance: distanceBetween(caster, target) });
}

export async function onSpellCast(message) {
    if (!isActiveGM() || !message.flags?.pf2e?.casting || message.flags?.pf2e?.origin?.type !== "spell") return;
    const spell = message.item;
    const caster = message.token;
    if (!spell || !caster || !String(spell.system?.target?.value ?? "").trim()) return;
    if ((spell.system?.traits?.value ?? []).includes("attack")) return;
    const targets = [...(message.author?.targets ?? [])].map((token) => token.document ?? token).filter((token) => token?.actor && token.actor !== message.actor && token.parent === caster.parent);
    const lines = [];
    const misses = [];
    for (const target of targets) {
        if (target.actor.hasCondition?.("concealed") || target.actor.hasCondition?.("hidden")) continue;
        const check = targetFlatCheck(caster, target);
        if (!check) continue;
        const roll = await new Roll("1d20").evaluate();
        const hit = roll.total >= check.dc;
        if (!hit) misses.push(target.actor.uuid);
        lines.push(`<p>${escapeHTML(target.name)} — ${escapeHTML(check.why)}: flat check DC ${check.dc} — <strong>${roll.total}</strong>. ${hit ? "The spell can target it." : `${escapeHTML(spell.name)} fails to affect it.`}</p>`);
    }
    if (!lines.length) return;
    const spellModule = game.modules.get(SPELL_ID)?.active;
    await ChatMessage.create({
        content: `<div class="pf2e-env-card"><header><strong>Weather</strong>: ${escapeHTML(spell.name)}</header>${lines.join("")}${misses.length && !spellModule ? "<p class=\"pf2e-env-note\">Leave the creatures it fails to affect out of the spell.</p>" : ""}</div>`,
        speaker: { alias: "Environment" },
        flags: { [MODULE_ID]: { spellCast: message.id } }
    });
    if (misses.length && spellModule) await keepMisses(message, misses);
}

// The weather's misses in the spell module's list, now and again after its own flat checks have had time to land.
async function keepMisses(message, misses) {
    const merge = async () => {
        const current = message.getFlag(SPELL_ID, "targetMisses") ?? [];
        const next = [...new Set([...current, ...misses])];
        if (next.length !== current.length) await message.setFlag(SPELL_ID, "targetMisses", next);
    };
    await merge();
    for (const ms of [1500, 4000]) {
        await wait(ms);
        await merge();
    }
}
