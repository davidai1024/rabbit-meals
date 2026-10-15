const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),failures=[];
const ignored=new Set(['.git','node_modules','.cache','coverage','dist','build','.idea','.vscode']);let bytes=0;
function walk(dir){
 for(const name of fs.readdirSync(dir)){
  if(ignored.has(name))continue;
  const file=path.join(dir,name),stat=fs.lstatSync(file);if(stat.isSymbolicLink())continue;
  if(stat.isDirectory()){walk(file);continue;}
  if(file.startsWith(path.join(root,'miniprogram')+path.sep))bytes+=stat.size;
  if(file.endsWith('.js'))try{cp.execFileSync(process.execPath,['--check',file],{stdio:'pipe'});}catch(e){failures.push(path.relative(root,file)+': JS语法错误');}
  if(file.endsWith('.json'))try{JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){failures.push(path.relative(root,file)+': JSON格式错误');}
 }
}
walk(root);
const app=JSON.parse(fs.readFileSync(path.join(root,'miniprogram/app.json'),'utf8'));
for(const page of app.pages){
 const base=path.join(root,'miniprogram',page);
 for(const ext of ['js','json','wxml','wxss'])if(!fs.existsSync(base+'.'+ext))failures.push(page+' 缺少 '+ext);
 const js=fs.readFileSync(base+'.js','utf8'),wxml=fs.readFileSync(base+'.wxml','utf8');
 const definition=page.includes('/v3-')?require('../miniprogram/utils/planning-pages')[page.split('/')[1].slice(3)]():null;
 for(const match of wxml.matchAll(/(?:bind|catch)(?:tap|input|change)="([a-zA-Z]+)"/g))if(definition?typeof definition[match[1]]!=='function':!new RegExp('\\b'+match[1]+'\\s*\\(').test(js))failures.push(page+' 未实现事件 '+match[1]);
}
for(const name of ['planning','menu-lifecycle','recipe-catalog'])if(fs.readFileSync(path.join(root,'miniprogram/utils',name+'.js'),'utf8')!==fs.readFileSync(path.join(root,'cloudfunctions/planningFamily',name+'.js'),'utf8'))failures.push(name+' 客户端与云端不一致');
// This release-only gate does not prevent owners from configuring their own deployment.
if(process.env.PUBLIC_RELEASE_CHECK==='1'){
 const project=require('../project.config.json'),config=require('../miniprogram/utils/config'),tools=require('../cloudfunctions/planningFamily/test-tools');
 if(project.appid!=='touristappid')failures.push('公开示例必须使用占位AppID');
 if(config.env||config.templateId||(config.notificationTemplates||[]).some(x=>x.id))failures.push('公开示例不能带个人云环境或订阅模板');
 if(config.testToolsEnabled||tools.enabled)failures.push('公开示例必须默认关闭测试清空工具');
 const notifications=fs.readFileSync(path.join(root,'cloudfunctions/planningFamily/notifications.js'),'utf8');
 if(/id\s*:\s*['"][^'"]+['"]/.test(notifications))failures.push('公开云函数不能硬编码个人订阅模板');
}
console.log('页面',app.pages.length,'小程序包体',bytes,'bytes');
if(bytes>2*1024*1024)failures.push('主包超过2MB检查阈值');
if(failures.length){console.error(failures.join('\n'));process.exit(1);}
console.log('语法、JSON、页面文件、事件绑定、模型一致性与包体检查通过');
