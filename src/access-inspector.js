/* SPDX-License-Identifier: GPL-3.0-only */
var BridgeAccessInspector = (function () {
    'use strict';
    var Furniture=typeof BridgePathFurniture!=='undefined'?BridgePathFurniture:typeof require==='function'?require('./path-furniture'):null;
    var Amenities=typeof BridgeAmenityInspector!=='undefined'?BridgeAmenityInspector:typeof require==='function'?require('./amenity-inspector'):null;
    var DELTA=[[-1,0],[0,1],[1,0],[0,-1]];
    var NAV_OPTIONS={respectBanners:true,includeQueues:true,includeWidePaths:true,includeGhosts:false};
        var HARD={maxTiles:1048576,maxPaths:32768,maxEndpoints:4096,maxWarnings:1024,maxTileElements:256,maxSearchNodes:32768,maxSearchWork:1048576,maxWalls:32768,maxDoorCandidates:8192,maxEvidenceWork:65536};
    function key(x,y,i){return x+','+y+','+i;}
    function dict(){return Object.create(null);}
    function own(o,k){return Object.prototype.hasOwnProperty.call(o,k);}
    function validInt(n,min,max){return Number.isSafeInteger(n)&&n>=min&&n<=max;}
    function err(e){return String(e&&e.message||e).slice(0,200);}
    function rotate(mask,d){return ((mask<<d)|(mask>>(4-d)))&15;}
    function create(map,metadata,options){
        options=options||{};metadata=metadata||{};
        var furniture=Furniture&&Furniture.create(options.furniture),furnitureResult=null,amenityJob=null,amenityResult=null;
        var limits={},size,phase='scan',done=false,complete=true,truncated=false,unavailable=[],unavailableSeen=dict();
        Object.keys(HARD).forEach(function(n){var value=options[n]===undefined?HARD[n]:options[n];if(!validInt(value,1,HARD[n]))throw Error(n+' must be an integer from 1 to '+HARD[n]);limits[n]=value;});
        try{size=map.size;}catch(e){throw Error('Map tile bounds unavailable: '+err(e));}
        if(!size||!validInt(size.x,1,32768)||!validInt(size.y,1,32768))throw Error('Map tile bounds unavailable');
        size={x:size.x,y:size.y};
        var tiles=dict(),nodes=dict(),paths=[],endpoints=[],shops=dict(),gates=[],warnings=[],observations=[],rideById=dict(),rideTypes=dict(),trackTypes=dict(),entranceTypes=dict();
        var cursor=0,nativeCursor=0,gateCursor=0,endpointCursor=0,searchWork=0,doorCount=0,evidenceWork=0,wallCount=0,contextCount=0,contextComplete=true,virtualLinks=0,publicIn=dict(),publicOut=dict(),inSeeds=[],outSeeds=[],inSeedSet=dict(),outSeedSet=dict(),bfs=null,active=null;
        var counts={tiles:0,paths:0,parkEntrances:0,shops:0,rideEntrances:0,rideExits:0,healthy:0,unreachable:0,unknown:0,warningCount:0,publicPaths:0,dynamicVehicleBlockers:0};
        function unavailableAt(label,cap){complete=false;if(cap)truncated=true;if(!unavailableSeen[label]){unavailableSeen[label]=true;if(unavailable.length<128)unavailable.push(label);else if(unavailable.length===128)unavailable.push('Additional unavailable details omitted');}}
        function prop(obj,n,label,optional){try{var v=obj[n];if(v!==undefined||optional)return v;}catch(e){unavailableAt(label+': '+err(e));return undefined;}unavailableAt(label);return undefined;}
        // Amenity demand is independent from structural doorway access. An
        // unavailable rating or shop object must not invalidate navigation.
        function optionalValue(obj,n){try{return obj==null?undefined:obj[n];}catch(e){return undefined;}}
        function intProp(obj,n,label,min,max,nullable){var v=prop(obj,n,label,false);if(nullable&&v===null)return null;if(!validInt(v,min,max)){unavailableAt(label);return null;}return v;}
        function boolProp(obj,n,label){var v=prop(obj,n,label,false);if(typeof v!=='boolean'){unavailableAt(label);return null;}return v;}
        function tableIndex(values,out,label){if(!Array.isArray(values)){unavailableAt('Access metadata '+label+' unavailable');return;}values.forEach(function(v){if(v&&validInt(v.id,0,65535))out[v.id]=v;});}
        tableIndex(metadata.rideTypes,rideTypes,'rideTypes');tableIndex(metadata.trackTypes,trackTypes,'trackTypes');tableIndex(metadata.entranceTypes,entranceTypes,'entranceTypes');
        var rides;
        try{rides=options.rides===undefined?map.rides:options.rides;}catch(e){unavailableAt('Ride list: '+err(e));}
        if(!Array.isArray(rides)){unavailableAt('Ride list unavailable');rides=[];}
        if(rides.length>1024){unavailableAt('Ride list exceeds 1024 rides',true);rides=rides.slice(0,1024);}
        rides.forEach(function(r){
            var id=intProp(r,'id','ride.id',0,65534,false),type=intProp(r,'type','ride '+id+'.type',0,65534,false);
            if(id===null)return;
            var name=prop(r,'name','ride '+id+'.name',false),status=prop(r,'status','ride '+id+'.status',true);
            var object=optionalValue(r,'object');
            rideById[id]={id:id,type:type,name:typeof name==='string'?name.slice(0,160):'Ride '+id,status:typeof status==='string'?status:null,stations:prop(r,'stations','ride '+id+'.stations',true),
                nausea:optionalValue(r,'nausea'),object:{shopItem:optionalValue(object,'shopItem'),shopItemSecondary:optionalValue(object,'shopItemSecondary')}};
            if(!rideTypes[type])unavailableAt('Access metadata for ride type '+type+' unavailable');
        });
        function appendEndpoint(ep){
            if(endpoints.length>=limits.maxEndpoints){unavailableAt('Endpoint scan exceeds '+limits.maxEndpoints+' endpoints',true);return false;}
            if(doorCount+(ep.doors||[]).length>limits.maxDoorCandidates){unavailableAt('Door candidate scan exceeds '+limits.maxDoorCandidates+' candidates',true);return false;}
            doorCount+=(ep.doors||[]).length;
            ep.status='unknown';ep.issues=[];ep.doors=ep.doors||[];endpoints.push(ep);return true;
        }
        function readTile(x,y){
            var tk=x+','+y,t={x:x,y:y,paths:[],walls:[],context:[],complete:true};
            var el;
            try{var nativeTile=map.getTile(x,y);el=nativeTile&&nativeTile.elements;}catch(e){unavailableAt('Tile '+tk+': '+err(e));t.complete=false;return;}
            if(!Array.isArray(el)){unavailableAt('Tile '+tk+'.elements unavailable');return;}
            if(el.length>limits.maxTileElements){unavailableAt('Tile '+tk+' exceeds '+limits.maxTileElements+' elements',true);t.complete=false;}
            for(var i=0;i<Math.min(el.length,limits.maxTileElements);i++){
                var e=el[i],label='Element '+key(x,y,i),type=prop(e,'type',label+'.type',false);
                if(['footpath','entrance','track','wall','small_scenery','large_scenery'].indexOf(type)<0)continue;
                var ghost=boolProp(e,'isGhost',label+'.isGhost');if(ghost!==false){if(ghost===null)t.complete=false;continue;}
                if(['entrance','track','small_scenery','large_scenery'].indexOf(type)>=0){
                    if(contextCount>=32768)contextComplete=false;
                    else{
                        var cz=prop(e,'baseZ',label+'.baseZ',true),cc=prop(e,'clearanceZ',label+'.clearanceZ',true);
                        t.context.push({type:type,baseZ:validInt(cz,0,2147483647)?cz:null,clearanceZ:validInt(cc,0,2147483647)?cc:null});contextCount++;
                    }
                }
                if(type==='footpath'){
                    if(paths.length>=limits.maxPaths){unavailableAt('Path scan exceeds '+limits.maxPaths+' paths',true);continue;}
                    var queue=boolProp(e,'isQueue',label+'.isQueue'),slope=prop(e,'slopeDirection',label+'.slopeDirection',false);
                    if(slope!==null&&!validInt(slope,0,3)){unavailableAt(label+'.slopeDirection');slope=undefined;}
                    var p={key:key(x,y,i),x:x,y:y,elementIndex:i,baseZ:intProp(e,'baseZ',label+'.baseZ',0,2147483647,false),edges:intProp(e,'edges',label+'.edges',0,255,false),slopeDirection:slope,isQueue:queue,
                        ride:queue?intProp(e,'ride',label+'.ride',0,65535,true):null,station:queue?intProp(e,'station',label+'.station',0,255,true):null,
                        isBlockedByVehicle:boolProp(e,'isBlockedByVehicle',label+'.isBlockedByVehicle'),next:[],prev:[],permittedEdges:null,nativeAvailable:false};
                    if(p.edges!==null)p.edges&=15;
                    if(furniture)p.furniture=furniture.read(e,p);
                    if(p.isBlockedByVehicle)counts.dynamicVehicleBlockers++;
                    // Indexed PathNavigator can address a second overlapping
                    // element, while actual guests often select the first path
                    // at XYZ. Do not treat duplicate-height paths as independent
                    // guest states and accidentally certify a shadowed route.
                    if(p.baseZ!==null&&t.paths.some(function(other){return other.baseZ===p.baseZ;}))unavailableAt('Tile '+tk+' has ambiguous non-ghost paths at baseZ '+p.baseZ);
                    nodes[p.key]=p;paths.push(p);t.paths.push(p);counts.paths++;
                }else if(type==='wall'){
                    if(wallCount>=limits.maxWalls){unavailableAt('Wall evidence exceeds '+limits.maxWalls+' elements',true);continue;}wallCount++;
                    t.walls.push({key:key(x,y,i),x:x,y:y,elementIndex:i,baseZ:intProp(e,'baseZ',label+'.baseZ',0,2147483647,false),clearanceZ:intProp(e,'clearanceZ',label+'.clearanceZ',0,2147483647,false),direction:intProp(e,'direction',label+'.direction',0,3,false)});
                }else if(type==='entrance'){
                    // In API 124 `object` is the native EntranceType enum.
                    var et=intProp(e,'object',label+'.object',0,2,false),seq=intProp(e,'sequence',label+'.sequence',0,255,false),d=intProp(e,'direction',label+'.direction',0,3,false),z=intProp(e,'baseZ',label+'.baseZ',0,2147483647,false);
                    if(et===null||seq===null||d===null||z===null)continue;
                    var em=entranceTypes[et];
                    if(!em||!Array.isArray(em.sequenceDirections)||!validInt(em.sequenceDirections[seq],0,15)){unavailableAt('Entrance metadata '+et+' sequence '+seq+' unavailable');continue;}
                    if(em.sequenceDirections[seq]===0)continue;
                    var rid=et===2?null:intProp(e,'ride',label+'.ride',0,65534,false),r=rideById[rid];
                    if(et!==2&&!r)unavailableAt('Ride '+rid+' for '+label+' unavailable');
                    var ep={key:key(x,y,i),kind:et===2?'park_entrance':et===0?'ride_entrance':'ride_exit',ride:rid,name:et===2?'Park entrance at ('+x+','+y+')':r?r.name:'Ride '+rid,
                        rideStatus:r?r.status:null,station:et===2?null:intProp(e,'station',label+'.station',0,255,false),x:x,y:y,elementIndex:i,baseZ:z,direction:d};
                    if(et===2){ep.doors=[{x:x,y:y,baseZ:z,direction:d,side:'inside'},{x:x,y:y,baseZ:z,direction:d^2,side:'outside'}];if(appendEndpoint(ep)){gates.push(ep);counts.parkEntrances++;}}
                    else{ep.doors=[{x:x,y:y,baseZ:z,direction:d^2}];if(appendEndpoint(ep)){if(et===0)counts.rideEntrances++;else counts.rideExits++;}}
                }else if(type==='track'){
                    var rideId=intProp(e,'ride',label+'.ride',0,65534,false),ride=rideById[rideId],rm=ride&&rideTypes[ride.type];
                    if(!ride){unavailableAt('Ride '+rideId+' for '+label+' unavailable');continue;}
                    if(!rm||rm.isShopOrFacility!==true)continue;
                    var shop=shops[rideId];
                    if(!shop){shop={key:'shop:'+rideId,kind:'shop',ride:rideId,name:ride.name,rideStatus:ride.status,station:null,x:x,y:y,elementIndex:i,doors:[],metadataUnknown:false};if(appendEndpoint(shop)){shops[rideId]=shop;counts.shops++;}else continue;}
                    var tt=intProp(e,'trackType',label+'.trackType',0,65535,false),sq=intProp(e,'sequence',label+'.sequence',0,255,false),td=intProp(e,'direction',label+'.direction',0,3,false),tz=intProp(e,'baseZ',label+'.baseZ',0,2147483647,false),tm=trackTypes[tt],sm;
                    if(tm&&Array.isArray(tm.sequences))for(var si=0;si<tm.sequences.length;si++)if(tm.sequences[si].index===sq){sm=tm.sequences[si];break;}
                    if(!sm||typeof sm.connectsToPath!=='boolean'||!validInt(sm.entranceDirections,0,15)||td===null||tz===null){unavailableAt('Shop footprint metadata for '+label+' unavailable');shop.metadataUnknown=true;continue;}
                    if(rm.isFlatRide!==true||!sm.connectsToPath)continue;
                    var mask=rotate(sm.entranceDirections,td);
                    for(var dd=0;dd<4;dd++)if(mask&(1<<dd)){
                        if(shop.doors.length>=64||doorCount>=limits.maxDoorCandidates){unavailableAt('Shop doorway scan exceeds configured candidate limit',true);shop.metadataUnknown=true;break;}
                        doorCount++;
                        shop.doors.push({x:x,y:y,elementIndex:i,baseZ:tz,direction:dd});
                    }
                }
            }
            // Empty and scenery-only tiles need no retained objects. Their absence
            // still establishes an empty path tile after a complete full-map scan.
            if(t.paths.length||t.walls.length||t.context.length||!t.complete)tiles[tk]=t;
        }
        function pathHeight(p,d){if(p.baseZ===null||p.slopeDirection===undefined)return null;if(p.slopeDirection===null)return p.baseZ;if(p.slopeDirection===d)return p.baseZ+16;if((p.slopeDirection^2)===d)return p.baseZ;return null;}
        function nativePath(p){
            var nav,conns;
            try{
                if(typeof map.getPathNavigator!=='function')throw Error('map.getPathNavigator unavailable');
                nav=map.getPathNavigator({x:p.x*32,y:p.y*32},p.elementIndex,NAV_OPTIONS);
                if(!nav||!validInt(nav.edges,0,15)||!validInt(nav.permittedEdges,0,15))throw Error('Native path edge data unavailable');
                p.permittedEdges=nav.permittedEdges;
                if(typeof nav.getConnectedPaths!=='function')throw Error('Native connected paths unavailable');
                conns=nav.getConnectedPaths();if(!Array.isArray(conns))throw Error('Native connected paths invalid');
                if(conns.length>4){unavailableAt('Native path '+p.key+' exceeds four directions',true);return;}
                var seenDirections=0;
                for(var i=0;i<conns.length;i++){
                    var c=conns[i],pos=c.position,dir=c.direction,idx=c.elementIndex;
                    if(!pos||!validInt(dir,0,3)||!validInt(idx,0,limits.maxTileElements-1)||!validInt(pos.x,0,size.x*32-1)||!validInt(pos.y,0,size.y*32-1)||pos.x%32||pos.y%32||!validInt(pos.z,0,2147483647)||
                        pos.x/32!==p.x+DELTA[dir][0]||pos.y/32!==p.y+DELTA[dir][1]||(seenDirections&(1<<dir)))throw Error('Invalid native path connection');
                    seenDirections|=1<<dir;
                    var target=nodes[key(pos.x/32,pos.y/32,idx)];
                    if(!target||target.baseZ!==pos.z||!(p.permittedEdges&(1<<dir))||pathHeight(target,dir^2)!==p.baseZ+(p.slopeDirection===dir?16:0))throw Error('Native target does not match scanned path');
                    // Preserve the engine's directed, first-target links. A missing
                    // reverse bit is not grounds to invent or remove this link.
                    p.next.push(target.key);target.prev.push(p.key);
                }
                p.nativeAvailable=true;
            }catch(e){unavailableAt('Native path '+p.key+': '+err(e));}
        }
        function boundaryWalls(x,y,d,z){
            var result=[],a=tiles[x+','+y],b=tiles[(x+DELTA[d][0])+','+(y+DELTA[d][1])];
            function side(t,face){if(!t)return;t.walls.forEach(function(w){if(result.length<8&&w.direction===face&&w.baseZ!==null&&w.clearanceZ!==null&&w.baseZ<=z&&w.clearanceZ>z)result.push(w);});}
            side(a,d);side(b,d^2);return result;
        }
        function allowed(p,ep){if(p.isQueue===false)return true;if(ep.kind!=='ride_entrance'||p.isQueue!==true)return false;return p.ride===ep.ride&&p.station===ep.station;}
        function doorCheck(ep,door){
            var x=door.x+DELTA[door.direction][0],y=door.y+DELTA[door.direction][1],face=door.direction^2,t=tiles[x+','+y],ps=t?t.paths:[],matching=[],wrong=[],badHeight=[],missing=[],blocked=[],geometryMatches=0;
            var out={x:door.x,y:door.y,baseZ:door.baseZ,direction:door.direction,side:door.side||null,pathTile:{x:x,y:y},connections:[],issues:[],boundaryWalls:boundaryWalls(door.x,door.y,door.direction,door.baseZ)};
            ps.forEach(function(p){
                if(pathHeight(p,face)!==door.baseZ){badHeight.push(p.key);return;}
                geometryMatches++;
                if(ep.kind==='park_entrance'?p.isQueue!==false:!allowed(p,ep)){wrong.push(p.key);return;}
                matching.push(p.key);
                // Source-verified MapCoordIsConnected: a slope end matches on
                // height/direction; a flat path must store the doorway edge.
                var local=p.slopeDirection!==null||(p.edges!==null&&(p.edges&(1<<face))!==0);
                if(ep.kind==='park_entrance'&&door.side==='inside')local=true; // Peep::PerformEnteringPark checks matching geometry, not flat edge bits.
                var needsDeparture=ep.kind!=='ride_exit'&&!(ep.kind==='park_entrance'&&door.side==='inside');
                // Native local reachability accepts slope geometry without an
                // edge bit. Guest pathfinding still needs a departure edge to
                // walk from that slope into an entrance or counter.
                if(needsDeparture&&(p.edges===null||!(p.edges&(1<<face))))local=false;
                if(!local){missing.push(p.key);return;}
                // An exit guest moves FROM the gate onto the landing. A banner
                // preventing movement back toward the ride does not block that.
                if(needsDeparture&&p.edges!==null&&(p.edges&(1<<face))&&p.permittedEdges!==null&&!(p.permittedEdges&(1<<face))){blocked.push(p.key);return;}
                out.connections.push(p.key);
            });
            if(geometryMatches>1){
                unavailableAt('Doorway at '+door.x+','+door.y+' direction '+door.direction+' has multiple geometry-compatible landing paths');
                out.connections=[];out.issues.push({code:'ambiguous_doorway',message:'Multiple path elements meet this doorway height. Native guest element selection is ambiguous.',pathTile:out.pathTile});
                return out;
            }
            if(!out.connections.length){
                var code,text;
                if(blocked.length){code='banner_restriction';text='A no-entry banner restricts the path edge at the doorway.';}
                else if(missing.length){code='missing_door_edge';text='The adjacent path matches the doorway height but has no connecting doorway edge.';}
                else if(wrong.length){code='wrong_queue';text=ep.kind==='ride_entrance'?'The doorway touches a queue assigned to another ride or station.':'The doorway touches a queue instead of the public footpath.';}
                else if(badHeight.length){code='height_mismatch';text='Adjacent paths do not match the doorway height or slope end.';}
                else{code='missing_path';text='No non-ghost footpath is present in front of the doorway.';}
                out.issues.push({code:code,message:text,pathTile:out.pathTile,paths:blocked.concat(missing,wrong,badHeight).slice(0,8),boundaryWalls:out.boundaryWalls});
            }
            return out;
        }
        function addLink(from,to){if(nodes[from].next.indexOf(to)<0){if(virtualLinks>=limits.maxPaths*4){unavailableAt('Park gate crossing graph exceeds configured work limit',true);return;}virtualLinks++;nodes[from].next.push(to);nodes[to].prev.push(from);}}
        function prepareGate(ep){
            ep.doorChecks=ep.doors.map(function(d){return doorCheck(ep,d);});
            var inside=ep.doorChecks[0],outside=ep.doorChecks[1];
            // Gate elements are not returned by PathNavigator. Add only the
            // verified center gate crossing, never an arbitrary adjacent bridge.
            // Entering guests select the first geometry-compatible public path
            // in element order, rather than every overlapping path element.
            if(inside.connections.length&&!inSeedSet[inside.connections[0]]){inSeedSet[inside.connections[0]]=true;inSeeds.push(inside.connections[0]);}
            inside.connections.forEach(function(k){var p=nodes[k],face=ep.direction^2;if(p.permittedEdges!==null&&(p.permittedEdges&(1<<face))){if(!outSeedSet[k]){outSeedSet[k]=true;outSeeds.push(k);}if(outside.connections.length)addLink(k,outside.connections[0]);}});
            if(inside.connections.length)outside.connections.forEach(function(k){var p=nodes[k];if(p.permittedEdges!==null&&(p.permittedEdges&(1<<ep.direction)))addLink(k,inside.connections[0]);});
        }
        function startBfs(seeds,seen,reverse){var q=[];seeds.forEach(function(k){if(!seen[k]){seen[k]=true;q.push(k);}});return{queue:q,cursor:0,seen:seen,reverse:reverse};}
        function globalStep(){
            if(bfs.cursor>=bfs.queue.length)return false;
            var p=nodes[bfs.queue[bfs.cursor++]],links=bfs.reverse?p.prev:p.next;
            links.forEach(function(k){if(nodes[k].isQueue===false&&!bfs.seen[k]){bfs.seen[k]=true;bfs.queue.push(k);}});return true;
        }
        function failureEvidence(search,ep){
            // Inspect only frontiers of an actually unreachable endpoint. We do
            // not emit warnings for arbitrary neighboring path separations.
            var found=[],seen=dict(),q=search.queue.slice(0,256),comparisons=0;
            search.evidenceTruncated=search.queue.length>256||!contextComplete;
            if(!contextComplete)return found;
            q.sort(function(a,b){return nodes[a].next.length+nodes[a].prev.length-nodes[b].next.length-nodes[b].prev.length;});
            for(var i=0;i<q.length&&found.length<1;i++){
                var p=nodes[q[i]];
                for(var d=0;d<4&&found.length<1;d++){
                    var z=pathHeight(p,d);if(z===null)continue;
                    var nx=p.x+DELTA[d][0],ny=p.y+DELTA[d][1],t=tiles[nx+','+ny],near=t?t.paths:[],target=null;
                    var work=near.length+(t?t.context.length:0)+1;comparisons+=work;evidenceWork+=work;if(comparisons>4096||evidenceWork>limits.maxEvidenceWork){search.evidenceTruncated=true;return found;}
                    for(var j=0;j<near.length;j++)if(near[j].isQueue===false&&pathHeight(near[j],d^2)===z&&(publicIn[near[j].key]||publicOut[near[j].key])){target=near[j];break;}
                    if(target&&!search.seen[target.key]&&!seen[p.key+'|'+d]){
                        seen[p.key+'|'+d]=true;found.push({code:'frontier_gap',from:{x:p.x,y:p.y,elementIndex:p.elementIndex},to:{x:target.x,y:target.y,elementIndex:target.elementIndex},direction:d,baseZ:z,boundaryWalls:boundaryWalls(p.x,p.y,d,z),message:'This unreachable endpoint component is adjacent to the public network without a usable directed join.'});
                    }else if(!near.length&&!(t&&t.context.some(function(c){return (c.type==='entrance'||c.type==='track')&&(c.baseZ===null||c.clearanceZ===null||c.baseZ<z+16&&c.clearanceZ>z);} ))){
                        for(var turn=0;turn<4&&found.length<1;turn++){
                            if(turn===(d^2))continue;
                            var beyond=tiles[(nx+DELTA[turn][0])+','+(ny+DELTA[turn][1])],pp=beyond?beyond.paths:[];
                            comparisons+=pp.length+1;evidenceWork+=pp.length+1;if(comparisons>4096||evidenceWork>limits.maxEvidenceWork){search.evidenceTruncated=true;return found;}
                            for(var k=0;k<pp.length;k++)if(pp[k].isQueue===false&&pathHeight(pp[k],turn^2)===z&&(publicIn[pp[k].key]||publicOut[pp[k].key])){
                                found.push({code:'frontier_missing_path',from:{x:p.x,y:p.y,elementIndex:p.elementIndex},pathTile:{x:nx,y:ny},to:{x:pp[k].x,y:pp[k].y,elementIndex:pp[k].elementIndex},direction:d,baseZ:z,tileContext:t?t.context:[],message:'A pathless tile separates this unreachable endpoint component from the public network; this is a possible repair location.'});break;
                            }
                        }
                    }
                }
            }
            return found;
        }
        function startSearch(ep,starts,reverse,goal){return {ep:ep,queue:starts.slice(),cursor:0,seen:starts.reduce(function(o,k){o[k]=true;return o;},dict()),reverse:reverse,goal:goal,found:false,complete:true,evidence:[]};}
        function searchStep(s){
            if(s.cursor>=s.queue.length)return false;
            if(s.cursor>=limits.maxSearchNodes||searchWork>=limits.maxSearchWork){s.complete=false;unavailableAt('Endpoint route search exceeds configured work limit',true);return false;}
            var k=s.queue[s.cursor++];searchWork++;
            if(s.goal[k]){s.found=true;return false;}
            var p=nodes[k],links=s.reverse?p.prev:p.next;
            links.forEach(function(next){if(!s.seen[next]&&allowed(nodes[next],s.ep)){s.seen[next]=true;s.queue.push(next);}});return true;
        }
        function beginEndpoint(ep){
            if(ep.missingGate){ep.issues=[{code:ep.missingStation?'missing_station_access':ep.kind==='ride_entrance'?'missing_ride_entrance':'missing_ride_exit',message:ep.missingStation?'This open ride station has neither an entrance nor an exit gate.':'This open ride has no native '+(ep.kind==='ride_entrance'?'entrance':'exit')+' gate.'}];finishEndpoint(ep,'unreachable');return null;}
            if(ep.kind==='park_entrance'){
                var checks=ep.doorChecks||[],bad=checks.filter(function(d){return !d.connections.length;});
                ep.issues=[];bad.forEach(function(d){ep.issues=ep.issues.concat(d.issues);});
                if(checks[0]&&checks[0].connections.length&&!checks[0].connections.some(function(k){return outSeedSet[k];}))ep.issues.push({code:'missing_door_edge',message:'The internal path lacks a permitted edge back to the park gate.',pathTile:checks[0].pathTile});
                finishEndpoint(ep,ep.issues.length?'unreachable':'healthy');return null;
            }
            ep.doorChecks=ep.doors.map(function(d){return doorCheck(ep,d);});
            var starts=[],seen=dict();ep.doorChecks.forEach(function(d){d.connections.forEach(function(k){if(!seen[k]){seen[k]=true;starts.push(k);}});});
            if(!ep.doors.length){ep.issues=[{code:'endpoint_unavailable',message:'No supported native doorway could be resolved for this endpoint.'}];finishEndpoint(ep,'unknown');return null;}
            if(!starts.length){ep.issues=[];ep.doorChecks.forEach(function(d){if(ep.issues.length<4)ep.issues=ep.issues.concat(d.issues).slice(0,4);else ep.issuesTruncated=true;});finishEndpoint(ep,'unreachable');return null;}
            if(!inSeeds.length||!outSeeds.length){ep.issues=[{code:'park_root_unavailable',message:'A usable internal park entrance path is unavailable; network access is unknown.'}];finishEndpoint(ep,'unknown');return null;}
            var incoming=ep.kind==='shop'?starts.filter(function(k){return publicIn[k];}):[];
            // A shop visit returns through the same counter used to enter. Do
            // not combine inbound access at one isolated door with return access
            // at a different door elsewhere on a multi-tile footprint.
            if(ep.kind==='shop'&&incoming.length)return{ep:ep,starts:incoming,stage:'out',search:startSearch(ep,incoming,false,publicOut)};
            return{ep:ep,starts:starts,stage:ep.kind==='ride_exit'?'out':'in',search:startSearch(ep,starts,ep.kind!=='ride_exit',ep.kind==='ride_exit'?publicOut:publicIn)};
        }
        function finishEndpoint(ep,status){
            if(!complete||ep.metadataUnknown)status='unknown';
            ep.status=status;counts[status]++;
            if(status==='unreachable'){
                var primary=ep.issues[0]||{code:'route_unreachable',message:'No usable route connects this endpoint to the park entrance network.'};
                if(warnings.length+observations.length>=limits.maxWarnings){unavailableAt('Access warnings exceed '+limits.maxWarnings+' entries',true);return;}
                var label=ep.name+(ep.kind==='ride_entrance'?' entrance':ep.kind==='ride_exit'?' exit':'')+(ep.station!==null?' (station '+ep.station+')':'');
                var info=ep.rideStatus==='closed'||ep.rideStatus==='testing';
                (info?observations:warnings).push({code:primary.code,endpoint:ep.key,kind:ep.kind,ride:ep.ride,name:ep.name,station:ep.station,x:ep.x,y:ep.y,severity:info?'info':'warning',message:label+': '+primary.message,issues:ep.issues});
            }
        }
        function endpointStep(){
            if(!active){if(endpointCursor>=endpoints.length)return false;active=beginEndpoint(endpoints[endpointCursor++]);return true;}
            var s=active.search;if(searchStep(s))return true;
            var ep=active.ep;
            if(!s.complete){ep.issues=[{code:'route_unavailable',message:'Endpoint route search did not finish.'}];finishEndpoint(ep,'unknown');active=null;return true;}
            if(!s.found){var evidence=failureEvidence(s,ep);ep.issues=[{code:'route_unreachable',direction:active.stage==='in'?'from_park':'to_park',message:active.stage==='in'?'No permitted route from a park entrance reaches this endpoint.':'No permitted route leads from this endpoint back to a park entrance.',evidence:evidence,evidenceTruncated:s.evidenceTruncated}];finishEndpoint(ep,'unreachable');active=null;return true;}
            if(ep.kind==='shop'&&active.stage==='in'){active.stage='out';active.search=startSearch(ep,active.starts,false,publicOut);return true;}
            ep.issues=[];finishEndpoint(ep,'healthy');active=null;return true;
        }
        function missingOpenRideGates(){
            // A ride under construction is not a guest access warning. Native
            // existing gate elements remain inspectable regardless of status.
            Object.keys(rideById).forEach(function(id){var r=rideById[id],rm=rideTypes[r.type];if(r.status!=='open'||!rm)return;
                if(rm.isShopOrFacility){if(!shops[id])appendEndpoint({key:'shop:missing:'+id,kind:'shop',ride:r.id,name:r.name,rideStatus:r.status,station:null,x:null,y:null,elementIndex:null,doors:[],metadataUnknown:true});return;}
                var relevant=endpoints.filter(function(ep){return ep.ride===r.id;});
                var stations=dict();relevant.forEach(function(ep){if(ep.station!==null)stations[ep.station]=true;});
                if(Array.isArray(r.stations))r.stations.slice(0,255).forEach(function(s,i){if(s&&s.start&&validInt(s.length,1,255)){var index=validInt(s.index,0,254)?s.index:i;stations[index]=true;}});
                if(!Object.keys(stations).length)stations['unknown']=true;
                var missingStation=false;
                Object.keys(stations).forEach(function(si){var station=si==='unknown'?null:Number(si);if(!relevant.some(function(ep){return ep.station===station&&(ep.kind==='ride_entrance'||ep.kind==='ride_exit');})){
                    missingStation=true;appendEndpoint({key:'ride_station:missing:'+id+':'+si,kind:'ride_station',ride:r.id,name:r.name,rideStatus:r.status,station:station,x:null,y:null,elementIndex:null,doors:[],missingGate:true,missingStation:true});
                }});
                // Native RideCheckForEntranceExit permits entry-only pickup and
                // exit-only dropoff stations, but the ride needs both somewhere.
                ['ride_entrance','ride_exit'].forEach(function(kind){if(!relevant.some(function(ep){return ep.kind===kind;})&&(!missingStation||relevant.length))appendEndpoint({key:kind+':missing:'+id,kind:kind,ride:r.id,name:r.name,rideStatus:r.status,station:null,x:null,y:null,elementIndex:null,doors:[],missingGate:true});});
            });
        }
        function finish(){
            // A later error or cap invalidates earlier healthy/disconnected
            // classifications as well; never leave stale certainty in a partial audit.
            if(!complete){counts.healthy=0;counts.unreachable=0;counts.unknown=endpoints.length;endpoints.forEach(function(ep){ep.status='unknown';});warnings=[];observations=[];}
            var publicBoth=dict();Object.keys(publicIn).forEach(function(k){if(publicOut[k])publicBoth[k]=true;});
            furnitureResult=furniture?furniture.summarize(paths,{name:'park',complete:complete&&!truncated,publicKeys:publicBoth,coverageComplete:complete&&!truncated}):{status:'unknown',complete:false,unavailable:['Path furniture module unavailable']};
            counts.warningCount=warnings.length;counts.publicPaths=Object.keys(publicIn).length;
            try{
                if(!Amenities)throw Error('Local amenity module unavailable');
                amenityJob=Amenities.create({paths:paths,endpoints:endpoints,rideById:rideById,publicBoth:publicBoth,publicOut:publicOut,pricingSupport:options.pricingSupport,complete:complete,truncated:truncated},options.amenities);
                phase='amenities';
            }catch(e){finishAmenities(e);}
        }
        function finishAmenities(error){
            amenityResult=error?{status:'unknown',complete:false,sites:[],observations:[],unavailable:['Local amenity audit: '+err(error)]}:amenityJob.result();
            done=true;phase='done';
        }
        function step(workUnits){
            if(workUnits===undefined)workUnits=256;if(!validInt(workUnits,1,4096))throw Error('workUnits must be an integer from 1 to 4096');
            for(var unit=0;unit<workUnits&&!done;unit++){
                if(phase==='scan'){
                    if(cursor>=size.x*size.y||cursor>=limits.maxTiles){if(cursor<size.x*size.y)unavailableAt('Map scan exceeds '+limits.maxTiles+' tiles',true);phase='native';continue;}
                    var x=cursor%size.x,y=Math.floor(cursor/size.x);readTile(x,y);cursor++;counts.tiles++;
                }else if(phase==='native'){
                    if(nativeCursor>=paths.length){phase='gates';continue;}nativePath(paths[nativeCursor++]);
                }else if(phase==='gates'){
                    if(gateCursor>=gates.length){if(!gates.length)unavailableAt('No native park entrance centers found');missingOpenRideGates();bfs=startBfs(inSeeds,publicIn,false);phase='public_in';continue;}prepareGate(gates[gateCursor++]);
                }else if(phase==='public_in'){
                    if(!globalStep()){bfs=startBfs(outSeeds,publicOut,true);phase='public_out';}
                }else if(phase==='public_out'){
                    if(!globalStep())phase='endpoints';
                }else if(phase==='endpoints'){
                    if(!endpointStep())finish();
                }else if(phase==='amenities'){
                    try{amenityJob.step(1);if(amenityJob.done)finishAmenities();}catch(e){finishAmenities(e);}
                }
            }
            return done;
        }
        function status(){return {status:done?(complete?(warnings.length?'problems':counts.unknown?'unknown':'ok'):'unknown'):'checking',phase:phase,done:done,tilesRead:counts.tiles,totalTiles:size.x*size.y,pathsRead:nativeCursor,totalPaths:paths.length,endpointsChecked:endpointCursor,totalEndpoints:endpoints.length};}
        function endpointView(ep){return {key:ep.key,kind:ep.kind,ride:ep.ride,name:ep.name,rideStatus:ep.rideStatus,station:ep.station,x:ep.x,y:ep.y,elementIndex:ep.elementIndex,baseZ:ep.baseZ,direction:ep.direction,status:ep.status,issues:ep.issues,issuesTruncated:!!ep.issuesTruncated,
            doorChecks:(ep.doorChecks||[]).map(function(d){return{x:d.x,y:d.y,baseZ:d.baseZ,direction:d.direction,side:d.side,pathTile:d.pathTile,connections:d.connections.slice(0,8),connectionsTruncated:d.connections.length>8,issueCodes:d.issues.map(function(i){return i.code;}),boundaryWalls:d.boundaryWalls.map(function(w){return w.key;})};})};}
        function result(){return {complete:done&&complete,status:status().status,truncated:truncated,topologyOnly:true,evidenceContextComplete:contextComplete,summary:counts,endpoints:endpoints.map(endpointView),warnings:warnings,observations:observations,unavailable:unavailable,progress:status(),limits:limits,
            furniture:furnitureResult||{status:'checking',complete:false,unavailable:[]},
            amenities:amenityResult||{status:'checking',complete:false,sites:[],observations:[],unavailable:[]},
            notes:['Uses native API 124 directed path connections, doorway metadata, real park gate centers and matching ride/station queues. Ghost paths are excluded and no-entry banners are respected.',
                'Public transit excludes ride queues. A ride entrance may use only its own station queue. Shop and ride exit access uses public footpaths.',
                'Warnings identify unavailable facility endpoints, not arbitrary separations between neighboring paths. Boundary walls are supporting construction evidence; scenery and ride supports do not independently block native navigation.',
                'A healthy result establishes structural access under these rules, not congestion, placement legality or actual guest journey completion. No guest thoughts are read.']};}
        return {step:step,result:result,status:status,get done(){return done;}};
    }
    function audit(args,map,metadata){var job=create(map,metadata,args||{});while(!job.done)job.step(4096);return job.result();}
    return {create:create,audit:audit};
})();
if(typeof module!=='undefined')module.exports=BridgeAccessInspector;
