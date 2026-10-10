/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');

// Only public executable inputs belong here. Authentication, configuration,
// Git metadata, local game state and generated bundles are deliberately absent.
const SOURCE_FILES = Object.freeze([
    'package.json', 'cli.js', 'src/core.js', 'src/plugin.js', 'src/track-guard.js', 'src/money.js',
    'scripts/build.js', 'scripts/compatibility.json', 'scripts/colour-palette.js',
    'scripts/track-support.js', 'scripts/display-settings.js', 'scripts/source-manifest.js',
    'generated/actions.json', 'generated/colours.json', 'generated/track-names.json',
    'generated/track-support.json'
].sort());
const CAPABILITIES = Object.freeze([
    'native-research-bitmap-v1', 'path-object-family-v1', 'normal-track-support-v1',
    'palette-74-v1', 'native-currency-format-v1'
]);
const hash = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const normalize = text => text.replace(/\r\n?/g, '\n');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isVersion = value => typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
const isApi = value => Number.isSafeInteger(value) && value > 0;
const validCapabilities = value => Array.isArray(value) && value.every(c => typeof c === 'string' && c.length > 0) && new Set(value).size === value.length;
const sameCapabilities = (a, b) => a.length === b.length && a.every(c => b.includes(c));

function generateBridgeManifest(root) {
    root = path.resolve(root);
    const contents = {}, files = {};
    for (const relative of SOURCE_FILES) {
        contents[relative] = normalize(fs.readFileSync(path.join(root, relative), 'utf8'));
        files[relative] = hash(contents[relative]);
    }
    const pkg = JSON.parse(contents['package.json']), engine = JSON.parse(contents['scripts/compatibility.json']);
    if (!isVersion(pkg.version) || !isVersion(engine.openrct2) || !isApi(engine.api))
        throw Error('Bridge source manifest: invalid package version or engine compatibility');
    // Path/hash pairs make ordering and file boundaries unambiguous. The source
    // digest identifies public bridge content, never the upstream engine commit.
    const sourceHash = hash('OpenRCT2 bridge source manifest v1\n' + JSON.stringify(Object.entries(files)) + '\n');
    return { version: pkg.version, engineVersion: engine.openrct2, api: engine.api,
        sourceHash, files, capabilities: CAPABILITIES.slice() };
}

function compareBridgeIdentity(hello, manifest) {
    const differences = [];
    if (!isObject(manifest)) return { matches: false, differences: ['Expected bridge manifest is missing or malformed'] };
    for (const [key, valid] of [
        ['version', isVersion], ['engineVersion', isVersion], ['api', isApi], ['sourceHash', isHash]
    ]) if (!valid(manifest[key])) differences.push('Expected manifest ' + key + ' is missing or malformed');
    if (!isObject(manifest.files) || SOURCE_FILES.some(f => !isHash(manifest.files[f])) ||
        Object.keys(manifest.files).length !== SOURCE_FILES.length)
        differences.push('Expected manifest public file hashes are missing or malformed');
    if (!validCapabilities(manifest.capabilities) || !sameCapabilities(manifest.capabilities, CAPABILITIES))
        differences.push('Expected manifest capabilities are missing or malformed');
    if (differences.length) return { matches: false, differences };

    if (!isObject(hello) || !isObject(hello.bridgeManifest))
        return { matches: false, differences: ['Live hello bridgeManifest is missing or malformed; rebuild and install the current bridge'] };
    const actual = hello.bridgeManifest;
    for (const [key, valid] of [
        ['version', isVersion], ['engineVersion', isVersion], ['api', isApi], ['sourceHash', isHash]
    ]) {
        if (!valid(actual[key])) differences.push('Live manifest ' + key + ' is missing or malformed');
        else if (actual[key] !== manifest[key]) differences.push('Live manifest ' + key + ' does not match the local source manifest');
    }
    if (!validCapabilities(actual.capabilities)) differences.push('Live manifest capabilities are missing or malformed');
    else if (!sameCapabilities(actual.capabilities, manifest.capabilities)) differences.push('Live manifest capabilities do not match the local source manifest');
    if (hello.apiVersion !== manifest.api) differences.push('Running engine API does not match the local source manifest');
    // When aliases are supplied, contradictory identity fields must not pass.
    for (const [alias, expected] of [
        ['bridgeVersion', manifest.version], ['openrct2', manifest.engineVersion],
        ['targetApiVersion', manifest.api], ['bridgeSourceHash', manifest.sourceHash]
    ]) if (hello[alias] !== undefined && hello[alias] !== expected) differences.push('Live hello ' + alias + ' does not match the local source manifest');
    return { matches: differences.length === 0, differences };
}

module.exports = { generateBridgeManifest, compareBridgeIdentity, SOURCE_FILES, CAPABILITIES };
