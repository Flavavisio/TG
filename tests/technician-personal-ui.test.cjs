const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('tg-technician.js','utf8');
function setup(){
 const w=new JSDOM(`<div id="cardsGrid"><div class="card-principal" data-card="servicos"></div></div><div id="modalGenericoOverlay"><h2 id="modalGenericoTitulo"></h2><form id="modalGenericoForm"><div id="modalGenericoCampos"></div><div class="modal-actions"><button class="btn-success">Guardar</button></div></form></div><div id="modalOverlay" class="open"><form id="modalForm"><div id="modalCampos"><div class="form-group"><textarea id="fo_descricao" required style="font-size:12px!important">Trabalho já escrito</textarea></div><div class="form-group"><input id="fo_data" type="date" value="2026-10-27" style="font-size:14px"></div><div class="form-group"><input id="check" type="checkbox"></div></div><button id="modalSubmitBtn">Guardar</button></form></div>`,{url:'https://example.com/Testetg/login.html',runScripts:'outside-only'}).window;
 w.innerWidth=390;w.usuarioLogado={id:'f',adminId:'a',role:'funcionario',nome:'Vanda Ribeiro'};
 w.dados={funcionarios:[{id:'f',adminId:'a',nome:'Vanda Ribeiro'}],encarregados:[],servicos:[{id:'os',adminId:'a',funcionariosIds:['f'],data:'2026-10-27',clienteId:'c',localId:'l',descricao:'Serviço'}],clientes:[{id:'c',adminId:'a',nome:'Cliente'}],ponto:[],obras:[],obraPontoLonga:[]};
 Object.assign(w,{expressAtivo:()=>false,adminDoUtilizador:()=>({id:'a'}),_licencaValidaTenant:()=>true,getDataHoje:()=> '2026-10-27',_pausaAlmocoPendente:()=>null,_montarMenuInferiorMobile(){},_mostrarInicioConteudo(){}});
 w.entryCalls=[];w.errors=[];w.picarPontoOS=(...args)=>w.entryCalls.push(args);w.mostrarErro=msg=>w.errors.push(msg);
 w.allowed=true;w.opened=[];w.TGPassport={scope:(c,l)=>w.allowed?{customerId:c,localId:l}:null,open:(...args)=>w.opened.push(args)};
 const instrumented=source.replace('window.TGTechnician={refresh,jobs,todayJobs,weekJobs,enabled};refresh();','window.TGTechnician={refresh,home,workList,worksList,more,fleet,enabled,jobs,focusHTML,avatarHTML,notes,openPassport,protectFieldFont,installWizard,removeWizard,wizards};');
 assert.notEqual(source,instrumented);w.eval(instrumented);return w;
}
test('header uses first name and last surname initials, including accents and a single name',()=>{
 const w=setup();try{for(const [name,initials] of [['Vanda Ribeiro','VR'],['Flávio António da Rosa','FR'],['Álvaro Évora','ÁÉ'],['Vanda','V']]){w.dados.funcionarios[0].nome=name;const host=w.document.createElement('div');host.innerHTML=w.TGTechnician.avatarHTML();assert.equal(host.querySelector('[aria-hidden]').textContent,initials);assert.equal(host.querySelector('[role=img]').getAttribute('aria-label'),name);}}finally{w.close();}
});
test('photo failure reveals initials and hostile photo schemes cannot create an image',()=>{
 const w=setup();try{w.dados.funcionarios[0].foto='https://example.com/photo.jpg';w.document.body.insertAdjacentHTML('beforeend',w.TGTechnician.avatarHTML());const img=w.document.querySelector('[data-tgt-avatar]');assert(img);img.dispatchEvent(new w.Event('error'));assert(img.hidden);assert.equal(img.previousElementSibling.textContent,'VR');for(const unsafe of ['javascript:alert(1)','data:image/svg+xml,<svg onload=alert(1)>']){w.dados.funcionarios[0].foto=unsafe;assert(!w.TGTechnician.avatarHTML().includes('<img'));}}finally{w.close();}
});
test('avatar never reads another tenant profile or outputs raw profile markup',()=>{
 const w=setup();try{w.dados.funcionarios=[{id:'f',adminId:'other',nome:'Outra pessoa',foto:'https://example.com/private.jpg'}];assert(!w.TGTechnician.avatarHTML().includes('private.jpg'));w.usuarioLogado.nome='Vanda <img src=x>';const host=w.document.createElement('div');host.innerHTML=w.TGTechnician.avatarHTML();assert.equal(host.querySelector('img'),null);}finally{w.close();}
});
test('notes links to the exact assigned installation and rechecks access when opened',()=>{
 const w=setup();try{const job=w.TGTechnician.jobs()[0];w.TGTechnician.notes(job);const b=w.document.querySelector('[data-tgt-action=passport]');assert(b);assert(b.textContent.includes('Ver passaporte de instalação'));b.click();assert.deepEqual(w.opened,[['c','l']]);assert(!w.document.getElementById('modalGenericoOverlay').classList.contains('open'));w.allowed=false;w.TGTechnician.openPassport(job);assert.equal(w.opened.length,1);w.TGTechnician.notes(job);assert.equal(w.document.querySelector('[data-tgt-action=passport]'),null);}finally{w.close();}
});
test('worksheet fields are at least 16px before focus and restoration preserves text and native styles',()=>{
 const w=setup();try{w.TGTechnician.installWizard();const form=w.document.getElementById('modalForm'),wizard=w.TGTechnician.wizards.get(form);assert(wizard);const description=w.document.getElementById('fo_descricao');assert.equal(description.style.getPropertyValue('font-size'),'16px');assert.equal(description.style.getPropertyPriority('font-size'),'important');const dynamic=w.document.createElement('input');dynamic.style.fontSize='11px';wizard.pages[1].appendChild(dynamic);dynamic.dispatchEvent(new w.Event('pointerdown',{bubbles:true}));assert.equal(dynamic.style.fontSize,'16px');w.TGTechnician.removeWizard(wizard);assert.equal(description.value,'Trabalho já escrito');assert.equal(description.style.fontSize,'12px');assert.equal(description.style.getPropertyPriority('font-size'),'important');assert.equal(w.document.getElementById('fo_data').value,'2026-10-27');}finally{w.close();}
});
test('avatar, wizard scale correction and refreshed CSS are included in both app entry points',()=>{
 const css=fs.readFileSync('tg-technician.css','utf8');assert(css.includes('.tgt-avatar'));assert(css.includes('animation:none!important;transform:none!important'));assert(source.includes('${avatarHTML()}</header>'));
 for(const file of ['index.html','login.html']){const html=fs.readFileSync(file,'utf8');assert(html.includes('tg-technician.js?v=1.7.1-leave-modals'));assert(html.includes('tg-technician.css?v=1.7.1-leave-modals'));const responsive=html.match(/responsive-device\.css\?v=\d+/)?.[0];assert(responsive&&fs.readFileSync('sw.js','utf8').includes(responsive));assert(!html.includes('user-scalable=no'));}
});

