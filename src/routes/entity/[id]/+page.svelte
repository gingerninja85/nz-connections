<script lang="ts">
  import SiteHeader from '$lib/SiteHeader.svelte';
  let { data } = $props();
</script>

<svelte:head><title>{data.entity.name} · NZ Records</title></svelte:head>

<SiteHeader />

<div class="demo-page">
  <main>
    <div class="demo">DEMONSTRATION DATA — NOT A REAL PUBLIC RECORD</div>
    <section class="identity">
      <div class={`badge ${data.entity.type}`}>{data.entity.type.toUpperCase()}</div>
      <h1>{data.entity.name}</h1><p>{data.entity.subtitle}</p>
      {#if data.entity.identifiers?.length}
        <div class="ids">{#each data.entity.identifiers as item}<div><span>{item.label}</span><strong>{item.value}</strong></div>{/each}</div>
      {/if}
    </section>
    <section class="connections"><div class="sectionhead"><div><span>RELATIONSHIPS</span><h2>Connections</h2></div><div class="total">{data.connections.length}</div></div>
      {#each data.connections as connection}
        <article>
          <div class="relation"><span>{connection.direction === 'out' ? connection.label : `← ${connection.label}`}</span><a href={`/entity/${connection.entity.id}`}>{connection.entity.name}</a><small>{connection.entity.subtitle}</small></div>
          <details><summary>View evidence</summary><div class="evidence"><div><span>SOURCE</span><a href={connection.sourceUrl} target="_blank" rel="noreferrer">{connection.source} ↗</a></div><p>{connection.note}</p></div></details>
        </article>
      {/each}
    </section>
    <aside><strong>Why the warning?</strong> This page demonstrates how NZ Records displays records, relationships and evidence. The names and relationships in this prototype are fictional. Real records only appear after their source datasets and import process have been verified.</aside>
  </main>
</div>

<style>
  :global(*){box-sizing:border-box}
  :global(body){margin:0;background:#f7f7f4;color:#202624;font-family:Arial,Helvetica,sans-serif}
  .demo-page{background:#07110f;color:#edf5f1;font-family:Inter,system-ui,sans-serif;min-height:calc(100vh - 76px)}
  .demo-page a{color:inherit;text-decoration:none}
  main{max-width:900px;margin:auto;padding:55px 24px 100px}.demo{display:inline-block;border:1px solid #6f5d25;background:#1c190d;color:#e9c95c;border-radius:6px;padding:7px 9px;font-size:9px;letter-spacing:.13em;font-weight:900}.identity{padding:30px 0 45px;border-bottom:1px solid #20332d}.badge{color:#4de1a1;font-size:10px;letter-spacing:.16em;font-weight:900}.identity h1{font-size:clamp(38px,6vw,62px);letter-spacing:-.045em;margin:12px 0 8px}.identity p{color:#839890}.ids{display:flex;gap:35px;margin-top:30px}.ids div{display:flex;flex-direction:column;gap:5px}.ids span,.sectionhead span,.evidence span{font-size:9px;color:#61766f;letter-spacing:.13em}.ids strong{font-size:12px;font-family:ui-monospace,monospace}.connections{padding-top:45px}.sectionhead{display:flex;justify-content:space-between;align-items:end;margin-bottom:14px}.sectionhead h2{font-size:27px;margin:5px 0}.total{font-size:25px;color:#4de1a1}article{border-top:1px solid #20332d;padding:22px 0}.relation{display:grid;grid-template-columns:150px 1fr;gap:5px 20px}.relation>span{grid-row:1/3;font-size:9px;letter-spacing:.1em;color:#4de1a1;padding-top:5px}.relation a{font-weight:750}.relation a:hover{text-decoration:underline}.relation small{color:#71867e}details{margin:15px 0 0 170px}summary{cursor:pointer;color:#849991;font-size:11px}.evidence{margin-top:12px;border-left:2px solid #315247;background:#0b1814;padding:15px 17px}.evidence div{display:flex;flex-direction:column;gap:5px}.evidence a{color:#4de1a1;font-size:12px}.evidence p{color:#758a82;font-size:11px;line-height:1.5;margin:12px 0 0}aside{margin-top:35px;border:1px solid #20332d;background:#091713;color:#839890;padding:18px;line-height:1.55;font-size:12px}aside strong{color:#edf5f1}@media(max-width:650px){.relation{grid-template-columns:1fr}.relation>span{grid-row:auto}.ids{flex-direction:column;gap:15px}details{margin-left:0}}
</style>
