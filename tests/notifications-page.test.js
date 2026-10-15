require('./helpers/configure-cloud');
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const cfg=require('../miniprogram/utils/config'),clone=x=>JSON.parse(JSON.stringify(x)),tick=()=>new Promise(resolve=>setImmediate(resolve));
const menu=cfg.notificationTemplates.find(x=>x.kind==='menu').id,review=cfg.notificationTemplates.find(x=>x.kind==='review').id;
function fixture({role='cook',promise=false,unsupported=false}={}){
 let definition,pending=null,failure=false;const requests=[],calls=[],toasts=[];
 const info={unbound:false,role,members:2,code:'invite',notifications:{enabled:true,canSubscribe:role==='cook',preferences:{menu:'unset',review:'unset'},last:{}}};
 const service={info:()=>info,role:()=>role,sync:async()=>info,testResetStatus:()=>({}),notificationPreferenceStatus:()=>({pending:!!pending,choices:pending}),notificationPreferences:async choices=>{calls.push(clone(choices));pending=clone(choices);if(failure)throw Error('连接失败');info.notifications.preferences={...info.notifications.preferences,...choices};info.notifications.last={};pending=null;return info;},run:async(page,fn)=>{page.setData({busy:true});try{return await fn();}finally{page.setData({busy:false});}}};
 const wx={showToast:x=>toasts.push(x),switchTab(){}};let resolveRequest;
 if(!unsupported)wx.requestSubscribeMessage=options=>{requests.push(options);if(promise)return new Promise(resolve=>resolveRequest=resolve);};
 vm.runInNewContext(fs.readFileSync('miniprogram/pages/pair/index.js','utf8'),{Page:value=>definition=value,wx,require:name=>name.endsWith('planning-service')?service:name.endsWith('config')?cfg:require('../miniprogram/utils/role-navigation')});
 const page={...definition,data:clone(definition.data),setData(value){Object.assign(this.data,value);}};
 return {page,info,requests,calls,toasts,fail:value=>failure=value,resolve:r=>resolveRequest(r),pending:v=>pending=v};
}
test('进入设置不自动弹授权，点击后立即请求两个固定模板且仅局部加载',async()=>{
 const x=fixture();await x.page.onShow();assert.equal(x.requests.length,0);x.page.subscribeReminders();assert.equal(x.requests.length,1);assert.deepEqual(Array.from(x.requests[0].tmplIds),[menu,review]);assert.equal(x.calls.length,0);assert.equal(x.page.data.busy,false);assert.equal(x.page.data.notificationBusy,true);x.page.subscribeReminders();assert.equal(x.requests.length,1);
 await x.requests[0].success({[menu]:'accept',[review]:'accept'});assert.equal(x.calls.length,1);assert.match(x.page.data.notificationNotice,/本次订阅成功/);assert.equal(x.page.data.notificationBusy,false);assert.equal(x.toasts.length,0);
});
test('部分同意与 ban 分别保存，不把未同意报成订阅成功',async()=>{
 const x=fixture();await x.page.onShow();x.page.subscribeReminders();await x.requests[0].success({[menu]:'accept',[review]:'ban',unrelated:'accept'});assert.deepEqual(x.calls[0],{menu:'accept',review:'ban'});assert.match(x.page.data.notificationNotice,/新点评提醒：本次未同意/);assert.equal(x.page.data.notificationRows[1].status,'微信已拒绝订阅');
});
test('订阅成功但设置断网明确提示，重试只保存原选择不重复弹微信授权',async()=>{
 const x=fixture();await x.page.onShow();x.fail(true);x.page.subscribeReminders();await x.requests[0].success({[menu]:'accept',[review]:'reject'});assert.match(x.page.data.notificationNotice,/本次订阅成功/);assert.match(x.page.data.notificationError,/尚未同步/);assert.equal(x.page.data.notificationPending,true);assert.equal(x.page.data.busy,false);
 x.fail(false);await x.page.retryNotificationPreferences();assert.equal(x.requests.length,1);assert.equal(x.calls.length,2);assert.deepEqual(x.calls[0],x.calls[1]);assert.equal(x.page.data.notificationPending,false);
});
test('关闭只写本人偏好，不请求微信授权且成功前不宣布关闭',async()=>{
 const x=fixture();await x.page.onShow();x.fail(true);await x.page.closeReminders();assert.equal(x.requests.length,0);assert.equal(x.page.data.notificationNotice,'');assert.match(x.page.data.notificationError,/尚未同步/);x.fail(false);await x.page.closeReminders();assert.deepEqual(x.calls.at(-1),{menu:'reject',review:'reject'});assert.match(x.page.data.notificationNotice,/饭桌提醒已关闭/);assert.equal(x.page.data.notificationOff,true);
});
test('不支持、调用失败、无有效选择均不伪成功或保存授权',async()=>{
 const unsupported=fixture({unsupported:true});await unsupported.page.onShow();unsupported.page.subscribeReminders();assert.match(unsupported.page.data.notificationError,/更新微信/);
 const x=fixture();await x.page.onShow();x.page.subscribeReminders();x.requests[0].fail({errMsg:'cancel'});assert.equal(x.calls.length,0);assert.equal(x.page.data.notificationBusy,false);x.page.subscribeReminders();await x.requests[1].success({[menu]:'filter',unknown:'accept'});assert.equal(x.calls.length,0);assert.match(x.page.data.notificationError,/有效订阅结果/);
});
test('callback 与 promise 同时回报不会重复保存设置',async()=>{
 const x=fixture({promise:true});await x.page.onShow();x.page.subscribeReminders();const result={[menu]:'accept',[review]:'accept'};await x.requests[0].success(result);x.resolve(result);await tick();assert.equal(x.calls.length,1);
});
test('访客不展示或调起大厨授权',async()=>{
 const x=fixture({role:'guest'});await x.page.onShow();assert.equal(x.page.data.notificationEnabled,false);x.page.subscribeReminders();await x.page.closeReminders();assert.equal(x.requests.length,0);assert.equal(x.calls.length,0);
});
test('微信已受理不声称已送达，授权用完与未知结果有准确提示',async()=>{
 const x=fixture();x.info.notifications.last={menu:{status:'accepted'},review:{status:'needsAuthorization'}};await x.page.onShow();assert.match(x.page.data.notificationRows[0].detail,/无法确认是否送达/);assert.equal(x.page.data.notificationRows[1].status,'需补充订阅');x.info.notifications.last.menu.status='unknown';await x.page.refresh();assert.match(x.page.data.notificationRows[0].detail,/无法确认/);
});
test('待同步选择在页面重新显示后仍给出重试入口',async()=>{
 const x=fixture();x.pending({menu:'accept'});await x.page.onShow();assert.equal(x.page.data.notificationPending,true);await x.page.retryNotificationPreferences();assert.deepEqual(x.calls[0],{menu:'accept'});assert.equal(x.requests.length,0);
});
