"""Reproducible WJazzD analysis. Standard Python only; raw files stay outside app.
Usage: python3 research/analyze.py --raw /path/to/raw --out public/research
Derived data: ODbL 1.0; database contents: DbCL 1.0. See NOTICE.txt.
"""
import argparse, collections, hashlib, json, math, pathlib, re, sqlite3, statistics, struct, zipfile

def quantile(a, p):
    if not a: return None
    a=sorted(a); f=(len(a)-1)*p; i=int(f)
    return a[i]+(a[min(i+1,len(a)-1)]-a[i])*(f-i)
def summary(a):
    a=[float(x) for x in a if x is not None and math.isfinite(x)]
    return dict(n=len(a), median=quantile(a,.5), q25=quantile(a,.25), q75=quantile(a,.75))
def med(a): return statistics.median(a) if a else None
def pitchclass(name):
    m=re.match(r'^([A-G])([b#]?)',name)
    return ((dict(C=0,D=2,E=4,F=5,G=7,A=9,B=11)[m[1]] + {'':0,'b':-1,'#':1}[m[2]])%12,m.end()) if m else (None,0)
def chord_pcs(label):
    root,n=pitchclass(label)
    if root is None: return None
    s=label[n:].split('/')[0]
    # Deliberately limited corpus parser: uncertain labels excluded from harmonic statistics.
    quality={'':[0,4,7],'7':[0,4,7,10],'j7':[0,4,7,11],'maj7':[0,4,7,11],
      '-':[0,3,7],'-7':[0,3,7,10],'m7':[0,3,7,10],'6':[0,4,7,9],'-6':[0,3,7,9],
      'o':[0,3,6,9],'o7':[0,3,6,9],'dim7':[0,3,6,9],'-7b5':[0,3,6,10],'m7b5':[0,3,6,10],
      'sus7':[0,5,7,10],'7sus':[0,5,7,10],'7sus4':[0,5,7,10],'+':[0,4,8]}
    if s not in quality: return None
    return root,[(root+x)%12 for x in quality[s]]
def midi_notes(data):
    assert data[:4]==b'MThd'
    size=struct.unpack('>I',data[4:8])[0]; fmt,trks,ppq=struct.unpack('>HHH',data[8:14])
    fps=256-(ppq>>8) if ppq>=32768 else None
    p=8+size; notes=[]; tempos=[(0,500000)]; pending={}
    def vlq(b,i):
        v=0
        while True:
            c=b[i];i+=1;v=(v<<7)|(c&127)
            if c<128:return v,i
    for track in range(trks):
        assert data[p:p+4]==b'MTrk'
        l=struct.unpack('>I',data[p+4:p+8])[0]; b=data[p+8:p+8+l]; p+=8+l
        i=tick=0;running=None
        while i<len(b):
            delta,i=vlq(b,i);tick+=delta
            if b[i]>=128: status=b[i];i+=1;running=status if status<240 else running
            else: status=running
            if status==255:
                typ=b[i];i+=1;n,i=vlq(b,i); payload=b[i:i+n];i+=n
                if typ==81:tempos.append((tick,int.from_bytes(payload,'big')))
                continue
            if status in (240,247): n,i=vlq(b,i);i+=n;continue
            n=1 if status>>4 in (12,13) else 2; payload=b[i:i+n];i+=n
            key=(track,status&15,payload[0])
            if status>>4==9 and payload[1]>0:pending[key]=(tick,payload[1])
            elif status>>4==8 or (status>>4==9 and payload[1]==0):
                if key in pending:
                    start,vel=pending.pop(key);notes.append((start,tick,payload[0],vel))
    tm=sorted(dict(tempos).items())
    def seconds(t):
        if fps:return t/((29.97 if fps==29 else fps)*(ppq&255))
        result=0
        for j,(at,us) in enumerate(tm):
            end=min(t,tm[j+1][0] if j+1<len(tm) else t)
            if end>at:result+=(end-at)*us/1e6/ppq
            if end==t:break
        return result
    return [(seconds(a),seconds(b)-seconds(a),pitch,vel) for a,b,pitch,vel in sorted(notes)]

