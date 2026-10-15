const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../preview/runtime.js'), 'utf8');
function runtime() {
  const screen = {scrollTop: 300};
  const stored = new Map();
  const context = {setTimeout, clearTimeout, setInterval:()=>({unref(){}}), clearInterval(){}, queueMicrotask, URL, console,
    localStorage: {getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)}, location: {href:'http://localhost/preview/index.html'},
    document: {querySelector:selector=>selector==='#screen'?screen:null, getElementById:()=>null,createTextNode:text=>({textContent:text})},
    matchMedia:()=>({matches:true})};
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source.slice(0,source.indexOf('async function init()')),context);
  vm.runInContext('render=()=>{window.renderedName=currentName;window.renderCount=(window.renderCount||0)+1;}',context);
  return {context,screen,stored};
}
function loadApplication(context){
  const names=vm.runInContext('utilityModules',context);
  for(const name of names){context.moduleURL='../miniprogram/utils/'+name+'.js';context.moduleSource=fs.readFileSync(path.join(__dirname,'../miniprogram/utils/'+name+'.js'),'utf8');vm.runInContext('loadModule(moduleURL,moduleSource)',context);}
  for(const name of ['menu','week','shopping','stats','home','recipe','history']){context.moduleURL='../miniprogram/pages/v3-'+name+'/index.js';context.moduleSource=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/v3-'+name+'/index.js'),'utf8');vm.runInContext('currentName='+JSON.stringify('v3-'+name)+';loadModule(moduleURL,moduleSource)',context);}
  context.wx.showToast=()=>{};context.wx.hideToast=()=>{};
}
test('预览：后发导航胜出，旧异步页面不得覆盖', async()=>{
  const {context:c,screen}=runtime();
  vm.runInContext("definitions.slow={data:{},async onLoad(){await new Promise(r=>setTimeout(r,30));}};definitions.fast={data:{}};",c);
  await vm.runInContext("Promise.all([navigate('slow'),navigate('fast')])",c);
  assert.equal(c.renderedName,'fast'); assert.equal(c.renderCount,1); assert.equal(screen.scrollTop,0);
});
test('预览：页面动作导航后不得恢复旧滚动位置', async()=>{
  const {context:c,screen}=runtime();
  vm.runInContext("definitions.first={data:{},go(){return navigate('second');}};definitions.second={data:{}};",c);
  await vm.runInContext("navigate('first')",c); screen.scrollTop=300;
  await vm.runInContext("invoke('go',{},undefined)",c);
  assert.equal(c.renderedName,'second'); assert.equal(screen.scrollTop,0); assert.equal(c.renderCount,2);
});
test('预览：后续page主题选择器同样映射到根与应用舞台',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../miniprogram/app.wxss'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../miniprogram/theme-v5.wxss'),'utf8');
  const converted=css.replace(/(^|[}\s])page\s*\{/g,'$1:root,#phone{');
  assert.ok(converted.includes(':root,#phone{--bg:#f6f8fb'));
  assert.equal((converted.match(/(^|[}\s])page\s*\{/g)||[]).length,0);
});
test('预览：当前工具模块按依赖加载，所有原生业务页面可创建',()=>{
  const {context:c}=runtime();loadApplication(c);
  const registered=vm.runInContext('Object.keys(definitions).sort()',c);
  assert.deepEqual([...registered],['v3-history','v3-home','v3-menu','v3-recipe','v3-shopping','v3-stats','v3-week']);
  assert.throws(()=>vm.runInContext("loadModule('../miniprogram/utils/missing-test.js',\"require('./not-present')\")",c),/预览模块尚未加载/);
});
test('预览：配图直接使用小程序资源路径，不再重定向旧照片目录',()=>{
  const {context:c}=runtime();
  assert.equal(vm.runInContext("assetURL('/assets/demo-broccoli.svg')",c),'../miniprogram/assets/demo-broccoli.svg');
  assert.equal(vm.runInContext("assetURL('data:image/png;base64,example')",c),'data:image/png;base64,example');
  assert.doesNotMatch(source,/media\/catalog\/dish-/);
});
test('预览：展开共享过渡模板，模板数据独立映射首次加载与错误状态',()=>{
  const {context:c}=runtime();
  c.loading=fs.readFileSync(path.join(__dirname,'../miniprogram/templates/page-loading.wxml'),'utf8').match(/<template\b[^>]*>([\s\S]*)<\/template>/)[1];
  c.markup=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/v3-menu/index.wxml'),'utf8');
  const converted=vm.runInContext("partials['page-loading']=loading;prepareWxml(markup)",c);
  assert.doesNotMatch(converted,/<(?:page-meta|import|template)\b/);
  assert.match(converted,/data-preview-scope="{{loading:pageLoading,error:pageLoadError}}"/);
  assert.match(converted,/class="page-loading-retry"/);
  assert.match(converted,/<image[^>]*><\/image>/);
  const rendered=[];c.parent={append:node=>rendered.push(node.textContent)};
  c.block={nodeType:1,tagName:'BLOCK',getAttribute:name=>name==='data-preview-scope'?'{{loading:pageLoading,error:pageLoadError}}':null,hasAttribute:()=>false,childNodes:[{nodeType:3,textContent:'{{error}} / {{loading}}'}]};
  vm.runInContext("renderNode(block,{pageLoading:false,pageLoadError:'请重试',error:'旧业务错误'},parent)",c);
  assert.deepEqual(rendered,['请重试 / false']);
});
test('预览：加载过渡样式转换为浏览器元素，保留减少动态设置',()=>{
  const {context:c}=runtime();c.loadingCSS=fs.readFileSync(path.join(__dirname,'../miniprogram/page-loading.wxss'),'utf8');
  assert.ok(vm.runInContext("styleFiles.includes('page-loading.wxss')",c));
  const converted=vm.runInContext('previewStyles(loadingCSS)',c);
  assert.match(converted,/\.page-loading-avatar img\{/);assert.match(converted,/\.page-loading-dots>div\{/);
  assert.match(converted,/prefers-reduced-motion:reduce/);
});
test('预览：本机点菜提交、切大厨确认和逐菜做好使用真实页面动作',async()=>{
  const {context:c,stored}=runtime();loadApplication(c);
  await vm.runInContext("navigate('v3-menu')",c);
  await vm.runInContext("current.identity({currentTarget:{dataset:{role:'guest'}}})",c);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(stored.get('rabbit-meals-role'),'"guest"');assert.equal(vm.runInContext('current.data.pageReady',c),true);
  vm.runInContext("selected=['meat','veg'].flatMap(kind=>current.state.recipes.filter(r=>r.kind===kind&&!r.hidden).slice(0,3));for(const recipe of selected)current.pickDish({currentTarget:{dataset:{id:recipe.id}}});",c);
  assert.equal(vm.runInContext('current.data.total',c),6);
  await vm.runInContext('current.submit()',c);assert.equal(vm.runInContext('current.data.submittedPlan.status',c),'submitted');
  await vm.runInContext("current.identity({currentTarget:{dataset:{role:'cook'}}})",c);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(vm.runInContext('currentName',c),'v3-week');assert.equal(vm.runInContext('current.data.role',c),'cook');
  await vm.runInContext('current.confirm()',c);assert.equal(vm.runInContext('current.data.submittedPlan.status',c),'confirmed');
  vm.runInContext("current.finishDish({currentTarget:{dataset:{type:'next',id:selected[0].id}}})",c);
  assert.equal(vm.runInContext('current.data.workDone',c),1);assert.equal(vm.runInContext('current.data.busy',c),false);
  await vm.runInContext("navigate('v3-shopping')",c);assert.ok(vm.runInContext('current.data.items.length',c)>0);
});
