#!/usr/bin/env python3
"""Automated local integration tests for MBIE/GETS -> NZ Records.

These tests intentionally exercise a local SQLite database only. They must never
call Wrangler, Cloudflare, GitHub, or production services.
"""
from __future__ import annotations

import csv
import importlib.util
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest

REPO = Path(__file__).resolve().parents[1]
RESEARCH = Path(os.environ.get("GETS_RESEARCH_DIR", "/mnt/c/Users/Stu/nzrecords-research/mbie-procurement"))
RAW = RESEARCH / "raw"
SAMPLE = REPO / "importers" / "gets" / "sample-rfx-10.json"
IMPORTER = REPO / "importers" / "gets" / "import_gets_local.py"
DB = RESEARCH / "integration-report" / "nz-records-gets-dev.sqlite"

EXPECTED = {
    "rfx_entities": 10,
    "agency_entities": 7,
    "supplier_entities": 25,
    "issued_relationships": 10,
    "awarded_to_relationships": 25,
    "region_associations": 15,
    "unspsc_associations": 22,
    "selected_not_awarded": 1,
}


def run_import(reset: bool = False, input_dir: Path = RAW, db: Path = DB) -> dict:
    cmd = [
        sys.executable,
        str(IMPORTER),
        "--input-dir",
        str(input_dir),
        "--sample-file",
        str(SAMPLE),
        "--db",
        str(db),
    ]
    if reset:
        cmd.append("--reset-local-db")
    proc = subprocess.run(cmd, cwd=REPO, text=True, capture_output=True, check=False)
    if proc.returncode != 0:
        raise AssertionError(f"import failed\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}")
    return json.loads(proc.stdout)


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def scalar(conn: sqlite3.Connection, sql: str, params=()):
    return conn.execute(sql, params).fetchone()[0]


def load_importer_module():
    spec = importlib.util.spec_from_file_location("import_gets_local", IMPORTER)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def copy_raw_tree(temp_root: Path) -> Path:
    target = temp_root / "raw"
    shutil.copytree(RAW, target)
    return target


def read_csv_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    data = path.read_bytes()
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = data.decode("utf-8", errors="replace")
    from io import StringIO
    reader = csv.DictReader(StringIO(text, newline=""))
    return list(reader.fieldnames or []), list(reader)


