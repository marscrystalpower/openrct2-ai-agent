'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const src=path.join(root,'vendor/OpenRCT2');
const read=p=>fs.readFileSync(path.join(src,p),'utf8');
const types=read('distribution/scripting/openrct2.d.ts');
const names={};
for(const m of read('src/openrct2/ride/ted/TrackElemType.h').matchAll(/^\s*(\w+)\s*=\s*(\d+),/gm)) names[m[1]]=Number(m[2]);
const allow=['ridecreate','ridedemolish','ridesetname','ridesetprice','ridesetsetting','ridesetstatus','ridesetvehicle','ridesetappearance','rideentranceexitplace','rideentranceexitremove',
    'trackplace','trackremove','tracksetbrakespeed','footpathplace','footpathremove','footpathadditionplace','footpathadditionremove',
    'staffhire','stafffire','staffsetorders','staffsetname','staffsetpatrolarea','staffsetcolour',
    'parksetname','parksetentrancefee','parksetloan','parksetparameter','parksetresearchfunding','parkmarketing',
    'landsetheight','landbuyrights','surfacesetstyle','watersetheight','smallsceneryplace','smallsceneryremove','wallplace','wallremove','gamesetspeed','pausetoggle'];
const schemas={};
for(const action of allow){
    const match=types.match(new RegExp('queryAction\\(action: "'+action+'", args: (\\w+)'));
    if(!match) throw Error('Missing API action '+action);
    const body=types.match(new RegExp('interface '+match[1]+' extends GameActionArgs \\{([\\s\\S]*?)\\n    \\}'))[1].replace(/\/\*[\s\S]*?\*\//g,'');
    schemas[action]={};
    for(const p of body.matchAll(/^\s*(\w+): ([\w\[\]]+);/gm)) schemas[action][p[1]]=p[2];
}
const generated=path.join(root,'generated');fs.mkdirSync(generated,{recursive:true});
fs.writeFileSync(path.join(generated,'track-names.json'),JSON.stringify(names,null,2)+'\n');
fs.writeFileSync(path.join(generated,'actions.json'),JSON.stringify(schemas,null,2)+'\n');
const configPath=path.join(root,'bridge.config.json');
if(!fs.existsSync(configPath)) fs.writeFileSync(configPath,JSON.stringify({host:'127.0.0.1',port:21572,token:crypto.randomBytes(32).toString('hex')},null,2)+'\n');
const config=JSON.parse(fs.readFileSync(configPath));
if(config.host!=='127.0.0.1'|| !/^[a-f0-9]{64}$/.test(config.token) || !Number.isInteger(config.port) || config.port<1024 || config.port>65535) throw Error('Invalid bridge configuration');
const header='// Generated for OpenRCT2 v0.5.5 / API 122. Contains a local authentication token; do not share.\n';
const bundle=header+'var BRIDGE_CONFIG='+JSON.stringify(config)+';\nvar TRACK_NAMES='+JSON.stringify(names)+';\nvar ACTION_SCHEMAS='+JSON.stringify(schemas)+';\n'+
    fs.readFileSync(path.join(root,'src/core.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/plugin.js'),'utf8');
fs.mkdirSync(path.join(root,'dist'),{recursive:true});
fs.writeFileSync(path.join(root,'dist/agent-bridge.js'),bundle);
fs.writeFileSync(path.join(root,'dist/build-info.json'),JSON.stringify({version:'0.1.0',openrct2:'0.5.5',api:122,sourceCommit:'8694e3483690323b6a75fa7264b6c58116f51f31',sha256:crypto.createHash('sha256').update(bundle).digest('hex'),actions:allow.length,trackNames:Object.keys(names).length},null,2)+'\n');
console.log('Built dist/agent-bridge.js ('+allow.length+' actions, '+Object.keys(names).length+' track types)');
