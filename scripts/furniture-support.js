/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {SOURCE_COMMIT}=require('./track-support');
const reference=require('./footpath-additions-reference.json');
function check(value,message){if(!value)throw Error('Furniture support extraction: '+message);}
function generateFurnitureSupport(sourceRoot,catalog=reference){
 const commit=cp.execFileSync('git',['-C',sourceRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 check(commit===SOURCE_COMMIT,'source commit mismatch');
 const read=file=>fs.readFileSync(path.join(sourceRoot,'src/openrct2',file),'utf8');
 const flagsSource=read('object/PathAdditionFlags.h'),parser=read('object/PathAdditionObject.cpp');
 const flags={};for(const m of flagsSource.matchAll(/^\s*(\w+)\s*=\s*(\d+)\s*,?\s*$/gm))flags[m[1]]=2**Number(m[2]);
 const mappings=[['isBin','isBin'],['isBench','isBench'],['isBreakable','breakable'],['isLamp','lamp'],['isJumpingFountainWater','jumpingFountainWater'],['isJumpingFountainSnow','jumpingFountainSnow'],['isAllowedOnQueue','dontAllowOnQueue',true],['isAllowedOnSlope','dontAllowOnSlope',true],['isTelevision','isQueueScreen']];
 for(const [property,flag,inverted] of mappings){
  check(Number.isInteger(flags[flag]),'missing native flag '+flag);
  check(new RegExp('"'+property+'"\\s*,\\s*PathAdditionFlag::'+flag+'\\s*,\\s*Json::FlagType::'+(inverted?'inverted':'normal')).test(parser),'changed native property mapping '+property);
 }
 check(catalog&&Array.isArray(catalog.objects)&&catalog.objects.length>0,'missing reference objects');
 const seen=new Set(),objects=catalog.objects.map(object=>{
  check(typeof object.identifier==='string'&&/^[a-z0-9_.]+$/.test(object.identifier)&&!seen.has(object.identifier),'invalid or duplicate object identifier');seen.add(object.identifier);
  check(/^[a-f0-9]{64}$/.test(object.referenceSha256),'missing reference hash');
  check(object.properties&&typeof object.properties==='object','missing reference properties');
  let value=0;for(const [property,flag,inverted] of mappings){const raw=object.properties[property];check(raw===undefined||typeof raw==='boolean','nonboolean '+property);if(inverted?!raw:raw)value|=flags[flag];}
  const render=object.properties.renderAs,drawTypes={lamp:0,bin:1,bench:2,fountain:3};
  check(Object.hasOwn(drawTypes,render),'unknown reference render type');
  return {identifier:object.identifier,flags:value,drawType:drawTypes[render],referenceSha256:object.referenceSha256};
 });
 return {schema:1,sourceCommit:commit,source:catalog.source,classificationSource:'standard-object-reference-identifiers',flags,objects,
  limitations:['API 124 does not expose loaded path-addition flags. Standard identifiers are classified using the included reference metadata; custom or overridden objects require separate metadata verification. No graphics or game assets are included.']};
}
module.exports={generateFurnitureSupport};
