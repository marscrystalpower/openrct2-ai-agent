/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {inspect,route}=require('../src/path-inspector');

const DELTA=[[-1,0],[0,1],[1,0],[0,-1]],REVERSE=[2,3,0,1];
const OPTIONS={respectBanners:true,includeQueues:true,includeWidePaths:true,includeGhosts:false};
const region=(x=10,y=10,width=2,height=1)=>({x,y,width,height});
const endpoint=(x,y,elementIndex=0)=>({x,y,elementIndex});
const request=(start,end,extra={})=>({start,end,...extra});
const footpath=(edges=0,extra={})=>({type:'footpath',baseZ:64,clearanceZ:80,edges,isSloped:false,slopeDirection:null,isQueue:false,isWide:false,ride:null,station:null,isGhost:false,isBlockedByVehicle:false,...extra});

// This is an independent model of the pinned navigator's behavior, not a graph
// built from inspector results: source bits and banners control departure; the
// FIRST compatible non-ghost target wins, even without its return-edge bit.
// Walls/scenery/track do not participate in this native path lookup.
function fixture(entries=[],options={}){
    const tiles=new Map(entries.map(([x,y,elements])=>[x+','+y,{elements}])),bannerMasks=new WeakMap(),calls=[],reads=[];
    const size=options.size||{x:128,y:128};
    function tile(x,y){
        assert(Number.isInteger(x)&&Number.isInteger(y),'map.getTile needs tile coordinates');
        assert(x>=0&&y>=0&&x<size.x&&y<size.y,'map.getTile read outside map');
        reads.push([x,y]);
        if(options.throwTile&&options.throwTile(x,y))throw Error('Tile unavailable');
        return tiles.get(x+','+y)||{elements:[]};
    }
    function height(el,direction){
        if(!el.isSloped)return el.baseZ;
        if(el.slopeDirection===direction)return el.baseZ+16;
        if(REVERSE[el.slopeDirection]===direction)return el.baseZ;
        return null;
    }
    function position(x,y,index,direction){
        const el=tile(x,y).elements[index];
        const connection={position:{x:x*32,y:y*32,z:el.baseZ},elementIndex:index,direction};
        // PathConnection is a native getter object; unrelated metadata getters
        // must not throw while merely obtaining its coordinate/element link.
        for(const field of ['isSloped','slopeDirection','isQueue','isWide','ride','station'])Object.defineProperty(connection,field,{get:()=>el[field]});
        return connection;
    }
    const map={size,getTile:tile,getPathNavigator:(world,index,opts)=>{
        assert.equal(world.x%32,0);assert.equal(world.y%32,0);
        assert.deepEqual(JSON.parse(JSON.stringify(opts)),OPTIONS);
        const x=world.x/32,y=world.y/32,el=tile(x,y).elements[index];
        assert(el&&el.type==='footpath'&&!el.isGhost,'navigator requested on non-path/ghost');
        calls.push({x,y,index,options:opts});
        if(options.throwNavigator&&options.throwNavigator(x,y,index))throw Error('Native navigator unavailable');
        const edges=el.edges&15,permittedEdges=edges&(bannerMasks.get(el)??15);
        return {edges,permittedEdges,current:position(x,y,index),getConnectedPaths:()=>{
            const connected=[];
            for(let d=0;d<4;d++){
                if(!(permittedEdges&(1<<d)))continue;
                // The pinned source raises only the uphill departure. A corrupt
                // side bit can still lead to a native link at the base height.
                const z=el.baseZ+(el.isSloped&&el.slopeDirection===d?16:0);
                const nx=x+DELTA[d][0],ny=y+DELTA[d][1];
                if(nx<0||ny<0||nx>=size.x||ny>=size.y)continue;
                const targets=tile(nx,ny).elements;
                for(let i=0;i<targets.length;i++){
                    const candidate=targets[i];
                    if(candidate.type!=='footpath'||candidate.isGhost||height(candidate,REVERSE[d])!==z)continue;
                    connected.push(position(nx,ny,i,d));break;
                }
            }
            return connected;
        }};
    }};
    return {map,tiles,bannerMasks,calls,reads};
}
const pathAt=(result,x=10,y=10,index=0)=>result.paths.find(p=>p.x===x&&p.y===y&&p.elementIndex===index);
const direction=(result,d,x=10,y=10,index=0)=>pathAt(result,x,y,index).directions.find(p=>p.direction===d);
const keys=paths=>paths.map(p=>p.key);

