const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const main=fs.readFileSync('app-principal.js','utf8'),features=fs.readFileSync('tg-pack-features.js','utf8');
const fn=name=>main.match(new RegExp('        (?:async )?function '+name+'\\([^]*?\\n        \\}'))[0];
const defs=main.slice(main.indexOf('        const PACKS ='),main.indexOf('        // Quando o super admin escolhe um pack'));
function setup(pack='pro'){
 const dom=new JSDOM('<body></body>',{url:'https://totalgest.test/',runScripts:'outside-only'}),w=dom.window;
 w.admin={id:'a',packAtual:pack,packEscalao:'10',packBlocos:0,licenca:{plano:'30_10',dias:30,maxFuncionarios:10,dataExpiracao:Date.now()+86400000*20}};
 w.dados={tiposTrabalhoCustom:[]};w.adminAtual=()=>w.admin;w.ehPlanoDemo=()=>false;w._IVA_INC=' (IVA inc.)';
 w.eval(features+'\n'+defs+'\nlet _renPack=null;\n'+['_abrirRenovacaoPack','_renPackFmt','_renPackCalcular','_renPackFuncMax','_renPackFuncionalidadesHtml','_renPackRender','_renPackSet','_renPackBloco','calcularDiasRestantes','isLicencaValida','escapeHtmlSimples'].map(fn).join('\n'));
 w._abrirRenovacaoPack();return {w,close:()=>w.close()};
}
test('Pro → Pro+ highlights CRM only; Supreme also increases report limits',()=>{
 const {w,close}=setup();try{
 w._renPackSet('pack','pro_plus');const rows=[...w.document.querySelectorAll('[data-change="added"]')];assert.equal(rows.length,1);assert(rows[0].textContent.includes('CRM Comercial'));assert(w.document.querySelector('.ren-pack-differences-gains').textContent.includes('CRM Comercial'));
 assert.equal(w.document.querySelectorAll('[data-change="increased"]').length,0);
 w._renPackSet('pack','supreme');assert(w.document.querySelector('[data-change="increased"]').textContent.includes('Ilimitados'));
 assert([...w.document.querySelectorAll('[data-change="added"]')].some(r=>r.textContent.includes('Rondas')));
 }finally{close()}
});
test('same pack shows current functions; downgrade identifies CRM removal and lower limits',()=>{
 const {w,close}=setup('pro_plus');try{
 assert(w.document.querySelector('.ren-pack-features-heading').textContent.includes('teu pack atual'));
 assert.equal(w.document.querySelectorAll('[data-change="added"],[data-change="removed"]').length,0);
 w._renPackSet('pack','pro');assert.equal(w.document.querySelectorAll('[data-change="removed"]').length,1);assert(w.document.querySelector('[data-change="removed"]').textContent.includes('CRM Comercial'));
 w._renPackSet('pack','expert');assert(w.document.querySelector('[data-change="reduced"]').textContent.includes('15 modelos'));assert(w.document.querySelector('[data-change="reduced"]').textContent.includes('40 modelos'));
 }finally{close()}
});
test('all five selections update the complete feature list without saving or changing the account',()=>{
 const {w,close}=setup();try{
 const before=JSON.stringify(w.admin);for(const pack of ['express','expert','pro','pro_plus','supreme']){
 w._renPackSet('pack',pack);assert(w.document.querySelector('#renPackFeaturesTitle').textContent.trim().startsWith('Pack '));assert.equal(w.document.querySelectorAll('.ren-pack-feature-group').length,4);assert(w.document.querySelectorAll('.ren-pack-feature').length>35);
 }assert.equal(JSON.stringify(w.admin),before);
 }finally{close()}
});
test('changing pack, capacity, blocks and period retains notes and updates the quotation',()=>{
 const {w,close}=setup();try{
 w.document.getElementById('ren_pack_obs').value='<script>nota</script> & detalhes';w._renPackSet('pack','pro_plus');w._renPackSet('escalao','25');w._renPackBloco(1);w._renPackSet('periodo','anual');
 assert.equal(w.document.getElementById('ren_pack_obs').value,'<script>nota</script> & detalhes');assert.equal(w.document.querySelectorAll('script').length,0);
 assert(w.document.querySelector('.ren-pack-form').textContent.replace(/\s/g,'').includes('1160,78'));assert(w.document.querySelector('.ren-pack-form').textContent.includes('30 func.'));
 }finally{close()}
});
test('legacy account lists selected functions without calling them new',()=>{
 const c=vm.createContext({});vm.runInContext(features,c);const groups=vm.runInContext("tgPackFeatureComparison(null,'pro_plus')",c);assert.equal(groups.flatMap(g=>g.features).filter(f=>f.change==='added').length,0);
});
test('both entry points and offline cache load the shared catalogue before application and landing',()=>{
 for(const file of ['index.html','login.html']){const s=fs.readFileSync(file,'utf8');assert(s.indexOf('src="tg-pack-features.js')<s.indexOf('src="app-principal.js'));assert(s.indexOf('src="tg-pack-features.js')<s.indexOf('src="landing-calculadora.js'));}
 assert(fs.readFileSync('sw.js','utf8').includes('./tg-pack-features.js?v=1.0.0'));
 assert(!fs.readFileSync('landing-calculadora.js','utf8').includes('const PACK_FUNCS ='));
});
