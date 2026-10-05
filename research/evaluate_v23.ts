import {generatePhraseV23 as generate} from '../src/generator-v23.ts';
import {readFileSync,writeFileSync} from 'node:fs';import assert from 'node:assert/strict';
import {parseProgression,chordAt,pc,perform,PRESETS} from '../src/music.ts';import {generatePhraseV22} from '../src/generator-v22.ts';
const model=JSON.parse(readFileSync('public/research/model.json','utf8')),rows:any[]=[],examples:any[]=[];
for(let preset=0;preset<PRESETS.length;preset++)for(const bpm of [80,140,200,280])for(const version of ['v22','v23']){
 let count=0,chrom=0,resolved=0,thirds=0,intervals=0;const spans:number[]=[];
 for(let seed=1;seed<=30;seed++){
 const p=(version==='v22'?generatePhraseV22:generate)(parseProgression(PRESETS[preset].text),bpm,60,84,seed,model),ns=p.notes.filter(n=>n.pitch!==null);
 assert(ns.every(n=>n.pitch!>=60&&n.pitch!<=84));
 for(let i=0;i<ns.length;i++){const n=ns[i];count++;if(!chordAt(p.progression,n.start).scale.includes(pc(n.pitch!))){chrom++;if(ns[i+1]&&Math.abs(ns[i+1].pitch!-n.pitch!)===1)resolved++;}if(i&&n.start-ns[i-1].start<=2){intervals++;if([3,4].includes(Math.abs(n.pitch!-ns[i-1].pitch!)))thirds++;}}
 for(let i=0;i<p.notes.length;i++){const n=p.notes[i];if(n.role==='approach'){assert(p.notes[i+1]?.pitch!==null);assert.equal(Math.abs(n.pitch!-p.notes[i+1].pitch!),1);}}
 spans.push(Math.max(...ns.map(n=>n.pitch!))-Math.min(...ns.map(n=>n.pitch!)));
 const events=perform(p,bpm,model),solo=events.filter(e=>e.part==='solo');assert.equal(solo.length,ns.length);for(let i=1;i<solo.length;i++)assert(solo[i-1].time+solo[i-1].duration<=solo[i].time+1e-6);
 if(seed===17&&[0,1,3,5].includes(preset))examples.push({version,preset,bpm,title:PRESETS[preset].name,phrase:p,events});
 }
 spans.sort((a,b)=>a-b);rows.push({preset,bpm,version,phrases:30,notes:count,outsideScale:chrom,chromaticSemitoneResolutions:resolved,thirds,intervals,medianSpan:(spans[14]+spans[15])/2});
}
writeFileSync('public/research/evaluation-v23.json',JSON.stringify({date:'2026-10-05',method:'6 presets x 4 tempi x 30 seeds per version, C4–C6. Timing model unchanged. Development diagnostics, not listening quality scores.',rows}));writeFileSync('public/research/comparison-v23.json',JSON.stringify(examples));
for(const version of ['v22','v23']){const rs=rows.filter(r=>r.version===version),sum=(k:string)=>rs.reduce((s,r)=>s+r[k],0);console.log({version,phrases:sum('phrases'),outsideScalePercent:100*sum('outsideScale')/sum('notes'),resolvedChromaticPercent:100*sum('chromaticSemitoneResolutions')/sum('notes'),thirdPercent:100*sum('thirds')/sum('intervals')});}
