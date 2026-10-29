import test from "node:test";
import assert from "node:assert/strict";

// The Foundry side's pure parts, and that every script loads (Foundry's globals stubbed).
globalThis.foundry = { applications: { api: { ApplicationV2: class {} } }, utils: { hasProperty: () => false, expandObject: (value) => value, escapeHTML: (value) => value } };
globalThis.Hooks = { once() {}, on() {} };
globalThis.game = { settings: { register() {}, get: () => 3600 }, users: { activeGM: null }, user: { isGM: true } };

test("every script loads", async () => {
    await import("../scripts/main.js");
});

test("a push: square by square, every second diagonal 10 feet", async () => {
    const { pushSquares } = await import("../scripts/movement.js");
    assert.equal(pushSquares(20, "E").length, 4);
    assert.equal(pushSquares(20, "NE").length, 3, "5 + 10 + 5");
    assert.equal(pushSquares(15, "NE").length, 2);
    assert.deepEqual(pushSquares(10, "S"), [[0, 1], [0, 1]]);
    assert.deepEqual(pushSquares(10, "nowhere"), []);
});

test("a card: its check, its rolled damage, a roll button for each creature until it rolls", async () => {
    const { cardHTML } = await import("../scripts/cards.js");
    const html = cardHTML({ title: "Avalanche", check: { statistic: "reflex", dc: 30, basic: false }, rolled: [{ formula: "10d6", type: "bludgeoning", total: 33 }], targets: [{ id: "t0", name: "Ezren", degree: null }, { id: "t1", name: "Kyra", degree: "success", total: 31 }], notes: ["Buried creatures…"] });
    assert.match(html, /Reflex save, DC 30/);
    assert.match(html, /<strong>33<\/strong> bludgeoning \(10d6\)/);
    assert.match(html, /data-env-action="roll" data-target="t0"/);
    assert.match(html, /Success \(31\)/);
    assert.match(html, /Apply \(GM\)/);
});

test("the scene's state written out in full: a toggle switched off is null, a field left empty is null (Foundry merges flags)", async () => {
    const { fullState } = await import("../scripts/foundry.js");
    const state = fullState({ fog: { level: "thick", beyond: 25 } });
    assert.equal(state.precipitation, null);
    assert.equal(state.fog.beyond, 25);
    assert.equal(state.fog.kind, null);
    assert.equal(state.temperature, "normal");
    assert.equal(fullState({ fog: { beyond: 25 } }).fog, null, "no level: off");
});

test("a Balance card for a move: a failure back where the move started, a critical failure there and prone", async () => {
    const { balanceCard } = await import("../scripts/regions.js");
    const { featureRules } = await import("../../pf2e-resolution-core/src/environment/terrain.js");
    const card = balanceCard(featureRules("ice"), { x: 300, y: 400, elevation: 0 });
    assert.deepEqual(card.degrees.failure, { returnTo: { x: 300, y: 400, elevation: 0 } });
    assert.deepEqual(card.degrees.criticalFailure.conditions, [{ slug: "prone" }]);
    assert.deepEqual(balanceCard(featureRules("ice")).degrees.failure, {}, "no move to go back from");
});

test("the wind's card for a creature moving on the ground: its size's penalty, knocked back and prone on a critical failure", async () => {
    const { windCard } = await import("../scripts/wind.js");
    const card = windCard({ name: "Kobold" }, { wind: { label: "Windstorm" }, dc: 20, direction: "E", size: "sm" }, { combatantId: "c1", round: 2 });
    assert.deepEqual(card.check.penalties.t0, { value: -1, label: "Size in the wind" });
    assert.deepEqual(card.degrees.criticalFailure.pushed, { feet: 10, direction: "E" });
    assert.deepEqual(card.groundWind, { combatantId: "c1", round: 2 });
});

