// The weather on the scene to see (the user, 2026-10-26: "apply a weather effect to the scene automatically … a toggle-able menu next to
// the weather with all available options in case more are added from other modules"): Foundry's own weather effect (the Scene's
// `weather`, from CONFIG.weatherEffects — rain, snow, fog… and whatever other modules add there), set from the module's weather. A scene
// shows one at a time: the heaviest weather that has a look. Each weather's menu picks Automatic (its level's look, autoLook), None, or any
// look Foundry knows; the window's switch turns it off for the scene. The scene's own weather from before the module changed it comes back
// when the module's weather ends, unless the GM has since picked another one by hand. Run on the active GM's client.

import { MODULE_ID, isActiveGM, sceneState } from "./foundry.js";
import { effectiveWeather } from "../../pf2e-resolution-core/src/environment/weather.js";

export const VISUALS = "visuals";
// The heaviest first: the one a scene shows.
export const LOOK_ORDER = ["thunderstorm", "precipitation", "sandstorm", "ash", "smoke", "fog", "wind", "current", "underwater"];
const HEAVY = new Set(["heavy", "downpour", "deluge"]);

// The look Foundry's own effects give a weather at its level ("" for none): rain or a rain storm, snow or a blizzard, fog for what hangs
// in the air. Wind, currents and water have none of their own (Autumn Leaves can be picked for wind).
export function autoLook(toggle, entry, weather = {}) {
    if (!entry) return "";
    switch (toggle) {
        case "thunderstorm":
            return weather.precipitation?.kind === "snow" ? "blizzard" : "rainStorm";
        case "precipitation":
            if (entry.kind === "snow") return HEAVY.has(entry.level) ? "blizzard" : "snow";
            if (entry.kind === "hail") return "rainStorm";
            return HEAVY.has(entry.level) ? "rainStorm" : "rain";
        case "fog":
        case "smoke":
        case "ash":
        case "sandstorm":
            return "fog";
        default:
            return "";
    }
}

// The scene's look: the heaviest weather's pick that Foundry has, or "" for none. visuals { on, looks: { toggle: "auto" | "none" | key } };
// a pick Foundry no longer has (its module gone) counts as Automatic.
export function sceneLook(state, visuals = {}, available = new Set()) {
    if (visuals?.on === false) return "";
    const weather = effectiveWeather(state);
    for (const toggle of LOOK_ORDER) {
        const entry = weather[toggle];
        if (!entry) continue;
        const pick = visuals?.looks?.[toggle] ?? "auto";
        if (pick === "none") continue;
        const look = pick !== "auto" && available.has(pick) ? pick : autoLook(toggle, entry, weather);
        if (look && available.has(look)) return look;
    }
    return "";
}

export function visualsOf(scene) {
    const data = scene?.getFlag?.(MODULE_ID, VISUALS) ?? {};
    return { on: data.on !== false, looks: data.looks ?? {}, shown: data.shown ?? null, before: data.before ?? "" };
}

// Every look Foundry knows, for the menus: [{ key, label }], other modules' too.
export const availableLooks = () => Object.entries(CONFIG.weatherEffects ?? {}).map(([key, entry]) => ({ key, label: game.i18n.localize(entry?.label ?? key) }));

// The GM's picks from the window.
export async function setVisuals(scene, { on, looks }) {
    return scene.setFlag(MODULE_ID, VISUALS, { on: on !== false, looks });
}

// The scene's weather look brought in step, one change at a time per scene. (A new look redraws the canvas on every client: only when it
// changes.)
const queue = new Map();
export function syncVisuals(scene) {
    if (!scene || !isActiveGM()) return Promise.resolve();
    const next = (queue.get(scene.id) ?? Promise.resolve()).then(() => applyLook(scene)).catch((error) => console.warn(`${MODULE_ID} | ${scene.name}'s weather look:`, error));
    queue.set(scene.id, next);
    return next;
}

async function applyLook(scene) {
    const visuals = visualsOf(scene);
    const look = sceneLook(sceneState(scene), visuals, new Set(Object.keys(CONFIG.weatherEffects ?? {})));
    const current = scene.weather ?? "";
    const path = `flags.${MODULE_ID}.${VISUALS}`;
    if (look) {
        if (look === current && visuals.shown === look) return;
        // (The scene's own weather, kept from the first time the module changed it.)
        const before = visuals.shown === null ? current : visuals.before;
        await scene.update({ weather: look, [`${path}.shown`]: look, [`${path}.before`]: before });
        return;
    }
    if (visuals.shown === null) return;
    // (Nothing of the module's to show: the scene's own weather back, unless the GM has picked another one by hand since.)
    await scene.update({ ...(current === visuals.shown ? { weather: visuals.before } : {}), [`${path}.shown`]: null, [`${path}.before`]: null });
}
