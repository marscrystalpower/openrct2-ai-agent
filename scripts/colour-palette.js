/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const compatibility = require('./compatibility.json');
function check(condition, message) { if (!condition) throw Error('Colour palette extraction: ' + message); }
function generateColourPalette(sourceRoot) {
    sourceRoot = path.resolve(sourceRoot);
    const git = args => cp.execFileSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    check(path.resolve(git(['rev-parse', '--show-toplevel'])) === sourceRoot, 'source root is not an upstream Git checkout');
    check(git(['rev-parse', 'HEAD']) === compatibility.sourceCommit, 'upstream source commit does not match pinned revision');
    const inputs = ['src/openrct2/drawing/Colour.h', 'src/openrct2/drawing/Colour.cpp'];
    const [header, implementation] = inputs.map(file => fs.readFileSync(path.join(sourceRoot, file), 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ''));
    const body = header.match(/enum class Colour\s*:\s*uint8_t\s*\{([^}]+)\}/);
    check(body, 'missing Colour enum');
    const names = body[1].split(',').map(s => s.trim()).filter(Boolean);
    check(names.length === 74 && names.every(n => /^\w+$/.test(n)) && new Set(names).size === names.length, 'unexpected Colour enum syntax or count');
    const normalCount = Number(header.match(/kColourNumNormal\s*=\s*(\d+);/)?.[1]);
    const totalCount = Number(header.match(/kColourNumTotal\s*=\s*(\d+);/)?.[1]);
    check(normalCount === 72 && totalCount === names.length, 'unexpected colour counts');
    const lookup = [...implementation.matchAll(/\{\s*"([a-z_]+)"\s*,\s*Colour::(\w+)\s*\}/g)];
    check(lookup.length === totalCount && lookup.every(m => names.includes(m[2])) && new Set(lookup.map(m => m[2])).size === totalCount, 'incomplete or duplicate colour name lookup');
    const strings = Object.fromEntries(lookup.map(m => [m[2], m[1]]));
    const colours = names.map((name, id) => ({ id, name, objectName: strings[name], special: name === 'invisible' || name === 'voidBackground', addedIn: id >= 56 ? '0.5.6' : null }));
    check(colours[54].name === 'invisible' && colours[55].name === 'voidBackground' && colours[56].name === 'gold' && colours[73].name === 'silver', 'colour identifiers changed');
    try { git(['diff', '--quiet', compatibility.sourceCommit, '--', ...inputs]); }
    catch { throw Error('Colour palette extraction: upstream extraction sources differ from pinned revision'); }
    return { ...compatibility, normalCount, totalCount, minId: 0, maxId: totalCount - 1, colours };
}
module.exports = { generateColourPalette };
