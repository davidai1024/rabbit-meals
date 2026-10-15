require('./helpers/configure-cloud');
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const model=require('../miniprogram/utils/planning'),catalog=require('../miniprogram/utils/catalog-migration');
const clone=x=>JSON.parse(JSON.stringify(x)),tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({saved=[],role='cook'}={}){
 const storage=new Map(saved),calls=[],gates=[],failures=[];
 let notifications={enabled:true,canSubscribe:role==='cook',templates:require('../miniprogram/utils/config').notificationTemplates,preferences:{menu:'unset',review:'unset'},last:{}};
 const base={ok:true,familyId:'family-a',code:'code',role,members:2,revision:7,resetEpoch:0,state:catalog.migrate(model.initial())};
 global.wx={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,clone(value)),cloud:{callFunction:async({data:request})=>{
  calls.push(clone(request));if(gates.length)await gates.shift();if(failures.length)throw Error(failures.shift());
  if(request.action==='notificationPreferences')notifications={...notifications,preferences:{...notifications.preferences,...request.data.choices},last:{}};
  const result={...clone(base),notifications:clone(notifications)};if(request.action==='get'&&request.revision===base.revision){result.unchanged=true;delete result.state;}return {result};
 }}};
 delete global.getCurrentPages;const path=require.resolve('../miniprogram/utils/planning-service');delete require.cache[path];const service=require(path);
 return {service,storage,calls,base,ready:()=>service.sync(true),fail:()=>failures.push('network unavailable'),gate:()=>{let release;gates.push(new Promise(resolve=>release=resolve));return release;},update:value=>notifications=value};
}
test('大厨保存固定 kinds 的授权选择，不传业务版本、不锁页面，不伪造其它字段',async()=>{
 const x=fixture();await x.ready();await x.service.notificationPreferences({menu:'accept',review:'ban',touser:'someone-else'});
 assert.deepEqual(x.calls.at(-1),{action:'notificationPreferences',data:{choices:{menu:'accept',review:'ban'}}});
 assert.equal(x.service.info().revision,7);assert.equal(x.service.info().notifications.preferences.review,'ban');assert.equal(x.service.notificationPreferenceStatus().pending,false);
});
test('云端数据未变时也刷新并持久化提醒发送状态',async()=>{
 const x=fixture();await x.ready();const before=x.service.state();x.update({enabled:true,canSubscribe:true,preferences:{menu:'accept',review:'unset'},last:{menu:{status:'needsAuthorization',at:123,text:'重新订阅'}}});await x.service.sync(true);
 assert.equal(x.service.state(),before);assert.equal(x.service.info().notifications.last.menu.status,'needsAuthorization');assert.equal(x.storage.get('rabbit-meals-cloud-cache').notifications.last.menu.status,'needsAuthorization');
});
test('保存设置断网保留本次选择，重启后能直接重试而无需重新授权',async()=>{
 const x=fixture();await x.ready();x.fail();await assert.rejects(x.service.notificationPreferences({menu:'accept',review:'reject'}),/连不上/);
 assert.deepEqual(x.service.notificationPreferenceStatus(),{pending:true,choices:{menu:'accept',review:'reject'}});
 const y=fixture({saved:x.storage});await y.ready();const pending=y.service.notificationPreferenceStatus();assert.equal(pending.pending,true);await y.service.notificationPreferences(pending.choices);
 assert.equal(y.service.notificationPreferenceStatus().pending,false);assert.equal(y.storage.get(y.service.NOTIFICATION_KEY),null);
});
test('提醒设置和其它共享请求串行，失败不影响后续读取',async()=>{
 const x=fixture();await x.ready();const release=x.gate();x.fail();const failing=x.service.notificationPreferences({menu:'accept'});const rejection=assert.rejects(failing);await tick();const read=x.service.sync(true);await tick();assert.equal(x.calls.length,2);release();await rejection;await read;assert.equal(x.calls.length,3);
});
test('访客、未知授权值或空结果不写后端',async()=>{
 const x=fixture({role:'guest'});await x.ready();await assert.rejects(x.service.notificationPreferences({menu:'accept'}),/大厨本人/);assert.equal(x.calls.length,1);
 const y=fixture();await y.ready();await assert.rejects(y.service.notificationPreferences({menu:'permanent'}),/无效/);await assert.rejects(y.service.notificationPreferences({}),/有效/);assert.equal(y.calls.length,1);
});
test('前次饭桌的待保存选择不能套用到新的饭桌',async()=>{
 const x=fixture();await x.ready();x.fail();await assert.rejects(x.service.notificationPreferences({menu:'accept'}));x.base.familyId='family-b';await x.service.sync(true);assert.deepEqual(x.service.notificationPreferenceStatus(),{pending:false,choices:null});
});
