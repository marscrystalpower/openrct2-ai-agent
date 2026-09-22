/* SPDX-License-Identifier: GPL-3.0-only */
var BridgeCore = (function () {
    'use strict';
    function fail(message) { throw new Error(message); }
    function integer(n, name, min, max) {
        if (!Number.isSafeInteger(n) || n < min || n > max) fail(name + ' must be an integer in [' + min + ', ' + max + ']');
        return n;
    }
    function rotate(x, y, d) { return [[x,y],[y,-x],[-x,-y],[-y,x]][d & 3]; }
    var delta = [[-32,0],[0,32],[32,0],[0,-32]];
    function same(a,b) { return ['x','y','z','direction','slope','bank'].every(function(k){return a[k] === b[k];}); }
    function position(p) {
        if (!p) fail('start is required');
        var r = {x:integer(p.x,'x',0,32736), y:integer(p.y,'y',0,32736), z:integer(p.z,'z',0,2040),
            direction:integer(p.direction,'direction',0,7), slope:p.slope || 0, bank:p.bank || 0};
        if (r.x % 32 || r.y % 32 || r.z % 8) fail('Use world coordinates: x/y multiples of 32; z multiples of 8');
        return r;
    }
    function advance(cursor, segment) {
        if ((cursor.direction & 4) !== (segment.beginDirection & 4)) fail('Diagonal/cardinal connection mismatch');
        if (cursor.slope !== segment.beginSlope) fail('Slope connection mismatch');
        if (cursor.bank !== segment.beginBank) fail('Bank connection mismatch');
        var rotation = ((cursor.direction & 3) - (segment.beginDirection & 3) + 4) & 3;
        var offset = rotate(segment.endX,segment.endY,rotation);
        var direction = ((rotation + segment.endDirection) & 3) | (segment.endDirection & 4);
        var step = direction & 4 ? [0,0] : delta[direction];
        return {origin:{x:cursor.x,y:cursor.y,z:cursor.z-segment.beginZ,direction:rotation},
            next:{x:cursor.x+offset[0]+step[0],y:cursor.y+offset[1]+step[1],
                z:cursor.z-segment.beginZ+segment.endZ,direction:direction,slope:segment.endSlope,bank:segment.endBank}};
    }
    function plan(input, getSegment, names, mapSize) {
        var start = position(input.start), cursor = start, steps = [], occupied = {}, anchors = {}, footprint = [], overlaps=[];
        if (!Array.isArray(input.pieces) || !input.pieces.length) fail('pieces must be a nonempty array');
        input.pieces.forEach(function(spec) {
            if (typeof spec === 'string' || typeof spec === 'number') spec = {type:spec};
            var type = typeof spec.type === 'string' ? names[spec.type] : spec.type;
            integer(type,'track type',0,65534);
            var s = getSegment(type);
            if (!s || !s.elements || !s.elements.length) fail('Unsupported track type: '+spec.type);
            var repeat = spec.repeat === undefined ? 1 : integer(spec.repeat,'repeat',1,512);
            if (spec.chain && !s.allowsChainLift) fail('Chain lift not allowed on '+spec.type);
            for (var i=0;i<repeat;i++) {
                if (steps.length >= 2048) fail('Maximum 2048 track pieces per plan');
                var a;
                try { a = advance(cursor,s); } catch(e) { fail('Piece '+steps.length+' ('+spec.type+'): '+e.message); }
                if (a.origin.z < 0 || a.origin.z > 2040) fail('Track elevation outside supported range');
                var anchor=[a.origin.x,a.origin.y,a.origin.z,a.origin.direction,type].join(',');
                if(anchors[anchor]!==undefined)fail('Duplicate track placement at piece '+steps.length);
                anchors[anchor]=steps.length;
                s.elements.forEach(function(el) {
                    var xy = rotate(el.x,el.y,a.origin.direction);
                    var p = {x:a.origin.x+xy[0],y:a.origin.y+xy[1],z:a.origin.z+el.z,piece:steps.length};
                    if (mapSize && (p.x < 32 || p.y < 32 || p.x >= (mapSize.x-1)*32 || p.y >= (mapSize.y-1)*32)) fail('Track footprint leaves usable map');
                    var key = [p.x,p.y,p.z].join(',');
                    if (occupied[key] !== undefined && occupied[key] !== steps.length) overlaps.push({piece:steps.length,other:occupied[key],position:p});
                    occupied[key]=steps.length; footprint.push(p);
                });
                steps.push(Object.assign({},a.origin,{trackType:type,brakeSpeed:spec.brakeSpeed === undefined ? 8 : integer(spec.brakeSpeed,'brakeSpeed',0,255),
                    colour:spec.colour === undefined ? 0 : integer(spec.colour,'colour scheme',0,3),seatRotation:spec.seatRotation === undefined ? 0 : integer(spec.seatRotation,'seatRotation',0,15),
                    trackPlaceFlags:(spec.chain ? 1 : 0) | (spec.inverted ? 2 : 0),isFromTrackDesign:false}));
                cursor=a.next;
            }
        });
        var closed = same(cursor,start);
        if (input.requireClosed && !closed) fail('Circuit is not closed: end='+JSON.stringify(cursor)+' start='+JSON.stringify(start));
        return {start:start,end:cursor,closed:closed,steps:steps,footprint:footprint,possibleOverlaps:overlaps,
            verification:'Geometry only. Terrain clearance, ownership, cost, ride compatibility and train physics require engine checks.'};
    }
    function validateAction(name,args,schemas) {
        var schema = Object.prototype.hasOwnProperty.call(schemas,name) ? schemas[name] : null;
        if (!schema) fail('Action is not allowed: '+name);
        if (!args || typeof args !== 'object' || Array.isArray(args)) fail('Action args must be an object');
        Object.keys(args).forEach(function(k){if (!Object.prototype.hasOwnProperty.call(schema,k)) fail('Unknown argument '+k+' for '+name);});
        Object.keys(schema).forEach(function(k){
            var type=schema[k], v=args[k];
            if (type === 'number' || type === 'Direction') integer(v,k,-2147483648,2147483647);
            else if (type === 'boolean' && typeof v !== 'boolean') fail(k+' must be boolean');
            else if (type === 'string' && (typeof v !== 'string' || v.length>512)) fail(k+' must be a string of at most 512 characters');
            else if (type === 'CoordsXY[]') {
                if (!Array.isArray(v) || v.length>1024) fail(k+' must be a coordinate array');
                v.forEach(function(p){integer(p.x,'x',0,32736);integer(p.y,'y',0,32736);});
            } else if (!['number','Direction','boolean','string','CoordsXY[]'].includes(type)) fail('Unsupported schema '+type);
        });
        return args;
    }
    return {integer:integer,rotate:rotate,advance:advance,plan:plan,same:same,validateAction:validateAction};
})();
if (typeof module !== 'undefined') module.exports = BridgeCore;
