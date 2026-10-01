/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
// Extract only pinned native availability metadata. No geometry is duplicated here.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const SOURCE_COMMIT = '8694e3483690323b6a75fa7264b6c58116f51f31';
const EXPECTED = { rides: 103, groups: 90, segments: 350, spriteGroups: 40 };

function check(condition, message) {
    if (!condition) throw new Error('Track support extraction: ' + message);
}
function uncomment(text) {
    return text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
        token => token.startsWith('/') ? ' ' : token);
}
// These small parsers accept the pinned declarations, and reject unfamiliar syntax.
function enclosed(text, start, open = '{', close = '}') {
    check(text[start] === open, 'expected ' + open);
    let depth = 0, quote = null;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === open) depth++;
        if (c === close && --depth === 0) return { body: text.slice(start + 1, i), end: i + 1 };
        if (c !== close) continue;
    }
    throw new Error('Track support extraction: unbalanced ' + open);
}
function split(text, separator = ',') {
    const stack = [], result = [];
    let start = 0, quote = null;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") { quote = c; continue; }
        if ('({['.includes(c)) stack.push(c);
        else if (')}]'.includes(c)) check(stack.pop() === ({ ')': '(', '}': '{', ']': '[' })[c], 'unbalanced initializer');
        else if (c === separator && !stack.length) { result.push(text.slice(start, i).trim()); start = i + 1; }
    }
    check(!stack.length && !quote, 'unbalanced expression');
    result.push(text.slice(start).trim());
    if (result[result.length - 1] === '') result.pop();
    check(result.every(Boolean), 'empty expression');
    return result;
}
function block(text, label) {
    const s = text.trim();
    const b = enclosed(s, 0);
    check(b.end === s.length, 'unexpected suffix in ' + label);
    return b.body;
}
function fields(text, label) {
    const out = {};
    for (const entry of split(block(text, label))) {
        const match = /^\.(\w+)\s*=\s*([\s\S]+)$/.exec(entry);
        check(match && !Object.hasOwn(out, match[1]), 'invalid or duplicate field in ' + label);
        out[match[1]] = match[2].trim();
    }
    return out;
}
function requireField(object, key, label) {
    check(Object.hasOwn(object, key), 'missing ' + key + ' in ' + label);
    return object[key];
}
function matchBlock(text, regex, label) {
    const matches = [...text.matchAll(new RegExp(regex.source, 'g'))];
    check(matches.length === 1, 'expected one ' + label);
    const start = matches[0].index + matches[0][0].length - 1;
    return enclosed(text, start).body;
}
function parseEnumBody(body, label) {
    const values = {}; let next = 0;
    for (const entry of split(body)) {
        const match = /^(\w+)(?:\s*=\s*(\w+))?$/.exec(entry);
        check(match && !Object.hasOwn(values, match[1]), 'unsupported enum entry in ' + label + ': ' + entry);
        if (match[2]) {
            check(/^\d+$/.test(match[2]) || Object.hasOwn(values, match[2]), 'unknown enum value in ' + label);
            next = /^\d+$/.test(match[2]) ? Number(match[2]) : values[match[2]];
        }
        values[match[1]] = next++;
    }
    return values;
}
function parseEnum(text, name) {
    return parseEnumBody(matchBlock(text, new RegExp('enum class ' + name + '\\s*:\\s*\\w+\\s*\\{'), name), name);
}
function namespacedList(text, namespace, values, label) {
    return split(block(text, label)).map(entry => {
        const match = new RegExp('^' + namespace + '::(\\w+)$').exec(entry);
        check(match && Object.hasOwn(values, match[1]), 'unknown ' + namespace + ' in ' + label + ': ' + entry);
        return match[1];
    });
}
function declarations(text, regex, output, label) {
    for (const match of text.matchAll(regex)) {
        check(!Object.hasOwn(output, match[1]), 'duplicate ' + label + ': ' + match[1]);
        const start = match.index + match[0].length - 1;
        const b = enclosed(text, start);
        check(/^\s*;/.test(text.slice(b.end)), 'unexpected declaration suffix for ' + match[1]);
        output[match[1]] = fields('{' + b.body + '}', match[1]);
    }
}
function generateTrackSupport(sourceRoot) {
    sourceRoot = path.resolve(sourceRoot);
    function git(args) { return cp.execFileSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
    check(path.resolve(git(['rev-parse', '--show-toplevel'])) === sourceRoot, 'source root is not an upstream Git checkout');
    check(git(['rev-parse', 'HEAD']) === SOURCE_COMMIT, 'upstream source commit does not match pinned revision');
    const used = new Set();
    function read(relative) { used.add(relative); return uncomment(fs.readFileSync(path.join(sourceRoot, relative), 'utf8')); }
    function headers(relative) {
        return fs.readdirSync(path.join(sourceRoot, relative), { withFileTypes: true }).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
            .flatMap(e => e.isDirectory() ? headers(relative + '/' + e.name) : e.name.endsWith('.h') ? [relative + '/' + e.name] : []);
    }
    const base = 'src/openrct2/ride/';
    const rideDataHeader = read(base + 'RideData.h');
    const rideData = read(base + 'RideData.cpp');
    const groupEnum = parseEnum(read(base + 'ted/TrackGroup.h'), 'TrackGroup');
    const elementEnum = parseEnum(read(base + 'ted/TrackElemType.h'), 'TrackElemType');
    check(groupEnum.count === EXPECTED.groups && elementEnum.count === EXPECTED.segments, 'track group/segment count changed');
    const trackGroups = Object.fromEntries(Object.entries(groupEnum).filter(([name]) => name !== 'count'));
    check(Object.keys(trackGroups).length === EXPECTED.groups, 'track group aliases or missing entries');
    const carHeader = read(base + 'CarEntry.h');
    const spriteGroups = parseEnum(carHeader, 'SpriteGroupType');
    const carFlags = parseEnum(carHeader, 'CarEntryFlag');
    const limits = read('src/openrct2/rct2/DATLimits.h');
    const carCountMatch = /constexpr uint8_t kMaxCarTypesPerRideEntry\s*=\s*(\d+)\s*;/.exec(limits);
    check(carCountMatch && Number(carCountMatch[1]) === 4, 'native ride car count changed');
    const carCount = Number(carCountMatch[1]);
    const rideEntryHeader = read(base + 'RideEntry.h');
    check(/CarEntry Cars\[OpenRCT2::RCT2::ObjectLimits::kMaxCarTypesPerRideEntry\];/.test(rideEntryHeader), 'native ride car array changed');
    const objectBinding = read('src/openrct2/scripting/bindings/object/ScObject.hpp');
    const vehiclesGetter = matchBlock(objectBinding, /static JSValue vehicles_get\(JSContext\* ctx, JSValue thisVal\)\s*\{/, 'vehicles binding');
    check(/for \(size_t i = 0; i < std::size\(rideEntry->Cars\); i\+\+\)/.test(vehiclesGetter), 'native vehicles binding no longer exposes the complete car array');
    const paints = parseEnum(read(base + 'Vehicle.h'), 'VehiclePaintStyle');
    check(spriteGroups.count === EXPECTED.spriteGroups, 'sprite group count changed');
    const yaw = read('src/openrct2/entity/Yaw.hpp');
    const precision = parseEnum(yaw, 'SpritePrecision');
    check(/return\s*\(1\s*<<\s*static_cast<uint8_t>\(precision\)\)\s*>>\s*1\s*;/.test(yaw), 'sprite image-count formula changed');
    check(precision.none === 0 && Object.values(precision).every(n => n >= 0 && n <= 7), 'unsupported sprite precision');
    const spriteBody = matchBlock(read(base + 'Ride.cpp'), /trackPieceRequiredSprites\[\]\s*=\s*\{/, 'trackPieceRequiredSprites');
    const requiredSprites = split(spriteBody).map((entry, groupId) => {
        const tokens = split(block(entry, 'sprite requirements'));
        check(tokens.length % 2 === 0 && tokens.length <= 18, 'invalid sprite requirement count');
        const out = [];
        for (let i = 0; i < tokens.length; i += 2) {
            const g = /^SpriteGroupType::(\w+)$/.exec(tokens[i]);
            const p = /^SpritePrecision::(\w+)$/.exec(tokens[i + 1]);
            check(g && Object.hasOwn(spriteGroups, g[1]) && g[1] !== 'count' && p && Object.hasOwn(precision, p[1]), 'unknown sprite requirement at group ' + groupId);
            out.push({ group: g[1], minImages: (2 ** precision[p[1]]) >> 1 });
        }
        return out;
    });
    check(requiredSprites.length === EXPECTED.groups, 'sprite requirement table count changed');

    const rtdFlags = parseEnum(rideDataHeader, 'RtdFlag');
    const masks = {};
    for (const m of rideDataHeader.matchAll(/constexpr RtdFlags (\w+)\s*=\s*(\{[^}]*\})\s*;/g)) {
        masks[m[1]] = namespacedList(m[2], 'RtdFlag', rtdFlags, m[1]);
    }
    check(Object.keys(masks).length === 3, 'common ride flag masks changed');
    function flags(expression, label) {
        const result = new Set();
        for (const term of split(expression, '|')) {
            if (Object.hasOwn(masks, term)) { masks[term].forEach(f => result.add(f)); continue; }
            const call = /^RtdFlags\(([\s\S]*)\)$/.exec(term);
            const list = namespacedList(call ? '{' + call[1] + '}' : term, 'RtdFlag', rtdFlags, label);
            list.forEach(f => result.add(f));
        }
        return Object.fromEntries(['hasTrack', 'isFlatRide', 'hasInvertedVariant', 'isDummyType', 'startConstructionInverted', 'upInclineRequiresLift'].map(f => [f, result.has(f)]));
    }
    function drawer(expression, label) {
        if (/^\{\s*\}$/.test(expression)) return { enabledGroups: [], coveredGroups: [] };
        const call = /^TrackDrawerDescriptor\(([\s\S]*)\)$/.exec(expression);
        check(call, 'unsupported track drawer in ' + label);
        const entries = split(call[1]);
        check(entries.length === 1 || entries.length === 2, 'track drawer arity in ' + label);
        const groups = entries.map((entry, index) => {
            const data = fields(entry, label);
            const list = namespacedList(requireField(data, 'enabledTrackGroups', label), 'TrackGroup', trackGroups, label);
            // Parse extras to reject unknown syntax, but never add cheat-only groups to enabled lists.
            namespacedList(requireField(data, 'extraTrackGroups', label), 'TrackGroup', trackGroups, label);
            return [...new Set(list.map(name => trackGroups[name]))].sort((a,b) => a-b);
        });
        return { enabledGroups: groups[0], coveredGroups: groups[1] || [] };
    }
    const descriptors = {};
    const rtdPattern = /constexpr RideTypeDescriptor (\w+)\s*=\s*\{/g;
    declarations(rideDataHeader, rtdPattern, descriptors, 'ride descriptor');
    for (const file of headers(base + 'rtd')) declarations(read(file), rtdPattern, descriptors, 'ride descriptor');
    const mapping = split(matchBlock(rideData, /kRideTypeDescriptors\[RIDE_TYPE_COUNT\]\s*=\s*\{/, 'ride descriptor mapping'));
    const rideHeader = read(base + 'Ride.h');
    const rideEnumBody = /enum\s*\{\s*(RIDE_TYPE_SPIRAL_ROLLER_COASTER[\s\S]*?RIDE_TYPE_COUNT\s*)\}/.exec(rideHeader);
    check(rideEnumBody, 'missing ride type enum');
    const rideEnum = parseEnumBody(rideEnumBody[1], 'ride types');
    check(rideEnum.RIDE_TYPE_COUNT === EXPECTED.rides && mapping.length === EXPECTED.rides, 'ride type count changed');
    const rideTypes = mapping.map((key, id) => {
        check(/^k\w+RTD$/.test(key) && Object.hasOwn(descriptors, key), 'unknown ride descriptor: ' + key);
        const data = descriptors[key];
        const start = /^TrackElemType::(\w+)$/.exec(requireField(data, 'StartTrackPiece', key));
        const name = /^"([a-z0-9_]+)"$/.exec(requireField(data, 'Name', key));
        check(start && Object.hasOwn(elementEnum, start[1]) && elementEnum[start[1]] < EXPECTED.segments && name, 'invalid ride name/start piece: ' + key);
        return { id, name: name[1], startTrackPiece: elementEnum[start[1]], flags: flags(requireField(data, 'flags', key), key),
            regular: drawer(requireField(data, 'TrackPaintFunctions', key), key),
            inverted: drawer(requireField(data, 'InvertedTrackPaintFunctions', key), key) };
    });
    check(new Set(mapping).size === Object.keys(descriptors).length, 'unmapped ride descriptors');

    const trackData = read(base + 'TrackData.cpp');
    const ted = {};
    const tedPattern = /constexpr auto (kTED\w+)\s*=\s*TrackElementDescriptor\s*\{/g;
    declarations(trackData, tedPattern, ted, 'track descriptor');
    for (const file of headers(base + 'ted').filter(file => /\/TED\./.test(file))) declarations(read(file), tedPattern, ted, 'track descriptor');
    const tedNames = split(matchBlock(trackData, /kTrackElementDescriptors\s*=\s*std::to_array<TrackElementDescriptor>\(\{/, 'track descriptor mapping'));
    check(tedNames.length === EXPECTED.segments && Object.keys(ted).length === EXPECTED.segments, 'track descriptor count changed');
    const descriptorHeader = read(base + 'ted/TrackElementDescriptor.h');
    const tedFlags = parseEnum(descriptorHeader, 'TrackElementFlag');
    check(/struct TrackDefinition\s*\{\s*TrackGroup group;\s*TrackPitch pitchEnd;\s*TrackPitch pitchStart;\s*TrackRoll rollEnd;\s*TrackRoll rollStart;\s*int8_t previewZOffset;\s*\}/.test(descriptorHeader), 'track definition field order changed');
    const pitchAndRoll = read(base + 'ted/PitchAndRoll.h');
    const trackPitches = parseEnum(pitchAndRoll, 'TrackPitch');
    const trackRolls = parseEnum(pitchAndRoll, 'TrackRoll');
    check(/TrackElemType alternativeType\s*=\s*TrackElemType::none\s*;/.test(descriptorHeader), 'alternative type default changed');
    const coveredSource = read(base + 'ted/TrackElemType.cpp');
    const coveredBody = matchBlock(coveredSource, /bool trackTypeIsCovered\(TrackElemType trackElementType\)\s*\{/, 'covered type function');
    const coveredNames = [...coveredBody.matchAll(/case TrackElemType::(\w+)\s*:/g)].map(m => m[1]);
    check(coveredNames.length === 19 && /default:\s*return false;/.test(coveredBody), 'covered type cases changed');
    const construction = read('src/openrct2-ui/windows/RideConstruction.cpp');
    const forced = /if \(trackType == TrackElemType::(\w+) \|\| trackType == TrackElemType::(\w+)\)\s*\{\s*liftHillAndInvertedState\.set\(LiftHillAndInverted::liftHill\);\s*\}/.exec(construction);
    check(forced, 'forced chain-lift cases changed');
    const byId = [];
    for (const [name, id] of Object.entries(elementEnum)) if (id < EXPECTED.segments && byId[id] === undefined) byId[id] = name;
    const segments = tedNames.map((key, id) => {
        check(Object.hasOwn(ted, key) && byId[id], 'unknown track descriptor: ' + key);
        const data = ted[key];
        const flagSet = new Set(namespacedList(requireField(data, 'flags', key), 'TrackElementFlag', tedFlags, key));
        const definition = split(block(requireField(data, 'definition', key), key));
        check(definition.length === 6, 'track definition arity changed: ' + key);
        const group = /^TrackGroup::(\w+)$/.exec(definition[0]);
        check(group && Object.hasOwn(trackGroups, group[1]), 'unknown track group: ' + key);
        function endpoint(index, namespace, enumeration) {
            const match = new RegExp('^' + namespace + '::(\\w+)$').exec(definition[index]);
            check(match && Object.hasOwn(enumeration, match[1]), 'unknown track endpoint: ' + key);
            return enumeration[match[1]];
        }
        const alternate = data.alternativeType ? /^TrackElemType::(\w+)$/.exec(data.alternativeType) : null;
        check(!data.alternativeType || (alternate && Object.hasOwn(elementEnum, alternate[1])), 'invalid alternate type: ' + key);
        return { id, name: byId[id], trackGroup: trackGroups[group[1]],
            beginSlope: endpoint(2, 'TrackPitch', trackPitches), endSlope: endpoint(1, 'TrackPitch', trackPitches),
            beginBank: endpoint(4, 'TrackRoll', trackRolls), endBank: endpoint(3, 'TrackRoll', trackRolls),
            flags: { allowLiftHill: flagSet.has('allowLiftHill'), curveAllowsLift: flagSet.has('curveAllowsLift'), isSteepUp: flagSet.has('isSteepUp'), isBanked: flagSet.has('banked'), isInversion: flagSet.has('inversionToNormal') },
            alternateTypeSegment: alternate && elementEnum[alternate[1]] !== elementEnum.none ? elementEnum[alternate[1]] : null,
            coveredBase: null, forceChain: forced.slice(1).includes(byId[id]) };
    });
    for (const name of coveredNames) {
        const id = elementEnum[name];
        check(id !== undefined && segments[id], 'unknown covered track type: ' + name);
        const bases = segments.filter(s => s.alternateTypeSegment === id);
        check(bases.length === 1, 'covered track type must have one base: ' + name);
        segments[id].coveredBase = bases[0].id;
    }
    // RideConstruction's ordinary control-path pieces often use TrackGroup::flat,
    // which is NOT a universal permission. Pin-specific UI rules are enumerated
    // here by names, with exhaustive coverage checked below. Sources:
    // src/openrct2/ride/RideConstruction.cpp: kNextSelectedPiece
    // src/openrct2-ui/windows/RideConstruction.cpp: 381-455 (slopes/banking),
    // 650-668 (vertical/diagonal), 780-848 (banked transitions), 1749-1757
    // (curve buttons), and 4833-4879 (short-to-long substitution).
    read(base + 'RideConstruction.cpp');
    const rules = new Map();
    function requireGroups(names, groups, excluded = [], any = []) {
        for (const name of names.split(' ')) {
            check(Object.hasOwn(elementEnum, name) && !rules.has(name), 'unknown/duplicate UI rule: ' + name);
            for (const g of [...groups, ...excluded, ...any]) check(Object.hasOwn(trackGroups, g), 'unknown UI group: ' + g);
            rules.set(name, { requiredGroups: groups.map(g => trackGroups[g]),
                excludedGroups: excluded.map(g => trackGroups[g]), requiredAnyGroups: any.map(g => trackGroups[g]) });
        }
    }
    requireGroups('up90 down90 up60ToUp90 up90ToUp60 down90ToDown60 down60ToDown90', ['straight', 'slopeVertical']);
    requireGroups('leftEighthToDiag rightEighthToDiag leftEighthToOrthogonal rightEighthToOrthogonal', ['curveLarge']);
    requireGroups('leftEighthBankToDiag rightEighthBankToDiag leftEighthBankToOrthogonal rightEighthBankToOrthogonal', ['curveLarge', 'flatRollBanking']);
    requireGroups('diagFlat', ['straight', 'curveLarge']);
    requireGroups('diagFlatToLeftBank diagFlatToRightBank diagLeftBankToFlat diagRightBankToFlat diagLeftBank diagRightBank', ['straight', 'curveLarge', 'flatRollBanking']);
    requireGroups('diagLeftBankToUp25 diagRightBankToUp25 diagUp25ToLeftBank diagUp25ToRightBank diagLeftBankToDown25 diagRightBankToDown25 diagDown25ToLeftBank diagDown25ToRightBank', ['straight', 'curveLarge', 'flatRollBanking', 'diagSlope']);
    requireGroups('leftBankToLeftQuarterTurn3TilesUp25 rightBankToRightQuarterTurn3TilesUp25 leftQuarterTurn3TilesDown25ToLeftBank rightQuarterTurn3TilesDown25ToRightBank', ['curveSmall', 'slopeCurve', 'slopeCurveBanked', 'flatRollBanking']);
    // Slope groups alone do not expose every curve radius. In particular, the
    // wild-mouse styles have slopeCurve but no five-tile curve painter/button.
    requireGroups('leftQuarterTurn5TilesUp25 rightQuarterTurn5TilesUp25 leftQuarterTurn5TilesDown25 rightQuarterTurn5TilesDown25', ['curve', 'slopeCurve']);
    requireGroups('leftQuarterTurn3TilesUp25 rightQuarterTurn3TilesUp25 leftQuarterTurn3TilesDown25 rightQuarterTurn3TilesDown25', ['curveSmall', 'slopeCurve']);
    // Vertical quarter turns use the vertical-curve control, even though their
    // TED group is slopeCurveSteep (UI RideConstruction.cpp:535).
    requireGroups('leftQuarterTurn1TileUp90 rightQuarterTurn1TileUp90 leftQuarterTurn1TileDown90 rightQuarterTurn1TileDown90', ['curveVertical']);
    // Banked sloped turns also require slope banking, beyond the shared slopeCurve
    // TED group (UI RideConstruction.cpp:425,511,701).
    requireGroups('leftBankedQuarterTurn3TileUp25 rightBankedQuarterTurn3TileUp25 leftBankedQuarterTurn3TileDown25 rightBankedQuarterTurn3TileDown25', ['curveSmall', 'slopeCurve', 'flatRollBanking', 'slopeRollBanking']);
    requireGroups('leftBankedQuarterTurn5TileUp25 rightBankedQuarterTurn5TileUp25 leftBankedQuarterTurn5TileDown25 rightBankedQuarterTurn5TileDown25', ['curve', 'slopeCurve', 'flatRollBanking', 'slopeRollBanking']);
    // Cardinal banking-to-slope transitions share flatRollBanking with flat
    // banks, but require the ordinary ±25 slope control (UI:1791-1794).
    // Air-powered Vertical supports banks, but neither the slope control nor
    // these transition painters (AirPoweredVerticalCoaster.cpp:1001-1050).
    requireGroups('leftBankToUp25 rightBankToUp25 up25ToLeftBank up25ToRightBank leftBankToDown25 rightBankToDown25 down25ToLeftBank down25ToRightBank', ['flatRollBanking', 'slope']);
    requireGroups('bankedLeftQuarterTurn5Tiles bankedRightQuarterTurn5Tiles', ['flatRollBanking', 'curve']);
    requireGroups('leftBankedQuarterTurn3Tiles rightBankedQuarterTurn3Tiles', ['flatRollBanking', 'curveSmall']);
    requireGroups('flatToUp60 up60ToFlat', ['flatToSteepSlope'], ['slopeSteepLong'], ['slopeSteepUp', 'diagSlopeSteepUp']);
    requireGroups('flatToDown60 down60ToFlat', ['flatToSteepSlope'], ['slopeSteepLong'], ['slopeSteepDown', 'diagSlopeSteepDown']);
    requireGroups('diagFlatToUp60 diagUp60ToFlat', ['diagSlopeSteepUp', 'flatToSteepSlope'], ['diagSlopeSteepLong']);
    requireGroups('diagFlatToDown60 diagDown60ToFlat', ['diagSlopeSteepDown', 'flatToSteepSlope'], ['diagSlopeSteepLong']);
    // The four diagonal long-base TEDs say slopeSteepLong, but their UI selector
    // is explicitly diagSlopeSteepLong. Preserve raw trackGroup for API checks.
    requireGroups('diagFlatToUp60LongBase diagUp60ToFlatLongBase diagFlatToDown60LongBase diagDown60ToFlatLongBase', ['diagSlopeSteepLong']);
    for (const segment of segments) {
        if (segment.coveredBase !== null) continue;
        if (segment.trackGroup === trackGroups.flat && segment.name !== 'maze') {
            check(rules.has(segment.name), 'unmapped ordinary flat-group track: ' + segment.name);
        }
        const rule = rules.get(segment.name);
        segment.requiredGroups = rule ? rule.requiredGroups : segment.name === 'maze' ? [] : [segment.trackGroup];
        segment.excludedGroups = rule ? rule.excludedGroups : [];
        segment.requiredAnyGroups = rule ? rule.requiredAnyGroups : [];
    }
    // Covered support is selected with the *uncovered* TED's group, before the
    // UI substitutes the covered ID (RideConstruction.cpp:4883-4899).
    for (const segment of segments) if (segment.coveredBase !== null) {
        const original = segments[segment.coveredBase];
        segment.requiredGroups = original.requiredGroups.slice();
        segment.excludedGroups = original.excludedGroups.slice();
        segment.requiredAnyGroups = original.requiredAnyGroups.slice();
    }
    const constants = { carCount, standardPaintStyle: paints.standard, spinningPaintStyle: paints.spinningCars,
        chairliftFlag: 2 ** carFlags.isChairlift, slideSwingFlag: 2 ** carFlags.useSlideSwing };
    check(Object.values(constants).every(Number.isSafeInteger), 'missing vehicle constants');
    // A matching HEAD alone is insufficient: locally modified extraction inputs are not pinned source.
    try { git(['diff', '--quiet', SOURCE_COMMIT, '--', ...[...used].sort()]); }
    catch { throw new Error('Track support extraction: upstream extraction sources differ from pinned revision'); }
    return { sourceCommit: SOURCE_COMMIT, rideTypes, trackGroups, requiredSprites, segments, constants, trackPitches, trackRolls };
}
module.exports = { generateTrackSupport, SOURCE_COMMIT };
if (require.main === module) {
    const data = generateTrackSupport(process.argv[2] || path.resolve(__dirname, '../vendor/OpenRCT2'));
    const output = process.argv[3] || path.resolve(__dirname, '../generated/track-support.json');
    fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
    console.log('Generated track support: ' + data.rideTypes.length + ' ride types, ' + data.segments.length + ' segments');
}
