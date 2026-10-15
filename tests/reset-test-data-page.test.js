const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(enabled=true){
 let definition,pendingAction='',failure=false;
 const calls=[],modals=[],toasts=[],routes=[];
 const info={unbound:false,members:2,code:'test-invite',role:'guest',testReset:{enabled:true,canRestore:false}};
 const service={info:()=>info,role:()=>info.role,sync:async()=>info,testResetStatus:()=>({pendingAction}),pair:async(action,data)=>{calls.push({action,data});},
  run:async(page,fn)=>{if(page.data.busy)return;page.setData({busy:true,error:''});try{return await fn();}catch(e){page.setData({error:e.message});}finally{page.setData({busy:false});}},
  resetTestData:async()=>{calls.push({action:'resetTestData'});if(failure){pendingAction='resetTestData';throw Error('暂时连不上共享饭桌');}pendingAction='';info.testReset.canRestore=true;},
  restoreTestData:async()=>{calls.push({action:'restoreTestData'});pendingAction='';info.testReset.canRestore=false;}
 };
 vm.runInNewContext(fs.readFileSync('miniprogram/pages/pair/index.js','utf8'),{Page:x=>definition=x,wx:{showModal:o=>modals.push(o),showToast:o=>toasts.push(o),switchTab:o=>routes.push(o.url)},require:name=>name.endsWith('planning-service')?service:name.endsWith('config')?{testToolsEnabled:enabled}:require('../miniprogram/utils/role-navigation')});
 const page={...definition,data:copy(definition.data),setData(v){Object.assign(this.data,v);}};
 return {page,calls,modals,toasts,routes,info,pending:action=>pendingAction=action,fail:()=>failure=true};
}
test('临时入口须前后端开关均打开且已绑定，取消确认不清空',async()=>{
 const x=fixture();await x.page.onShow();assert.equal(x.page.data.testToolsEnabled,true);x.page.reset();assert.equal(x.calls.length,0);assert.match(x.modals[0].content,/两人/);assert.match(x.modals[0].content,/菜品库、绑定和身份保留/);x.modals[0].success({confirm:false});assert.equal(x.calls.length,0);
 x.info.testReset.enabled=false;await x.page.refresh();x.page.reset();assert.equal(x.modals.length,1);
 const disabled=fixture(false);await disabled.page.onShow();disabled.page.reset();assert.equal(disabled.modals.length,0);
});
test('清空成功才提示，并显示还原；还原也需要确认',async()=>{
 const x=fixture();await x.page.onShow();await x.page.performReset('resetTestData');assert.equal(x.calls.length,1);assert.equal(x.page.data.canRestore,true);assert.equal(x.page.data.role,'guest');assert.equal(x.page.data.members,2);assert.equal(x.page.data.busy,false);assert.equal(x.toasts.length,1);
 x.page.restore();assert.equal(x.calls.length,1);x.modals[0].success({confirm:false});assert.equal(x.calls.length,1);await x.page.performReset('restoreTestData');assert.equal(x.page.data.canRestore,false);assert.equal(x.toasts.length,2);
});
test('断网失败不伪报清空成功，留下同一操作的重试入口',async()=>{
 const x=fixture();await x.page.onShow();x.fail();await x.page.performReset('resetTestData');assert.equal(x.toasts.length,0);assert.equal(x.page.data.resetNotice,'');assert.match(x.page.data.error,/连不上/);assert.equal(x.page.data.pendingAction,'resetTestData');assert.equal(x.page.data.resetAction,'');assert.equal(x.page.data.busy,false);
});
test('还原成功但回复丢失后 canRestore 为 false，仍能重试原还原',async()=>{
 const x=fixture();x.pending('restoreTestData');await x.page.onShow();assert.equal(x.page.data.canRestore,false);assert.equal(x.page.data.pendingAction,'restoreTestData');await x.page.retryReset();assert.equal(x.calls[0].action,'restoreTestData');assert.equal(x.page.data.pendingAction,'');
});
test('测试入口不影响创建和加入后进入饭桌',async()=>{
 const x=fixture();await x.page.create();x.page.data.code='test-invite';await x.page.join();assert.equal(x.routes.length,2);assert.ok(x.routes.every(r=>r==='/pages/v3-menu/index'));
});
