const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('app-principal.js','utf8');
const fn=source.match(/        function _espelharLuzesSidebar\([^]*?\n        \}/)[0];
function setup(){
 const w=new JSDOM('<div id="cardsGrid"><div class="card-principal pisca-amarelo" data-card="frota"></div><div class="card-principal" data-card="pedidos"></div><div class="card-principal" data-card="ponto"></div></div><nav id="tgSidebarNav"><button class="tg-nav-grupo-btn" data-grupo-btn="frota" aria-expanded="false"><i></i><span>Frota</span></button><div class="tg-nav-submenu" data-grupo-sub="frota"><a class="tg-nav-item" data-secao="frota">Frota</a></div><button class="tg-nav-grupo-btn" data-grupo-btn="equipa" aria-expanded="false"><span>Equipa</span></button><div class="tg-nav-submenu" data-grupo-sub="equipa"><a class="tg-nav-item" data-secao="pedidos">Férias</a><a class="tg-nav-item" data-secao="ponto">Ponto</a></div></nav>',{runScripts:'outside-only'}).window;
 w.eval(fn);return w;
}
const group=(w,key)=>w.document.querySelector('[data-grupo-btn="'+key+'"]');
const card=(w,key)=>w.document.querySelector('[data-card="'+key+'"]');
test('closed main group flashes instead of its child, without opening the submenu',()=>{
 const w=setup();try{w._espelharLuzesSidebar();const g=group(w,'frota');assert(g.classList.contains('tg-luz-amarelo'));assert(g.classList.contains('tg-luz-pisca'));assert.equal(g.getAttribute('aria-expanded'),'false');assert.equal(w.document.querySelector('[data-secao="frota"]').className,'tg-nav-item tg-luz-amarelo');assert.match(g.getAttribute('aria-label'),/Frota.*pendentes/);}finally{w.close();}
});
test('collapsed sidebar retains the same group status and tooltip',()=>{
 const w=setup();try{w.document.body.classList.add('tg-nexus','tg-sidebar-collapsed');w._espelharLuzesSidebar();assert(group(w,'frota').classList.contains('tg-luz-pisca'));assert.match(group(w,'frota').title,/Frota.*pendentes/);}finally{w.close();}
});
test('red takes priority over yellow and green, while fixed status remains steady',()=>{
 const w=setup();try{card(w,'pedidos').classList.add('pisca-amarelo');card(w,'ponto').classList.add('fixo-vermelho');w._espelharLuzesSidebar();assert(group(w,'equipa').classList.contains('tg-luz-vermelho'));assert(group(w,'equipa').classList.contains('tg-luz-pisca'));card(w,'pedidos').classList.remove('pisca-amarelo');w._espelharLuzesSidebar();assert(!group(w,'equipa').classList.contains('tg-luz-pisca'));}finally{w.close();}
});
test('resolving an alert clears the main group, child, and accessible message',()=>{
 const w=setup();try{w._espelharLuzesSidebar();card(w,'frota').classList.remove('pisca-amarelo');w._espelharLuzesSidebar();assert.equal(group(w,'frota').className,'tg-nav-grupo-btn');assert.equal(group(w,'frota').title,'Frota');assert.equal(w.document.querySelector('[data-secao="frota"]').className,'tg-nav-item');}finally{w.close();}
});
test('revoked, locked, hidden and secondary cards cannot keep group alerts',()=>{
 for(const mode of ['hidden-card','card-bloqueado','hidden','display','secondary']){const w=setup();try{w._espelharLuzesSidebar();const c=card(w,'frota');if(mode==='hidden')c.hidden=true;else if(mode==='display')c.style.display='none';else if(mode==='secondary')c.dataset.tgnSecondary='';else c.classList.add(mode);w._espelharLuzesSidebar();assert.equal(group(w,'frota').className,'tg-nav-grupo-btn',mode);}finally{w.close();}}
});
test('rebuilding a group keeps the latest alert without changing records or expansion state',()=>{
 const w=setup();try{w._espelharLuzesSidebar();const g=group(w,'frota');g.replaceWith(g.cloneNode(true));w._espelharLuzesSidebar();assert(group(w,'frota').classList.contains('tg-luz-pisca'));assert.equal(group(w,'frota').getAttribute('aria-expanded'),'false');assert(card(w,'frota').classList.contains('pisca-amarelo'));}finally{w.close();}
});
