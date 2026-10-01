'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { generateTrackSupport, SOURCE_COMMIT } = require('../scripts/track-support');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'vendor/OpenRCT2');
const data = generateTrackSupport(source);
const group = name => data.trackGroups[name];
const segment = name => data.segments.find(s => s.name === name);

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

test('metadata is deterministic, pinned and identical to checked-in output', () => {
    assert.equal(data.sourceCommit, SOURCE_COMMIT);
    assert.deepEqual(generateTrackSupport(source), data);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'generated/track-support.json'), 'utf8')), data);
    assert.equal(data.rideTypes.length, 103);
    assert.equal(Object.keys(data.trackGroups).length, 90);
    assert.equal(data.requiredSprites.length, 90);
    assert.equal(data.segments.length, 350);
    for (const [id, ride] of data.rideTypes.entries()) assert.equal(ride.id, id);
    for (const [id, s] of data.segments.entries()) assert.equal(s.id, id);
    assert.equal(segment('count'), undefined);
    assert.equal(segment('none'), undefined);
    assert.equal(segment('highestAlias'), undefined);
});

test('ride flags expand common coaster masks and preserve special ride types', () => {
    const wooden = data.rideTypes[52];
    assert.equal(wooden.name, 'wooden_rc');
    assert.equal(wooden.flags.hasTrack, true);
    assert.equal(wooden.flags.isFlatRide, false);
    assert.equal(wooden.startTrackPiece, 1);
    assert.equal(data.rideTypes[39].flags.isFlatRide, true);
    assert.equal(data.rideTypes[39].flags.hasTrack, false);
    assert.equal(data.rideTypes[29].flags.isDummyType, true);
    assert.equal(data.rideTypes[29].name, 'invalid');
    assert.equal(data.rideTypes[29].flags.hasTrack, false);
    assert.deepEqual(data.rideTypes[29].regular.enabledGroups, []);
});

test('normal, covered and inverted groups remain separate and exclude cheats', () => {
    const looping = data.rideTypes[15];
    assert(looping.regular.enabledGroups.includes(group('verticalLoop')));
    assert(!looping.regular.enabledGroups.includes(group('corkscrew')));
    assert.deepEqual(looping.inverted.enabledGroups, []);
    const dinghy = data.rideTypes[16];
    assert(dinghy.regular.enabledGroups.includes(group('stationEnd')));
    assert(!dinghy.regular.coveredGroups.includes(group('stationEnd')));
    assert(dinghy.regular.coveredGroups.includes(group('straight')));
    const flying = data.rideTypes[57];
    assert.equal(flying.flags.hasInvertedVariant, true);
    assert.equal(flying.flags.startConstructionInverted, true);
    assert(!flying.regular.enabledGroups.includes(group('stationEnd')));
    assert(flying.inverted.enabledGroups.includes(group('stationEnd')));
    assert(!flying.inverted.enabledGroups.includes(group('flyingLargeHalfLoopInvertedUp')));
});

test('sprite requirements use numeric positions and image counts, not source comments', () => {
    assert.deepEqual(data.requiredSprites[group('flat')], [{ group: 'slopeFlat', minImages: 0 }]);
    assert.deepEqual(data.requiredSprites[group('curve')], [{ group: 'slopeFlat', minImages: 16 }]);
    assert.deepEqual(data.requiredSprites[group('diagBrakes')], [{ group: 'slopeFlat', minImages: 8 }]);
    assert.deepEqual(data.requiredSprites[group('flatRideBase')], []);
    assert.deepEqual(data.requiredSprites[group('miniGolfHole')], []);
    // Upstream's positional diagonal row is incorrectly commented slopeSteepLong.
    assert.deepEqual(data.requiredSprites[group('diagSlopeSteepLong')], [
        { group: 'slopes8', minImages: 4 }, { group: 'slopes16', minImages: 4 },
        { group: 'slopes25', minImages: 8 }, { group: 'slopes42', minImages: 8 },
        { group: 'slopes50', minImages: 4 }
    ]);
    assert.deepEqual(data.requiredSprites[group('slopeSteepLong')], [
        { group: 'slopes25', minImages: 4 }, { group: 'slopes60', minImages: 4 }
    ]);
});

