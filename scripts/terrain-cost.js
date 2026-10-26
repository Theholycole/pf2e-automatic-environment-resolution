// The token's movement cost over the module's terrain, where a region's own cost can't say it (Foundry 14's terrain effects see neither
// the step's direction nor the creature): Foundry's TerrainData cost function (PF2e's) wrapped.
//   Stairs: difficult terrain only for a creature moving up them ("Stairs are difficult terrain for characters moving up them", GM Core) —
//   a walking step into a stairs region's square with some of its way toward the region's up direction costs the stairs' multiple (the
//   core's terrain.js goesUp), unless the creature ignores all difficult terrain.
//   Ignoring a feature (2026-10-25, with the item module's session: a Winterstep Elixir's ice and snow, an Underbrush Cloak's undergrowth):
//   PF2e's entries on the creature (system.movement.terrain.difficult.ignored, .greater.ignored) naming the feature — PF2e applies only
//   the ones for every environment and feature itself —; the step costs as if that region's difficulty weren't there (greater difficult
//   terrain as difficult, when only difficult terrain is ignored), the rest of the square's difficulty and PF2e's own ignoring as ever.

import { MODULE_ID } from "./foundry.js";
import { goesUp, ignoresFeature } from "../../pf2e-resolution-core/src/environment/terrain.js";
import { FEATURES } from "../../pf2e-resolution-core/src/environment/catalog.js";

const WRAPPED = Symbol.for(`${MODULE_ID}.terrainCost`);

// The scene's module terrain that costs: [{ region, key, cost (walking's multiple), up?, upCost? }].
export function costlyTerrain(scene) {
    return [...(scene?.regions ?? [])].flatMap((region) => {
        const terrain = region.flags?.[MODULE_ID]?.terrain;
        const feature = terrain ? FEATURES[terrain.key] : null;
        if (!feature || (!(feature.cost > 1) && !feature.upCost)) return [];
        return [{ region, key: terrain.key, cost: feature.cost > 1 ? feature.cost : 1, ...(feature.upCost && terrain.up ? { up: terrain.up, upCost: feature.upCost } : {}) }];
    });
}
// (The old name, for the stairs alone.)
export const flightsOf = (scene) => costlyTerrain(scene).filter((entry) => entry.up);

// The creature's PF2e entries for ignoring difficult terrain.
export function ignoredOf(actor) {
    const terrain = actor?.system?.movement?.terrain;
    return { difficult: [...(terrain?.difficult?.ignored ?? [])], greater: [...(terrain?.greater?.ignored ?? [])] };
}
const ignoresAll = (entries) => entries.some((entry) => entry?.environment === "all" && entry?.feature === "all");

// PF2e's share of a difficulty's extra cost for a creature (TerrainDataPF2e's own rule, for every environment and feature).
function pf2eShare(ignored, difficulty) {
    const all = ignoresAll(ignored.difficult);
    if (difficulty === 3) return ignoresAll(ignored.greater) ? 0 : all ? 0.5 : 1;
    return all ? 0 : 1;
}

export function installTerrainCost() {
    const Terrain = CONFIG.Token?.movement?.TerrainData;
    if (!Terrain || typeof Terrain.getMovementCostFunction !== "function" || Terrain.getMovementCostFunction[WRAPPED]) return;
    const original = Terrain.getMovementCostFunction;
    const wrapped = function (token, options) {
        const base = original.call(this, token, options);
        const scene = token?.parent;
        const terrain = costlyTerrain(scene);
        if (!terrain.length || !scene?.grid) return base;
        const ignored = ignoredOf(token.actor);
        const square = scene.grid.isSquare ?? canvas?.grid?.isSquare;
        return (from, to, distance, segment) => {
            let cost = typeof base === "function" ? base(from, to, distance, segment) : distance;
            if (segment?.teleport || segment?.action !== "walk") return cost;
            const point = scene.grid.getCenterPoint({ i: to.i, j: to.j });
            const at = { ...point, elevation: Number(token.elevation) || 0 };
            const here = terrain.filter((entry) => entry.region.testPoint(at));
            if (!here.length) return cost;
            // (Its own ignoring of a feature here: that region's difficulty out of the square's.)
            const ignoring = square ? here.filter((entry) => entry.cost > 1).map((entry) => ({ entry, how: ignoresFeature(entry.key, ignored) })).filter(({ how }) => how !== "none") : [];
            if (ignoring.length) {
                let difficulty = Math.clamp(Math.trunc(segment?.terrain?.difficulty ?? 1), 1, 3);
                for (const { entry, how } of ignoring) difficulty = how === "greater" ? difficulty / entry.cost : entry.cost === 3 ? (difficulty * 2) / 3 : difficulty / entry.cost;
                difficulty = Math.clamp(Math.round(difficulty), 1, 3);
                cost = distance + (difficulty - 1) * scene.grid.distance * pf2eShare(ignored, difficulty);
            }
            const flight = here.find((entry) => entry.up);
            if (flight && goesUp(from, to, flight.up) && !ignoresAll(ignored.difficult)) cost *= flight.upCost;
            return cost;
        };
    };
    wrapped[WRAPPED] = true;
    Terrain.getMovementCostFunction = wrapped;
}
