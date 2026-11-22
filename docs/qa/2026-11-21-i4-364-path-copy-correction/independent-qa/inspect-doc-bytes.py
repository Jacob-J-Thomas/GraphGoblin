from pathlib import Path
import datetime, hashlib, json, re, subprocess, sys
sys.dont_write_bytecode=True
R=Path('G:/ggq/gg-i4-364-claude-start/GraphGoblin')
E=Path(__file__).parent
A=E.parent/'i4-364-path-copy-author-01'
HEAD='67d5957cfeb5ed65c0b3e6708f3543a30fbe5b40'
PARENT='c9d23dd1a996cde40d285c1ce103b8c8291cb3ab'
TREE='bb0bd9a31e1d873c88778ff11b78b9ad46fd5c8e'
GUIDE='docs/guide/07-troubleshooting.md'
H='packages/infrastructure/src/claude/harness.ts'
def sha(raw):return hashlib.sha256(raw).hexdigest()
def git(*args):return subprocess.check_output(['git','--no-optional-locks',*args],cwd=R)
def write(n,d):(E/n).write_bytes(d if isinstance(d,bytes) else (json.dumps(d,indent=2)+'\n').encode())
def snapshot():
 index=Path(git('rev-parse','--path-format=absolute','--git-path','index').decode().strip())
 return {'head':git('rev-parse','HEAD').decode().strip(),'tree':git('rev-parse','HEAD^{tree}').decode().strip(),'parent':git('rev-parse','HEAD^').decode().strip(),'status':git('status','--porcelain=v2','--branch').decode(),'index_sha256':sha(index.read_bytes()),'clean':not git('status','--porcelain')}
before=snapshot()
assert before['head']==HEAD and before['tree']==TREE and before['parent']==PARENT and before['clean']
old=git('show',PARENT+':'+GUIDE)
new=git('show',HEAD+':'+GUIDE)
assert (R/GUIDE).read_bytes()==new
assert old==(A/'before.md').read_bytes() and new==(A/'after.md').read_bytes()
old_lines,new_lines=old.splitlines(keepends=True),new.splitlines(keepends=True)
assert len(old_lines)==len(new_lines)
changed=[i+1 for i,(a,b) in enumerate(zip(old_lines,new_lines)) if a!=b]
assert changed==[168]
assert old.count(bytes([8]))==1
replaced=old.replace(bytes([8]),bytes([92,98]))
assert replaced==(A/'after-before-format.md').read_bytes()
expected_row=replaced.splitlines(keepends=True)[167]
actual_row=new_lines[167]
expected_cells=expected_row.rstrip(b'\r\n').split(b'|')
actual_cells=actual_row.rstrip(b'\r\n').split(b'|')
assert len(expected_cells)==len(actual_cells)==5
padding=[]
for i,(a,b) in enumerate(zip(expected_cells,actual_cells)):
 assert a.strip(b' ')==b.strip(b' ')
 if a!=b:
  padding.append({'cell_index':i,'before_leading_spaces':len(a)-len(a.lstrip(b' ')),'after_leading_spaces':len(b)-len(b.lstrip(b' ')),'before_trailing_spaces':len(a)-len(a.rstrip(b' ')),'after_trailing_spaces':len(b)-len(b.rstrip(b' ')),'content_unchanged_after_exact_path_replacement':True})
assert padding
controls=lambda raw:[{'offset':i,'byte':b} for i,b in enumerate(raw) if (b<32 and b not in (9,10,13)) or b==127]
assert controls(old)==[{'offset':old.index(bytes([8])),'byte':8}]
assert not controls(new)
literal=b'%USERPROFILE%\\.local\\bin\\claude.exe'
spans=re.findall(rb'`([^`]*)`',actual_row)
assert spans.count(literal)==1
harness=git('show',HEAD+':'+H)
assert harness==git('show',PARENT+':'+H)==(R/H).read_bytes()
constructor=b'\n'.join(harness.splitlines()[228:238])
for component in [b'options.binary ??',b'options.env?.USERPROFILE ?? process.env.USERPROFILE ?? homedir()',b"'.local'",b"'bin'",b"'claude.exe'"]:
 assert component in constructor
displayed='%USERPROFILE%'+'\\'+'.local'+'\\'+'bin'+'\\'+'claude.exe'
assert literal.decode()==displayed
delta=git('diff-tree','--no-commit-id','--name-only','-r',HEAD).decode().splitlines()
assert delta==[GUIDE]
assert git('diff-tree','--no-commit-id','--name-only','-r','--diff-filter=AMDRT',HEAD).decode().splitlines()==[GUIDE]
frozen=['packages/infrastructure/src/claude/process.ts','packages/infrastructure/src/claude/process-failure.test.ts','docs/06-harness-integration.md','docs/decisions/ADR-0089-bounded-claude-refusal-diagnosis.md','docs/decisions/README.md']
preserved=[]
for path in [H,*frozen]:
 a=git('ls-tree','-z',PARENT,'--',path)
 b=git('ls-tree','-z',HEAD,'--',path)
 assert a==b
 preserved.append({'path':path,'parent_and_head_entry':b.rstrip(b'\0').decode(),'identical':True})
