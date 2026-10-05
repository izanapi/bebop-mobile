export type AuditNote={start:number;pitch:number;phrase:number;tones:number[]|null;root:number|null;end?:boolean};
const pc=(p:number)=>(p%12+12)%12;
export function auditMetrics(ns:AuditNote[],beats:number){
 const count:Record<string,number>={interval:0,step:0,third:0,leap:0,repeat:0,pair:0,turn:0,oscillation:0,run:0,stepRun:0,arpRun:0,strong:0,strongChord:0,nonchord:0,nonchordResolve:0,boundary:0,boundaryLeap:0,phraseEnd:0,endOnBeat:0};
 const link=(i:number)=>i>0&&ns[i].start>ns[i-1].start&&ns[i].start-ns[i-1].start<=1.01&&ns[i].phrase===ns[i-1].phrase;
 for(let i=0;i<ns.length;i++){
  const n=ns[i],p=ns[i-1],z=ns[i+1],ct=n.tones?.includes(pc(n.pitch));
  if(n.tones&&Math.abs(n.start-Math.round(n.start))<1e-6){count.strong++;if(ct)count.strongChord++;}
  if(n.tones&&!ct&&z&&link(i+1)){count.nonchord++;if(Math.abs(z.pitch-n.pitch)<=2&&z.tones?.includes(pc(z.pitch)))count.nonchordResolve++;}
  if(n.end===true){count.phraseEnd++;if(Math.abs(n.start-Math.round(n.start))<1e-6)count.endOnBeat++;}
  if(!link(i))continue;
  const d=n.pitch-p.pitch,a=Math.abs(d);count.interval++;if(a<=2)count.step++;if(a===3||a===4)count.third++;if(a>7)count.leap++;if(!a)count.repeat++;
  if(n.root!==null&&p.root!==null&&(n.root!==p.root||JSON.stringify(n.tones)!==JSON.stringify(p.tones))){count.boundary++;if(a>5)count.boundaryLeap++;}
  if(!link(i-1))continue;
  const prev=p.pitch-ns[i-2].pitch;
  if(prev&&d){count.pair++;if(prev*d<0)count.turn++;if(n.pitch===ns[i-2].pitch&&a<=2)count.oscillation++;}
  if(!link(i-2))continue;
  const ds=[ns[i-2].pitch-ns[i-3].pitch,prev,d];count.run++;
  if(ds.every(x=>Math.abs(x)>=1&&Math.abs(x)<=2)&&ds.every(x=>Math.sign(x)===Math.sign(d)))count.stepRun++;
  if(ds.every(x=>Math.abs(x)>=3&&Math.abs(x)<=5)&&ds.every(x=>Math.sign(x)===Math.sign(d)))count.arpRun++;
 }
 const motifs:string[]=[];
 for(let i=3;i<ns.length;i++)if(link(i)&&link(i-1)&&link(i-2))motifs.push([1,2,3].map(j=>`${ns[i-3+j].pitch-ns[i-4+j].pitch}:${Math.round((ns[i-3+j].start-ns[i-4+j].start)*6)}`).join(','));
 const freq=new Map<string,number>();for(const m of motifs)freq.set(m,(freq.get(m)??0)+1);
 const motifRepeat=motifs.length?motifs.filter(m=>freq.get(m)!>1).length/motifs.length:0;
 const ratio=(a:string,b:string)=>count[b]?count[a]/count[b]:null;
 return {motifRepeat,notes:ns.length,density:ns.length/beats,span:ns.length?Math.max(...ns.map(n=>n.pitch))-Math.min(...ns.map(n=>n.pitch)):0,step:ratio('step','interval'),third:ratio('third','interval'),leap:ratio('leap','interval'),repeat:ratio('repeat','interval'),turn:ratio('turn','pair'),oscillation:ratio('oscillation','pair'),stepRun:ratio('stepRun','run'),arpRun:ratio('arpRun','run'),strongChord:ratio('strongChord','strong'),nonchordResolve:ratio('nonchordResolve','nonchord'),boundaryLeap:ratio('boundaryLeap','boundary'),endOnBeat:ratio('endOnBeat','phraseEnd'),counts:count};
}
export function summarize(rows:any[]){const keys=['motifRepeat','density','span','step','third','leap','repeat','turn','oscillation','stepRun','arpRun','strongChord','nonchordResolve','boundaryLeap','endOnBeat'];return Object.fromEntries(keys.map(k=>{const a=rows.map(r=>r[k]).filter(v=>v!==null).sort((a,b)=>a-b);const q=(p:number)=>{const i=(a.length-1)*p;return a.length?a[Math.floor(i)]+(a[Math.ceil(i)]-a[Math.floor(i)])*(i%1):null;};return [k,{n:a.length,median:q(.5),q25:q(.25),q75:q(.75)}];}));}
