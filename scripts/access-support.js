/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
// Pinned native access metadata, never inferred from a stall's visual footprint.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { generateTrackSupport, SOURCE_COMMIT } = require('./track-support');

function check(condition, message) {
    if (!condition) throw new Error('Access support extraction: ' + message);
}
function uncomment(text) {
    return text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
        token => token.startsWith('/') ? ' ' : token);
}
function enclosed(text, start) {
    check(text[start] === '{', 'expected initializer');
    let depth = 0, quote = null;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === '{') depth++;
        if (c === '}' && --depth === 0) return { body: text.slice(start + 1, i), end: i + 1 };
    }
    throw new Error('Access support extraction: unbalanced initializer');
}
function split(text, separator = ',') {
    const stack = [], result = [];
    let start = 0, quote = null;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") { quote = c; continue; }
        if ('({['.includes(c)) stack.push(c);
        else if (')}]'.includes(c)) check(stack.pop() === ({ ')': '(', '}': '{', ']': '[' })[c], 'unbalanced expression');
        else if (c === separator && !stack.length) { result.push(text.slice(start, i).trim()); start = i + 1; }
    }
    check(!stack.length && !quote, 'unbalanced expression');
    result.push(text.slice(start).trim());
    if (result[result.length - 1] === '') result.pop();
    check(result.every(Boolean), 'empty expression');
    return result;
}
function block(text) {
    const s = text.trim(), b = enclosed(s, 0);
    check(b.end === s.length, 'unexpected initializer suffix');
    return b.body;
}
function fields(text, label) {
    const result = {};
    for (const entry of split(block(text))) {
        const m = /^\.(\w+)\s*=\s*([\s\S]+)$/.exec(entry);
        check(m && !Object.hasOwn(result, m[1]), 'invalid or duplicate field in ' + label);
        result[m[1]] = m[2].trim();
    }
    return result;
}
function field(object, key, label) {
    check(Object.hasOwn(object, key), 'missing ' + key + ' in ' + label);
    return object[key];
}
function matchBlock(text, regex, label) {
    const matches = [...text.matchAll(new RegExp(regex.source, 'g'))];
    check(matches.length === 1, 'expected one ' + label);
    return enclosed(text, matches[0].index + matches[0][0].length - 1).body;
}
function enumeration(body, label) {
    const result = {}; let next = 0;
    for (const entry of split(body)) {
        const m = /^(\w+)(?:\s*=\s*(\d+))?$/.exec(entry);
        check(m && !Object.hasOwn(result, m[1]), 'unsupported enum in ' + label);
        if (m[2]) next = Number(m[2]);
        result[m[1]] = next++;
    }
    return result;
}
function namespacedList(text, namespace, values, label) {
    return split(block(text)).map(entry => {
        const m = new RegExp('^' + namespace + '::(\\w+)$').exec(entry);
        check(m && Object.hasOwn(values, m[1]), 'unknown ' + namespace + ' in ' + label);
        return m[1];
    });
}
function declarations(text, regex, output, label) {
    for (const m of text.matchAll(regex)) {
        check(!Object.hasOwn(output, m[1]), 'duplicate ' + label + ': ' + m[1]);
        const b = enclosed(text, m.index + m[0].length - 1);
        check(/^\s*;/.test(text.slice(b.end)), 'unexpected declaration suffix in ' + label);
        output[m[1]] = fields('{' + b.body + '}', m[1]);
    }
}

