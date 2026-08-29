#!/usr/bin/env python3
"""Build a reviewable SQL artifact for the approved 10-RFx GETS production pilot.

The artifact is D1/SQLite-compatible SQL. It does not connect to Cloudflare or run
Wrangler. It imports the pilot into a temporary local SQLite DB using the approved
local importer, then emits SQL that addresses production rows by deterministic
natural keys (slugs, source record_id versions, RFx IDs, supplier evidence keys)
instead of carrying over local integer IDs.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import sqlite3
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
LOCAL_IMPORTER_PATH = REPO / "importers" / "gets" / "import_gets_local.py"
DEFAULT_RAW = Path("/mnt/c/Users/Stu/nzrecords-research/mbie-procurement/raw")
DEFAULT_SAMPLE = REPO / "importers" / "gets" / "sample-rfx-10.json"
DEFAULT_OUTPUT = Path("/mnt/c/Users/Stu/nzrecords-research/mbie-procurement/integration-report/gets-production-pilot-10rfx.sql")
DATASET = "MBIE_GETS_AWARD_NOTICES_SAMPLE"


def load_local_importer():
    spec = importlib.util.spec_from_file_location("import_gets_local", LOCAL_IMPORTER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {LOCAL_IMPORTER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def q(value) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def one_line_json(text: str | None) -> str | None:
    if text is None:
        return None
    return json.dumps(json.loads(text), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def entity_slug(conn: sqlite3.Connection, entity_id: int) -> str:
    row = conn.execute("SELECT slug FROM entities WHERE id=?", (entity_id,)).fetchone()
    if row is None:
        raise RuntimeError(f"missing entity {entity_id}")
    return row[0]


def source_record_id(conn: sqlite3.Connection, source_id: int) -> str:
    row = conn.execute("SELECT record_id FROM sources WHERE id=?", (source_id,)).fetchone()
    if row is None:
        raise RuntimeError(f"missing source {source_id}")
    return row[0]


def emit_source(row) -> str:
    cols = ["dataset","publisher","record_id","source_url","published_at","retrieved_at","licence","importer_version","raw_hash"]
    vals = [q(row[c]) for c in cols]
    return f"INSERT INTO sources({','.join(cols)}) VALUES ({','.join(vals)}) ON CONFLICT DO NOTHING;"


def emit_entity(row) -> str:
    return (
        "INSERT INTO entities(entity_type,canonical_name,slug,nzbn,company_number,status,metadata_json,updated_at) VALUES "
        f"({q(row['entity_type'])},{q(row['canonical_name'])},{q(row['slug'])},{q(row['nzbn'])},{q(row['company_number'])},{q(row['status'])},{q(one_line_json(row['metadata_json']))},CURRENT_TIMESTAMP) "
        "ON CONFLICT(slug) DO UPDATE SET canonical_name=excluded.canonical_name,status=excluded.status,metadata_json=excluded.metadata_json,updated_at=CURRENT_TIMESTAMP;"
    )


def emit_entity_source(row, e_slug: str, source_record: str) -> str:
    return (
        "INSERT INTO entity_sources(entity_id,source_id,metadata_json) "
        f"SELECT e.id,s.id,{q(one_line_json(row['metadata_json']))} FROM entities e, sources s "
        f"WHERE e.slug={q(e_slug)} AND s.dataset={q(DATASET)} AND s.record_id={q(source_record)} "
        "ON CONFLICT(entity_id,source_id) DO UPDATE SET metadata_json=excluded.metadata_json;"
    )


def emit_relationship(row, subject_slug: str, object_slug: str, source_record: str) -> str:
    return (
        "DELETE FROM relationships WHERE subject_entity_id=(SELECT id FROM entities WHERE slug=" + q(subject_slug) + ") "
        "AND object_entity_id=(SELECT id FROM entities WHERE slug=" + q(object_slug) + ") "
        "AND predicate=" + q(row["predicate"]) + " "
        "AND json_extract(metadata_json,'$.rfx_id')=" + q(json.loads(row["metadata_json"])["rfx_id"]) + ";\n"
        "INSERT INTO relationships(subject_entity_id,predicate,object_entity_id,source_id,observed_at,metadata_json) "
        f"SELECT se.id,{q(row['predicate'])},oe.id,s.id,{q(row['observed_at'])},{q(one_line_json(row['metadata_json']))} "
        "FROM entities se, entities oe, sources s "
        f"WHERE se.slug={q(subject_slug)} AND oe.slug={q(object_slug)} AND s.dataset={q(DATASET)} AND s.record_id={q(source_record)} "
        "ON CONFLICT(subject_entity_id,predicate,object_entity_id,source_id,COALESCE(valid_from,'')) DO UPDATE SET observed_at=excluded.observed_at,metadata_json=excluded.metadata_json;"
    )


def emit_rfx(row, entity_slug_value: str, agency_slug: str) -> str:
    return (
        "INSERT INTO gets_rfx_records(rfx_id,entity_id,agency_entity_id,posting_agency,title,rfx_type,competition_type,reference_number,open_date,close_date,awarded_date,award_type,awarded_amount_raw,awarded_amount_decimal_text,awarded_amount_numeric,report_date,source_filename,source_line_number,row_hash,provenance_json,updated_at) "
        f"SELECT {q(row['rfx_id'])},e.id,a.id,{q(row['posting_agency'])},{q(row['title'])},{q(row['rfx_type'])},{q(row['competition_type'])},{q(row['reference_number'])},{q(row['open_date'])},{q(row['close_date'])},{q(row['awarded_date'])},{q(row['award_type'])},{q(row['awarded_amount_raw'])},{q(row['awarded_amount_decimal_text'])},{q(row['awarded_amount_numeric'])},{q(row['report_date'])},{q(row['source_filename'])},{q(row['source_line_number'])},{q(row['row_hash'])},{q(one_line_json(row['provenance_json']))},CURRENT_TIMESTAMP "
        f"FROM entities e, entities a WHERE e.slug={q(entity_slug_value)} AND a.slug={q(agency_slug)} "
        "ON CONFLICT(rfx_id) DO UPDATE SET entity_id=excluded.entity_id,agency_entity_id=excluded.agency_entity_id,posting_agency=excluded.posting_agency,title=excluded.title,rfx_type=excluded.rfx_type,competition_type=excluded.competition_type,reference_number=excluded.reference_number,open_date=excluded.open_date,close_date=excluded.close_date,awarded_date=excluded.awarded_date,award_type=excluded.award_type,awarded_amount_raw=excluded.awarded_amount_raw,awarded_amount_decimal_text=excluded.awarded_amount_decimal_text,awarded_amount_numeric=excluded.awarded_amount_numeric,report_date=excluded.report_date,source_filename=excluded.source_filename,source_line_number=excluded.source_line_number,row_hash=excluded.row_hash,provenance_json=excluded.provenance_json,updated_at=CURRENT_TIMESTAMP;"
    )


def emit_supplier(row, entity_slug_value: str) -> str:
    return (
        "INSERT INTO gets_supplier_records(supplier_record_key,entity_id,rfx_id,row_ordinal_for_rfx,business_name,raw_supplier_nzbn,nzbn_quality,full_address,country,website,report_date,source_filename,source_line_number,row_hash,provenance_json,updated_at) "
        f"SELECT {q(row['supplier_record_key'])},e.id,{q(row['rfx_id'])},{q(row['row_ordinal_for_rfx'])},{q(row['business_name'])},{q(row['raw_supplier_nzbn'])},{q(row['nzbn_quality'])},{q(row['full_address'])},{q(row['country'])},{q(row['website'])},{q(row['report_date'])},{q(row['source_filename'])},{q(row['source_line_number'])},{q(row['row_hash'])},{q(one_line_json(row['provenance_json']))},CURRENT_TIMESTAMP "
        f"FROM entities e WHERE e.slug={q(entity_slug_value)} "
        "ON CONFLICT(supplier_record_key) DO UPDATE SET entity_id=excluded.entity_id,rfx_id=excluded.rfx_id,row_ordinal_for_rfx=excluded.row_ordinal_for_rfx,business_name=excluded.business_name,raw_supplier_nzbn=excluded.raw_supplier_nzbn,nzbn_quality=excluded.nzbn_quality,full_address=excluded.full_address,country=excluded.country,website=excluded.website,report_date=excluded.report_date,source_filename=excluded.source_filename,source_line_number=excluded.source_line_number,row_hash=excluded.row_hash,provenance_json=excluded.provenance_json,updated_at=CURRENT_TIMESTAMP;"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_RAW)
    parser.add_argument("--sample-file", type=Path, default=DEFAULT_SAMPLE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    importer = load_local_importer()
    sample_ids = importer.load_sample(args.sample_file)
    with tempfile.TemporaryDirectory() as td:
        db = Path(td) / "pilot.sqlite"
        conn = importer.open_db(db, reset=True)
        importer.import_sample(args.input_dir.resolve(), sample_ids, conn)
        conn.row_factory = sqlite3.Row

        lines = [
            "-- NZ Records GETS 10-RFx production pilot import artifact.",
            "-- REVIEWABLE ARTIFACT ONLY. Do not execute remotely until Stuart/ChatGPT explicitly approves.",
            "-- Generated from approved local importer; addresses production rows by deterministic slugs/source record IDs, not local integer IDs.",
            "PRAGMA foreign_keys = ON;",
            "BEGIN TRANSACTION;",
            ""
        ]
        lines.append("-- Sources: versioned source records")
        for row in conn.execute("SELECT * FROM sources WHERE dataset=? ORDER BY record_id", (DATASET,)):
            lines.append(emit_source(row))
        lines.append("\n-- Entities: agencies, RFx records, supplier evidence records")
        for row in conn.execute("SELECT * FROM entities WHERE slug LIKE 'gets-%' ORDER BY slug"):
            lines.append(emit_entity(row))
        lines.append("\n-- Entity/source links")
        for row in conn.execute("SELECT es.*, e.slug entity_slug, s.record_id source_record_id FROM entity_sources es JOIN entities e ON e.id=es.entity_id JOIN sources s ON s.id=es.source_id WHERE s.dataset=? ORDER BY e.slug,s.record_id", (DATASET,)):
            lines.append(emit_entity_source(row, row["entity_slug"], row["source_record_id"]))
        lines.append("\n-- GETS RFx records")
        for row in conn.execute("SELECT g.*, e.slug entity_slug, a.slug agency_slug FROM gets_rfx_records g JOIN entities e ON e.id=g.entity_id JOIN entities a ON a.id=g.agency_entity_id ORDER BY g.rfx_id"):
            lines.append(emit_rfx(row, row["entity_slug"], row["agency_slug"]))
        lines.append("\n-- Structured regions")
        for row in conn.execute("SELECT * FROM gets_rfx_regions ORDER BY rfx_id, region, source_line_number"):
            lines.append("INSERT OR IGNORE INTO gets_rfx_regions(rfx_id,region,report_date,source_filename,source_line_number,row_hash,provenance_json) VALUES (" + ",".join(q(row[c]) for c in ["rfx_id","region","report_date","source_filename","source_line_number","row_hash","provenance_json"]) + ");")
        lines.append("\n-- Structured UNSPSC categories")
        for row in conn.execute("SELECT * FROM gets_rfx_unspsc_categories ORDER BY rfx_id, unspsc_code, source_line_number"):
            lines.append("INSERT OR IGNORE INTO gets_rfx_unspsc_categories(rfx_id,unspsc_code,unspsc_description,report_date,source_filename,source_line_number,row_hash,provenance_json) VALUES (" + ",".join(q(row[c]) for c in ["rfx_id","unspsc_code","unspsc_description","report_date","source_filename","source_line_number","row_hash","provenance_json"]) + ");")
        lines.append("\n-- Supplier evidence records")
        for row in conn.execute("SELECT g.*, e.slug entity_slug FROM gets_supplier_records g JOIN entities e ON e.id=g.entity_id ORDER BY g.rfx_id,g.business_name,g.supplier_record_key"):
            lines.append(emit_supplier(row, row["entity_slug"]))
        lines.append("\n-- Relationships")
        for row in conn.execute("SELECT r.*, se.slug subject_slug, oe.slug object_slug, s.record_id source_record_id FROM relationships r JOIN entities se ON se.id=r.subject_entity_id JOIN entities oe ON oe.id=r.object_entity_id JOIN sources s ON s.id=r.source_id WHERE s.dataset=? ORDER BY r.predicate,se.slug,oe.slug,s.record_id", (DATASET,)):
            lines.append(emit_relationship(row, row["subject_slug"], row["object_slug"], row["source_record_id"]))
        lines.extend(["", "COMMIT;", ""])

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"status":"written","output":str(args.output),"bytes":args.output.stat().st_size}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