test('native connected paths require actual source edges, not adjacent-looking tiles',()=>{
    const a=footpath(4),b=footpath(1),f=fixture([[10,10,[a]],[11,10,[b]]]);
    const connected=inspect(region(),f.map);
    assert.equal(connected.complete,true);assert.equal(connected.topologyOnly,true);
    assert.deepEqual(keys(pathAt(connected).native.connectedPaths),['11,10,0']);
    assert.equal(direction(connected,2).status,'connected');
    a.edges=0;b.edges=0;
    const disconnected=inspect(region(),f.map);
    assert.deepEqual(pathAt(disconnected).native.connectedPaths,[]);
    assert.equal(direction(disconnected,2).status,'possible_gap');
    assert(disconnected.summary.possibleGaps>0);
    assert.equal(route(request(endpoint(10,10),endpoint(11,10)),f.map).found,false);
});

test('source edge without return edge remains a native directed link and reports asymmetry',()=>{
    const f=fixture([[10,10,[footpath(4)]],[11,10,[footpath(0)]]]);
    const result=inspect(region(),f.map);
    assert.deepEqual(keys(pathAt(result).native.connectedPaths),['11,10,0']);
    assert(result.summary.asymmetricEdges>0);
    const forward=route(request(endpoint(10,10),endpoint(11,10)),f.map);
    assert.equal(forward.found,true);assert.deepEqual(keys(forward.path),['10,10,0','11,10,0']);
    const reverse=route(request(endpoint(11,10),endpoint(10,10)),f.map);
    assert.equal(reverse.found,false);assert.equal(reverse.complete,true);assert.equal(reverse.truncated,false);
});

test('valid slopes connect at baseZ plus 16 world units and have only endpoint edges',()=>{
    const slope=footpath(5,{isSloped:true,slopeDirection:2}),f=fixture([[10,10,[slope]],[9,10,[footpath(4)]],[11,10,[footpath(1,{baseZ:80,clearanceZ:96})]],[10,11,[footpath(8)]]]);
    const result=inspect(region(9,10,3,2),f.map),p=pathAt(result);
    assert.equal(direction(result,0).endpointZ,64);assert.equal(direction(result,2).endpointZ,80);
    assert.equal(direction(result,1).status,'slope_side');
    assert.deepEqual(keys(p.native.connectedPaths),['9,10,0','11,10,0']);
    assert.equal(route(request(endpoint(9,10),endpoint(11,10)),f.map).found,true);
    assert.equal(route(request(endpoint(10,10),endpoint(10,11)),f.map).found,false);
});

test('an anomalous source slope-side edge remains native directed evidence',()=>{
    const f=fixture([[10,10,[footpath(2,{isSloped:true,slopeDirection:2})]],[10,11,[footpath(8)]]]);
    const result=inspect(region(10,10,1,2),f.map);
    assert.deepEqual(keys(pathAt(result).native.connectedPaths),['10,11,0']);
    assert.equal(direction(result,1).status,'slope_side');
    assert(result.diagnostics.some(d=>d.code==='slope_side_edge'));
    assert.equal(route(request(endpoint(10,10),endpoint(10,11)),f.map).found,true);
});

test('neighbor paths at a different height are not fabricated as connected',()=>{
    const f=fixture([[10,10,[footpath(4)]],[11,10,[footpath(1,{baseZ:80,clearanceZ:96})]]]);
    const result=inspect(region(),f.map);
    assert.deepEqual(pathAt(result).native.connectedPaths,[]);
    assert.equal(direction(result,2).status,'height_mismatch');
    assert.equal(route(request(endpoint(10,10),endpoint(11,10)),f.map).found,false);
});

