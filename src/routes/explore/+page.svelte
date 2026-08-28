<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { findDemoEntities } from '$lib/demo';

  let query = $state(page.url.searchParams.get('q') ?? '');
  let results = $derived(findDemoEntities(query));
  let timer: ReturnType<typeof setTimeout>;

  function syncQuery() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const url = new URL(page.url);
      if (query.trim()) url.searchParams.set('q', query.trim());
      else url.searchParams.delete('q');
      goto(`${url.pathname}${url.search}`, { replaceState: true, noScroll: true, keepFocus: true });
    }, 180);
  }
</script>

<svelte:head><title>Explore · NZ Connections</title></svelte:head>
<header><a href="/">← NZ Connections</a><span>INTERACTIVE PROTOTYPE</span></header>
<main>
  <div class="intro"><div class="eyebrow">EXPLORE THE GRAPH</div><h1>Search public records</h1><p>This build currently uses clearly labelled fictional records so the interface and evidence workflow can be tested before real datasets are imported.</p></div>
  <label class="search"><span>⌕</span><input bind:value={query} oninput={syncQuery} autofocus placeholder="Try ‘Southern’, ‘Maia’, ‘contract’…" /></label>
  <div class="count">{results.length} {results.length === 1 ? 'record' : 'records'}</div>
  <section class="results">
    {#each results as entity}
      <a class="result" href={`/entity/${entity.id}`}>
        <div class={`icon ${entity.type}`}>{entity.type === 'person' ? 'P' : entity.type === 'company' ? 'C' : entity.type === 'agency' ? 'A' : '↗'}</div>
        <div class="copy"><strong>{entity.name}</strong><span>{entity.subtitle}</span></div>
        <div class="open">View connections →</div>
      </a>
    {/each}
    {#if results.length === 0}<div class="empty">No demonstration records match that search.</div>{/if}
  </section>
</main>
<style>
:global(*){box-sizing:border-box}:global(body){margin:0;background:#07110f;color:#edf5f1;font-family:Inter,system-ui,sans-serif}:global(a){color:inherit;text-decoration:none}header{height:70px;border-bottom:1px solid #20332d;display:flex;align-items:center;justify-content:space-between;padding:0 max(24px,6vw);color:#9cb0a9;font-size:13px}header a{font-weight:800;color:#edf5f1}header span{font-size:10px;letter-spacing:.14em;color:#4de1a1}main{max-width:900px;margin:0 auto;padding:72px 24px}.intro{max-width:680px}.eyebrow{font-size:11px;letter-spacing:.18em;font-weight:800;color:#4de1a1}.intro h1{font-size:48px;letter-spacing:-.045em;margin:12px 0}.intro p{color:#8fa39c;line-height:1.65}.search{margin-top:38px;display:flex;align-items:center;gap:12px;background:#0e1d19;border:1px solid #315247;border-radius:13px;padding:0 18px}.search span{font-size:28px;color:#60766e}.search input{width:100%;background:transparent;border:0;outline:0;color:#fff;font-size:17px;padding:19px 0}.count{font-size:11px;color:#60766e;text-transform:uppercase;letter-spacing:.12em;margin:24px 2px 10px}.results{border-top:1px solid #20332d}.result{display:flex;align-items:center;gap:17px;padding:20px 4px;border-bottom:1px solid #20332d}.result:hover{background:#0a1713}.icon{height:42px;width:42px;display:grid;place-items:center;border-radius:50%;border:1px solid #315247;color:#4de1a1;font-size:11px;font-weight:900}.icon.contract{border-radius:9px}.copy{display:flex;flex-direction:column;gap:5px;flex:1}.copy strong{font-size:16px}.copy span{font-size:12px;color:#748a82}.open{font-size:12px;color:#4de1a1}.empty{padding:50px 4px;color:#748a82}@media(max-width:600px){main{padding-top:45px}.intro h1{font-size:38px}.open{display:none}}
</style>