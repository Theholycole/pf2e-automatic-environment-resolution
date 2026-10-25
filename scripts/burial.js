// Buried (GM Core pg. 96): an avalanche's, a collapse's or a pyroclastic flow's victims. An Effect granting restrained, with the minor
// bludgeoning damage each minute (and minor cold under snow) on the world clock (scripts/ticks.js); others dig the creature out — the
// "Dig out" card, an Athletics check for each digger: a success frees it after 4 minutes of digging (2 on a critical success).

import { MODULE_ID } from "./foundry.js";
import { burialDamage } from "../src/rules/ticks.js";
import { categoryDice } from "../src/rules/catalog.js";

const RESTRAINED = "Compendium.pf2e.conditionitems.Item.VcDeM8A5oI6VqhbM";
const BURIED = "buried";

export const buriedEffectOf = (actor) => (actor?.itemTypes?.effect ?? []).find((effect) => effect.flags?.[MODULE_ID]?.[BURIED]) ?? null;

export async function buryCreature(tokenDoc, { snow = false, title = "Buried", dc = 20, airless = false } = {}) {
    const actor = tokenDoc?.actor;
    if (!actor || buriedEffectOf(actor)) return;
    await actor.createEmbeddedDocuments("Item", [{
        name: `Buried (${title})`,
        type: "effect",
        img: "icons/environment/wilderness/cave-entrance-rocky.webp",
        system: {
            slug: "environment-buried",
            duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
            rules: [{ key: "GrantItem", uuid: RESTRAINED, flag: "buriedRestrained", allowDuplicate: true, onDeleteActions: { granter: "cascade", grantee: "cascade" } }],
            description: { value: `<p>Buried: restrained, and usually can't free itself. Minor bludgeoning damage each minute${snow ? ", and minor cold damage under the snow" : ""}${airless ? "; no air pocket, so it holds its breath" : ""}. Others dig it out: a 5-foot square every 4 minutes on a successful Athletics check (2 on a critical success), half that with shovels or other tools.</p>` }
        },
        flags: { [MODULE_ID]: { [BURIED]: { since: game.time.worldTime, snow, dc, airless } } }
    }]);
}

export async function freeCreature(actor) {
    const effect = buriedEffectOf(actor);
    if (effect) await actor.deleteEmbeddedDocuments("Item", [effect.id]);
}

// Burial's damage between two world times, for each buried creature on the scene: [{ token, hits }].
export function burialHits(scene, from, to) {
    const due = [];
    for (const token of scene?.tokens ?? []) {
        const buried = buriedEffectOf(token.actor)?.flags?.[MODULE_ID]?.[BURIED];
        if (!buried) continue;
        const hits = burialDamage({ from, to, since: buried.since, snow: buried.snow }).map((hit) => ({ ...hit, formula: categoryDice(hit.category, null, { times: hit.count }) }));
        if (hits.length) due.push({ token, hits });
    }
    return due;
}

// The dig-out card: each digger's Athletics check; a success frees the buried creature.
export function digCard(buriedToken, dc) {
    return {
        key: "dig-out",
        title: `Dig out ${buriedToken.name}`,
        check: { statistic: "athletics", dc, basic: false },
        damage: [],
        degrees: {
            criticalSuccess: { free: buriedToken.document?.uuid ?? buriedToken.uuid, minutes: 2 },
            success: { free: buriedToken.document?.uuid ?? buriedToken.uuid, minutes: 4 },
            failure: {},
            criticalFailure: {}
        },
        notes: ["A success clears the creature's square after 4 minutes of digging (2 on a critical success); shovels or other tools halve the time."]
    };
}
