const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
// Tests use the same Leaflet 1.9.4 version as production: npm install --no-save leaflet@1.9.4
const leaflet=fs.readFileSync(require.resolve('leaflet/dist/leaflet-src.js'),'utf8');
const source=fs.readFileSync('app-principal.js','utf8');
const fn=name=>{const match=source.match(new RegExp('        function '+name+'\\([^]*?\\n        \\}'));assert(match,name);return match[0];};
function setup(role='admin',plugin=true){
 const w=new JSDOM('<section id="secao-mapa-equipa" class="active"><span id="mapaEquipaInfo"></span><div id="mapaEquipa"></div><select id="rotaPessoaSel"></select><input id="rotaDataSel"></section><section id="secao-dashboard-central"><span id="hdcMapaEquipaInfo"></span><div id="hdcMapaEquipa"></div></section>',{url:'https://example.test/',runScripts:'outside-only',pretendToBeVisual:true}).window;
 w.SVGSVGElement.prototype.createSVGRect=()=>({});
 for(const id of ['mapaEquipa','hdcMapaEquipa']){const el=w.document.getElementById(id);for(const key of ['clientWidth','offsetWidth'])Object.defineProperty(el,key,{value:1000});for(const key of ['clientHeight','offsetHeight'])Object.defineProperty(el,key,{value:520});el.scrollIntoView=()=>{};}
 w.eval(leaflet);w.L.Map.mergeOptions({zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false});if(plugin)w.eval(fs.readFileSync('vendor/leaflet-markercluster-1.5.3.js','utf8'));
 w.usuarioLogado=role==='admin'?{id:'a',role}:{id:'enc',adminId:'a',role};
 w.dados={funcionarios:[{id:'f1',adminId:'a',nome:'Ana'},{id:'f2',adminId:'a',nome:'Bruno'},{id:'f3',adminId:'a',nome:'Carlos'},{id:'none',adminId:'a',nome:'Sem GPS'},{id:'foreign',adminId:'other',nome:'Outro tenant'}],encarregados:role==='encarregado'?[{id:'enc',adminId:'a',nome:'Chefe',funcionariosIds:['f1','f2']}]:[],ponto:[
 {id:'p1',adminId:'a',funcionarioId:'f1',data:'2026-11-06',entrada:'09:00',lat:38.72,lng:-9.14},
 {id:'p2',adminId:'a',funcionarioId:'f2',data:'2026-11-06',entrada:'09:00',lat:38.72,lng:-9.14},
 {id:'p3',adminId:'a',funcionarioId:'f3',data:'2026-11-06',entrada:'09:00',saida:'10:00',lat:39.7,lng:-8.5},
 {id:'foreign',adminId:'other',funcionarioId:'foreign',data:'2026-11-06',entrada:'09:00',lat:38.72,lng:-9.14}],obraPontoLonga:[],obras:[]};
 Object.assign(w,{_tenantId:()=> 'a',getDataHoje:()=> '2026-11-06',presenca:{},LIMITE_ONLINE_MS:60000,_obraDeRegisto:()=> 'Cliente',escapeHtmlSimples:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')});
 const helpers=source.slice(source.indexOf('        function _grupoMapaEquipa()'),source.indexOf('        function renderizarMapaEquipa()'));
 w.eval("var _mapaEquipa=null,_mapaMarkers=null,_hdcMapaEquipa=null,_hdcMapaMarkers=null,_hdcMarkersPorPessoa={};"+helpers+['_ultimaLocalizacaoPessoa','_avatarFuncHTML','renderizarMapaEquipa','_hdcClicarPessoaNoMapa','_renderizarMapaEquipaDashboardCentral'].map(fn).join('\n'));
 return {w,map:()=>w.eval('_mapaEquipa'),group:()=>w.eval('_mapaMarkers'),close:()=>{for(const key of ['_mapaEquipa','_hdcMapaEquipa'])w.eval(key)?.remove();w.close();}};
}
test('two people at the same GPS location produce a visible 2 while a distant person remains separate',()=>{
 const t=setup();try{
 const before=JSON.stringify(t.w.dados);t.w.renderizarMapaEquipa();
 assert.equal(t.group().getLayers().length,3);assert.equal(t.w.document.querySelector('.tg-map-cluster-count').textContent,'2');
 assert.match(t.w.document.getElementById('mapaEquipaInfo').textContent,/3 com localização · 1 sem localização/);
 const visible=t.group().getLayers().map(m=>t.group().getVisibleParent(m));assert.equal(visible.filter(m=>m instanceof t.w.L.MarkerCluster).length,2);
 assert.equal(JSON.stringify(t.w.dados),before);
 const html=t.w.document.getElementById('mapaEquipa').innerHTML;assert(!html.includes('Outro tenant'));
 }finally{t.close();}
});
test('at maximum zoom the shared location expands into individually selectable people and retains popups',()=>{
 const t=setup();try{
 t.w.renderizarMapaEquipa();t.map().setView([38.72,-9.14],19,{animate:false});
 const marker=t.group().getLayers().find(m=>m.options.title==='Ana');const cluster=t.group().getVisibleParent(marker);assert.equal(cluster.getChildCount(),2);
 t.group().fire('click',{layer:cluster,originalEvent:{keyCode:0}});assert(marker._spiderLeg);const second=t.group().getLayers().find(m=>m.options.title==='Bruno');assert(second._spiderLeg);
 marker.openPopup();assert(marker.isPopupOpen());assert(marker.getPopup().getContent().includes('Ana'));assert(second.getPopup().getContent().includes('Bruno'));
 }finally{t.close();}
});
test('refreshing replaces markers without duplicate people; GPS changes update the groups',()=>{
 const t=setup();try{
 t.w.renderizarMapaEquipa();t.w.renderizarMapaEquipa();assert.equal(t.group().getLayers().length,3);assert.equal(t.w.document.querySelector('.tg-map-cluster-count').textContent,'2');
 t.w.dados.ponto.push({id:'new',adminId:'a',funcionarioId:'f3',data:'2026-11-06',entrada:'11:00',lat:38.72,lng:-9.14});t.w.renderizarMapaEquipa();assert.equal(t.w.document.querySelector('.tg-map-cluster-count').textContent,'3');assert.equal(t.group().getLayers().length,3);
 }finally{t.close();}
});
test('supervisor access still contains only the assigned team',()=>{
 const t=setup('encarregado');try{t.w.renderizarMapaEquipa();assert.equal(t.group().getLayers().length,2);assert.deepEqual(Array.from(t.group().getLayers(),m=>m.options.title).sort(),['Ana','Bruno']);assert.equal(t.w.document.querySelector('.tg-map-cluster-count').textContent,'2');}finally{t.close();}
});
test('satellite has place labels that follow base-layer selection as in CRM',()=>{
 const t=setup();try{
 t.w.renderizarMapaEquipa();const labels=Object.values(t.map()._layers).find(layer=>layer._url?.includes('World_Boundaries_and_Places'));assert(labels);assert(t.map().hasLayer(labels));t.map().fire('baselayerchange',{name:'Mapa'});assert(!t.map().hasLayer(labels));t.map().fire('baselayerchange',{name:'Satélite'});assert(t.map().hasLayer(labels));
 }finally{t.close();}
});
test('scoped CSS removes rounded borders and padding from map tiles without changing ordinary images',()=>{
 const t=setup();try{
 const style=t.w.document.createElement('style');style.textContent='img{padding:10px;border:2px solid #152a52;border-radius:12px}'+fs.readFileSync('tg-team-map.css','utf8');t.w.document.head.append(style);t.w.renderizarMapaEquipa();const tile=t.w.document.querySelector('.leaflet-tile');assert(tile);const computed=t.w.getComputedStyle(tile);assert.equal(computed.padding,'0px');assert.equal(computed.borderTopWidth,'0px');assert.equal(parseFloat(computed.borderRadius),0);
 const other=t.w.document.createElement('img');t.w.document.body.append(other);assert.equal(t.w.getComputedStyle(other).padding,'10px');
 }finally{t.close();}
});
test('maps wait for the clustering dependency, then initialize when the ordered loader signals readiness',()=>{
 const t=setup('admin',false);try{t.w.renderizarMapaEquipa();assert.equal(t.map(),null);assert.match(t.w.document.getElementById('mapaEquipaInfo').textContent,/A carregar/);t.w.eval(fs.readFileSync('vendor/leaflet-markercluster-1.5.3.js','utf8'));t.w.document.dispatchEvent(new t.w.Event('tg:map-ready'));assert(t.map());assert.equal(t.w.document.querySelector('.tg-map-cluster-count').textContent,'2');}finally{t.close();}
});
test('dashboard preview also clusters and selecting a person opens their popup through the cluster',async()=>{
 const t=setup();try{
 t.w._renderizarMapaEquipaDashboardCentral();assert.equal(t.w.eval('_hdcMapaMarkers').getLayers().length,3);assert.equal(t.w.document.querySelector('#hdcMapaEquipa .tg-map-cluster-count').textContent,'2');t.w._hdcClicarPessoaNoMapa('f1');await new Promise(resolve=>setTimeout(resolve,500));assert(t.w.eval('_hdcMarkersPorPessoa.f1').isPopupOpen());
 const old=t.w.eval('_hdcMapaEquipa');const next=t.w.document.createElement('div');next.id='hdcMapaEquipa';for(const k of ['clientWidth','offsetWidth'])Object.defineProperty(next,k,{value:1000});for(const k of ['clientHeight','offsetHeight'])Object.defineProperty(next,k,{value:520});t.w.document.getElementById('hdcMapaEquipa').replaceWith(next);t.w._renderizarMapaEquipaDashboardCentral();assert.notEqual(t.w.eval('_hdcMapaEquipa'),old);assert.equal(t.w.eval('_hdcMapaMarkers').getLayers().length,3);
 }finally{t.close();}
});
test('entry points and PWA cache have matching map assets; the dependency executes after Leaflet',()=>{
 const loader=fs.readFileSync('pdf-loader.js','utf8');assert(loader.indexOf('leaflet/1.9.4/leaflet.min.js')<loader.indexOf('vendor/leaflet-markercluster-1.5.3.js'));assert(loader.includes('s.async = false'));assert(loader.includes("new Event('tg:map-ready')"));
 const mainAsset=fs.readFileSync('login.html','utf8').match(/app-principal\.js\?v=[^"]+/)?.[0];
 assert(mainAsset);
 for(const file of ['index.html','login.html','sw.js'])for(const asset of [mainAsset,'pdf-loader.js?v=team-map-clusters-20261106','tg-team-map.css?v=1.0.0','vendor/leaflet-markercluster-1.5.3.css'])assert(fs.readFileSync(file,'utf8').includes(asset),file+' '+asset);
 assert(fs.readFileSync('sw.js','utf8').includes('vendor/leaflet-markercluster-1.5.3.js'));
});