test('canonical track metadata distinguishes covered, steep and forced-chain types', () => {
    assert.equal(segment('up60').flags.isSteepUp, true);
    assert.equal(segment('up60').flags.allowLiftHill, true);
    assert.equal(segment('down60').flags.isSteepUp, false);
    assert.equal(segment('flatCovered').trackGroup, group('flat'));
    assert.equal(segment('flatCovered').coveredBase, segment('flat').id);
    assert.equal(segment('flat').alternateTypeSegment, segment('flatCovered').id);
    assert.equal(segment('flatCovered').flags.allowLiftHill, false);
    assert.equal(data.segments.filter(s => s.coveredBase !== null).length, 19);
    assert.equal(segment('leftCurvedLiftHill').flags.allowLiftHill, false);
    assert.deepEqual(data.segments.filter(s => s.forceChain).map(s => s.name), ['leftCurvedLiftHill', 'rightCurvedLiftHill']);
    assert(data.segments.some(s => s.flags.curveAllowsLift));
    assert(data.segments.some(s => s.flags.isBanked));
    assert(data.segments.some(s => s.flags.isInversion));
    assert.deepEqual(data.constants, { carCount: 4, standardPaintStyle: 0, spinningPaintStyle: 17, chairliftFlag: 268435456, slideSwingFlag: 134217728 });
});

test('unknown pinned source commit fails closed', t => {
    const original = cp.execFileSync;
    t.mock.method(cp, 'execFileSync', function (command, args, options) {
        if (command === 'git' && args.slice(-2).join(' ') === 'rev-parse HEAD') return '0'.repeat(40);
        return original.call(this, command, args, options);
    });
    assert.throws(() => generateTrackSupport(source), /does not match pinned revision/);
});

test('unexpected group enum syntax fails closed', t => {
    const checked = alteredRead(t, '/ted/TrackGroup.h', text => text.replace('straight,', 'straight = (1 << 0),'));
    assert.throws(() => generateTrackSupport(source), /unsupported enum entry/);
    checked();
});

test('missing positional sprite requirement fails closed', t => {
    const checked = alteredRead(t, '/ride/Ride.cpp', text => text.replace('{ SpriteGroupType::slopeFlat, SpritePrecision::none },', ''));
    assert.throws(() => generateTrackSupport(source), /sprite requirement table count changed/);
    checked();
});

test('unknown enabled track groups fail closed', t => {
    const checked = alteredRead(t, '/rtd/coaster/LoopingRollerCoaster.h', text => text.replace('TrackGroup::straight', 'TrackGroup::futureUnverifiedGroup'));
    assert.throws(() => generateTrackSupport(source), /unknown TrackGroup/);
    checked();
});

test('missing descriptor mappings fail closed', t => {
    const checked = alteredRead(t, '/ride/RideData.cpp', text => text.replace('*/ kSpiralRollerCoasterRTD,', '*/'));
    assert.throws(() => generateTrackSupport(source), /ride type count changed/);
    checked();
});

test('dirty upstream extraction sources fail closed', t => {
    const original = cp.execFileSync;
    t.mock.method(cp, 'execFileSync', function (command, args, options) {
        if (command === 'git' && args.includes('diff')) throw new Error('git diff exit 1');
        return original.call(this, command, args, options);
    });
    assert.throws(() => generateTrackSupport(source), /sources differ from pinned revision/);
});

