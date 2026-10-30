const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const main=fs.readFileSync('app-principal.js','utf8'),landing=fs.readFileSync('landing-calculadora.js','utf8');
const fn=name=>main.match(new RegExp('        (?:async )?function '+name+'\\([^]*?\\n        \\}'))[0];
function app(){
 const c=vm.createContext({Date,console,dados:{administradores:[]},ehPlanoDemo:p=>String(p).startsWith('demo'),getValorPlano:()=> '34.99'});
 const defs=main.slice(main.indexOf('        const PACKS ='),main.indexOf('        // Quando o super admin escolhe um pack'));
 const funcs=['moduloCrmAtivo','moduloAssistAtivo','moduloFrotaAtivo','moduloArmazemAtivo','moduloContratosAtivo','moduloErpAtivo','moduloRondasAtivo','valorBaseCobradoDe','_addonsAtivosDe','_valorTotalLicenca'];
 const prices=['FROTA','ARMAZEM','CONTRATOS','CRM','ASSIST','ERP'].map(n=>`const PRECO_${n}_MENSAL=9.99, PRECO_${n}_ANUAL=107.89;`).join('\n');
 vm.runInContext(defs+'\n'+prices+'\n'+funcs.map(fn).join('\n'),c);c.run=s=>vm.runInContext(s,c);return c;
}
test('prices: Pro+ = Pro + 9.99, blocks, annual and free trial',()=>{
 const c=app();c.run("admin={licenca:{plano:'30_10',dias:30},packEscalao:'10',packBlocos:2}; aplicarPackAoAdmin(admin,'pro_plus',Date.now()+86400000)");
 for(const esc of ['5','10','25','50'])assert.equal(c.run(`PACK_PRECOS.pro_plus[${esc}]`),Math.round((c.run(`PACK_PRECOS.pro[${esc}]`)+9.99)*100)/100);
 assert.equal(c.run('_valorTotalLicenca(admin)'),97.48);
 c.run("admin.licenca.dias=365; admin.licenca.plano='365_10'");assert.equal(c.run('_valorTotalLicenca(admin)'),1052.78);
 c.run("admin.licenca.plano='demo_30'");assert.equal(c.run('_valorTotalLicenca(admin)'),0);
});
test('rights: Pro + CRM, no ERP or Rondas, same expiry, downgrade and expiration',()=>{
 const c=app();c.run("admin={};aplicarPackAoAdmin(admin,'pro_plus',Date.now()+86400000,'anual')");
 assert.equal(c.run('!!moduloCrmAtivo(admin)'),true);assert.equal(c.run('!!moduloAssistAtivo(admin)'),true);assert.equal(c.run('admin.crmPlano'),'anual');
 assert.equal(c.run('admin.crmExpiracao===admin.frotaExpiracao'),true);assert.equal(c.run('PACKS.pro_plus.limites.relatoriosPersonalizados'),40);
 assert.equal(c.run('!!moduloErpAtivo(admin)'),false);assert.equal(c.run('!!moduloRondasAtivo(admin)'),false);
 c.run("aplicarPackAoAdmin(admin,'pro',Date.now()+86400000)");assert.equal(c.run('!!moduloCrmAtivo(admin)'),false);
 c.run("aplicarPackAoAdmin(admin,'pro_plus',Date.now()-1)");assert.equal(c.run('!!moduloCrmAtivo(admin)'),false);
});
test('billing: included modules never charged twice; independent ERP and founder discount preserved',()=>{
 const c=app();c.run("admin={licenca:{plano:'30_5',dias:30},packEscalao:'5'};aplicarPackAoAdmin(admin,'pro_plus',Date.now()+86400000)");
 assert.equal(c.run('_addonsAtivosDe(admin).length'),0);assert.equal(c.run('_valorTotalLicenca(admin)'),82.48);
 c.run("admin.erpPlano='mensal';admin.erpExpiracao=Date.now()+86400000");assert.equal(c.run('_valorTotalLicenca(admin)'),92.47);
 c.run('admin.precoFundador=true');assert.equal(c.run('_valorTotalLicenca(admin)'),84.22);
});
test('approval: annual period, capacity and all module dates persist; double click cannot extend twice',()=>{
 const c=app();Object.assign(c,{guardarDados:()=>{},piscarAdmin:()=>{},registarHistoricoLicenca:()=>{},_enviarEmailRenovacaoAprovada:()=>{}});c.run(fn('aprovarPedidoRenovacao'));
 c.run("admin={id:'a',nome:'Teste',licenca:{plano:'30_10',dias:30,dataExpiracao:Date.now()+86400000}};dados.administradores=[admin];dados.pedidosRenovacao=[{id:'p',adminId:'a',tipo:'pack',packPedido:'pro_plus',escalaoPedido:'10',blocosPedido:1,periodoPedido:'anual',funcMax:15,status:'pendente'}];aprovarPedidoRenovacao('p',true)");
 assert.equal(c.run('admin.licenca.dias'),365);assert.equal(c.run('admin.licenca.maxFuncionarios'),15);assert.equal(c.run('admin.licenca.dataExpiracao===admin.crmExpiracao'),true);
 const exp=c.run('admin.licenca.dataExpiracao');c.run("aprovarPedidoRenovacao('p',true)");assert.equal(c.run('admin.licenca.dataExpiracao'),exp);
});
test('calculator and public checkout offer Pro+ with correct capacity and price',()=>{
 const c=vm.createContext({window:{addEventListener:()=>{}},document:{getElementById:()=>null,addEventListener:()=>{}},atualizarLanding:()=>{}});
 vm.runInContext(landing.replace(/\(function\(\)\{var ano=[^]*$/,''),c);
 const r=vm.runInContext("tgCalcularPack(17,['crm','armazem'])",c);assert.equal(r.pack,'pro_plus');assert.equal(r.capacidade,20);assert.equal(r.mensal,97.48);
 assert.equal(vm.runInContext("SU_PACKS.pro_plus.nome",c),'Pro+');
 const index=fs.readFileSync('index.html','utf8');assert(index.includes('data-pack-start="pro_plus"'));assert(!index.includes('Novo pack em preparação'));
 const planos=fs.readFileSync('planos.html','utf8');for(const p of ['82,48','87,48','102,48','142,48'])assert(planos.includes(p+' €'));
});
function edge(slug,pedido={}){
 const writes=[];let handler;
 const admin={from(table){const b={select(){return b},eq(){return b},limit(){return b},maybeSingle:async()=>({data:slug==='renovacao-cliente' ? (table==='administradores'?pedido:table==='licencas'?pedido.licenca:null) : table==='pedidos_trial'&&slug==='confirmar-trial'?pedido:null,error:null}),insert:async rows=>{writes.push({table,rows});return {error:null}},upsert:async rows=>{writes.push({table,rows});return {error:null}},update(row){writes.push({table,rows:[row]});return b},then(resolve){resolve({error:null})}};return b},auth:{admin:{createUser:async()=>({data:{user:{id:'auth-test'}},error:null})}}};
 const c=vm.createContext({Date,console,Request,Response,URL,crypto,fetch:async()=>({ok:true}),createClient:()=>admin,Deno:{env:{get:()=> 'mock'},serve:f=>{handler=f}},serve:f=>{handler=f}});
 for(const path of ['supabase/functions/_shared/packs.ts',`supabase/functions/${slug}/index.ts`]){
  const code=fs.readFileSync(path,'utf8').replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');vm.runInContext(stripTypeScriptTypes(code,{mode:'strip'}),c);
 }
 return {call:handler,writes,c};
}
test('request function persists Pro+ tier and blocks; invalid capacity writes nothing',async()=>{
 const e=edge('criar_pedido_trial'),body={empresa:'Teste',nome:'Teste',email:'test@example.invalid',telefone:'000',senha:'Teste123!@',plano:'pro_plus',escalao:'10',blocosExtra:2};
 assert.equal((await e.call(new Request('https://test.invalid',{method:'POST',body:JSON.stringify(body)}))).status,200);
 const row=e.writes.find(w=>w.table==='pedidos_trial').rows[0];assert.equal(row.plano,'pro_plus');assert.equal(row.pack_escalao,'10');assert.equal(row.pack_blocos,2);
 const bad=edge('criar_pedido_trial');assert.equal((await bad.call(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({...body,blocosExtra:100})}))).status,400);assert.equal(bad.writes.length,0);
});
test('confirmation creates Pro+ trial rights and capacity; legacy numeric trials remain compatible',async()=>{
 const pedido={plano:'pro_plus',pack_escalao:'10',pack_blocos:2,senha_pendente:'Teste123!@',email:'test@example.invalid',nome:'Teste',empresa:'Teste',criado_em:new Date().toISOString()};
 const e=edge('confirmar-trial',pedido);assert.equal((await e.call(new Request('https://test.invalid?token=test'))).status,200);
 const a=e.writes.find(w=>w.table==='administradores').rows[0],l=e.writes.find(w=>w.table==='licencas').rows[0];
 assert.equal(a.pack_atual,'pro_plus');assert.equal(a.crm_plano,'demo');assert.equal(a.assist_plano,'demo');assert.equal(a.crm_expiracao,l.data_expiracao);assert.equal(l.max_funcionarios,20);assert.equal(l.dias,14);assert.equal(a.erp_plano,undefined);
 const legacy=edge('confirmar-trial',{...pedido,plano:'25'});await legacy.call(new Request('https://test.invalid?token=test'));assert.equal(legacy.writes.find(w=>w.table==='licencas').rows[0].max_funcionarios,25);
});
test('saving company settings never resends cached pack or expiry fields',async()=>{
 const old={id:'a',nome:'Antes',pack_atual:'pro',crm_expiracao:'2026-10-28T00:00:00Z'};
 const updates=[];
 const c=vm.createContext({_snap:{administradores:new Map([['a',JSON.stringify(old)]])},supa:{from:()=>({update(patch){updates.push(patch);return {eq:()=>({select:async()=>({data:[{id:'a'}],error:null})})}}})}});
 vm.runInContext(fn('_guardarAdministradoresAlterados'),c);
 await vm.runInContext(`_guardarAdministradoresAlterados([${JSON.stringify({...old,nome:'Depois'})}])`,c);
 assert.deepEqual(JSON.parse(JSON.stringify(updates)),[{nome:'Depois'}]);
});

test('email renewal preserves Pro+ pricing, capacity and creates one pack request without add-on charges',async()=>{
 const admin={id:'a',empresa:'Teste',nome:'Teste',pack_atual:'pro_plus',pack_escalao:'10',pack_blocos:2,licenca:{plano:'365_25',dias:365}};
 const e=edge('renovacao-cliente',admin);
 const response=await e.call(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({acao:'info',token:'test'})}));
 const info=await response.json();assert.equal(info.packAtual,'pro_plus');assert.equal(info.planosDisponiveis.find(p=>p.key==='pro_plus').preco,1052.78);
 assert.equal((await e.call(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({acao:'submeter',token:'test',escolha:'renovar',addons:{frota:'mensal'}})}))).status,200);
 const pedidos=e.writes.filter(w=>w.table==='pedidos_renovacao');assert.equal(pedidos.length,1);assert.equal(pedidos[0].rows.tipo,'pack');assert.equal(pedidos[0].rows.pack_pedido,'pro_plus');assert.equal(pedidos[0].rows.valor,1052.78);assert.equal(pedidos[0].rows.func_max,20);
});
