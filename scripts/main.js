// PF2e Automatic Environment Resolution: GM Core's environment rules in play (the user, 2026-10-25: "weather effect toggles for a combat
// automatically … everything from the environment section of the GM Core"). The GM's Environment window sets a scene's weather, its
// ground and its regions' terrain, and sets off natural disasters; the module keeps every creature's Effect in step, rolls the weather's
// flat checks on attacks, and deals its damage each turn and on the world clock (docs/design.md).

import { FLAG, MODULE_ID, isActiveGM, sceneData, sceneState, setSceneState } from "./foundry.js";
import { EnvironmentApp } from "./panel.js";
import { clearActor, syncScene, syncToken } from "./sync.js";
import { onAttackMessage } from "./attacks.js";
import { bindCard, onRollMessage, postCard } from "./cards.js";
import { onBreathMessage } from "./breath.js";
import { onTurnEnd, onTurnStart, onWorldTime } from "./ticks.js";
import { migrateRegions, regionEvent, setRegionFeature, setSceneGround } from "./regions.js";
import { installStairsCost } from "./stairs.js";
import { windMoveGate } from "./wind.js";
import { onSpellCast, targetFlatCheck } from "./spells.js";
import { disasterCard } from "../../pf2e-resolution-core/src/environment/disasters.js";
import { DAMAGE_CATEGORIES, setCategoryDefaults } from "../../pf2e-resolution-core/src/environment/catalog.js";
import { creatureEffect, flatCheckFor, normalizeState } from "../../pf2e-resolution-core/src/environment/weather.js";

const open = (scene = canvas?.scene) => new EnvironmentApp(scene).render(true);

Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "askAfter", {
        name: "Long time skips",
        hint: "When the world clock jumps more than this many seconds at once (a rest, a journey), the weather's damage is posted for the GM to apply instead of applied at once.",
        scope: "world",
        config: true,
        type: Number,
        default: 3600
    });
    for (const [key, category] of Object.entries(DAMAGE_CATEGORIES)) {
        game.settings.register(MODULE_ID, `dice.${key}`, {
            name: `${category.label} environmental damage (d6s)`,
            hint: `GM Core's ${category.label.toLowerCase()} damage is ${category.min}d6–${category.max}d6: the number of d6s the weather and terrain roll, and a disaster's default.`,
            scope: "world",
            config: true,
            type: Number,
            default: category.dice,
            onChange: () => setCategoryDefaults(categoryDefaults())
        });
    }
});

const categoryDefaults = () => Object.fromEntries(Object.keys(DAMAGE_CATEGORIES).map((key) => [key, game.settings.get(MODULE_ID, `dice.${key}`)]));

Hooks.once("ready", () => {
    setCategoryDefaults(categoryDefaults());
    const module = game.modules.get(MODULE_ID);
    if (module) module.api = Object.freeze({
        open,
        weather: (scene = canvas?.scene) => sceneState(scene),
        setWeather: (scene, raw) => setSceneState(scene, raw),
        postDisaster: (key, options = {}, tokens = canvas?.tokens?.controlled ?? []) => postCard(disasterCard(key, options), tokens),
        setRegionFeature,
        setSceneGround,
        regionEvent,
        // (For a spell's targeting: the weather's flat check between two tokens, { dc, why } or null — scripts/spells.js.)
        targetFlatCheck,
        sync: syncScene,
        rules: Object.freeze({ creatureEffect, flatCheckFor, normalizeState })
    });
    if (isActiveGM() && canvas?.scene) syncScene(canvas.scene);
    // (Stairs: their cost going up — every client measures movement.)
    installStairsCost();
    if (isActiveGM()) migrateRegions().catch((error) => console.warn(`${MODULE_ID} | updating regions:`, error));
});

// (A creature fighting the wind to move: its Athletics first — scripts/wind.js.)
Hooks.on("preMoveToken", (token, movement, options) => windMoveGate(token, movement, options));

Hooks.on("canvasReady", (canvas) => {
    if (isActiveGM()) syncScene(canvas.scene);
});

// (The scene's weather or shelter changed: every creature on it. The clock alone moving doesn't count.)
const seen = new Map();
Hooks.on("updateScene", (scene, change) => {
    if (!isActiveGM() || !foundry.utils.hasProperty(change, `flags.${MODULE_ID}.${FLAG}`)) return;
    const data = sceneData(scene);
    const signature = JSON.stringify([data.state, data.sheltered]);
    if (seen.get(scene.id) === signature) return;
    seen.set(scene.id, signature);
    syncScene(scene);
});

// (A protection put on or taken off — an elixir's Effect, a parka worn: its tokens' weather Effects say so. The damage reads them live.)
const protects = (item, change = null) => Boolean(item?.flags?.[MODULE_ID]?.temperature) || (item?.isOfType?.("physical") && (!change || foundry.utils.hasProperty(change, "system.equipped")));
const resyncActor = (actor) => {
    if (!isActiveGM() || !actor) return;
    for (const token of actor.getActiveTokens?.(false, true) ?? []) syncToken(token);
};
Hooks.on("createItem", (item) => protects(item) && resyncActor(item.parent));
Hooks.on("deleteItem", (item) => protects(item) && resyncActor(item.parent));
Hooks.on("updateItem", (item, change) => protects(item, change) && resyncActor(item.parent));

Hooks.on("createToken", (token) => {
    if (isActiveGM()) syncToken(token);
});
Hooks.on("deleteToken", (token) => {
    // (A linked actor taken off the scene: its weather goes with it, unless another of its tokens is still out.)
    if (!isActiveGM() || !token.actorLink || !token.actor) return;
    const elsewhere = game.scenes.some((scene) => scene.tokens.some((other) => other.id !== token.id && other.actorId === token.actorId && other.actorLink));
    if (!elsewhere) clearActor(token.actor);
});

Hooks.on("pf2e.startTurn", (combatant, encounter) => onTurnStart(combatant, encounter));
Hooks.on("pf2e.endTurn", (combatant, encounter) => onTurnEnd(combatant, encounter));
Hooks.on("updateWorldTime", (worldTime) => onWorldTime(worldTime));
Hooks.on("createChatMessage", (message) => {
    onAttackMessage(message).catch((error) => console.error(`${MODULE_ID} |`, error));
    onRollMessage(message).catch((error) => console.error(`${MODULE_ID} |`, error));
    onBreathMessage(message).catch((error) => console.error(`${MODULE_ID} |`, error));
    onSpellCast(message).catch((error) => console.error(`${MODULE_ID} |`, error));
});
Hooks.on("renderChatMessageHTML", (message, html) => bindCard(message, html));

// The GM's way in: a button on the combat tracker, and one among the token tools.
Hooks.on("renderCombatTracker", (app, html) => {
    if (!game.user.isGM) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".pf2e-env-open")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pf2e-env-open";
    button.title = "Weather, ground and natural disasters for this scene";
    button.innerHTML = '<i class="fa-solid fa-cloud-sun-rain"></i> Environment';
    button.addEventListener("click", () => open());
    (root.querySelector(".combat-tracker-header, header") ?? root).prepend(button);
});

Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    const tokens = controls.tokens ?? controls.token ?? (Array.isArray(controls) ? controls.find((control) => control.name === "token") : null);
    if (!tokens) return;
    const tool = { name: "environment", title: "Environment", icon: "fa-solid fa-cloud-sun-rain", button: true, visible: true, order: 99, onChange: () => open(), onClick: () => open() };
    if (Array.isArray(tokens.tools)) tokens.tools.push(tool);
    else tokens.tools.environment = tool;
});
