// SPDX-License-Identifier: GPL-3.0-only
// Native maze bitmap and gate rules: OpenRCT2 contributors, GPL-3.0-only.
// Pinned engine: 8694e3483690323b6a75fa7264b6c58116f51f31.
// Sources: src/openrct2/actions/ride/MazeSetTrackAction.cpp and
// src/openrct2/world/Entrance.cpp (MazeEntranceHedgeRemoval), OpenRCT2/OpenRCT2.
// This reads topology only. It neither sends game actions nor models guest AI.
'use strict';

const MAX_TILES = 1024;
const ROUTE_LIMIT = 3;
const DELTA = [[-1, 0], [0, 1], [1, 0], [0, -1]]; // west, south, east, north
// Quadrants are NW, NE, SW, SE. A set cell bit means filled/absent;
// a set wall bit means closed. Each quadrant's walls are W, S, E, N.
const CELL_BITS = [3, 15, 7, 11];
const WALL_BITS = [[1, 2, 14, 0], [14, 10, 12, 13], [4, 5, 6, 2], [6, 8, 9, 10]];
const key = (x, y) => `${x},${y}`;
const coordinate = value => Number.isSafeInteger(value) && Number.isSafeInteger(value * 2 + 1);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function emptyReport() {
    return {
        valid: false, errors: [], tileCount: 0, totalCells: 0, reachableCells: 0,
        solutionCells: null, internalEdges: 0, components: 0, cycleRank: 0,
        exitRoutes: 0, exitRoutesCapped: false, exitRoutesLabel: '0', routeLimit: ROUTE_LIMIT
    };
}

function decode(tiles, allowedPortals, errors, phase) {
    const cells = new Map();
    for (const tile of tiles.values()) {
        for (let quadrant = 0; quadrant < 4; quadrant++) {
            if (tile.mazeEntry & (1 << CELL_BITS[quadrant])) continue;
            const x = tile.x * 2 + quadrant % 2;
            const y = tile.y * 2 + Math.floor(quadrant / 2);
            cells.set(key(x, y), { x, y, quadrant, mask: tile.mazeEntry });
        }
    }
    const adjacency = new Map([...cells.keys()].map(id => [id, []]));
    const external = [];
    for (const [id, cell] of cells) {
        for (let direction = 0; direction < 4; direction++) {
            if (cell.mask & (1 << WALL_BITS[cell.quadrant][direction])) continue;
            const [dx, dy] = DELTA[direction];
            const neighborId = key(cell.x + dx, cell.y + dy);
            const neighbor = cells.get(neighborId);
            if (!neighbor) {
                const portal = `${id}:${direction}`;
                if (allowedPortals.has(portal)) external.push(portal);
                else errors.push({ code: 'OPENING_TO_ABSENT_CELL', phase, cell: id, direction,
                    message: 'Open wall leads to a filled cell or a tile without maze track.' });
            } else if (neighbor.mask & (1 << WALL_BITS[neighbor.quadrant][(direction + 2) % 4])) {
                errors.push({ code: 'WALL_ASYMMETRY', phase, cell: id, direction,
                    message: 'Adjacent walkable cells disagree about their shared wall.' });
            } else adjacency.get(id).push(neighborId);
        }
    }
    return { cells, adjacency, external };
}

function reachable(adjacency, starts) {
    const seen = new Set(starts);
    const queue = [...seen];
    for (let i = 0; i < queue.length; i++) {
        for (const neighbor of adjacency.get(queue[i]) || []) {
            if (seen.has(neighbor)) continue;
            seen.add(neighbor);
            queue.push(neighbor);
        }
    }
    return seen;
}

function shortestCells(adjacency, starts, exits) {
    const distance = new Map(starts.map(id => [id, 1]));
    const queue = [...distance.keys()];
    for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        if (exits.has(id)) return distance.get(id);
        for (const neighbor of adjacency.get(id) || []) {
            if (distance.has(neighbor)) continue;
            distance.set(neighbor, distance.get(id) + 1);
            queue.push(neighbor);
        }
    }
    return null;
}

