'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
test('源码检查跳过Git与依赖目录，仍拒绝源码语法错误且允许自己的部署配置',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rabbit-meals-check-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const put=(name,text)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
 put('scripts/check.js',fs.readFileSync(path.join(__dirname,'../scripts/check.js'),'utf8'));put('miniprogram/app.json','{"pages":[]}');
 for(const name of ['planning','menu-lifecycle','recipe-catalog'])for(const base of ['miniprogram/utils','cloudfunctions/planningFamily'])put(base+'/'+name+'.js','module.exports={};');
 put('project.config.json','{"appid":"wx0000000000000000"}');put('miniprogram/utils/config.js','module.exports={env:"owner-environment",notificationTemplates:[]};');put('cloudfunctions/planningFamily/test-tools.js','module.exports={enabled:false};');put('cloudfunctions/planningFamily/notifications.js','module.exports={};');
 put('.git/broken.js','invalid(()');put('node_modules/not-source/package.json','not-json');
 const run=release=>cp.spawnSync(process.execPath,['scripts/check.js'],{cwd:root,encoding:'utf8',env:{...process.env,PUBLIC_RELEASE_CHECK:release?'1':''}});
 assert.equal(run(false).status,0);const strict=run(true);assert.equal(strict.status,1);assert.match(strict.stderr,/占位AppID|个人云环境/);
 put('miniprogram/broken.js','invalid(()');const syntax=run(false);assert.equal(syntax.status,1);assert.match(syntax.stderr,/JS语法错误/);
});
