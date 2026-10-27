// The GM's Environment window for a scene: the weather toggles at their levels, the temperature, a journey's fatigue, the creatures
// sheltered from it; the ground of the scene and of its regions; the natural disasters; doors, walls and portcullises for reference.

import { MODULE_ID, escapeHTML, sceneData, setSceneState, setSheltered } from "./foundry.js";
import { DAMAGE_CATEGORIES, DIRECTIONS, DISASTERS, FEATURES, FORCE_OPEN, STRUCTURES, TEMPERATURES, WEATHER, temperatureFromFahrenheit } from "../../pf2e-resolution-core/src/environment/catalog.js";
import { bandDC, disasterCard, disasterCategories } from "../../pf2e-resolution-core/src/environment/disasters.js";
import { FEATURE_GROUPS, featureRules } from "../../pf2e-resolution-core/src/environment/terrain.js";
import { creatureEffect, normalizeState } from "../../pf2e-resolution-core/src/environment/weather.js";
import { igniteGas, partCrowd, regionFeature, sceneGround, setRegionFeature, setSceneGround } from "./regions.js";
import { postCard } from "./cards.js";
import { buriedEffectOf, digCard, freeCreature } from "./burial.js";
import { creatureOf, isCreature } from "./foundry.js";
import { LOOK_ORDER, autoLook, availableLooks, sceneLook, setVisuals, visualsOf } from "./visuals.js";

const { ApplicationV2 } = foundry.applications.api;

const option = (value, label, selected) => `<option value="${escapeHTML(value)}"${String(selected ?? "") === String(value) ? " selected" : ""}>${escapeHTML(label)}</option>`;
const directionSelect = (name, value) => `<select name="${name}">${Object.keys(DIRECTIONS).map((key) => option(key, key, value)).join("")}</select>`;
const featureSelect = (name, value) => `<select name="${name}">${option("", "None", value)}${FEATURE_GROUPS.map(([group, keys]) => `<optgroup label="${escapeHTML(group)}">${keys.map((key) => option(key, FEATURES[key].label, value)).join("")}</optgroup>`).join("")}</select>`;
const selectedTokens = () => canvas?.tokens?.controlled ?? [];
// (A weather's look on the scene: Automatic, None, or any of Foundry's weather effects, other modules' included — scripts/visuals.js.)
function lookSelect(toggle, pick, auto, looks) {
    const labelOf = (key) => looks.find((look) => look.key === key)?.label ?? "";
    return `<label class="pf2e-env-look" title="Foundry's weather effect on the scene for it, when it's the heaviest weather that's on">Look <select name="look.${toggle}">${option("auto", `Automatic (${labelOf(auto) || "none"})`, pick ?? "auto")}${option("none", "None", pick)}${looks.map((look) => option(look.key, look.label, pick)).join("")}</select></label>`;
}
const targetedTokens = () => [...(game.user?.targets ?? [])];

