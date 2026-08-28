<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { findDemoEntities } from '$lib/demo';

  type SearchResult = { id: string | number; canonical_name?: string; name?: string; entity_type?: string; type?: string; nzbn?: string | null; company_number?: string | null; status?: string | null; subtitle?: string; relationship_count?: number };

  let query = $state(page.url.searchParams.get('q') ?? '');
  let results = $state<SearchResult[]>(findDemoEntities(query));
  let mode = $state<'demo' | 'live'>('demo');
  let loading = $state(false);
  let timer: ReturnType<typeof setTimeout>;

  async function runSearch() {
    const q = query.trim();
    if (q.length < 2) { results = findDemoEntities(q); mode = 'demo'; return; }
    loading = true;
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (response.ok) {
        const payload = await response.json();
        if (Array.isArray(payload.results)) { results = payload.results; mode = 'live'; return; }
      }
      results = findDemoEntities(q); mode = 'demo';
    } catch { results = findDemoEntities(q); mode = 'demo'; }
    finally { loading = false; }
  }

  function syncQuery() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const url = new URL(page.url);
      if (query.trim()) url.searchParams.set('q', query.trim()); else url.searchParams.delete('q');
      goto(`${url.pathname}${url.search}`, { replaceState: true, noScroll: true, keepFocus: true });
      runSearch();
    }, 180);
  }

  $effect(() => { runSearch(); });
</script>

<svelte:head><title>Explore · NZ Connections</title></svelte:head>
<header><a href="/">← NZ Connections</a><span>{mode === 'live' ? 'LIVE PUBLIC DATA' : 'INTERACTIVE PROTOTYPE'}</span></header>
<main>
  <div class="intro"><div class="eyebrow">EXPLORE THE GRAPH</div><h1>Search public records</h1><p>{mode === 'live' ? 'Results below are loaded from the NZ Connections public-record database.' : 'Until the D1 database is connected, this build falls back to clearly labelled fictional records so the interface can still be tested.'}</p></div>
  <label class="search"><span>⌕</span><input bind:value={query} oninput={syncQuery} autofocus placeholder="Search a company, person, NZBN…" /></label>
  <div class="count">{loading ? 'SEARCHING…' : `${results.length} ${results.length === 1 ? 'record' : 'records'} · ${mode === 'live' ? 'LIVE' : 'DEMO'}`}</div>
  <section class="results">
    {#each results as entity}
      {@const id = entity.id}
      {@const name = entity.canonical_name ?? entity.name ?? 'Unnamed record'}
      {@const type = entity.entity_type ?? entity.type ?? 'other'}
      {@const subtitle = entity.subtitle ?? [type.replace('_',' '), entity.status, entity.nzbn ? `NZBN ${entity.nzbn}` : null].filter(Boolean).join(' · ')}
      {@const connections = Number(entity.relationship_count ?? 0)}
      <a class="result" href={mode === 'demo' ? `/entity/${id}` : `/record/${id}`}>
        <div class={`icon ${type}`}>{type === 'person' ? 'P' : type === 'company' ? 'C' : type === 'public_agency' || type === 'agency' ? 'A' : '↗'}</div>
        <div class="copy"><div class="name-line"><strong>{name}</strong>{#if mode === 'live'}<span class:connected={connections > 0} class:many={connections >= 5} class="connections" title={`${connections} recorded ${connections === 1 ? 'connection' : 'connections'}`}>{connections}</span>{/if}</div><span>{subtitle}</span></div><div class="open">View record →</div>
      </a>
    {/each}
    {#if !loading && results.length === 0}<div class="empty">No records match that search.</div>{/if}
  </section>
</main>
<style>
:global(*){box-sizing:border-box}:global(body){margin:0;background:#07110f;color:#edf5f1;font-family:Inter,system-ui,sans-serif}:global(a){color:inherit;text-decoration:none}header{height:70px;border-bottom:1px solid #20332d;display:flex;align-items:center;justify-content:space-between;padding:0 max(24px,6vw);color:#9cb0a9;font-size:13px}header a{font-weight:800;color:#edf5f1}header span{font-size:10px;letter-spacing:.14em;color:#4de1a1}main{max-width:900px;margin:0 auto;padding:72px 24px}.intro{max-width:680px}.eyebrow{font-size:11px;letter-spacing:.18em;font-weight:800;color:#4de1a1}.intro h1{font-size:48px;letter-spacing:-.045em;margin:12px 0}.intro p{color:#8fa39c;line-height:1.65}.search{margin-top:38px;display:flex;align-items:center;gap:12px;background:#0e1d19;border:1px solid #315247;border-radius:13px;padding:0 18px}.search span{font-size:28px;color:#60766e}.search input{width:100%;background:transparent;border:0;outline:0;color:#fff;font-size:17px;padding:19px 0}.count{font-size:11px;color:#60766e;text-transform:uppercase;letter-spacing:.12em;margin:24px 2px 10px}.results{border-top:1px solid #20332d}.result{display:flex;align-items:center;gap:17px;padding:20px 4px;border-bottom:1px solid #20332d}.result:hover{background:#0a1713}.icon{height:42px;width:42px;display:grid;place-items:center;border-radius:50%;border:1px solid #315247;color:#4de1a1;font-size:11px;font-weight:900}.icon.contract{border-radius:9px}.copy{display:flex;flex-direction:column;gap:5px;flex:1}.name-line{display:flex;align-items:center;gap:9px;min-width:0}.copy strong{font-size:16px}.copy>span{font-size:12px;color:#748a82}.connections{display:inline-grid;place-items:center;min-width:24px;height:20px;padding:0 7px;border-radius:999px;border:1px solid #31443e;background:#101b18;color:#6f817b;font-size:10px;font-weight:800;line-height:1}.connections.connected{border-color:#267653;background:#0d2a20;color:#63e8aa}.connections.many{border-color:#4de1a1;background:#12392b;color:#a4ffd2;box-shadow:0 0 12px rgba(77,225,161,.12)}.open{font-size:12px;color:#4de1a1}.empty{padding:50px 4px;color:#748a82}@media(max-width:600px){main{padding-top:45px}.intro h1{font-size:38px}.open{display:none}}
</style>
