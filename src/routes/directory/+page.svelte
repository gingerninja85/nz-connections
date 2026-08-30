<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import SiteHeader from '$lib/SiteHeader.svelte';

  type DirectoryKind = 'charities' | 'officers';
  type DirectoryResult = {
    id: string | number;
    canonical_name: string;
    entity_type: string;
    nzbn?: string | null;
    status?: string | null;
    relationship_count?: number;
  };

  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const pageSize = 50;

  function readKindFromUrl(): DirectoryKind {
    return page.url.searchParams.get('kind') === 'officers' ? 'officers' : 'charities';
  }

  function readLetterFromUrl() {
    const value = (page.url.searchParams.get('letter') ?? 'A').toUpperCase();
    return /^[A-Z]$/.test(value) ? value : 'A';
  }

  function readSortFromUrl() {
    const value = page.url.searchParams.get('sort') ?? '';
    return ['most', 'least'].includes(value) ? value : 'az';
  }

  function readPageFromUrl() {
    return Math.max(1, Number(page.url.searchParams.get('page') ?? 1) || 1);
  }

  let kind = $state<DirectoryKind>(readKindFromUrl());
  let letter = $state(readLetterFromUrl());
  let sort = $state(readSortFromUrl());
  let pageNum = $state(readPageFromUrl());
  let results = $state<DirectoryResult[]>([]);
  let loading = $state(true);
  let error = $state('');
  let total = $state(0);
  let totalPages = $state(1);

  function buildUrl(nextPage = pageNum) {
    const params = new URLSearchParams({ kind, letter, sort });
    if (nextPage > 1) params.set('page', String(nextPage));
    return `/directory?${params.toString()}`;
  }

  async function loadFor(nextKind: DirectoryKind, nextLetter: string, nextSort: string, nextPage: number) {
    loading = true;
    error = '';
    try {
      const params = new URLSearchParams({ kind: nextKind, letter: nextLetter, sort: nextSort, page: String(nextPage), pageSize: String(pageSize) });
      const response = await fetch(`/api/directory?${params.toString()}`);
      if (!response.ok) throw new Error(`Directory request failed: ${response.status}`);
      const payload = await response.json();
      results = payload.results ?? [];
      total = Number(payload.total ?? results.length);
      totalPages = Math.max(1, Number(payload.totalPages ?? 1));
      pageNum = Math.max(1, Math.min(Number(payload.page ?? nextPage), totalPages));
    } catch (err) {
      console.error('Directory load failed', err);
      results = [];
      total = 0;
      totalPages = 1;
      pageNum = nextPage;
      error = 'Directory records could not be loaded. Please try again.';
    } finally {
      loading = false;
    }
  }

  function choose(nextKind: DirectoryKind, nextLetter: string, nextSort = sort) {
    kind = nextKind;
    letter = nextLetter;
    sort = nextSort;
    pageNum = 1;
    goto(buildUrl(1), { replaceState: false, noScroll: true });
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

  function rangeText() {
    if (loading) return 'Loading…';
    if (total === 0) return `No records beginning with ${letter}`;
    const start = (pageNum - 1) * pageSize + 1;
    const end = Math.min(pageNum * pageSize, total);
    return `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()} results`;
  }

  $effect(() => {
    page.url.href;
    if (page.url.pathname !== '/directory') return;
    const nextKind = readKindFromUrl();
    const nextLetter = readLetterFromUrl();
    const nextSort = readSortFromUrl();
    const nextPage = readPageFromUrl();
    kind = nextKind;
    letter = nextLetter;
    sort = nextSort;
    pageNum = nextPage;
    loadFor(nextKind, nextLetter, nextSort, nextPage);
  });
</script>

<svelte:head>
  <title>{kind === 'officers' ? 'Charity officer records' : 'Charities'} · NZ Records</title>
</svelte:head>

<SiteHeader />

<main>
  <p class="breadcrumb"><a href="/">Home</a> / Public records</p>
  <h1>{kind === 'officers' ? 'Charity officer records' : 'Charities'}</h1>
  <p class="intro">{kind === 'officers' ? 'People and organisations listed as officers in the Charities Register.' : 'Charities imported from the New Zealand Charities Register.'}</p>

  {#if kind === 'officers'}
    <aside class="note"><strong>A note about names</strong><span>The same person may appear more than once if they are involved with different charities. We don't combine records just because the names match, because they could be different people.</span></aside>
  {/if}

  <div class="tabs">
    <button class:active={kind === 'charities'} onclick={() => choose('charities', letter)}>Charities</button>
    <button class:active={kind === 'officers'} onclick={() => choose('officers', letter)}>Officer records</button>
  </div>

  <nav class="alphabet" aria-label="Browse by first letter">
    {#each letters as l}
      <button class:active={letter === l} onclick={() => choose(kind, l)}>{l}</button>
    {/each}
  </nav>

  <div class="toolbar">
    <strong>{rangeText()}</strong>
    <label>Sort by
      <select value={sort} onchange={(event) => choose(kind, letter, event.currentTarget.value)}>
        <option value="az">Name A–Z</option>
        <option value="most">Most connections</option>
        <option value="least">Least connections</option>
      </select>
    </label>
  </div>

  <section class="results">
    {#if error}<div class="empty error">{error}</div>{/if}
    {#each results as e}
      <a class="row" href={`/record/${e.id}`}>
        <div><strong>{e.canonical_name}</strong><span>{kind === 'officers' ? 'Charity officer record' : e.entity_type.replace('_', ' ')}{e.status ? ` · ${e.status}` : ''}{e.nzbn ? ` · NZBN ${e.nzbn}` : ''}</span></div>
        <div class="count"><b>{e.relationship_count ?? 0}</b><span>{Number(e.relationship_count) === 1 ? 'connection' : 'connections'}</span></div>
        <span class="view">View record</span>
      </a>
    {/each}
    {#if !loading && results.length === 0}<div class="empty">No imported records beginning with {letter}.</div>{/if}
  </section>

  {#if totalPages > 1}
    <nav class="pagination" aria-label="Pagination">
      <button disabled={pageNum === 1 || loading} onclick={() => goToPage(pageNum - 1)}>Previous</button>
      {#if pages()[0] > 1}<button onclick={() => goToPage(1)}>1</button>{#if pages()[0] > 2}<span>…</span>{/if}{/if}
      {#each pages() as p}
        <button class:active={p === pageNum} aria-current={p === pageNum ? 'page' : undefined} onclick={() => goToPage(p)}>{p}</button>
      {/each}
      {#if pages()[pages().length - 1] < totalPages}{#if pages()[pages().length - 1] < totalPages - 1}<span>…</span>{/if}<button onclick={() => goToPage(totalPages)}>{totalPages}</button>{/if}
      <button disabled={pageNum === totalPages || loading} onclick={() => goToPage(pageNum + 1)}>Next</button>
    </nav>
  {/if}
</main>

<style>
  :global(*){box-sizing:border-box}:global(body){margin:0;background:#f7f7f4;color:#202624;font-family:Arial,Helvetica,sans-serif}:global(a){color:#135f50}main{max-width:1060px;margin:auto;padding:38px 28px 90px}.breadcrumb{font-size:13px;margin:0 0 28px;color:#69726e}.breadcrumb a{text-decoration:underline}h1{font-family:Georgia,'Times New Roman',serif;font-size:46px;letter-spacing:-.02em;margin:0 0 10px}.intro{font-size:18px;color:#58625e;margin:0 0 25px}.note{max-width:780px;background:#eef4f1;border-left:5px solid #176b5a;padding:17px 20px;margin:25px 0;display:flex;flex-direction:column;gap:6px;line-height:1.5}.note strong{font-size:16px}.note span{color:#46504c}.tabs{display:flex;border-bottom:1px solid #bfc6c1;margin-top:35px}.tabs button{background:none;border:0;border-bottom:4px solid transparent;padding:12px 18px;cursor:pointer;font-size:15px;color:#40504a}.tabs button.active{border-color:#176b5a;color:#202624;font-weight:700}.alphabet{display:flex;flex-wrap:wrap;gap:4px;padding:22px 0}.alphabet button{background:#fff;border:1px solid #bfc6c1;width:34px;height:34px;color:#135f50;font-weight:700;cursor:pointer}.alphabet button:hover,.alphabet button.active{background:#176b5a;color:#fff;border-color:#176b5a}.toolbar{border-top:1px solid #cdd2ce;border-bottom:1px solid #cdd2ce;padding:14px 0;display:flex;justify-content:space-between;align-items:center;gap:20px;font-size:13px}.toolbar label{display:flex;gap:8px;align-items:center}.toolbar select{background:#fff;border:1px solid #909a95;padding:8px;font-size:14px}.results{background:#fff}.row{display:grid;grid-template-columns:1fr 110px 100px;gap:20px;align-items:center;padding:17px 15px;border-bottom:1px solid #d5dad6;color:#202624;text-decoration:none}.row:hover{background:#f1f4f1}.row strong{font-size:16px;color:#135f50;text-decoration:underline}.row span{font-size:13px;color:#68726e}.row>div:first-child{display:flex;flex-direction:column;gap:5px}.count{display:flex;flex-direction:column}.count b{font-size:20px}.view{font-weight:700;color:#135f50}.empty{padding:28px;background:#fff;color:#69726e}.pagination{display:flex;justify-content:center;align-items:center;gap:6px;flex-wrap:wrap;margin-top:24px}.pagination button{min-width:38px;border:1px solid #bfc6c1;background:#fff;color:#135f50;font-weight:700;padding:9px 12px;border-radius:3px;cursor:pointer}.pagination button.active,.pagination button:hover:not(:disabled){background:#176b5a;color:#fff;border-color:#176b5a}.pagination button:disabled{opacity:.45;cursor:not-allowed}.pagination span{padding:0 4px;color:#69726e}@media(max-width:700px){main{padding:28px 18px 70px}h1{font-size:36px}.toolbar{align-items:flex-start;flex-direction:column}.row{grid-template-columns:1fr;gap:8px}.view{justify-self:start}.pagination{justify-content:flex-start}.pagination button{min-width:44px;min-height:42px}}
</style>
