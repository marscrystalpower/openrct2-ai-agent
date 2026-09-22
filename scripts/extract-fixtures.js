// Extract real engine geometry for offline tests. Fails on unsupported source syntax.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),base=path.join(root,'vendor/OpenRCT2/src/openrct2/ride');
const files=['TrackData.cpp',...fs.readdirSync(path.join(base,'ted')).filter(f=>f.startsWith('TED.')&&f.endsWith('.h')).map(f=>'ted/'+f)];
const text=files.map(f=>fs.readFileSync(path.join(base,f),'utf8')).join('\n');
const names=require('../generated/track-names.json');
const slopes={none:0,up25:2,up60:4,down25:6,down60:8,up90:10,down90:18,tower:10,reverseFreefall:10},banks={none:0,left:2,right:4,upsideDown:15};
const wanted=['flat','endStation','beginStation','middleStation','flatToUp25','up25','up25ToFlat','flatToDown25','down25','down25ToFlat','flatToRightBank','rightBankToFlat','bankedRightQuarterTurn5Tiles','brakes','rightQuarterTurn3Tiles','leftQuarterTurn3Tiles','leftEighthToDiag','rightEighthToOrthogonal','diagFlat'];
const result={};
for(const name of wanted){
    const descriptor='kTED'+name[0].toUpperCase()+name.slice(1);
    const m=text.match(new RegExp('constexpr auto '+descriptor+' = TrackElementDescriptor\\{([\\s\\S]*?)\\n    \\};'));
    if(!m)throw Error('Missing descriptor '+descriptor);
    const body=m[1],co=body.match(/\.coordinates = \{([^}]+)\}/)[1].split(',').map(Number);
    const def=body.match(/\.definition = \{ TrackGroup::\w+, TrackPitch::(\w+), TrackPitch::(\w+), TrackRoll::(\w+), TrackRoll::(\w+)/);
    const seq=body.match(/\.sequenceData = \{\s*\d+,\s*\{([^}]+)\}/)[1].split(',').map(s=>s.trim());
    const elements=seq.map(s=>{
        const b=text.match(new RegExp('SequenceDescriptor '+s+' = \\{([\\s\\S]*?)\\n    \\};'));
        if(!b)throw Error('Missing sequence '+s);
        const xyz=b[1].match(/\.clearance = \{\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)/);
        if(!xyz)throw Error('Unsupported clearance '+s);
        return {x:+xyz[1],y:+xyz[2],z:+xyz[3]};
    });
    result[names[name]]={name,type:names[name],beginDirection:co[0],endDirection:co[1],beginZ:co[2],endZ:co[3],endX:co[4],endY:co[5],beginSlope:slopes[def[2]],endSlope:slopes[def[1]],beginBank:banks[def[4]],endBank:banks[def[3]],elements,allowsChainLift:/TrackElementFlag::allowLiftHill/.test(body)};
}
fs.mkdirSync(path.join(root,'test/fixtures'),{recursive:true});
fs.writeFileSync(path.join(root,'test/fixtures/segments.json'),JSON.stringify(result,null,2)+'\n');
console.log('Extracted '+Object.keys(result).length+' engine geometry fixtures');
