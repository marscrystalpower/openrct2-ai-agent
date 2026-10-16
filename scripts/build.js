'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const compatibility=require('./compatibility.json'),version=require('../package.json').version;
const root=path.resolve(__dirname,'..');
const src=path.join(root,'vendor/OpenRCT2');
const read=p=>fs.readFileSync(path.join(src,p),'utf8');
const trackSupport=require('./track-support').generateTrackSupport(src);
const palette=require('./colour-palette').generateColourPalette(src);
const accessSupport=require('./access-support').generateAccessSupport(src);
const furnitureSupport=require('./furniture-support').generateFurnitureSupport(src);
const pricingSupport=require('./pricing-support').generatePricingSupport(src);
const {generateBridgeManifest}=require('./source-manifest');
const types=read('distribution/scripting/openrct2.d.ts');
if(Number(read('src/openrct2/scripting/ScriptEngine.h').match(/kPluginApiVersion\s*=\s*(\d+)/)?.[1])!==compatibility.api)throw Error('Pinned API version mismatch');
if(cp.execFileSync('git',['-C',src,'status','--porcelain'],{encoding:'utf8'}).trim())throw Error('Upstream checkout has changes; use clean pinned source');
const names={};
for(const m of read('src/openrct2/ride/ted/TrackElemType.h').matchAll(/^\s*(\w+)\s*=\s*(\d+),/gm)) names[m[1]]=Number(m[2]);
const allow=['ridecreate','ridedemolish','ridesetname','ridesetprice','ridesetsetting','ridesetstatus','ridesetvehicle','ridesetappearance','rideentranceexitplace','rideentranceexitremove',
    'mazeplacetrack','mazesettrack','trackplace','trackremove','tracksetbrakespeed','footpathplace','footpathremove','footpathadditionplace','footpathadditionremove','bannerplace','bannersetstyle','bannerremove',
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
// v0.5.6's type declaration omits these native visitor fields. Verify the
// pinned native action before supplementing the public schema. The native
// scripting parser requires both fields, even when that style is skipped.
const terrain=read('src/openrct2/actions/terraform/SurfaceSetStyleAction.cpp');
for(const field of ['surfaceColour1','edgeColour1']){
    if(!terrain.includes('visitor.Visit("'+field+'", _'+field+');'))throw Error('Missing native terrain colour parameter '+field);
    if(schemas.surfacesetstyle[field]!==undefined)throw Error('Terrain colour declaration changed; review schema supplement');
    schemas.surfacesetstyle[field]='number';
}
// The type declaration's style-parameter comment is misleading. Verify the
// native no-entry branch, IDs and units before publishing construction support.
const bannerPlace=read('src/openrct2/actions/scenery/BannerPlaceAction.cpp');
const bannerRemove=read('src/openrct2/actions/scenery/BannerRemoveAction.cpp');
const bannerStyle=read('src/openrct2/actions/scenery/BannerSetStyleAction.cpp');
const bannerHeader=read('src/openrct2/actions/scenery/BannerSetStyleAction.h');
const bannerFields={bannerplace:['x','y','z','direction','object','primaryColour'],bannerremove:['x','y','z','direction'],bannersetstyle:['id','type','parameter']};
for(const [action,fields]of Object.entries(bannerFields)){
    if(JSON.stringify(Object.keys(schemas[action]))!==JSON.stringify(fields)||Object.values(schemas[action]).some(type=>type!=='number'))throw Error('Native banner action schema changed: '+action);
}
if(!/enum class BannerSetStyleType\s*:\s*uint8_t\s*\{\s*primaryColour,\s*textColour,\s*noEntry,\s*count\s*\}/.test(bannerHeader)
    ||!bannerStyle.includes('visitor.Visit("id", _bannerIndex);')||!bannerStyle.includes('visitor.Visit("type", _type);')||!bannerStyle.includes('visitor.Visit("parameter", _parameter);')
    ||!bannerStyle.includes('banner->flags.set(BannerFlag::noEntry, (_parameter != 0));')||!bannerStyle.includes('allowedEdges &= ~(1 << bannerElement->getPosition());')
    ||!bannerStyle.includes('bannerElement->setAllowedEdges(allowedEdges);')||!bannerStyle.includes('MapCanBuildAt({ loc.x, loc.y, loc.z - 16 })'))throw Error('Native banner no-entry semantics changed');
if(!bannerPlace.includes('visitor.Visit(_loc);')||!bannerPlace.includes('visitor.Visit("object", _bannerType);')||!bannerPlace.includes('visitor.Visit("primaryColour", _primaryColour);')
    ||!bannerPlace.includes('GetValidPathElement()')||!bannerPlace.includes('MapCanBuildAt(_loc)')||!bannerPlace.includes('pathElement->getEdges() & (1 << _loc.direction)')
    ||!bannerPlace.includes('bannerElement->setClearanceZ(_loc.z + kPathClearance);')||!bannerRemove.includes('visitor.Visit(_loc);')||!bannerRemove.includes('MapCanBuildAt({ _loc.x, _loc.y, _loc.z - 16 })'))throw Error('Native banner construction checks changed');
if(!/constexpr uint16_t kMaxBannerObjects = 255;/.test(read('src/openrct2/object/ObjectLimits.h'))
    ||!read('src/openrct2/world/Footpath.h').includes('constexpr auto kPathClearance = 4 * kCoordsZStep;'))throw Error('Native banner object or height limits changed');
const generated=path.join(root,'generated');fs.mkdirSync(generated,{recursive:true});
fs.writeFileSync(path.join(generated,'track-support.json'),JSON.stringify(trackSupport,null,2)+'\n');
fs.writeFileSync(path.join(generated,'track-names.json'),JSON.stringify(names,null,2)+'\n');
fs.writeFileSync(path.join(generated,'actions.json'),JSON.stringify(schemas,null,2)+'\n');
fs.writeFileSync(path.join(generated,'colours.json'),JSON.stringify(palette,null,2)+'\n');
fs.writeFileSync(path.join(generated,'access-support.json'),JSON.stringify(accessSupport,null,2)+'\n');
fs.writeFileSync(path.join(generated,'furniture-support.json'),JSON.stringify(furnitureSupport,null,2)+'\n');
fs.writeFileSync(path.join(generated,'pricing-support.json'),JSON.stringify(pricingSupport,null,2)+'\n');
const manifest=generateBridgeManifest(root);
fs.writeFileSync(path.join(generated,'bridge-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const configPath=path.join(root,'bridge.config.json');
if(!fs.existsSync(configPath)) fs.writeFileSync(configPath,JSON.stringify({host:'127.0.0.1',port:21572,token:crypto.randomBytes(32).toString('hex')},null,2)+'\n');
const config=JSON.parse(fs.readFileSync(configPath));
if(config.host!=='127.0.0.1'|| !/^[a-f0-9]{64}$/.test(config.token) || !Number.isInteger(config.port) || config.port<1024 || config.port>65535) throw Error('Invalid bridge configuration');
const header='// Generated for OpenRCT2 v'+compatibility.openrct2+' / API '+compatibility.api+'. Contains a local authentication token; do not share.\n';
const identity={version:manifest.version,engineVersion:manifest.engineVersion,api:manifest.api,sourceHash:manifest.sourceHash,capabilities:manifest.capabilities};
const bundle=header+'var BRIDGE_CONFIG='+JSON.stringify({host:config.host,port:config.port,token:config.token})+';\nvar BRIDGE_INFO='+JSON.stringify({...compatibility,version,bridgeManifest:identity})+';\nvar COLOUR_PALETTE='+JSON.stringify(palette)+';\nvar TRACK_NAMES='+JSON.stringify(names)+';\nvar ACTION_SCHEMAS='+JSON.stringify(schemas)+';\nvar TRACK_SUPPORT='+JSON.stringify(trackSupport)+';\nvar ACCESS_SUPPORT='+JSON.stringify(accessSupport)+';\nvar FURNITURE_SUPPORT='+JSON.stringify(furnitureSupport)+';\nvar PRICING_SUPPORT='+JSON.stringify(pricingSupport)+';\n'+
    fs.readFileSync(path.join(root,'src/core.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/money.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/track-guard.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/ride-inspector.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/ride-auditor.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/pricing-inspector.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/path-furniture.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/path-inspector.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/amenity-inspector.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/access-inspector.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/access-monitor.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/plugin.js'),'utf8');
fs.mkdirSync(path.join(root,'dist'),{recursive:true});
fs.writeFileSync(path.join(root,'dist/agent-bridge.js'),bundle);
fs.writeFileSync(path.join(root,'dist/build-info.json'),JSON.stringify({version,...compatibility,bridgeManifest:identity,sha256:crypto.createHash('sha256').update(bundle).digest('hex'),actions:allow.length,trackNames:Object.keys(names).length,colours:palette.totalCount},null,2)+'\n');
console.log('Built dist/agent-bridge.js ('+allow.length+' actions, '+Object.keys(names).length+' track types)');