// Undirected corridor capacity is one unit of net flow. Reverse residual
// capacity permits cancellation; portal vertices may be shared by routes.
function edgeDisjointRoutes(adjacency, starts, exits) {
    const residual = new Map([...adjacency].map(([id, neighbors]) => [id,
        new Map(neighbors.map(neighbor => [neighbor, 1]))]));
    const source = 'entrance', sink = 'exit';
    residual.set(source, new Map());
    residual.set(sink, new Map());
    for (const id of starts) {
        residual.get(source).set(id, ROUTE_LIMIT);
        residual.get(id).set(source, 0);
    }
    for (const id of exits) {
        residual.get(id).set(sink, ROUTE_LIMIT);
        residual.get(sink).set(id, 0);
    }
    let flow = 0;
    while (flow < ROUTE_LIMIT) {
        const previous = new Map([[source, null]]);
        const queue = [source];
        for (let i = 0; i < queue.length && !previous.has(sink); i++) {
            for (const [neighbor, capacity] of residual.get(queue[i])) {
                if (capacity <= 0 || previous.has(neighbor)) continue;
                previous.set(neighbor, queue[i]);
                queue.push(neighbor);
            }
        }
        if (!previous.has(sink)) break;
        let amount = ROUTE_LIMIT - flow;
        for (let id = sink; id !== source; id = previous.get(id)) {
            amount = Math.min(amount, residual.get(previous.get(id)).get(id));
        }
        for (let id = sink; id !== source; id = previous.get(id)) {
            const parent = previous.get(id);
            residual.get(parent).set(id, residual.get(parent).get(id) - amount);
            residual.get(id).set(parent, residual.get(id).get(parent) + amount);
        }
        flow += amount;
    }
    return flow;
}