test('the intervention toolbar opens the installation passport directly without a notes dialog',()=>{
 const w=setup();try{const job=w.TGTechnician.jobs()[0];job.open={entrada:'09:00',data:'2026-10-27'};const host=w.document.createElement('div');host.innerHTML=w.TGTechnician.focusHTML(job);w.document.body.append(host);const b=host.querySelector('[data-tgt-action=passport]');assert(b);assert(b.textContent.includes('Passaporte'));assert.equal(host.querySelector('[data-tgt-action=notes]'),null);b.click();assert.deepEqual(w.opened,[['c','l']]);assert(!w.document.getElementById('modalGenericoOverlay').classList.contains('open'));w.allowed=false;assert(!w.TGTechnician.focusHTML(job).includes('data-tgt-action="passport"'));}finally{w.close();}
});

test('employee has the same home, five navigation items, works and profile on phone and PC',()=>{
 const snapshots=[];
 for(const width of [390,1440]){const w=setup();try{
  w.innerWidth=width;w.document.getElementById('modalOverlay').classList.remove('open');
  w.document.getElementById('cardsGrid').insertAdjacentHTML('beforeend','<div id="omeudia"></div>'+['obras-longa','pedidos','folhas'].map(id=>'<div class="card-principal" data-card="'+id+'"></div>').join(''));
  w.document.body.insertAdjacentHTML('beforeend','<div id="menuInferiorMobile"></div><div id="painelGrupoMobile"><div id="painelGrupoMobileConteudo"></div></div>');
  Object.assign(w,{_fecharSecaoAbertaMobile(){},pontoAssiduidadeAtivo:()=>false,scrollTo(){}});
  w.dados.obras=[{id:'obra',adminId:'a',nome:'Obra atribuída',responsaveisIds:['f'],estado:'ativa'}];
  w.TGTechnician.refresh();w.eval(fs.readFileSync('tg-navigation.js','utf8'));w.TGNavigation.refresh();assert.equal(w.document.querySelectorAll('[data-tgn-nav]').length,0);assert(w.TGTechnician.enabled());assert(w.document.body.classList.contains('tgt-active'));
  const nav=[...w.document.querySelectorAll('[data-tgt-nav]')].map(b=>b.textContent.trim());assert.deepEqual(nav,['Hoje','Trabalhos','Obras','Frota','Perfil']);
  const home=w.document.getElementById('omeudia').innerHTML;
  w.TGTechnician.workList();const week=w.document.getElementById('painelGrupoMobileConteudo').innerHTML;
  w.TGTechnician.worksList();const works=w.document.getElementById('painelGrupoMobileConteudo').textContent;
  w.TGTechnician.more();const profile=w.document.getElementById('painelGrupoMobileConteudo').textContent;assert(profile.includes('Férias e faltas'));assert(profile.includes('As minhas folhas de obra'));
  snapshots.push({home,week,works,profile});
  w.picarPontoOS('os','entrada');assert.equal(w.entryCalls.length,1);w.dados.servicos[0].data='2026-10-28';w.picarPontoOS('os','entrada');assert.equal(w.entryCalls.length,1);assert.equal(w.errors.length,1);
 }finally{w.close();}}
 assert.deepEqual(snapshots[0],snapshots[1]);
});
test('desktop management roles keep their existing UI and Express remains separate',()=>{
 const w=setup();try{w.innerWidth=1440;for(const role of ['admin','subadmin','encarregado','cliente','superadmin']){w.usuarioLogado.role=role;assert.equal(w.TGTechnician.enabled(),false,role);}w.usuarioLogado.role='encarregado';w.innerWidth=390;assert(w.TGTechnician.enabled());w.usuarioLogado.role='funcionario';w.innerWidth=1440;assert(w.TGTechnician.enabled());w.expressAtivo=()=>true;assert.equal(w.TGTechnician.enabled(),false);}finally{w.close();}
});