function generateAccessSupport(sourceRoot) {
    sourceRoot = path.resolve(sourceRoot);
    // Reuse the exhaustive pinned ride/TED identity and source checks. The access
    // extractor adds sequence metadata, not a second track availability system.
    const support = generateTrackSupport(sourceRoot);
    const used = new Set();
    function git(args) {
        return cp.execFileSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    }
    function read(relative) { used.add(relative); return uncomment(fs.readFileSync(path.join(sourceRoot, relative), 'utf8')); }
    function headers(relative) {
        return fs.readdirSync(path.join(sourceRoot, relative), { withFileTypes: true })
            .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
            .flatMap(e => e.isDirectory() ? headers(relative + '/' + e.name) : e.name.endsWith('.h') ? [relative + '/' + e.name] : []);
    }
    const base = 'src/openrct2/ride/';
    const descriptorHeader = read(base + 'ted/TrackElementDescriptor.h');
    const sequenceFlags = enumeration(matchBlock(descriptorHeader, /enum class SequenceFlag\s*:\s*uint8_t\s*\{/, 'sequence flags'), 'sequence flags');
    check(sequenceFlags.entranceConnectionNE === 0 && sequenceFlags.entranceConnectionSE === 1
        && sequenceFlags.entranceConnectionSW === 2 && sequenceFlags.entranceConnectionNW === 3,
    'entrance direction flag order changed');
    check(/return flags\.holder & 0xF;/.test(matchBlock(descriptorHeader,
        /constexpr uint8_t getEntranceConnectionSides\(\) const\s*\{/, 'entrance side getter')), 'native entrance mask changed');
    check(/SequenceFlags flags\{\};/.test(descriptorHeader), 'sequence flag default changed');
    const descriptors = {}, sequences = {};
    const trackData = read(base + 'TrackData.cpp');
    for (const text of [trackData, ...headers(base + 'ted').filter(p => /\/TED\./.test(p)).map(read)]) {
        declarations(text, /constexpr auto (kTED\w+)\s*=\s*TrackElementDescriptor\s*\{/g, descriptors, 'track descriptor');
        declarations(text, /(?:static\s+)?constexpr SequenceDescriptor (\w+)\s*=\s*\{/g, sequences, 'sequence descriptor');
    }
    const mapping = split(matchBlock(trackData, /kTrackElementDescriptors\s*=\s*std::to_array<TrackElementDescriptor>\(\{/, 'track descriptor mapping'));
    check(mapping.length === support.segments.length && Object.keys(descriptors).length === mapping.length,
        'track descriptor mapping is incomplete');
    const trackTypes = mapping.map((name, id) => {
        const data = descriptors[name];
        check(data && support.segments[id].id === id, 'unknown track descriptor');
        const table = split(block(field(data, 'sequenceData', name)));
        check(table.length === 2 && /^\d+$/.test(table[0]), 'unsupported sequence table in ' + name);
        const sequenceCount = Number(table[0]), entries = split(block(table[1]));
        // Maze uses 16 named flag variants despite having a one-tile footprint.
        check(sequenceCount >= 1 && sequenceCount <= 16 && entries.length >= sequenceCount && entries.length <= 16,
            'invalid sequence count in ' + name);
        return { id, name: support.segments[id].name, sequenceCount, sequences: entries.map((entry, index) => {
            check(/^\w+$/.test(entry) && Object.hasOwn(sequences, entry), 'unknown sequence in ' + name);
            const flags = new Set(namespacedList(sequences[entry].flags || '{}', 'SequenceFlag', sequenceFlags, entry));
            const entranceDirections = [...flags].reduce((mask, flag) => sequenceFlags[flag] < 4 ? mask | (1 << sequenceFlags[flag]) : mask, 0);
            return { index, connectsToPath: flags.has('connectsToPath'), entranceDirections };
        }) };
    });

    const rideHeader = read(base + 'RideData.h'), rideData = read(base + 'RideData.cpp');
    const rtdFlags = enumeration(matchBlock(rideHeader, /enum class RtdFlag\s*:\s*\w+\s*\{/, 'ride flags'), 'ride flags');
    const masks = {};
    for (const m of rideHeader.matchAll(/constexpr RtdFlags (\w+)\s*=\s*(\{[^}]*\})\s*;/g))
        masks[m[1]] = namespacedList(m[2], 'RtdFlag', rtdFlags, m[1]);
    function rideFlags(expression, label) {
        const result = new Set();
        for (const term of split(expression, '|')) {
            if (Object.hasOwn(masks, term)) { masks[term].forEach(flag => result.add(flag)); continue; }
            const call = /^RtdFlags\(([\s\S]*)\)$/.exec(term);
            namespacedList(call ? '{' + call[1] + '}' : term, 'RtdFlag', rtdFlags, label).forEach(flag => result.add(flag));
        }
        return result;
    }
    const rides = {};
    const rtdPattern = /constexpr RideTypeDescriptor (\w+)\s*=\s*\{/g;
    declarations(rideHeader, rtdPattern, rides, 'ride descriptor');
    for (const relative of headers(base + 'rtd')) declarations(read(relative), rtdPattern, rides, 'ride descriptor');
    const rideMapping = split(matchBlock(rideData, /kRideTypeDescriptors\[RIDE_TYPE_COUNT\]\s*=\s*\{/, 'ride descriptor mapping'));
    check(rideMapping.length === support.rideTypes.length && new Set(rideMapping).size === Object.keys(rides).length,
        'ride descriptor mapping is incomplete');
    const rideTypes = rideMapping.map((name, id) => {
        const data = rides[name];
        check(data && field(data, 'Name', name) === JSON.stringify(support.rideTypes[id].name), 'ride type identity mismatch');
        const flags = rideFlags(field(data, 'flags', name), name);
        return { id, name: support.rideTypes[id].name, isShopOrFacility: flags.has('isShopOrFacility'), isFlatRide: flags.has('isFlatRide') };
    });
    check(rideTypes.some(ride => ride.isShopOrFacility) && trackTypes.some(track => track.sequences.some(seq => seq.connectsToPath)),
        'empty direct access metadata');

    const entranceHeader = read('src/openrct2/world/tile_element/EntranceElement.h');
    const entranceEnum = enumeration(matchBlock(entranceHeader, /enum class EntranceType\s*:\s*uint8_t\s*\{/, 'entrance types'), 'entrance types');
    const entranceSource = read('src/openrct2/world/tile_element/EntranceElement.cpp');
    const entranceTable = split(block(matchBlock(entranceSource,
        /kEntranceDirections\s*=\s*\{/, 'entrance direction table')));
    check(entranceTable.length === Object.keys(entranceEnum).length, 'entrance direction table size changed');
    const entranceTypes = Object.entries(entranceEnum).map(([name, id]) => {
        const values = split(block(entranceTable[id]));
        check(values.length === 8, 'entrance sequence count changed');
        const sequenceDirections = values.map(value => {
            const terms = value.replace(/[()]/g, '').split('|').map(term => term.trim());
            check(terms.every(term => /^\d+$/.test(term)), 'unsupported entrance mask');
            const mask = terms.reduce((bits, term) => bits | Number(term), 0);
            check(mask >= 0 && mask <= 15, 'invalid entrance mask');
            return mask;
        });
        return { id, name, sequenceDirections };
    });
    check(/return kEntranceDirections\[EnumValue\(getEntranceType\(\)\)\]\[EnumValue\(getSequenceIndex\(\)\)\];/.test(entranceSource),
        'native entrance direction lookup changed');
    const tileBindings = read('src/openrct2/scripting/bindings/world/ScTileElement.cpp');
    const objectGetter = matchBlock(tileBindings, /JSValue ScTileElement::object_get\([^)]*\)\s*\{/, 'tile object binding');
    check(/case TileElementType::entrance:\s*\{\s*auto\* el = element->asEntrance\(\);\s*return JS_NewUint32\(ctx, EnumValue\(el->getEntranceType\(\)\)\);\s*\}/.test(objectGetter),
        'entrance object binding no longer exposes entrance type');
    // A matching HEAD alone does not pin modified extraction inputs.
    try {
        git(['ls-files', '--error-unmatch', '--', ...[...used].sort()]);
        git(['diff', '--quiet', SOURCE_COMMIT, '--', ...[...used].sort()]);
    }
    catch { throw new Error('Access support extraction: upstream extraction sources differ from pinned revision'); }
    return { sourceCommit: SOURCE_COMMIT, rideTypes, trackTypes, entranceTypes,
        bindings: { entranceTypeProperty: 'object' } };
}

module.exports = { generateAccessSupport, SOURCE_COMMIT };
if (require.main === module) {
    const data = generateAccessSupport(process.argv[2] || path.resolve(__dirname, '../vendor/OpenRCT2'));
    const output = process.argv[3] || path.resolve(__dirname, '../generated/access-support.json');
    fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
    console.log('Generated access support: ' + data.rideTypes.length + ' ride types, ' + data.trackTypes.length + ' track types');
}
