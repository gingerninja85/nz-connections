<script lang="ts">
  let { data } = $props();
  const e = data.entity as Record<string, any>;
  const connections = data.connections as Record<string, any>[];
  const isCharityOfficerRecord = String(e.slug ?? '').startsWith('charities-officer-');
  const relationshipLabels: Record<string, { out: string; in: string }> = {
    OFFICER_OF: { out: 'Officer of:', in: 'Officer:' }
  };
  function relationshipLabel(predicate: string, direction: string) {
    const known = relationshipLabels[predicate];
    if (known) return direction === 'out' ? known.out : known.in;
    const fallback = String(predicate).replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
    return direction === 'out' ? `${fallback}:` : `Connected by ${fallback.toLowerCase()}:`;
  }
</script>
<svelte:head><title>{e.canonical_name} · NZ Connections</title></svelte:head>
<header><a href="/explore">← Search</a><a class="brand" href="/">NZ <b>Connections</b></a></header>
<main>
  <div class="live">PUBLIC RECORD</div>
  <section class="identity"><div class="badge">{isCharityOfficerRecord ? 'CHARITY OFFICER RECORD' : String(e.entity_type).replace('_',' ').toUpperCase()}</div><h1>{e.canonical_name}</h1><p>{e.status ?? 'Status not supplied'}</p>
    <div class="ids">{#if e.nzbn}<div><span>NZBN</span><strong>{e.nzbn}</strong></div>{/if}{#if e.company_number}<div><span>COMPANY NUMBER</span><strong>{e.company_number}</strong></div>{/if}</div>
    {#if isCharityOfficerRecord}<div class="identity-note"><strong>Identity note</strong><span>This page represents one officer record published by Charities Services, not a verified canonical person profile. Charities Services does not provide a reusable identifier that proves when similarly named officers across different charities are the same person, so NZ Connections does not automatically merge records by name.</span></div>{/if}
  </section>
  <section class="connections"><div class="sectionhead"><div><span>SOURCE-BACKED RELATIONSHIPS</span><h2>{isCharityOfficerRecord ? 'Connections for this record' : 'Connections'}</h2></div><div class="total">{connections.length}</div></div>
    {#each connections as c}<article><div class="relation"><span>{relationshipLabel(c.predicate, c.direction)}</span><a href={`/record/${c.connected_id}`}>{c.connected_name}</a><small>{String(c.connected_type).replace('_',' ')}{c.connected_status ? ` · ${c.connected_status}` : ''}</small></div>
      <details><summary>View evidence</summary><div class="evidence"><div class="source"><span>SOURCE</span><a href={c.source_url} target="_blank" rel="noreferrer">{c.publisher} · {c.dataset} ↗</a></div><dl>{#if c.record_id}<dt>Record</dt><dd>{c.record_id}</dd>{/if}{#if c.published_at}<dt>Published</dt><dd>{c.published_at}</dd>{/if}<dt>Retrieved</dt><dd>{c.retrieved_at}</dd>{#if c.licence}<dt>Licence</dt><dd>{c.licence}</dd>{/if}</dl></div></details></article>{/each}
    {#if connections.length === 0}<div class="empty">No source-backed relationships are currently loaded for this record.</div>{/if}
  </section>
  <aside>NZ Connections displays relationships found in public records. A connection does not imply wrongdoing, influence, endorsement or any other conclusion. Use the evidence panel to inspect the source behind each relationship.</aside>
</main>
<style>:global(*){box-sizing:border-box}:global(body){margin:0;background:#07110f;color:#edf5f1;font-family:Inter,system-ui,sans-serif}:global(a){color:inherit;text-decoration:none}header{height:70px;border-bottom:1px solid #20332d;display:flex;align-items:center;justify-content:space-between;padding:0 max(24px,6vw);font-size:13px;color:#9cafaa}.brand{font-size:17px;color:#edf5f1;font-weight:800}.brand b{color:#4de1a1}main{max-width:900px;margin:auto;padding:55px 24px 100px}.live{display:inline-block;border:1px solid #28634e;background:#0c2019;color:#4de1a1;border-radius:6px;padding:7px 9px;font-size:9px;letter-spacing:.13em;font-weight:900}.identity{padding:30px 0 45px;border-bottom:1px solid #20332d}.badge{color:#4de1a1;font-size:10px;letter-spacing:.16em;font-weight:900}.identity h1{font-size:clamp(38px,6vw,62px);letter-spacing:-.045em;margin:12px 0 8px}.identity p{color:#839890}.ids{display:flex;gap:35px;margin-top:30px}.ids div{display:flex;flex-direction:column;gap:5px}.ids span,.sectionhead span,.evidence span{font-size:9px;color:#61766f;letter-spacing:.13em}.ids strong{font-size:12px;font-family:ui-monospace,monospace}.identity-note{display:flex;flex-direction:column;gap:6px;margin-top:26px;padding:15px 17px;border:1px solid #315247;border-radius:9px;background:#0b1814;color:#8fa49c;font-size:12px;line-height:1.55}.identity-note strong{color:#b8d0c7}.connections{padding-top:45px}.sectionhead{display:flex;justify-content:space-between;align-items:end;margin-bottom:14px}.sectionhead h2{font-size:27px;margin:5px 0}.total{font-size:25px;color:#4de1a1}article{border-top:1px solid #20332d;padding:22px 0}.relation{display:grid;grid-template-columns:170px 1fr;gap:5px 20px}.relation>span{grid-row:1/3;font-size:9px;letter-spacing:.1em;color:#4de1a1;padding-top:5px}.relation a{font-weight:750}.relation a:hover{text-decoration:underline}.relation small{color:#71867e}details{margin:15px 0 0 190px}summary{cursor:pointer;color:#849991;font-size:11px}.evidence{margin-top:12px;border-left:2px solid #315247;background:#0b1814;padding:15px 17px}.source{display:flex;flex-direction:column;gap:5px}.source a{color:#4de1a1;font-size:12px}dl{display:grid;grid-template-columns:80px 1fr;gap:6px 10px;font-size:10px;color:#7d918a;margin:14px 0 0}dt{color:#52675f}dd{margin:0}.empty{border-top:1px solid #20332d;padding:35px 0;color:#71867e}aside{margin-top:50px;border:1px solid #29443b;border-radius:10px;padding:18px;color:#81958e;font-size:12px;line-height:1.6}@media(max-width:600px){.relation{grid-template-columns:1fr}.relation>span{grid-row:auto}details{margin-left:0}.ids{flex-direction:column;gap:15px}}</style>