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
