<script lang="ts">
  import { page } from '$app/state';
  import { afterNavigate, goto } from '$app/navigation';
  import SiteHeader from '$lib/SiteHeader.svelte';

  type DirectoryKind = 'charities' | 'officers' | 'procurement';
  type DirectoryResult = {
    id?: string | number;
    entity_id?: string | number;
    canonical_name?: string;
    entity_type?: string;
    nzbn?: string | null;
    status?: string | null;
    relationship_count?: number;
    rfx_id?: string;
    title?: string;
    award_type?: string;
    posting_agency?: string;
    agency_entity_id?: string | number;
    open_date?: string | null;
    close_date?: string | null;
    supplier_count?: number;
    region_count?: number;
    category_count?: number;
    reported_value_raw?: string | null;
    sort_date?: string | null;
  };

  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const pageSize = 50;
  const procurementPageSize = 25;
  const statuses = ['All', 'Awarded', 'Not awarded'];

  function readKindFromUrl(): DirectoryKind {
    const value = page.url.searchParams.get('kind');
    return value === 'officers' || value === 'procurement' ? value : 'charities';
  }
  function readLetterFromUrl() { const value = (page.url.searchParams.get('letter') ?? 'A').toUpperCase(); return /^[A-Z]$/.test(value) ? value : 'A'; }
  function readSortFromUrl() { const value = page.url.searchParams.get('sort') ?? ''; return ['most', 'least'].includes(value) ? value : 'az'; }
  function readPageFromUrl() { return Math.max(1, Number(page.url.searchParams.get('page') ?? 1) || 1); }
  function readQFromUrl() { return page.url.searchParams.get('q') ?? ''; }
  function readStatusFromUrl() { const value = page.url.searchParams.get('status') ?? 'All'; return value === 'Awarded' || value === 'Not awarded' || value === 'Not Awarded' ? value.replace('Awarded', 'awarded').replace('Not awarded', 'Not awarded') : 'All'; }
  function readYearFromUrl() { const value = page.url.searchParams.get('year') ?? ''; return /^\d{4}$/.test(value) ? value : ''; }

  let kind = $state<DirectoryKind>(readKindFromUrl());
  let letter = $state(readLetterFromUrl());
  let sort = $state(readSortFromUrl());
  let pageNum = $state(readPageFromUrl());
  let q = $state(readQFromUrl());
  let status = $state(readStatusFromUrl());
  let year = $state(readYearFromUrl());
  let results = $state<DirectoryResult[]>([]);
  let loading = $state(true);
  let error = $state('');
  let total = $state(0);
  let totalPages = $state(1);
  let timer: ReturnType<typeof setTimeout>;

  function isProcurement() { return kind === 'procurement'; }
  function title() { return kind === 'procurement' ? 'Government tenders' : kind === 'officers' ? 'Charity officer records' : 'Charities'; }
  function intro() {
    if (kind === 'procurement') return 'Search government tender and award records published through the Government Electronic Tenders Service (GETS). These include tenders that resulted in an award and tenders recorded as not awarded.';
    return kind === 'officers' ? 'People and organisations listed as officers in the Charities Register.' : 'Charities imported from the New Zealand Charities Register.';
  }
  function buildUrl(nextPage = pageNum) {
    const params = new URLSearchParams({ kind });
    if (kind === 'procurement') {
      if (q.trim()) params.set('q', q.trim());
      if (status !== 'All') params.set('status', status === 'Not awarded' ? 'Not Awarded' : status);
      if (year) params.set('year', year);
      params.set('page', String(nextPage));
    } else {
      params.set('letter', letter); params.set('sort', sort); if (nextPage > 1) params.set('page', String(nextPage));
    }
    return `/directory?${params.toString()}`;
  }
  async function loadFor(nextKind: DirectoryKind, nextLetter: string, nextSort: string, nextPage: number, nextQ = q, nextStatus = status, nextYear = year) {
    loading = true; error = '';
    try {
      const params = new URLSearchParams({ kind: nextKind, page: String(nextPage), pageSize: String(nextKind === 'procurement' ? procurementPageSize : pageSize) });
      if (nextKind === 'procurement') { if (nextQ.trim()) params.set('q', nextQ.trim()); if (nextStatus !== 'All') params.set('status', nextStatus === 'Not awarded' ? 'Not Awarded' : nextStatus); if (nextYear) params.set('year', nextYear); }
      else { params.set('letter', nextLetter); params.set('sort', nextSort); }
      const response = await fetch(`/api/directory?${params.toString()}`);
      if (!response.ok) throw new Error(`Directory request failed: ${response.status}`);
      const payload = await response.json();
      results = payload.results ?? []; total = Number(payload.total ?? results.length); totalPages = Math.max(1, Number(payload.totalPages ?? 1)); pageNum = Math.max(1, Math.min(Number(payload.page ?? nextPage), totalPages));
    } catch (err) { console.error('Directory load failed', err); results = []; total = 0; totalPages = 1; pageNum = nextPage; error = 'Directory records could not be loaded. Please try again.'; }
    finally { loading = false; }
  }
  function choose(nextKind: DirectoryKind, nextLetter = letter, nextSort = sort) { kind = nextKind; letter = nextLetter; sort = nextSort; pageNum = 1; goto(buildUrl(1), { replaceState: false, noScroll: true }); }
  function updateProcurementFilters() { clearTimeout(timer); timer = setTimeout(() => { pageNum = 1; goto(buildUrl(1), { replaceState: false, noScroll: true, keepFocus: true }); }, 150); }
  function setStatus(value: string) { status = value; updateProcurementFilters(); }
  function goToPage(nextPage: number) { pageNum = Math.max(1, Math.min(nextPage, totalPages)); goto(buildUrl(pageNum), { replaceState: false, noScroll: true }); }
  function pages() { const start = Math.max(1, pageNum - 2); const end = Math.min(totalPages, pageNum + 2); return Array.from({ length: end - start + 1 }, (_, index) => start + index); }
  function rangeText() { if (loading) return 'Loading…'; if (total === 0) return isProcurement() ? 'No government tenders found' : `No records beginning with ${letter}`; const size = isProcurement() ? procurementPageSize : pageSize; const start = (pageNum - 1) * size + 1; const end = Math.min(pageNum * size, total); return `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()} results`; }
  function displayDate(e: DirectoryResult) { return e.close_date || e.open_date || e.sort_date || 'Date not supplied'; }
  function supplierText(count: unknown) { const n = Number(count ?? 0); return `${n.toLocaleString()} ${n === 1 ? 'successful supplier' : 'successful suppliers'}`; }

  async function syncFromUrl() {
    if (page.url.pathname !== '/directory') return;
    const nextKind = readKindFromUrl(); const nextLetter = readLetterFromUrl(); const nextSort = readSortFromUrl(); const nextPage = readPageFromUrl(); const nextQ = readQFromUrl(); const nextStatus = readStatusFromUrl(); const nextYear = readYearFromUrl();
    kind = nextKind; letter = nextLetter; sort = nextSort; pageNum = nextPage; q = nextQ; status = nextStatus; year = nextYear;
    await loadFor(nextKind, nextLetter, nextSort, nextPage, nextQ, nextStatus, nextYear);
  }
  afterNavigate(() => { syncFromUrl(); });