// The weather toggles' extra fields.
function weatherFields(toggle, entry) {
    const fields = [];
    if (toggle === "precipitation") fields.push(`<select name="precipitation.kind">${Object.entries(WEATHER.precipitation.kinds).map(([key, kind]) => option(key, kind.label, entry?.kind ?? "rain")).join("")}</select>`);
    if (["fog", "precipitation", "smoke", "ash", "sandstorm"].includes(toggle)) fields.push(`<label title="Creatures farther than this are concealed (0: every creature)">Concealed beyond <input type="number" min="0" step="5" name="${toggle}.beyond" value="${entry?.beyond ?? ""}" placeholder="level's"> ft</label>`);
    if (toggle === "underwater") fields.push(`<label>Hidden beyond <input type="number" min="0" step="5" name="underwater.hiddenBeyond" value="${entry?.hiddenBeyond ?? ""}" placeholder="level's"> ft</label>`);
    if (toggle === "wind") fields.push(`<label>From ${directionSelect("wind.direction", entry?.direction ?? "E")}</label>`, `<label>Flight DC <input type="number" name="wind.flightDC" value="${entry?.flightDC ?? ""}" placeholder="level's"></label>`, `<label>Ground DC <input type="number" name="wind.groundDC" value="${entry?.groundDC ?? ""}" placeholder="level's"></label>`, `<label>Blown <input type="number" step="5" name="wind.blownFeet" value="${entry?.blownFeet ?? ""}" placeholder="level's"> ft</label>`);
    if (toggle === "current") fields.push(`<label>Toward ${directionSelect("current.direction", entry?.direction ?? "S")}</label>`, `<label><input type="number" step="5" name="current.feet" value="${entry?.feet ?? ""}" placeholder="level's"> ft</label>`);
    if (toggle === "thunderstorm") fields.push(`<label title="Each exposed creature, each minute">Lightning 1 in <input type="number" min="0" name="thunderstorm.chance" value="${entry?.chance ?? WEATHER.thunderstorm.chance}"></label>`, `<label title="Empty: no save">Reflex DC <input type="number" name="thunderstorm.dc" value="${entry?.dc ?? ""}" placeholder="none"></label>`);
    if (toggle === "ash") fields.push(`<label><input type="checkbox" name="ash.unbreathable"${entry?.unbreathable ? " checked" : ""}> Unbreathable</label>`);
    if (toggle === "smoke") fields.push(`<label><input type="checkbox" name="smoke.unbreathable"${entry?.unbreathable ? " checked" : ""}> Unbreathable</label>`, `<label>Wildfire heat <select name="smoke.heat">${option("", "None", entry?.heat ?? "")}${Object.entries(DAMAGE_CATEGORIES).map(([key, category]) => option(key, `${category.label} each round`, entry?.heat)).join("")}</select></label>`);
    if (toggle === "sandstorm") fields.push(`<label>Heavy: <select name="sandstorm.harm">${option("both", "damage and breath", entry?.harm ?? "both")}${option("damage", "damage only", entry?.harm)}${option("breath", "breath only", entry?.harm)}</select></label>`);
    return fields.join(" ");
}

