<script lang="ts">
  import { page } from '$app/state';
  import { afterNavigate, goto } from '$app/navigation';
  import { findDemoEntities } from '$lib/demo';
  import SiteHeader from '$lib/SiteHeader.svelte';

  type SearchResult = { id: string | number; canonical_name?: string; name?: string; entity_type?: string; type?: string; public_type?: string; tender_outcome?: string | null; rfx_id?: string | null; supplier_rfx_id?: string | null; nzbn?: string | null; company_number?: string | null; status?: string | null; subtitle?: string; relationship_count?: number };

  function displayType(entity: SearchResult) {
    if (entity.public_type) return entity.public_type;
    const raw = entity.entity_type ?? entity.type ?? 'Public record';
    if (raw === 'public_agency') return 'Government agency';
    if (raw === 'contract') return 'Government tender';
    if (raw === 'other') return 'Public record';
    return raw.replace('_', ' ');
  }

  function displayName(entity: SearchResult) {
    const name = entity.canonical_name ?? entity.name ?? 'Unnamed record';
    if (entity.public_type === 'Government tender' && entity.rfx_id) return name.replace(new RegExp(`^Procurement record RFx ${entity.rfx_id} — `), '');
    if (entity.public_type === 'GETS supplier record') return name.replace(/^Supplier record — /, '').replace(/ — RFx .*$/, '');
    return name;
  }

  const pageSize = 25;

  function readQueryFromUrl() {
    return page.url.searchParams.get('q') ?? '';
  }

  function readPageFromUrl() {
    return Math.max(1, Number(page.url.searchParams.get('page') ?? 1) || 1);
  }

  const initialQuery = readQueryFromUrl();
  const initialResults = findDemoEntities(initialQuery);

  let query = $state(initialQuery);
  let pageNum = $state(readPageFromUrl());
  let results = $state<SearchResult[]>(initialResults);
  let mode = $state<'demo' | 'live'>('demo');
  let loading = $state(false);
  let total = $state(initialResults.length);
  let totalPages = $state(1);
  let timer: ReturnType<typeof setTimeout>;

  function buildUrl(nextPage = pageNum) {
    const url = new URL(page.url);
    url.search = '';
    if (query.trim()) url.searchParams.set('q', query.trim());
    if (nextPage > 1) url.searchParams.set('page', String(nextPage));
    return `${url.pathname}${url.search}`;
  }

  async function runSearchFor(q: string, nextPage: number) {
    const targetPage = Math.max(1, nextPage);
    pageNum = targetPage;
    if (q.length < 2) {
      const demoResults = findDemoEntities(q);
      results = demoResults;
      total = demoResults.length;
      totalPages = 1;
      mode = 'demo';
      return;
    }
    loading = true;
    try {
      const params = new URLSearchParams({ q, page: String(targetPage), pageSize: String(pageSize) });
      const response = await fetch(`/api/search?${params.toString()}`);
      if (response.ok) {
        const payload = await response.json();
        if (Array.isArray(payload.results)) {
          const liveResults = payload.results;
          const liveTotalPages = Math.max(1, Number(payload.totalPages ?? 1));
          results = liveResults;
          total = Number(payload.total ?? liveResults.length);
          totalPages = liveTotalPages;
          pageNum = Math.max(1, Math.min(Number(payload.page ?? targetPage), liveTotalPages));
          mode = 'live';
          return;
        }
      }
      const demoResults = findDemoEntities(q);
      results = demoResults;
      total = demoResults.length;
      totalPages = 1;
      mode = 'demo';
    } catch {
      const demoResults = findDemoEntities(q);
      results = demoResults;
      total = demoResults.length;
      totalPages = 1;
      mode = 'demo';
    } finally {
      loading = false;
    }
  }

  function syncQuery() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      pageNum = 1;
      goto(buildUrl(1), { replaceState: true, noScroll: true, keepFocus: true });
      runSearchFor(query.trim(), 1);
    }, 180);
  }

  function goToPage(nextPage: number) {
    pageNum = Math.max(1, Math.min(nextPage, totalPages));
    goto(buildUrl(pageNum), { replaceState: false, noScroll: true });
  }

  function pages() {
    const start = Math.max(1, pageNum - 2);
    const end = Math.min(totalPages, pageNum + 2);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }

  function summaryText() {
    if (loading) return 'Searching…';
    if (mode === 'demo') return `${results.length} ${results.length === 1 ? 'demo record' : 'demo records'} found`;
    if (total === 0) return 'No records found';
    const start = (pageNum - 1) * pageSize + 1;
    const end = Math.min(pageNum * pageSize, total);
    return `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()} results`;
  }

  async function syncFromUrl() {
    if (page.url.pathname !== '/explore') return;
    const nextQuery = readQueryFromUrl();
    const nextPage = readPageFromUrl();
    query = nextQuery;
    await runSearchFor(nextQuery.trim(), nextPage);
  }

  afterNavigate(() => {
    syncFromUrl();
  });
</script>

