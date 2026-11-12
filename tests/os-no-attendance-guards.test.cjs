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
