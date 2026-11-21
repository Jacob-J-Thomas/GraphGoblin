from pathlib import Path
import subprocess
q=Path(__file__).resolve().parent
for name,w,base,head in [('a','G:/ggq/gg-i4-427-guide/GraphGoblin','f96a4073c3b53af7724d1ef5593eeaf03194c4cd','8980c27c75e04d33cdcf48736c71db05e35175a3'),('b','G:/ggq/gg-i4-448-preflight/GraphGoblin','b45807f033601a53919f2c9e16e0de751971a518','083d7264ffaeaadba44ebd2f929efb4ac526a127')]:
 r=subprocess.run(['git','diff','--binary',base,head],cwd=w,check=True,stdout=subprocess.PIPE)
 (q/(name+'.patch')).write_bytes(r.stdout)
 assert not subprocess.run(['git','status','--porcelain'],cwd=w,check=True,stdout=subprocess.PIPE).stdout
 print(name,head,len(r.stdout))
