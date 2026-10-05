"""V2: independent-corpus audit and phrase syntax. Standard library; no audio downloaded.
python3 research/analyze_v2.py --raw ../../work/research --out public/research
WJazzD rhythm/interval aggregates: ODbL. JTD annotations: MIT. PiJAMA: CC BY-NC 4.0 (audit only).
"""
import argparse,bisect,collections,csv,hashlib,io,json,math,pathlib,sqlite3,statistics,zipfile
from analyze import midi_notes,summary,med

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def split(s):return 'test' if int(hashlib.sha256(('independent-v2:'+s).encode()).hexdigest()[:8],16)%5==0 else 'train'
def norm(s):return ''.join(c.lower() for c in s if c.isalnum())
def features(seq):
    # seq = (beat-relative onset, pitch); break at gaps > 2 beats.
    ds=[b[1]-a[1] for a,b in zip(seq,seq[1:]) if 0<b[0]-a[0]<=2]
    pairs=[(b[1]-a[1],c[1]-b[1]) for a,b,c in zip(seq,seq[1:],seq[2:]) if 0<b[0]-a[0]<=2 and 0<c[0]-b[0]<=2]
    nz=[(a,b) for a,b in pairs if a and b]
    return dict(notes=len(seq),step=sum(abs(d)<=2 for d in ds)/max(1,len(ds)),leap=sum(abs(d)>7 for d in ds)/max(1,len(ds)),repeat=sum(d==0 for d in ds)/max(1,len(ds)),turn=sum(a*b<0 for a,b in nz)/max(1,len(nz)),intervals=dict(collections.Counter(ds)))
def topline(ns,cluster=.04,floor=55):
    out=[];group=[]
    for n in ns:
        if n[1]<.045 or n[2]<floor or n[3]<15:continue
        if group and n[0]-group[0][0]>cluster:
            out.append(max(group,key=lambda x:x[2]));group=[]
        group.append(n)
    if group:out.append(max(group,key=lambda x:x[2]))
    return out