test('stacked paths retain element identity and native first-compatible selection',()=>{
    const f=fixture([[10,10,[footpath(4)]],[11,10,[footpath(0),footpath(1),footpath(1,{baseZ:96,clearanceZ:112})]]]);
    const result=inspect(region(),f.map);
    assert.equal(result.paths.length,4);
    assert.deepEqual(keys(pathAt(result).native.connectedPaths),['11,10,0']);
    assert.equal(route(request(endpoint(10,10),endpoint(11,10,0)),f.map).found,true);
    assert.equal(route(request(endpoint(10,10),endpoint(11,10,1)),f.map).found,false);
    assert.equal(route(request(endpoint(10,10),endpoint(11,10,2)),f.map).found,false);
    f.tiles.get('10,10').elements[0].baseZ=96;
    assert.deepEqual(keys(pathAt(inspect(region(),f.map)).native.connectedPaths),['11,10,2']);
});

test('native banners restrict directed passage independently of raw connection bits',()=>{
    const a=footpath(4),f=fixture([[10,10,[a,{type:'banner',baseZ:64,clearanceZ:80}]],[11,10,[footpath(1)]]]);
    f.bannerMasks.set(a,11); // clear direction 2 without changing the actual path.
    const result=inspect(region(),f.map),p=pathAt(result);
    assert.equal(p.edges,4);assert.equal(p.native.edges,4);assert.equal(p.native.permittedEdges,0);
    assert.equal(direction(result,2).status,'banner_restricted');assert(result.summary.bannerRestrictions>0);
    assert.equal(route(request(endpoint(10,10),endpoint(11,10)),f.map).found,false);
    assert.equal(route(request(endpoint(11,10),endpoint(10,10)),f.map).found,true);
});

test('queues and wide paths remain in topology while ghost paths are excluded',()=>{
    const f=fixture([[10,10,[footpath(4,{isQueue:true,ride:7,station:1})]],[11,10,[footpath(5,{isGhost:true}),footpath(5,{isWide:true})]],[12,10,[footpath(1)]]]);
    const result=inspect(region(10,10,3,1),f.map);
    assert.equal(result.paths.length,3);assert.equal(pathAt(result).isQueue,true);assert.equal(pathAt(result).ride,7);
    assert.equal(pathAt(result,11,10,1).isWide,true);assert.equal(pathAt(result,11,10,0),undefined);
    const routed=route(request(endpoint(10,10),endpoint(12,10)),f.map);
    assert.equal(routed.found,true);assert.deepEqual(keys(routed.path),['10,10,0','11,10,1','12,10,0']);
    assert(f.calls.length>0);assert(f.calls.every(c=>JSON.stringify(c.options)===JSON.stringify(OPTIONS)));
    assert.throws(()=>route(request(endpoint(11,10,0),endpoint(12,10)),f.map),/ghost|path/i);
});

test('dynamic vehicle blocker flags are reported without falsifying native topology',()=>{
    const f=fixture([[10,10,[footpath(4)]],[11,10,[footpath(1,{isBlockedByVehicle:true})]]]);
    const result=inspect(region(),f.map);
    assert.equal(pathAt(result,11).isBlockedByVehicle,true);assert.equal(result.summary.dynamicVehicleBlockers,1);
    const routed=route(request(endpoint(10,10),endpoint(11,10)),f.map);
    assert.equal(routed.found,true);assert.equal(routed.topologyOnly,true);assert.equal(routed.path[1].isBlockedByVehicle,true);
});

