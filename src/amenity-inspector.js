/* SPDX-License-Identifier: GPL-3.0-only */
var BridgeAmenityInspector = (function () {
    'use strict';
    // These are design recommendations, not engine nausea probabilities or
    // assertions that any particular guest will vomit or occupy a seat.
    var HARD={maxPaths:32768,maxEndpoints:4096,maxSites:512,maxSearchWork:65536,maxCandidatesPerKind:24,maxFurniturePerKind:64,maxObservations:1024};
    function dict(){return Object.create(null);}
    function integer(n,min,max){return Number.isSafeInteger(n)&&n>=min&&n<=max;}
    function read(o,k){try{return o==null?undefined:o[k];}catch(e){return undefined;}}
    function benchTarget(n){return n===null?null:n<250?0:n<400?2:n<600?3:n<800?5:7;}
    function create(input,options){
        input=input||{};options=options||{};
        var limits={},paths=Array.isArray(input.paths)?input.paths:[],endpoints=Array.isArray(input.endpoints)?input.endpoints:[];
        Object.keys(HARD).forEach(function(k){var n=options[k]===undefined?HARD[k]:options[k];if(!integer(n,1,HARD[k]))throw Error(k+' must be an integer from 1 to '+HARD[k]);limits[k]=n;});
        var nodes=dict(),publicBoth=input.publicBoth||dict(),publicOut=input.publicOut||dict(),rides=input.rideById||dict(),support=input.pricingSupport||{},sites=[],observations=[],unavailable=[],unavailableSet=dict(),usage={benches:dict(),bins:dict()};
        var phase='index',done=false,pathCursor=0,endpointCursor=0,sharingCursor=0,searchWork=0,active=null,truncated=false,graphComplete=false,complete=input.complete===true&&input.truncated!==true;
        var summary={sites:0,rideExits:0,foodDrinkShops:0,unknownShops:0,sitesWithShortfalls:0,sitesWithSpacingIssues:0,advisorySites:0,unknownSites:0,shortfallObservations:0,spacingObservations:0,sharedBenchPaths:0,sharedBinPaths:0};
        function missing(label,cap){complete=false;if(cap)truncated=true;if(!unavailableSet[label]){unavailableSet[label]=true;if(unavailable.length<128)unavailable.push(label);}}
        if(input.complete!==true||input.truncated===true)missing('Underlying path/access scan is incomplete',input.truncated===true);
        if(!Array.isArray(input.paths)||!Array.isArray(input.endpoints))missing('Frozen public path graph or endpoints unavailable');
        if(paths.length>limits.maxPaths)missing('Local amenity graph exceeds '+limits.maxPaths+' paths',true);
        if(endpoints.length>limits.maxEndpoints)missing('Local amenity endpoint list exceeds '+limits.maxEndpoints+' endpoints',true);
        function networkKnown(value){return !!value&&typeof value==='object'&&!Array.isArray(value);}
        function eligible(p,site){var network=site.routePolicy==='outbound_to_park'?publicOut:publicBoth;return p&&p.isQueue===false&&network[p.key]===true;}
        function point(p,d){return {key:p.key,x:p.x,y:p.y,elementIndex:p.elementIndex===undefined?null:p.elementIndex,baseZ:p.baseZ===undefined?p.z:p.baseZ,distance:d};}
        function itemClass(r){
            var object=read(r,'object'),items=Array.isArray(support.items)?support.items:null,none=read(support.constants,'noneItem'),unknown=false,food=false,drink=false,itemIds=[];
            if(!object||!items||!integer(none,0,65535))return {known:false,isFood:false,isDrink:false,items:[]};
            ['shopItem','shopItemSecondary'].forEach(function(k){
                var id=read(object,k);if(!integer(id,0,65535)){unknown=true;return;}if(id===none)return;
                var item=items[id];if(!item||item.id!==id||typeof item.isFood!=='boolean'||typeof item.isDrink!=='boolean'||typeof item.isContainer!=='boolean'){unknown=true;return;}
                if(!item.isContainer&&(item.isFood||item.isDrink)){food=food||item.isFood;drink=drink||item.isDrink;itemIds.push(id);}
            });
            return {known:!unknown||food||drink,isFood:food,isDrink:drink,items:itemIds};
        }
        function buildSite(ep){
            if(!ep||['ride_exit','shop'].indexOf(ep.kind)<0)return;
            var r=rides[ep.ride],classification=null,isExit=ep.kind==='ride_exit';
            if(!isExit){classification=itemClass(r);if(classification.known&&!classification.isFood&&!classification.isDrink)return;}
            if(sites.length>=limits.maxSites){missing('Local amenity audit exceeds '+limits.maxSites+' sites',true);return;}
            // API 124 exposes the signed native int16 hundredths rating. The
            // undefined sentinel is -1; unsigned reinterpretations are invalid.
            var n=read(r,'nausea');n=integer(n,0,32767)?n:null;
            var site={key:ep.key,kind:isExit?'ride_exit':classification.known?'food_drink_shop':'shop_unknown',routePolicy:isExit?'outbound_to_park':'round_trip_public',ride:ep.ride,name:ep.name||(r&&r.name)||'Ride '+ep.ride,rideStatus:ep.rideStatus||(r&&r.status)||null,station:ep.station===undefined?null:ep.station,
                x:ep.x,y:ep.y,baseZ:ep.baseZ===undefined?null:ep.baseZ,nausea:isExit?n:null,nauseaDisplay:isExit&&n!==null?(n/100).toFixed(2):null,
                targets:{benches:isExit?benchTarget(n):classification.known?3:null,bins:isExit?1:classification.known?2:null},radii:{benches:isExit?10:8,bins:isExit?6:10},
                maximumFirstDistance:{benches:isExit?(n===null?null:n<250?null:n>=600?3:4):classification.known?4:null,bins:isExit?6:classification.known?4:null},nearest:{benches:null,bins:null},spacing:{benches:'unknown',bins:'unknown'},
                counts:{usableBenches:0,usableBins:0,unknownBenches:0,unknownBins:0,visitedPaths:0},deficits:{benches:null,bins:null},
                furniture:{benches:[],bins:[]},furnitureOmitted:{benches:0,bins:0},candidates:{benches:[],bins:[]},candidatesOmitted:{benches:0,bins:0},
                status:'checking',complete:false,unavailable:[],search:{radius:10,distanceOrigin:'Door-connected public path tile is distance zero',complete:false,work:0}};
            if(classification)site.shopItems=classification.items;
            if(isExit&&n===null)site.unavailable.push('Native nausea rating unavailable; bench need is unknown');
            if(!isExit&&!classification.known)site.unavailable.push('Native food/drink item classification unavailable');
            if(!networkKnown(isExit?input.publicOut:input.publicBoth))site.unavailable.push(isExit?'Verified outward-to-park path coverage unavailable':'Verified round-trip public path coverage unavailable');
            var starts=[],seen=dict(),checks=Array.isArray(ep.doorChecks)?ep.doorChecks:[];
            if(checks.length>64)site.unavailable.push('Doorway list exceeds 64 doors');
            for(var i=0;i<Math.min(checks.length,64);i++){
                var links=Array.isArray(checks[i].connections)?checks[i].connections:[];
                if(links.length>4||checks[i].connectionsTruncated)site.unavailable.push('Doorway path connections are incomplete');
                for(var j=0;j<Math.min(links.length,4);j++)if(!seen[links[j]]&&eligible(nodes[links[j]],site)){seen[links[j]]=true;starts.push({key:links[j],distance:0});}
            }
            if(!starts.length)site.unavailable.push(isExit?'No door-connected public path has verified outward access to a park gate':'No door-connected path belongs to the verified round-trip public network');
            sites.push(site);summary.sites++;if(isExit)summary.rideExits++;else if(classification.known)summary.foodDrinkShops++;else summary.unknownShops++;
            active={site:site,queue:starts,head:0,seen:seen,unknownWithinFirst:{benches:0,bins:0},complete:graphComplete&&site.unavailable.filter(function(v){return v.indexOf('nausea')<0&&v.indexOf('classification')<0;}).length===0};
        }
        function noteFurniture(site,p,d,kind){
            var name=kind==='benches'?'bench':'bin',counter=kind==='benches'?'usableBenches':'usableBins',unknown=kind==='benches'?'unknownBenches':'unknownBins',f=p.furniture;
            if(d>site.radii[kind])return;
            if(f&&f.present===false)return;
            if(f&&(f.isGhost===true||f.isBroken===true))return;
            var kinds=f&&Array.isArray(f.kinds)?f.kinds:[],isKind=kinds.indexOf(name)>=0,hasSides=integer(p.edges,0,15)&&(p.edges^15)!==0;
            var binSlotsUnknown=kind==='bins'&&isKind&&(!Array.isArray(f.binSlots)||f.binSlots.some(function(slot){return !slot||typeof slot.isFull!=='boolean';}));
            var usable=!!f&&f.present===true&&f.objectLoaded===true&&f.isGhost===false&&f.isBroken===false&&f.usable===true&&isKind&&hasSides;
            if(kind==='benches'&&p.slopeDirection!==null)usable=false;
            if(kind==='bins'&&(binSlotsUnknown||f&&Array.isArray(f.binSlots)&&!f.binSlots.some(function(slot){return slot&&slot.isFull===false;})))usable=false;
            if(usable){
                site.counts[counter]++;var out=point(p,d);out.sharedWithOtherSites=0;
                if(site.nearest[kind]===null||d<site.nearest[kind])site.nearest[kind]=d;
                if(site.furniture[kind].length<limits.maxFurniturePerKind)site.furniture[kind].push(out);else site.furnitureOmitted[kind]++;
                if(!usage[kind][p.key])usage[kind][p.key]=[];usage[kind][p.key].push(site.key);
                if(usage[kind][p.key].length===2)summary[kind==='benches'?'sharedBenchPaths':'sharedBinPaths']++;
            }else if(!f||f.present===null||f.present===undefined||f.objectLoaded!==true||f.isGhost!==false||f.isBroken!==false||f.complete!==true||!Array.isArray(f.kinds)||binSlotsUnknown||isKind&&typeof f.usable!=='boolean'){
                site.counts[unknown]++;if(site.maximumFirstDistance[kind]!==null&&d<=site.maximumFirstDistance[kind])active.unknownWithinFirst[kind]++;
            }
        }
        function candidates(site,p,d){
            // A location is only a candidate: normal native placement queries,
            // object restrictions, ownership and clearance remain authoritative.
            if(p.isQueue!==false||p.slopeDirection!==null||!integer(p.edges,0,15)||(p.edges^15)===0||p.isBlockedByVehicle===true||!p.furniture||p.furniture.present!==false||p.furniture.complete!==true)return;
            ['benches','bins'].forEach(function(kind){if(d>site.radii[kind]||site.targets[kind]===0)return;var out=point(p,d);out.availableSides=(p.edges^15);out.requiresNativePlacementQuery=true;if(site.candidates[kind].length<limits.maxCandidatesPerKind)site.candidates[kind].push(out);else site.candidatesOmitted[kind]++;});
        }
        function visit(){
            var a=active,site=a.site;
            if(a.head>=a.queue.length){finishSite();return;}
            if(searchWork>=limits.maxSearchWork){a.complete=false;site.unavailable.push('Global local-path search budget exhausted');missing('Local amenity search exceeds '+limits.maxSearchWork+' path visits',true);finishSite();return;}
            var entry=a.queue[a.head++],p=nodes[entry.key];searchWork++;site.search.work++;site.counts.visitedPaths++;
            if(!eligible(p,site)){a.complete=false;return;}
            noteFurniture(site,p,entry.distance,'benches');noteFurniture(site,p,entry.distance,'bins');candidates(site,p,entry.distance);
            if(p.nativeAvailable!==true||!Array.isArray(p.next)||p.next.length>4){a.complete=false;if(site.unavailable.indexOf('Native directed path links unavailable')<0)site.unavailable.push('Native directed path links unavailable');return;}
            if(entry.distance>=site.search.radius)return;
            for(var i=0;i<p.next.length;i++){
                var k=p.next[i],target=nodes[k];if(!target){a.complete=false;if(site.unavailable.indexOf('Native path target missing from frozen graph')<0)site.unavailable.push('Native path target missing from frozen graph');continue;}
                if(eligible(target,site)&&!a.seen[k]){a.seen[k]=true;a.queue.push({key:k,distance:entry.distance+1});}
            }
        }
        function observe(value){if(/_shortfall$/.test(value.code))summary.shortfallObservations++;else summary.spacingObservations++;if(observations.length<limits.maxObservations)observations.push(value);else missing('Local amenity observations exceed '+limits.maxObservations+' entries',true);}
        function finishSite(){
            var site=active.site,localComplete=active.complete;
            site.search.complete=localComplete;
            ['benches','bins'].forEach(function(kind){
                var count=site.counts[kind==='benches'?'usableBenches':'usableBins'],unknown=site.counts[kind==='benches'?'unknownBenches':'unknownBins'],target=site.targets[kind];
                // Known sufficient supply is useful even in incomplete metadata;
                // missing supply is asserted only after a complete local search.
                site.deficits[kind]=target===null?null:count>=target?0:localComplete&&unknown===0?target-count:null;
                if(site.deficits[kind]>0)observe({code:kind==='benches'?'local_bench_shortfall':'local_bin_shortfall',severity:site.rideStatus==='open'?'advisory':'info',site:site.key,kind:site.kind,ride:site.ride,name:site.name,station:site.station,
                    count:count,recommended:target,shortfall:site.deficits[kind],radius:site.radii[kind],nausea:site.nausea,
                    message:site.name+': '+count+' usable '+kind+' within '+site.radii[kind]+' connected path steps; this local design policy recommends '+target+'.'});
                var first=site.maximumFirstDistance[kind],nearest=site.nearest[kind];
                site.spacing[kind]=target===0?'not_required':first===null?'unknown':nearest!==null&&nearest<=first?'ok':localComplete&&active.unknownWithinFirst[kind]===0?'too_far':'unknown';
                if(site.spacing[kind]==='too_far'&&nearest!==null)observe({code:kind==='benches'?'local_bench_spacing':'local_bin_spacing',severity:site.rideStatus==='open'?'advisory':'info',site:site.key,kind:site.kind,ride:site.ride,name:site.name,station:site.station,
                    nearestDistance:nearest,recommendedMaximum:first,nausea:site.nausea,message:site.name+': the nearest usable '+(kind==='benches'?'bench':'bin')+' is '+nearest+' connected path steps away; this local design policy recommends one within '+first+'.'});
            });
            var shortfall=site.deficits.benches>0||site.deficits.bins>0,spacing=site.spacing.benches==='too_far'||site.spacing.bins==='too_far',unknown=site.deficits.benches===null||site.deficits.bins===null||site.spacing.benches==='unknown'||site.spacing.bins==='unknown'||!localComplete;
            site.complete=localComplete&&!unknown;site.status=unknown?'unknown':shortfall||spacing?'advisories':'ok';
            if(shortfall)summary.sitesWithShortfalls++;
            if(spacing)summary.sitesWithSpacingIssues++;
            if(shortfall||spacing)summary.advisorySites++;
            if(unknown){summary.unknownSites++;complete=false;if(observations.length<limits.maxObservations)observations.push({code:'local_amenities_unknown',severity:'info',site:site.key,kind:site.kind,ride:site.ride,name:site.name,
                message:site.name+': local amenity coverage or demand is partly unknown; incomplete data does not establish missing furniture.'});else missing('Local amenity observations exceed '+limits.maxObservations+' entries',true);}
            active=null;
        }
        function shareSite(site){
            ['benches','bins'].forEach(function(kind){site.furniture[kind].forEach(function(item){item.sharedWithOtherSites=Math.max(0,usage[kind][item.key].length-1);});});
        }
        function finish(){
            if(summary.unknownSites)missing('Some site demand or local furniture classification is unknown');
            done=true;phase='done';
        }
        function step(workUnits){
            if(workUnits===undefined)workUnits=256;if(!integer(workUnits,1,4096))throw Error('workUnits must be an integer from 1 to 4096');
            for(var unit=0;unit<workUnits&&!done;unit++){
                if(phase==='index'){
                    if(pathCursor>=Math.min(paths.length,limits.maxPaths)){graphComplete=complete;phase='sites';continue;}
                    var p=paths[pathCursor++];if(p&&typeof p.key==='string'){if(nodes[p.key])missing('Duplicate frozen path key '+p.key);else nodes[p.key]=p;}else missing('Frozen path key unavailable');
                }else if(phase==='sites'){
                    if(active){visit();continue;}
                    if(endpointCursor>=Math.min(endpoints.length,limits.maxEndpoints)){phase='sharing';continue;}
                    buildSite(endpoints[endpointCursor++]);
                }else if(phase==='sharing'){
                    if(sharingCursor>=sites.length){finish();continue;}
                    shareSite(sites[sharingCursor++]);
                }
            }
            return done;
        }
        function result(){return {status:!done?'checking':!complete?'unknown':summary.advisorySites?'advisories':'ok',complete:done&&complete,truncated:truncated,summary:summary,sites:sites,observations:observations,unavailable:unavailable,limits:limits,
            progress:{phase:phase,done:done,pathsIndexed:pathCursor,endpointsChecked:endpointCursor,searchWork:searchWork,sitesChecked:sites.length-(active?1:0)},
            policy:{basis:'User-requested local amenity design heuristics; not native seat demand or vomit probabilities',countUnits:'Usable bench-equipped or bin-equipped path tiles, not seats',nauseaUnits:'Native integer hundredths',benchThreshold:250,rideExitBenchTargets:[{minimumNausea:250,target:2},{minimumNausea:400,target:3},{minimumNausea:600,target:5},{minimumNausea:800,target:7}],
                rideExitBinTarget:1,foodDrinkBenchTarget:3,foodDrinkBinTarget:2,rideExitBenchRadius:10,rideExitBinRadius:6,foodDrinkBenchRadius:8,foodDrinkBinRadius:10,firstBenchWithin:4,firstBenchWithinAtNausea600:3,foodDrinkFirstBenchAndBinWithin:4,rideExitRoutePolicy:'outbound_to_park',shopRoutePolicy:'round_trip_public'},
            notes:['Distances follow directed native public path connections from the actual exit or shop doorway, including elevation and one-way restrictions. Ride exits use paths with outward access to a park gate, including valid one-way exit corridors protected by no-entry signs. Shops use round-trip public paths. Missing route coverage stays unknown; one network is never substituted for the other.',
                'Queues and paths without the endpoint-specific verified park-gate access do not supply public amenities. Directed native links are followed only away from the exit or shop door; a forbidden reverse journey is never invented.',
                'Only working, usable furniture counts. Broken items, ghost previews, fully unusable bins and benches without level usable sides do not count. Unknown custom behavior cannot establish a shortfall.',
                'The same furniture can serve adjacent exits and shops. Site recommendations are not additive construction orders; choose shared rest areas and distribute additions across useful free path sides.',
                'Candidate tiles are not placement approvals. Check normal native construction rules and preserve existing furniture before placing anything. Each path addition slot supports one item.',
                'Native guests look for seating on their next path tile; they do not follow this audit search to a distant bench. Counts and first-item distance are spacing heuristics, not guaranteed recovery routes.',
                'Seat occupancy, guest volume, current guest nausea, litter generation and recovery time are not measured. Local targets and radii are review guidance, not guarantees.']};}
        return {step:step,result:result,get done(){return done;}};
    }
    return {create:create};
})();
if(typeof module!=='undefined')module.exports=BridgeAmenityInspector;