test("a creature's temperature protections: its Effects' flags (not run out) and the item module's api", async () => {
    const { protectionsOf } = await import("../scripts/foundry.js");
    const flag = (temperature, extra = {}) => ({ flags: { "pf2e-automatic-environment-resolution": { temperature } }, ...extra });
    const actor = { name: "Ezren", itemTypes: { effect: [flag({ counts: { "severe-heat": "mild-heat" }, source: "Cooling Elixir" }), flag({ counts: { "extreme-cold": "severe-cold" }, source: "Rime Jar" }, { isExpired: true }), { flags: {} }] } };
    globalThis.game.modules = new Map([["pf2e-automatic-item-resolution", { active: true, api: { temperatureProtections: () => [{ counts: { "severe-cold": "normal" }, source: "Warming Parka" }, { source: "no counts" }] } }]]);
    assert.deepEqual(protectionsOf(actor).map((entry) => entry.source), ["Cooling Elixir", "Warming Parka"]);
    globalThis.game.modules = new Map([["pf2e-automatic-item-resolution", { active: true, api: { temperatureProtections: () => { throw new Error("boom"); } } }]]);
    const warn = console.warn;
    console.warn = () => {};
    assert.deepEqual(protectionsOf(actor).map((entry) => entry.source), ["Cooling Elixir"]);
    console.warn = warn;
    globalThis.game.modules = new Map();
    assert.equal(protectionsOf(actor).length, 1);
});

test("what eases a creature's falls: its Effects' fall flags that haven't run out", async () => {
    const { fallEasesOf } = await import("../scripts/foundry.js");
    const fall = (entry, extra = {}) => ({ flags: { "pf2e-automatic-environment-resolution": { fall: entry } }, ...extra });
    const actor = { itemTypes: { effect: [fall({ shorter: 120, source: "Tumbler's Belt" }), fall({ noDamage: true, source: "Dragonaut's Wingsuit" }, { isExpired: true }), fall({ shorter: 0, source: "nothing" }), { flags: {} }] } };
    assert.deepEqual(fallEasesOf(actor).map((entry) => entry.source), ["Tumbler's Belt"]);
    globalThis.game.modules = new Map([["pf2e-automatic-item-resolution", { active: true, api: { fallEases: () => [{ shorter: 25, source: "Gliding Membranes" }, { landsOnFeet: true, source: "Cat" }, { source: "nothing" }, { nonlethal: true, landCheck: { statistics: ["athletics"], dc: 10 }, source: "Jelly" }] } }]]);
    assert.deepEqual(fallEasesOf(actor).map((entry) => entry.source), ["Tumbler's Belt", "Gliding Membranes", "Cat", "Jelly"]);
    globalThis.game.modules = new Map();
});

test("2026-10-29, Impact Jelly: a nonlethal fall knocks out instead of dying; the best statistic rolls to land standing", async () => {
    const { landStanding, nonlethalDamage } = await import("../scripts/foundry.js");
    const done = [];
    globalThis.CONFIG = { Dice: { rolls: [class DamageRoll { constructor(formula) { this.formula = formula; } async evaluate() { return this; } }] } };
    const creature = (hp, extra = {}) => {
        const actor = { hitPoints: { value: hp }, statuses: new Set(), conditions: [], itemTypes: { condition: [{ slug: "dying", delete: async () => done.push("dying off") }] },
            async applyDamage({ damage, rollOptions, token }) {
                done.push(`${damage.formula} ${[...rollOptions].join(" ")}`);
                actor.hitPoints.value = Math.max(0, actor.hitPoints.value - parseInt(damage.formula, 10));
                // (PF2e's at 0: no dying or unconscious, so dead, and an NPC's combatant defeated.)
                if (!actor.hitPoints.value) (actor.statuses.add("dead"), token?.combatant && (token.combatant.isDefeated = true));
            },
            async toggleStatusEffect(slug, { active }) { if (!active) actor.statuses.delete(slug); done.push(`${slug} ${active}`); },
            hasCondition: (slug) => actor.conditions.includes(slug), async increaseCondition(slug) { actor.conditions.push(slug); }, ...extra };
        return actor;
    };
    const combatant = { isDefeated: false, async update({ defeated }) { done.push(`defeated ${defeated}`); combatant.isDefeated = defeated; } };
    const dropped = creature(10);
    const token = { combatant, get document() { return this; } };
    assert.equal(await nonlethalDamage(dropped, "15[bludgeoning]", token), true);
    assert.deepEqual(dropped.conditions, ["unconscious"]);
    assert.deepEqual(done, ["15[bludgeoning] nonlethal damage:trait:nonlethal", "dying off", "defeated false", "dead false"]);
    assert.equal(combatant.isDefeated, false);
    const hurt = creature(30);
    assert.equal(await nonlethalDamage(hurt, "15[bludgeoning]"), false, "still standing");
    assert.deepEqual(hurt.conditions, []);
    // (Its best: Athletics +9 over Acrobatics +5, against the check's DC.)
    const rolled = [];
    const statistic = (slug, mod) => ({ slug, mod, roll: async (args) => (rolled.push([slug, args.dc.value, args.skipDialog]), { degreeOfSuccess: mod + 10 >= args.dc.value ? 2 : 1 }) });
    const lander = { getStatistic: (slug) => ({ acrobatics: statistic("acrobatics", 5), athletics: statistic("athletics", 9) })[slug] };
    assert.equal(await landStanding(lander, { statistics: ["acrobatics", "athletics"], dc: 18, source: "Impact Jelly" }), true);
    assert.equal(await landStanding(lander, { statistics: ["acrobatics", "athletics"], dc: 25, source: "Impact Jelly" }), false);
    assert.deepEqual(rolled, [["athletics", 18, true], ["athletics", 25, true]]);
    assert.equal(await landStanding({ getStatistic: () => null }, { statistics: ["acrobatics"], dc: 10 }), false);
    delete globalThis.CONFIG;
});

