#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def assert_contains(path: str, text: str):
    content = read(path)
    assert text in content, f'{path} missing expected text: {text!r}'


def assert_not_contains(path: str, text: str):
    content = read(path)
    assert text not in content, f'{path} unexpectedly contains: {text!r}'


def test_navigation_uses_government_tenders_not_procurement_label():
    header = read('src/lib/SiteHeader.svelte')
    assert 'Government tenders' in header
    assert '/directory?kind=procurement&page=1' in header
    assert 'isProcurement' in header


def test_homepage_has_government_tenders_browse_card():
    home = read('src/routes/+page.svelte')
    assert 'Government tenders' in home
    assert 'Explore government tender and award records published through GETS.' in home
    assert '/directory?kind=procurement&page=1' in home


def test_directory_supports_procurement_without_alphabet_controls():
    page = read('src/routes/directory/+page.svelte')
    assert "'procurement'" in page
    assert 'Search government tenders' in page
    assert 'Search RFx number, title or government agency' in page
    assert 'Outcome' in page
    assert 'Government tenders' in page
    assert 'afterNavigate' in page


def test_directory_api_supports_procurement_filters_and_safe_date_sort():
    api = read('src/routes/api/directory/+server.ts')
    assert "kindParam === 'procurement'" in api
    assert 'readProcurementDirectory' in api
    assert 'supplier_count' in api
    assert 'region_count' in api
    assert 'category_count' in api
    assert 'dateToIsoExpression' in api
    assert 'LIMIT ? OFFSET ?' in api
    assert 'pageSize' in api and 'MAX_PROCUREMENT_PAGE_SIZE = 50' in api


def test_global_search_has_plain_english_gets_labels():
    api = read('src/routes/api/search/+server.ts')
    page = read('src/routes/explore/+page.svelte')
    assert 'public_type' in api
    assert 'Government tender' in api
    assert 'GETS supplier record' in api
    assert 'Government agency' in api
    assert 'displayType' in page


def test_record_page_uses_plain_english_gets_copy():
    record = read('src/routes/record/[id]/+page.svelte')
    required = [
        'Government tender',
        'RFx number',
        'Outcome',
        'Issued by',
        'Reported / expected value',
        'Product / service categories',
        'Source / evidence',
        'This supplier information was published in a GETS tender record.',
        'visibleConnections',
        'Show all connections',
        'nzbnSourceNote',
        'displayConnectedName',
        'GETS reported values may represent a fixed contract value or an estimated value over the life of the tender',
        'Show all suppliers',
    ]
    for text in required:
        assert text in record, text
    forbidden_public_fragments = ['government paid', 'government spent', 'amount paid']
    for text in forbidden_public_fragments:
        assert text not in record.lower(), text


def test_record_page_public_connections_do_not_render_internal_entity_types():
    record = read('src/routes/record/[id]/+page.svelte')
    server = read('src/routes/record/[id]/+page.server.ts')
    assert 'connectedRecordType' in record
    assert 'connected_gets_rfx_entity_id' in server
    assert 'connected_gets_supplier_entity_id' in server
    assert 'connected_metadata_json' in server
    assert 'Government agency' in record
    assert 'GETS supplier record' in record
    assert 'Government tender' in record
    assert "String(c.connected_type).replace('_',' ')" not in record


def test_record_page_agency_note_is_not_shown_on_tenders_or_suppliers():
    record = read('src/routes/record/[id]/+page.svelte')
    assert '!rfx&&!supplier&&(Boolean(gets?.agency)||getsKind===\'agency\'||connections.some((c)=>c.predicate===\'ISSUED\'))' in record
    assert "{#if isGetsAgencyRecord}<aside class=\"note\"><strong>About this agency record</strong>" in record


def test_supplier_pages_translate_nzbn_quality_and_tender_lists_omit_raw_quality():
    record = read('src/routes/record/[id]/+page.svelte')
    assert 'nzbnSourceNote' in record
    assert 'NZBN not supplied in source data' in record
    assert 'NZBN could not be reliably recovered from the source data' in record
    assert 'NZBN in source data was not in a usable format' in record
    assert 'NZBN in source data could not be reliably used for identification' in record
    supplier_list_block = record.split('<div class="supplier-links">', 1)[1].split('</div>', 1)[0]
    assert 's.nzbn_quality' not in supplier_list_block


def main():
    tests = [value for name, value in sorted(globals().items()) if name.startswith('test_')]
    failures = []
    for test in tests:
        try:
            test()
        except AssertionError as exc:
            failures.append(f'{test.__name__}: {exc}')
    if failures:
        print('\n'.join(failures))
        raise SystemExit(1)
    print(f'{len(tests)} Phase 8B static assertions passed')


if __name__ == '__main__':
    main()