test('wall, tree and track evidence never becomes a definitive explanation for a missing edge',()=>{
    const evidence=[{type:'wall',baseZ:64,clearanceZ:96,direction:2,object:1},{type:'small_scenery',baseZ:64,clearanceZ:112,object:2},{type:'track',baseZ:64,clearanceZ:96,ride:3,trackType:0}];
    const f=fixture([[10,10,[footpath(0),...evidence]],[11,10,[footpath(0)]]]);
    const result=inspect(region(),f.map),d=direction(result,2);
    assert.equal(d.status,'possible_gap');assert.deepEqual(pathAt(result).native.connectedPaths,[]);
    const nearby=d.nearbyEvidence.flatMap(tileKey=>result.evidenceTiles[tileKey]||[]).map(key=>result.evidence.find(e=>e.key===key));
    for(const type of ['wall','small_scenery','track'])assert(nearby.some(e=>e&&e.type===type),type);
    assert(d.nearbyEvidence.every(key=>typeof key==='string'));
    assert.equal(new Set(result.evidence.map(e=>e.key)).size,result.evidence.length);
    assert(result.diagnostics.every(d=>d.certainty==='possible'||d.certainty==='observed'));
    assert(!result.diagnostics.some(d=>/blocked_by_(wall|tree|track|support)|scenery_obstruction/.test(d.code)));
});

test('gap boundary walls identify only non-ghost, shared-edge walls overlapping the path height',()=>{
    const wall=extra=>({type:'wall',baseZ:64,clearanceZ:96,direction:2,object:1,isGhost:false,...extra});
    const f=fixture([[10,10,[footpath(),wall(),wall({direction:1}),wall({baseZ:96,clearanceZ:112}),wall({isGhost:true}),wall({baseZ:48,clearanceZ:64})]],[11,10,[footpath(),wall({direction:0}),wall({direction:2})]]]);
    const result=inspect(region(),f.map),gap=result.diagnostics.find(d=>d.code==='possible_gap'&&d.to==='11,10,0');
    assert(gap);assert.equal(gap.certainty,'possible');
    assert.deepEqual(gap.boundaryWalls,['10,10,1','11,10,1']);
    assert(!result.evidence.some(e=>e.key==='10,10,4'));
    assert(!result.diagnostics.some(d=>/blocked_by_wall/.test(d.code)));
});

test('rectangle boundary uses a one-tile halo and marks external native neighbors',()=>{
    const f=fixture([[10,10,[footpath(4)]],[11,10,[footpath(1)]]]);
    const result=inspect(region(10,10,1,1),f.map),p=pathAt(result);
    assert.equal(result.paths.length,1);assert.equal(result.complete,true);
    assert.deepEqual(keys(p.native.connectedPaths),['11,10,0']);assert.equal(p.native.connectedPaths[0].external,true);
    assert.equal(direction(result,2).status,'connected');
    assert(f.reads.some(([x,y])=>x===11&&y===10));
    const edge=fixture([[0,0,[footpath(1)]]],{size:{x:4,y:4}});
    assert.equal(inspect(region(0,0,1,1),edge.map).complete,true);
});

test('raw edges without a neighboring path are unresolved non-path connections, not certain disconnections',()=>{
    const f=fixture([[10,10,[footpath(4)]],[11,10,[{type:'entrance',baseZ:64,clearanceZ:96,ride:7}]]]);
    const result=inspect(region(),f.map),d=direction(result,2);
    assert.match(d.status,/non_path|unresolved/);assert.deepEqual(pathAt(result).native.connectedPaths,[]);
    assert(!result.diagnostics.some(d=>/definitely disconnected|certainly disconnected/i.test(d.message)));
});

test('missing, throwing and malformed native navigation are explicitly incomplete',()=>{
    for(const change of [
        f=>{delete f.map.getPathNavigator;},
        f=>{f.map.getPathNavigator=()=>{throw Error('not supported');};},
        f=>{f.map.getPathNavigator=()=>({edges:4,permittedEdges:4});},
        f=>{f.map.getPathNavigator=()=>({edges:4,permittedEdges:4,getConnectedPaths:()=>{throw Error('native failed');}});}
    ]){
        const f=fixture([[10,10,[footpath(4)]],[11,10,[footpath(1)]]]);change(f);
        const result=inspect(region(),f.map);
        assert.equal(result.complete,false);assert(result.unavailable.length>0);
        assert.equal(pathAt(result).native.available,false);
        const routed=route(request(endpoint(10,10),endpoint(11,10)),f.map);
        assert.equal(routed.found,null);assert.equal(routed.complete,false);assert(routed.unavailable.length>0);
    }
});

