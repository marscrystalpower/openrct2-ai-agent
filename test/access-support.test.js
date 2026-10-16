/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { generateAccessSupport, SOURCE_COMMIT } = require('../scripts/access-support');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'vendor/OpenRCT2');
const data = generateAccessSupport(source);
const track = name => data.trackTypes.find(t => t.name === name);

// Intercept reads without modifying the shared pinned checkout. The native
// syntax and descriptor relationships still pass through the real extractor.
function alteredRead(t, suffix, transform) {
    const original = fs.readFileSync;
    let changed = false;
    t.mock.method(fs, 'readFileSync', function (filename, ...args) {
        const value = original.call(this, filename, ...args);
        if (typeof filename === 'string' && filename.replaceAll('\\', '/').endsWith(suffix)) {
            const next = transform(value);
            assert.notEqual(next, value, 'test mutation should apply');
            changed = true;
            return next;
        }
        return value;
    });
    return () => assert.equal(changed, true);
}

test('access metadata is deterministic and covers every pinned ride and track type', () => {
    assert.equal(data.sourceCommit, SOURCE_COMMIT);
    assert.deepEqual(generateAccessSupport(source), data);
    assert.deepEqual(data, JSON.parse(fs.readFileSync(path.join(root, 'generated/access-support.json'), 'utf8')));
    assert.equal(data.rideTypes.length, 103);
    assert.equal(data.trackTypes.length, 350);
    assert.equal(data.trackTypes.reduce((n, t) => n + t.sequences.length, 0), 1345);
    data.rideTypes.forEach((r, id) => {
        assert.equal(r.id, id);
        assert.equal(typeof r.isShopOrFacility, 'boolean');
        assert.equal(typeof r.isFlatRide, 'boolean');
    });
    data.trackTypes.forEach((t, id) => {
        assert.equal(t.id, id);
        assert(t.sequenceCount > 0 && t.sequenceCount <= t.sequences.length);
        t.sequences.forEach((s, index) => {
            assert.equal(s.index, index);
            assert.equal(typeof s.connectsToPath, 'boolean');
            assert(Number.isInteger(s.entranceDirections) && s.entranceDirections >= 0 && s.entranceDirections <= 15);
        });
    });
});

test('shop classification follows native RTD flags, including all seven facility types', () => {
    assert.deepEqual(data.rideTypes.filter(r => r.isShopOrFacility).map(r => [r.id, r.name, r.isFlatRide]), [
        [28, 'food_stall', true], [30, 'drink_stall', true], [32, 'shop', true],
        [35, 'information_kiosk', true], [36, 'toilets', true],
        [45, 'cash_machine', true], [48, 'first_aid', true]
    ]);
    assert.equal(data.rideTypes.find(r => r.name === 'merry_go_round').isShopOrFacility, false);
});

test('direct shop masks remain separate from ordinary ride entrance attachment masks', () => {
    assert.deepEqual(data.trackTypes.filter(t => t.sequences.some(s => s.connectsToPath))
        .map(t => [t.name, t.sequences.map(s => s.entranceDirections)]), [
        ['flatTrack1x1A', [1]], ['flatTrack1x1B', [15]]
    ]);
    assert.deepEqual(track('flatTrack2x2').sequences.map(s => [s.entranceDirections, s.connectsToPath]),
        [[9, false], [3, false], [12, false], [6, false]]);
    assert.equal(track('flatTrack4x4').sequences.length, 16);
    assert.equal(track('maze').sequenceCount, 1);
    assert.equal(track('maze').sequences.length, 16, 'maze variants are retained despite its one-tile footprint');
});

