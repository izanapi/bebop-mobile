"""Export local-only WJazzD bebop audit rows; never bundle note-level corpus data."""
import sqlite3,json,pathlib,hashlib
from analyze import chord_pcs
root=pathlib.Path(__file__).resolve().parents[1]
db=root/'../../work/research/raw/wjazzd.db'; c=sqlite3.connect(db);c.row_factory=sqlite3.Row
model=json.load(open(root/'public/research/model.json'));out=[]
for s in c.execute("select * from solo_info where style='BEBOP' order by melid"):
 bs=list(c.execute('select * from beats where melid=? order by onset',(s['melid'],)));active='NC';bm={}
 for b in bs:
  active=b['chord'] or active;bm[(b['bar'],b['beat'])]=chord_pcs(active)
 ns=list(c.execute('select * from melody where melid=? order by onset,eventid',(s['melid'],)));ph={}
 for j,p in enumerate(c.execute("select * from sections where melid=? and type='PHRASE'",(s['melid'],))):
  for i in range(p['start'],p['end']+1):ph[i]=j
 rows=[]
 for i,n in enumerate(ns):
  if n['num']!=4 or n['denom']!=4 or n['subtatum']!=0:continue
  ch=bm.get((n['bar'],n['beat']))
  rows.append(dict(start=n['bar']*4+n['beat']-1+(n['tatum']-1)/max(1,n['division']),pitch=int(n['pitch']),phrase=ph.get(i,-1),tones=ch[1] if ch else None,root=ch[0] if ch else None,end=i==len(ns)-1 or ph.get(i,-1)!=ph.get(i+1,-1)))
 out.append(dict(id=s['melid'],track=s['trackid'],performer=s['performer'],bpm=s['avgtempo'],split='train' if s['melid'] in model['trainingIds'] else 'reference',notes=rows))
p=root/'../../work/research/audit-reference-v24.json';p.write_text(json.dumps(out));print('Exported',len(out),'solos to local-only',p)
