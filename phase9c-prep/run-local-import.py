#!/usr/bin/env python3
import json, pathlib, sqlite3, time, os, sys, traceback
repo=pathlib.Path(__file__).resolve().parents[1]
dir=pathlib.Path((repo/'phase9c-prep/.latest-rehearsal-dir').read_text().strip())
chunks_dir=pathlib.Path(os.environ.get('PHASE9C_CHUNKS_DIR', str(repo/'phase9c-prep/chunks')))
chunks=sorted(chunks_dir.glob('chunk-*.sql'))
db=pathlib.Path(os.environ.get('PHASE9C_DB_PATH', str(dir/'local-db/nz-records-phase9c.sqlite')))
db.parent.mkdir(parents=True, exist_ok=True)
summary={'db':str(db),'chunks_total':len(chunks),'started_at':time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),'chunks_completed':0,'phase':'init'}
summary_path=dir/'local-import-summary.json'
def write(): summary_path.write_text(json.dumps(summary,indent=2)+'\n')
def counts(conn):
    return {
      'entities': conn.execute('SELECT COUNT(*) FROM entities').fetchone()[0],
      'entities_by_type': dict(conn.execute('SELECT entity_type, COUNT(*) FROM entities GROUP BY entity_type').fetchall()),
      'sources': conn.execute('SELECT COUNT(*) FROM sources').fetchone()[0],
      'sources_by_dataset': dict(conn.execute('SELECT dataset, COUNT(*) FROM sources GROUP BY dataset').fetchall()),
      'entity_sources': conn.execute('SELECT COUNT(*) FROM entity_sources').fetchone()[0],
      'relationships': conn.execute('SELECT COUNT(*) FROM relationships').fetchone()[0],
      'relationships_by_predicate': dict(conn.execute('SELECT predicate, COUNT(*) FROM relationships GROUP BY predicate').fetchall()),
      'officer_of': conn.execute("SELECT COUNT(*) FROM relationships WHERE predicate='OFFICER_OF'").fetchone()[0],
      'entity_search': conn.execute('SELECT COUNT(*) FROM entity_search').fetchone()[0]
    }
try:
    if os.environ.get('PHASE9C_KEEP_DB') != '1':
        if db.exists(): db.unlink()
    conn=sqlite3.connect(db)
    conn.execute('PRAGMA foreign_keys=ON')
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    conn.execute('PRAGMA temp_store=MEMORY')
    summary['phase']='schema'; write();
    conn.executescript((repo/'database/schema.sql').read_text())
    conn.commit()
    summary['empty_db_bytes']=db.stat().st_size if db.exists() else 0
    summary['empty_foreign_key_check']=conn.execute('PRAGMA foreign_key_check').fetchall()
    summary['empty_integrity_check']=conn.execute('PRAGMA integrity_check').fetchone()[0]
    summary['phase']='import'; write()
    t0=time.perf_counter()
    for i,ch in enumerate(chunks,1):
        st=time.perf_counter()
        script = ch.read_text()
        conn.executescript('BEGIN IMMEDIATE;\n' + script + '\nCOMMIT;')
        summary['chunks_completed']=i
        if i==1 or i%5==0 or i==len(chunks):
            summary['last_chunk']=str(ch)
            summary['elapsed_sec']=round(time.perf_counter()-t0,3)
            summary['last_chunk_sec']=round(time.perf_counter()-st,3)
            summary['db_bytes_live']=db.stat().st_size if db.exists() else 0
            print(json.dumps({'chunk':i,'of':len(chunks),'elapsed_sec':summary['elapsed_sec'],'db_bytes':summary['db_bytes_live']}), flush=True)
            write()
    summary['phase']='post_import_validation'
    summary['duration_sec']=round(time.perf_counter()-t0,3)
    summary['first_pass_counts']=counts(conn)
    summary['integrity_check']=conn.execute('PRAGMA integrity_check').fetchone()[0]
    summary['foreign_key_check']=conn.execute('PRAGMA foreign_key_check').fetchall()
    summary['duplicate_slugs']=conn.execute('SELECT COUNT(*) FROM (SELECT slug FROM entities GROUP BY slug HAVING COUNT(*)>1)').fetchone()[0]
    summary['duplicate_sources_identity']=conn.execute("SELECT COUNT(*) FROM (SELECT dataset,COALESCE(record_id,''),source_url FROM sources GROUP BY dataset,COALESCE(record_id,''),source_url HAVING COUNT(*)>1)").fetchone()[0]
    summary['duplicate_relationships_identity']=conn.execute("SELECT COUNT(*) FROM (SELECT subject_entity_id,predicate,object_entity_id,source_id,COALESCE(valid_from,'') FROM relationships GROUP BY subject_entity_id,predicate,object_entity_id,source_id,COALESCE(valid_from,'') HAVING COUNT(*)>1)").fetchone()[0]
    summary['orphan_officer_of']=conn.execute("SELECT COUNT(*) FROM relationships r LEFT JOIN entities s ON s.id=r.subject_entity_id LEFT JOIN entities o ON o.id=r.object_entity_id LEFT JOIN sources src ON src.id=r.source_id WHERE r.predicate='OFFICER_OF' AND (s.id IS NULL OR o.id IS NULL OR src.id IS NULL)").fetchone()[0]
    summary['charity_view_urls']=conn.execute("SELECT COUNT(*) FROM sources WHERE source_url LIKE '%CharitiesRegister/ViewCharity%'").fetchone()[0]
    summary['direct_charity_urls']=conn.execute("SELECT COUNT(*) FROM sources WHERE source_url LIKE 'https://www.register.charities.govt.nz/Charity/CC%'").fetchone()[0]
    summary['body_corporates_as_person']=conn.execute("SELECT COUNT(*) FROM entities WHERE entity_type='person' AND json_extract(metadata_json,'$.body_corporate')=1").fetchone()[0]
    conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    summary['page_count']=conn.execute('PRAGMA page_count').fetchone()[0]
    summary['page_size']=conn.execute('PRAGMA page_size').fetchone()[0]
    summary['freelist_count']=conn.execute('PRAGMA freelist_count').fetchone()[0]
    conn.close()
    summary['db_bytes_final']=db.stat().st_size
    wal=pathlib.Path(str(db)+'-wal'); shm=pathlib.Path(str(db)+'-shm')
    summary['wal_bytes']=wal.stat().st_size if wal.exists() else 0
    summary['shm_bytes']=shm.stat().st_size if shm.exists() else 0
    summary['completed_at']=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    summary['phase']='completed'; write(); print(json.dumps(summary,indent=2))
except Exception as e:
    summary['phase']='failed'; summary['error']=repr(e); summary['traceback']=traceback.format_exc(); write(); print(summary['traceback'], file=sys.stderr); sys.exit(1)
