const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const src=fs.readFileSync('app-principal.js','utf8');
function pick(name){const a=src.indexOf('        function '+name+'('),b=src.indexOf('\n        }',a);assert(a>=0&&b>a,name);return src.slice(a,b+10);}
const code=['_tenantQuiosque','_quiosqueAdminPinKey','_quiosqueAdminPessoa','_quiosqueAgendaPessoasEmpresa','_quiosquePessoas'].map(pick).join('\n')+';return {_quiosqueAdminPessoa,_quiosqueAgendaPessoasEmpresa,_quiosquePessoas}';
function demo(){const u={id:'a',role:'admin'},d={administradores:[{id:'a',nome:'Admin',ativo:true},{id:'b',nome:'Other'}],funcionarios:[{id:'f',adminId:'a',nome:'Tech',role:'funcionario',pin:'1234'}],encarregados:[]},m=new Map(),s={getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)};return {u,d,m,...new Function('usuarioLogado','dados','localStorage',code)(u,d,s)};}
test('admin must configure a PIN before kiosk clock-in',()=>{const x=demo();assert.equal(x._quiosqueAdminPessoa(),null);assert.deepEqual(x._quiosqueAgendaPessoasEmpresa().map(p=>p.id),['f']);});
test('admin can appear in agenda and fixed kiosk, separated by tenant',()=>{const x=demo();x.m.set('tg_quiosque_admin_pin_a','7392');assert.deepEqual(x._quiosqueAgendaPessoasEmpresa().map(p=>p.id),['f','a']);x.m.set('tg_quiosque_pessoas','["a"]');assert.deepEqual(x._quiosquePessoas().map(p=>p.id),['a']);x.u.id='b';assert.equal(x._quiosqueAdminPessoa(),null);});
test('disabled admin cannot appear',()=>{const x=demo();x.m.set('tg_quiosque_admin_pin_a','7392');x.d.administradores[0].ativo=false;assert.equal(x._quiosqueAdminPessoa(),null);});
test('both shells have administrator PIN configuration',()=>{for(const f of ['index.html','login.html'])assert.match(fs.readFileSync(f,'utf8'),/id="qs_admin_pin"/);});

const {JSDOM}=require('jsdom');
function configured(mode='agenda',pin='7392'){
 const html=fs.readFileSync('index.html','utf8');
 const w=new JSDOM(html,{runScripts:'outside-only',url:'https://totalgest.test/'}).window;
 w.usuarioLogado={id:'a',role:'admin'};w.dados={administradores:[{id:'a',nome:'Admin',ativo:true}],funcionarios:[{id:'f',adminId:'a',nome:'Tech',role:'funcionario',pin:'1234'}],encarregados:[],obras:[{id:'o',adminId:'a',nome:'Obra'}],ponto:[]};
 w._podeAtivarQuiosque=()=>true;w.alerts=[];w.alert=s=>w.alerts.push(s);w.abrirQuiosque=()=>{};
 w.escapeHtmlSimples=s=>s;w.getDataHoje=()=> '2026-10-29';w.gerarId=()=> 'new';w.pontoAssiduidadeAtivo=()=>true;
 w._quiosqueObterLocalizacaoAgora=async()=>null;w.guardarDados=()=>{w.saved=true;};w._quiosqueAgendaRender=()=>{};w._kioskSlideInit=()=>{};w.setTimeout=()=>0;
 const names=['_tenantQuiosque','_quiosqueAdminPinKey','_quiosqueAdminPessoa','ativarModoQuiosque','_quiosqueRenderPessoasSetup','_confirmarAtivacaoQuiosque','_quiosqueAgendaPessoasEmpresa','_quiosquePessoas','_quiosqueAgendaAbrirGeral','_quiosqueAgendaGeralPessoaClick','_quiosqueAgendaGeralRenderPin','_quiosqueAgendaGeralPinDigito','_quiosqueAgendaGeralVerificarPin','_quiosqueGarantirEntradaGeral','_quiosqueFecharEntradaGeral','_quiosqueAgendaGeralPicarContinuar'];
 const asyncFn=src.match(/        async function _quiosqueAgendaGeralPicar\([^]*?\n        \}/)[0];
 w.eval("var _quiosqueGeoTemp=null,_quiosqueAgendaGeralPessoaSel=null,_quiosqueAgendaGeralPin='',_quiosqueAgendaRetomarAposGeral=null;"+names.map(pick).join('\n')+'\n'+asyncFn);
 w.ativarModoQuiosque();w.document.querySelector('[name="qs_modo"][value="'+mode+'"]').checked=true;
 w.document.getElementById('qs_admin_pin').value=pin;w.document.getElementById('qs_password_saida').value='exit-password';
 w.document.querySelector('#qs_pessoas_lista input').checked=true;
 w.eval('_quiosqueGeoTemp={lat:38,lng:-8}');
 return w;
}
test('activation keeps administrator clock-in PIN separate from the exit password in both modes',()=>{
 for(const mode of ['agenda','obra_fixa']){const w=configured(mode);try{
  w._confirmarAtivacaoQuiosque();assert.equal(w.localStorage.getItem('tg_quiosque_admin_pin_a'),'7392',mode+': '+JSON.stringify(w.alerts));assert.equal(w.localStorage.getItem('tg_quiosque_senha'),'exit-password');
  assert(w._quiosqueAgendaPessoasEmpresa().some(p=>p.id==='a'));
  if(mode==='obra_fixa')assert(w._quiosquePessoas().some(p=>p.id==='a'));
  w.ativarModoQuiosque();assert.equal(w.document.getElementById('qs_admin_pin').value,'7392');
 }finally{w.close();}}
});
test('invalid administrator PIN prevents activation, while employee-only kiosks remain supported',()=>{
 for(const pin of ['123','abcd','12345','']){const w=configured('agenda',pin);try{
  w._confirmarAtivacaoQuiosque();assert.equal(w.localStorage.getItem('tg_quiosque'),pin ? null : 'a');assert.equal(w._quiosqueAdminPessoa(),null);
 }finally{w.close();}}
});
test('administrator can clock in and out through general attendance using the individual PIN',async()=>{
 const w=configured();try{
  w._confirmarAtivacaoQuiosque();w._quiosqueAgendaAbrirGeral();assert.match(w.document.getElementById('tgqPainel').textContent,/Admin/);
  w._quiosqueAgendaGeralPessoaClick('a','admin');
  for(const n of '0000')w._quiosqueAgendaGeralPinDigito(n);
  assert.deepEqual(w.alerts,['PIN incorreto.']);assert.equal(w.document.getElementById('kiosk_slide_track'),null);
  for(const n of '7392')w._quiosqueAgendaGeralPinDigito(n);
  assert(w.document.getElementById('kiosk_slide_track'));
  await w._quiosqueAgendaGeralPicar('entrada');assert.equal(w.dados.ponto.length,1);assert.equal(w.dados.ponto[0].funcionarioId,'a');assert.equal(w.dados.ponto[0].adminId,'a');assert(w.saved);
  await w._quiosqueAgendaGeralPicar('saida');assert(w.dados.ponto[0].saida);
 }finally{w.close();}
});