test('unreadable target tiles yield an unknown route instead of an unreachable claim',()=>{
    const f=fixture([[10,10,[footpath(4)]],[11,10,[footpath(5)]],[12,10,[footpath(1)]]],{throwTile:(x,y)=>x===11&&y===10});
    assert.equal(inspect(region(),f.map).complete,false);
    const result=route(request(endpoint(10,10),endpoint(12,10)),f.map);
    assert.equal(result.found,null);assert.equal(result.complete,false);assert(result.unavailable.length>0);
});

test('unreadable endpoints and intermediate metadata preserve unknown reachability',()=>{
    for(const blockedX of [10,12]){
        const f=fixture([[10,10,[footpath(4)]],[12,10,[footpath()]]],{throwTile:(x,y)=>x===blockedX&&y===10});
        const result=route(request(endpoint(10,10),endpoint(12,10)),f.map);
        assert.equal(result.found,null);assert.equal(result.complete,false);assert(result.unavailable.length>0);
    }
    const unreadable=footpath(1);Object.defineProperty(unreadable,'isWide',{get:()=>{throw Error('metadata unavailable');}});
    const f=fixture([[10,10,[footpath(4)]],[11,10,[unreadable]],[12,10,[footpath()]]]);
    const incomplete=route(request(endpoint(10,10),endpoint(12,10)),f.map);
    assert.equal(incomplete.found,null);assert.equal(incomplete.complete,false);
    const witness=route(request(endpoint(10,10),endpoint(11,10)),f.map);
    assert.equal(witness.found,true);assert.equal(witness.complete,false);assert(witness.unavailable.length>0);
});

test('native prototype getters are supported without changing path or map objects',()=>{
    const native=values=>{
        const prototype={};
        for(const [name,value] of Object.entries(values))Object.defineProperty(prototype,name,{get:()=>value,set:()=>assert.fail('Inspector wrote '+name)});
        return Object.freeze(Object.create(prototype));
    };
    const a=native(footpath(4)),b=native(footpath(1)),f=fixture([[10,10,[a]],[11,10,[b]]]);
    Object.freeze(f.map);for(const tile of f.tiles.values()){Object.freeze(tile.elements);Object.freeze(tile);}
    assert.equal(inspect(region(),f.map).complete,true);
    assert.equal(route(request(endpoint(10,10),endpoint(11,10)),f.map).found,true);
});

test('missing, throwing and malformed metadata never becomes a healthy complete inspection',()=>{
    for(const change of [
        p=>{delete p.edges;},p=>{delete p.isGhost;},p=>{p.slopeDirection=7;},p=>{p.baseZ=NaN;},
        p=>{p.isBlockedByVehicle=1;},p=>{delete p.isQueue;},
        p=>Object.defineProperty(p,'isWide',{get:()=>{throw Error('not exposed');}})
    ]){
        const p=footpath(0);change(p);const f=fixture([[10,10,[p]]]),result=inspect(region(10,10,1,1),f.map);
        assert.equal(result.complete,false);assert(result.unavailable.length>0);
    }
});

test('malformed native edge masks and neighbor coordinates are reported as unknown',()=>{
    for(const navigator of [
        {edges:256,permittedEdges:4,getConnectedPaths:()=>[]},
        {edges:4,permittedEdges:null,getConnectedPaths:()=>[]},
        {edges:4,permittedEdges:4,getConnectedPaths:()=>null},
        {edges:4,permittedEdges:4,getConnectedPaths:()=>[{position:{x:11,y:10,z:64},elementIndex:0,direction:2}]},
        {edges:4,permittedEdges:4,getConnectedPaths:()=>[{position:{x:12*32,y:10*32,z:64},elementIndex:0,direction:2}]},
        {edges:4,permittedEdges:4,getConnectedPaths:()=>[{position:{x:11*32,y:10*32,z:64},elementIndex:256,direction:2}]}
    ]){
        const f=fixture([[10,10,[footpath(4)]],[11,10,[footpath(1)]]]);f.map.getPathNavigator=()=>navigator;
        const result=inspect(region(),f.map);assert.equal(result.complete,false);assert(result.unavailable.length>0);
        const routed=route(request(endpoint(10,10),endpoint(11,10)),f.map);
        assert.equal(routed.found,null);assert.equal(routed.complete,false);
    }
});

