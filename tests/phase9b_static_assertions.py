#!/usr/bin/env python3
from pathlib import Path
import subprocess, tempfile
ROOT = Path(__file__).resolve().parents[1]
def read(path): return (ROOT/path).read_text(encoding='utf-8')
def test_public_search_no_demo():
    p=read('src/routes/explore/+page.svelte')
    assert '$lib/demo' not in p and 'findDemoEntities' not in p and "mode==='demo'" not in p and '`/entity/${id}`' not in p and '`/record/${id}`' in p
    assert 'SEARCH_ERROR' in p and 'No records match your search.' in p and 'Demo data' not in p
def test_entity_route_obsolete():
    t=read('src/routes/entity/[id]/+page.ts'); s=read('src/routes/entity/[id]/+page.svelte')
    assert '$lib/demo' not in t and 'getDemoEntity' not in t and 'error(404' in t and 'DEMONSTRATION DATA' not in s
def test_fictional_names_not_runtime():
    forbidden=['Southern Cross Digital Limited','Maia Rangi','Harbour Infrastructure Limited','Department of Civic Services','Digital Records Platform']
    offenders=[]
    for p in (ROOT/'src').rglob('*'):
        if p.is_file() and p.suffix in {'.ts','.svelte','.js'}:
            txt=p.read_text(encoding='utf-8')
            for n in forbidden:
                if n in txt: offenders.append(f'{p.relative_to(ROOT)}:{n}')
    assert not offenders, '; '.join(offenders)
def test_charity_helper_strict():
    script="""import { isValidCharityRegistrationNumber, buildCharityRegisterUrl } from './importers/charities/charity-source-url.mjs';
const cases={'CC28520':true,' CC28520 ':true,'cc28520':false,'28520':false,'1167550':false,'CC 28520':false,'CC28A20':false,'1e5':false,'':false};
for (const [v,e] of Object.entries(cases)) if (isValidCharityRegistrationNumber(v)!==e) throw new Error(v);
if (buildCharityRegisterUrl(' CC28520 ') !== 'https://www.register.charities.govt.nz/Charity/CC28520') throw new Error('bad url');
for (const bad of ['28520','cc28520','CC 28520',null,undefined]) if (buildCharityRegisterUrl(bad)!==null) throw new Error('built bad '+bad);"""
    with tempfile.NamedTemporaryFile('w',suffix='.mjs',dir=ROOT,delete=False) as f: f.write(script); path=Path(f.name)
    try:
        proc=subprocess.run(['node',path.name],cwd=ROOT,text=True,capture_output=True); assert proc.returncode==0, proc.stdout+proc.stderr
    finally: path.unlink(missing_ok=True)
def test_importers_direct_url_only():
    for f in ['importers/charities/to-sql.mjs','importers/charities/officers-to-sql.mjs']:
        txt=read(f); assert 'buildCharityRegisterUrl' in txt and 'CharitiesRegister/ViewCharity' not in txt and 'encodeURIComponent(registration)' not in txt
if __name__=='__main__':
    tests=[v for k,v in sorted(globals().items()) if k.startswith('test_')]
    fails=[]
    for t in tests:
        try: t()
        except AssertionError as e: fails.append(f'{t.__name__}: {e}')
    if fails: print('\n'.join(fails)); raise SystemExit(1)
    print(f'{len(tests)} Phase 9B static assertions passed')
