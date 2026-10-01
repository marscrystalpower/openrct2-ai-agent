/* SPDX-License-Identifier: GPL-3.0-only */
// Normal construction rules from the pinned engine, independent of cheat state.
var BridgeTrackGuard = (function () {
    'use strict';
    function create(C, data, context, objectManager) {
        function fail(message) { throw new Error(message); }
        function unavailable(detail) { fail('Cannot verify normal track support: '+detail+'. Use the pinned OpenRCT2 v0.5.5 / API 122 and inspect track.catalog for the ride before retrying'); }
        function descriptor(type) {
            if (context.apiVersion !== 122) unavailable('API version is not 122');
            C.integer(type,'rideType',0,data.rideTypes.length-1);
            var rtd=data.rideTypes[type];
            if (!rtd || rtd.flags.isDummyType) unavailable('unknown or dummy ride type '+type);
            return rtd;
        }
        function segment(type) {
            C.integer(type,'trackType',0,data.segments.length-1);
            var known=data.segments[type], live;
            try { live=context.getTrackSegment(type); } catch(e) { unavailable('track descriptor '+type+' is unreadable'); }
            if (!known || !live || live.type!==type || live.trackGroup!==known.trackGroup ||
                live.allowsChainLift!==known.flags.allowLiftHill || live.isSteepUp!==known.flags.isSteepUp)
                unavailable('track descriptor '+type+' does not match the pinned rules');
            return known;
        }
        function hasBit(value,bit) { return Math.floor(value/bit)%2===1; }
        function objectSupports(object, group) {
            var vehicles=object.vehicles, first=vehicles && vehicles[0], def=object.defaultVehicle;
            if (!Array.isArray(vehicles) || vehicles.length!==data.constants.carCount || !first || !Number.isSafeInteger(first.carVisual) || first.carVisual<0 || first.carVisual>255 ||
                !Number.isSafeInteger(first.flags) || first.flags<0 || !Number.isInteger(def) || def<0 || def>255) return null;
            // The construction UI deliberately exempts custom paint styles and
            // slide/chairlift vehicles from its standard sprite-precision filter.
            if ((first.carVisual!==data.constants.standardPaintStyle && first.carVisual!==data.constants.spinningPaintStyle) ||
                hasBit(first.flags,data.constants.chairliftFlag) || hasBit(first.flags,data.constants.slideSwingFlag)) return true;
            if (def>=data.constants.carCount) return true; // GetDefaultCar() == nullptr in the native UI.
            var vehicle=vehicles[def];
            if (!vehicle || !vehicle.spriteGroups || typeof vehicle.spriteGroups!=='object') return null;
            var requirements=data.requiredSprites[group];
            if (!requirements) return null;
            for (var i=0;i<requirements.length;i++) {
                var req=requirements[i];
                if (req.minImages===0) continue;
                var sprite=vehicle.spriteGroups[req.group];
                if (sprite===undefined) return false;
                if (!sprite || [0,1,2,4,8,16,32,64].indexOf(sprite.spriteNumImages)<0) return null;
                if (sprite.spriteNumImages<req.minImages) return false;
            }
            return true;
        }
        function support(type) {
            var rtd=descriptor(type), objects;
            if (rtd.flags.hasTrack) {
                try { objects=objectManager.getAllObjects('ride'); } catch(e) { unavailable('loaded ride objects are unreadable'); }
                if (!Array.isArray(objects)) unavailable('loaded ride catalog is missing');
                objects=objects.filter(function(o){return o && Array.isArray(o.rideType) && o.rideType.indexOf(type)>=0;});
                // A construction request must already have a loaded researched
                // object. A contradictory empty catalog must not bypass filtering.
                if (!objects.length) unavailable('no loaded objects for ride type '+type);
            }
            var results={};
            function vehicleAllows(group) {
                if (!rtd.flags.hasTrack) return true;
                if (Object.prototype.hasOwnProperty.call(results,group)) return results[group];
                var unknown=false;
                for (var i=0;i<objects.length;i++) {
                    var result;
                    try { result=objectSupports(objects[i],group); } catch(e) { result=null; }
                    if (result===true) return results[group]=true;
                    if (result===null) unknown=true;
                }
                if (unknown) unavailable('vehicle sprite metadata for track group '+group+' is missing');
                return results[group]=false;
            }
            function enabled(group,inverted) {
                var drawer=inverted?rtd.inverted:rtd.regular;
                return drawer.enabledGroups.indexOf(group)>=0 && vehicleAllows(group);
            }
            function validate(trackType,flags,allowMaze) {
                C.integer(flags,'trackPlaceFlags (chain=1, inverted=2)',0,3);
                var s=segment(trackType), inverted=(flags&2)!==0, chain=(flags&1)!==0;
                if (inverted && !rtd.flags.hasInvertedVariant) fail('Ride type '+type+' has no inverted track variant');
                var drawer=inverted?rtd.inverted:rtd.regular;
                function requireGroup(group) {
                    if (!enabled(group,inverted)) fail('Track '+s.name+' is not supported by normal construction for ride type '+type+' (track group '+group+'); inspect track.catalog for this ride');
                }
                if (type===20) {
                    if (!allowMaze) fail('Use mazeplacetrack or mazesettrack to build Maze cells');
                    if (s.name!=='maze' || flags!==0) fail('Existing track is not a normal Maze cell');
                    return s;
                }
                if (rtd.flags.isFlatRide) {
                    if (trackType!==rtd.startTrackPiece || flags!==0) fail('Ride type '+type+' only supports its normal flat-ride base '+rtd.startTrackPiece);
                    return s;
                }
                var base=s.coveredBase===null?s:data.segments[s.coveredBase];
                if (!base) unavailable('covered-track base is missing');
                if (s.coveredBase!==null) {
                    if (drawer.coveredGroups.indexOf(base.trackGroup)<0) fail('Covered track '+s.name+' is not supported by ride type '+type);
                    if (chain) fail('Covered track does not support a chain lift');
                }
                // The UI's effective requirements override incomplete/mislabelled
                // TED groups (notably vertical, diagonal and covered geometry).
                var required=base.requiredGroups;
                if (!required || !required.length) fail('Track '+s.name+' has no normal construction route for ride type '+type);
                required.forEach(requireGroup);
                if(base.requiredAnyGroups.length){
                    var anyEnabled=false, unreadable=null;
                    base.requiredAnyGroups.forEach(function(group){try{if(enabled(group,inverted))anyEnabled=true;}catch(e){unreadable=e;}});
                    if(!anyEnabled){if(unreadable)throw unreadable;fail('Track '+s.name+' is not selectable by the normal slope controls for ride type '+type);}
                }
                (base.excludedGroups||[]).forEach(function(group){
                    if(enabled(group,inverted))fail('Track '+s.name+' is replaced by the normal long-base transition for ride type '+type+'; inspect track.catalog');
                });
                var needsInclineChain=rtd.flags.upInclineRequiresLift && [s.beginSlope,s.endSlope].some(function(p){return p===2||p===4;});
                if(needsInclineChain && !chain)fail('Ride type '+type+' requires a chain lift on uphill track '+s.name);
                if (s.forceChain) {
                    if (!chain) fail('Track '+s.name+' requires its built-in chain lift (trackPlaceFlags 1)');
                } else if (chain) {
                    if (!s.flags.allowLiftHill) fail('Chain lift is not allowed on '+s.name);
                    if(s.beginBank!==0 || s.endBank!==0 || s.beginSlope===10 || s.endSlope===10)fail('Chain lift is not allowed on banked or upward-vertical track '+s.name);
                    if (!enabled(data.trackGroups.liftHill,inverted)) fail('Ride type '+type+' does not support a normal chain lift in this track variant');
                    if (s.flags.curveAllowsLift && !enabled(data.trackGroups.liftHillCurve,inverted)) fail('Ride type '+type+' does not support chain lifts on curved track');
                    // Native isSteepUp, not absolute pitch: reverse steep lift
                    // hills and their transitions remain legal.
                    if (s.flags.isSteepUp && (rtd.regular.enabledGroups.indexOf(data.trackGroups.liftHillSteep)<0 || !enabled(data.trackGroups.liftHillSteep,inverted))) fail('Ride type '+type+' does not support a steep forward chain lift');
                }
                return s;
            }
            return {validate:validate,requiresChain:function(trackType){var s=segment(trackType);return s.forceChain || !!(rtd.flags.upInclineRequiresLift && [s.beginSlope,s.endSlope].some(function(p){return p===2||p===4;}));}};
        }
        return {support:support,segment:segment};
    }
    return {create:create};
})();
if (typeof module!=='undefined') module.exports=BridgeTrackGuard;
