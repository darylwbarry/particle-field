import json, os, glob, sys
root="_bbl"; idx={}
for f in glob.glob(root+"/*/*.json"):
    try: d=json.load(open(f))
    except Exception: continue
    if isinstance(d,dict) and "name" in d: idx[d["name"]]=d
def flat(d):
    if d.get("inherits"):
        p=flat(idx[d["inherits"]]); out=dict(p); out.update(d)
    else: out=dict(d)
    return out
def write(src, dst, overrides):
    d=flat(src); d.update(overrides)
    d.pop("inherits",None); d["from"]="User"; d["instantiation"]="true"
    json.dump(d,open(dst,"w"),indent=1)
    return d
os.makedirs("flat",exist_ok=True)
m=write(idx["Bambu Lab P1S 0.4 nozzle"],"flat/machine.json",{})
for f in glob.glob("presets/*.json"):
    u=json.load(open(f)); base=idx[u["inherits"]]
    ov={k:v for k,v in u.items() if k not in("inherits",)}
    # match list-vs-scalar types of the base
    fb=flat(base)
    for k,v in list(ov.items()):
        if k in fb and isinstance(fb[k],list) and not isinstance(v,list): ov[k]=[v]*len(fb[k])
    d=write(base,"flat/"+os.path.basename(f),ov)
    print(f, d.get("type"), len(d))