test('tile-element and total-path safety bounds are explicit incomplete results',()=>{
    const excessive=fixture([[10,10,Array.from({length:257},()=>footpath())]]);
    const tile=inspect(region(10,10,1,1),excessive.map);
    assert.equal(tile.complete,false);assert.equal(tile.truncated,true);assert.equal(tile.paths.length,256);
    assert(tile.unavailable.some(s=>/256|elements/.test(s)));
    const entries=[];for(let y=10;y<42;y++)for(let x=10;x<42;x++)entries.push([x,y,Array.from({length:9},()=>footpath())]);
    const bounded=inspect(region(10,10,32,32),fixture(entries).map);
    assert.equal(bounded.complete,false);assert.equal(bounded.truncated,true);
    assert(bounded.paths.length>0&&bounded.paths.length<entries.length*9);
    assert(bounded.unavailable.some(s=>/paths|geometry|diagnostics/i.test(s)));
    assert(Buffer.byteLength(JSON.stringify(bounded),'utf8')<24*1024*1024,'Stacked-path inspection exceeded safe protocol response size');
});

test('dense scenery in the maximum rectangle stays within the protocol response budget',()=>{
    const entries=[];
    for(let y=10;y<42;y++)for(let x=10;x<42;x++)entries.push([x,y,[footpath(),...Array.from({length:63},(_,object)=>({type:'small_scenery',baseZ:64,clearanceZ:96,object,isGhost:false}))]]);
    const result=inspect(region(10,10,32,32),fixture(entries).map);
    assert.equal(result.paths.length,1024);assert.equal(result.complete,false);assert.equal(result.truncated,true);
    assert(result.unavailable.length>0);assert(result.evidence.length<1024*63);
    assert.equal(new Set(result.evidence.map(e=>e.key)).size,result.evidence.length);
    assert(result.paths.every(p=>p.directions.every(d=>d.nearbyEvidence.every(ref=>typeof ref==='string'))));
    assert(Buffer.byteLength(JSON.stringify(result),'utf8')<24*1024*1024,'Dense-scenery inspection exceeded safe protocol response size');
});

test('dense stacked paths and scenery keep shared evidence references bounded',()=>{
    const entries=[],elements=[...Array.from({length:8},()=>footpath()),...Array.from({length:248},(_,object)=>({type:'small_scenery',baseZ:64,clearanceZ:96,object,isGhost:false}))];
    for(let y=10;y<42;y++)for(let x=10;x<42;x++)entries.push([x,y,elements]);
    const result=inspect(region(10,10,32,32),fixture(entries).map);
    assert.equal(result.complete,false);assert.equal(result.truncated,true);assert(result.unavailable.length>0);
    assert(result.paths.every(p=>p.directions.every(d=>d.nearbyEvidence.length<=2)));
    const refs=Object.values(result.evidenceTiles).flat();
    assert.equal(new Set(refs).size,refs.length);assert.equal(refs.length,result.evidence.length);
    assert(Buffer.byteLength(JSON.stringify(result),'utf8')<24*1024*1024,'Mixed stacked/scenery inspection exceeded safe protocol response size');
});