function analyzeMaze(layout) {
    const report = emptyReport();
    const errors = report.errors;
    if (!object(layout) || !Array.isArray(layout.tiles) || !Array.isArray(layout.gates)) {
        errors.push({ code: 'INVALID_LAYOUT', message: 'Expected an object with tiles and gates arrays.' });
        return report;
    }
    if (layout.tiles.length < 1 || layout.tiles.length > MAX_TILES || layout.gates.length !== 2) {
        errors.push({ code: 'INVALID_SIZE', message: `Use 1..${MAX_TILES} tiles and exactly two gates.` });
        return report;
    }
    const tiles = new Map();
    for (let index = 0; index < layout.tiles.length; index++) {
        const tile = layout.tiles[index];
        if (!object(tile) || !coordinate(tile.x) || !coordinate(tile.y)
            || !Number.isInteger(tile.mazeEntry) || tile.mazeEntry < 0 || tile.mazeEntry > 65535) {
            errors.push({ code: 'INVALID_TILE', index, message: 'Tile coordinates must be safe integers; mazeEntry must be uint16.' });
            continue;
        }
        const id = key(tile.x, tile.y);
        if (tiles.has(id)) errors.push({ code: 'DUPLICATE_TILE', index, message: `Duplicate tile ${id}.` });
        else tiles.set(id, { x: tile.x, y: tile.y, mazeEntry: tile.mazeEntry });
    }
    const gates = [], positions = new Set(), kinds = new Set();
    for (let index = 0; index < layout.gates.length; index++) {
        const gate = layout.gates[index];
        if (!object(gate) || !coordinate(gate.x) || !coordinate(gate.y)
            || !Number.isInteger(gate.direction) || gate.direction < 0 || gate.direction > 3
            || !['entrance', 'exit'].includes(gate.kind)) {
            errors.push({ code: 'INVALID_GATE', index, message: 'Gate needs integer coordinates, direction 0..3, and kind entrance or exit.' });
            continue;
        }
        const id = key(gate.x, gate.y);
        if (positions.has(id) || kinds.has(gate.kind)) {
            errors.push({ code: 'DUPLICATE_GATE', index, message: 'Use distinct gate positions and exactly one gate of each kind.' });
        }
        positions.add(id);
        kinds.add(gate.kind);
        const [dx, dy] = DELTA[gate.direction];
        const tile = tiles.get(key(gate.x + dx, gate.y + dy));
        if (tiles.has(id) || !tile) {
            errors.push({ code: 'GATE_POSITION', index, message: 'Gate must occupy an empty tile and face an adjacent maze tile.' });
        } else gates.push({ kind: gate.kind, direction: gate.direction, tile });
    }
    report.tileCount = tiles.size;
    if (errors.length) return report;

    decode(tiles, new Set(), errors, 'beforeGates');
    const postGateTiles = new Map([...tiles].map(([id, tile]) => [id, { ...tile }]));
    const allowedPortals = new Set(), regions = {};
    for (const gate of gates) {
        const tile = postGateTiles.get(key(gate.tile.x, gate.tile.y));
        for (const offset of [9, 12, 10, 11, 15]) {
            tile.mazeEntry &= ~(1 << ((gate.direction * 4 + offset) % 16));
        }
        const outward = (gate.direction + 2) % 4;
        const quadrants = [[0, 2], [2, 3], [1, 3], [0, 1]][outward];
        regions[gate.kind] = quadrants.map(quadrant => {
            const id = key(tile.x * 2 + quadrant % 2, tile.y * 2 + Math.floor(quadrant / 2));
            allowedPortals.add(`${id}:${outward}`);
            return id;
        });
    }
    const graph = decode(postGateTiles, allowedPortals, errors, 'afterGates');
    report.totalCells = graph.cells.size;
    report.internalEdges = [...graph.adjacency.values()].reduce((sum, neighbors) => sum + neighbors.length, 0) / 2;
    const remaining = new Set(graph.cells.keys());
    while (remaining.size) {
        report.components++;
        for (const id of reachable(graph.adjacency, [remaining.values().next().value])) remaining.delete(id);
    }
    report.cycleRank = report.internalEdges - report.totalCells + report.components;
    const visited = reachable(graph.adjacency, regions.entrance);
    report.reachableCells = visited.size;
    report.solutionCells = shortestCells(graph.adjacency, regions.entrance, new Set(regions.exit));
    if (report.reachableCells !== report.totalCells) {
        errors.push({ code: 'UNREACHABLE_CELLS', message: 'Some walkable cells cannot be reached from the entrance region.' });
    }
    if (report.solutionCells === null) errors.push({ code: 'EXIT_UNREACHABLE', message: 'No internal route reaches the exit region.' });
    if (regions.entrance.some(id => regions.exit.includes(id))) {
        errors.push({ code: 'OVERLAPPING_PORTALS', message: 'Entrance and exit portal regions must be distinct.' });
    }
    if (graph.external.length !== allowedPortals.size) {
        errors.push({ code: 'GATE_PORTAL', message: 'Native gate clearing did not produce the four expected portal openings.' });
    }
    report.valid = errors.length === 0;
    if (report.valid) report.exitRoutes = edgeDisjointRoutes(graph.adjacency, regions.entrance, regions.exit);
    report.exitRoutesCapped = report.exitRoutes === ROUTE_LIMIT;
    report.exitRoutesLabel = report.exitRoutesCapped ? `>=${ROUTE_LIMIT}` : String(report.exitRoutes);
    return report;
}

module.exports = { analyzeMaze };

if (require.main === module) {
    const fs = require('node:fs');
    try {
        if (process.argv.length !== 3) throw new Error('Usage: node scripts/maze-layout.js <layout.json>');
        if (fs.statSync(process.argv[2]).size > 1024 * 1024) throw new Error('Layout file exceeds 1 MiB.');
        const report = analyzeMaze(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        if (!report.valid || report.exitRoutes < 2) process.exitCode = 1;
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
