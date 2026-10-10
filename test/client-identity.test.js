/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {generateBridgeManifest,SOURCE_FILES}=require('../scripts/source-manifest');
const {decorateReply,requireIdentity,profileRoot}=require('../cli');
const manifest=generateBridgeManifest(path.resolve(__dirname,'..'));
function live(){return {bridgeVersion:manifest.version,openrct2:manifest.engineVersion,targetApiVersion:manifest.api,apiVersion:manifest.api,bridgeSourceHash:manifest.sourceHash,bridgeManifest:{version:manifest.version,engineVersion:manifest.engineVersion,api:manifest.api,sourceHash:manifest.sourceHash,capabilities:manifest.capabilities},currency:{code:null,sample:'$1.00',source:'native-game-formatter'}};}
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-identity-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));for(const file of SOURCE_FILES){const to=path.join(directory,file);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(__dirname,'..',file),to);}fs.writeFileSync(path.join(directory,'generated/bridge-manifest.json'),JSON.stringify(manifest));const profile=path.join(directory,'selected-profile');fs.mkdirSync(profile);return {directory,profile};}
test('CLI confirms manifest identity and rejects a legacy same-version plugin before arming',t=>{
    const {directory}=fixture(t),hello=live();assert.equal(requireIdentity(hello,directory).matches,true);
    const legacy={...hello};delete legacy.bridgeManifest;delete legacy.bridgeSourceHash;
    assert.throws(()=>requireIdentity(legacy,directory),/does not match the local source manifest/);
    assert.throws(()=>requireIdentity({...hello,bridgeManifest:{...hello.bridgeManifest,sourceHash:'0'.repeat(64)}},directory),/does not match/);
});
test('CLI reads USD from the explicitly selected game profile and keeps the native formatted text',t=>{
    const {directory,profile}=fixture(t);fs.writeFileSync(path.join(profile,'config.ini'),'[general]\ncurrency_format=USD\nlanguage=en-US\n');
    const reply=decorateReply({ok:true,result:live()},{profilePath:profile},directory);
    assert.equal(reply.result.currency.configuredCode,'USD');assert.equal(reply.result.currency.sample,'$1.00');assert.equal(reply.result.currency.code,null);assert.equal(reply.result.installation.matches,true);
    assert.equal(reply.result.currency.profileSettingsSource,'selected-profile-config');
});
test('unbuilt local source edits invalidate verification and write preflight',t=>{
    const {directory}=fixture(t);fs.appendFileSync(path.join(directory,'src/money.js'),'\n// unbuilt source edit\n');
    const reply=decorateReply({ok:true,result:live()},{},directory);
    assert.equal(reply.result.installation.matches,false);assert.match(reply.result.installation.differences.join(';'),/source changed after/);
    assert.throws(()=>requireIdentity(live(),directory),/source changed after/);
});
test('CLI does not invent a currency when profile settings or manifests are unavailable',t=>{
    const {directory,profile}=fixture(t);const reply=decorateReply({ok:true,result:live()},{profilePath:profile},directory);
    assert.equal(reply.result.currency.configuredCode,null);assert.equal(reply.result.currency.sample,'$1.00');
    fs.unlinkSync(path.join(directory,'generated/bridge-manifest.json'));assert.throws(()=>requireIdentity(live(),directory),/does not match/);
    assert.throws(()=>profileRoot({profilePath:'relative/profile'},directory),/absolute/);
    for(const value of ['',null,0,false])assert.throws(()=>profileRoot({profilePath:value},directory),/absolute/);
    if(process.platform==='win32')for(const value of ['C:profile','\\profile'])assert.throws(()=>profileRoot({profilePath:value},directory),/fully qualified/);
});
