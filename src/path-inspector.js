/* SPDX-License-Identifier: GPL-3.0-only */
var BridgePathInspector = (function () {
    'use strict';
    var Furniture=typeof BridgePathFurniture!=='undefined'?BridgePathFurniture:typeof require==='function'?require('./path-furniture'):null;
    // API 124 ScPathNavigator uses world x/y, including its element-index
    // overload. Its neighbors are directed: it does not check a target's
    // reciprocal edge. Keep those native links separate from geometry hints.
    var MAX_WIDTH = 32, MAX_HEIGHT = 32, MAX_PATHS = 8192, MAX_INSPECT_PATHS = 4096;
    var MAX_TILE_ELEMENTS = 256, MAX_ROUTE = 4096;
    var MAX_EVIDENCE = 4096, MAX_COMPARISONS = 16384, MAX_WALL_COMPARISONS = 16384;
    var MAX_DIAGNOSTICS = 4096, MAX_UNAVAILABLE = 256, MAX_BOUNDARY_WALLS = 8;
    var DELTA = [[-1,0],[0,1],[1,0],[0,-1]];
    var OPTIONS = {respectBanners:true, includeQueues:true, includeWidePaths:true, includeGhosts:false};
    var NOTES = [
        'Topology only: native footpath links are not a simulation of guest decisions, congestion, access permissions or journey completion.',
        'Queues for all rides and wide paths are included. Banner restrictions are respected; ghost paths are excluded.',
        'Nearby walls, scenery and track are evidence for review, not proof of a movement obstruction. Vehicle blocking is dynamic evidence.',
        'Native navigation returns footpaths only; an edge without a footpath neighbor may serve an entrance, exit, park gate or shop.',
        'A geometrically matching pair without edge bits is only a possible gap; separation may be deliberate.'
    ];
    function integer(value, name, min, max) {
        if (!Number.isSafeInteger(value) || value < min || value > max)
            throw new Error(name+' must be an integer in ['+min+', '+max+']');
        return value;
    }
    function object(value, name) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(name+' must be an object');
        return value;
    }
    function sizeOf(map) {
        var size;
        try { size = map.size; } catch (e) { }
        if (!size || !Number.isSafeInteger(size.x) || !Number.isSafeInteger(size.y) || size.x < 1 || size.y < 1)
            throw new Error('Map tile bounds are unavailable');
        return {x:size.x, y:size.y};
    }
    function key(x,y,index) { return x+','+y+','+index; }
    function message(error) { return (error && typeof error.message === 'string' ? error.message : String(error)).slice(0,256); }
    function inside(region,x,y) {
        return !region || (x >= region.x && y >= region.y && x < region.x+region.width && y < region.y+region.height);
    }
    function endpoint(path,direction,geometry) {
        if (!geometry[path.key]) return null;
        if (path.slopeDirection === null) return path.baseZ;
        if (direction === path.slopeDirection) return path.baseZ+16;
        if (direction === (path.slopeDirection^2)) return path.baseZ;
        return null;
    }
    function createReader(map,size,region,pathLimit,furniture) {
        var state = {complete:true, truncated:false, unavailable:[], tiles:Object.create(null),
            nodes:Object.create(null), geometry:Object.create(null), count:0,evidence:[],evidenceTiles:Object.create(null)};
        function unavailable(label) {
            state.complete = false;
            if (state.unavailable.indexOf(label) < 0) {
                if (state.unavailable.length < MAX_UNAVAILABLE) state.unavailable.push(label);
                else if (state.unavailable.length === MAX_UNAVAILABLE) {
                    state.unavailable.push('Additional unavailable details omitted after '+MAX_UNAVAILABLE+' entries'); state.truncated = true;
                }
            }
        }
        function read(value,name,label) {
            try { var result = value == null ? undefined : value[name]; if (result !== undefined) return result; }
            catch (e) { unavailable(label+': '+message(e)); return undefined; }
            unavailable(label); return undefined;
        }
        function number(value,name,label,min,max,nullable) {
            var result = read(value,name,label);
            if (nullable && result === null) return null;
            if (Number.isSafeInteger(result) && result >= min && result <= max) return result;
            unavailable(label); return null;
        }
        function flag(value,name,label) {
            var result = read(value,name,label);
            if (typeof result === 'boolean') return result;
            unavailable(label); return null;
        }
        function tile(x,y) {
            var tileKey = x+','+y;
            if (Object.prototype.hasOwnProperty.call(state.tiles,tileKey)) return state.tiles[tileKey];
            var result = {x:x,y:y,paths:[],evidence:[],walls:[[],[],[],[]],complete:true};
            state.tiles[tileKey] = result;
            state.evidenceTiles[tileKey] = [];
            if (x < 0 || y < 0 || x >= size.x || y >= size.y) return result;
            var nativeTile, elements;
            try { nativeTile = map.getTile(x,y); elements = nativeTile && nativeTile.elements; }
            catch (e) { unavailable('tile '+tileKey+': '+message(e)); result.complete = false; return result; }
            if (!Array.isArray(elements)) { unavailable('tile '+tileKey+'.elements'); result.complete = false; return result; }
            if (elements.length > MAX_TILE_ELEMENTS) {
                unavailable('tile '+tileKey+' exceeds '+MAX_TILE_ELEMENTS+' elements');
                state.truncated = true; result.complete = false;
            }
            for (var i=0;i<Math.min(elements.length,MAX_TILE_ELEMENTS);i++) {
                var element = elements[i], prefix = 'element '+key(x,y,i), type = read(element,'type',prefix+'.type');
                if (type === 'footpath') {
                    var ghost = flag(element,'isGhost',prefix+'.isGhost');
                    if (ghost !== false) { if (ghost === null) result.complete = false; continue; }
                    if (state.count >= pathLimit) {
                        unavailable('Path inspection exceeds '+pathLimit+' paths');
                        state.truncated = true; result.complete = false; continue;
                    }
                    var baseZ = number(element,'baseZ',prefix+'.baseZ',0,2147483647,false);
                    var rawEdges = number(element,'edges',prefix+'.edges',0,255,false);
                    var slope = read(element,'slopeDirection',prefix+'.slopeDirection');
                    var slopeValid = slope === null || (Number.isInteger(slope) && slope >= 0 && slope < 4);
                    if (!slopeValid) { unavailable(prefix+'.slopeDirection'); slope = null; }
                    var path = {key:key(x,y,i),x:x,y:y,elementIndex:i,baseZ:baseZ,
                        clearanceZ:number(element,'clearanceZ',prefix+'.clearanceZ',0,2147483647,false),
                        edges:rawEdges === null ? null : rawEdges&15,slopeDirection:slope,
                        isQueue:flag(element,'isQueue',prefix+'.isQueue'),isWide:flag(element,'isWide',prefix+'.isWide'),
                        ride:number(element,'ride',prefix+'.ride',0,65535,true),
                        station:number(element,'station',prefix+'.station',0,255,true),
                        isBlockedByVehicle:flag(element,'isBlockedByVehicle',prefix+'.isBlockedByVehicle')};
                    if(furniture)path.furniture=furniture.read(element,path);
                    state.geometry[path.key] = baseZ !== null && slopeValid;
                    state.nodes[path.key] = path; state.count++; result.paths.push(path);
                } else if (region && ['wall','small_scenery','large_scenery','track','entrance','banner'].indexOf(type) >= 0) {
                    // These are intentionally not interpreted as collision or pedestrian blockers.
                    var evidenceGhost;
                    try { evidenceGhost = element.isGhost; } catch (e) { }
                    if (evidenceGhost === true) continue;
                    if (state.evidence.length >= MAX_EVIDENCE) {
                        unavailable('Evidence inspection exceeds '+MAX_EVIDENCE+' elements'); state.truncated = true; continue;
                    }
                    var evidence = {key:key(x,y,i),x:x,y:y,elementIndex:i,type:type};
                    evidence.isGhost = typeof evidenceGhost === 'boolean' ? evidenceGhost : null;
                    ['baseZ','clearanceZ','direction','object','ride','station'].forEach(function (name) {
                        try { var value = element[name]; if (value === null || typeof value === 'boolean' || Number.isSafeInteger(value)) evidence[name] = value; }
                        catch (e) { }
                    });
                    result.evidence.push(evidence); state.evidence.push(evidence); state.evidenceTiles[tileKey].push(evidence.key);
                    if (type === 'wall' && evidence.isGhost === false && Number.isInteger(evidence.direction) && evidence.direction >= 0 && evidence.direction < 4)
                        result.walls[evidence.direction].push(evidence);
                }
            }
            return result;
        }
        function native(path) {
            if (path.native) return path.native;
            var result = {available:false,edges:null,permittedEdges:null,connectedPaths:null,errors:[]};
            path.native = result;
            function error(label) { result.errors.push(label); unavailable(path.key+' navigator: '+label); }
            var navigator;
            try {
                if (typeof map.getPathNavigator !== 'function') { error('map.getPathNavigator unavailable'); return result; }
                // Do not pass tile coordinates: the native overload takes world coordinates.
                navigator = map.getPathNavigator({x:path.x*32,y:path.y*32},path.elementIndex,OPTIONS);
                if (!navigator) { error('No native navigator for footpath'); return result; }
            } catch (e) { error(message(e)); return result; }
            ['edges','permittedEdges'].forEach(function (name) {
                try {
                    var value = navigator[name];
                    if (!Number.isInteger(value) || value < 0 || value > 15) error(name+' unavailable or invalid');
                    else result[name] = value;
                } catch (e) { error(name+': '+message(e)); }
            });
            var connections;
            try {
                if (typeof navigator.getConnectedPaths !== 'function') { error('getConnectedPaths unavailable'); return result; }
                connections = navigator.getConnectedPaths();
            } catch (e) { error('getConnectedPaths: '+message(e)); return result; }
            if (!Array.isArray(connections)) { error('getConnectedPaths did not return an array'); return result; }
            result.connectedPaths = [];
            if (connections.length > 4) { error('getConnectedPaths exceeds four native directions'); state.truncated = true; }
            connections.slice(0,4).forEach(function (connection) {
                try {
                    var position = connection.position, index = connection.elementIndex, direction = connection.direction;
                    if (!position || !Number.isSafeInteger(position.x) || !Number.isSafeInteger(position.y) || !Number.isSafeInteger(position.z) ||
                        position.x%32 !== 0 || position.y%32 !== 0 || position.x < 0 || position.y < 0 ||
                        position.x >= size.x*32 || position.y >= size.y*32 || position.z < 0 ||
                        !Number.isInteger(index) || index < 0 || index >= MAX_TILE_ELEMENTS ||
                        !Number.isInteger(direction) || direction < 0 || direction > 3 ||
                        position.x/32 !== path.x+DELTA[direction][0] || position.y/32 !== path.y+DELTA[direction][1]) {
                        error('Invalid native path connection'); return;
                    }
                    var x = position.x/32, y = position.y/32;
                    result.connectedPaths.push({key:key(x,y,index),position:{x:position.x,y:position.y,z:position.z},
                        x:position.x,y:position.y,z:position.z,tileX:x,tileY:y,elementIndex:index,direction:direction,
                        external:!inside(region,x,y)});
                } catch (e) { error('Invalid native path connection: '+message(e)); }
            });
            result.available = result.errors.length === 0;
            return result;
        }
        state.tile = tile; state.native = native; state.unavailableAt = unavailable;
        return state;
    }
    function inspect(args,map,furnitureOptions) {
        args = object(args || {},'args');
        var size = sizeOf(map), region = {x:integer(args.x,'x',0,size.x-1),y:integer(args.y,'y',0,size.y-1),
            width:integer(args.width === undefined ? 1 : args.width,'width',1,MAX_WIDTH),
            height:integer(args.height === undefined ? 1 : args.height,'height',1,MAX_HEIGHT)};
        if (region.x+region.width > size.x || region.y+region.height > size.y) throw new Error('Inspection rectangle exceeds map tile bounds');
        var furniture=Furniture&&Furniture.create(furnitureOptions),state = createReader(map,size,region,MAX_INSPECT_PATHS,furniture), paths = [], diagnostics = [], seen = Object.create(null), comparisons = 0, wallComparisons = 0;
        function diagnostic(code,from,to,direction,certainty,text,extra) {
            var pair = to === null ? from+':'+direction : [from,to].sort().join('|');
            var id = code+'|'+pair;
            if (seen[id]) return;
            if (diagnostics.length >= MAX_DIAGNOSTICS) {
                state.unavailableAt('Diagnostics exceed '+MAX_DIAGNOSTICS+' entries'); state.truncated = true; return;
            }
            seen[id] = true;
            var entry = {code:code,certainty:certainty,from:from,to:to,direction:direction,message:text};
            if (extra) Object.keys(extra).forEach(function (name) { entry[name] = extra[name]; });
            diagnostics.push(entry);
        }
        // Load requested tiles first so halo paths cannot consume the path budget first.
        for (var y=region.y;y<region.y+region.height;y++) for (var x=region.x;x<region.x+region.width;x++)
            paths = paths.concat(state.tile(x,y).paths);
        paths.forEach(function (path) {
            var native = state.native(path);
            path.directions = [];
            if (path.isBlockedByVehicle === true) diagnostic('dynamic_vehicle_blocker',path.key,null,null,'observed',
                'The native path element is currently marked blocked by a vehicle; this is dynamic evidence, not a permanent topology failure.');
            for (var direction=0;direction<4;direction++) {
                var x = path.x+DELTA[direction][0], y = path.y+DELTA[direction][1];
                var adjacent = state.tile(x,y), z = endpoint(path,direction,state.geometry);
                var raw = path.edges === null ? null : (path.edges&(1<<direction)) !== 0;
                var permitted = native.permittedEdges === null ? null : (native.permittedEdges&(1<<direction)) !== 0;
                var connected = native.connectedPaths === null ? null : native.connectedPaths.filter(function (p) { return p.direction === direction; });
                var matching = [], incompatible = [], asymmetric = false, possibleGap = false, geometryComplete = true;
                var detail = {direction:direction,endpointZ:z,status:'unavailable',external:!inside(region,x,y),adjacentPaths:[],
                    nearbyEvidence:[path.x+','+path.y,x+','+y]};
                var wallCandidates = state.tile(path.x,path.y).walls[direction].concat(adjacent.walls[direction^2]);
                var boundaryWalls = [], boundaryWallsTruncated = false;
                for (var wallIndex=0;wallIndex<wallCandidates.length;wallIndex++) {
                    if (wallComparisons >= MAX_WALL_COMPARISONS) {
                        boundaryWallsTruncated = true; state.truncated = true;
                        state.unavailableAt('Boundary wall comparisons exceed '+MAX_WALL_COMPARISONS); break;
                    }
                    wallComparisons++;
                    var wall = wallCandidates[wallIndex];
                    if (path.baseZ !== null && path.clearanceZ !== null && Number.isSafeInteger(wall.baseZ) && Number.isSafeInteger(wall.clearanceZ) &&
                        path.baseZ < wall.clearanceZ && path.clearanceZ > wall.baseZ) {
                        if (boundaryWalls.length < MAX_BOUNDARY_WALLS) boundaryWalls.push(wall.key);
                        else boundaryWallsTruncated = true;
                    }
                }
                for (var targetIndex=0;targetIndex<adjacent.paths.length;targetIndex++) {
                    if (comparisons >= MAX_COMPARISONS) {
                        geometryComplete = false; state.truncated = true;
                        state.unavailableAt('Geometry comparisons exceed '+MAX_COMPARISONS); break;
                    }
                    comparisons++;
                    var target = adjacent.paths[targetIndex];
                    var targetZ = endpoint(target,direction^2,state.geometry), back = target.edges === null ? null : (target.edges&(1<<(direction^2))) !== 0;
                    var compatible = z !== null && targetZ !== null && z === targetZ;
                    var selected = connected === null ? null : connected.some(function (entry) { return entry.key === target.key; });
                    detail.adjacentPaths.push({key:target.key,x:target.x,y:target.y,elementIndex:target.elementIndex,baseZ:target.baseZ,
                        endpointZ:targetZ,compatible:compatible,reverseEdge:back,nativeSelected:selected,external:!inside(region,target.x,target.y)});
                    if (compatible) matching.push({target:target,back:back,selected:selected});
                    else incompatible.push(target);
                }
                if (matching.length > 1) diagnostic('ambiguous_adjacent_paths',path.key,null,direction,'observed',
                    'Multiple footpaths have geometrically matching endpoints. Native navigation selects only its first eligible path in this direction.',
                    {nativeSelected:connected === null ? null : connected.map(function (entry) { return entry.key; })});
                matching.forEach(function (candidate) {
                    var target = candidate.target, back = candidate.back;
                    if (raw !== null && back !== null && raw !== back) {
                        var observed = candidate.selected === true || (geometryComplete && matching.length === 1);
                        if (observed) asymmetric = true;
                        diagnostic(observed ? 'asymmetric_edge' : 'adjacent_asymmetric_edge',path.key,target.key,direction,observed ? 'observed' : 'possible',
                            observed ? 'Geometrically matching footpaths have asymmetric raw edge bits. Native navigation may still traverse the direction with an edge.' :
                                'An unselected, coincident path has a different reciprocal edge bit; this does not invalidate the native-selected link.',
                            {nativeSelected:candidate.selected});
                    } else if (raw === false && back === false) {
                            possibleGap = true;
                            diagnostic('possible_gap',path.key,target.key,direction,'possible',
                                'Adjacent path endpoints match in height, but neither path has a joining edge. This may be deliberate. Boundary walls are placement evidence only.',
                                {boundaryWalls:boundaryWalls,boundaryWallsTruncated:boundaryWallsTruncated,ambiguous:matching.length > 1});
                    }
                });
                if (!state.geometry[path.key] || !native.available || !adjacent.complete || !geometryComplete) detail.status = 'unavailable';
                else if (z === null) {
                    detail.status = 'slope_side';
                    if (raw) diagnostic('slope_side_edge',path.key,null,direction,'observed',
                        'A raw edge bit points through the side of a sloped path, where there is no cardinal slope endpoint.');
                }
                else if (raw === true && permitted === false) {
                    detail.status = 'banner_restricted';
                    diagnostic('banner_restriction',path.key,null,direction,'observed','A raw footpath edge is excluded by the native permitted-edge mask with banners respected.');
                } else if (asymmetric) detail.status = 'asymmetric_edge';
                else if (connected && connected.length) detail.status = 'connected';
                else if (possibleGap) detail.status = 'possible_gap';
                else if (matching.length && raw) detail.status = 'native_selection';
                else if (incompatible.length) detail.status = 'height_mismatch';
                else if (raw) detail.status = 'non_path_or_unresolved_connection';
                else detail.status = detail.external ? 'boundary' : 'no_adjacent_path';
                path.directions.push(detail);
            }
        });
        return {region:region,limits:{maxWidth:MAX_WIDTH,maxHeight:MAX_HEIGHT,maxPaths:MAX_INSPECT_PATHS,maxTileElements:MAX_TILE_ELEMENTS,
                maxEvidence:MAX_EVIDENCE,maxGeometryComparisons:MAX_COMPARISONS,maxWallComparisons:MAX_WALL_COMPARISONS,
                maxDiagnostics:MAX_DIAGNOSTICS,maxUnavailable:MAX_UNAVAILABLE,maxBoundaryWalls:MAX_BOUNDARY_WALLS},
            topologyOnly:true,complete:state.complete,truncated:state.truncated,unavailable:state.unavailable,notes:NOTES.slice(),
            paths:paths,evidence:state.evidence,evidenceTiles:state.evidenceTiles,diagnostics:diagnostics,
            furniture:furniture?furniture.summarize(paths,{name:'inspected_rectangle',complete:state.complete&&!state.truncated}):{status:'unknown',complete:false,unavailable:['Path furniture module unavailable']},
            summary:{pathCount:paths.length,possibleGaps:diagnostics.filter(function (d) { return d.code === 'possible_gap'; }).length,
                asymmetricEdges:diagnostics.filter(function (d) { return d.code === 'asymmetric_edge'; }).length,
                bannerRestrictions:diagnostics.filter(function (d) { return d.code === 'banner_restriction'; }).length,
                dynamicVehicleBlockers:paths.filter(function (p) { return p.isBlockedByVehicle === true; }).length}};
    }
    function route(args,map) {
        args = object(args || {},'args');
        var size = sizeOf(map), limit = integer(args.limit === undefined ? 1024 : args.limit,'limit',1,MAX_ROUTE);
        function selection(value,name) {
            object(value,name);
            return {x:integer(value.x,name+'.x',0,size.x-1),y:integer(value.y,name+'.y',0,size.y-1),
                elementIndex:integer(value.elementIndex,name+'.elementIndex',0,MAX_TILE_ELEMENTS-1)};
        }
        var start = selection(args.start,'start'), end = selection(args.end,'end'), state = createReader(map,size,null,MAX_PATHS);
        function selected(value,name) {
            var tile = state.tile(value.x,value.y);
            var result = state.nodes[key(value.x,value.y,value.elementIndex)];
            if (!result && !tile.complete) return null;
            if (!result) throw new Error(name+' must select an existing non-ghost footpath element');
            return result;
        }
        var first = selected(start,'start'), last = selected(end,'end');
        if (!first || !last) return {start:start,end:end,found:null,path:null,explored:0,limit:limit,truncated:state.truncated,
            complete:false,unavailable:state.unavailable,topologyOnly:true,notes:NOTES.slice(),
            limits:{maxRoute:MAX_ROUTE,maxPaths:MAX_PATHS,maxTileElements:MAX_TILE_ELEMENTS}};
        var queue = [first], visited = Object.create(null), parents = Object.create(null), head = 0, explored = 0, found = null;
        visited[first.key] = true; parents[first.key] = null;
        while (head < queue.length && explored < limit) {
            var path = queue[head++]; explored++;
            var native = state.native(path);
            if (path.key === last.key) { if (native.available) found = true; break; }
            if (native.connectedPaths === null) continue;
            native.connectedPaths.forEach(function (connection) {
                if (visited[connection.key]) return;
                // Discover only the native-selected neighbor, never every geometrically matching stacked path.
                state.tile(connection.tileX,connection.tileY);
                var target = state.nodes[connection.key];
                if (!target || target.baseZ !== connection.z) {
                    state.unavailableAt('Native connection target unavailable: '+connection.key); return;
                }
                visited[target.key] = true; parents[target.key] = path.key; queue.push(target);
            });
        }
        var truncated = state.truncated || (found !== true && head < queue.length);
        if (found !== true && !truncated && state.complete) found = false;
        var outputPath = null;
        if (found === true) {
            outputPath = []; var cursor = last.key;
            while (cursor !== null) {
                var node = state.nodes[cursor];
                outputPath.push({key:node.key,x:node.x,y:node.y,elementIndex:node.elementIndex,baseZ:node.baseZ,isBlockedByVehicle:node.isBlockedByVehicle});
                cursor = parents[cursor];
            }
            outputPath.reverse();
        }
        return {start:start,end:end,found:found,path:outputPath,explored:explored,limit:limit,truncated:truncated,
            complete:state.complete && !truncated,unavailable:state.unavailable,topologyOnly:true,notes:NOTES.slice(),
            limits:{maxRoute:MAX_ROUTE,maxPaths:MAX_PATHS,maxTileElements:MAX_TILE_ELEMENTS}};
    }
    return {inspect:inspect,route:route};
})();
if (typeof module !== 'undefined') module.exports = BridgePathInspector;