</script>

<svelte:head><title>{title()} · NZ Records</title></svelte:head>
<SiteHeader />
<main>
  <p class="breadcrumb"><a href="/">Home</a> / Public records</p><h1>{title()}</h1><p class="intro">{intro()}</p>
  {#if kind === 'procurement'}<aside class="note"><strong>What is GETS?</strong><span>GETS is the Government Electronic Tenders Service, where New Zealand government agencies advertise tender opportunities and publish award information.</span></aside>{/if}
  {#if kind === 'officers'}<aside class="note"><strong>A note about names</strong><span>The same person may appear more than once if they are involved with different charities. We don't combine records just because the names match, because they could be different people.</span></aside>{/if}

  <div class="tabs"><button class:active={kind === 'charities'} onclick={() => choose('charities', letter)}>Charities</button><button class:active={kind === 'officers'} onclick={() => choose('officers', letter)}>Officer records</button><button class:active={kind === 'procurement'} onclick={() => choose('procurement')}>Government tenders</button></div>

  {#if kind === 'procurement'}
    <div class="filters"><label><span>Search government tenders</span><input bind:value={q} oninput={updateProcurementFilters} placeholder="Search RFx number, title or government agency" /></label><label><span>Outcome</span><select value={status} onchange={(event) => setStatus(event.currentTarget.value)}>{#each statuses as item}<option value={item}>{item}</option>{/each}</select></label><label><span>Year</span><input bind:value={year} oninput={updateProcurementFilters} inputmode="numeric" maxlength="4" placeholder="2024" /></label></div>
  {:else}
    <nav class="alphabet" aria-label="Browse by first letter">{#each letters as l}<button class:active={letter === l} onclick={() => choose(kind, l)}>{l}</button>{/each}</nav>
    <div class="toolbar"><strong>{rangeText()}</strong><label>Sort by <select value={sort} onchange={(event) => choose(kind, letter, event.currentTarget.value)}><option value="az">Name A–Z</option><option value="most">Most connections</option><option value="least">Least connections</option></select></label></div>
  {/if}
  {#if kind === 'procurement'}<div class="toolbar"><strong>{rangeText()}</strong><span>Newest tenders first</span></div>{/if}

  <section class="results">
    {#if error}<div class="empty error">{error}</div>{/if}
    {#each results as e}
      {#if kind === 'procurement'}
        <a class="row tender" href={`/record/${e.entity_id}`}><div><strong>{e.title}</strong><span>Government tender · RFx number {e.rfx_id}</span></div><dl><div><dt>Outcome</dt><dd>{e.award_type}</dd></div><div><dt>Issued by</dt><dd>{e.posting_agency}</dd></div><div><dt>Date</dt><dd>{displayDate(e)}</dd></div><div><dt>Successful suppliers</dt><dd>{supplierText(e.supplier_count)}</dd></div>{#if e.reported_value_raw}<div><dt>Reported / expected value</dt><dd>{e.reported_value_raw}</dd></div>{/if}</dl><span class="view">View tender</span></a>
      {:else}
        <a class="row" href={`/record/${e.id}`}><div><strong>{e.canonical_name}</strong><span>{kind === 'officers' ? 'Charity officer record' : e.entity_type?.replace('_', ' ')}{e.status ? ` · ${e.status}` : ''}{e.nzbn ? ` · NZBN ${e.nzbn}` : ''}</span></div><div class="count"><b>{e.relationship_count ?? 0}</b><span>{Number(e.relationship_count) === 1 ? 'connection' : 'connections'}</span></div><span class="view">View record</span></a>
      {/if}
    {/each}
    {#if !loading && results.length === 0}<div class="empty">{kind === 'procurement' ? 'No government tenders match those filters.' : `No imported records beginning with ${letter}.`}</div>{/if}
  </section>

  {#if totalPages > 1}<nav class="pagination" aria-label="Pagination"><button disabled={pageNum === 1 || loading} onclick={() => goToPage(pageNum - 1)}>Previous</button>{#if pages()[0] > 1}<button onclick={() => goToPage(1)}>1</button>{#if pages()[0] > 2}<span>…</span>{/if}{/if}{#each pages() as p}<button class:active={p === pageNum} aria-current={p === pageNum ? 'page' : undefined} onclick={() => goToPage(p)}>{p}</button>{/each}{#if pages()[pages().length - 1] < totalPages}{#if pages()[pages().length - 1] < totalPages - 1}<span>…</span>{/if}<button onclick={() => goToPage(totalPages)}>{totalPages}</button>{/if}<button disabled={pageNum === totalPages || loading} onclick={() => goToPage(pageNum + 1)}>Next</button></nav>{/if}
</main>

<style>
  :global(*){box-sizing:border-box}:global(body){margin:0;background:#f7f7f4;color:#202624;font-family:Arial,Helvetica,sans-serif}:global(a){color:#135f50}main{max-width:1060px;margin:auto;padding:38px 28px 90px}.breadcrumb{font-size:13px;margin:0 0 28px;color:#69726e}.breadcrumb a{text-decoration:underline}h1{font-family:Georgia,'Times New Roman',serif;font-size:46px;letter-spacing:-.02em;margin:0 0 10px}.intro{font-size:18px;color:#58625e;margin:0 0 25px;line-height:1.55}.note{max-width:780px;background:#eef4f1;border-left:5px solid #176b5a;padding:17px 20px;margin:25px 0;display:flex;flex-direction:column;gap:6px;line-height:1.5}.note span{color:#46504c}.tabs{display:flex;border-bottom:1px solid #bfc6c1;margin-top:35px;flex-wrap:wrap}.tabs button{background:none;border:0;border-bottom:4px solid transparent;padding:12px 18px;cursor:pointer;font-size:15px;color:#40504a}.tabs button.active{border-color:#176b5a;color:#202624;font-weight:700}.alphabet{display:flex;flex-wrap:wrap;gap:4px;padding:22px 0}.alphabet button{background:#fff;border:1px solid #bfc6c1;width:34px;height:34px;color:#135f50;font-weight:700;cursor:pointer}.alphabet button:hover,.alphabet button.active{background:#176b5a;color:#fff;border-color:#176b5a}.filters{display:grid;grid-template-columns:1fr 180px 130px;gap:14px;padding:22px 0}.filters label{display:flex;flex-direction:column;gap:7px;font-size:13px;font-weight:700}.filters input,.filters select,.toolbar select{background:#fff;border:1px solid #909a95;padding:10px;font-size:15px;border-radius:3px}.toolbar{border-top:1px solid #cdd2ce;border-bottom:1px solid #cdd2ce;padding:14px 0;display:flex;justify-content:space-between;align-items:center;gap:20px;font-size:13px}.toolbar label{display:flex;gap:8px;align-items:center}.results{background:#fff}.row{display:grid;grid-template-columns:1fr 110px 100px;gap:20px;align-items:center;padding:17px 15px;border-bottom:1px solid #d5dad6;color:#202624;text-decoration:none}.row:hover{background:#f1f4f1}.row strong{font-size:16px;color:#135f50;text-decoration:underline}.row span{font-size:13px;color:#68726e}.row>div:first-child{display:flex;flex-direction:column;gap:5px}.tender{grid-template-columns:1fr 1.3fr 100px;align-items:start}.tender dl{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin:0}.tender dt{font-size:11px;font-weight:700;color:#59635f}.tender dd{font-size:13px;margin:2px 0 0;color:#202624}.count{display:flex;flex-direction:column}.count b{font-size:20px}.view{font-weight:700;color:#135f50}.empty{padding:28px;background:#fff;color:#69726e}.error{color:#8f1f1f}.pagination{display:flex;justify-content:center;align-items:center;gap:6px;flex-wrap:wrap;margin-top:24px}.pagination button{min-width:38px;border:1px solid #bfc6c1;background:#fff;color:#135f50;font-weight:700;padding:9px;cursor:pointer}.pagination button.active{background:#176b5a;color:white}.pagination button:disabled{opacity:.45;cursor:not-allowed}@media(max-width:760px){.filters,.row,.tender,.tender dl{grid-template-columns:1fr}.toolbar{align-items:flex-start;flex-direction:column}}
</style>
