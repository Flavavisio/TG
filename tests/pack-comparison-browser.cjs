const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
const source=fs.readFileSync('app-principal.js','utf8');
const fn=name=>source.match(new RegExp('        (?:async )?function '+name+'\\([^]*?\\n        \\}'))[0];
const defs=source.slice(source.indexOf('        const PACKS ='),source.indexOf('        // Quando o super admin escolhe um pack'));
const funcs=['_abrirRenovacaoPack','_renPackFmt','_renPackCalcular','_renPackFuncMax','_renPackFuncionalidadesHtml','_renPackRender','_renPackSet','_renPackBloco','calcularDiasRestantes','isLicencaValida','escapeHtmlSimples'].map(fn).join('\n');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+['styles.css','responsive-device.css','tg-form-focus.css'].map(f=>fs.readFileSync(f,'utf8')).join('\n')+'</style></head><body></body></html>');
 await page.addScriptTag({content:fs.readFileSync('tg-pack-features.js','utf8')+'\n'+defs+'\n'+funcs+`\nlet _renPack=null;const admin={id:'a',packAtual:'pro',packEscalao:'10',packBlocos:0,licenca:{plano:'30_10',dias:30,maxFuncionarios:10,dataExpiracao:Date.now()+86400000*20}};const dados={tiposTrabalhoCustom:[]};const _IVA_INC=' (IVA inc.)';function adminAtual(){return admin}function ehPlanoDemo(){return false}_abrirRenovacaoPack();`});
 await page.getByRole('button',{name:'Pro+',exact:true}).click();
 assert.equal(await page.locator('[data-change="added"]').count(),1);assert((await page.locator('[data-change="added"]').innerText()).includes('CRM Comercial'));
 const form=await page.locator('.ren-pack-form').boundingBox(),panel=await page.locator('.ren-pack-features').boundingBox();assert(panel.x>form.x+form.width,'desktop side panel');
 await page.locator('#ren_pack_obs').fill('Observação de teste');await page.getByRole('button',{name:'Supreme',exact:true}).click();assert.equal(await page.locator('#ren_pack_obs').inputValue(),'Observação de teste');
 await page.locator('.ren-pack-dialog').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
 await page.screenshot({path:'/tmp/tg-pack-comparison-desktop.png'});
 for(const width of [1024,900,718,390,320]){
 await page.setViewportSize({width,height:844});await page.locator('.ren-pack-dialog').evaluate(e=>e.scrollTop=0);
 const boxes=await page.evaluate(()=>{const f=document.querySelector('.ren-pack-form').getBoundingClientRect(),p=document.querySelector('.ren-pack-features').getBoundingClientRect(),m=document.querySelector('.ren-pack-dialog');return {fy:f.y,fh:f.height,py:p.y,overflow:m.scrollWidth-m.clientWidth,page:document.documentElement.scrollWidth-innerWidth}});
 assert(boxes.overflow<=1 && boxes.page<=1,'no overflow '+width);if(width<=900)assert(boxes.py>=boxes.fy+boxes.fh,'mobile features follow form '+width);
 }
 await page.setViewportSize({width:390,height:844});await page.locator('.ren-pack-features').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/tg-pack-comparison-mobile.png'});
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>document.body.classList.add('dark-mode'));await page.locator('.ren-pack-dialog').evaluate(e=>e.scrollTop=0);await page.screenshot({path:'/tmp/tg-pack-comparison-dark.png'});
 assert.deepEqual(errors,[]);console.log('PASS: desktop side panel, 1024/900/718/390/320px layouts, no overflow, live pack selection, retained notes and dark mode.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