def write_csv_rows(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def nzbn_check_digit(first_12: str) -> str:
    total = sum(int(digit) * (1 if index % 2 == 0 else 3) for index, digit in enumerate(first_12))
    return str((10 - (total % 10)) % 10)


class GetsLocalIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.first = run_import(reset=True)
        with connect() as conn:
            cls.counts_after_first = cls._counts(conn)
        cls.second = run_import(reset=False)
        with connect() as conn:
            cls.counts_after_second = cls._counts(conn)

    @staticmethod
    def _counts(conn: sqlite3.Connection) -> dict:
        return {
            "rfx_entities": scalar(conn, "select count(*) from entities where entity_type='contract' and json_extract(metadata_json,'$.gets.kind')='rfx'"),
            "agency_entities": scalar(conn, "select count(*) from entities where entity_type='public_agency' and json_extract(metadata_json,'$.gets.identity_scope')='GETS_SOURCE_NAME'"),
            "supplier_entities": scalar(conn, "select count(*) from entities where entity_type='other' and json_extract(metadata_json,'$.gets.kind')='supplier_record'"),
            "issued_relationships": scalar(conn, "select count(*) from relationships where predicate='ISSUED'"),
            "awarded_to_relationships": scalar(conn, "select count(*) from relationships where predicate='AWARDED_TO'"),
            "region_associations": scalar(conn, "select count(*) from gets_rfx_regions"),
            "unspsc_associations": scalar(conn, "select count(*) from gets_rfx_unspsc_categories"),
            "entity_sources": scalar(conn, "select count(*) from entity_sources"),
            "sources": scalar(conn, "select count(*) from sources where dataset like 'MBIE_GETS%'"),
            "import_runs": scalar(conn, "select count(*) from import_runs where dataset='MBIE_GETS_AWARD_NOTICES_SAMPLE'"),
            "import_errors": scalar(conn, "select count(*) from import_errors"),
            "selected_not_awarded": scalar(conn, "select count(*) from gets_rfx_records where award_type='Not Awarded'"),
        }

    def test_import_counts_and_local_target(self):
        self.assertTrue(str(DB).endswith("nz-records-gets-dev.sqlite"))
        self.assertTrue(DB.exists())
        for key, expected in EXPECTED.items():
            self.assertEqual(self.counts_after_first[key], expected, key)
        self.assertEqual(self.first["remote_writes_enabled"], False)
        self.assertEqual(self.first["target"], "local-sqlite")

    def test_idempotent_second_import(self):
        comparable = {k: v for k, v in self.counts_after_first.items() if k != "import_runs"}
        comparable_second = {k: v for k, v in self.counts_after_second.items() if k != "import_runs"}
        self.assertEqual(comparable_second, comparable)
        self.assertEqual(self.counts_after_second["import_runs"], self.counts_after_first["import_runs"] + 1)

    def test_not_awarded_has_no_awarded_to_relationships(self):
        with connect() as conn:
            not_awarded = conn.execute("""
                select e.id, e.canonical_name
                from entities e
                join gets_rfx_records g on g.entity_id=e.id
                where g.award_type='Not Awarded'
            """).fetchall()
            self.assertEqual(len(not_awarded), EXPECTED["selected_not_awarded"])
            for row in not_awarded:
                self.assertEqual(scalar(conn, "select count(*) from relationships where subject_entity_id=? and predicate='AWARDED_TO'", (row["id"],)), 0)

    def test_nzbn_safety_and_raw_preservation(self):
        with connect() as conn:
            self.assertEqual(scalar(conn, "select count(*) from entities where json_extract(metadata_json,'$.gets.kind')='supplier_record' and nzbn is not null"), 0)
            for quality in ["MISSING", "SCIENTIFIC_NOTATION_LOSSY", "MALFORMED", "OTHER_UNUSABLE"]:
                self.assertGreater(scalar(conn, "select count(*) from gets_supplier_records where nzbn_quality=?", (quality,)), 0, quality)
            self.assertGreater(scalar(conn, "select count(*) from gets_supplier_records where raw_supplier_nzbn is not null"), 0)

    def test_supplier_name_collision_does_not_merge(self):
        with connect() as conn:
            rows = conn.execute("""
                select gs.business_name, count(distinct gs.entity_id) entity_count, group_concat(gs.supplier_record_key) keys
                from gets_supplier_records gs
                where gs.business_name='WSP NZ Ltd'
                group by gs.business_name
            """).fetchall()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["entity_count"], 2)

    def test_agency_exact_name_policy(self):
        with connect() as conn:
            auckland = scalar(conn, "select count(*) from entities where entity_type='public_agency' and canonical_name='Auckland Council'")
            self.assertEqual(auckland, 1)
            self.assertEqual(scalar(conn, "select count(*) from gets_rfx_records where posting_agency='Auckland Council'"), 3)
            self.assertEqual(scalar(conn, "select count(*) from entities where entity_type='public_agency' and canonical_name like 'Auckland Counc%'"), 1)

    def test_provenance_and_foreign_keys(self):
        with connect() as conn:
            self.assertIsNone(conn.execute("pragma foreign_key_check").fetchone())
            self.assertEqual(scalar(conn, "select count(*) from entities where metadata_json is null or metadata_json='{}'"), 0)
            self.assertEqual(scalar(conn, "select count(*) from relationships where source_id is null"), 0)
            self.assertEqual(scalar(conn, "select count(*) from entity_sources es left join sources s on s.id=es.source_id where s.id is null"), 0)
            self.assertEqual(scalar(conn, "select count(*) from gets_supplier_records where source_line_number is null or source_filename is null or row_hash is null"), 0)

    def test_search_index_finds_gets_records(self):
        with connect() as conn:
            searches = {
                "rfx id": '10199365',
                "supplier": 'WSP',
                "agency": 'Auckland',
            }
            for label, term in searches.items():
                escaped = term.replace('"', '""')
                count = scalar(conn, """
                    select count(*)
                    from entity_search s join entities e on e.id=s.rowid
                    where entity_search match ?
                """, (f'"{escaped}"*',))
                self.assertGreater(count, 0, label)

    def test_supplier_identity_survives_source_row_reorder(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_root = Path(tmp)
            raw = copy_raw_tree(tmp_root)
            db = tmp_root / "reorder.sqlite"
            run_import(reset=True, input_dir=raw, db=db)
            with sqlite3.connect(db) as conn:
                before = conn.execute("""
                    select supplier_record_key, entity_id, business_name, row_ordinal_for_rfx, source_line_number
                    from gets_supplier_records
                    where rfx_id='21048334'
                    order by supplier_record_key
                """).fetchall()
            self.assertEqual(len(before), 5)

            supplier_csv = raw / "GETS-supplier-data.csv"
            fieldnames, rows = read_csv_rows(supplier_csv)
            selected = [r for r in rows if r["RFx ID"] == "21048334"]
            others = [r for r in rows if r["RFx ID"] != "21048334"]
            write_csv_rows(supplier_csv, fieldnames, others + list(reversed(selected)))

            run_import(reset=False, input_dir=raw, db=db)
            with sqlite3.connect(db) as conn:
                after = conn.execute("""
                    select supplier_record_key, entity_id, business_name, row_ordinal_for_rfx, source_line_number
                    from gets_supplier_records
                    where rfx_id='21048334'
                    order by supplier_record_key
                """).fetchall()
                self.assertEqual(scalar(conn, "select count(*) from gets_supplier_records where rfx_id='21048334'"), 5)
            self.assertEqual([(r[0], r[1], r[2]) for r in after], [(r[0], r[1], r[2]) for r in before])
            self.assertNotEqual([r[3] for r in after], [r[3] for r in before], "ordinal should be provenance that can change without changing supplier identity")

    def test_changed_source_row_creates_new_source_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_root = Path(tmp)
            raw = copy_raw_tree(tmp_root)
            db = tmp_root / "changed-source.sqlite"
            run_import(reset=True, input_dir=raw, db=db)

            awards_csv = raw / "GETS-award-notices.csv"
            fieldnames, rows = read_csv_rows(awards_csv)
            for row in rows:
                if row["RFx ID"] == "10199365":
                    row["Title"] = row["Title"] + " — CHANGED SNAPSHOT"
                    break
            write_csv_rows(awards_csv, fieldnames, rows)

            run_import(reset=False, input_dir=raw, db=db)
            with sqlite3.connect(db) as conn:
                versions = conn.execute("""
                    select record_id, raw_hash
                    from sources
                    where dataset='MBIE_GETS_AWARD_NOTICES_SAMPLE'
                      and record_id like 'GETS:RFx:10199365:award%'
                    order by id
                """).fetchall()
                self.assertEqual(len(versions), 2, versions)
                self.assertEqual(len({row[1] for row in versions}), 2)
                rel_hash = scalar(conn, """
                    select s.raw_hash
                    from relationships r
                    join entities e on e.id=r.subject_entity_id
                    join sources s on s.id=r.source_id
                    where e.slug like 'gets-agency-%' and r.predicate='ISSUED'
                      and json_extract(r.metadata_json,'$.rfx_id')='10199365'
                    order by r.id desc
                    limit 1
                """)
                self.assertEqual(rel_hash, versions[-1][1])

    def test_nzbn_validation_requires_gln_checksum_and_prefix(self):
        importer = load_importer_module()
        valid_prefix = "942904190837"
        valid_nzbn = valid_prefix + nzbn_check_digit(valid_prefix)
        bad_checksum = valid_prefix + str((int(valid_nzbn[-1]) + 1) % 10)
        self.assertEqual(importer.classify_nzbn(valid_nzbn), "VALID_FULL")
        self.assertNotEqual(importer.classify_nzbn(bad_checksum), "VALID_FULL")
        self.assertNotEqual(importer.classify_nzbn("1234567890123"), "VALID_FULL")

    def test_award_amount_decimal_text_is_authoritative(self):
        with connect() as conn:
            info = {row[1] for row in conn.execute("pragma table_info(gets_rfx_records)")}
            self.assertIn("awarded_amount_decimal_text", info)
            value = scalar(conn, "select awarded_amount_decimal_text from gets_rfx_records where rfx_id='16869294'")
            self.assertEqual(value, "315578.00")
            self.assertEqual(scalar(conn, "select json_extract(metadata_json,'$.gets.reported_award_value_decimal_text') from entities where slug='gets-rfx-16869294'"), "315578.00")


if __name__ == "__main__":
    unittest.main(verbosity=2)