test('track pitch/roll endpoints follow native definition field order', () => {
    assert.deepEqual(data.trackPitches, { none: 0, up25: 2, up60: 4, down25: 6, down60: 8, up90: 10, down90: 18, tower: 10, reverseFreefall: 10 });
    assert.deepEqual(data.trackRolls, { none: 0, left: 2, right: 4, upsideDown: 15 });
    assert.equal(segment('flatToUp25').beginSlope, data.trackPitches.none);
    assert.equal(segment('flatToUp25').endSlope, data.trackPitches.up25);
    assert.equal(segment('leftBankToUp25').beginBank, data.trackRolls.left);
    assert.equal(segment('leftBankToUp25').endBank, data.trackRolls.none);
    assert.equal(segment('leftBankToUp25').endSlope, data.trackPitches.up25);
    assert.equal(data.rideTypes[98].flags.upInclineRequiresLift, true);
    assert.equal(data.rideTypes[52].flags.upInclineRequiresLift, false);
});

test('ordinary flat-group UI pieces have exhaustive audited requirements', () => {
    const ordinary = data.segments.filter(s => s.trackGroup === group('flat') && s.coveredBase === null && s.name !== 'maze');
    assert.equal(ordinary.length, 33);
    assert(ordinary.every(s => s.requiredGroups.length > 0 && !s.requiredGroups.includes(group('flat'))));
    assert.deepEqual(segment('diagFlat').requiredGroups, [group('straight'), group('curveLarge')]);
    assert.deepEqual(segment('up90').requiredGroups, [group('straight'), group('slopeVertical')]);
    assert.deepEqual(segment('leftEighthBankToDiag').requiredGroups, [group('curveLarge'), group('flatRollBanking')]);
    assert.deepEqual(segment('diagLeftBankToUp25').requiredGroups, [group('straight'), group('curveLarge'), group('flatRollBanking'), group('diagSlope')]);
    assert.deepEqual(segment('leftBankToLeftQuarterTurn3TilesUp25').requiredGroups, [group('curveSmall'), group('slopeCurve'), group('slopeCurveBanked'), group('flatRollBanking')]);
    assert.deepEqual(segment('bankedLeftQuarterTurn5Tiles').requiredGroups, [group('flatRollBanking'), group('curve')]);
    assert.deepEqual(segment('maze').requiredGroups, []);
    for (const s of data.segments.filter(s => s.coveredBase !== null)) {
        assert.deepEqual(s.requiredGroups, data.segments[s.coveredBase].requiredGroups);
        assert.deepEqual(s.excludedGroups, data.segments[s.coveredBase].excludedGroups);
    }
});

test('short versus long slope UI substitution preserves native groups for comparison', () => {
    assert.deepEqual(segment('flatToUp60').excludedGroups, [group('slopeSteepLong')]);
    assert.deepEqual(segment('flatToUp60').requiredAnyGroups, [group('slopeSteepUp'), group('diagSlopeSteepUp')]);
    assert.deepEqual(segment('diagFlatToUp60').requiredGroups, [group('diagSlopeSteepUp'), group('flatToSteepSlope')]);
    assert.deepEqual(segment('diagFlatToUp60').excludedGroups, [group('diagSlopeSteepLong')]);
    assert.equal(segment('diagFlatToUp60LongBase').trackGroup, group('slopeSteepLong'));
    assert.deepEqual(segment('diagFlatToUp60LongBase').requiredGroups, [group('diagSlopeSteepLong')]);
});

test('new unmapped flat-group segment fails closed', t => {
    const checked = alteredRead(t, '/ride/TrackData.cpp', text => text.replace('.definition = { TrackGroup::slope,', '.definition = { TrackGroup::flat,'));
    assert.throws(() => generateTrackSupport(source), /unmapped ordinary flat-group track/);
    checked();
});

test('unknown track endpoint syntax fails closed', t => {
    const checked = alteredRead(t, '/ride/TrackData.cpp', text => text.replace('.definition = { TrackGroup::slope, TrackPitch::up25', '.definition = { TrackGroup::slope, TrackPitch::unknownFuturePitch'));
    assert.throws(() => generateTrackSupport(source), /unknown track endpoint/);
    checked();
});

