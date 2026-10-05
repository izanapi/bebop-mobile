import {readFileSync,writeFileSync} from 'node:fs';import assert from 'node:assert/strict';
import {parseProgression,perform,type Phrase} from '../src/music.ts';import {generatePhraseV21} from '../src/generator-v21.ts';import {generate as v1} from './baseline/music-v1.ts';
import {generatePhraseV22 as generate} from '../src/generator-v22.ts';
const model=JSON.parse(readFileSync('public/research/model.json','utf8')),old=JSON.parse(readFileSync('research/baseline/model-v1.json','utf8'));
const median=(a:number[])=>{a.sort((a,b)=>a-b);return(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2;};
const rows:any[]=[],examples:any[]=[];
for(const [label,text,bpm,low,high] of [['major140','Dm7 | G7 | Cmaj7 | C6 |',140,60,84],['minor140','Dm7b5 | G7b9 | Cm6 | Cm6 |',140,60,84],['major280','Dm7 | G7 | Cmaj7 | C6 |',280,60,84],['oneOctave','Dm7 | G7 | Cmaj7 | C6 |',140,60,72],['lowRegister','Dm7 | G7 | Cmaj7 | C6 |',140,48,72],['wide','Dm7 | G7 | Cmaj7 | C6 |',140,48,84]] as const){
 for(const version of ['v1','v21','v22']){
 const records:any[]=[];
 for(let seed=1;seed<=200;seed++){
  const p:Phrase=(version==='v1'?v1:version==='v21'?generatePhraseV21:generate)(parseProgression(text),bpm,low,high,seed,version==='v1'?old:model);
  const ns=p.notes.filter(n=>n.pitch!==null&&n.duration>1e-6),ds=ns.slice(1).filter((n,i)=>n.start-ns[i].start<=2).map(n=>{const i=ns.indexOf(n);return Math.abs(n.pitch!-ns[i-1].pitch!);});
  assert(ns.every(n=>n.pitch!>=low&&n.pitch!<=high));assert(Math.abs(p.notes.reduce((s,n)=>s+n.duration,0)-16)<1e-6);
  const min=Math.min(...ns.map(n=>n.pitch!)),max=Math.max(...ns.map(n=>n.pitch!));
  records.push({span:max-min,min,max,step:ds.filter(d=>d<=2).length/ds.length,third:ds.filter(d=>d===3||d===4).length/ds.length,fourthFifth:ds.filter(d=>d>=5&&d<=7).length/ds.length,large:ds.filter(d=>d>7).length/ds.length});
  if(seed===17&&['major140','minor140','major280'].includes(label))examples.push({version,label,preset:label==='minor140'?1:0,title:label==='minor140'?'ii–V–i / minor':'ii–V–I / major',bpm,phrase:p,events:perform(p,bpm,version==='v1'?old:model)});
 }
 rows.push({version,label,bpm,low,high,n:200,median:Object.fromEntries(['span','step','third','fourthFifth','large'].map(k=>[k,median(records.map(r=>r[k]))])),phrasesWithLargeLeap:records.filter(r=>r.large>0).length,records});
 }}
writeFileSync('public/research/evaluation-v22.json',JSON.stringify({date:'2026-10-05',method:'200 seeds per condition, inter-onset gap <= 2 beats; step includes repetitions. Development audit, not listening evaluation.',rows}));
writeFileSync('public/research/comparison-v22.json',JSON.stringify(examples));console.log(JSON.stringify(rows.map(({records,...r})=>r),null,2));
