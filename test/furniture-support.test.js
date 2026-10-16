/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {generateFurnitureSupport}=require('../scripts/furniture-support');
const reference=require('../scripts/footpath-additions-reference.json');
const source=path.resolve(__dirname,'../vendor/OpenRCT2');
test('furniture metadata keeps native flags separate from rendering and preserves inverted placement flags',()=>{
 const report=generateFurnitureSupport(source),find=id=>report.objects.find(o=>o.identifier==='rct2.footpath_item.'+id);
 const flags=report.flags;
 assert.equal(report.objects.length,20);
 assert(find('bench1').flags&flags.isBench);assert(find('bench1').flags&flags.breakable);assert(find('bench1').flags&flags.dontAllowOnSlope);
 assert(find('litter1').flags&flags.isBin);assert.equal(find('litter1').flags&flags.dontAllowOnSlope,0);
 assert(find('lamp1').flags&flags.lamp);assert.equal(find('lamp1').drawType,0);
 assert(!(find('qtv1').flags&flags.lamp));assert.equal(find('qtv1').drawType,0);
});
test('furniture reference rejects duplicate identifiers, missing hashes and guessed properties',()=>{
 const changed=fn=>{const c=structuredClone(reference);fn(c);return c;};
 assert.throws(()=>generateFurnitureSupport(source,changed(c=>c.objects.push(c.objects[0]))),/duplicate/);
 assert.throws(()=>generateFurnitureSupport(source,changed(c=>delete c.objects[0].referenceSha256)),/reference hash/);
 assert.throws(()=>generateFurnitureSupport(source,changed(c=>c.objects[0].properties.isBin=1)),/nonboolean/);
 assert.throws(()=>generateFurnitureSupport(source,changed(c=>c.objects[0].properties.renderAs='guess')),/render type/);
});
test('shipped furniture output is reproducible without private profile data',()=>{
 assert.deepEqual(generateFurnitureSupport(source),JSON.parse(fs.readFileSync(path.join(__dirname,'../generated/furniture-support.json'),'utf8')));
});
