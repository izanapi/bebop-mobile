/** Final paired audit: fixed fresh seeds 2001–2030, no tuning against the reused 13-solo reference. */
import {readFileSync,writeFileSync} from 'node:fs';import assert from 'node:assert/strict';
import {parseProgression,chordAt,PRESETS,perform,type Phrase} from '../src/music.ts';
import {generatePhraseV23} from '../src/generator-v23.ts';import {generatePhraseV24} from '../src/generator-v24.ts';
import {auditMetrics,summarize} from './audit_metrics.ts';
const model=JSON.parse(readFileSync('public/research/model.json','utf8')),corpus=JSON.parse(readFileSync('../../work/research/audit-reference-v24.json','utf8'));
const references:any[]=[],rows:any[]=[],examples:any[]=[];
const bin=(bpm:number)=>bpm<110?'60–109':bpm<170?'110–169':bpm<240?'170–239':'240–320';
for(const s of corpus)for(const bars of [4,8]){
 const first=Math.ceil(s.notes[0].start/4)*4,last=Math.floor(s.notes.at(-1).start/4)*4;
 for(let start=first;start+bars*4<=last;start+=bars*4){const ns=s.notes.filter((n:any)=>n.start>=start&&n.start<start+bars*4);if(ns.length<6)continue;
 references.push({id:s.id,performer:s.performer,split:s.split,bpm:s.bpm,tempo:bin(s.bpm),bars,start,...auditMetrics(ns,bars*4)});}
}
function metrics(p:Phrase){const real=p.notes.filter(n=>n.pitch!==null);return auditMetrics(real.map((n,i)=>({...n,pitch:n.pitch!,tones:chordAt(p.progression,n.start).tones,root:chordAt(p.progression,n.start).root,end:!real[i+1]||real[i+1].phrase!==n.phrase})),p.progression.bars*4);}
for(let preset=0;preset<PRESETS.length;preset++)for(const bpm of [80,140,200,280])for(let seed=2001;seed<=2030;seed++)for(const version of ['v23','v24']){
 const p=(version==='v23'?generatePhraseV23:generatePhraseV24)(parseProgression(PRESETS[preset].text),bpm,60,84,seed,model);
 const events=perform(p,bpm,model),solo=events.filter(e=>e.part==='solo'),ns=p.notes.filter(n=>n.pitch!==null);
 assert(ns.every(n=>n.pitch!>=60&&n.pitch!<=84));assert.equal(solo.length,ns.length);assert(Math.abs(p.notes.reduce((s,n)=>s+n.duration,0)-p.progression.bars*4)<1e-6);
 for(let i=1;i<solo.length;i++)assert(solo[i-1].time+solo[i-1].duration<=solo[i].time+1e-6);
 for(let i=0;i<p.notes.length;i++)if(p.notes[i].role==='approach')assert.equal(Math.abs(p.notes[i].pitch!-p.notes[i+1].pitch!),1);
 rows.push({version,preset,bpm,seed,bars:p.progression.bars,tempo:bin(bpm),...metrics(p)});
 if(seed===2017&&[0,1,3,5].includes(preset))examples.push({version,preset,bpm,title:PRESETS[preset].name,phrase:p,events});
}
const groups:any[]=[];
for(const split of ['train','reference'])for(const bars of [4,8])for(const tempo of ['60–109','110–169','170–239','240–320']){
 const rs=references.filter(r=>r.split===split&&r.bars===bars&&r.tempo===tempo);groups.push({source:split,bars,tempo,windows:rs.length,solos:new Set(rs.map(r=>r.id)).size,performers:new Set(rs.map(r=>r.performer)).size,summary:summarize(rs)});
}
for(const version of ['v23','v24'])for(const bars of [4,8])for(const tempo of ['60–109','110–169','170–239','240–320']){
 const rs=rows.filter(r=>r.version===version&&r.bars===bars&&r.tempo===tempo);groups.push({source:version,bars,tempo,windows:rs.length,summary:summarize(rs)});
}
const summaries=Object.fromEntries(['train','reference','v23','v24'].map(source=>[source,summarize(source.startsWith('v')?rows.filter(r=>r.version===source):references.filter(r=>r.split===source))]));
const bySolo=corpus.map((s:any)=>({id:s.id,performer:s.performer,split:s.split,bpm:s.bpm,windows:references.filter(r=>r.id===s.id).length,summary:summarize(references.filter(r=>r.id===s.id))}));
const balanced=Object.fromEntries(['train','reference'].map(split=>[split,summarize(bySolo.filter(s=>s.split===split&&s.windows).map(s=>Object.fromEntries(Object.entries(s.summary).map(([k,v]:any)=>[k,v.median]))))]));
const independent=JSON.parse(readFileSync('public/research/evaluation-v2.json','utf8')).references;
const result={date:'2026-10-05',generator:'2.4',method:{seeds:[2001,2030],developmentSeeds:[1001,1030],perVersion:720,progressions:6,tempi:[80,140,200,280],range:[60,84],comparison:'WJazzD BEBOP only; non-overlapping complete 4/8-bar windows within each length (4 and 8 collections overlap); >=6 notes; 4/4, no subtatum ornaments. Consecutive-note metrics require same annotated phrase and IOI <=1 beat. Harmonic metrics only parseable core chords. Window summaries are descriptive, not independent trials or confidence intervals.',endOnBeat:'Only genuine annotated phrase ends, not cropped window ends.',references:'43 training solos; 13 previously inspected reference solos, NOT pristine holdout. Reference windows are not matched tunes, harmonies or instruments. Fixed seeds were not used for the candidate adjustment.'},summaries,soloBalanced:balanced,groups,bySolo,independentContext:{note:'Historical secondary context only; automatic polyphonic piano toplines, not bebop melody ground truth. Different metric/window definitions, never numerical targets for this adjustment.',jtd:independent.jtdHoldoutProxy,pijama:independent.pijamaProxy},limitations:['No expert blind listening panel or demonstrated perceptual improvement.','Interval distribution and chord-tone frequency cannot certify bebop authenticity.','Chord-scale and cadence constraints still exceed those of professional solos; no soloist imitation.','Fixed rhythm inventory and compulsory guide-tone arrivals remain restrictive.','Low and very high tempo estimates remain sparse; timing and accompaniment were deliberately held constant.'],rows,referenceWindows:references};
writeFileSync('public/research/evaluation-v24.json',JSON.stringify(result));writeFileSync('public/research/comparison-v24.json',JSON.stringify(examples));console.log(JSON.stringify({summaries,soloBalanced:balanced,counts:{train:references.filter(r=>r.split==='train').length,reference:references.filter(r=>r.split==='reference').length}},null,2));
