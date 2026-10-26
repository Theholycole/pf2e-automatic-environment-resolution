// Stairs: difficult terrain only for a creature moving up them ("Stairs are difficult terrain for characters moving up them", GM Core).
// A region's movement cost can't tell which way a creature goes (Foundry 14's terrain effects see no direction), so the token's movement
// cost function is wrapped: a walking step into a stairs region's square, with some of its way toward the region's up direction, costs the
// stairs' multiple (the core's terrain.js goesUp). Every other step costs what Foundry and PF2e say.

import { MODULE_ID } from "./foundry.js";
import { goesUp } from "../../pf2e-resolution-core/src/environment/terrain.js";
import { FEATURES } from "../../pf2e-resolution-core/src/environment/catalog.js";

const WRAPPED = Symbol.for(`${MODULE_ID}.stairs`);

// The scene's flights of stairs: [{ region, up, cost }].
export function flightsOf(scene) {
    return [...(scene?.regions ?? [])].flatMap((region) => {
        const terrain = region.flags?.[MODULE_ID]?.terrain;
        const feature = terrain ? FEATURES[terrain.key] : null;
        return feature?.upCost && terrain.up ? [{ region, up: terrain.up, cost: feature.upCost }] : [];
    });
}

export function installStairsCost() {
    const Terrain = CONFIG.Token?.movement?.TerrainData;
    if (!Terrain || typeof Terrain.getMovementCostFunction !== "function" || Terrain.getMovementCostFunction[WRAPPED]) return;
    const original = Terrain.getMovementCostFunction;
    const wrapped = function (token, options) {
        const base = original.call(this, token, options);
        const scene = token?.parent;
        const flights = flightsOf(scene);
        if (!flights.length || !scene?.grid) return base;
        return (from, to, distance, segment) => {
            const cost = typeof base === "function" ? base(from, to, distance, segment) : distance;
            if (segment?.action !== "walk") return cost;
            const point = scene.grid.getCenterPoint({ i: to.i, j: to.j });
            const at = { ...point, elevation: Number(token.elevation) || 0 };
            const flight = flights.find((entry) => entry.region.testPoint(at));
            return flight && goesUp(from, to, flight.up) ? cost * flight.cost : cost;
        };
    };
    wrapped[WRAPPED] = true;
    Terrain.getMovementCostFunction = wrapped;
}
