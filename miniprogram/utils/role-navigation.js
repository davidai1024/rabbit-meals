const items={menu:{page:'v3-menu',label:'点菜',icon:'plate'},week:{page:'v3-week',label:'已点',icon:'menu'},shopping:{page:'v3-shopping',label:'买菜',icon:'shop'},stats:{page:'v3-stats',label:'统计',icon:'stats'},home:{page:'v3-home',label:'菜品库',icon:'library'}};
function tabs(role){return (role==='cook'?['week','shopping','stats','home']:['menu','week','stats']).map(key=>key==='week'&&role==='cook'?{...items[key],label:'做饭'}:items[key]);}
function start(role){return role==='cook'?'v3-week':'v3-menu';}
function resolve(role,page){if(!role)return start(role);if(role==='cook'&&page==='v3-menu')return start(role);if(role!=='cook'&&['v3-home','v3-shopping','v3-recipe'].includes(page))return start(role);return page;}
module.exports={tabs,start,resolve};
