// Foundry's own walls as structures (the user, 2026-10-26: "make the foundry walls/doors/windows interactable … the default wall/door/
// windows behave as normal for foundry so we dont flood any scenes with breakable walls"). Only a wall the GM makes breakable in its
// settings' Structure section does anything more than Foundry's:
//   - its door's right-click (a player's; the GM's with Shift, since the GM's own right-click locks and unlocks) opens the structure's menu,
//     and a player clicking it locked is told so;
//   - a breakable wall or window with no door gets an icon of its own at its middle, which opens the menu (the GM's always; a player's
//     when that wall is in sight, unless the setting hides them);
//   - the menu: Strike it (its token made and targeted), Force it open or Lift it, Pick the lock, Climb it, and the GM's Repair.

import { MODULE_ID, escapeHTML } from "./foundry.js";
import { LOCKS } from "../../pf2e-resolution-core/src/environment/catalog.js";
import { STRUCTURE_AC, STRUCTURE_KINDS, defaultKind, materialChoices } from "../../pf2e-resolution-core/src/environment/structures.js";
import { OWN_ICONS, STRUCTURE, hitPointsOf, isStructureWall, lockOf, postStructureCard, repairStructure, structureRecord, targetStructure } from "./structures.js";

const DOOR = { CLOSED: 0, OPEN: 1, LOCKED: 2 };
const option = (value, label, selected) => `<option value="${escapeHTML(value)}"${String(selected ?? "") === String(value) ? " selected" : ""}>${escapeHTML(label)}</option>`;

// --- The wall's settings: its Structure section. ---

export function injectWallConfig(app, html) {
    const wall = app?.document;
    if (!game.user.isGM || wall?.documentName !== "Wall") return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    const form = root?.tagName === "FORM" ? root : root?.querySelector("form") ?? app.form;
    if (!form || form.querySelector(".pf2e-env-wall-structure")) return;
    const data = wall.flags?.[MODULE_ID]?.[STRUCTURE] ?? {};
    const name = (key) => `flags.${MODULE_ID}.${STRUCTURE}.${key}`;
    const kind = data.kind || defaultKind(wall._source ?? wall);
    const groups = new Map();
    for (const choice of materialChoices()) {
        if (!groups.has(choice.group)) groups.set(choice.group, []);
        groups.get(choice.group).push(option(choice.key, `${choice.label} — Hardness ${choice.hardness}, HP ${choice.hp}${choice.bt ? ` (BT ${choice.bt})` : ""}${choice.source && choice.source !== "GM Core" ? `; ${choice.source}` : ""}`, data.material ?? ""));
    }
    const entry = structureRecord(wall);
    const hp = entry ? hitPointsOf(entry) : null;
    const fieldset = document.createElement("fieldset");
    fieldset.className = "pf2e-env-wall-structure";
    fieldset.innerHTML = `<legend>Structure (Environment)</legend>
        <div class="form-group"><label>Breakable</label><div class="form-fields"><input type="checkbox" name="${name("on")}"${data.on ? " checked" : ""}></div>
            <p class="hint">Off, it's an ordinary Foundry wall. On, creatures can Strike it, Force it Open, pick its lock or climb it, and it breaks.</p></div>
        <div class="form-group"><label>Kind</label><div class="form-fields"><select name="${name("kind")}">${Object.entries(STRUCTURE_KINDS).map(([key, each]) => option(key, each.label, kind)).join("")}</select></div></div>
        <div class="form-group"><label>Material</label><div class="form-fields"><select name="${name("material")}">${option("", "Its kind's own (GM Core's table)", data.material ?? "")}${[...groups].map(([group, options]) => `<optgroup label="${escapeHTML(group)}">${options.join("")}</optgroup>`).join("")}</select></div></div>
        <div class="form-group"><label>Lock</label><div class="form-fields"><select name="${name("lock")}">${option("", "None (locked in Foundry: a simple lock)", data.lock ?? "")}${Object.entries(LOCKS).map(([key, lock]) => option(key, `${lock.label} (DC ${lock.dc}, ${lock.successes} successes)`, data.lock)).join("")}</select></div></div>
        <div class="form-group"><label>Without its lock</label><div class="form-fields"><select name="${name("stuck")}">${option("stuck", "Stuck (Force Open DC 15)", data.stuck ?? "stuck")}${option("very-stuck", "Exceptionally stuck (DC 20)", data.stuck)}</select></div></div>
        <div class="form-group"><label>AC</label><div class="form-fields"><input type="number" name="${name("ac")}" value="${data.ac ?? ""}" placeholder="${STRUCTURE_AC}"></div></div>
        ${entry ? `<p class="hint">${escapeHTML(entry.stats.label)}: Hardness ${entry.stats.hardness}, HP ${hp.value}/${hp.max} (BT ${entry.stats.bt})${entry.data.condition && entry.data.condition !== "intact" ? `, ${entry.data.condition}` : ""}.</p>` : ""}`;
    const footer = form.querySelector("footer.form-footer");
    if (footer) footer.before(fieldset);
    else form.append(fieldset);
    // (Off: its other fields aren't saved, so what it had is kept.)
    const toggle = fieldset.querySelector(`[name="${name("on")}"]`);
    const sync = () => fieldset.querySelectorAll("select, input[type='number']").forEach((input) => (input.disabled = !toggle.checked));
    toggle.addEventListener("change", sync);
    sync();
    app.setPosition?.();
}

