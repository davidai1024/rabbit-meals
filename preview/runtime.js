const modules={},templates={},partials={},definitions={};let current=null,currentName='menu',timer,navigationEpoch=0,renderQueued=false;
const utilityModules=['domain','config','service','menu-lifecycle','planning','recipe-catalog','catalog-migration','role-navigation','notification-entry','planning-service','menu-actions','ordered-feed','history-page','ordering-pages','swipe-menu','tips','planning-pages'];
const styleFiles=['app.wxss','theme-v5.wxss','theme-v6.wxss','theme-v9.wxss','swipe-theme.wxss','order-views.wxss','compact-ui.wxss','product-polish.wxss','page-loading.wxss'];
function toast(title,duration=2000){const e=document.querySelector('#toast');e.textContent=title;e.hidden=false;clearTimeout(timer);timer=setTimeout(()=>e.hidden=true,duration);}
function stored(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null;}}
window.wx={hideToast:()=>{clearTimeout(timer);document.querySelector('#toast').hidden=true;},getStorageSync:stored,setStorageSync:(k,v)=>localStorage.setItem(k,JSON.stringify(v)),removeStorageSync:k=>localStorage.removeItem(k),showToast:o=>toast(o.title,o.duration||2000),stopPullDownRefresh:()=>{},switchTab:o=>navigate(o.url.split('/')[2]),navigateTo:o=>{const url=new URL(o.url,'https://local');navigate(url.pathname.split('/')[2],Object.fromEntries(url.searchParams));},navigateBack:()=>navigate('v3-home'),showModal:o=>o.success({confirm:confirm(o.title+'\n'+o.content)}),setClipboardData:o=>{navigator.clipboard.writeText(o.data).then(()=>toast('已复制，可到朴朴搜索')).catch(()=>toast('复制失败，请手动复制食材名称和数量'));},chooseMedia:()=>new Promise((resolve,reject)=>{const i=document.createElement('input');i.type='file';i.accept='image/*';i.onchange=()=>{const f=i.files[0];if(!f){reject(Error('已取消选择照片'));return;}const reader=new FileReader();reader.onload=()=>resolve({tempFiles:[{tempFilePath:reader.result,size:f.size}]});reader.readAsDataURL(f);};i.addEventListener('cancel',()=>reject(Error('已取消选择照片')));i.click();}),saveFile:async o=>({savedFilePath:o.tempFilePath})};
window.Page=p=>definitions[currentName]=p;
function loadModule(url,source){const mod={exports:{}};const require=rel=>{const target=new URL(rel+'.js',new URL(url,location.href)).pathname;if(!Object.prototype.hasOwnProperty.call(modules,target))throw Error('预览模块尚未加载：'+rel);return modules[target];};new Function('require','module','exports',source)(require,mod,mod.exports);modules[new URL(url,location.href).pathname]=mod.exports;}
function assetURL(value){return value.startsWith('/assets/')?'../miniprogram'+value:value;}
function prepareWxml(source){
 return source.replace(/<page-meta\b[^>]*\/>/g,'').replace(/<import\b[^>]*\/>/g,'').replace(/<template\b([^>]*?)\/>/g,(_,attributes)=>{
  const name=attributes.match(/\bis="([^"]+)"/)?.[1],body=partials[name];if(!body)throw Error('预览模板尚未加载：'+name);
  const data=attributes.match(/\bdata="([^"]*)"/)?.[1]||'{{}}',forwarded=attributes.replace(/\b(?:is|data)="[^"]*"/g,'');
  return '<block '+forwarded+' data-preview-scope="'+data+'">'+body+'</block>';
 }).replace(/<(textarea|image|input)([^>]*?)\s*\/>/g,'<$1$2></$1>');
}
function previewStyles(source){return source.replace(/@import[^;]+;/g,'').replace(/(^|[}\s])page\s*\{/g,'$1:root,#phone{').replace(/(^|[{},>\s])(image|view)(?=[.#:\s,{>])/g,(_,before,tag)=>before+(tag==='image'?'img':'div')).replace(/(\d+(?:\.\d+)?)rpx/g,(_,n)=>(Number(n)/2)+'px');}
function value(expr,scope){try{return new Function('s','with(s){return ('+expr+')}')(scope)}catch(e){return '';}}
function interpolate(str,scope){return str.replace(/{{([\s\S]*?)}}/g,(_,expr)=>{const v=value(expr,scope);return Array.isArray(v)?v.join('、'):v==null?'':String(v);});}
function renderNode(node,scope,parent){if(node.nodeType===3){parent.append(document.createTextNode(interpolate(node.textContent,scope)));return;}if(node.nodeType!==1)return;
 const each=node.getAttribute('wx:for');if(each){const list=value(each.replace(/^{{|}}$/g,''),scope)||[];for(let index=0;index<list.length;index++){const copy=node.cloneNode(true);copy.removeAttribute('wx:for');renderNode(copy,{...scope,[node.getAttribute('wx:for-item')||'item']:list[index],index},parent);}return;}
 const cond=node.getAttribute('wx:if');if(cond&&!value(cond.replace(/^{{|}}$/g,''),scope))return;
 if(node.hasAttribute('wx:else')){const previous=node.previousElementSibling;if(previous&&value((previous.getAttribute('wx:if')||'').replace(/^{{|}}$/g,''),scope))return;}
 const tag=node.tagName.toLowerCase();if(tag==='page-meta'||tag==='import')return;if(tag==='block'){const data=node.getAttribute('data-preview-scope'),nested=data?{...scope,...value('({'+data.replace(/^{{|}}$/g,'')+'})',scope)}:scope;for(const child of node.childNodes)renderNode(child,nested,parent);return;}
 const el=document.createElement((tag==='view'||tag==='scroll-view')?'div':tag==='text'?'span':tag==='image'?'img':tag==='picker'?'div':tag);const dataset={};
 for(const attr of node.attributes){const name=attr.name,val=interpolate(attr.value,scope);if(name.startsWith('data-'))dataset[name.slice(5)]=val;if(name.startsWith('wx:')||name.startsWith('bind')||name.startsWith('catch')||name==='hover-class'||name==='auto-height')continue;if(name==='disabled'){el.disabled=!!value(attr.value.replace(/^{{|}}$/g,''),scope);continue;}if(name==='loading')continue;if(name==='mode')continue;if(name==='src'){el.src=assetURL(val);continue;}if(name==='value'){el.value=val;continue;}if(name==='type'&&val==='digit'){el.type='number';el.step='any';continue;}el.setAttribute(name,val);}
 if(tag==='image'){el.alt=el.getAttribute('aria-label')||'';el.loading='lazy';}
 const eventName=node.getAttribute('catchtap')||node.getAttribute('bindtap')||node.getAttribute('bindinput')||node.getAttribute('bindchange');if(eventName)el.dataset.uiKey=eventName+JSON.stringify(dataset);if(tag==='picker'){const range=node.getAttribute('range');const input=document.createElement(range?'select':'input');if(range){const values=value(range.replace(/^{{|}}$/g,''),scope);values.forEach((v,i)=>{const opt=document.createElement('option');opt.value=i;opt.textContent=v;input.append(opt);});input.value=interpolate(node.getAttribute('value')||'0',scope);}else{input.type='date';input.value=interpolate(node.getAttribute('value')||'',scope);}input.dataset.uiKey=eventName+JSON.stringify(dataset);input.addEventListener('change',e=>invoke(eventName,dataset,e.target.value));el.append(input);parent.append(el);return;}
 if(eventName){const type=node.hasAttribute('bindinput')?'input':node.hasAttribute('bindchange')?'change':'click';el.addEventListener(type,e=>{if(node.hasAttribute('catchtap'))e.stopPropagation();if(el.disabled||e.isComposing||eventName==='keepPanel')return;invoke(eventName,dataset,e.target.value,type==='input');});if(type==='input')el.addEventListener('compositionend',e=>invoke(eventName,dataset,e.target.value,true));}
 for(const child of node.childNodes)renderNode(child,scope,el);parent.append(el);
}
async function invoke(method,dataset,value,typing=false){
 const owner=current,epoch=navigationEpoch;
 const photo=['favorite','open'].includes(method)?document.querySelector('#dish-'+dataset.id+' img'):null;
 const target=method==='open'?document.querySelector('.basket-symbol'):document.getElementById('rail-收藏'),from=photo?.getBoundingClientRect(),to=target?.getBoundingClientRect();
 const src=photo?.src,was=owner.data.filtered?.find(x=>x.id===dataset.id);
 try{await owner[method]({currentTarget:{dataset},detail:{value}});}catch(e){toast(e.message);}
 if(owner!==current||epoch!==navigationEpoch)return;
 render();
 const added=method==='open'&&!was?.selected&&owner.data.plan.lines.some(l=>l.id===dataset.id)&&!owner.data.error;
 if(from&&to&&was&&(method==='favorite'&&!was.favorite||added)&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
  const img=document.createElement('img');img.className='flight-to-basket';img.src=src;Object.assign(img.style,{position:'fixed',left:from.left+'px',top:from.top+'px',width:from.width+'px',height:from.height+'px',borderRadius:'14px',zIndex:200,pointerEvents:'none'});document.body.append(img);
  img.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${to.left-from.left}px,${to.top-from.top}px) scale(.12)`,opacity:0}],{duration:360,easing:'ease-in'}).onfinish=()=>img.remove();
 }
}
function render(){
 const saved=window.previewUI?.capture()||{},screen=document.querySelector('#screen'),t=document.createElement('template');
 t.innerHTML=prepareWxml(templates[currentName]);
 const fragment=document.createDocumentFragment();for(const n of t.content.childNodes)renderNode(n,current.data,fragment);
 screen.replaceChildren(fragment);screen.dataset.page=currentName;
 document.querySelectorAll('nav button').forEach(e=>e.classList.toggle('active',e.dataset.page===currentName));
 document.querySelector('#back').hidden=['v3-menu','v3-week','v3-shopping','v3-stats','v3-home','v3-history'].includes(currentName);
 window.previewUI?.sync(saved);const rules=modules[new URL('../miniprogram/utils/role-navigation.js',location.href).pathname];document.dispatchEvent(new CustomEvent('preview-rendered',{detail:{role:current.data.role,page:currentName,items:rules.tabs(current.data.role)}}));
}
async function navigate(name,options={}){
 const rules=modules[new URL('../miniprogram/utils/role-navigation.js',location.href).pathname];if(rules)name=rules.resolve(wx.getStorageSync('rabbit-meals-role'),name);if(!definitions[name])return;
 if(current?.onHide)current.onHide();const epoch=++navigationEpoch,def=definitions[name];
 const page={...def,route:'pages/'+name+'/index',data:JSON.parse(JSON.stringify(def.data)),setData(v){Object.assign(this.data,v);if(this===current&&window.currentPage===this&&!renderQueued){renderQueued=true;queueMicrotask(()=>{renderQueued=false;if(this===current)render();});}}};
 currentName=name;current=page;
 if(def.onLoad)await page.onLoad(options);if(def.onShow)await page.onShow();
 if(page.data.busy){for(let i=0;i<100&&page.data.busy;i++)await new Promise(r=>setTimeout(r,20));}
 if(epoch!==navigationEpoch)return;
 window.currentPage=page;render();document.querySelector('#screen').scrollTop=0;const list=document.querySelector('.dish-scroll');if(list)list.scrollTop=0;
}
async function readPreviewSource(url){const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('预览文件加载失败：'+url);return response.text();}
async function init(){
 const saved=sessionStorage.getItem('rabbit-qa-backup');if(saved){const backup=JSON.parse(saved);for(const [field,key] of Object.entries({data:'rabbit-meals-local-v3',role:'rabbit-meals-role',type:'rabbit-meals-type',offset:'rabbit-meals-offset'})){if(backup[field]==null)localStorage.removeItem(key);else localStorage.setItem(key,backup[field]);}sessionStorage.removeItem('rabbit-qa-backup');}
 const base='../miniprogram/';
 const styles=await Promise.all(styleFiles.map(name=>readPreviewSource(base+name)));
 document.querySelector('#nativeStyles').textContent=previewStyles(styles.join('\n'));
 const loading=await readPreviewSource(base+'templates/page-loading.wxml');
 partials['page-loading']=loading.match(/<template\b[^>]*>([\s\S]*)<\/template>/)?.[1];
 for(const name of utilityModules){const url=base+'utils/'+name+'.js';loadModule(url,await readPreviewSource(url));}
 for(const name of ['menu','week','shopping','stats','home','recipe','history']){currentName='v3-'+name;const url=base+'pages/v3-'+name+'/index.js';loadModule(url,await readPreviewSource(url));templates[currentName]=await readPreviewSource(base+'pages/v3-'+name+'/index.wxml');}
 modules[new URL(base+'utils/service.js',location.href).pathname].setMode('demo');document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{if(b.dataset.page!==currentName)navigate(b.dataset.page);});document.querySelector('#back').onclick=()=>navigate(currentName==='v3-recipe'?'v3-home':'v3-week');await navigate(wx.getStorageSync('rabbit-meals-role')==='cook'?'v3-week':'v3-menu');window.previewReady=true;
}window.navigatePreview=navigate;window.renderPreview=render;init().catch(e=>{document.querySelector('#screen').textContent=e.stack;});