def main(raw,out):
    out.mkdir(exist_ok=True,parents=True);base=raw/'raw';ind=raw/'independent'
    db=sqlite3.connect(base/'wjazzd.db');db.row_factory=sqlite3.Row
    model=json.load(open(out/'model.json'));ids=set(model['trainingIds']);testids=set(model['testIds'])
    intervals=collections.Counter();bi=collections.defaultdict(collections.Counter);tri=collections.defaultdict(collections.Counter);patterns=collections.Counter();sources=collections.defaultdict(set);starts=collections.Counter();ref=[];rhythm_audit=[];triplet_beats=total_beats=0
    wj_titles={(norm(s['performer']),norm(s['title'])) for s in db.execute('select * from solo_info')}
    for s in db.execute("select * from solo_info where style='BEBOP'"):
        ns=[dict(n) for n in db.execute('select * from melody where melid=? order by onset,eventid',(s['melid'],))]
        if s['melid'] in ids:
            groups=collections.defaultdict(list)
            for n in ns:groups[(n['bar'],n['beat'])].append(n)
            total_beats+=len(groups)
            triplet_beats+=sum(len(v)==3 and all(n['division']==3 for n in v) and {n['tatum'] for n in v}=={1,2,3} for v in groups.values())
        seq=[(n['bar']*4+n['beat']-1+(n['tatum']-1)/max(1,n['division']),int(n['pitch'])) for n in ns]
        ref.append(dict(id=s['melid'],performer=s['performer'],split='train' if s['melid'] in ids else 'test',**features(seq)))
        for ph in db.execute("select start,end from sections where melid=? and type='PHRASE'",(s['melid'],)):
            part=ns[ph['start']:ph['end']+1]
            if len(part)<4:continue
            ds=[int(b['pitch']-a['pitch']) for a,b in zip(part,part[1:])]
            if s['melid'] in ids:
                for i,d in enumerate(ds):
                    if abs(d)>12:continue
                    intervals[d]+=1
                    if i and abs(ds[i-1])<=12:bi[str(ds[i-1])][d]+=1
                    if i>=2 and max(abs(ds[i-1]),abs(ds[i-2]))<=12:tri[f'{ds[i-2]},{ds[i-1]}'][d]+=1
            # Reduce to an eighth-note practice grid. 16ths/ornaments collapse; no microtiming inference.
            pos=sorted(set(round((n['bar']*4+n['beat']-1+(n['tatum']-1)/max(1,n['division']))*2)/2 for n in part if n['num']==4 and n['denom']==4))
            if len(pos)<4:continue
            durations=[round(b-a,3) for a,b in zip(pos,pos[1:])]
            tail=max(.5,min(2,round(part[-1]['duration']/max(.15,part[-1]['beatdur'])*2)/2))
            durations.append(tail)
            if any(d not in [.5,1,1.5,2] for d in durations) or not 2<=sum(durations)<=12 or len(durations)>24:continue
            rhythm_audit.append({'split':'train' if s['melid'] in ids else 'test','span':sum(durations),'startPhase':pos[0]%4,'durations':durations})
            if s['melid'] in ids:
                k=','.join(map(str,durations));patterns[k]+=1;sources[k].add(s['melid']);starts[str(pos[0]%4)]+=1
    # Common rhythm patterns only; no literal melodic fragments are distributed.
    rhythm=[dict(durations=list(map(float,k.split(','))),count=v,solos=len(sources[k])) for k,v in patterns.items() if v>=2]
    syntax=dict(version='phrase-syntax-2.0',tripletBeatRate=triplet_beats/max(1,total_beats),intervals=dict(intervals),bigram=dict(bi),trigram={k:dict(v) for k,v in tri.items() if sum(v.values())>=5},rhythms=rhythm,startPhases=dict(starts))
    # Jazz Trio Database: beat-normalized timing and sensitivity-tested top-line proxy.
    z=zipfile.ZipFile(ind/'jtd.zip');jtd=[];excluded=[]
    for name in sorted(n for n in z.namelist() if n.endswith('metadata.json')):
        m=json.loads(z.read(name));folder=name.rsplit('/',1)[0]+'/';identity=(norm(m['musicians']['pianist']),norm(m['track_name']))
        if identity in wj_titles:excluded.append(m['fname']);continue
        rows=list(csv.DictReader(io.StringIO(z.read(folder+'beats.csv').decode())));beats=[float(r['beats']) for r in rows]; lengths=[b-a for a,b in zip(beats,beats[1:])]
        if len(beats)<20 or m['time_signature']!=4:continue
        onsets={part:[float(r[0]) for r in list(csv.reader(io.StringIO(z.read(folder+part+'_onsets.csv').decode())))[1:] if r] for part in []}
        for part in ['piano','drums']:
            rr=list(csv.reader(io.StringIO(z.read(folder+part+'_onsets.csv').decode())));onsets[part]=[float(r[-1]) for r in rr if r and r[-1]]
        on=[];off=[];drumoff=[];solooff=[];lag=[];offlag=[]
        for i,length in enumerate(lengths):
            if not .18<length<1:continue
            row=rows[i]
            if row['piano'] and row['drums']:
                v=(float(row['piano'])-float(row['drums']))/length
                if abs(v)<.2:lag.append(v)
                on.append((float(row['piano'])-beats[i])/length)
            found={}
            for part in ['piano','drums']:
                arr=onsets[part];a=bisect.bisect_left(arr,beats[i]+length*.35);b=bisect.bisect_right(arr,beats[i]+length*.85)
                if b-a==1:found[part]=(arr[a]-beats[i])/length
            if 'piano' in found and row['piano']:off.append(found['piano'])
            if 'drums' in found and row['drums']:drumoff.append(found['drums']-(float(row['drums'])-beats[i])/length)
            if 'piano' in found and row['drums']:solooff.append(found['piano']-(float(row['drums'])-beats[i])/length)
            if len(found)==2:offlag.append(found['piano']-found['drums'])
        ns=midi_notes(z.read(folder+'piano_midi.mid'));proxies={}
        for label,cluster,floor in [('main',.04,55),('strict',.025,60)]:
            top=topline(ns,cluster,floor);seq=[]
            for n in top:
                i=bisect.bisect_right(beats,n[0])-1
                if 0<=i<len(lengths) and lengths[i]>0:seq.append((i+(n[0]-beats[i])/lengths[i],n[2]))
            proxies[label]=features(seq)
        jtd.append(dict(id=m['fname'],performer=m['musicians']['pianist'],title=m['track_name'],bpm=m['tempo'],split=split(m['mbz_id']),on=summary(on),off=summary(off),drumOff=summary(drumoff),soloOff=summary(solooff),pianoDrumLag=summary(lag),offbeatLag=summary(offlag),proxy=proxies))
    # Performer-balanced timing; held-out records never contribute to the model.
    ensemble=[]
    for low,high in [(60,100),(100,140),(140,180),(180,220),(220,260),(260,321)]:
        tracks=[t for t in jtd if t['split']=='train' and low<=t['bpm']<high];row=dict(low=low,high=high,tracks=len(tracks),performers=len(set(t['performer'] for t in tracks)))
        for field in ['on','off','drumOff','soloOff','pianoDrumLag','offbeatLag']:
            per=collections.defaultdict(list)
            for t in tracks:
                if t[field]['n']>=20:per[t['performer']].append(t[field]['median'])
            row[field]=summary([med(v) for v in per.values()])
        ensemble.append(row)
    # PiJAMA is an independent, solo-piano audit only (not a model-training source).
    pz=zipfile.ZipFile(ind/'pijama-midi.zip');members=set(pz.namelist());pijama=[];missing=0
    for m in csv.DictReader(open(ind/'pijama.csv')):
        name=m['midi_filepath'].removeprefix('data/')
        if name not in members:missing+=1;continue
        if (norm(m['artist']),norm(m['title'])) in wj_titles:continue
        ns=midi_notes(pz.read(name));a=float(m['performance_start_sec']);b=float(m['performance_end_sec']);ns=[n for n in ns if a<=n[0]<b]
        top=topline(ns);ds=[b[0]-a[0] for a,b in zip(top,top[1:]) if .08<b[0]-a[0]<.8];ioi=med(ds) or .25
        # No beat labels: onset-gap normalization is only a segmentation proxy, never BPM/swing.
        f=features([(n[0]/(ioi*2),n[2]) for n in top]);pijama.append(dict(id=m['id'],performer=m['artist'],title=m['title'],split=m['split'],**f))
    syntax['ensemble']=ensemble;model['syntax']=syntax;model['version']='wjazzd-bebop-2.0+jtd-timing-audit';
    (out/'model.json').write_text(json.dumps(model,ensure_ascii=False,separators=(',',':')))
    result=dict(date='2026-10-05',manifests={n:dict(sha256=digest(ind/n),bytes=(ind/n).stat().st_size) for n in ['jtd.zip','pijama-midi.zip','pijama.csv']},wjd=ref,rhythmAudit=rhythm_audit,jtd=jtd,jtdExcludedTitleArtistMatches=excluded,pijama=pijama,pijamaMissingFiles=missing,ensemble=ensemble,trainingRhythms=len(rhythm),limitations=['JTD and PiJAMA are automatic polyphonic piano transcriptions, not bebop melody ground truth.','Top-note clustering is a proxy; accompaniment can remain. Two thresholds are reported for JTD.','No swing or BPM is inferred from PiJAMA.','JTD automatic beat matching can bias timing toward the reference grid.','Same-title/performer matches to WJazzD conservatively excluded from both additional corpora.','PiJAMA is evaluation only. No PiJAMA notes, MIDI or learned weights are shipped.'])
    (out/'audit-v2.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')))
    print(json.dumps(dict(jtd=len(jtd),pijama=len(pijama),excluded=len(excluded),rhythms=len(rhythm),ensemble=ensemble),ensure_ascii=False,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--raw',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,required=True);a=p.parse_args();main(a.raw,a.out)
