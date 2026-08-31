<script lang="ts">
  import { page } from '$app/state';

  const path = $derived(page.url.pathname);
  const directoryKind = $derived(page.url.searchParams.get('kind'));
  const isSearch = $derived(path === '/explore');
  const isCharities = $derived(path === '/directory' && (directoryKind === null || directoryKind === 'charities'));
  const isOfficers = $derived(path === '/directory' && directoryKind === 'officers');
  const isProcurement = $derived(path === '/directory' && directoryKind === 'procurement');
</script>

<header>
  <div>
    <a class="brand" href="/" aria-current={path === '/' ? 'page' : undefined}>NZ Records</a>
    <nav aria-label="Primary navigation">
      <a class:active={isSearch} aria-current={isSearch ? 'page' : undefined} href="/explore">Search</a>
      <a class:active={isCharities} aria-current={isCharities ? 'page' : undefined} href="/directory?kind=charities&letter=A">Charities</a>
      <a class:active={isOfficers} aria-current={isOfficers ? 'page' : undefined} href="/directory?kind=officers&letter=A">Officer records</a>
      <a class:active={isProcurement} aria-current={isProcurement ? 'page' : undefined} href="/directory?kind=procurement&page=1">Government tenders</a>
      <a class:active={path === '/' && page.url.hash === '#about'} href="/#about">About</a>
    </nav>
  </div>
</header>

<style>
  header{background:#fff;border-top:5px solid #176b5a;border-bottom:1px solid #d9ddd9}
  header>div{max-width:1120px;margin:auto;padding:19px 28px;display:flex;justify-content:space-between;align-items:center;gap:28px}
  .brand{font-size:22px;font-weight:700;color:#202624;text-decoration:none}
  nav{display:flex;gap:24px;flex-wrap:wrap}
  nav a{font-size:14px;font-weight:600;color:#135f50;text-decoration:underline;text-underline-offset:3px}
  nav a.active,nav a[aria-current='page']{color:#202624;text-decoration-thickness:2px}
  @media(max-width:700px){header>div{align-items:flex-start;gap:14px;flex-direction:column}nav{gap:14px}}
</style>
