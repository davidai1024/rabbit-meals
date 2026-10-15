const d=require('./domain'),config=require('./config');
let cache=null;
const DEMO='family-menu-demo-v1';
function isDemo(){return wx.getStorageSync('family-menu-mode')==='demo';}
function demo(){let s=wx.getStorageSync(DEMO);if(!s){s=d.seed();s.members=[{id:'cook',name:'做饭的人',role:'cook',appetite:1},{id:'guest',name:'点菜的人',role:'guest',appetite:1}];wx.setStorageSync(DEMO,s);}const defaults=d.seed().recipes;for(const r of defaults){const existing=s.recipes.find(x=>x.id===r.id);if(!existing)s.recipes.push(r);else{existing.kind=existing.kind||r.kind;if(['家常','蔬菜','凉菜'].includes(existing.category))existing.category=r.category;existing.taste=existing.taste||r.taste;}}wx.setStorageSync(DEMO,s);return s;}
async function call(action='get',data={}){
 if(isDemo()) {const uid=wx.getStorageSync('demo-role')||'guest';let s=demo();if(!['get','create','join'].includes(action)){s=d.apply(s,uid,action,data);if(action==='submit')s.plans[data.week].notification='本机演示，不发送微信通知';wx.setStorageSync(DEMO,s);}cache={state:s,uid,role:uid==='cook'?'cook':'guest',demo:true,unbound:false};return cache;}
 if(!config.env||!wx.cloud)throw Error('尚未配置云环境：可先到“我们”开启本机演示');
 const r=await wx.cloud.callFunction({name:'family',data:{action,...(['create','join'].includes(action)?data:{data})}});if(!r.result||!r.result.ok)throw Error(r.result&&r.result.error||'云端操作失败，请重试');cache=r.result;return cache;
}
function setMode(mode){wx.setStorageSync('family-menu-mode',mode);cache=null;}
function setRole(role){wx.setStorageSync('demo-role',role);cache=null;}
function draftKey(week){return `draft:${isDemo()?'demo':cache&&cache.familyId||'cloud'}:${cache&&cache.uid||''}:${week}`;}
function draft(week){return wx.getStorageSync(draftKey(week))||null;}
function saveDraft(week,v){wx.setStorageSync(draftKey(week),v);}
function clearDraft(week){wx.removeStorageSync(draftKey(week));}
function display(r){return r.displayImage||r.image||r.localImage||config.images[r.id]||'';}
async function upload(){if(isDemo()){const r=await wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album','camera']});const saved=await wx.saveFile({tempFilePath:r.tempFiles[0].tempFilePath});return saved.savedFilePath;}const r=await wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album','camera'],sizeType:['compressed']});let filePath=r.tempFiles[0].tempFilePath;const compressed=await wx.compressImage({src:filePath,quality:60});filePath=compressed.tempFilePath;const file=wx.getFileSystemManager().readFileSync(filePath,'base64');if(file.length>700000)throw Error('照片仍较大，请选择较小照片（压缩后小于500KB）');const out=await wx.cloud.callFunction({name:config.env?'planningFamily':'family',data:{action:'uploadImage',data:{base64:file}}});if(!out.result.ok)throw Error(out.result.error);return out.result.fileID;}
async function subscribe(){if(isDemo())throw Error('本机演示不会发送微信通知');if(!config.templateId)throw Error('请先在配置中填写订阅模板ID');return wx.requestSubscribeMessage({tmplIds:[config.templateId]});}
function error(e){wx.showToast({title:e.message||'操作失败，请重试',icon:'none',duration:3500});}
async function run(page,fn){if(page.data.busy)return;page.setData({busy:true,error:''});try{await fn();}catch(e){page.setData({error:e.message||'操作失败'});error(e);}finally{page.setData({busy:false});}}
module.exports={call,isDemo,setMode,setRole,draft,saveDraft,clearDraft,display,upload,subscribe,error,run,peek:()=>cache};