test('route walks a branching directed network, handles cycles and supports a zero-step route',()=>{
    const f=fixture([[10,10,[footpath(6)]],[11,10,[footpath(3)]],[10,11,[footpath(12)]],[11,11,[footpath(9)]],[12,11,[footpath(0)]]]);
    const result=route(request(endpoint(10,10),endpoint(11,11)),f.map);
    assert.equal(result.found,true);assert.equal(result.path.length,3);assert.equal(result.complete,true);assert.equal(result.truncated,false);
    assert.equal(result.path[0].key,'10,10,0');assert.equal(result.path.at(-1).key,'11,11,0');
    const unreachable=route(request(endpoint(10,10),endpoint(12,11)),f.map);
    assert.equal(unreachable.found,false);assert.equal(unreachable.complete,true);assert(unreachable.explored<=4);
    const same=route(request(endpoint(10,10),endpoint(10,10)),f.map);
    assert.equal(same.found,true);assert.deepEqual(keys(same.path),['10,10,0']);
});

test('route exhaustion is false but traversal limits preserve unknown reachability',()=>{
    const f=fixture([[10,10,[footpath(4)]],[11,10,[footpath(5)]],[12,10,[footpath(5)]],[13,10,[footpath(1)]]]);
    const limited=route(request(endpoint(10,10),endpoint(13,10),{limit:1}),f.map);
    assert.equal(limited.found,null);assert.equal(limited.truncated,true);assert.equal(limited.complete,false);
    assert.equal(limited.limit,1);assert(limited.explored<=1);assert.equal(limited.path,null);
    const complete=route(request(endpoint(10,10),endpoint(13,10),{limit:8}),f.map);
    assert.equal(complete.found,true);assert.equal(complete.truncated,false);assert.deepEqual(keys(complete.path),['10,10,0','11,10,0','12,10,0','13,10,0']);
});

test('bounds and types are validated before reading or navigating the map',()=>{
    for(const args of [null,{},region(-1),region(128),region(10,-1),region(10,128),region(10,10,0),region(10,10,33),region(10,10,2,33),region(127,10,2),region(10,127,2,2),region(10,10,1.5),region('10'),{...region(),height:null}]){
        const f=fixture();assert.throws(()=>inspect(args,f.map));assert.equal(f.calls.length,0);assert.equal(f.reads.length,0);
    }
    for(const args of [null,{},request(endpoint(-1,10),endpoint(11,10)),request(endpoint(10,10),endpoint(128,10)),request(endpoint(10,10,-1),endpoint(11,10)),request(endpoint(10,10,256),endpoint(11,10)),request(endpoint(10,10),endpoint(11,10),{limit:0}),request(endpoint(10,10),endpoint(11,10),{limit:4097}),request(endpoint(10,10),endpoint(11,10),{limit:'8'})]){
        const f=fixture();assert.throws(()=>route(args,f.map));assert.equal(f.calls.length,0);assert.equal(f.reads.length,0);
    }
    const f=fixture([[10,10,[{type:'surface',baseZ:64}]]]);
    assert.throws(()=>route(request(endpoint(10,10),endpoint(11,10)),f.map),/path/i);
});

function protocol(map,options={}){
    let connect,serial=0;const sent=[],calls=[],queries=[],store={},events={};
    const listener={on:(event,fn)=>{connect=fn;return listener;},listen:()=>listener};
    const context={mode:options.mode??'normal',apiVersion:options.apiVersion??124,subscribe:()=>{},setTimeout:()=>{},sharedStorage:{get:k=>store[k],set:(k,v)=>{store[k]=v;}},queryAction:(...args)=>queries.push(args),executeAction:(...args)=>calls.push(args)};
    const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../bridge.config.json'),'utf8'));
    const bundle=fs.readFileSync(path.join(__dirname,'../dist/agent-bridge.js'),'utf8');
    vm.runInNewContext(bundle,{context,map:{rides:[],...map},network:{mode:options.networkMode??'none',createListener:()=>listener},objectManager:{getObject:()=>null,getAllObjects:()=>[]},park:{},scenario:{},date:{},console:{log:()=>{}},registerPlugin:p=>p.main()});
    connect({on:(event,fn)=>{events[event]=fn;},write:s=>sent.push(JSON.parse(s)),end:()=>{}});
    function request(op,args={},extra={}){
        const req={id:'path-inspector-'+(++serial),op,args,token:config.token,...extra};
        events.data(JSON.stringify(req)+'\n');return sent.find(result=>result.id===req.id);
    }
    return {request,calls,queries,store};
}