test("what of the weather a creature ignores: its Effects' weatherIgnores flags (not the module's own weather mark) and the item module's api", async () => {
    const { weatherIgnoresOf } = await import("../scripts/foundry.js");
    const flag = (value) => ({ flags: { "pf2e-automatic-environment-resolution": value } });
    const actor = { itemTypes: { effect: [flag({ weatherIgnores: { ignores: ["fog-mist"], source: "Ixamè's Eye" } }), flag({ weather: true }), flag({ weatherIgnores: { source: "no keys" } })] } };
    globalThis.game.modules = new Map([["pf2e-automatic-item-resolution", { active: true, api: { weatherIgnores: () => [{ ignores: ["sight", "concealment", "wind-movement"], source: "Cape of the Open Sky" }] } }]]);
    assert.deepEqual(weatherIgnoresOf(actor).map((entry) => entry.source), ["Ixamè's Eye", "Cape of the Open Sky"]);
    globalThis.game.modules = new Map();
});

test("the scene's weather look: the heaviest weather's, its level's own or the GM's pick, other modules' looks too (2026-10-26)", async () => {
    const { autoLook, sceneLook } = await import("../scripts/visuals.js");
    const { normalizeState } = await import("../../pf2e-resolution-core/src/environment/weather.js");
    const foundry = new Set(["leaves", "rain", "rainStorm", "fog", "snow", "blizzard"]);
    const state = (raw) => normalizeState(raw);
    assert.equal(autoLook("precipitation", { level: "light", kind: "rain" }), "rain");
    assert.equal(autoLook("precipitation", { level: "downpour", kind: "rain" }), "rainStorm");
    assert.equal(autoLook("precipitation", { level: "moderate", kind: "snow" }), "snow");
    assert.equal(autoLook("precipitation", { level: "heavy", kind: "snow" }), "blizzard");
    assert.equal(autoLook("wind", { level: "strong" }), "", "wind has none of its own");
    assert.equal(sceneLook(state({}), {}, foundry), "", "no weather, no look");
    assert.equal(sceneLook(state({ fog: { level: "thick" } }), {}, foundry), "fog");
    assert.equal(sceneLook(state({ fog: { level: "thick" }, precipitation: { level: "light", kind: "snow" } }), {}, foundry), "snow", "the heavier weather's");
    assert.equal(sceneLook(state({ thunderstorm: { level: "storm" }, fog: { level: "light" } }), {}, foundry), "rainStorm");
    assert.equal(sceneLook(state({ fog: { level: "light" } }), { on: false }, foundry), "", "switched off for the scene");
    assert.equal(sceneLook(state({ fog: { level: "light" }, wind: { level: "strong" } }), { looks: { fog: "none", wind: "leaves" } }, foundry), "leaves", "None passes to the next weather");
    assert.equal(sceneLook(state({ sandstorm: { level: "mild" } }), { looks: { sandstorm: "fxDust" } }, new Set([...foundry, "fxDust"])), "fxDust", "another module's look");
    assert.equal(sceneLook(state({ sandstorm: { level: "mild" } }), { looks: { sandstorm: "fxDust" } }, foundry), "fog", "a look Foundry no longer has: Automatic");
});
