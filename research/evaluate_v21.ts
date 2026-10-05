import {readFileSync,writeFileSync} from 'node:fs';import assert from 'node:assert/strict';
import {parseProgression,perform,chordAt,pc,PRESETS,type Phrase,type Model} from '../src/music.ts';
import {generatePhraseV2} from '../src/generator-v2.ts';import {generatePhraseV21 as generate,findBebopCadences} from '../src/generator-v21.ts';
const model:Model=JSON.parse(readFileSync('public/research/model.json','utf8'));
function metrics(p:Phrase){
 const ns=p.notes.filter(n=>n.pitch!==null),ds=ns.slice(1).flatMap((n,i)=>n.start-ns[i].start<=2?[n.pitch!-ns[i].pitch!]:[]);
 const pairs=ds.slice(1).map((d,i)=>[ds[i],d]).filter(([a,b])=>a&&b);
 const cs=findBebopCadences(p.progression),landing=cs.filter(c=>ns.some(n=>Math.abs(n.start-c.resolve)<1e-6&&chordAt(p.progression,c.resolve).guides.includes(pc(n.pitch!)))).length;
 const groups=[...new Set(ns.map(n=>n.phrase))].map(id=>ns.filter(n=>n.phrase===id));let matches=0,eligible=0;
 for(let i=1;i<groups.length;i+=2){const a=groups[i-1],b=groups[i];if(a.length>=3&&b.length>=3){eligible++;if(a.slice(0,3).every((n,j)=>Math.abs(n.duration-b[j].duration)<1e-6)&&Math.abs(a[0].start%1-b[0].start%1)<1e-6)matches++;}}
 const joins=ns.slice(1).flatMap((n,i)=>n.phrase!==ns[i].phrase?[Math.abs(n.pitch!-ns[i].pitch!)]:[]);
 return {step:ds.filter(d=>Math.abs(d)<=2).length/Math.max(1,ds.length),turn:pairs.filter(([a,b])=>a*b<0).length/Math.max(1,pairs.length),repeat:ds.filter(d=>d===0).length/Math.max(1,ds.length),leap:ds.filter(d=>Math.abs(d)>7).length/Math.max(1,ds.length),density:ns.length/(p.progression.bars*4),cadences:cs.length,guideResolutions:landing,rhythmPairs:eligible,rhythmMatches:matches,joinIntervals:joins,enclosureNotes:ns.filter(n=>n.role==='enclosure').length};
}
const rows:any[]=[],examples:any[]=[];const begin=performance.now();
for(let preset=0;preset<PRESETS.length;preset++)for(const bpm of [80,140,200,280])for(let seed=1;seed<=30;seed++)for(const version of ['v2','v21']){
 const p=(version==='v2'?generatePhraseV2:generate)(parseProgression(PRESETS[preset].text),bpm,60,84,seed,model),ev=perform(p,bpm,model),solo=ev.filter(e=>e.part==='solo');
 assert.equal(solo.length,p.notes.filter(n=>n.pitch!==null).length);assert(p.notes.every(n=>n.duration>1e-7&&(n.pitch===null||n.pitch>=60&&n.pitch<=84)));
 for(let i=1;i<p.notes.length;i++)assert(Math.abs(p.notes[i].start-p.notes[i-1].start-p.notes[i-1].duration)<1e-6);
 for(let i=1;i<solo.length;i++)assert(solo[i-1].time+solo[i-1].duration<=solo[i].time+1e-6);
 rows.push({version,preset,bpm,seed,...metrics(p)});
 if(seed===17&&[0,1,3,5].includes(preset))examples.push({version,preset,bpm,title:PRESETS[preset].name,phrase:p,events:ev});
}
const median=(a:number[])=>{a.sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2:0;};
const sums:any={};for(const version of ['v2','v21']){const rs=rows.filter(r=>r.version===version),sum=(k:string)=>rs.reduce((s,r)=>s+r[k],0);sums[version]={...Object.fromEntries(['step','turn','repeat','leap','density'].map(k=>[k,median(rs.map(r=>r[k]))])),guideResolutionRate:sum('guideResolutions')/sum('cadences'),matchingRhythmPrefixRate:sum('rhythmMatches')/sum('rhythmPairs'),medianPhraseJoinSemitones:median(rs.flatMap(r=>r.joinIntervals)),enclosureNotes:sum('enclosureNotes')};}
const result={date:'2026-10-05',conditionsPerVersion:720,seconds:(performance.now()-begin)/1000,summaries:sums,limitations:['Development regression, not independent listening validation.','Matching rhythm prefixes can occur by chance and do not alone measure motivic coherence.','No new data or folk-song model weights used.','Original v2 and v1 reports preserved.'],rows};
writeFileSync('public/research/evaluation-v21.json',JSON.stringify(result));writeFileSync('public/research/comparison-v21.json',JSON.stringify(examples));console.log(JSON.stringify({...result,rows:undefined},null,2));
