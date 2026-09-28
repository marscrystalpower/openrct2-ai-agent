/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
// Derive connection masks from the pinned engine's SequenceDescriptor flags.
module.exports=function(read,names){
    const files=['src/openrct2/ride/ted/TED.Station.h','src/openrct2/ride/ted/TED.FlatRide.h','src/openrct2/ride/TrackData.cpp'];
    const table={};
    for(const file of files){
        const source=read(file), sequences={};
        for(const m of source.matchAll(/static constexpr SequenceDescriptor (\w+) = \{([\s\S]*?)\n    \};/g)){
            const flags=(m[2].match(/\.flags = \{([\s\S]*?)\}/)||[])[1]||'';
            sequences[m[1]]=['NE','SE','SW','NW'].reduce((mask,side,i)=>mask|(flags.includes('SequenceFlag::entranceConnection'+side)?1<<i:0),0);
        }
        for(const m of source.matchAll(/constexpr auto kTED(\w+) = TrackElementDescriptor\{([\s\S]*?)\n    \};/g)){
            const name=m[1][0].toLowerCase()+m[1].slice(1), type=names[name];
            const data=m[2].match(/\.sequenceData = \{\s*(\d+),\s*\{([^}]+)\}/);
            if(type===undefined||!data)continue;
            const refs=data[2].split(',').map(s=>s.trim()).filter(Boolean);
            if(refs.some(r=>sequences[r]===undefined))continue;
            const masks=refs.map(r=>sequences[r]);
            if(masks.some(Boolean)){
                if(refs.length!==Number(data[1]))throw Error('Incomplete entrance metadata: '+name);
                table[type]=masks;
            }
        }
    }
    if(JSON.stringify(table[names.flatTrack1x5])!=='[10,0,10,10,0]'||!table[names.flatTrack3x3]||!table[names.towerBase])throw Error('Pinned entrance metadata missing or changed');
    return table;
};
