import { createAdminJob,cancelAdminJob } from '../jobs';
import { fields, type AdminBusinessAction } from './core';
export const ADMIN_JOB_ACTIONS:AdminBusinessAction[]=[
 {name:'jobs.cancel',label:'取消待办或已核实的不确定作业',resource:'large-objects',capability:'data.maintenance',fields:fields([['id','作业编号','text'],['expectedUpdatedAt','作业更新时间','text']]),execute:cancelAdminJob},
 {name:'jobs.export',label:'创建私有导出',resource:'generations',capability:'exports.read',fields:fields([['target','类型（data-cards / generations）','text'],['ids','记录编号数组（最多 100 条）','json']]),execute:(db,input,context)=>createAdminJob(db,{...(input as object),kind:'export'},context)},
 {name:'jobs.cleanup',label:'提交已预览清理',resource:'large-objects',capability:'data.maintenance',fields:fields([['target','清理目标','text'],['ids','预览中的编号数组','json'],['previewVersion','预览版本','text']]),execute:(db,input,context)=>createAdminJob(db,{...(input as object),kind:'cleanup'},context)},
 {name:'jobs.restore',label:'恢复清理作业',resource:'large-objects',capability:'data.maintenance',fields:fields([['sourceJobId','已清理作业编号','text']]),execute:(db,input,context)=>createAdminJob(db,{...(input as object),kind:'restore'},context)},
];