test('sloped quarter turns require their radius control as well as slopeCurve', () => {
    for (const direction of ['left', 'right']) for (const slope of ['Up', 'Down']) {
        assert.deepEqual(segment(direction + 'QuarterTurn5Tiles' + slope + '25').requiredGroups, [group('curve'), group('slopeCurve')]);
        assert.deepEqual(segment(direction + 'QuarterTurn3Tiles' + slope + '25').requiredGroups, [group('curveSmall'), group('slopeCurve')]);
    }
    for (const id of [54, 76]) {
        const enabled = data.rideTypes[id].regular.enabledGroups;
        assert(enabled.includes(group('slopeCurve')));
        assert(enabled.includes(group('curveSmall')));
        assert(!enabled.includes(group('curve')));
        assert(!segment('leftQuarterTurn5TilesUp25').requiredGroups.every(g => enabled.includes(g)));
        assert(segment('leftQuarterTurn3TilesUp25').requiredGroups.every(g => enabled.includes(g)));
    }
});

test('vertical quarter turns use curveVertical instead of the misleading TED group', () => {
    for (const direction of ['left', 'right']) for (const slope of ['Up', 'Down']) {
        const s = segment(direction + 'QuarterTurn1Tile' + slope + '90');
        assert.equal(s.trackGroup, group('slopeCurveSteep'));
        assert.deepEqual(s.requiredGroups, [group('curveVertical')]);
    }
    const impulse = data.rideTypes[86].regular.enabledGroups;
    assert(impulse.includes(group('curveVertical')));
    assert(!impulse.includes(group('slopeCurveSteep')));
    assert(segment('leftQuarterTurn1TileUp90').requiredGroups.every(g => impulse.includes(g)));
    assert(!segment('leftQuarterTurn1TileUp90').requiredGroups.every(g => data.rideTypes[15].regular.enabledGroups.includes(g)));
});

test('banked sloped quarter turns require slope banking and the correct radius', () => {
    for (const direction of ['left', 'right']) for (const slope of ['Up', 'Down']) for (const size of [3, 5]) {
        const s = segment(direction + 'BankedQuarterTurn' + size + 'Tile' + slope + '25');
        assert.equal(s.trackGroup, group('slopeCurve'));
        assert.deepEqual(s.requiredGroups, [group(size === 3 ? 'curveSmall' : 'curve'), group('slopeCurve'), group('flatRollBanking'), group('slopeRollBanking')]);
        for (const id of [2, 4, 17, 22, 54, 74, 76]) {
            assert(!s.requiredGroups.every(g => data.rideTypes[id].regular.enabledGroups.includes(g)), 'ride ' + id + ' should reject ' + s.name);
        }
    }
});

test('native car-array length is derived and rejects changed limits', t => {
    assert.equal(data.constants.carCount, 4);
    const checked = alteredRead(t, '/rct2/DATLimits.h', text => text.replace('kMaxCarTypesPerRideEntry = 4;', 'kMaxCarTypesPerRideEntry = 5;'));
    assert.throws(() => generateTrackSupport(source), /native ride car count changed/);
    checked();
});

test('cardinal bank-to-slope transitions require the ordinary slope control', () => {
    for (const name of ['leftBankToUp25', 'rightBankToUp25', 'up25ToLeftBank', 'up25ToRightBank', 'leftBankToDown25', 'rightBankToDown25', 'down25ToLeftBank', 'down25ToRightBank']) {
        const s = segment(name);
        assert.equal(s.trackGroup, group('flatRollBanking'));
        assert.deepEqual(s.requiredGroups, [group('flatRollBanking'), group('slope')]);
        assert(!s.requiredGroups.every(g => data.rideTypes[75].regular.enabledGroups.includes(g)));
        assert(s.requiredGroups.every(g => data.rideTypes[15].regular.enabledGroups.includes(g)));
    }
});
