'use strict';
// Editable application examples; quantities demonstrate the calculator, not a meal plan.
const version='open-source-demo-v1';
const ingredient=(name,qty,unit='克')=>({name,qty,unit,spec:''});
function recipe(id,name,kind,tasteTags,ingredients,method){return {
 id,name,kind,category:kind==='meat'?'荤菜':'素菜',meals:3,tasteTags,taste:tasteTags.join('、'),
 image:'/assets/demo-'+id+'.svg',imageSource:'demo',ingredients,method,
 hidden:false,catalogReady:true,purchaseVerified:false,catalogVersion:version,
 quantityNote:'用于演示数量汇总；请按自己的做法修改食材和制作量。'
};}
const recipes=[
 recipe('potato-chicken','土豆炖鸡','meat',['酱香'],[ingredient('鸡腿肉',450),ingredient('土豆',300),ingredient('生抽',20,'毫升'),ingredient('食用油',15,'毫升')],'鸡肉和土豆切块。先翻炒鸡肉，再加入土豆、调味料和适量水，炖至食材熟透。'),
 recipe('pepper-pork','青椒肉丝','meat',['鲜香'],[ingredient('猪肉',300),ingredient('青椒',300),ingredient('生抽',15,'毫升'),ingredient('食用油',15,'毫升')],'青椒和猪肉切丝。肉丝炒熟后加入青椒，翻炒并调味。'),
 recipe('braised-pork','家常红烧肉','meat',['酱香'],[ingredient('五花肉',450),ingredient('生抽',20,'毫升'),ingredient('白糖',10),ingredient('生姜',10)],'五花肉切块焯水。与姜片、调味料和适量水一起炖熟，最后收浓汤汁。'),
 recipe('mushroom-beef','蘑菇炒牛肉','meat',['鲜香'],[ingredient('牛肉',300),ingredient('鲜蘑菇',250),ingredient('大蒜',10),ingredient('生抽',15,'毫升')],'牛肉和蘑菇切片。分别炒熟后合在一起，加入蒜和调味料翻匀。'),
 recipe('tomato-egg','番茄炒蛋','veg',['酸甜'],[ingredient('番茄',450),ingredient('鸡蛋',3,'个'),ingredient('食用油',15,'毫升'),ingredient('盐',2)],'鸡蛋打散炒至凝固后盛出。炒软番茄，再倒回鸡蛋调味翻匀。'),
 recipe('broccoli','清炒西兰花','veg',['蒜香'],[ingredient('西兰花',500),ingredient('大蒜',15),ingredient('食用油',10,'毫升'),ingredient('盐',2)],'西兰花切小朵洗净并焯水。蒜末炒香后加入西兰花，炒熟并调味。'),
 recipe('cucumber','蒜香黄瓜','veg',['清爽'],[ingredient('黄瓜',450),ingredient('大蒜',10),ingredient('米醋',15,'毫升'),ingredient('生抽',10,'毫升')],'黄瓜洗净切块，拌入蒜末和调味料。可按自己的习惯调整口味。'),
 recipe('green-beans','蒜香四季豆','veg',['蒜香'],[ingredient('四季豆',500),ingredient('大蒜',15),ingredient('食用油',15,'毫升'),ingredient('盐',2)],'四季豆去筋切段。蒜末炒香后加入四季豆，加少量水焖至完全熟透，再调味。')
];
module.exports={version,recipes};
