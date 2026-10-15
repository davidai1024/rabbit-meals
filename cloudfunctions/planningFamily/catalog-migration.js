'use strict';
const catalog=require('./recipe-catalog');
const clone=x=>JSON.parse(JSON.stringify(x));
const oldIds=['tomato-egg','broccoli','potato-chicken','cucumber','pepper-pork','braised-pork'];
function migrate(input){
 if(input.catalogVersion===catalog.version)return input;
 const s=clone(input),before=clone(s.recipes),incoming=new Set(catalog.recipes.map(r=>r.id));
 // Freeze any old plan that still resolves recipes dynamically before changing defaults.
 for(const p of [...Object.values(s.plans||{}),...Object.values(s.legacy||{})])if(!p.recipes)p.recipes=clone(before.filter(r=>(p.lines||[]).some(l=>l.id===r.id)));
 s.catalogArchive=s.catalogArchive||[];
 for(const r of before)if(oldIds.includes(r.id)&&!s.catalogArchive.some(x=>x.id===r.id))s.catalogArchive.push(clone(r));
 const retained=before.filter(r=>!incoming.has(r.id)).map(r=>oldIds.includes(r.id)?{...r,hidden:true,archived:true}:r);
 s.recipes=[...clone(catalog.recipes),...retained];s.catalogVersion=catalog.version;
 return s;
}
module.exports={migrate,version:catalog.version};
