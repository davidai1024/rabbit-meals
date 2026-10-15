const test=require('node:test'),assert=require('node:assert/strict');
const tips=require('../miniprogram/utils/tips');
test('页面加载保留业务状态但不向界面传输完整数据库',()=>{
 const fs=require('node:fs');const source=fs.readFileSync('miniprogram/utils/planning-pages.js','utf8');
 assert.match(source,/this\.state=state/);assert.doesNotMatch(source,/this\.setData\(\{state,/);
});