// (A wall the GM saves without ever making it breakable keeps no structure flag.)
export function stripUnusedStructure(wall, change) {
    const structure = foundry.utils.getProperty(change, `flags.${MODULE_ID}.${STRUCTURE}`);
    if (!structure || structure.on || wall.flags?.[MODULE_ID]?.[STRUCTURE]) return;
    delete change.flags[MODULE_ID][STRUCTURE];
    if (!Object.keys(change.flags[MODULE_ID]).length) delete change.flags[MODULE_ID];
}

// --- Its door. ---

// (Through libWrapper when it's active — registered from this module's own file, since libWrapper checks who registers — else directly.)
function wrapMethod(target, wrapper, type = "WRAPPER") {
    if (game.modules.get("lib-wrapper")?.active && typeof globalThis.libWrapper?.register === "function") return globalThis.libWrapper.register(MODULE_ID, target, wrapper, type);
    const parts = target.split(".");
    const key = parts.pop();
    const owner = parts.reduce((object, part) => object?.[part], globalThis);
    const original = owner[key];
    owner[key] = function (...args) {
        return wrapper.call(this, (...inner) => original.apply(this, inner), ...args);
    };
}

const told = new Set();
export function installDoorControls() {
    if (!foundry.canvas?.containers?.DoorControl) return;
    wrapMethod("foundry.canvas.containers.DoorControl.prototype._onRightDown", function (wrapped, event) {
        const wall = this.wall?.document;
        const shift = event?.shiftKey ?? event?.nativeEvent?.shiftKey ?? game.keyboard?.isModifierActive?.("Shift");
        if (isStructureWall(wall) && (!game.user.isGM || shift)) {
            event?.stopPropagation?.();
            openStructureMenu(wall);
            return false;
        }
        return wrapped(event);
    }, "MIXED");
    wrapMethod("foundry.canvas.containers.DoorControl.prototype._onMouseDown", function (wrapped, event) {
        const result = wrapped(event);
        const wall = this.wall?.document;
        if (event?.button === 0 && !game.user.isGM && wall?.ds === DOOR.LOCKED && isStructureWall(wall) && !told.has(wall.id)) {
            told.add(wall.id);
            ui.notifications.info(`${structureRecord(wall)?.name ?? "The door"} is locked. Right-click it to pick the lock, force it open or Strike it.`);
        }
        return result;
    });
}

// --- Its icon, for a breakable wall or window with no door. ---

let container = null;
let drawing = null;
export function drawStructureIcons() {
    clearTimeout(drawing);
    drawing = setTimeout(() => draw().catch((error) => console.warn(`${MODULE_ID} | structure icons:`, error)), 50);
}

async function draw() {
    if (!canvas?.ready || !canvas.controls) return;
    if (container && !container.destroyed) container.destroy({ children: true });
    container = new PIXI.Container();
    container.eventMode = "passive";
    canvas.controls.addChild(container);
    for (const wall of canvas.walls?.placeables ?? []) {
        if (!isStructureWall(wall.document) || wall.document.door) continue;
        container.addChild(await iconFor(wall));
    }
    refreshStructureIcons();
}

