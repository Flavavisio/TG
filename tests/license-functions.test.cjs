const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('app-principal.js','utf8'),shared=fs.readFileSync('tg-pack-features.js','utf8');
const fn=name=>source.match(new RegExp('        (?:async )?function '+name+'\\([^]*?\\n        \\}'))[0];
function setup(pack='supreme',options={}){
 const d=new JSDOM('<body><div id="minhaLicencaContent"></div></body>',{url:'https://totalgest.test/',runScripts:'outside-only'}),w=d.window;
 const exp=Date.now()+86400000*40;
 w.admin={id:'a',nome:'Cliente',empresa:'Empresa',packAtual:pack,packEscalao:'10',packBlocos:0,licenca:{plano:'30_10',dias:30,maxFuncionarios:10,dataExpiracao:exp,codigo:'TESTE',ativa:true},...options};
 w.usuarioLogado={id:'a',role:'admin'};w.dados={pedidosRenovacao:[],referencias:[]};w.adminAtual=()=>w.admin;w.contarFuncionarios=()=>7;w.ehPlanoDemo=p=>String(p).startsWith('demo');w._valorTotalLicenca=()=>107.49;w._referenciaBlocoHTML=()=>'';w._dadosBancariosCache={};w._dadosBancariosTentativaEmCurso=false;w._IVA_INC=' (IVA inc.)';w.PLANOS={'30_10':{label:'30 dias - 10 func.'},demo_30:{label:'Teste'}};
 w.valorDoPedido=p=>p.valor||0;w.blocoInstrucoesPagamentoGrupo=()=>'<p>Dados de pagamento</p>';
 const defs=source.slice(source.indexOf('        const PACKS ='),source.indexOf('        // Quando o super admin escolhe um pack'));
 w.eval(shared+'\n'+defs+'\n'+['_minhaLicencaFuncionalidadesHtml','renderizarMinhaLicenca','calcularDiasRestantes','isLicencaValida','escapeHtmlSimples','moduloContratosAtivo','moduloFrotaAtivo','moduloArmazemAtivo','moduloCrmAtivo','moduloAssistAtivo','moduloErpAtivo','moduloRondasAtivo','moduloPortalAtivo','moduloNotificacoesAtivo'].map(fn).join('\n'));
 return {w,render:()=>w.renderizarMinhaLicenca(),text:()=>w.document.getElementById('minhaLicencaContent').textContent,close:()=>w.close()};
}
test('pack page lists functions without old module cards, icons, per-module prices or upselling',()=>{
 const c=setup();try{c.render();assert(c.text().includes('Pack Supreme'));assert(c.text().includes('Funcionalidades incluídas no Pack Supreme'));
 const list=c.w.document.querySelector('.my-license-functions');assert(list.textContent.includes('CRM Comercial'));assert(list.textContent.includes('Ilimitados'));assert.equal(list.querySelectorAll('i,.badge').length,0);assert(!list.textContent.includes('€'));assert(!c.text().includes('Ativar Add-ons'));assert(!c.text().includes('14.99 €/mês'));assert(!c.text().includes('Preço de catálogo atual'));assert.equal(c.w.document.querySelectorAll('[onclick*="abrirModalRenovacao"]').length,1);
 }finally{c.close()}
});
test('Express and Pro+ show only their included functions, while keeping active independent rights',()=>{
 const c=setup('express');try{c.render();let list=c.w.document.querySelector('.my-license-functions');assert(!list.textContent.includes('CRM Comercial'));assert(!list.textContent.includes('Rondas / Vigilância'));assert(list.textContent.includes('5 modelos'));
 c.w.admin.packAtual='pro_plus';c.render();list=c.w.document.querySelector('.my-license-functions');assert(list.textContent.includes('CRM Comercial'));assert(!list.textContent.includes('Rondas / Vigilância'));assert(list.textContent.includes('40 modelos'));
 c.w.admin.erpPlano='mensal';c.w.admin.erpExpiracao=Date.now()+86400000;c.render();assert(c.w.document.querySelector('.my-license-functions').textContent.includes('Opções de integração ERP'));
 }finally{c.close()}
});
test('legacy accounts retain their active functions without expired or inactive module advertising',()=>{
 const c=setup(null,{crmPlano:'mensal',crmExpiracao:Date.now()+86400000,frotaPlano:'mensal',frotaExpiracao:Date.now()-1});try{c.render();const list=c.w.document.querySelector('.my-license-functions');assert(list.textContent.includes('CRM Comercial'));assert(!list.textContent.includes('Frota'));assert(list.textContent.includes('Ilimitados'));assert(!c.text().includes('Ativar Add-ons'));}finally{c.close()}
});
test('pending pack and payment information remain available and rendering cannot change the license',()=>{
 const c=setup('pro_plus');try{const before=JSON.stringify(c.w.admin);c.w.dados.pedidosRenovacao=[{id:'p',adminId:'a',tipo:'pack',packPedido:'supreme',status:'pendente',valor:107.49}];c.render();assert(c.text().includes('Pack pedido: Supreme'));assert(c.text().includes('Resumo do pedido'));assert(c.text().includes('Dados de pagamento'));assert.equal(JSON.stringify(c.w.admin),before);assert(c.w.document.getElementById('btnExportarTudoZip'));assert(c.w.document.querySelector('[onclick="_abrirModalCancelamento()"]'));}finally{c.close()}
});