test('non-origin sequence connections are extracted rather than assuming a single counter tile', t => {
    const checked = alteredRead(t, '/ted/TED.FlatRide.h', text => text.replace(
        /(kFlatTrack2x2Seq3\s*=\s*\{[\s\S]*?\.flags\s*=\s*\{)/,
        '$1 SequenceFlag::connectsToPath,'));
    const changed = generateAccessSupport(source).trackTypes.find(t => t.name === 'flatTrack2x2');
    assert.equal(changed.sequences[0].connectsToPath, false);
    assert.equal(changed.sequences[3].connectsToPath, true);
    assert.equal(changed.sequences[3].entranceDirections, 6);
    checked();
});

test('entrance type and sequence masks match native gate semantics and the object binding', () => {
    assert.deepEqual(data.bindings, { entranceTypeProperty: 'object' });
    assert.deepEqual(data.entranceTypes, [
        { id: 0, name: 'rideEntrance', sequenceDirections: [4, 0, 0, 0, 0, 0, 0, 0] },
        { id: 1, name: 'rideExit', sequenceDirections: [4, 0, 0, 0, 0, 0, 0, 0] },
        { id: 2, name: 'parkEntrance', sequenceDirections: [5, 0, 0, 0, 0, 0, 0, 0] }
    ]);
});

test('changed native entrance object classification fails closed', t => {
    const checked = alteredRead(t, '/world/ScTileElement.cpp', text => text.replace(
        'return JS_NewUint32(ctx, EnumValue(el->getEntranceType()));',
        'return JS_NewUint32(ctx, el->getEntryIndex());'));
    assert.throws(() => generateAccessSupport(source), /entrance object binding no longer exposes entrance type/);
    checked();
});

test('unknown upstream commit is rejected before generating access metadata', t => {
    const original = cp.execFileSync;
    t.mock.method(cp, 'execFileSync', function (command, args, options) {
        if (command === 'git' && args.slice(-2).join(' ') === 'rev-parse HEAD') return '0'.repeat(40);
        return original.call(this, command, args, options);
    });
    assert.throws(() => generateAccessSupport(source), /does not match pinned revision/);
});

test('dirty access-specific source inputs fail closed against the pinned commit', t => {
    const original = cp.execFileSync;
    let checked = false;
    t.mock.method(cp, 'execFileSync', function (command, args, options) {
        if (command === 'git' && args.includes('diff') && args.includes('src/openrct2/world/tile_element/EntranceElement.cpp')) {
            checked = true;
            assert(args.includes(SOURCE_COMMIT));
            assert(args.includes('src/openrct2/scripting/bindings/world/ScTileElement.cpp'));
            throw new Error('git diff exit 1');
        }
        return original.call(this, command, args, options);
    });
    assert.throws(() => generateAccessSupport(source), /Access support extraction: upstream extraction sources differ from pinned revision/);
    assert.equal(checked, true);
});

test('untracked access extraction inputs fail closed even with the expected HEAD', t => {
    const original = cp.execFileSync;
    let checked = false;
    t.mock.method(cp, 'execFileSync', function (command, args, options) {
        if (command === 'git' && args.includes('ls-files')) {
            checked = true;
            assert(args.includes('--error-unmatch'));
            assert(args.includes('src/openrct2/world/tile_element/EntranceElement.cpp'));
            throw new Error('source file is untracked');
        }
        return original.call(this, command, args, options);
    });
    assert.throws(() => generateAccessSupport(source), /Access support extraction: upstream extraction sources differ from pinned revision/);
    assert.equal(checked, true);
});

test('unknown sequence flags fail closed instead of inventing doorway metadata', t => {
    const checked = alteredRead(t, '/ted/TED.FlatRide.h', text => text.replace(
        'SequenceFlag::connectsToPath', 'SequenceFlag::futureUnknownConnection'));
    assert.throws(() => generateAccessSupport(source), /unknown SequenceFlag/);
    checked();
});

test('unmapped sequence references fail closed', t => {
    const checked = alteredRead(t, '/ted/TED.FlatRide.h', text => text.replace(
        '.sequenceData = { 1, { kFlatTrack1x1ASeq0 } }', '.sequenceData = { 1, { kMissingCounterSequence } }'));
    assert.throws(() => generateAccessSupport(source), /unknown sequence in kTEDFlatTrack1x1A/);
    checked();
});

test('invalid sequence footprint counts fail closed', t => {
    const checked = alteredRead(t, '/ted/TED.FlatRide.h', text => text.replace(
        '.sequenceData = { 1, { kFlatTrack1x1ASeq0 } }', '.sequenceData = { 2, { kFlatTrack1x1ASeq0 } }'));
    assert.throws(() => generateAccessSupport(source), /invalid sequence count in kTEDFlatTrack1x1A/);
    checked();
});

test('missing sequence metadata fails closed', t => {
    const checked = alteredRead(t, '/ted/TED.FlatRide.h', text => text.replace(
        '.sequenceData = { 1, { kFlatTrack1x1ASeq0 } },', ''));
    assert.throws(() => generateAccessSupport(source), /missing sequenceData in kTEDFlatTrack1x1A/);
    checked();
});

test('native entrance-mask implementation changes require extractor review', t => {
    const checked = alteredRead(t, '/ted/TrackElementDescriptor.h', text => text.replace(
        'return flags.holder & 0xF;', 'return flags.holder & 0x7;'));
    assert.throws(() => generateAccessSupport(source), /native entrance mask changed/);
    checked();
});

test('unrecognized native gate lookup or mask syntax fails closed', t => {
    const checked = alteredRead(t, '/tile_element/EntranceElement.cpp', text => text.replace(
        '{ (4 | 1), 0, 0, 0, 0, 0, 0, 0 }', '{ (1 << 2), 0, 0, 0, 0, 0, 0, 0 }'));
    assert.throws(() => generateAccessSupport(source), /unsupported entrance mask/);
    checked();
});