def analyze(raw,out):
    out.mkdir(parents=True,exist_ok=True)
    db=raw/'wjazzd.db'; c=sqlite3.connect(db);c.row_factory=sqlite3.Row
    solos=[dict(r) for r in c.execute('select * from solo_info order by melid')]
    rows=[]; train_intervals=collections.Counter(); train_degrees=collections.Counter()
    for s in solos:
        mid=s['melid']; ns=[dict(r) for r in c.execute('select * from melody where melid=? order by onset,eventid',(mid,))]
        bs=[dict(r) for r in c.execute('select * from beats where melid=? order by onset',(mid,))]
        active='NC';bm={}
        for j,b in enumerate(bs):
            active=b['chord'] or active;b['active']=active
            b['length']=bs[j+1]['onset']-b['onset'] if j+1<len(bs) else 60/s['avgtempo']
            bm[(b['bar'],b['beat'])]=b
        # Split by recorded track, not notes or solos; deterministic and auditable.
        split='test' if int(hashlib.sha256(('bebop-v1:'+str(s['trackid'])).encode()).hexdigest()[:8],16)%5==0 else 'train'
        intervals=[]; pos_on=[];pos_off=[];gates=[];rests=[];degrees=[];strong=[];resolved=[];phrases=[];phrase_ends=[];rhythms=collections.Counter();motive=[]
        for j,n in enumerate(ns):
            b=bm.get((n['bar'],n['beat']))
            if not b or n['num']!=4 or n['denom']!=4 or b['length']<=0:continue
            length=b['length'];p=(n['onset']-b['onset'])/length
            rhythm=str(n['division']);rhythms[rhythm]+=1
            if n['subtatum']==0 and n['division'] in (1,2):
                if n['tatum']==1 and -.15<=p<=.25:pos_on.append(p)
                elif n['division']==2 and n['tatum']==2 and .35<=p<=.9:pos_off.append(p)
            ch=chord_pcs(b['active'])
            if ch:
                d=(round(n['pitch'])-ch[0])%12;degrees.append(d)
                if n['tatum']==1 and n['subtatum']==0:strong.append(int(round(n['pitch'])%12 in ch[1]))
                if j>0 and abs(ns[j-1]['pitch']-n['pitch'])==1:resolved.append(int(round(n['pitch'])%12 in ch[1]))
            if j+1<len(ns):
                following=ns[j+1];ioi=following['onset']-n['onset']
                if ioi>0:gates.append(min(1.5,n['duration']/ioi));rests.append(max(0,(ioi-n['duration'])/length))
                intervals.append(int(round(following['pitch']-n['pitch'])))
        for ph in c.execute("select start,end from sections where melid=? and type='PHRASE'",(mid,)):
            start,end=ph
            if 0<=start<=end<len(ns):
                a,z=ns[start],ns[end]; phrases.append((z['onset']+z['duration']-a['onset'])*s['avgtempo']/60/4)
                b=bm.get((z['bar'],z['beat']));ch=chord_pcs(b['active']) if b else None
                if ch:phrase_ends.append(int(round(z['pitch'])%12 in ch[1]))
        for j in range(len(intervals)-3):motive.append(tuple(intervals[j:j+4]))
        counts=collections.Counter(motive)
        row=dict(melid=mid,trackid=s['trackid'],performer=s['performer'],title=s['title'],style=s['style'],bpm=s['avgtempo'],split=split,notes=len(ns),
          notesPerBeat=len(ns)/max(1,len(bs)),intervals=dict(collections.Counter(intervals)),pitchRange=[min(n['pitch'] for n in ns),max(n['pitch'] for n in ns)],
          on=summary(pos_on),off=summary(pos_off),gate=summary(gates),gapBeats=summary(rests),phrasesBars=summary(phrases),
          degreeCounts=dict(collections.Counter(degrees)),strongChordTone=summary(strong),semitoneToChord=summary(resolved),phraseEndChord=summary(phrase_ends),
          strongChordRate=sum(strong)/len(strong) if strong else None,endChordRate=sum(phrase_ends)/len(phrase_ends) if phrase_ends else None,
          repeatedFourIntervalFraction=sum(v for v in counts.values() if v>1)/max(1,len(motive)),rhythms=dict(rhythms))
        rows.append(row)
        if s['style']=='BEBOP' and split=='train':train_intervals.update(intervals);train_degrees.update(degrees)
    def group(items):
        return dict(solos=len(items),notes=sum(r['notes'] for r in items),density=summary([r['notesPerBeat'] for r in items]),
          on=summary([r['on']['median'] for r in items if r['on']['n']>=20]),off=summary([r['off']['median'] for r in items if r['off']['n']>=20]),
          gate=summary([r['gate']['median'] for r in items]),phraseBars=summary([r['phrasesBars']['median'] for r in items]),
          strongChordRate=summary([r['strongChordRate'] for r in items]),endChordRate=summary([r['endChordRate'] for r in items]),
          repeatedMotifs=summary([r['repeatedFourIntervalFraction'] for r in items]),
          intervalCounts=dict(sum((collections.Counter(r['intervals']) for r in items),collections.Counter())))
    bebop=[r for r in rows if r['style']=='BEBOP'];training=[r for r in bebop if r['split']=='train'];testing=[r for r in bebop if r['split']=='test']
    bins=[]
    for low,high in [(60,100),(100,140),(140,180),(180,220),(220,260),(260,321)]:
        items=[r for r in training if low<=r['bpm']<high]
        bins.append(dict(low=low,high=high,center=med([r['bpm'] for r in items]) or (low+high)/2,**group(items)))
    # MIDI integrity and pitch/duration correspondence; no MIDI performances shipped.
    z=zipfile.ZipFile(raw/'midi.zip'); midi_rows=[]
    for name in sorted(z.namelist()):
        if not name.lower().endswith('.mid'):continue
        notes=midi_notes(z.read(name))
        midi_rows.append(dict(file=name,notes=len(notes),positiveDurations=all(n[1]>0 for n in notes),pitchRange=[min(n[2] for n in notes),max(n[2] for n in notes)]))
    parker=next(n for n in z.namelist() if 'CharlieParker' in n and 'Bill' in n)
    parsed=midi_notes(z.read(parker)); original=list(c.execute('select onset,duration,pitch from melody where melid=52 order by onset'))
    align=dict(file=parker,midiNotes=len(parsed),dbNotes=len(original),pitchesMatch=len(parsed)==len(original) and all(m[2]==d[2] for m,d in zip(parsed,original)))
    if align['pitchesMatch']:
        offset=parsed[0][0]-original[0][0]
        align['maxOnsetErrorAfterOffsetSeconds']=max(abs((m[0]-d[0])-offset) for m,d in zip(parsed,original))
        align['maxDurationErrorSeconds']=max(abs(m[1]-d[1]) for m,d in zip(parsed,original))
    manifest=dict(date='2026-10-05',source='https://jazzomat.hfm-weimar.de/download/download.html',database=dict(c.execute('select * from db_info').fetchone()),
      sha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [db,raw/'midi.zip']},midiCount=len(midi_rows),alignment=align)
    result=dict(manifest=manifest,methods=dict(split='sha256(bebop-v1:trackid) first 8 hex modulo 5 == 0 → test',
      timing='4/4 only; subtatum=0; division=1/2 tatum=1 onsets; division=2 tatum=2 offbeats; local annotated beat duration. Per-solo medians, then median/IQR across solos (>=20 notes per statistic). Not an exact replication of Nelias et al.',
      limitations=['Tapped beats are an annotated reference, not measured drum offbeats.','IQR is dispersion, not confidence interval.','Corpus chord parser intentionally excludes unsupported labels.','Four-interval repetition is an exact transposition-invariant proxy, not complete motif recognition.','Articulation gap is not a notated rest.','Timing summaries exclude triplets, sixteenths and ornaments.']),
      styles={style:group([r for r in rows if r['style']==style]) for style in sorted(set(r['style'] for r in rows))},train=group(training),test=group(testing),tempoBins=bins,solos=rows,midi=midi_rows)
    model=dict(version='wjazzd-bebop-1.0',license='ODbL-1.0',source=manifest['source'],trainingIds=[r['melid'] for r in training],testIds=[r['melid'] for r in testing],
      intervalCounts=dict(train_intervals),degreeCounts=dict(train_degrees),tempoBins=bins,aggregate=group(training))
    for name,data in [('analysis.json',result),('model.json',model)]: (out/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(dict(bebop=len(bebop),train=len(training),test=len(testing),midi=align,bins=bins),ensure_ascii=False,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--raw',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,required=True);a=p.parse_args();analyze(a.raw,a.out)
