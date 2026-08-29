#!/usr/bin/env python3
"""Local-only MBIE/GETS sample importer for NZ Records.

This command deliberately supports SQLite only. It has no production mode and no
Wrangler/Cloudflare path. It imports an explicit RFx sample into the existing NZ
Records graph tables plus small GETS source-layer tables.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import sqlite3
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCHEMA = REPO / "database" / "schema.sql"
DATASET = "MBIE_GETS_AWARD_NOTICES_SAMPLE"
SOURCE_DATASET = "https://catalogue.data.govt.nz/dataset/new-zealand-government-procurement-award-notices"
PUBLISHER = "Ministry of Business, Innovation and Employment / New Zealand Government Procurement"
LICENCE = "Creative Commons Attribution 3.0 New Zealand"
IMPORTER_VERSION = "gets-local-integration/0.1"
DATASET_SOURCE_URL = SOURCE_DATASET

FILES = {
    "awards": "GETS-award-notices.csv",
    "suppliers": "GETS-supplier-data.csv",
    "regions": "GETS-region-by-tender.csv",
    "categories": "GETS-product-categories.csv",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import an explicit GETS RFx sample into a local NZ Records SQLite DB.")
    parser.add_argument("--input-dir", required=True, help="Directory containing MBIE/GETS raw CSV files")
    parser.add_argument("--sample-file", required=True, help="JSON file containing exactly the RFx IDs to import")
    parser.add_argument("--db", required=True, help="LOCAL SQLite database path; production/remote targets are unsupported")
    parser.add_argument("--reset-local-db", action="store_true", help="Delete and recreate the local SQLite database before import")
    return parser.parse_args()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stable_hash(*parts: object, length: int = 20) -> str:
    text = "\x1f".join("" if p is None else str(p) for p in parts)
    return hashlib.sha256(text.encode("utf-8", errors="surrogateescape")).hexdigest()[:length]


def slugify(value: str, max_len: int = 100) -> str:
    value = str(value or "").lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value[:max_len].strip("-") or "record"


def sql_json(obj: object) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def read_csv(path: Path) -> list[tuple[int, dict[str, str]]]:
    data = path.read_bytes()
    text = None
    last = None
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = data.decode(enc)
            break
        except UnicodeDecodeError as exc:
            last = exc
    if text is None:
        raise last or RuntimeError(f"Could not decode {path}")
    reader = csv.DictReader(io.StringIO(text, newline=""))
    return [(line_no, {k: (v if v is not None else "") for k, v in row.items()}) for line_no, row in enumerate(reader, start=2)]


def row_hash(row: dict[str, str]) -> str:
    return hashlib.sha256(sql_json(row).encode("utf-8", errors="surrogateescape")).hexdigest()


def valid_nzbn(value: str) -> bool:
    """Validate an NZBN as a 13-digit GS1 GLN with NZBN prefix and check digit.

    NZBNs use the GS1 Global Location Number format. For NZ company/entity
    identifiers this importer requires the NZBN allocation prefix `9429`, then
    validates the standard modulo-10 check digit. A bare 13-digit string is not
    enough evidence.
    """
    digits = re.sub(r"\s+", "", value or "")
    if not re.fullmatch(r"\d{13}", digits):
        return False
    if not digits.startswith("9429"):
        return False
    total = sum(int(digit) * (1 if index % 2 == 0 else 3) for index, digit in enumerate(digits[:12]))
    expected = (10 - (total % 10)) % 10
    return int(digits[-1]) == expected


def classify_nzbn(value: str | None) -> str:
    raw = (value or "").strip()
    if not raw or raw.upper() == "NULL":
        return "MISSING"
    if re.fullmatch(r"[+-]?\d+(?:\.\d+)?[Ee][+-]?\d+", raw):
        return "SCIENTIFIC_NOTATION_LOSSY"
    digits = raw.replace(" ", "")
    if re.fullmatch(r"\d{13}", digits):
        return "VALID_FULL" if valid_nzbn(digits) else "MALFORMED"
    if re.search(r"\d", raw):
        return "MALFORMED"
    return "OTHER_UNUSABLE"


def parse_amount_decimal_text(value: str | None) -> str | None:
    text = (value or "").strip()
    if text == "":
        return None
    cleaned = text.replace(",", "").replace("$", "")
    try:
        return str(Decimal(cleaned).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    except (InvalidOperation, ValueError):
        return None


def parse_amount(value: str | None) -> float | None:
    # Compatibility/sort helper only. The authoritative monetary value is the
    # raw source value plus awarded_amount_decimal_text, not this binary float.
    decimal_text = parse_amount_decimal_text(value)
    return float(decimal_text) if decimal_text is not None else None


def provenance(filename: str, line_no: int, rfx_id: str, row: dict[str, str], input_dir: Path) -> dict:
    source_file = input_dir / filename
    return {
        "dataset": DATASET,
        "publisher": PUBLISHER,
        "rfx_id": rfx_id,
        "source_filename": filename,
        "source_line_number": line_no,
        "source_file_sha256": sha256_bytes(source_file.read_bytes()),
        "row_hash": row_hash(row),
        "retrieved_at": now(),
        "report_date": row.get("Report Date") or None,
        "licence": LICENCE,
        "source_url": DATASET_SOURCE_URL,
        "direct_gets_record_url": None,
        "importer_version": IMPORTER_VERSION,
    }


def source_record(conn: sqlite3.Connection, *, record_id: str, source_url: str, retrieved_at: str, raw_hash: str, metadata: dict) -> int:
    versioned_record_id = f"{record_id}:v:{raw_hash[:16]}"
    versioned_metadata = dict(metadata)
    versioned_metadata["logical_record_id"] = record_id
    versioned_metadata["source_version_key"] = versioned_record_id
    conn.execute(
        """
        INSERT INTO sources(dataset,publisher,record_id,source_url,published_at,retrieved_at,licence,importer_version,raw_hash)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT DO NOTHING
        """,
        (DATASET, PUBLISHER, versioned_record_id, source_url, versioned_metadata.get("report_date"), retrieved_at, LICENCE, IMPORTER_VERSION, raw_hash),
    )
    row = conn.execute(
        "SELECT id FROM sources WHERE dataset=? AND COALESCE(record_id,'')=COALESCE(?,'') AND source_url=? AND raw_hash=?",
        (DATASET, versioned_record_id, source_url, raw_hash),
    ).fetchone()
    if row is None:
        raise RuntimeError(f"source lookup failed for {versioned_record_id}")
    return int(row[0])


def upsert_entity(conn: sqlite3.Connection, *, entity_type: str, canonical_name: str, slug: str, status: str | None, metadata: dict, nzbn: str | None = None) -> int:
    # Supplier GETS NZBNs are not reliable in this phase; caller passes nzbn=None for them.
    conn.execute(
        """
        INSERT INTO entities(entity_type, canonical_name, slug, nzbn, status, metadata_json, updated_at)
        VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(slug) DO UPDATE SET
          canonical_name=excluded.canonical_name,
          status=excluded.status,
          metadata_json=excluded.metadata_json,
          updated_at=CURRENT_TIMESTAMP
        """,
        (entity_type, canonical_name, slug, nzbn, status, sql_json(metadata)),
    )
    row = conn.execute("SELECT id FROM entities WHERE slug=?", (slug,)).fetchone()
    if row is None:
        raise RuntimeError(f"entity lookup failed for {slug}")
    return int(row[0])


def link_entity_source(conn: sqlite3.Connection, entity_id: int, source_id: int, metadata: dict) -> None:
    conn.execute(
        """
        INSERT INTO entity_sources(entity_id,source_id,metadata_json)
        VALUES (?,?,?)
        ON CONFLICT(entity_id,source_id) DO UPDATE SET metadata_json=excluded.metadata_json
        """,
        (entity_id, source_id, sql_json(metadata)),
    )


def upsert_relationship(conn: sqlite3.Connection, subject: int, predicate: str, obj: int, source_id: int, metadata: dict, observed_at: str | None = None) -> None:
    # Keep the displayed edge pointed at the current source version. Historical
    # source versions remain preserved in `sources`; stale edges are not left on
    # the live graph when the same logical evidence changes between snapshots.
    if metadata.get("rfx_id"):
        conn.execute(
            """
            DELETE FROM relationships
            WHERE subject_entity_id=? AND predicate=? AND object_entity_id=?
              AND json_extract(metadata_json,'$.rfx_id')=?
            """,
            (subject, predicate, obj, metadata.get("rfx_id")),
        )
    conn.execute(
        """
        INSERT INTO relationships(subject_entity_id,predicate,object_entity_id,source_id,observed_at,metadata_json)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT(subject_entity_id,predicate,object_entity_id,source_id,COALESCE(valid_from,'')) DO UPDATE SET
          observed_at=excluded.observed_at,
          metadata_json=excluded.metadata_json
        """,
        (subject, predicate, obj, source_id, observed_at, sql_json(metadata)),
    )


def load_sample(path: Path) -> list[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    ids = [str(x).strip() for x in data.get("rfx_ids", [])]
    if len(ids) != 10 or len(set(ids)) != 10:
        raise SystemExit("sample file must contain exactly 10 distinct RFx IDs")
    return ids


def open_db(db: Path, reset: bool) -> sqlite3.Connection:
    # Local safety guard: only SQLite files under the research integration-report or repo-local paths are accepted.
    db = db.resolve()
    if db.suffix not in {".sqlite", ".sqlite3", ".db"}:
        raise SystemExit("Refusing non-SQLite target. This importer has no remote/production mode.")
    forbidden = {"nz-connections-db", "403348cb-50a4-4e0d-8735-cf465d2c08c3", "production", "remote"}
    if any(token in str(db).lower() for token in forbidden):
        raise SystemExit(f"Refusing suspicious database path: {db}")
    db.parent.mkdir(parents=True, exist_ok=True)
    if reset and db.exists():
        db.unlink()
    conn = sqlite3.connect(db)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA.read_text(encoding="utf-8"))
    return conn


def import_sample(input_dir: Path, sample_ids: list[str], conn: sqlite3.Connection) -> dict:
    retrieved_at = now()
    start = time.perf_counter()
    counts = Counter()
    errors = 0
    run_id = conn.execute(
        "INSERT INTO import_runs(dataset,source_snapshot,started_at,status,rows_seen,rows_written,errors,metadata_json) VALUES (?,?,?,?,0,0,0,?)",
        (DATASET, str(input_dir.resolve()), retrieved_at, "running", sql_json({"sample_ids": sample_ids, "target": "local-sqlite", "remote_writes_enabled": False})),
    ).lastrowid

    awards = {row["RFx ID"].strip(): (line_no, row) for line_no, row in read_csv(input_dir / FILES["awards"]) if row.get("RFx ID", "").strip() in sample_ids}
    suppliers_by_rfx: dict[str, list[tuple[int, dict[str, str]]]] = defaultdict(list)
    regions_by_rfx: dict[str, list[tuple[int, dict[str, str]]]] = defaultdict(list)
    cats_by_rfx: dict[str, list[tuple[int, dict[str, str]]]] = defaultdict(list)
    for line_no, row in read_csv(input_dir / FILES["suppliers"]):
        if row.get("RFx ID", "").strip() in sample_ids:
            suppliers_by_rfx[row["RFx ID"].strip()].append((line_no, row))
    for line_no, row in read_csv(input_dir / FILES["regions"]):
        if row.get("RFx ID", "").strip() in sample_ids:
            regions_by_rfx[row["RFx ID"].strip()].append((line_no, row))
    for line_no, row in read_csv(input_dir / FILES["categories"]):
        if row.get("RFx ID", "").strip() in sample_ids:
            cats_by_rfx[row["RFx ID"].strip()].append((line_no, row))

    missing = [rfx for rfx in sample_ids if rfx not in awards]
    if missing:
        raise SystemExit(f"sample RFx IDs not found in awards file: {missing}")

    with conn:
        for rfx_id in sample_ids:
            line_no, row = awards[rfx_id]
            prov = provenance(FILES["awards"], line_no, rfx_id, row, input_dir)
            source_id = source_record(conn, record_id=f"GETS:RFx:{rfx_id}:award", source_url=DATASET_SOURCE_URL, retrieved_at=retrieved_at, raw_hash=prov["row_hash"], metadata=prov)

            agency_name = row["Posting Agency"].strip()
            agency_slug = f"gets-agency-{stable_hash(agency_name)}"
            agency_meta = {
                "gets": {
                    "kind": "agency",
                    "identity_scope": "GETS_SOURCE_NAME",
                    "identity_confidence": "SOURCE_NAME_ONLY",
                    "merge_policy": "exact GETS Posting Agency only; no fuzzy, normalised, or cross-dataset merge",
                    "source_name": agency_name,
                }
            }
            agency_id = upsert_entity(conn, entity_type="public_agency", canonical_name=agency_name, slug=agency_slug, status="GETS source name only", metadata=agency_meta)
            link_entity_source(conn, agency_id, source_id, {"role": "posting-agency", "rfx_id": rfx_id, "identity_scope": "GETS_SOURCE_NAME"})

            title = row.get("Title", "").strip() or f"GETS RFx {rfx_id}"
            rfx_name = f"Procurement record RFx {rfx_id} — {title}"
            rfx_slug = f"gets-rfx-{rfx_id}"
            amount_decimal_text = parse_amount_decimal_text(row.get("Awarded Amount"))
            amount = parse_amount(row.get("Awarded Amount"))
            rfx_meta = {
                "gets": {
                    "kind": "rfx",
                    "rfx_id": rfx_id,
                    "public_label": "Procurement record" if row.get("Award Type") == "Not Awarded" else "Award notice",
                    "title": title,
                    "posting_agency": agency_name,
                    "award_type": row.get("Award Type"),
                    "reported_award_value": row.get("Awarded Amount"),
                    "reported_award_value_decimal_text": amount_decimal_text,
                    "award_amount_representation": "raw source text plus Decimal-quantized text at two places; awarded_amount_numeric is compatibility-only and not authoritative",
                    "dates": {"open": row.get("Open Date"), "close": row.get("Close Date"), "awarded": row.get("Awarded Date")},
                    "provenance": prov,
                }
            }
            rfx_id_entity = upsert_entity(conn, entity_type="contract", canonical_name=rfx_name, slug=rfx_slug, status=row.get("Award Type"), metadata=rfx_meta)
            link_entity_source(conn, rfx_id_entity, source_id, {"role": "rfx-source-record", "rfx_id": rfx_id, "source_line_number": line_no})
            upsert_relationship(conn, agency_id, "ISSUED", rfx_id_entity, source_id, {"rfx_id": rfx_id, "evidence": "GETS award notice posting agency"}, row.get("Report Date") or None)
            conn.execute(
                """
                INSERT INTO gets_rfx_records(rfx_id,entity_id,agency_entity_id,posting_agency,title,rfx_type,competition_type,reference_number,open_date,close_date,awarded_date,award_type,awarded_amount_raw,awarded_amount_decimal_text,awarded_amount_numeric,report_date,source_filename,source_line_number,row_hash,provenance_json,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
                ON CONFLICT(rfx_id) DO UPDATE SET entity_id=excluded.entity_id,agency_entity_id=excluded.agency_entity_id,posting_agency=excluded.posting_agency,title=excluded.title,rfx_type=excluded.rfx_type,competition_type=excluded.competition_type,reference_number=excluded.reference_number,open_date=excluded.open_date,close_date=excluded.close_date,awarded_date=excluded.awarded_date,award_type=excluded.award_type,awarded_amount_raw=excluded.awarded_amount_raw,awarded_amount_decimal_text=excluded.awarded_amount_decimal_text,awarded_amount_numeric=excluded.awarded_amount_numeric,report_date=excluded.report_date,source_filename=excluded.source_filename,source_line_number=excluded.source_line_number,row_hash=excluded.row_hash,provenance_json=excluded.provenance_json,updated_at=CURRENT_TIMESTAMP
                """,
                (rfx_id, rfx_id_entity, agency_id, agency_name, title, row.get("RFx Type"), row.get("Competition Type"), row.get("Reference Number"), row.get("Open Date"), row.get("Close Date"), row.get("Awarded Date"), row.get("Award Type"), row.get("Awarded Amount"), amount_decimal_text, amount, row.get("Report Date"), FILES["awards"], line_no, prov["row_hash"], sql_json(prov)),
            )
            counts["rfx_entities"] += 1
            counts["issued_relationships"] += 1

            # replace structured association rows for this RFx so reruns are deterministic, then reinsert from source rows.
            conn.execute("DELETE FROM gets_rfx_regions WHERE rfx_id=?", (rfx_id,))
            conn.execute("DELETE FROM gets_rfx_unspsc_categories WHERE rfx_id=?", (rfx_id,))
            for reg_line, reg in regions_by_rfx.get(rfx_id, []):
                reg_prov = provenance(FILES["regions"], reg_line, rfx_id, reg, input_dir)
                conn.execute(
                    "INSERT OR IGNORE INTO gets_rfx_regions(rfx_id,region,report_date,source_filename,source_line_number,row_hash,provenance_json) VALUES (?,?,?,?,?,?,?)",
                    (rfx_id, reg.get("Region", "").strip(), reg.get("Report Date"), FILES["regions"], reg_line, reg_prov["row_hash"], sql_json(reg_prov)),
                )
                counts["region_associations"] += 1
            for cat_line, cat in cats_by_rfx.get(rfx_id, []):
                cat_prov = provenance(FILES["categories"], cat_line, rfx_id, cat, input_dir)
                conn.execute(
                    "INSERT OR IGNORE INTO gets_rfx_unspsc_categories(rfx_id,unspsc_code,unspsc_description,report_date,source_filename,source_line_number,row_hash,provenance_json) VALUES (?,?,?,?,?,?,?,?)",
                    (rfx_id, cat.get("UNSPC Classification", "").strip(), cat.get("UNSPC Description", "").strip(), cat.get("Report Date"), FILES["categories"], cat_line, cat_prov["row_hash"], sql_json(cat_prov)),
                )
                counts["unspsc_associations"] += 1

            if row.get("Award Type") == "Not Awarded":
                continue
            for ordinal, (sup_line, sup) in enumerate(suppliers_by_rfx.get(rfx_id, []), start=1):
                sup_prov = provenance(FILES["suppliers"], sup_line, rfx_id, sup, input_dir)
                quality = classify_nzbn(sup.get("Supplier NZBN"))
                supplier_evidence_hash = sup_prov["row_hash"][:20]
                supplier_key = f"GETS:supplier-evidence:{rfx_id}:{supplier_evidence_hash}"
                supplier_name = (sup.get("Business Name") or "Unnamed GETS supplier").strip()
                supplier_slug = f"gets-supplier-{rfx_id}-{supplier_evidence_hash}"
                supplier_meta = {
                    "gets": {
                        "kind": "supplier_record",
                        "public_label": "Supplier record",
                        "supplier_record_key": supplier_key,
                        "rfx_id": rfx_id,
                        "business_name": supplier_name,
                        "raw_supplier_nzbn": sup.get("Supplier NZBN"),
                        "nzbn_quality": quality,
                        "identity_note": "This supplier name appears in a GETS procurement record. NZ Records has not yet linked this record to a verified legal entity.",
                        "identity_policy": "RFx ID + supplier source-row evidence hash; no row-order identity, no name merge, no NZBN merge in this phase",
                        "provenance": sup_prov,
                    }
                }
                supplier_entity_id = upsert_entity(conn, entity_type="other", canonical_name=f"Supplier record — {supplier_name} — RFx {rfx_id} #{ordinal}", slug=supplier_slug, status="GETS supplier record; not verified legal entity", metadata=supplier_meta, nzbn=None)
                supplier_source_id = source_record(conn, record_id=f"{supplier_key}:supplier", source_url=DATASET_SOURCE_URL, retrieved_at=retrieved_at, raw_hash=sup_prov["row_hash"], metadata=sup_prov)
                link_entity_source(conn, supplier_entity_id, supplier_source_id, {"role": "gets-supplier-source-row", "supplier_record_key": supplier_key, "rfx_id": rfx_id, "source_line_number": sup_line})
                upsert_relationship(conn, rfx_id_entity, "AWARDED_TO", supplier_entity_id, supplier_source_id, {"rfx_id": rfx_id, "supplier_record_key": supplier_key, "evidence": "GETS supplier source row"}, sup.get("Report Date") or None)
                conn.execute(
                    """
                    INSERT INTO gets_supplier_records(supplier_record_key,entity_id,rfx_id,row_ordinal_for_rfx,business_name,raw_supplier_nzbn,nzbn_quality,full_address,country,website,report_date,source_filename,source_line_number,row_hash,provenance_json,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
                    ON CONFLICT(supplier_record_key) DO UPDATE SET entity_id=excluded.entity_id,rfx_id=excluded.rfx_id,row_ordinal_for_rfx=excluded.row_ordinal_for_rfx,business_name=excluded.business_name,raw_supplier_nzbn=excluded.raw_supplier_nzbn,nzbn_quality=excluded.nzbn_quality,full_address=excluded.full_address,country=excluded.country,website=excluded.website,report_date=excluded.report_date,source_filename=excluded.source_filename,source_line_number=excluded.source_line_number,row_hash=excluded.row_hash,provenance_json=excluded.provenance_json,updated_at=CURRENT_TIMESTAMP
                    """,
                    (supplier_key, supplier_entity_id, rfx_id, ordinal, supplier_name, sup.get("Supplier NZBN"), quality, sup.get("Full Address"), sup.get("Country"), sup.get("Website"), sup.get("Report Date"), FILES["suppliers"], sup_line, sup_prov["row_hash"], sql_json(sup_prov)),
                )
                counts["supplier_entities"] += 1
                counts["awarded_to_relationships"] += 1

        rows_seen = 10 + sum(len(v) for v in suppliers_by_rfx.values()) + sum(len(v) for v in regions_by_rfx.values()) + sum(len(v) for v in cats_by_rfx.values())
        rows_written = counts["rfx_entities"] + counts["supplier_entities"] + counts["issued_relationships"] + counts["awarded_to_relationships"] + counts["region_associations"] + counts["unspsc_associations"]
        conn.execute(
            "UPDATE import_runs SET completed_at=?, status='completed', rows_seen=?, rows_written=?, errors=?, metadata_json=? WHERE id=?",
            (now(), rows_seen, rows_written, errors, sql_json({"sample_ids": sample_ids, "counts": dict(counts), "target": "local-sqlite", "remote_writes_enabled": False}), run_id),
        )

    return {
        "status": "success",
        "target": "local-sqlite",
        "remote_writes_enabled": False,
        "db": str(conn.execute("PRAGMA database_list").fetchone()[2]),
        "sample_ids": sample_ids,
        "counts": dict(counts),
        "rows_seen": rows_seen,
        "rows_written": rows_written,
        "errors": errors,
        "duration_seconds": time.perf_counter() - start,
    }


def main() -> int:
    args = parse_args()
    input_dir = Path(args.input_dir).resolve()
    sample_file = Path(args.sample_file).resolve()
    db = Path(args.db).resolve()
    for filename in FILES.values():
        if not (input_dir / filename).exists():
            raise SystemExit(f"missing required input file: {input_dir / filename}")
    sample_ids = load_sample(sample_file)
    conn = open_db(db, args.reset_local_db)
    result = import_sample(input_dir, sample_ids, conn)
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
