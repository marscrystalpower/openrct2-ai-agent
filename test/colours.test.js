/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {generateColourPalette}=require('../scripts/colour-palette');
const palette=require('../generated/colours.json'),schemas=require('../generated/actions.json'),compatibility=require('../scripts/compatibility.json');
const {harness,query,execute,place}=require('./helpers/track-harness');
const root=path.resolve(__dirname,'..'),source=path.join(root,'vendor/OpenRCT2');
const appearance=(value,type=0)=>({action:'ridesetappearance',args:{ride:1,type,value,index:0}});
const terrain=(surfaceColour1=56,edgeColour1=73)=>({action:'surfacesetstyle',args:{x1:2048,y1:2048,x2:2048,y2:2048,surfaceStyle:0,edgeStyle:65535,surfaceColour1,edgeColour1}});

test('pinned native palette preserves old IDs and exposes all 18 new colours',()=>{
    assert.deepEqual(generateColourPalette(source),palette);
    assert.deepEqual(palette.colours.slice(56).map(c=>c.name),['gold','amber','amethyst','asparagus','brown','burntPink','cactus','caramel','copper','crimson','darkerWater','emerald','indigo','pesto','pineGreen','ruby','deepBlue','silver']);
    assert.deepEqual([palette.normalCount,palette.totalCount,palette.minId,palette.maxId],[72,74,0,73]);
    assert.deepEqual(palette.colours.filter(c=>c.special).map(c=>c.id),[54,55]);
    assert.equal(palette.colours[9].objectName,'teal');assert.equal(palette.colours[55].objectName,'void');
    palette.colours.forEach((c,i)=>assert.equal(c.id,i));
});

test('palette extraction rejects unfamiliar native colour syntax and counts',t=>{
    const original=fs.readFileSync;
    t.mock.method(fs,'readFileSync',function(filename,...args){
        const value=original.call(this,filename,...args);
        return String(filename).replaceAll('\\','/').endsWith('/drawing/Colour.h')?value.replace('gold,','gold = 56,'):value;
    });
    assert.throws(()=>generateColourPalette(source),/unexpected Colour enum syntax or count/);
});

test('terrain colour schema supplements both required native visitor parameters',()=>{
    assert.deepEqual(schemas.surfacesetstyle,{x1:'number',y1:'number',x2:'number',y2:'number',surfaceStyle:'number',edgeStyle:'number',surfaceColour1:'number',edgeColour1:'number'});
    const native=fs.readFileSync(path.join(source,'src/openrct2/actions/terraform/SurfaceSetStyleAction.cpp'),'utf8');
    for(const name of ['surfaceColour1','edgeColour1'])assert(native.includes('visitor.Visit("'+name+'", _'+name+');'));
    for(const name of ['surfaceColour1','edgeColour1']){
        const h=harness(),a=terrain();delete a.args[name];assert.equal(query(h,a).ok,false);assert.equal(h.queries.length,0);
    }
});

test('hello reports the source pin and colour catalog stays read-only',()=>{
    const h=harness(),hello=h.result(h.request('hello')).result;
    assert.equal(hello.bridgeVersion,'0.1.2');assert.equal(hello.targetApiVersion,compatibility.api);assert.equal(hello.openrct2,compatibility.openrct2);assert.equal(hello.sourceCommit,compatibility.sourceCommit);assert.equal(hello.compatible,true);assert.equal(hello.armed,false);
    assert.deepEqual(h.result(h.request('colours')).result,palette);assert.equal(h.calls.length,0);
});

test('all 18 new colour IDs reach native ride queries and execution unchanged',()=>{
    for(let colour=56;colour<=73;colour++)for(let type=0;type<=5;type++){
        const h=harness(),action=appearance(colour,type);
        assert.equal(query(h,action).ok,true);assert.equal(execute(h,action).result.state,'completed');assert.deepEqual(h.calls,[action]);
    }
});

test('terrain, staff, scenery and wall actions accept new colours unchanged',()=>{
    const actions=[terrain(),{action:'staffsetcolour',args:{staffType:0,colour:73}},
        {action:'smallsceneryplace',args:{x:2048,y:2048,z:64,direction:0,object:0,quadrant:0,primaryColour:56,secondaryColour:68,tertiaryColour:73}},
        {action:'wallplace',args:{x:2048,y:2048,z:64,object:0,edge:0,primaryColour:56,secondaryColour:68,tertiaryColour:73}}];
    for(const action of actions){const h=harness();assert.equal(query(h,action).ok,true);assert.equal(execute(h,action).result.state,'completed');assert.deepEqual(h.calls,[action]);}
});