function fleetSetup(){
 const w=setup();
 w.document.body.insertAdjacentHTML('beforeend','<div id="menuInferiorMobile"></div><div id="painelGrupoMobile"><div id="painelGrupoMobileConteudo"></div></div>');
 Object.assign(w,{_fecharSecaoAbertaMobile(){},pontoAssiduidadeAtivo:()=>false,scrollTo(){},moduloFrotaAtivo:()=>true});
 w.dados.funcionarios[0].veiculoId='car';
 w.dados.veiculos=[{id:'car',adminId:'a',matricula:'12-AB-34',marcaModelo:'Renault Kangoo',ano:2024,combustivel:'Gasóleo',km:12345,kmData:'2026-10-28',inspecaoValidade:'2027-01-10',seguroValidade:'2027-02-11',seguroSeguradora:'Seguro Teste',observacoes:'Kit de ferramentas'},{id:'other-car',adminId:'a',matricula:'SEGREDO'},{id:'foreign',adminId:'b',matricula:'OUTRA EMPRESA'}];
 w.dados.veiculoDocumentos=[{id:'doc',adminId:'a',veiculoId:'car',nome:'Seguro.pdf',ficheiro:'https://example.com/seguro.pdf',dataCriacao:1},{id:'foreign-doc',adminId:'b',veiculoId:'car',nome:'Documento secreto'}];
 w.dados.veiculoIntervencoes=[{adminId:'a',veiculoId:'car',tipo:'manutencao',data:'2026-10-20',km:12000,descricao:'Óleo e filtros',custo:150,proximaData:'2027-10-20',proximaKm:25000},{adminId:'a',veiculoId:'other-car',descricao:'Manutenção secreta'}];
 w.dados.veiculoSinistros=[{adminId:'a',veiculoId:'car',data:'2026-09-01',descricao:'Vidro partido',estado:'Resolvido',seguradora:'Seguro Teste'}];
 return w;
}
test('fleet tab opens the assigned vehicle with details, documents, maintenance and incidents',()=>{
 const w=fleetSetup();try{
  w.TGTechnician.refresh();const nav=w.document.querySelector('[data-tgt-nav=fleet]');assert(nav.querySelector('.fa-car'));nav.click();
  const panel=w.document.getElementById('painelGrupoMobileConteudo'),text=panel.textContent;
  for(const value of ['12-AB-34','Renault Kangoo','Gasóleo','10/01/2027','Seguro.pdf','Óleo e filtros','Vidro partido','Kit de ferramentas'])assert(text.includes(value),value);
  for(const value of ['SEGREDO','OUTRA EMPRESA','Documento secreto','Manutenção secreta'])assert(!text.includes(value),value);
  assert.equal(nav.getAttribute('aria-current'),'page');assert.equal(panel.querySelector('a').href,'https://example.com/seguro.pdf');
  assert.equal(panel.querySelectorAll('.tgt-fleet-actions button').length,5,'employee can register vehicle activity');
 }finally{w.close();}
});
test('fleet clears revoked assignments, denies cross-tenant vehicles and unavailable licensing',()=>{
 const w=fleetSetup();try{
  w.TGTechnician.refresh();w.TGTechnician.fleet();w.dados.funcionarios[0].veiculoId=null;w.TGTechnician.refresh();
  const content=()=>w.document.getElementById('painelGrupoMobileConteudo').textContent;
  assert(content().includes('Não tens nenhuma viatura atribuída'));assert(!content().includes('12-AB-34'));
  w.dados.funcionarios[0].veiculoId='foreign';w.TGTechnician.fleet();assert(!content().includes('OUTRA EMPRESA'));
  w.dados.funcionarios[0].veiculoId='car';w.moduloFrotaAtivo=()=>false;w.TGTechnician.fleet();assert(content().includes('não está disponível'));assert(!content().includes('12-AB-34'));
  w.moduloFrotaAtivo=()=>true;w._licencaValidaTenant=()=>false;w.TGTechnician.fleet();assert(!content().includes('12-AB-34'));
  w._licencaValidaTenant=()=>true;w.TGTechnician.fleet();w.usuarioLogado.id='different';w.TGTechnician.refresh();assert(!content().includes('12-AB-34'));
 }finally{w.close();}
});
test('fleet escapes stored text, rejects executable document links and tolerates invalid dates',()=>{
 const w=fleetSetup();try{
  w.dados.veiculos[0].observacoes='<img src=x onerror=bad>';
  w.dados.veiculoDocumentos[0].ficheiro='javascript:alert(1)';w.dados.veiculoDocumentos[0].dataCriacao='invalid';
  w.TGTechnician.fleet();const panel=w.document.getElementById('painelGrupoMobileConteudo');assert.equal(panel.querySelector('img,a'),null);assert(panel.textContent.includes('<img src=x onerror=bad>'));assert(panel.textContent.includes('Ficheiro indisponível'));
 }finally{w.close();}
});

