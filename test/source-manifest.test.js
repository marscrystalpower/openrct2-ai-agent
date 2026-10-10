/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { generateBridgeManifest, compareBridgeIdentity, SOURCE_FILES, CAPABILITIES } = require('../scripts/source-manifest');

function fixture(t) {
    const tempRoot = path.resolve(os.tmpdir()), root = fs.mkdtempSync(path.join(tempRoot, 'openrct2-source-manifest-'));
    t.after(() => {
        // Keep recursive cleanup confined to the exact temporary fixture.
        assert.equal(path.dirname(path.resolve(root)), tempRoot);
        assert(path.basename(root).startsWith('openrct2-source-manifest-'));
        fs.rmSync(root, { recursive: true, force: true });
    });
    for (const file of SOURCE_FILES) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), 'first line\nsecond line\n');
    }
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"0.1.3"}\n');
    fs.writeFileSync(path.join(root, 'scripts/compatibility.json'), '{"openrct2":"0.5.6","api":124,"sourceCommit":"engine-only"}\n');
    return root;
}
function hello(manifest) {
    const { files, ...bridgeManifest } = manifest;
    return { bridgeVersion: manifest.version, openrct2: manifest.engineVersion,
        targetApiVersion: manifest.api, apiVersion: manifest.api, bridgeManifest };
}

test('source manifest is deterministic and normalizes LF, CRLF and CR', t => {
    const root = fixture(t), expected = generateBridgeManifest(root);
    assert.deepEqual(generateBridgeManifest(root), expected);
    assert.equal(expected.version, '0.1.3');
    assert.equal(expected.engineVersion, '0.5.6');
    assert.equal(expected.api, 124);
    assert.equal(Object.keys(expected.files).length, SOURCE_FILES.length);
    assert.deepEqual(expected.capabilities, CAPABILITIES);
    assert.match(expected.sourceHash, /^[a-f0-9]{64}$/);
    for (const ending of ['\r\n', '\r']) {
        for (const file of SOURCE_FILES) {
            const filename = path.join(root, file), content = fs.readFileSync(filename, 'utf8').replace(/\r\n?/g, '\n');
            fs.writeFileSync(filename, content.replace(/\n/g, ending));
        }
        assert.deepEqual(generateBridgeManifest(root), expected);
    }
});

test('authentication, local configuration, Git state and bundles do not change the source identity', t => {
    const root = fixture(t), expected = generateBridgeManifest(root);
    for (const file of ['bridge.config.json', '.git/HEAD', 'user-data/config.ini', 'dist/agent-bridge.js', 'dist/build-info.json']) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), 'private local data');
    }
    assert.deepEqual(generateBridgeManifest(root), expected);
    fs.writeFileSync(path.join(root, 'bridge.config.json'), '{"token":"another-local-token"}');
    fs.writeFileSync(path.join(root, '.git/HEAD'), 'a-different-branch');
    assert.deepEqual(generateBridgeManifest(root), expected);
});

test('every public executable input changes the source identity', t => {
    const root = fixture(t), expected = generateBridgeManifest(root);
    for (const file of SOURCE_FILES) {
        const filename = path.join(root, file), original = fs.readFileSync(filename, 'utf8');
        fs.writeFileSync(filename, original + '\n');
        const changed = generateBridgeManifest(root);
        assert.notEqual(changed.files[file], expected.files[file], file);
        assert.notEqual(changed.sourceHash, expected.sourceHash, file);
        fs.writeFileSync(filename, original);
    }
});

test('missing public inputs and malformed metadata cannot produce a manifest', t => {
    const root = fixture(t);
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":null}');
    assert.throws(() => generateBridgeManifest(root), /invalid package version/);
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"0.1.3"}');
    fs.rmSync(path.join(root, 'src/money.js'));
    assert.throws(() => generateBridgeManifest(root), /ENOENT/);
});

test('live identity matches without optional file hashes and accepts capability order changes', t => {
    const manifest = generateBridgeManifest(fixture(t)), live = hello(manifest);
    live.bridgeManifest.capabilities = manifest.capabilities.slice().reverse();
    live.bridgeManifest.files = { optional: 'ignored' };
    assert.deepEqual(compareBridgeIdentity(live, manifest), { matches: true, differences: [] });
});

test('legacy same-version hello and missing or different capabilities fail closed', t => {
    const manifest = generateBridgeManifest(fixture(t));
    const legacy = hello(manifest); delete legacy.bridgeManifest;
    assert.equal(compareBridgeIdentity(legacy, manifest).matches, false);
    for (const capabilities of [undefined, [], manifest.capabilities.slice(1), [...manifest.capabilities, 'unknown-v1'], [...manifest.capabilities, manifest.capabilities[0]], 'all']) {
        const live = hello(manifest); live.bridgeManifest.capabilities = capabilities;
        const result = compareBridgeIdentity(live, manifest);
        assert.equal(result.matches, false);
        assert(result.differences.some(d => d.includes('capabilities')));
    }
});

test('version, engine version, API, source digest and aliases must agree', t => {
    const manifest = generateBridgeManifest(fixture(t));
    for (const [key, value] of [['version', '0.1.2'], ['engineVersion', '0.5.5'], ['api', 122], ['sourceHash', '0'.repeat(64)]]) {
        const live = hello(manifest); live.bridgeManifest[key] = value;
        assert.equal(compareBridgeIdentity(live, manifest).matches, false, key);
    }
    for (const [key, value] of [['apiVersion', 125], ['bridgeVersion', '0.1.2'], ['openrct2', '0.5.5'], ['targetApiVersion', 122], ['bridgeSourceHash', '0'.repeat(64)]]) {
        const live = hello(manifest); live[key] = value;
        assert.equal(compareBridgeIdentity(live, manifest).matches, false, key);
    }
});

test('missing and malformed manifests return useful differences without throwing', t => {
    const manifest = generateBridgeManifest(fixture(t));
    for (const bad of [undefined, null, [], 'manifest', {}, { ...manifest, files: null }, { ...manifest, capabilities: null }, { ...manifest, sourceHash: 7 }]) {
        const result = compareBridgeIdentity(hello(manifest), bad);
        assert.equal(result.matches, false); assert(result.differences.length > 0);
    }
    for (const bad of [undefined, null, [], 'hello', {}, { bridgeManifest: null }, { bridgeManifest: {} }, { apiVersion: 124, bridgeManifest: { ...manifest, sourceHash: 7 } }]) {
        const result = compareBridgeIdentity(bad, manifest);
        assert.equal(result.matches, false); assert(result.differences.length > 0);
    }
});

test('built bridge hello identity matches the actual public source inputs', () => {
    const root = path.resolve(__dirname, '..'), manifest = generateBridgeManifest(root);
    const { harness } = require('./helpers/track-harness');
    const h = harness(), live = h.result(h.request('hello')).result;
    const result = compareBridgeIdentity(live, manifest);
    assert.deepEqual(result, { matches: true, differences: [] });
});
