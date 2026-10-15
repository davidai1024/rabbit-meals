// Fake settings are explicit in cloud tests; the shipped demo remains offline.
const config=require('../../miniprogram/utils/config');
config.env='test-env';
config.notificationTemplates=[{kind:'menu',id:'test-menu-template',title:'菜单提交提醒'},{kind:'review',id:'test-review-template',title:'新点评提醒'}];
process.env.MENU_TEMPLATE_ID='test-menu-template';
process.env.REVIEW_TEMPLATE_ID='test-review-template';