test('Safari toolbar resize and background updates preserve every technician tab without showing home above it',async()=>{
 const w=fleetSetup();try{
  w.document.getElementById('cardsGrid').insertAdjacentHTML('beforeend','<div id="omeudia"></div>');
  w.TGTechnician.refresh();w.eval(fs.readFileSync('tg-navigation.js','utf8'));
  for(const [key,title] of [['jobs','Agenda da semana'],['works','Obras ativas'],['fleet','A minha viatura'],['more','O meu perfil']]){
   w.document.querySelector('[data-tgt-nav='+key+']').click();
   for(const height of [700,840]){
    w.innerHeight=height;w.dispatchEvent(new w.Event('resize'));await new Promise(resolve=>w.setTimeout(resolve,230));
    w.document.dispatchEvent(new w.Event('tg:interface-updated'));
    assert.equal(w.getComputedStyle(w.document.getElementById('omeudia')).display,'none',key+' hides the initial menu');
    assert.equal(w.document.querySelector('#painelGrupoMobileConteudo h2').textContent,title);
    assert.equal(w.document.querySelector('[data-tgt-nav='+key+']').getAttribute('aria-current'),'page');
   }
  }
  w._mostrarInicioConteudo();assert.equal(w.document.getElementById('painelGrupoMobile').style.display,'none');
  assert.notEqual(w.getComputedStyle(w.document.getElementById('omeudia')).display,'none');
 }finally{w.close();}
});

