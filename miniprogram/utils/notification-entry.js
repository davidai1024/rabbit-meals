let pending='';
function key(value){
 if(typeof value!=='string'||value.length>60)return '';
 try{value=decodeURIComponent(value);}catch(e){return '';}
 if(!/^(next|weekend):\d{4}-\d{2}-\d{2}$/.test(value))return '';
 const date=value.split(':')[1],parsed=new Date(date+'T12:00:00');
 if(!Number.isFinite(parsed.getTime()))return '';
 const actual=parsed.getFullYear()+'-'+String(parsed.getMonth()+1).padStart(2,'0')+'-'+String(parsed.getDate()).padStart(2,'0');
 return actual===date?value:'';
}
function receive(options={}){
 pending=options.path==='pages/v3-history/index'?key(options.query&&options.query.key):'';
}
function take(){const value=pending;pending='';return value;}
module.exports={key,receive,take};