async function iconFor(wall) {
    const entry = structureRecord(wall.document);
    const s = canvas.dimensions.uiScale ?? 1;
    const size = 32 * s;
    const icon = new PIXI.Container();
    icon.wallId = wall.id;
    const bg = icon.addChild(new PIXI.Graphics());
    bg.beginFill(0x000000, 0.45).drawRoundedRect(-3 * s, -3 * s, size + 6 * s, size + 6 * s, 5 * s).endFill();
    const texture = await foundry.canvas.loadTexture(entry?.stats.type === "window" ? OWN_ICONS.window : OWN_ICONS.wall).catch(() => null);
    const sprite = icon.addChild(new PIXI.Sprite(texture ?? PIXI.Texture.WHITE));
    sprite.width = sprite.height = size;
    sprite.alpha = 0.7;
    sprite.tint = { broken: 0xffa040, destroyed: 0xff5050 }[entry?.data.condition] ?? 0xffffff;
    const center = wall.center;
    icon.position.set(center.x - size / 2, center.y - size / 2);
    icon.eventMode = "static";
    icon.cursor = "pointer";
    icon.hitArea = new PIXI.Rectangle(-3 * s, -3 * s, size + 6 * s, size + 6 * s);
    icon.on("pointerover", () => (sprite.alpha = 1)).on("pointerout", () => (sprite.alpha = 0.7));
    icon.on("pointerdown", (event) => {
        event.stopPropagation();
        openStructureMenu(wall.document);
    });
    return icon;
}

// (Shown as a door's control is: the GM's always; a player's when the wall is in sight and the setting allows.)
export function refreshStructureIcons() {
    if (!container || container.destroyed) return;
    const players = game.settings.get(MODULE_ID, "structureIcons");
    for (const icon of container.children) {
        const wall = canvas.walls?.get(icon.wallId);
        icon.visible = Boolean(wall) && (game.user.isGM || (players && inSight(wall)));
    }
}

function inSight(wall) {
    if (!canvas.visibility?.tokenVision) return true;
    const ray = wall.toRay();
    const [x, y] = wall.midpoint;
    const [dx, dy] = [-ray.dy, ray.dx];
    const t = 3 / (Math.abs(dx) + Math.abs(dy) || 1);
    return canvas.visibility.testVisibility([{ x: x + t * dx, y: y + t * dy }, { x: x - t * dx, y: y - t * dy }], { tolerance: 0 });
}

// --- The menu. ---

export async function openStructureMenu(target) {
    const entry = structureRecord(target);
    if (!entry) return;
    const { stats, data, wall } = entry;
    const gm = game.user.isGM;
    const lock = lockOf(entry);
    const hp = hitPointsOf(entry);
    const open = Boolean(wall?.door && wall.ds === DOOR.OPEN);
    const state = [{ broken: "Broken.", destroyed: "Destroyed." }[data.condition], lock ? (gm ? `${LOCKS[lock]?.label ?? "Locked"}: ${data.successes ?? 0} of ${LOCKS[lock]?.successes ?? "?"} successes.` : "Locked.") : "", data.jammed ? "Jammed (−2 to Force it Open)." : ""].filter(Boolean).join(" ");
    const content = `<p>${gm ? `Hardness ${stats.hardness}, HP ${hp.value}/${hp.max} (BT ${stats.bt}). ` : ""}${escapeHTML(state)}</p><p class="hint">Checks go to your selected tokens. Strike it targets it: then Strike from your sheet.</p>`;
    const buttons = [{ action: "strike", label: "Strike it", icon: "fa-solid fa-crosshairs", default: true }];
    if (stats.type !== "wall" && !open && data.condition !== "destroyed") buttons.push({ action: "force", label: stats.type === "portcullis" ? "Lift it" : "Force it open", icon: "fa-solid fa-hand-fist" });
    if (lock && data.condition !== "destroyed") buttons.push({ action: "lock", label: "Pick the lock", icon: "fa-solid fa-unlock" });
    if (stats.climb && data.condition !== "destroyed") buttons.push({ action: "climb", label: "Climb it", icon: "fa-solid fa-person-hiking" });
    if (gm && (hp.value < hp.max || data.condition !== "intact")) buttons.push({ action: "repair", label: "Repair", icon: "fa-solid fa-hammer" });
    const choice = await foundry.applications.api.DialogV2.wait({ window: { title: entry.name, icon: "fa-solid fa-dungeon" }, content, buttons, rejectClose: false }).catch(() => null);
    if (choice === "strike") await targetStructure(entry.wall ?? entry.token);
    else if (["force", "lock", "climb"].includes(choice)) await postStructureCard(null, choice, { target: entry.holder });
    else if (choice === "repair") await repairStructure(entry.holder);
}
