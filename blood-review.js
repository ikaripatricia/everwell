/* Browser workflow. The database, not this UI, enforces the doctor approval boundary. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),api=window.EverwellClinicalAPI;
  const catalogue={ferritin:['Ferritin',['ug/L']],vitamin_d:['Vitamin D',['nmol/L']],hba1c:['HbA1c',['%','mmol/mol']],haemoglobin:['Haemoglobin',['g/L']],ldl:['LDL cholesterol',['mmol/L']],tsh:['TSH',['mIU/L']]};
  let epoch=0,doctor=false,reports=[],busy=false,currentSubmission=null;
  const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);if(cls)el.className=cls;return el};
  const labelStatus={received:'Received',processing:'Preparing draft',needs_review:'Awaiting doctor review',approved:'Doctor approved',rejected:'Doctor requested correction',failed:'Analysis failed — no report released'};
  const message=(id,text,error=false)=>{$(id).textContent=text;$(id).classList.toggle('blood-error',error)};
  const explainError=e=>e.status===401?'Sign in again to continue.':e.status===403?'A verified assigned doctor and the required permissions must be in place.':e.status===409?'This report is already processing or has changed. Refresh before continuing.':e.status===503?'AI analysis is not enabled in this test environment yet.':'The request could not be completed. Refresh to check its status before retrying. No unapproved report has been released.';
  const button=(text,action)=>{const b=node('button',text,'secondary');b.type='button';b.addEventListener('click',action);return b};
  function rowInput(data={}) {
    const tr=node('tr');const marker=document.createElement('select');marker.setAttribute('aria-label','Marker');
    Object.entries(catalogue).forEach(([code,[name]])=>{const o=node('option',name);o.value=code;marker.append(o)});marker.value=data.code||'ferritin';
    const unit=document.createElement('select');unit.setAttribute('aria-label','Unit');
    const units=()=>{unit.replaceChildren();catalogue[marker.value][1].forEach(u=>{const o=node('option',u);o.value=u;unit.append(o)})};units();if(data.unit)unit.value=data.unit;marker.addEventListener('change',units);
    const field=(type,name,value,required=false)=>{const i=document.createElement('input');i.type=type;i.setAttribute('aria-label',name);i.required=required;if(type==='number'){i.step='any';i.min='0';i.max='1000000000'}i.value=value??'';return i};
    const date=field('date','Collection date',data.collected_on,true),value=field('number','Result value',data.value,true),low=field('number','Reference low',data.reference_low),high=field('number','Reference high',data.reference_high);
    for(const el of [marker,unit,date,value,low,high,button('Remove',()=>tr.remove())]){const td=node('td');td.append(el);tr.append(td)}
    tr.read=()=>({code:marker.value,unit:unit.value,collected_on:date.value,value:Number(value.value),reference_low:low.value===''?null:Number(low.value),reference_high:high.value===''?null:Number(high.value)});
    $('blood-inputs').append(tr);
  }
  $('blood-add-row').onclick=()=>{if($('blood-inputs').children.length<100)rowInput()};
  $('blood-example').onclick=()=>{
    $('blood-inputs').replaceChildren();
    [{code:'ferritin',unit:'ug/L',collected_on:'2026-03-01',value:17,reference_low:30,reference_high:150},{code:'ferritin',unit:'ug/L',collected_on:'2026-09-01',value:18,reference_low:30,reference_high:150},{code:'hba1c',unit:'%',collected_on:'2026-09-01',value:5.4,reference_low:4,reference_high:5.6}].forEach(rowInput);
  };
  rowInput();
  function measurementsTable(rows) {
    const wrap=node('div',undefined,'blood-scroll'),table=node('table',undefined,'ew-table');
    const head=node('tr');['Marker','Collected','Value','Lab interval'].forEach(t=>head.append(node('th',t)));const th=node('thead');th.append(head);table.append(th);
    const body=node('tbody');
    rows.forEach(r=>{const tr=node('tr');[catalogue[r.code]?.[0]||r.code,r.collected_on,r.value+' '+r.unit,r.reference_low===null?'Not supplied':r.reference_low+'–'+r.reference_high+' '+r.unit].forEach(t=>tr.append(node('td',t)));body.append(tr)});table.append(body);wrap.append(table);return wrap;
  }
  function graphViews(groups) {
    const container=node('div');
    for(const g of groups||[]) {
      if(!Array.isArray(g.points)||!g.points.length||g.points.some(p=>!Number.isFinite(p.value)))continue;
      const block=node('div',undefined,'blood-graph');block.append(node('h3',g.label+' ('+g.unit+')'));
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 620 210');svg.setAttribute('role','img');svg.setAttribute('aria-label',g.points.map(p=>p.date+': '+p.value+' '+g.unit).join('; '));
      let min=Math.min(...g.points.map(p=>p.value)),max=Math.max(...g.points.map(p=>p.value));const pad=Math.max((max-min)*.15,Math.abs(max)*.05,.1);min-=pad;max+=pad;
      const earliest=Date.parse(g.points[0].date),latest=Date.parse(g.points.at(-1).date);
      const pts=g.points.map(p=>({x:latest===earliest?310:40+(Date.parse(p.date)-earliest)/(latest-earliest)*540,y:160-(p.value-min)/(max-min)*130,p}));
      const shape=(tag,attrs)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));svg.append(n);return n};
      shape('path',{d:pts.map((p,i)=>(i?'L':'M')+p.x+','+p.y).join(' '),fill:'none',stroke:'#426a52','stroke-width':3});
      pts.forEach(({x,y,p})=>{shape('circle',{cx:x,cy:y,r:5,fill:'#426a52'});shape('text',{x,y:y-12,'text-anchor':'middle','font-size':12}).textContent=p.value;shape('text',{x,y:190,'text-anchor':'middle','font-size':10}).textContent=p.date});
      block.append(svg,node('p','Actual collection-date spacing; values are not converted across units. Vertical scale fits this series, not a clinical target.','small'));
      block.append(measurementsTable(g.points.map(p=>({code:g.code,collected_on:p.date,value:p.value,unit:g.unit,reference_low:p.low,reference_high:p.high}))));container.append(block);
    }
    return container;
  }
  async function loadPatient() {
    const generation=epoch,user=api?.user();if(!user)return;
    message('blood-message','Loading your reports…');
    try {
      const [data,releases]=await Promise.all([
        api.read('lab_reports?patient_id=eq.'+user.id+'&select=id,status,submitted_at,review_note,attempt&order=submitted_at.desc&limit=100'),
        api.read('blood_analysis_releases?patient_id=eq.'+user.id+'&select=report_id,summary,graph_data,reviewer_name,approved_at')
      ]);
      if(generation!==epoch)return;reports=data;$('blood-report-list').replaceChildren();
      for(const r of reports){const article=node('article',undefined,'blood-report');article.append(node('span',labelStatus[r.status]||'Unknown status','blood-status'),node('p','Report '+r.id+' · '+new Date(r.submitted_at).toLocaleString('en-AU')));
        if(r.status==='approved'){
          const published=releases.find(p=>p.report_id===r.id);
          if(published){article.append(node('h3','Doctor-approved explanation'),node('p',published.summary),node('p','Approved by '+published.reviewer_name+' · '+new Date(published.approved_at).toLocaleString('en-AU'),'small'),graphViews(published.graph_data))}
          else article.append(node('p','Approved content is not available yet. Refresh to check again.'));
        }else{article.append(node('p',r.status==='rejected'?'A new corrected submission is required.':'The draft explanation and graphs are withheld until an assigned doctor approves.'));}
        if(r.review_note)article.append(node('p','Doctor note: '+r.review_note));
        if(['failed','received','processing'].includes(r.status)&&r.attempt<3)article.append(button(r.status==='failed'?'Retry draft preparation':'Check/retry processing',()=>retry(r.id)));
        $('blood-report-list').append(article);
      }
      message('blood-message',reports.length?'Statuses loaded. Refresh to check for new reviews.':'No reports submitted yet. A verified doctor must be assigned before the first submission.');
    }catch(e){if(generation===epoch)message('blood-message','Clinical report storage is not available yet. Confirm the workflow migration and account permissions before testing.',true)}
  }
  async function retry(reportId) {
    if(busy)return;
    if(!$('blood-consent').checked){message('blood-submit-status','Confirm the OpenAI processing acknowledgement below before retrying.',true);return}
    busy=true;const generation=epoch;message('blood-submit-status','Preparing the draft for doctor review…');
    try{await api.analyse({action:'retry',report_id:reportId,processing_consent:true});if(generation===epoch){message('blood-submit-status','Draft ready for doctor review. Nothing has been released yet.');await loadPatient()}}
    catch(e){if(generation===epoch){message('blood-submit-status',explainError(e),true);await loadPatient()}}finally{if(generation===epoch)busy=false}
  }
  $('blood-submit').addEventListener('input',()=>{if(!busy)currentSubmission=null});
  $('blood-submit').onsubmit=async event=>{
    event.preventDefault();if(busy||!api?.user())return;
    const measurements=[...$('blood-inputs').children].map(tr=>tr.read());
    if(!measurements.length){message('blood-submit-status','Add at least one result.',true);return}
    if(measurements.some(r=>(r.reference_low===null)!==(r.reference_high===null)||(r.reference_low!==null&&r.reference_low>r.reference_high))){message('blood-submit-status','Enter both lab interval limits in order, or leave both blank.',true);return}
    const snapshot=JSON.stringify(measurements);
    if(!currentSubmission||currentSubmission.snapshot!==snapshot)currentSubmission={id:crypto.randomUUID(),snapshot};
    const generation=epoch;busy=true;$('blood-generate').disabled=true;message('blood-submit-status','Submitting and preparing a doctor-only draft…');
    try{await api.analyse({action:'submit',report_id:currentSubmission.id,measurements,processing_consent:$('blood-consent').checked});if(generation===epoch){currentSubmission=null;message('blood-submit-status','Draft ready for doctor review. Explanation and graphs are withheld until approval.');await loadPatient()}}
    catch(e){if(generation===epoch){message('blood-submit-status',explainError(e),true);await loadPatient()}}finally{if(generation===epoch){busy=false;$('blood-generate').disabled=false}}
  };
  async function loadDoctor() {
    const generation=epoch;if(!doctor)return;
    message('review-message','Loading assigned reports…');
    try{
      const data=await api.read('lab_reports?status=eq.needs_review&patient_id=neq.'+api.user().id+'&select=id,patient_id,submitted_at&order=submitted_at.asc&limit=100');
      if(generation!==epoch)return;$('review-list').replaceChildren();
      data.forEach(r=>{const item=node('div',undefined,'blood-report');item.append(node('p','Patient '+r.patient_id+' · submitted '+new Date(r.submitted_at).toLocaleString('en-AU')),button('Review report',()=>openReview(r)));$('review-list').append(item)});
      message('review-message',data.length?'Only assigned patients with unapproved drafts are shown.':'No assigned reports await review.');
    }catch(e){if(generation===epoch)message('review-message',explainError(e),true)}
  }
  async function openReview(report) {
    const generation=epoch;$('review-detail').replaceChildren();
    try{
      const [drafts,raw]=await Promise.all([api.read('blood_analysis_drafts?report_id=eq.'+report.id+'&select=*'),api.read('lab_reports?id=eq.'+report.id+'&select=measurements,status')]);
      if(generation!==epoch)return;
      const draft=drafts[0];if(!draft||!raw[0]||raw[0].status!=='needs_review')throw Object.assign(new Error(),{status:409});
      const panel=node('div',undefined,'widepanel');panel.append(node('h2','Unapproved AI draft'),node('p','Report '+report.id,'small'),node('p','Version '+draft.analysis_version+' · model '+draft.model+' · prompt '+draft.prompt_version,'small'),measurementsTable(raw[0].measurements),node('h3','AI observations — verify against the source'));
      const list=node('ul');for(const observation of draft.narrative.observations||[])list.append(node('li',observation.code+': '+observation.comment));panel.append(list,node('h3','AI limitations'));
      const limits=node('ul');(draft.narrative.limitations||[]).forEach(t=>limits.append(node('li',t)));panel.append(limits,graphViews(draft.graph_data));
      const summaryLabel=node('label','Final doctor explanation (the only narrative released to the patient)','field'),summary=node('textarea',undefined,'blood-review-text');summary.value=draft.narrative.summary;summary.maxLength=4000;summary.required=true;summary.id='doctor-final-summary';summaryLabel.append(summary);
      const noteLabel=node('label','Review note / reason for rejection (visible to the patient)','field'),note=node('textarea',undefined,'blood-review-text');note.maxLength=4000;note.required=true;note.id='doctor-review-note';noteLabel.append(note);
      const verifiedLabel=node('label',undefined,'check'),verified=node('input');verified.type='checkbox';verified.id='doctor-verified-source';verifiedLabel.append(verified,node('span','I verified values, units, collection dates and lab intervals against the original report, reviewed clinical context and all draft outputs, and accept responsibility for the final explanation and graphs.'));
      const feedback=node('p');feedback.setAttribute('role','status');
      const approve=button('Approve and release',()=>review('approve')),reject=button('Reject — keep draft private',()=>review('reject'));
      async function review(decision){
        if(!note.value.trim()||(decision==='approve'&&(!verified.checked||!summary.value.trim()))){feedback.textContent='Enter a review note, and for approval verify the source and final explanation.';return}
        approve.disabled=true;reject.disabled=true;
        try{await api.rpc('review_blood_analysis',{report_id:report.id,expected_version:draft.analysis_version,decision,edited_summary:summary.value.trim(),doctor_note:note.value.trim(),source_verified:verified.checked});if(generation!==epoch)return;$('review-detail').replaceChildren();message('review-message',decision==='approve'?'Doctor approval recorded and report released.':'Report rejected; the draft remains private.');await loadDoctor();await loadPatient()}
        catch(e){if(generation===epoch){feedback.textContent='Review was not confirmed. Refresh the queue; the version or your assignment may have changed.';approve.disabled=false;reject.disabled=false}}
      }
      panel.append(summaryLabel,noteLabel,verifiedLabel,approve,reject,feedback);$('review-detail').append(panel);
    }catch(e){if(generation===epoch)message('review-message',explainError(e),true)}
  }
  async function refreshIdentity() {
    const generation=++epoch;doctor=false;reports=[];currentSubmission=null;busy=false;$('blood-generate').disabled=false;
    $('review-nav').hidden=true;$('review-list').replaceChildren();$('review-detail').replaceChildren();$('blood-report-list').replaceChildren();
    $('blood-consent').checked=false;$('blood-source').checked=false;message('blood-submit-status','');
    $('blood-inputs').replaceChildren();rowInput();
    const user=api?.user();$('blood-signedout').hidden=Boolean(user);$('blood-signedin').hidden=!user;
    if(!user){message('review-message','Sign in with a verified assigned doctor account to access clinical review.');return}
    await loadPatient();
    if(generation!==epoch)return;
    try{const self=await api.read('clinical_reviewers?user_id=eq.'+user.id+'&select=active,verified_at');if(generation!==epoch)return;doctor=Boolean(self[0]?.active&&self[0]?.verified_at);$('review-nav').hidden=!doctor;if(doctor)await loadDoctor()}catch{/* No role is granted if the role lookup fails. */}
  }
  $('blood-refresh').onclick=loadPatient;$('review-refresh').onclick=loadDoctor;
  window.addEventListener('everwell:auth',refreshIdentity);refreshIdentity();
})();
