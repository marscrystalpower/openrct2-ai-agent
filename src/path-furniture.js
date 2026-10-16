/* SPDX-License-Identifier: GPL-3.0-only */
var BridgePathFurniture = (function () {
    'use strict';
    // Pinned API 124: addition is null or a zero-based object index 0..254.
    // PathAdditionFlag uses bit positions 0 bin, 1 bench, 3 lamp. Names and
    // load-slot numbers never establish an item's behavior.
    var MAX_ITEMS=512,MAX_WARNINGS=256,MAX_UNAVAILABLE=128;
    function integer(n,min,max){return Number.isSafeInteger(n)&&n>=min&&n<=max;}
    function error(e){return String(e&&e.message||e).slice(0,160);}
    function create(options){
        options=options||{};
        var catalog=Object.create(null),objects=Object.create(null),manager=options.objectManager,metadata=options.metadata||{};
        (Array.isArray(metadata.objects)?metadata.objects:[]).forEach(function(o){
            if(o&&typeof o.identifier==='string'&&integer(o.flags,0,65535))catalog[o.identifier]=o;
        });
        function loaded(index){
            if(Object.prototype.hasOwnProperty.call(objects,index))return objects[index];
            var object=null,reason=null;
            try{
                if(!manager||typeof manager.getObject!=='function')reason='Path addition object catalog unavailable';
                else{
                    object=manager.getObject('footpath_addition',index);
                    if(!object||object.index!==index||object.type!=='footpath_addition'){object=null;reason='Path addition object '+index+' is not loaded';}
                }
            }catch(e){reason='Path addition object '+index+': '+error(e);}
            return objects[index]={object:object,reason:reason};
        }
        function read(element,path){
            var unavailable=[],out={present:null,index:null,kind:null,kinds:[],identifier:null,name:null,objectLoaded:null,
                classificationSource:null,isGhost:null,isBroken:null,isFull:null,rawStatus:null,usable:null,binSlots:null,complete:true,unavailable:unavailable};
            function missing(label){out.complete=false;if(unavailable.indexOf(label)<0)unavailable.push(label);}
            function prop(name){try{var value=element[name];if(value!==undefined)return value;}catch(e){missing(name+': '+error(e));return undefined;}missing(name+' unavailable');}
            var index=prop('addition');
            if(index===null){out.present=false;out.objectLoaded=null;out.usable=false;return out;}
            if(!integer(index,0,254)){missing('addition must be null or an object index from 0 to 254');return out;}
            out.present=true;out.index=index;
            var ghost=prop('isAdditionGhost');if(typeof ghost!=='boolean')missing('isAdditionGhost must be boolean for a placed addition');else out.isGhost=ghost;
            // A preview does not supply guest amenities or a vandalism problem.
            // Its object definition and unused condition fields need not load.
            if(out.isGhost===true){out.usable=false;return out;}
            var broken=prop('isAdditionBroken');if(typeof broken!=='boolean')missing('isAdditionBroken must be boolean for a placed addition');else out.isBroken=broken;
            var status=prop('additionStatus');
            if(status===null&&path.isQueue===true)out.rawStatus=null;
            else if(integer(status,0,255))out.rawStatus=status;
            else missing('additionStatus unavailable or invalid');
            var full=prop('isAdditionFull');
            if(typeof full==='boolean'||full===null)out.isFull=full;else missing('isAdditionFull must be boolean or null');
            var entry=loaded(index),object=entry.object,flags=null;
            out.objectLoaded=!!object;if(entry.reason)missing(entry.reason);
            if(object){
                try{
                    out.identifier=typeof object.identifier==='string'?object.identifier:null;
                    out.name=typeof object.name==='string'?object.name.slice(0,160):null;
                    // A future native getter may expose flags. API 124 normally
                    // requires a source-verified identifier catalog instead.
                    if(integer(object.flags,0,65535)){flags=object.flags;out.classificationSource='native_object_flags';}
                    else if(out.identifier&&catalog[out.identifier]){flags=catalog[out.identifier].flags;out.classificationSource=metadata.classificationSource||'object_identifier_metadata';}
                }catch(e){missing('Path addition object metadata: '+error(e));}
            }
            if(flags!==null){
                if(flags&1)out.kinds.push('bin');if(flags&2)out.kinds.push('bench');if(flags&8)out.kinds.push('lamp');
                out.kind=out.kinds.length===1?out.kinds[0]:out.kinds.length?'multiple':'other';
            }else if(typeof full==='boolean'&&object){
                // ScTileElement::isAdditionFull checks the loaded object's
                // native isBin flag before returning a boolean.
                out.kind='bin';out.kinds=['bin'];out.classificationSource='native_bin_property';
                // This proves bin behavior, but not absence of additional
                // custom bench/lamp flags. Keep negative coverage conservative.
                missing('Additional behavior flags for this custom native bin are unavailable');
            }else missing('Path addition behavior metadata unavailable');
            if(typeof full==='boolean'&&object&&out.kinds.indexOf('bin')<0){
                // An identifier can be overridden by custom content. The
                // native bin getter wins; never certify a reference bench when
                // the actual loaded object is a bin.
                missing('Reference behavior metadata disagrees with the native bin property');
                out.kind='bin';out.kinds=['bin'];out.classificationSource='native_bin_property';
            }
            if(out.kinds.indexOf('bin')>=0&&path.isQueue===false){
                if(typeof full!=='boolean')missing('Native bin fullness unavailable');
                if(out.rawStatus!==null&&integer(path.edges,0,15)){
                    out.binSlots=[];
                    for(var d=0;d<4;d++)if(!(path.edges&(1<<d)))out.binSlots.push({direction:d,spaceLeft:(out.rawStatus>>(d*2))&3,isFull:((out.rawStatus>>(d*2))&3)===0});
                    var derived=out.binSlots.some(function(slot){return slot.isFull;});
                    if(typeof full==='boolean'&&derived!==full)missing('Native bin fullness disagrees with exposed edge slots');
                }else missing('Bin edge slots unavailable');
            }
            if(out.isGhost===true)out.usable=false;
            else if(out.isGhost===false&&out.isBroken===true)out.usable=false;
            else if(out.objectLoaded&&out.isGhost===false&&out.isBroken===false&&out.kind!==null){
                var sides=integer(path.edges,0,15)?(path.edges^15):null;
                // Guests use only non-joining path sides for benches and bins;
                // benches also need a level public path. Occupancy is dynamic.
                out.usable=out.kinds.indexOf('bench')>=0?(path.isQueue===false&&path.slopeDirection===null&&sides!==null&&sides!==0):
                    out.kinds.indexOf('bin')>=0?(path.isQueue===true||sides===0?false:path.isQueue===false&&sides!==null&&out.binSlots!==null?out.binSlots.some(function(s){return !s.isFull;}):null):true;
            }
            return out;
        }
        function summarize(paths,scope){
            scope=scope||{};
            var complete=scope.complete!==false,unavailable=[],unavailableSet=Object.create(null),items=[],warnings=[],observations=[],warningCount=0,itemCount=0;
            var summary={paths:paths.length,additions:0,ghostAdditions:0,benches:0,bins:0,lamps:0,other:0,unknown:0,broken:0,fullBins:0,usableBenches:0,usableBins:0,
                coveredPublicPaths:0,publicBenches:0,publicBins:0,usablePublicBenches:0,usablePublicBins:0};
            var publicKnown=scope.complete!==false&&scope.coverageComplete!==false,publicEligible=0;
            function unavailableAt(label){complete=false;if(!unavailableSet[label]){unavailableSet[label]=true;if(unavailable.length<MAX_UNAVAILABLE)unavailable.push(label);}}
            function warn(value){warningCount++;if(warnings.length<MAX_WARNINGS)warnings.push(value);}
            paths.forEach(function(p){
                var f=p.furniture,isPublic=scope.publicKeys?!!scope.publicKeys[p.key]:false;
                if(isPublic){summary.coveredPublicPaths++;if(p.isQueue===false&&integer(p.edges,0,15)&&(p.edges^15)!==0)publicEligible++;}
                if(!f){summary.unknown++;unavailableAt(p.key+': furniture inspection unavailable');if(isPublic)publicKnown=false;return;}
                if(!f.complete){f.unavailable.forEach(function(v){unavailableAt(p.key+': '+v);});if(isPublic&&f.isGhost!==true)publicKnown=false;}
                if(f.present===null){summary.unknown++;return;}
                if(f.present===false)return;
                if(f.isGhost===true){summary.ghostAdditions++;return;}
                summary.additions++;itemCount++;
                var item={key:p.key,x:p.x,y:p.y,elementIndex:p.elementIndex,baseZ:p.baseZ,isQueue:p.isQueue,publicNetwork:isPublic,furniture:f};
                if(items.length<MAX_ITEMS)items.push(item);
                if(!f.complete||f.isGhost!==false||!f.objectLoaded||f.kind===null){summary.unknown++;if(isPublic)publicKnown=false;}
                if(f.isGhost===false&&f.objectLoaded&&f.kind==='other')summary.other++;
                else if(f.isGhost===false&&f.objectLoaded)f.kinds.forEach(function(k){summary[k==='bench'?'benches':k==='bin'?'bins':'lamps']++;if(isPublic&&k==='bench')summary.publicBenches++;if(isPublic&&k==='bin')summary.publicBins++;});
                if(f.isGhost===false&&f.isBroken===true){summary.broken++;warn({code:'broken_path_furniture',severity:'warning',path:p.key,x:p.x,y:p.y,kind:f.kind,index:f.index,message:'Placed '+(f.kind||'path furniture')+' at ('+p.x+','+p.y+') is marked broken by the game.'});}
                if(f.isGhost===false&&f.objectLoaded&&f.kinds.indexOf('bin')>=0&&f.isFull===true){summary.fullBins++;warn({code:'full_litter_bin',severity:'warning',path:p.key,x:p.x,y:p.y,kind:'bin',index:f.index,message:'A litter-bin slot at ('+p.x+','+p.y+') is full. Emptying is separate from repairing vandalism.'});}
                if(f.usable===true&&f.kinds.indexOf('bench')>=0){summary.usableBenches++;if(isPublic)summary.usablePublicBenches++;}
                if(f.usable===true&&f.kinds.indexOf('bin')>=0){summary.usableBins++;if(isPublic)summary.usablePublicBins++;}
            });
            if(scope.complete===false)unavailableAt('Path scan incomplete');
            if(scope.coverageComplete===false)unavailableAt('Public path coverage unavailable or incomplete');
            if(scope.publicKeys&&publicKnown&&publicEligible>0){
                if(summary.usablePublicBenches===0)observations.push({code:'no_usable_benches',severity:'advisory',message:'No usable benches were found on the audited public path network. Provide rest areas, particularly near nauseating ride exits; placement coverage and occupied seats still require review.'});
                if(summary.usablePublicBins===0)observations.push({code:'no_usable_litter_bins',severity:'advisory',message:'No usable litter bins were found on the audited public path network. Provide bins where guests carry food, drinks and litter; this inventory does not establish good spacing.'});
            }
            return {status:warningCount?'problems':!complete?'unknown':observations.length?'advisories':'ok',complete:complete,scope:scope.name||'inspected_rectangle',
                summary:summary,items:items,itemsOmitted:Math.max(0,itemCount-items.length),warnings:warnings,warningCount:warningCount,warningsOmitted:warningCount-warnings.length,
                observations:observations,unavailable:unavailable,truncated:itemCount>MAX_ITEMS||warningCount>MAX_WARNINGS||Object.keys(unavailableSet).length>MAX_UNAVAILABLE,
                limits:{maxItems:MAX_ITEMS,maxWarnings:MAX_WARNINGS,maxUnavailable:MAX_UNAVAILABLE},
                coverage:{publicNetworkKnown:!!scope.publicKeys&&publicKnown,eligiblePublicPathTiles:publicEligible,spacingAssessed:false,seatOccupancyAssessed:false},
                classification:{source:metadata.classificationSource||null,sourceCommit:metadata.sourceCommit||null,identifierOverridesVerified:false},
                notes:['Inventory and native item condition are separate from path connectivity. Ghost additions are excluded.',
                    'Bin status has four 2-bit slots: 3 is empty and 0 is full. Only sides without joining path edges have usable slots.',
                    'Missing furniture is advisory. Counts do not prove good spacing, sufficient seats, guest recovery or absence of litter. Unknown custom objects are not classified by name.',
                    'Standard object classification uses reference identifiers. A custom object that overrides a standard identifier may behave differently; native bin and condition getters remain authoritative.']};
        }
        return {read:read,summarize:summarize};
    }
    return {create:create};
})();
if(typeof module!=='undefined')module.exports=BridgePathFurniture;
