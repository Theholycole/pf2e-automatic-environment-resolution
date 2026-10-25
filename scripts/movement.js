// Forced movement by the environment — a current, a gust that blows a flier away, a flood that carries a creature off: square by square in
// a direction, every second diagonal 10 feet (PF2e's rule), stopping at a wall or the scene's edge.

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
    if (!doc || !scene || !(feet > 0)) return false;
    const size = scene.grid.size;
    const steps = pushSquares(feet, direction, scene.grid.distance || 5);
    const half = { x: (doc.width * size) / 2, y: (doc.height * size) / 2 };
    const { width, height } = scene.dimensions;
    let at = { x: doc.x, y: doc.y };
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
    if (at.x === doc.x && at.y === doc.y) return false;
    await doc.update({ x: at.x, y: at.y }, { [MODULE_ID]: { forced: true } });
    return true;
}
