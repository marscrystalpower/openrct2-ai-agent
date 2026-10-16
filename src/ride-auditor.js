/* SPDX-License-Identifier: GPL-3.0-only */
var BridgeRideAuditor = (function () {
    'use strict';
    // Read-only API 124 contract: inspect(ride, map, context, TRACK_SUPPORT,
    // {maxSegments:4096}). Only follows the native circuit from station starts;
    // never scans the map, changes settings, predicts speed, or certifies blocks.
    // TRACK_SUPPORT is generated from the pinned native descriptors, including
    // rideModes. Bounds apply to pieces, tile elements and returned observations.
    function inspect(ride, map, context, data, options) {
        options = options || {};
        var limit = Number.isInteger(options.maxSegments) ? Math.max(1, Math.min(4096, options.maxSegments)) : 4096;
        var unavailable = [], observations = [], pieces = [], visited = Object.create(null), stationStarts = [];
        var result = {source:'OpenRCT2 scripting API 124 and pinned native track descriptors', schemaVersion:1,
            status:'unknown', complete:false, truncated:false, observations:observations, unavailable:unavailable,
            limits:{maxSegments:limit,maxTileElements:256,maxObservations:32,maxBrakeRuns:32,maxLiftCrestBanking:32},
            track:{closed:null, reason:null, segmentsChecked:0, counts:null, observedCounts:{ordinaryBrakes:0,blockBrakes:0,photo:0},
                ordinaryBrakeRuns:[], liftCrestBanking:[]},
            operation:{rideTimeSeconds:null, configuredTrains:null, mode:null, modeName:null, supportedBlockModes:null,
                blockTrackSupported:null, liftHillSpeed:null},
            limitations:[
                'Design observations request review; they do not establish unsafe track or prove a turn needs no banking.',
                'Counts cover the native circuit reached from stations. Unconnected extra track is not included; unknown or truncated is not clear.',
                'Ordinary brakes do not create block sections. Block pieces and supported modes do not prove safe multi-train operation or useful throughput.',
                'Lift-crest review uses chain flags and track geometry, not measured speed at each turn. Verify train speed, radius and lateral forces before changing banking.'
            ]};
        function missing(name) { if (unavailable.indexOf(name) < 0 && unavailable.length < 32) unavailable.push(name); }
        function read(object, key) { try { return object == null ? undefined : object[key]; } catch (e) { return undefined; } }
        function integer(value) { return Number.isSafeInteger(value); }
        function count(value, max) { return integer(value) && value >= 0 && value <= max ? value : null; }
        function position(value) {
            return value && ['x','y','z','direction'].every(function(k){return integer(value[k]);}) && value.direction >= 0 && value.direction <= 7 ?
                {x:value.x,y:value.y,z:value.z,direction:value.direction} : null;
        }
        function key(p, type) { return [p.x,p.y,p.z,p.direction,type].join(','); }
        function ref(piece) { return {index:piece.index,type:piece.type,name:piece.name,position:piece.position}; }
        function add(code, message, evidence) { if(observations.length < 32) observations.push({code:code,severity:'review',message:message,evidence:evidence}); else result.truncated=true; }
        function tile(x,y) {
            try {
                if (!integer(x) || !integer(y) || x < 0 || y < 0 || !map.size || x >= map.size.x || y >= map.size.y) return null;
                var t=map.getTile(x,y), es=t && t.elements;
                if (!Array.isArray(es) || es.length > 256) return null;
                return es;
            } catch(e) { return null; }
        }
        if (!context || context.apiVersion !== 124 || !data || !Array.isArray(data.rideTypes) || !Array.isArray(data.segments) || !data.trackGroups || !data.rideModes || !data.trackRolls || !data.trackPitches) {
            missing('compatible native metadata'); return result;
        }
        var descriptor=data.rideTypes[read(ride,'type')];
        if (!descriptor || !descriptor.flags) { missing('ride type descriptor'); return result; }
        if (!descriptor.flags.hasTrack || descriptor.flags.isFlatRide || descriptor.flags.isDummyType) {
            result.status='not_applicable'; result.complete=true; return result;
        }
        var groups=data.trackGroups, modes=data.rideModes, operation=result.operation;
        function groupIn(group,names) { return names.some(function(name){return integer(groups[name]) && group === groups[name];}); }
        operation.rideTimeSeconds=count(read(ride,'rideTime'),2147483647);
        var heads=read(ride,'vehicles');
        operation.configuredTrains=Array.isArray(heads) && heads.length<=255 ? heads.length : null;
        operation.mode=count(read(ride,'mode'),255);
        Object.keys(modes).some(function(name){if(modes[name]===operation.mode){operation.modeName=name;return true;}return false;});
        operation.liftHillSpeed=count(read(ride,'liftHillSpeed'),255);
        var allowed=descriptor.rideModes;
        if(Array.isArray(allowed)) operation.supportedBlockModes=['continuousCircuitBlockSectioned','poweredLaunchBlockSectioned'].filter(function(name){return allowed.indexOf(modes[name])>=0;}).map(function(name){return {id:modes[name],name:name};});
        else missing('ride type operating modes');
        operation.blockTrackSupported=!!(descriptor.regular && descriptor.inverted && [descriptor.regular,descriptor.inverted].some(function(d){return Array.isArray(d.enabledGroups) && d.enabledGroups.some(function(g){return groupIn(g,['blockBrakes','diagBlockBrakes']);});}));
        var stations=read(ride,'stations');
        if (!Array.isArray(stations) || stations.length>255) { missing('station starts'); return result; }
        stations.forEach(function(s,index){
            var p=read(s,'start');
            if(p && ['x','y','z'].every(function(k){return integer(p[k]);}) && p.x%32===0 && p.y%32===0)
                stationStarts.push({x:p.x,y:p.y,z:p.z,station:index});
        });
        var iterator=null;
        for(var st=0; st<stationStarts.length && !iterator; st++) {
            var start=stationStarts[st], es=tile(start.x/32,start.y/32);
            if(!es) continue;
            for(var e=0;e<es.length;e++) {
                var el=es[e];
                if(read(el,'type')==='track' && read(el,'ride')===ride.id && read(el,'baseZ')===start.z && read(el,'isGhost')!==true) {
                    try { iterator=map.getTrackIterator({x:start.x,y:start.y},e); } catch(ignore) {}
                    if(iterator) break;
                }
            }
        }
        if(!iterator) { missing('native track iterator at station'); result.track.reason='no station track'; return result; }
        var first=null, reason='traversal limit', closed=false, metadataComplete=true;
        for(var i=0;i<limit;i++) {
            var p=position(read(iterator,'position')), live=read(iterator,'segment'), type=read(live,'type'), native=data.segments[type];
            if(!p || !native || type!==native.id) { missing('native track position or descriptor'); reason='unreadable segment'; metadataComplete=false; break; }
            var k=key(p,type);
            if(visited[k]!==undefined) { closed=k===first; reason=closed?'circuit':'repeated non-start piece'; break; }
            if(first===null) first=k;
            visited[k]=pieces.length;
            var coherent=['beginSlope','endSlope','beginBank','endBank','trackGroup'].every(function(field){return read(live,field)===native[field];}) && read(live,'isBankedTurn')===native.flags.isBankedTurn;
            var beginZ=read(live,'beginZ'), endZ=read(live,'endZ'), blocks=read(live,'elements');
            if(!coherent || !integer(beginZ) || !integer(endZ) || !Array.isArray(blocks) || !blocks[0] || blocks.length>256 ||
                !['x','y','z'].every(function(field){return integer(blocks[0][field]);})) {
                missing('matching native geometry at segment '+i); reason='unreadable segment geometry'; metadataComplete=false; break;
            }
            // GetTrackSegmentOrigin rotates sequence offsets by track direction;
            // the iterator's origin can differ from the first tile's base height.
            var offset=blocks[0], xy=[[offset.x,offset.y],[offset.y,-offset.x],[-offset.x,-offset.y],[-offset.y,offset.x]][p.direction&3];
            var tx=(p.x+xy[0])/32, ty=(p.y+xy[1])/32, elements=tile(tx,ty), matches=[];
            if(elements) elements.forEach(function(t,index){
                if(read(t,'type')==='track' && read(t,'ride')===ride.id && read(t,'trackType')===type && read(t,'sequence')===0 &&
                    read(t,'direction')===(p.direction&3) && read(t,'baseZ')===p.z+offset.z && read(t,'isGhost')!==true) matches.push({element:t,index:index});
            });
            var chain=matches.length===1 ? read(matches[0].element,'hasChainLift') : undefined;
            if(typeof chain!=='boolean') { missing('chain flag at segment '+i); metadataComplete=false; chain=null; }
            var piece={index:pieces.length,type:type,name:native.name,position:p,beginZ:p.z+beginZ,endZ:p.z+endZ,
                chain:chain,banked:native.flags.isBanked || native.beginBank===data.trackRolls.left || native.beginBank===data.trackRolls.right || native.endBank===data.trackRolls.left || native.endBank===data.trackRolls.right,
                bankedTurn:read(live,'isBankedTurn')===true,group:native.trackGroup,beginSlope:native.beginSlope,endSlope:native.endSlope,
                length:count(read(live,'length'),2147483647),element:matches.length===1?{x:tx,y:ty,elementIndex:matches[0].index}:null};
            pieces.push(piece);
            if(groupIn(piece.group,['blockBrakes','diagBlockBrakes'])) result.track.observedCounts.blockBrakes++;
            else if(groupIn(piece.group,['brakes','diagBrakes','inclinedBrakes'])) result.track.observedCounts.ordinaryBrakes++;
            if(groupIn(piece.group,['onridePhoto'])) result.track.observedCounts.photo++;
            try { if(!iterator.next()) { reason='gap or end of track'; break; } }
            catch(ex) { reason='iterator unavailable'; metadataComplete=false; missing('native iterator advance'); break; }
            // Check closure even when a circuit has exactly limit pieces.
            var next=position(read(iterator,'position')), nextType=read(read(iterator,'segment'),'type');
            if(next && key(next,nextType)===first) { closed=true; reason='circuit'; break; }
        }
        result.track.closed=closed; result.track.reason=reason; result.track.segmentsChecked=pieces.length;
        result.truncated=reason==='traversal limit';
        result.complete=closed && metadataComplete;
        // A second station outside this circuit means the result is only partial.
        stationStarts.forEach(function(s){if(!pieces.some(function(piece){return piece.position.x===s.x && piece.position.y===s.y && piece.position.z===s.z;})){missing('station '+s.station+' is outside inspected circuit'); result.complete=false;}});
        if(result.complete) result.track.counts={ordinaryBrakes:result.track.observedCounts.ordinaryBrakes,blockBrakes:result.track.observedCounts.blockBrakes,photo:result.track.observedCounts.photo};
        var ordinary=function(piece){return groupIn(piece.group,['brakes','diagBrakes','inclinedBrakes']);};
        // Merge a run across the circuit boundary by starting after a non-brake.
        var order=pieces.slice(), firstNon=pieces.findIndex(function(piece){return !ordinary(piece);});
        if(closed && firstNon>=0) order=pieces.slice(firstNon).concat(pieces.slice(0,firstNon));
        var run=null;
        order.forEach(function(piece){
            if(!ordinary(piece)) { run=null; return; }
            if(!run) { run={start:ref(piece),end:ref(piece),pieces:0,nativeLength:0}; if(result.track.ordinaryBrakeRuns.length<32) result.track.ordinaryBrakeRuns.push(run); else {result.truncated=true;return;} }
            run.pieces++; run.end=ref(piece); run.nativeLength=run.nativeLength===null || piece.length===null ? null : run.nativeLength+piece.length;
        });
        var pitch=data.trackPitches, flat=pitch.none, up=[pitch.up25,pitch.up60,pitch.up90];
        pieces.forEach(function(piece,index){
            if(piece.chain!==true || piece.endZ<piece.beginZ || (piece.endSlope!==flat && up.indexOf(piece.endSlope)<0)) return;
            var nextIndex=index+1; if(nextIndex===pieces.length && closed) nextIndex=0;
            if(!pieces[nextIndex] || pieces[nextIndex].chain!==false) return;
            // A native chain often continues through the up-to-flat crest and
            // a few level tiles. Require a real ascent in this same chain run.
            var ascent=false;
            for(var back=0;back<24 && back<pieces.length;back++) {
                var prior=index-back; if(prior<0){if(!closed)break;prior=(prior+pieces.length)%pieces.length;}
                var lift=pieces[prior];
                if(lift.chain!==true || lift.endZ<lift.beginZ) break;
                if(lift.endZ>lift.beginZ && (up.indexOf(lift.beginSlope)>=0 || up.indexOf(lift.endSlope)>=0)) {ascent=true;break;}
            }
            if(!ascent) return;
            var banked=[], turns=0, crest=piece.endSlope===flat?ref(piece):null, scanned=0;
            for(var n=0;n<24 && n<pieces.length;n++) {
                var j=index+1+n; if(j>=pieces.length) {if(!closed)break;j%=pieces.length;}
                var after=pieces[j];
                if(after.chain!==false || after.endZ<after.beginZ || groupIn(after.group,['booster','diagBooster','poweredLift','liftHillCable','brakes','diagBrakes','inclinedBrakes','blockBrakes','diagBlockBrakes','stationEnd'])) break;
                if(after.endSlope!==flat && up.indexOf(after.endSlope)<0) break;
                if(crest!==null && (after.beginSlope!==flat || after.endSlope!==flat || after.endZ!==after.beginZ)) break;
                scanned++; if(after.endSlope===flat && crest===null) crest=ref(after);
                if(after.banked) banked.push(ref(after));
                if(after.bankedTurn) turns++;
            }
            if(crest && banked.length && turns>0) {
                if(result.track.liftCrestBanking.length>=32) {result.truncated=true;return;}
                var finding={lastChain:ref(piece),crest:crest,bankedPieces:banked,bankedTurns:turns,segmentsBeforeDropOrAcceleration:scanned,liftHillSpeed:operation.liftHillSpeed};
                result.track.liftCrestBanking.push(finding);
                add('lift_crest_banking_review','Banked turns follow the chain-lift crest before any intervening drop or powered acceleration. Review whether this banking and its length serve the design at the actual crest speed.',finding);
            }
        });
        if(result.complete && operation.rideTimeSeconds>=90 && operation.configuredTrains===1 && result.track.counts.blockBrakes===0 &&
            operation.blockTrackSupported && operation.supportedBlockModes && operation.supportedBlockModes.length && operation.mode===modes.continuousCircuit) {
            add('single_train_long_circuit_review','A long circuit is running one train with no block brakes. Review a block-section design and useful multi-train capacity; ordinary brakes do not create blocks.',
                {rideTimeSeconds:operation.rideTimeSeconds,configuredTrains:1,blockBrakes:0,ordinaryBrakes:result.track.counts.ordinaryBrakes,
                    ordinaryBrakeRuns:result.track.ordinaryBrakeRuns,supportedBlockModes:operation.supportedBlockModes});
        }
        result.status=!result.complete || result.truncated ? 'unknown' : observations.length?'review':'ok';
        return result;
    }
    return {inspect:inspect};
})();
if(typeof module!=='undefined') module.exports=BridgeRideAuditor;