qa_parent=git('rev-parse',PARENT+':docs/qa').decode().strip()
qa_head=git('rev-parse',HEAD+':docs/qa').decode().strip()
assert qa_parent==qa_head
author_manifest=json.loads((A/'SHA256SUMS.json').read_bytes())
for m in author_manifest:
 raw=(A/m['path']).read_bytes();assert len(raw)==m['bytes'] and sha(raw)==m['sha256']
after=snapshot();assert before==after
obs={'verdict':'PASS for root-authored documentation repair only','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'guide':GUIDE,'changed_lines':changed,'committed_before':{'revision':PARENT,'bytes':len(old),'sha256':sha(old),'forbidden_ascii_controls':controls(old)},'committed_after':{'revision':HEAD,'tree':TREE,'bytes':len(new),'sha256':sha(new),'forbidden_ascii_controls':controls(new)},'path_replacement':{'old_byte_hex':'08','replacement_hex':'5c62','occurrences':1,'before_window_hex':old[old.index(bytes([8]))-6:old.index(bytes([8]))+11].hex(),'after_code_span_literal':literal.decode(),'after_code_span_hex':literal.hex(),'literal_found_once_in_backtick_span':True,'matches_constructor_default_components':True,'constructor_lines_229_238':constructor.decode()},'formatter_padding':padding,'bytes_added_by_path_replacement':len(replaced)-len(old),'bytes_removed_by_formatter_padding':len(replaced)-len(new),'every_other_line_exact':True,'every_cell_value_exact_after_only_path_replacement':True,'whole_commit_changed_paths':delta,'runtime_and_D203_git_entries':preserved,'all_old_archives_subtree_parent':qa_parent,'all_old_archives_subtree_head':qa_head,'author_packet':{'root':str(A),'manifest_sha256':sha((A/'SHA256SUMS.json').read_bytes()),'members_verified':len(author_manifest),'before_after_match_committed_git_bytes':True},'source_index_before':before,'source_index_after':after,'source_index_unchanged':True,'limits':['Static committed bytes and Markdown code-span inspection only; no browser rendering or runtime behavior execution.','No product tests, builds, provider/model dispatch, GitHub call or repository/index/master write.','Independent documentation QA of root-authored repair, not another general review or approval of the whole PR.','All three general scans remain consumed; bounded Fable review, current delivery gates and coordinator completion remain root-owned.']}
write('observations.json',obs)
report=f'''# #364 path-copy documentation QA: PASS

Independently compared committed parent `{PARENT}` with frozen head `{HEAD}`
(tree `{TREE}`), the actual working file and the ClaudeHarness constructor default.

Only `docs/guide/07-troubleshooting.md` changed in the commit, and only line168 changed
in that file. Parent bytes contain exactly one forbidden ASCII control, BACKSPACE
`08`, in the executable path. It becomes literal backslash+b `5c62`. The new backtick
code span is `%USERPROFILE%\\.local\\bin\\claude.exe`, exactly matching the constructor's
USERPROFILE/default-home root and `.local`, `bin`, `claude.exe` components. Backslashes
are literal characters inside that code span. No forbidden ASCII controls remain in
the whole guide (TAB/LF/CR are permitted; other C0 controls and DEL were checked).

Every other line is byte-identical. After that precise path replacement, all table
cell values remain byte-identical; only edge padding in the repaired row differs.
The replacement adds {len(replaced)-len(old)} byte; formatter padding removes {len(replaced)-len(new)} spaces,
so the complete file is {len(old)} → {len(new)} bytes. The author's report says one
padding space was removed; the committed byte calculation establishes two. This is
an evidence-count wording discrepancy, not an additional content or source defect.

The author's before/after/pre-format artifacts exactly match the independent committed
byte observations, and all {len(author_manifest)} listed author artifact hashes verify. Before SHA-256:
`{sha(old)}`. After SHA-256: `{sha(new)}`.

The whole-commit path delta is the guide alone. Runtime harness and the D203 five
files retain exact Git blob/mode entries; the complete old `docs/qa` subtree has the
same tree ID in parent/head. Source is clean at the exact frozen head, and physical
index/status/head/tree snapshots are unchanged across this inspection. No earlier
sealed preparation or source/index/master was edited.

This is independent static documentation QA of root's repair. No runtime, browser,
product test, build, provider/model or GitHub execution was performed, and no runtime
QA or whole-PR approval is claimed. All three general scans remain consumed; bounded
Fable review and remaining current delivery/coordinator gates stay with root.
Exact observations and source/index bindings are in `observations.json`.
'''
write('REPORT.md',report.encode())
members=[{'path':p.name,'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in sorted(E.iterdir()) if p.is_file()]
write('MANIFEST.json',{'kind':'Independent static documentation QA evidence only','members':members,'memberCount':len(members)})
seal={'verdict':'PASS for documentation repair only','head':HEAD,'tree':TREE,'manifest_sha256':sha((E/'MANIFEST.json').read_bytes()),'report_sha256':sha((E/'REPORT.md').read_bytes()),'observations_sha256':sha((E/'observations.json').read_bytes()),'metadata_members':len(members),'no_runtime_QA_or_general_approval':True}
write('SEAL.json',seal)
for m in members:assert sha((E/m['path']).read_bytes())==m['sha256']
print(json.dumps({**seal,'seal_sha256':sha((E/'SEAL.json').read_bytes()),'path_replacement_bytes':1,'padding_spaces_removed':len(replaced)-len(new),'source_index_unchanged':True},indent=2))
