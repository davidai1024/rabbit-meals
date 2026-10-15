'use strict';

// Model CloudBase's update semantics used by these fixtures: plain nested
// objects merge recursively, while arrays/scalars and command.set replace.
// The marker stays cloneable so transaction snapshots can use structuredClone.
const marker='__cloud_update_command__';
const command={set:value=>({[marker]:'set',value:structuredClone(value)})};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
 (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);

function applyUpdate(target,data){
 for(const [key,value] of Object.entries(data)){
  if(plain(value)&&value[marker]==='set')target[key]=structuredClone(value.value);
  else if(plain(value)){
   if(!plain(target[key]))target[key]={};
   applyUpdate(target[key],value);
  }else target[key]=structuredClone(value);
 }
 return target;
}

module.exports={command,applyUpdate};
