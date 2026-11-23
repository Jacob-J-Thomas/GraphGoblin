import hashlib, json, pathlib, subprocess, sys
W,E,S=map(pathlib.Path,sys.argv[1:4])
HEAD='0f500bd9355d22a7497f5e4e211a85376a53151f'
def git(*args): return subprocess.check_output(['git','--no-optional-locks','-C',str(W),*args])
assert git('rev-parse','HEAD').decode().strip()==HEAD
files=git('ls-tree','-rz',HEAD,'--','apps/web/src','apps/web/package.json','apps/web/tsconfig.json','apps/web/vitest.config.ts','tsconfig.base.json')
members=[]
for item in files.split(b'\0'):
    if not item: continue
    meta, path=item.split(b'\t',1)
    mode,typ,oid=meta.decode().split()
    assert typ=='blob'
    path=path.decode()
    data=(W/path).read_bytes()
    def asblob(b): return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
    if asblob(data)!=oid: data=git('cat-file','blob',oid)
    assert asblob(data)==oid
    target=S/'source'/path
    target.parent.mkdir(parents=True,exist_ok=True)
    with target.open('xb') as f: f.write(data)
    members.append(dict(path=path,blob=oid,sha256=hashlib.sha256(data).hexdigest(),size=len(data)))
(E/'probe-parity.json').write_text(json.dumps(dict(head=HEAD,members=members),indent=2)+'\n',encoding='utf-8')
print('Verified source blobs',len(members))