<svelte:head><title>Search · NZ Records</title><meta name="description" content="Search New Zealand public records by name, organisation or NZBN and follow source-backed connections." /></svelte:head>
<SiteHeader />
<main><p class="breadcrumb"><a href="/">Home</a> / Search</p><h1>Search public records</h1><p class="intro">Search names, organisations and identifiers in the NZ Records database.</p><label class="search"><span>Search</span><div><input bind:value={query} oninput={syncQuery} placeholder="Name, organisation or NZBN"/><button onclick={() => { pageNum = 1; goto(buildUrl(1), { replaceState: true, noScroll: true }); runSearchFor(query.trim(), 1); }}>Search</button></div></label>
<div class="summary">{summaryText()}{#if mode === 'demo'}<span>Demo data</span>{/if}</div><section>{#each results as entity}{@const id=entity.id}{@const name=displayName(entity)}{@const type=displayType(entity)}{@const subtitle=entity.subtitle??[type,entity.tender_outcome,entity.rfx_id?`RFx number ${entity.rfx_id}`:entity.supplier_rfx_id?`RFx number ${entity.supplier_rfx_id}`:null,entity.status,entity.nzbn?`NZBN ${entity.nzbn}`:null].filter(Boolean).join(' · ')}{@const connections=Number(entity.relationship_count??0)}<a class="result" href={mode==='demo'?`/entity/${id}`:`/record/${id}`}><div><strong>{name}</strong><span>{subtitle}</span></div>{#if mode==='live'}<div class="connections"><b>{connections}</b><span>{connections===1?'connection':'connections'}</span></div>{/if}<span class="view">View record</span></a>{/each}{#if !loading&&results.length===0}<div class="empty">No records match your search.</div>{/if}</section>
{#if mode === 'live' && totalPages > 1}<nav class="pagination" aria-label="Pagination"><button disabled={pageNum === 1 || loading} onclick={() => goToPage(pageNum - 1)}>Previous</button>{#if pages()[0] > 1}<button onclick={() => goToPage(1)}>1</button>{#if pages()[0] > 2}<span>…</span>{/if}{/if}{#each pages() as p}<button class:active={p === pageNum} aria-current={p === pageNum ? 'page' : undefined} onclick={() => goToPage(p)}>{p}</button>{/each}{#if pages()[pages().length - 1] < totalPages}{#if pages()[pages().length - 1] < totalPages - 1}<span>…</span>{/if}<button onclick={() => goToPage(totalPages)}>{totalPages}</button>{/if}<button disabled={pageNum === totalPages || loading} onclick={() => goToPage(pageNum + 1)}>Next</button></nav>{/if}
{#if mode==='demo'}<p class="demo">The fictional demo records are shown only when live results are not available.</p>{/if}</main>
<style>:global(*){box-sizing:border-box}:global(body){margin:0;background:#f7f7f4;color:#202624;font-family:Arial,Helvetica,sans-serif}:global(a){color:#135f50}main{max-width:960px;margin:auto;padding:38px 28px 90px}.breadcrumb{font-size:13px;color:#68726e;margin:0 0 30px}.breadcrumb a{text-decoration:underline}h1{font-family:Georgia,'Times New Roman',serif;font-size:46px;margin:0 0 10px;letter-spacing:-.02em}.intro{font-size:18px;color:#58625e;margin:0 0 30px}.search{display:block;max-width:760px}.search>span{display:block;font-size:15px;font-weight:700;margin-bottom:8px}.search div{display:flex}.search input{flex:1;min-width:0;border:2px solid #5c6662;border-right:0;background:#fff;padding:14px;font-size:16px;border-radius:3px 0 0 3px}.search input:focus{outline:3px solid #f1c84c}.search button{border:0;background:#176b5a;color:#fff;font-size:15px;font-weight:700;padding:0 25px;cursor:pointer;border-radius:0 3px 3px 0}.summary{display:flex;justify-content:space-between;align-items:center;margin-top:35px;border-bottom:2px solid #69736e;padding-bottom:11px;font-size:14px;font-weight:700}.summary span{font-size:12px;background:#f4e9b8;padding:5px 8px}section{background:#fff}.result{display:grid;grid-template-columns:1fr 100px 100px;gap:20px;align-items:center;padding:19px 15px;border-bottom:1px solid #d5dad6;color:#202624;text-decoration:none}.result:hover{background:#f1f4f1}.result>div:first-child{display:flex;flex-direction:column;gap:5px}.result strong{font-size:17px;color:#135f50;text-decoration:underline}.result div>span{font-size:13px;color:#68726e}.connections{display:flex;flex-direction:column}.connections b{font-size:20px}.view{font-weight:700;color:#135f50}.empty{padding:28px;background:#fff;color:#69726e}.demo{font-size:13px;color:#68726e}.pagination{display:flex;justify-content:center;align-items:center;gap:6px;flex-wrap:wrap;margin-top:24px}.pagination button{min-width:38px;border:1px solid #bfc6c1;background:#fff;color:#135f50;font-weight:700;padding:9px 12px;border-radius:3px;cursor:pointer}.pagination button.active,.pagination button:hover:not(:disabled){background:#176b5a;color:#fff;border-color:#176b5a}.pagination button:disabled{opacity:.45;cursor:not-allowed}.pagination span{padding:0 4px;color:#69726e}@media(max-width:700px){main{padding:28px 18px 70px}h1{font-size:36px}.search div{flex-direction:column}.search input{border-right:2px solid #5c6662;border-radius:3px 3px 0 0}.search button{min-height:44px;border-radius:0 0 3px 3px}.result{grid-template-columns:1fr;gap:8px}.pagination{justify-content:flex-start}.pagination button{min-width:44px;min-height:42px}}</style>
