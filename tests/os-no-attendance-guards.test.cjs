const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const src=fs.readFileSync('tg-technician.js','utf8');
test('hide pause menu for tenants without attendance',()=>{
  assert.match(src,/choice\.hidden=!attendance\(\)/);
  assert.match(src,/choice\.style\.display=attendance\(\)\?'':'none'/);
});
test('pause action and pause persistence require attendance',()=>{
  assert.match(src,/case'pause':if\(!attendance\(\)\)return;return pauseWork\(job\)/);
  assert.match(src,/pauseBusy\|\|!job\?\.open\|\|!enabled\(\)\|\|!attendance\(\)/);
});
test('prevent second job from starting while previous job is open without attendance',()=>{
  assert.match(src,/if\(!attendance\(\)&&jobs\(\)\.some\(other=>other\.open/);
  assert.match(src,/Termina por hoje ou termina a intervenção antes de iniciar outra OS/);
});

const vm=require('node:vm');
function pending(records,services) {
  const fn=src.match(/    function pendingPersonalOS\(\) \{[^]*?\n    \}/);
  assert(fn,'pendingPersonalOS implementation is present');
  const ctx={records,services};
  vm.runInNewContext('const u=()=>({id:"t"}); const rows=k=>k==="ponto"?records:services; const done=s=>/concluid|terminad|cancelad/.test(s||""); '+fn[0]+'; answer=pendingPersonalOS();',ctx);
  return Array.from(ctx.answer);
}
test('exit lists every OS in progress or paused individually',()=>{
  const services=[{id:'a',numeroRegisto:'125',status:'em andamento'},{id:'b',numeroRegisto:'128',status:'em andamento'}];
  const records=[
    {funcionarioId:'t',servicoId:'a',data:'2026-11-12',entrada:'09:00',saida:'10:00',motivoSaida:'pausa'},
    {funcionarioId:'t',servicoId:'b',data:'2026-11-12',entrada:'11:00',saida:null},
    {funcionarioId:'another',servicoId:'a',data:'2026-11-12',entrada:'12:00',saida:null}
  ];
  assert.deepEqual(pending(records,services),['OS 125','OS 128']);
  records.push({funcionarioId:'t',servicoId:'a',data:'2026-11-12',entrada:'13:00',saida:'14:00',motivoSaida:'hoje'});
  assert.deepEqual(pending(records,services),['OS 128']);
});
test('completed OS and ended interventions no longer block exit',()=>{
  assert.deepEqual(pending([
    {funcionarioId:'t',servicoId:'a',data:'2026-11-12',entrada:'09:00',saida:'10:00',motivoSaida:'pausa'},
    {funcionarioId:'t',servicoId:'b',data:'2026-11-12',entrada:'09:00',saida:'10:00',motivoSaida:'hoje'}
  ],[{id:'a',numeroRegisto:'125',status:'concluído'},{id:'b',numeroRegisto:'128',status:'em andamento'}]),[]);
});