function fleetWriteSetup(){
 const w=fleetSetup(),main=fs.readFileSync('app-principal.js','utf8');
 const maps=['veiculos','veiculoDocumentos','veiculoIntervencoes','veiculoSinistros'].map(name=>{const start=main.indexOf('            '+name+': {');return main.slice(start,main.indexOf('\n            },',start)+15);}).join('\n');
 w.eval('var isoToMs=v=>v?Date.parse(v):null,msToISO=v=>v?new Date(v).toISOString():null,nn=v=>v==null||v===\'\'?null:v;var M={'+maps+'};var _snap={};window.fleetMaps=M;');
 w.sequence=0;w.gerarId=()=> 'entry-'+(++w.sequence);w.requests=[];w.serverAssignment={id:'f',admin_id:'a',veiculo_id:'car'};w.savedRows=new Map();w.serverCar=w.fleetMaps.veiculos.to(w.dados.veiculos[0]);
 w.supa={from(table){let action='select',payload;const filters={};return {select(){return this},eq(key,value){filters[key]=value;return this},upsert(row){action='upsert';payload=row;return this},update(row){action='update';payload=row;return this},async single(){
  w.requests.push({table,action,payload,filters});
  if(table==='funcionarios'){if(w.waitAssignment)await w.waitAssignment;return {data:w.serverAssignment,error:null};}
  if(w.failTable===table)return {data:null,error:{message:'Sem ligação'}};
  if(table==='veiculos'){Object.assign(w.serverCar,payload);return {data:{...w.serverCar},error:null};}
  w.savedRows.set(table+':'+payload.id,{...payload});return {data:{...payload},error:null};
 }}}};
 w.TGTechnician.refresh();w.TGTechnician.fleet();
 w.editFleet=kind=>{w.document.querySelector('[data-tgt-action=fleet-'+kind+']').click();return w.document.getElementById('modalGenericoForm');};
 w.setFleet=(id,value)=>w.document.getElementById('tgt-fleet-'+id).value=value;
 w.saveFleet=form=>form.onsubmit(new w.Event('submit',{cancelable:true}));
 return w;
}
test('employee maintenance is confirmed once, updates mileage and uses the existing fleet mappings and snapshots',async()=>{
 const w=fleetWriteSetup();try{
  const form=w.editFleet('manutencao');w.setFleet('description','Óleo e filtros');w.setFleet('km','13000');w.setFleet('cost','145.50');w.setFleet('next-km','28000');
  await Promise.all([w.saveFleet(form),w.saveFleet(form)]);
  const writes=w.requests.filter(r=>r.action==='upsert');assert.equal(writes.length,1);assert.equal(writes[0].table,'veiculo_intervencoes');assert.equal(writes[0].payload.veiculo_id,'car');assert.equal(writes[0].payload.admin_id,'a');
  assert.equal(w.dados.veiculoIntervencoes.filter(r=>r.id==='entry-1').length,1);assert.equal(w.dados.veiculoIntervencoes.find(r=>r.id==='entry-1').custo,145.5);assert.equal(w.dados.veiculos[0].km,13000);
  assert(w._snap.veiculoIntervencoes.has('entry-1'));assert(w._snap.veiculos.has('car'));assert(!w.document.getElementById('modalGenericoOverlay').classList.contains('open'));
 }finally{w.close();}
});
test('employee inspection records the next validity date and incident fixes the driver to the signed-in person',async()=>{
 const w=fleetWriteSetup();try{
  let form=w.editFleet('inspecao');w.setFleet('description','IPO aprovada');w.setFleet('next-date','2028-01-10');await w.saveFleet(form);
  assert.equal(w.dados.veiculos[0].inspecaoValidade,'2028-01-10');assert.equal(w.dados.veiculoIntervencoes.find(r=>r.id==='entry-1').tipo,'inspecao');
  form=w.editFleet('sinistro');w.setFleet('description','Vidro danificado');await w.saveFleet(form);
  const row=w.savedRows.get('veiculo_sinistros:entry-2');assert.equal(row.condutor_id,'f');assert.equal(row.veiculo_id,'car');assert.equal(row.estado,'aberto');
 }finally{w.close();}
});
test('server failure keeps the form and does not invent a saved maintenance record; retry uses the same identifier',async()=>{
 const w=fleetWriteSetup();try{
  const form=w.editFleet('manutencao');w.setFleet('description','Revisão');w.failTable='veiculo_intervencoes';await w.saveFleet(form);
  assert(!w.dados.veiculoIntervencoes.some(r=>r.id==='entry-1'));assert(w.document.getElementById('modalGenericoOverlay').classList.contains('open'));assert(w.document.getElementById('tgt-fleet-feedback').textContent.includes('Não foi possível guardar'));assert.equal(w.document.getElementById('tgt-fleet-description').value,'Revisão');
  w.failTable=null;await w.saveFleet(form);assert.equal(w.savedRows.size,1);assert(w.savedRows.has('veiculo_intervencoes:entry-1'));
 }finally{w.close();}
});
test('partial vehicle-update failure preserves the confirmed record and a retry never creates a duplicate',async()=>{
 const w=fleetWriteSetup();try{
  const form=w.editFleet('inspecao');w.setFleet('description','Inspeção');w.setFleet('next-date','2028-01-10');w.failTable='veiculos';await w.saveFleet(form);
  assert(w.savedRows.has('veiculo_intervencoes:entry-1'));assert.equal(w.dados.veiculos[0].inspecaoValidade,'2027-01-10');assert(w.document.getElementById('tgt-fleet-feedback').textContent.includes('sem duplicar'));
  w.failTable=null;await w.saveFleet(form);assert.equal(w.savedRows.size,1);assert.equal(w.dados.veiculoIntervencoes.filter(r=>r.id==='entry-1').length,1);assert.equal(w.dados.veiculos[0].inspecaoValidade,'2028-01-10');
 }finally{w.close();}
});
test('stale persisted assignments, local revocations and session changes block all employee fleet writes',async()=>{
 for(const change of ['server','local','session']){const w=fleetWriteSetup();try{
  const form=w.editFleet('km');w.setFleet('km','14000');
  if(change==='server')w.serverAssignment.veiculo_id='other-car';
  if(change==='local')w.dados.funcionarios[0].veiculoId='other-car';
  let release;if(change==='session')w.waitAssignment=new Promise(resolve=>release=resolve);
  const save=w.saveFleet(form);if(change==='session'){w.usuarioLogado={id:'different',adminId:'b',role:'funcionario'};release();}await save;
  assert.equal(w.requests.filter(r=>r.action!=='select').length,0,change);assert.equal(w.dados.veiculos[0].km,12345);
 }finally{w.close();}}
});
test('employee can update mileage and upload a PDF into the assigned vehicle documents',async()=>{
 const w=fleetWriteSetup();try{
  let form=w.editFleet('km');w.setFleet('km','13500');await w.saveFleet(form);assert.equal(w.dados.veiculos[0].km,13500);
  form=w.editFleet('documento');const file=new w.File(['documento'],'fatura.pdf',{type:'application/pdf'});const field=w.document.getElementById('tgt-fleet-file');Object.defineProperty(field,'files',{value:[file]});field.required=false;
  await w.saveFleet(form);const row=w.savedRows.get('veiculo_documentos:entry-2');assert(row);assert.equal(row.veiculo_id,'car');assert.equal(row.nome,'fatura.pdf');assert(row.ficheiro.startsWith('data:application/pdf;base64,'));
 }finally{w.close();}
});
test('background refresh and Safari resize keep an unfinished vehicle form intact',async()=>{
 const w=fleetWriteSetup();try{
  w.eval(fs.readFileSync('tg-navigation.js','utf8'));w.TGTechnician.fleet();const form=w.editFleet('manutencao');w.setFleet('description','Texto ainda por guardar');
  w.dispatchEvent(new w.Event('resize'));w.document.dispatchEvent(new w.Event('tg:interface-updated'));await new Promise(resolve=>w.setTimeout(resolve,230));
  assert.equal(w.document.getElementById('tgt-fleet-description').value,'Texto ainda por guardar');assert(w.document.getElementById('modalGenericoOverlay').classList.contains('open'));assert.equal(w.requests.length,0);
 }finally{w.close();}
});

