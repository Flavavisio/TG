const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
function setup(){
 const dom=new JSDOM(html,{runScripts:'outside-only'}),w=dom.window;let now=0,callback=null;
 Object.defineProperty(w.performance,'now',{value:()=>now});w.setInterval=fn=>{callback=fn;return 1};w.clearInterval=()=>{callback=null};
 w.document.querySelector('#tg-landing').getClientRects=()=>[{}];
 w.eval(fs.readFileSync('landing-demo.js','utf8'));
 return {dom,w,d:w.document,tick:ms=>{now+=ms;callback?.()}};
}
test('tour is opt-in, reaches each chapter, ends at exactly 90 seconds and restarts',()=>{
 const {dom,d,tick}=setup(),play=d.querySelector('[data-demo-play]');
 assert.equal(d.querySelector('[data-demo-seek]').value,'0');play.click();
 tick(18000);assert.equal(d.querySelector('[data-demo-step="1"]').getAttribute('aria-pressed'),'true');
 tick(18000);assert.equal(d.querySelector('[data-demo-scene="2"]').hidden,false);
 tick(18000);assert.equal(d.querySelector('[data-demo-scene="3"]').hidden,false);
 tick(18000);assert.equal(d.querySelector('[data-demo-scene="4"]').hidden,false);
 tick(18000);assert.equal(d.querySelector('[data-demo-time]').textContent,'01:30 / 01:30');assert.equal(play.textContent,'Rever demonstração');
 play.click();assert.equal(d.querySelector('[data-demo-seek]').value,'0');dom.window.close();
});
test('manual chapters pause playback; seeking, reset and background pause preserve the position',()=>{
 const {dom,w,d,tick}=setup(),play=d.querySelector('[data-demo-play]');play.click();tick(2000);play.click();tick(10000);
 assert.equal(d.querySelector('[data-demo-seek]').value,'2');
 d.querySelector('[data-demo-step="3"]').click();tick(10000);assert.equal(d.querySelector('[data-demo-seek]').value,'54');
 const seek=d.querySelector('[data-demo-seek]');seek.value='89';seek.dispatchEvent(new w.Event('input'));assert.equal(d.querySelector('[data-demo-scene="4"]').hidden,false);
 play.click();Object.defineProperty(d,'hidden',{value:true,configurable:true});d.dispatchEvent(new w.Event('visibilitychange'));tick(5000);assert.equal(seek.value,'89');
 d.querySelector('[data-demo-reset]').click();assert.equal(seek.value,'0');dom.window.close();
});
test('detailed customer cases stay hidden without approval and render supplied content safely',()=>{
 const dom=new JSDOM(html,{runScripts:'outside-only'}),w=dom.window,d=w.document;
 w.TG_CLIENT_CASES=[{company:'Unapproved'}];w.eval(fs.readFileSync('landing-cases.js','utf8'));assert.equal(d.querySelector('[data-real-cases]').hidden,true);
 w.TG_CLIENT_CASES=[{approved:true,company:'<img src=x onerror=alert(1)>',problem:'Verified challenge',use:'Verified use',result:'Verified result',source:'Internal approval record',publicationApproval:'Customer approval record'}];
 w.eval(fs.readFileSync('landing-cases.js','utf8'));assert.equal(d.querySelector('[data-real-cases]').hidden,false);assert.equal(d.querySelector('[data-real-cases-list] img'),null);assert.match(d.querySelector('[data-real-cases-list]').textContent,/<img/);dom.window.close();
});