test('colour IDs reject overflow, wrapping, null sentinels and malformed values before native query',()=>{
    for(const value of [-1,74,255,256,65536,1.5,null])for(const action of [appearance(value),terrain(value,0),terrain(0,value),{action:'staffsetcolour',args:{staffType:0,colour:value}},
        {action:'smallsceneryplace',args:{x:2048,y:2048,z:64,direction:0,object:0,quadrant:0,primaryColour:value,secondaryColour:0,tertiaryColour:0}},
        {action:'wallplace',args:{x:2048,y:2048,z:64,object:0,edge:0,primaryColour:0,secondaryColour:0,tertiaryColour:value}}]){
        const h=harness(),reply=query(h,action);assert.equal(reply.ok,false);assert.equal(h.queries.length,0);assert.equal(h.calls.length,0);
    }
});

test('special colours remain valid while maze wall styles use their separate four-value range',()=>{
    for(const value of [0,54,55,73])assert.equal(query(harness(),appearance(value)).ok,true);
    for(const value of [0,1,2,3])assert.equal(query(harness({type:20}),appearance(value,2)).ok,true);
    for(const value of [-1,4,56,73])assert.equal(query(harness({type:20}),appearance(value,2)).ok,false);
    assert.equal(query(harness(),appearance(300,7)).ok,true); // Entrance object index, not a colour ID.
    assert.equal(query(harness(),appearance(56,256)).ok,false); // Wrapped selector cannot bypass the guard.
    for(const colour of [0,1,2,3])assert.equal(query(harness(),place('flat',{colour})).ok,true);
    for(const colour of [-1,4,56,73,256]){
        const h=harness();assert.equal(query(h,place('flat',{colour})).ok,false);assert.equal(h.queries.length,0);
    }
    // Vehicle colour selects an object preset. Its random-preset sentinel is
    // separate from palette IDs, and must not be rejected by the palette guard.
    const preset={action:'ridesetvehicle',args:{ride:1,type:2,value:0,colour:255}};
    assert.equal(query(harness(),preset).ok,true);
});

test('invalid batch colour stops before dispatch and preserves earlier receipts',()=>{
    const h=harness();h.arm();const req=h.request('batch.execute',{actions:[appearance(56),appearance(74)],maxCost:100},{session:h.session});h.flush();
    const result=h.result(req).result;assert.equal(result.state,'partial');assert.equal(result.completed.length,1);assert.equal(result.spent,10);assert.deepEqual(h.calls,[appearance(56)]);
    h.events.data(JSON.stringify(req)+'\n');assert.equal(h.calls.length,1);
});

test('API drift is reported by hello and blocks arming, queries and execution races',()=>{
    const h=harness();h.context.apiVersion=123;
    assert.equal(h.result(h.request('hello')).result.compatible,false);assert.equal(h.result(h.arm()).ok,false);assert.equal(query(h,appearance(56)).ok,false);assert.equal(h.queries.length,0);
    const racing=harness({onQuery:({context})=>{context.apiVersion=125;}});
    assert.equal(execute(racing,appearance(56)).result.state,'partial');assert.equal(racing.calls.length,0);
});

test('read-back exposes ride and scenery colours without inventing terrain colour properties',()=>{
    const colours=[{main:56,additional:73,supports:68}],vehicles=[{body:57,trim:58,tertiary:59}];
    const h=harness({rides:[{id:1,type:15,status:'closed',colourSchemes:colours,vehicleColours:vehicles}],elements:[{type:'small_scenery',primaryColour:56,secondaryColour:68,tertiaryColour:73},{type:'surface',surfaceStyle:0,edgeStyle:0}]});
    const ride=h.result(h.request('ride',{ride:1})).result;assert.deepEqual(ride.colourSchemes,colours);assert.deepEqual(ride.vehicleColours,vehicles);
    const elements=h.result(h.request('map',{x:64,y:64})).result[0].elements;
    assert.equal(elements[0].primaryColour,56);assert.equal(elements[0].secondaryColour,68);assert.equal(elements[0].tertiaryColour,73);
    assert.equal(Object.hasOwn(elements[1],'primaryColour'),false);
});