test('leave availability uses the existing balance including pending requests and refreshes without reopening the profile',()=>{
 const w=fleetSetup();try{
  w.document.getElementById('cardsGrid').insertAdjacentHTML('beforeend','<div class="card-principal" data-card="pedidos"></div>');
  w.document.body.insertAdjacentHTML('beforeend','<section id="secao-pedidos"><div class="section-header"><h2>Férias e faltas</h2></div></section>');
  const main=fs.readFileSync('app-principal.js','utf8');w.eval(main.slice(main.indexOf('        // ===== Férias: feriados nacionais'),main.indexOf('        function renderizarFuncionarios()')));
  w.dados.funcionarios[0].diasFerias=25;
  w.dados.pedidos=[{funcionarioId:'f',tipo:'ferias',status:'aprovado',dataInicio:'2026-10-26',dataFim:'2026-10-28'},{funcionarioId:'f',tipo:'ferias',status:'pendente_aprov',dataInicio:'2026-10-29',dataFim:'2026-10-29'},{funcionarioId:'f',tipo:'ferias',status:'rejeitado',dataInicio:'2026-11-02',dataFim:'2026-11-06'},{funcionarioId:'other',tipo:'ferias',status:'aprovado',dataInicio:'2026-10-26',dataFim:'2026-10-30'}];
  w.TGTechnician.refresh();w.TGTechnician.more();
  const balance=()=>w.document.querySelector('[data-tgt-leave-balance]').textContent;
  assert.equal(balance(),'21 dias disponíveis');assert(w.document.getElementById('tgtLeaveBalance').textContent.includes('21 dias disponíveis'));
  const profile=w.document.getElementById('painelGrupoMobileConteudo');w.dados.pedidos.push({funcionarioId:'f',tipo:'ferias',status:'aprovado',dataInicio:'2026-11-02',dataFim:'2026-11-02'});w.document.dispatchEvent(new w.Event('tg:interface-updated'));
  assert.equal(balance(),'20 dias disponíveis');assert.equal(w.document.getElementById('painelGrupoMobileConteudo'),profile);assert.equal(w.document.querySelectorAll('#tgtLeaveBalance').length,1);
 }finally{w.close();}
});
test('leave balance handles one or zero available days and never assumes a balance for a missing tenant profile',()=>{
 const w=fleetSetup();try{
  w.document.getElementById('cardsGrid').insertAdjacentHTML('beforeend','<div class="card-principal" data-card="pedidos"></div>');
  w.feriasDisponiveis=(id,year)=>{assert.equal(id,'f');assert.equal(year,2026);return w.balance;};
  for(const [balance,label] of [[1,'1 dia disponível'],[0,'0 dias disponíveis'],[-2,'0 dias disponíveis']]){w.balance=balance;w.TGTechnician.more();assert.equal(w.document.querySelector('[data-tgt-leave-balance]').textContent,label);}
  w.dados.funcionarios=[{id:'f',adminId:'other',diasFerias:99}];w.TGTechnician.more();assert.equal(w.document.querySelector('[data-tgt-leave-balance]').textContent,'Saldo de férias indisponível');
 }finally{w.close();}
});
