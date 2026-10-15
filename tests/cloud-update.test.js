'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {command,applyUpdate}=require('./helpers/cloud-update');

test('云数据库模拟遵循嵌套对象递归合并：空对象不能清掉旧菜单',()=>{
 const document={revision:1,state:{plans:{old:{status:'submitted',draftLines:[{id:'r'}]}},records:[{id:'review'}],favorites:{guest:['r'],cook:['other']}}};
 applyUpdate(document,{revision:2,state:{plans:{},records:[],favorites:{guest:[]}}});
 assert.equal(document.revision,2);
 assert.deepEqual(document.state.plans,{old:{status:'submitted',draftLines:[{id:'r'}]}});
 assert.deepEqual(document.state.records,[]);
 assert.deepEqual(document.state.favorites,{guest:[],cook:['other']});
});

test('云数据库模拟 command.set 完整替换并隔离写入值，普通元数据保持不变',()=>{
 const document={code:'shared',revision:1,state:{plans:{old:{status:'submitted'}},records:[{id:'old'}]},backup:{state:{plans:{old:{}}},at:1}};
 const next={plans:{},records:[]},data={state:command.set(next),backup:command.set({state:next,at:2}),revision:2};
 next.plans.later={status:'draft'};
 applyUpdate(document,structuredClone(data));
 assert.deepEqual(document,{code:'shared',revision:2,state:{plans:{},records:[]},backup:{state:{plans:{},records:[]},at:2}});
 data.state.value.plans.after={status:'draft'};
 assert.deepEqual(document.state.plans,{});
 applyUpdate(document,{backup:null});assert.equal(document.backup,null);
});
