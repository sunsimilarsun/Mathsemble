'use strict';

module.exports=function createLibraryModal({Modal,Notice,service,getPlan}={}) {
  return class LibraryModal extends Modal {
    constructor(app){super(app);this.libraryEditor=true;this.closed=false;this.busy=false;this.batch=null;this.transfer=null;}
    el(tag,parent,text){const node=this.contentEl.ownerDocument.createElement(tag);if(text!==undefined)node.textContent=String(text);parent?.appendChild(node);return node;}
    button(parent,text,fn){const button=this.el('button',parent,text);button.type='button';button.onclick=()=>{if(!button.disabled&&!this.closed)void this.action(text,fn);};return button;}
    field(parent,label,tag='input'){const wrapper=this.el('label',parent);this.el('span',wrapper,label);const node=this.el(tag,wrapper);node.setAttribute('aria-label',label);return node;}
    message(text,error=false){if(this.closed)return;this.status.textContent=text;this.status.classList.toggle('is-error',error);}
    async action(label,fn){if(this.closed||this.busy)return;this.busy=true;this.controller=new AbortController();this.controls();this.message(label+'…');const controller=this.controller;
      try{return await fn({signal:controller.signal,isCurrent:()=>!this.closed&&this.controller===controller&&!controller.signal.aborted});}
      catch(error){this.message(error.message||String(error),error.name!=='AbortError');}
      finally{if(this.controller===controller)this.controller=null;this.busy=false;if(!this.closed)this.controls();}}
    controls(){for(const node of this.contentEl.querySelectorAll('input,select,button'))node.disabled=this.busy;if(this.commitButton)this.commitButton.disabled=this.busy||!this.batch||!this.confirm.checked||this.batch.status==='blocked'||this.batch.issues.some(row=>row.severity==='error');if(this.undoButton)this.undoButton.disabled=this.busy||!this.batch||!this.confirm.checked;}
    async onOpen(){this.modalEl.classList.add('mwb-library-modal');this.contentEl.classList.add('mwb-library');this.el('h2',this.contentEl,'题库诊断与待入库');
      this.el('p',this.contentEl,'先核对原件、问题与损耗报告，再确认创建新文件。不会自动合并重复题、改号或覆盖已有材料。');
      const nav=this.el('div',this.contentEl);this.panels={};for(const [id,label]of [['diagnose','集中诊断'],['batch','待入库批次'],['transfer','材料包']]){this.button(nav,label,async()=>this.show(id));const panel=this.el('section',this.contentEl);panel.dataset.libraryPanel=id;this.panels[id]=panel;}
      this.status=this.el('p',this.contentEl,'选择操作。');this.status.setAttribute('role','status');
      const diag=this.panels.diagnose;this.button(diag,'扫描当前题库',options=>this.scan(options));this.diagnosticList=this.el('div',diag);
      const batch=this.panels.batch;this.profile=this.field(batch,'输入 profile','select');for(const [value,label]of [['markdown','Markdown 与本地图片'],['mathsemble-question-json-v1','Mathsemble 结构化 JSON v1'],['mathsemble-transfer-v1','Mathsemble 材料包 v1']])this.el('option',this.profile,label).value=value;
      this.el('p',batch,'结构化 JSON v1：{schemaVersion:1,items:[{path,metadata,markdown}],assets?:[{path,base64,sha256?}]}。metadata 原样保留；未映射字段另列报告。未支持 Word／PDF／OCR／QTI。');
      this.inputFiles=this.field(batch,'选择待入库文件');this.inputFiles.type='file';this.inputFiles.multiple=true;
      this.targetRoot=this.field(batch,'源卡目标目录');this.targetRoot.value='导入题库';
      this.idMap=this.field(batch,'显式 ID 映射（JSON，可留空）','textarea');this.idMap.placeholder='{"冲突旧ID":"人工确认的新ID"}';
      this.button(batch,'保存为待入库批次',options=>this.stage(options));
      this.batchSelect=this.field(batch,'已暂存批次','select');this.button(batch,'刷新批次列表',()=>this.refresh());this.button(batch,'打开批次',options=>this.openBatch(this.batchSelect.value,options));
      this.batchSummary=this.el('div',batch);this.confirm=this.field(batch,'已核对问题与损耗，确认创建／撤销本批文件');this.confirm.type='checkbox';this.confirm.onchange=()=>this.controls();
      this.commitButton=this.button(batch,'确认入库',options=>this.commit(options));this.undoButton=this.button(batch,'撤销本批创建',options=>this.undo(options));
      const transfer=this.panels.transfer;this.el('p',transfer,'导出当前编排所引用源卡、本地图片与方案。含教师答案和隐藏资源，请作为教师私有材料保管。外链、未知依赖及历史旁车内部路径会明确报告；本格式不是 QTI。');
      this.sidecars=this.field(transfer,'另携带旁车路径（每行一个，可留空）','textarea');this.archives=this.field(transfer,'另携带归档目录（每行一个，可留空）','textarea');
      this.button(transfer,'封装当前编排',options=>this.pack(options));this.packageSummary=this.el('div',transfer);this.packageText=this.field(transfer,'材料包 JSON','textarea');this.packageText.rows=10;
      this.button(transfer,'下载材料包 JSON',()=>this.download());this.button(transfer,'将此材料包暂存待入库',options=>this.stagePackage(options));
      this.show('diagnose');await this.action('读取批次列表',()=>this.refresh());this.controls();}
    show(id){for(const [name,panel]of Object.entries(this.panels))panel.hidden=name!==id;}
    listIssues(parent,issues){const list=this.el('ul',parent);for(const row of issues){const item=this.el('li',list,(row.severity==='error'?'阻断：':'')+row.message+(row.path?' · '+row.path:''));if(row.path?.endsWith('.md'))this.button(item,'打开原文',()=>service.openSource(row.path));}return list;}
    async scan(options){const report=await service.diagnose(options);if(this.closed)return;this.diagnosticList.replaceChildren();this.el('p',this.diagnosticList,report.counts.items+' 份素材，'+report.issues.length+' 项诊断。疑似重复仅为人工核对候选。');this.listIssues(this.diagnosticList,report.issues);this.message('诊断完成，未修改源文。');}
    async refresh(){const batches=await service.listBatches();if(this.closed)return;const value=this.batchSelect.value;this.batchSelect.replaceChildren();this.el('option',this.batchSelect,'选择批次').value='';for(const batch of batches)this.el('option',this.batchSelect,batch.batchId+' · '+batch.status+' · '+batch.count+' 文件').value=batch.batchId;this.batchSelect.value=this.batch?.batchId||value;}
    async stage(options){if(!this.inputFiles.files.length)throw Error('先选择原件');if([...this.inputFiles.files].reduce((n,file)=>n+file.size,0)>(service.limits?.maxBytes||64*1024*1024)||this.inputFiles.files.length>(service.limits?.maxFiles||2000))throw Error('原件超过文件数量或 64 MiB 字节预算');const files=[];for(const file of this.inputFiles.files){if(!options.isCurrent())throw Object.assign(Error('操作已取消'),{name:'AbortError'});const bytes=new Uint8Array(await file.arrayBuffer());let raw='';for(let i=0;i<bytes.length;i+=32768)raw+=String.fromCharCode(...bytes.subarray(i,i+32768));files.push({path:file.webkitRelativePath||file.name,base64:btoa(raw)});}
      const batch=await service.stageImport({profile:this.profile.value,files,targetRoot:this.targetRoot.value,idMap:this.idMap.value.trim()?JSON.parse(this.idMap.value):{}},options);if(this.closed)return;await this.refresh();await this.openBatch(batch.batchId,options);this.message('原件与候选已暂存；尚未进入素材目录。');}
    async openBatch(id,options={}){if(!id)throw Error('先选择批次');const batch=await service.inspectBatch(id,options);if(this.closed)return;this.batch=batch;this.confirm.checked=false;this.show('batch');this.batchSummary.replaceChildren();this.el('h3',this.batchSummary,batch.batchId+' · '+batch.status);this.el('p',this.batchSummary,batch.originals.length+' 份原件，'+batch.files.length+' 个候选文件；原件摘要与候选摘要分别保存。');this.listIssues(this.batchSummary,batch.issues);
      const losses=this.el('details',this.batchSummary);this.el('summary',losses,'损耗、未知字段及映射报告（'+batch.lossReport.length+'）');for(const loss of batch.lossReport)this.el('p',losses,(loss.path||'')+' '+(loss.field||'')+'：'+loss.disposition);
      const files=this.el('details',this.batchSummary);this.el('summary',files,'候选路径与 ID／资源映射');for(const row of batch.files)this.el('p',files,row.path+' → '+row.targetPath);this.el('pre',files,JSON.stringify(batch.idMap,null,2));
      const log=this.el('details',this.batchSummary);this.el('summary',log,'提交与撤销日志');this.el('pre',log,JSON.stringify(batch.commitLog,null,2));this.controls();}
    async commit(options){if(!this.confirm.checked||!this.batch)throw Error('先核对并确认本批材料');const result=await service.commitBatch(this.batch.batchId,{...options,confirmed:true});if(this.closed)return;await this.openBatch(this.batch.batchId,options);this.message(result.status==='complete'?'本批入库完成；仅创建新文件。':'入库未完整完成，请查看冲突／日志；已创建文件保留。',result.status!=='complete');if(result.issues?.length)this.listIssues(this.batchSummary,result.issues);}
    async undo(options){if(!this.confirm.checked||!this.batch)throw Error('先核对并确认撤销');const result=await service.undoBatch(this.batch.batchId,{...options,confirmed:true});if(this.closed)return;await this.openBatch(this.batch.batchId,options);this.message(result.status==='complete'?'已撤销本批确认创建且内容未变的文件；原件与日志保留。':'部分文件无法撤销；已编辑或归属不明的材料未删除。',result.status!=='complete');if(result.issues?.length)this.listIssues(this.batchSummary,result.issues);}
    async pack(options){const plan=await getPlan?.();if(!plan)throw Error('先打开包含素材的编排方案');const lines=node=>node.value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);const result=await service.exportTransfer({plan,sidecarPaths:lines(this.sidecars),archivePaths:lines(this.archives)},options);if(this.closed)return;this.transfer=result.package;this.packageText.value=JSON.stringify(result.package);this.packageSummary.replaceChildren();this.el('p',this.packageSummary,result.package.files.length+' 个文件；'+(result.status==='complete'?'已捕获范围完整。':'存在未封装依赖或其他缺口，请核对。'));this.listIssues(this.packageSummary,result.issues);this.message('材料包已准备；未写入源文或正式素材目录。');}
    download(){if(!this.packageText.value)throw Error('先封装或粘贴材料包');const blob=new Blob([this.packageText.value],{type:'application/json'}),url=URL.createObjectURL(blob),link=this.el('a',this.contentEl,'');link.href=url;link.download='mathsemble-materials.json';link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    async stagePackage(options){const value=JSON.parse(this.packageText.value),batch=await service.stageTransfer(value,{...options,targetRoot:this.targetRoot.value,idMap:this.idMap.value.trim()?JSON.parse(this.idMap.value):{}});if(this.closed)return;await this.refresh();await this.openBatch(batch.batchId,options);this.message('材料包已校验并暂存，确认前不会创建正式材料。');}
    onClose(){this.closed=true;this.controller?.abort();this.controller=null;this.batch=null;this.transfer=null;this.contentEl.replaceChildren();}
  };
};