test('bundled path inspections authenticate and read native topology without arming or actions',()=>{
    const f=fixture([[10,10,[footpath(4)]],[11,10,[footpath(1)]]]),h=protocol(f.map);
    const inspected=h.request('path.inspect',region());
    assert.equal(inspected.ok,true);assert.equal(inspected.result.complete,true);assert.equal(inspected.result.paths.length,2);
    const routed=h.request('path.route',request(endpoint(10,10),endpoint(11,10)));
    assert.equal(routed.ok,true);assert.equal(routed.result.found,true);
    const nativeCalls=f.calls.length,reads=f.reads.length;
    assert.equal(h.request('path.inspect',region(),{token:'incorrect'}).ok,false);
    assert.equal(h.request('path.route',request(endpoint(10,10),endpoint(11,10)),{token:'incorrect'}).ok,false);
    assert.equal(f.calls.length,nativeCalls);assert.equal(f.reads.length,reads);
    assert.deepEqual(h.calls,[]);assert.deepEqual(h.queries,[]);assert.deepEqual(h.store,{});
});

test('bundled path operations enforce loaded game, single-player and pinned API guards',()=>{
    for(const options of [{mode:'title'},{networkMode:'client'},{apiVersion:123}]){
        const f=fixture([[10,10,[footpath(4)]],[11,10,[footpath(1)]]]),h=protocol(f.map,options);
        for(const [op,args] of [['path.inspect',region()],['path.route',request(endpoint(10,10),endpoint(11,10))]]){
            const reply=h.request(op,args);assert.equal(reply.ok,false,JSON.stringify({options,op}));
            assert.match(reply.error,/park|single.player|API/i);
        }
        assert.deepEqual(f.calls,[]);assert.deepEqual(h.calls,[]);assert.deepEqual(h.queries,[]);assert.deepEqual(h.store,{});
    }
});

test('pinned native bindings preserve world coordinates, source banners and first compatible neighbor selection',()=>{
    const sourceRoot=path.join(__dirname,'../vendor/OpenRCT2'),read=name=>fs.readFileSync(path.join(sourceRoot,name),'utf8');
    const navigator=read('src/openrct2/scripting/bindings/world/ScPathNavigator.cpp');
    const map=read('src/openrct2/scripting/bindings/world/ScMap.cpp');
    const connection=read('src/openrct2/scripting/bindings/world/ScPathConnection.cpp');
    const footpath=read('src/openrct2/world/Footpath.cpp');
    const connected=navigator.slice(navigator.indexOf('JSValue ScPathNavigator::getConnectedPaths'),navigator.indexOf('JSValue ScPathNavigator::moveTo'));
    assert.match(map,/JStoCoordsXY\(ctx, pos\);\s*return ScPathNavigator::fromElement\(ctx, position, elementIndex, options\)/);
    assert.match(connection,/data->position\.toCoordsXYZ\(\)/);
    assert.match(navigator,/edges &= bannerElement->asBanner\(\)->getAllowedEdges\(\)/);
    assert.match(connected,/computePermittedEdges\(pathElement, options\)/);
    assert.match(connected,/getSlopeDirection\(\) == direction[^]*neighborPos\.z \+= 2/);
    assert.match(connected,/nextEl->isGhost\(\) && !options\.includeGhosts/);
    assert.match(connected,/FootpathIsZAndDirectionValid\(\*nextPath, neighborPos\.z, direction\)/);
    assert.match(connected,/JS_SetPropertyUint32\(ctx, result, resultIndex\+\+, conn\);\s*break;/);
    assert.doesNotMatch(connected,/nextPath->getEdges|nextEl->getEdges/);
    assert.match(footpath,/bool FootpathIsZAndDirectionValid[^]*?currentZ != pathElement\.baseHeight \+ 2/);
});