export class EnvironmentApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: "pf2e-environment",
        classes: ["pf2e-env"],
        tag: "form",
        window: { title: "Environment", resizable: true, icon: "fa-solid fa-cloud-sun-rain" },
        position: { width: 760, height: 780 },
        form: { handler: EnvironmentApp.#onSubmit, submitOnChange: false, closeOnSubmit: false },
        actions: {
            clear: EnvironmentApp.#onClear,
            ground: EnvironmentApp.#onGround,
            regionFeature: EnvironmentApp.#onRegionFeature,
            part: EnvironmentApp.#onPart,
            ignite: EnvironmentApp.#onIgnite,
            disaster: EnvironmentApp.#onDisaster,
            dig: EnvironmentApp.#onDig,
            free: EnvironmentApp.#onFree,
            // (Not "tab": ApplicationV2 keeps that action for its own tab groups.)
            switchTab: EnvironmentApp.#onTab,
            fahrenheit: EnvironmentApp.#onFahrenheit
        }
    };

    constructor(scene = canvas?.scene, options = {}) {
        super(options);
        this.scene = scene;
        this.tab = "weather";
        this.disaster = "avalanche";
    }

    get title() {
        return `Environment: ${this.scene?.name ?? "no scene"}`;
    }

    async _renderHTML() {
        if (!this.scene) return "<p>No scene is open.</p>";
        const data = sceneData(this.scene);
        const raw = data.state ?? {};
        const state = normalizeState(raw);
        const tabs = [["weather", "Weather"], ["ground", "Ground"], ["disasters", "Disasters"], ["structures", "Doors and walls"]];
        const nav = `<nav class="pf2e-env-tabs">${tabs.map(([key, label]) => `<button type="button" data-action="switchTab" data-tab="${key}" class="${this.tab === key ? "active" : ""}">${label}</button>`).join("")}</nav>`;
        const body = { weather: () => this.#weatherTab(state, data), ground: () => this.#groundTab(), disasters: () => this.#disasterTab(), structures: () => this.#structuresTab() }[this.tab]();
        return `${nav}<section class="pf2e-env-body">${body}</section>`;
    }

    _replaceHTML(result, content) {
        content.innerHTML = result;
        content.querySelectorAll("select[name='disaster.key']").forEach((select) => select.addEventListener("change", () => {
            this.disaster = select.value;
            this.render();
        }));
    }

    #weatherTab(state, data) {
        const visuals = visualsOf(this.scene);
        const looks = availableLooks();
        const rows = Object.entries(WEATHER).map(([toggle, entry]) => {
            const on = Boolean(state[toggle]);
            // (Off: its first level that does something — Fog past Mist, a thunderstorm's ordinary one.)
            const level = state[toggle]?.level ?? entry.levels[entry.levels.length > 2 ? 1 : 0].key;
            const shown = state[toggle] ?? normalizeState({ [toggle]: { level } })[toggle];
            return `<fieldset class="pf2e-env-toggle ${on ? "on" : ""}">
                <legend><label><input type="checkbox" name="${toggle}.on"${on ? " checked" : ""}> ${escapeHTML(entry.label)}</label> ${lookSelect(toggle, visuals.looks[toggle], autoLook(toggle, shown, state), looks)}</legend>
                <div class="pf2e-env-row"><select name="${toggle}.level">${entry.levels.map((entryLevel) => option(entryLevel.key, `${entryLevel.label}${Number.isFinite(entryLevel.penalty) && entryLevel.penalty ? ` (${entryLevel.penalty})` : ""}`, level)).join("")}</select> ${weatherFields(toggle, state[toggle])}</div>
                <p class="hint">${escapeHTML(entry.text ?? "")}</p>
            </fieldset>`;
        }).join("");
        const tokens = [...this.scene.tokens].filter((token) => isCreature(token.actor));
        const sheltered = new Set(data.sheltered);
        const preview = tokens.slice(0, 40).map((token) => {
            const effect = creatureEffect(state, creatureOf(token, this.scene));
            return `<li><label><input type="checkbox" name="sheltered.${token.id}"${sheltered.has(token.id) ? " checked" : ""}> ${escapeHTML(token.name)}</label> <span class="hint">${escapeHTML(effect ? effect.summary.join(" ") : "Unaffected.")}</span></li>`;
        }).join("");
        const now = sceneLook(state, visuals, new Set(looks.map((look) => look.key)));
        const order = LOOK_ORDER.map((toggle) => WEATHER[toggle]?.label.toLowerCase()).filter(Boolean).join(", ");
        return `<fieldset class="pf2e-env-toggle ${visuals.on ? "on" : ""}"><legend><label><input type="checkbox" name="visuals.on"${visuals.on ? " checked" : ""}> Show the weather on the scene</label></legend>
                <p class="hint">Foundry's weather effect for the heaviest weather that's on${now ? ` (now: ${escapeHTML(looks.find((look) => look.key === now)?.label ?? now)})` : ""}, one at a time: ${escapeHTML(order)}. Each weather's Look menu picks its own, other modules' weather effects included. The scene's own weather comes back when the module's ends.</p></fieldset>
            ${rows}
            <fieldset class="pf2e-env-toggle on"><legend>Temperature</legend>
                <div class="pf2e-env-row"><select name="temperature">${TEMPERATURES.map((entry) => option(entry.key, entry.label, state.temperature)).join("")}</select>
                <label>or <input type="number" name="fahrenheit" placeholder="°F" style="width:5em"></label><label><input type="checkbox" name="humid"> Humid</label>
                <button type="button" data-action="fahrenheit">Set from °F</button></div>
                <p class="hint">Cold-weather clothing, Environmental Endurance and the item module's protections (a Cooling Elixir, a Warming Parka…) are counted. Sheltered creatures feel none of it.</p>
            </fieldset>
            <fieldset class="pf2e-env-toggle ${state.travel?.on ? "on" : ""}"><legend><label><input type="checkbox" name="travel.on"${state.travel?.on ? " checked" : ""}> Travelling (fatigue)</label></legend>
                <p class="hint">The party becomes fatigued after the hours the temperature and precipitation allow, counted on the world clock from now.</p></fieldset>
            <fieldset class="pf2e-env-toggle on"><legend>Creatures (tick: sheltered)</legend><ul class="pf2e-env-creatures">${preview || "<li>No tokens.</li>"}</ul></fieldset>
            <footer class="pf2e-env-footer"><button type="submit"><i class="fa-solid fa-check"></i> Apply weather</button><button type="button" data-action="clear"><i class="fa-solid fa-sun"></i> Clear all</button></footer>`;
    }

    #groundTab() {
        const ground = sceneGround(this.scene);
        const regions = [...this.scene.regions].filter((region) => !region.flags?.[MODULE_ID]?.groundRegion && !region.flags?.[MODULE_ID]?.weatherRegion);
        const rows = regions.map((region) => {
            const feature = regionFeature(region);
            const rules = feature ? featureRules(feature.key, { dc: feature.dc }) : null;
            const extra = [rules?.events.part ? `<button type="button" data-action="part" data-region="${region.id}">Part (selected)</button>` : "", rules?.events.explodes ? `<button type="button" data-action="ignite" data-region="${region.id}">Ignite</button>` : ""].join("");
            const current = feature?.key === "current-water" ? `<label>Current <input type="number" step="5" name="region.${region.id}.feet" value="${feature.current?.feet ?? 10}" style="width:4em"> ft ${directionSelect(`region.${region.id}.direction`, feature.current?.direction ?? "S")}</label>`
                : FEATURES[feature?.key]?.upCost ? `<label title="The way up the stairs: difficult terrain only moving that way">Up toward ${directionSelect(`region.${region.id}.up`, feature.up ?? "N")}</label>` : "";
            return `<tr><td>${escapeHTML(region.name)}</td><td>${featureSelect(`region.${region.id}.key`, feature?.key)}</td><td><input type="number" name="region.${region.id}.dc" value="${feature?.dc ?? ""}" placeholder="DC" style="width:4em"></td><td>${current}<button type="button" data-action="regionFeature" data-region="${region.id}">Set</button>${extra}</td></tr>
                ${rules ? `<tr><td></td><td colspan="3" class="hint">${escapeHTML(rules.summary.join(" "))}</td></tr>` : ""}`;
        }).join("");
        const groundRules = ground ? featureRules(ground.key, { dc: ground.dc }) : null;
        return `<fieldset class="pf2e-env-toggle on"><legend>The whole scene's ground</legend>
                <div class="pf2e-env-row">${featureSelect("ground.key", ground?.key)} <input type="number" name="ground.dc" value="${ground?.dc ?? ""}" placeholder="DC" style="width:4em"> <button type="button" data-action="ground">Set</button></div>
                ${groundRules ? `<p class="hint">${escapeHTML(groundRules.summary.join(" "))}</p>` : ""}</fieldset>
            <fieldset class="pf2e-env-toggle on"><legend>Regions (draw them with Foundry's Region tools)</legend>
                ${rows ? `<table class="pf2e-env-table"><tbody>${rows}</tbody></table>` : "<p class='hint'>This scene has no regions yet.</p>"}</fieldset>`;
    }

    #disasterTab() {
        const key = this.disaster;
        const entry = DISASTERS[key];
        const categories = disasterCategories(key);
        const fields = [
            categories.length ? `<label>Damage <select name="disaster.category">${categories.map((category) => option(category.key, `${category.label} (${category.min}d6–${category.max}d6)`, entry.category)).join("")}</select></label> <label>Dice <input type="number" name="disaster.dice" placeholder="d6s" style="width:4em"></label>` : "",
            entry.save || entry.optionalSave ? `<label>DC <input type="number" name="disaster.dc" value="${bandDC(entry.band)}" style="width:4em"></label>` : "",
            entry.optionalSave ? `<label><input type="checkbox" name="disaster.save"> Basic ${entry.optionalSave} save</label>` : "",
            entry.falling || key === "fissure" ? `<label>Fall <input type="number" step="5" name="disaster.falling" value="${entry.falling ?? 20}" style="width:4em"> ft</label>` : "",
            entry.carry ? `<label>Carried <input type="number" step="5" name="disaster.carry" value="${entry.carry}" style="width:4em"> ft</label>` : "",
            entry.carry || key === "tornado" ? `<label>Toward ${directionSelect("disaster.direction", "S")}</label>` : "",
            ["avalanche", "collapse", "pyroclastic"].includes(key) ? `<label><input type="checkbox" name="disaster.snow"${key === "avalanche" ? " checked" : ""}> Snow</label> <label><input type="checkbox" name="disaster.airless"> No air pocket</label>` : "",
            entry.persistent ? `<label>Persistent dice <input type="number" name="disaster.persistentDice" placeholder="d6s" style="width:4em"></label>` : ""
        ].filter(Boolean).join(" ");
        const buried = [...this.scene.tokens].filter((token) => buriedEffectOf(token.actor));
        return `<fieldset class="pf2e-env-toggle on"><legend>Natural disaster</legend>
                <div class="pf2e-env-row"><select name="disaster.key">${Object.entries(DISASTERS).map(([value, disaster]) => option(value, disaster.label, key)).join("")}</select></div>
                <div class="pf2e-env-row">${fields}</div>
                <div class="pf2e-env-row"><button type="button" data-action="disaster" data-to="selected"><i class="fa-solid fa-hand-pointer"></i> Post for the selected tokens</button><button type="button" data-action="disaster" data-to="targets"><i class="fa-solid fa-bullseye"></i> Post for the targeted tokens</button></div>
                <p class="hint">GM Core pg. 96–98. Each creature rolls its save from the card; the GM's Apply does what its degree says.</p></fieldset>
            <fieldset class="pf2e-env-toggle on"><legend>Buried</legend>${buried.length ? `<ul>${buried.map((token) => `<li>${escapeHTML(token.name)} <button type="button" data-action="dig" data-token="${token.id}">Dig out (the selected dig)</button> <button type="button" data-action="free" data-token="${token.id}">Free</button></li>`).join("")}</ul>` : "<p class='hint'>No one is buried.</p>"}</fieldset>`;
    }

    #structuresTab() {
        const rows = Object.values(STRUCTURES).map((entry) => `<tr><td>${escapeHTML(entry.label)}</td><td>${entry.climb}</td><td>${entry.hardness}, ${entry.hp} (${entry.bt})</td><td>${entry.force ?? ""}${entry.downtime ? "Needs downtime and tools" : ""}</td></tr>`).join("");
        const force = Object.values(FORCE_OPEN).map((entry) => `<tr><td>${escapeHTML(entry.label)}</td><td>${entry.dc}</td></tr>`).join("");
        return `<table class="pf2e-env-table"><thead><tr><th>Structure</th><th>Climb DC</th><th>Hardness, HP (BT)</th><th>Force Open</th></tr></thead><tbody>${rows}</tbody></table>
            <h4>Forcing open (no lock)</h4><table class="pf2e-env-table"><thead><tr><th>Structure</th><th>Force Open DC</th></tr></thead><tbody>${force}</tbody></table>
            <p class="hint">A lock's Force Open DC is its Thievery DC + 5. Lifting a portcullis: the lock's DC or the table's, whichever is higher.</p>`;
    }

    // --- Actions ---

    static async #onSubmit(event, form, formData) {
        const values = foundry.utils.expandObject(formData.object);
        const before = sceneData(this.scene);
        const raw = {};
        for (const toggle of Object.keys(WEATHER)) {
            const entry = values[toggle];
            if (!entry?.on) continue;
            const { on, ...rest } = entry;
            raw[toggle] = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== "" && value !== null));
        }
        raw.temperature = values.temperature ?? "normal";
        if (values.travel?.on) raw.travel = before.state?.travel?.on ? before.state.travel : { on: true, since: game.time.worldTime };
        await setSceneState(this.scene, raw);
        await setVisuals(this.scene, { on: Boolean(values.visuals?.on), looks: Object.fromEntries(Object.keys(WEATHER).map((toggle) => [toggle, values.look?.[toggle] || "auto"])) });
        const sheltered = Object.entries(values.sheltered ?? {}).filter(([, value]) => value).map(([id]) => id);
        await setSheltered(this.scene, sheltered);
        // (A new journey: fatigue counts afresh.)
        if (values.travel?.on && !before.state?.travel?.on) await this.scene.setFlag(MODULE_ID, "environment", { ...sceneData(this.scene), fatigued: [] });
        ui.notifications.info(`${this.scene.name}: the weather is set.`);
        this.render();
    }

    static async #onClear() {
        await setSceneState(this.scene, { temperature: "normal" });
        this.render();
    }

    static #onTab(event, target) {
        this.tab = target.dataset.tab;
        this.render();
    }

    static #onFahrenheit() {
        const form = this.element;
        const degrees = form.querySelector("[name='fahrenheit']")?.value;
        const humid = form.querySelector("[name='humid']")?.checked;
        if (degrees === "" || degrees === undefined) return;
        const select = form.querySelector("[name='temperature']");
        if (select) select.value = temperatureFromFahrenheit(degrees, { humid });
    }

    #value(name) {
        const input = this.element.querySelector(`[name='${name}']`);
        if (!input) return null;
        return input.type === "checkbox" ? input.checked : input.value === "" ? null : input.value;
    }

    static async #onGround() {
        await setSceneGround(this.scene, this.#value("ground.key"), { dc: this.#value("ground.dc") });
        this.render();
    }

    static async #onRegionFeature(event, target) {
        const region = this.scene.regions.get(target.dataset.region);
        if (!region) return;
        const id = region.id;
        const key = this.#value(`region.${id}.key`);
        const current = key === "current-water" ? { feet: Number(this.#value(`region.${id}.feet`)) || 10, direction: this.#value(`region.${id}.direction`) ?? "S" } : null;
        await setRegionFeature(region, key, { dc: this.#value(`region.${id}.dc`), current, up: this.#value(`region.${id}.up`) });
        this.render();
    }

    static async #onPart(event, target) {
        const region = this.scene.regions.get(target.dataset.region);
        const token = selectedTokens()[0];
        if (!token) return ui.notifications.warn("Select the creature that tries to part the crowd.");
        await partCrowd(region, token);
    }

    static async #onIgnite(event, target) {
        await igniteGas(this.scene.regions.get(target.dataset.region));
    }

    static async #onDisaster(event, target) {
        const tokens = target.dataset.to === "targets" ? targetedTokens() : selectedTokens();
        if (!tokens.length) return ui.notifications.warn(target.dataset.to === "targets" ? "Target the creatures it strikes." : "Select the creatures it strikes.");
        const options = {
            category: this.#value("disaster.category"),
            dice: this.#value("disaster.dice"),
            dc: this.#value("disaster.dc"),
            save: this.#value("disaster.save") ? true : undefined,
            falling: this.#value("disaster.falling"),
            carry: this.#value("disaster.carry"),
            direction: this.#value("disaster.direction") ?? undefined,
            snow: this.#value("disaster.snow") ?? undefined,
            persistentDice: this.#value("disaster.persistentDice")
        };
        const card = disasterCard(this.disaster, options);
        if (!card) return;
        await postCard({ ...card, airless: Boolean(this.#value("disaster.airless")) }, tokens, { speaker: card.title });
    }

    static async #onDig(event, target) {
        const buried = this.scene.tokens.get(target.dataset.token);
        const diggers = selectedTokens().filter((token) => token.document?.id !== buried?.id);
        if (!buried || !diggers.length) return ui.notifications.warn("Select the creatures that dig.");
        const dc = buriedEffectOf(buried.actor)?.flags?.[MODULE_ID]?.buried?.dc ?? 20;
        await postCard(digCard(buried, dc), diggers);
    }

    static async #onFree(event, target) {
        const token = this.scene.tokens.get(target.dataset.token);
        if (token?.actor) await freeCreature(token.actor);
        this.render();
    }
}
