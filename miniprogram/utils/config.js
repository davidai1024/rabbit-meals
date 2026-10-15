// Empty env runs the local demo. Use your own AppID and cloud environment for sharing.
// For notifications, also set MENU_TEMPLATE_ID / REVIEW_TEMPLATE_ID on planningFamily.
module.exports={
 testToolsEnabled:false,env:'',templateId:'',
 notificationTemplates:[{kind:'menu',id:'',title:'菜单提交提醒'},{kind:'review',id:'',title:'新点评提醒'}],
 images:{'tomato-egg':'/assets/demo-tomato-egg.svg',broccoli:'/assets/demo-broccoli.svg','potato-chicken':'/assets/demo-potato-chicken.svg',cucumber:'/assets/demo-cucumber.svg','pepper-pork':'/assets/demo-pepper-pork.svg','braised-pork':'/assets/demo-braised-pork.svg'}
};
