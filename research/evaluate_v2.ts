import {readFileSync,writeFileSync} from 'node:fs';import assert from 'node:assert/strict';
import {parseProgression,perform,chordAt,pc,PRESETS,type Phrase,type Model} from '../src/music.ts';
import {generate as oldGenerate,perform as oldPerform} from './baseline/music-v1.ts';
import {generatePhraseV2 as generate} from '../src/generator-v2.ts';
const model:Model=JSON.parse(readFileSync('public/research/model.json','utf8'));const oldModel=JSON.parse(readFileSync('research/baseline/model-v1.json','utf8'));
function metrics(p:Phrase){
 const ns=p.notes.filter(n=>n.pitch!==null),ds=ns.slice(1).flatMap((n,i)=>n.start-ns[i].start<=2?[n.pitch!-ns[i].pitch!]:[]);const pairs=ns.slice(2).flatMap((n,i)=>n.start-ns[i+1].start<=2&&ns[i+1].start-ns[i].start<=2?[[ns[i+1].pitch!-ns[i].pitch!,n.pitch!-ns[i+1].pitch!]]:[]).filter(([a,b])=>a&&b);
 const strong=ns.filter(n=>n.start%1===0);const land=ns.filter(n=>n.role==='landing');
 const rests=p.notes.filter(n=>n.pitch===null);const rh=new Set(ns.map(n=>n.duration));
 return {step:ds.filter(d=>Math.abs(d)<=2).length/Math.max(1,ds.length),leap:ds.filter(d=>Math.abs(d)>7).length/Math.max(1,ds.length),repeat:ds.filter(d=>d===0).length/Math.max(1,ds.length),turn:pairs.filter(([a,b])=>a*b<0).length/Math.max(1,pairs.length),density:ns.length/(p.progression.bars*4),restFraction:rests.reduce((a,n)=>a+n.duration,0)/(p.progression.bars*4),strongChord:strong.filter(n=>chordAt(p.progression,n.start).tones.includes(pc(n.pitch!))).length/Math.max(1,strong.length),landingChord:land.filter(n=>chordAt(p.progression,n.start).tones.includes(pc(n.pitch!))).length/Math.max(1,land.length),rhythmValues:rh.size,intervals:ds};
}
const quant=(v:number[],q:number)=>{const a=[...v].sort((a,b)=>a-b),i=(a.length-1)*q;return a[Math.floor(i)]+(a[Math.ceil(i)]-a[Math.floor(i)])*(i%1);};
const rows:any[]=[],examples:any[]=[];const begin=performance.now();
for(let preset=0;preset<PRESETS.length;preset++)for(const bpm of [80,140,200,280])for(let seed=1;seed<=30;seed++){
 const progression=parseProgression(PRESETS[preset].text);
 for(const version of ['v1','v2']){
  const p=(version==='v1'?oldGenerate:generate)(progression,bpm,60,84,seed,version==='v1'?oldModel:model);
  const events=(version==='v1'?oldPerform:perform)(p,bpm,version==='v1'?oldModel:model);
  assert.equal(events.filter(e=>e.part==='solo').length,p.notes.filter(n=>n.pitch!==null).length);
  assert(Math.abs(p.notes.reduce((a,n)=>a+n.duration,0)-progression.bars*4)<1e-6);
  assert(p.notes.every(n=>n.pitch===null||n.pitch>=60&&n.pitch<=84));
  for(let i=1;i<p.notes.length;i++)assert(Math.abs(p.notes[i].start-p.notes[i-1].start-p.notes[i-1].duration)<1e-6);
  const solo=events.filter(e=>e.part==='solo');assert(solo.every(e=>e.time>=0&&e.duration>0));const overlaps=solo.slice(1).filter((e,i)=>solo[i].time+solo[i].duration>e.time+1e-6).length;if(version==='v2')assert.equal(overlaps,0);
  rows.push({version,preset,bpm,seed,overlaps,...metrics(p)});
  // Fixed before inspection; no hand-picked best examples.
  if(seed===17&&[0,1,3,5].includes(preset))examples.push({version,preset,bpm,title:PRESETS[preset].name,phrase:p,events});
 }
}
const summaries=Object.fromEntries(['v1','v2'].map(v=>[v,Object.fromEntries(['step','leap','repeat','turn','density','restFraction','strongChord','landingChord','rhythmValues'].map(k=>{const a=rows.filter(r=>r.version===v).map(r=>r[k]);return [k,{median:quant(a,.5),q25:quant(a,.25),q75:quant(a,.75)}];}))]));
const corpus=JSON.parse(readFileSync('public/research/audit-v2.json','utf8'));
const refs:any={};for(const [label,rs] of Object.entries({wjdTrain:corpus.wjd.filter((r:any)=>r.split==='train'),wjdHoldout:corpus.wjd.filter((r:any)=>r.split==='test'),jtdHoldoutProxy:corpus.jtd.filter((r:any)=>r.split==='test').map((r:any)=>r.proxy.main),jtdStrictProxy:corpus.jtd.filter((r:any)=>r.split==='test').map((r:any)=>r.proxy.strict),pijamaProxy:corpus.pijama})){const a=rs as any[];refs[label]={n:a.length,...Object.fromEntries(['step','leap','repeat','turn'].map(k=>[k,{median:quant(a.map(r=>r[k]),.5),q25:quant(a.map(r=>r[k]),.25),q75:quant(a.map(r=>r[k]),.75)}]))};}
const result={date:'2026-10-05',conditionsPerVersion:720,seconds:(performance.now()-begin)/1000,summaries,references:refs,examplesSelection:'Each of four presets x four tempi; seed 17 fixed before inspecting outputs.',limitations:['No expert listening panel. Distributional convergence is not proof of jazz authenticity.','Old WJazzD holdout has been inspected previously: regression reference, not a pristine unseen test.','Piano top-line proxies include accompaniment and are not used as melody targets.'],rows};
writeFileSync('public/research/evaluation-v2.json',JSON.stringify(result));writeFileSync('public/research/comparison-v2.json',JSON.stringify(examples));console.log(JSON.stringify({...result,rows:undefined},null,2));
