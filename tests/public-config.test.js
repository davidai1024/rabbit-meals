'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('公开默认离线、占位AppID、禁用清空工具和未绑定任何个人模板',{skip:process.env.PUBLIC_RELEASE_CHECK!=='1'},()=>{
 const project=require('../project.config.json'),config=require('../miniprogram/utils/config'),tools=require('../cloudfunctions/planningFamily/test-tools');
 a.equal(project.appid,'touristappid');a.equal(config.env,'');a.equal(config.testToolsEnabled,false);a.equal(tools.enabled,false);a.equal(config.templateId,'');a.ok(config.notificationTemplates.every(x=>x.id===''));
});
test('未填写云函数模板时不创建通知集合、不claim、不发送，菜单事件仍可正常生成',async()=>{
 const file=path.join(__dirname,'../cloudfunctions/planningFamily/notifications.js'),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,require:name=>name.startsWith('.')?require(path.join(path.dirname(file),name)):require(name),process:{env:{}},Date,setTimeout,clearTimeout});
 const n=module.exports;let touches=0;const cloud={database:()=>({createCollection:()=>{touches++;},runTransaction:()=>{touches++;}}),openapi:{subscribeMessage:{send:()=>{touches++;}}}};
 const notifications=n.createNotifications(cloud),meta=notifications.metadata({role:'cook'});a.equal(meta.enabled,false);a.equal(meta.canSubscribe,false);a.equal(meta.templates.length,0);a.ok(n.templates.every(x=>x.id===''));
 for(const kind of ['menu','review']){const event={kind,key:'next:2026-10-19'};a.equal(await notifications.claim('f','guest',event),null);await notifications.deliver('f','guest',event);await notifications.dispatch({kind,target:'cook'});}
 a.equal(touches,0);
});
