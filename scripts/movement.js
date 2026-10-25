// Forced movement by the environment — a current, a gust that blows a flier away, a flood that carries a creature off. The resolution
// core's forcedMove when it's there (walls, the scene's edge, other creatures' spaces; a displacement, so no reactions): away from a point
// behind the creature. Without it, square by square in the direction, every second diagonal 10 feet, stopping at a wall or the edge.

import { MODULE_ID } from "./foundry.js";
import { DIRECTIONS } from "../src/rules/catalog.js";

// The squares a push of so many feet covers in a direction ([dx, dy] per square).
export function pushSquares(feet, direction, distance = 5) {
    const [dx, dy] = DIRECTIONS[direction] ?? [0, 0];
    if (!dx && !dy) return [];
    const steps = [];
    let spent = 0;
    let diagonals = 0;
    while (true) {
        const cost = dx && dy ? (diagonals % 2 ? 2 * distance : distance) : distance;
        if (spent + cost > feet) break;
        spent += cost;
        if (dx && dy) diagonals++;
        steps.push([dx, dy]);
    }
    return steps;
}

export async function pushToken(tokenDoc, feet, direction) {
    const doc = tokenDoc?.document ?? tokenDoc;
    const scene = doc?.parent;
    if (!doc || !scene || !(feet > 0) || !DIRECTIONS[direction]) return false;
    const size = scene.grid.size;
    const mover = game.modules.get("pf2e-resolution-core")?.active ? game.modules.get("pf2e-resolution-core")?.api?.forcedMovement : null;
    if (typeof mover?.forcedMove === "function") {
        const [dx, dy] = DIRECTIONS[direction];
        const centre = { x: doc._source.x + (doc.width * size) / 2, y: doc._source.y + (doc.height * size) / 2 };
        const point = { x: centre.x - dx * size * 20, y: centre.y - dy * size * 20 };
        const result = await mover.forcedMove(doc, { point, direction: "away", feet, reason: "Environment" });
        return Boolean(result?.moved);
    }
    const steps = pushSquares(feet, direction, scene.grid.distance || 5);
    const half = { x: (doc.width * size) / 2, y: (doc.height * size) / 2 };
    const { width, height } = scene.dimensions;
    // (Its stored place: Foundry 14's prepared x and y can lag behind while the token animates.)
    let at = { x: doc._source.x, y: doc._source.y };
    for (const [dx, dy] of steps) {
        const next = { x: at.x + dx * size, y: at.y + dy * size };
        if (next.x < 0 || next.y < 0 || next.x + doc.width * size > width || next.y + doc.height * size > height) break;
        const origin = { x: at.x + half.x, y: at.y + half.y };
        const destination = { x: next.x + half.x, y: next.y + half.y };
        let blocked = false;
        try {
            blocked = Boolean(doc.object?.checkCollision?.(destination, { origin, type: "move", mode: "any" }));
        } catch {
            blocked = false;
        }
        if (blocked) break;
        at = next;
    }
    if (at.x === doc._source.x && at.y === doc._source.y) return false;
    await doc.update({ x: at.x, y: at.y }, { teleport: true, animate: false, [MODULE_ID]: { forced: true } });
    return true;
}
