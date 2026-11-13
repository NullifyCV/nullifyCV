/* Checkout keeps documents on this device. Only a random purchase reference goes online. */
(function(){
 'use strict';
 const DB='ncv_checkout_local';const MAX_AGE=24*60*60*1000;
 let busy=false,loaded=null,originalTabs=null,originalCards=null,restoring=false;
 function db(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('pending');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('Browser storage is unavailable.'));});}
 async function pending(action,value){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('pending',action==='get'?'readonly':'readwrite');const s=t.objectStore('pending');const r=action==='get'?s.get('checkout'):action==='put'?s.put(value,'checkout'):s.delete('checkout');let v;r.onsuccess=()=>{v=r.result;};t.oncomplete=()=>{d.close();resolve(v);};t.onerror=()=>{d.close();reject(new Error('Could not save your work in this browser.'));};});}
 async function fingerprint(file){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');}
 function read(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')||fallback;}catch{return fallback;}}
 function notice(message){let e=document.getElementById('checkout-message');if(!e){e=document.createElement('p');e.id='checkout-message';e.setAttribute('role','status');e.style.cssText='padding:12px;color:#214e39;background:#edf5ef;border-radius:8px;';(document.getElementById('upgrade-modal')||document.querySelector('.pro-wrap')||document.body).appendChild(e);}e.textContent=message;}
 function track(name,data){if(typeof window.va==='function')window.va('event',{name,...data});}
 function safeFailure(error){
  const known=['checkout_not_configured','price_configuration_mismatch','payment_configuration_unavailable','payment_provider_authentication_failed','payment_provider_request_failed','payment_service_unavailable'];
  return known.includes(error?.message)?error.message:'unexpected_error';
 }
 function checkoutMessage(error){
  if(['checkout_not_configured','price_configuration_mismatch','payment_configuration_unavailable','payment_provider_authentication_failed','payment_provider_request_failed'].includes(error?.message))return 'Checkout is temporarily unavailable. Your CV is still here. Please try again shortly or contact support@nullifycv.com.';
  if(error?.message==='payment_service_unavailable')return 'Stripe is temporarily unavailable. Your CV is still here. Please try again shortly.';
  return 'Could not open checkout. Your CV is still here. Please try again.';
 }
 async function api(path,body){
  const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let data=null;try{data=await r.json();}catch{}
  if(!r.ok)throw Object.assign(new Error(data?.error||'Request failed'),{status:r.status});
  return data;
 }
 window.ncvStartCheckout=async function(plan){
  if(busy)return;busy=true;
  const context={plan:plan==='single'?'single_file':'annual_batch',source:location.pathname,trigger:window.ncvUpgradeIntent?.type||'direct'};
  try{
   const file=typeof currentFile!=='undefined'?currentFile:null;
   if(plan==='single'&&!file){notice('Choose your CV in the tool first, then unlock it.');if(!document.getElementById('drop'))location.href='/?offer=single';return;}
   const digest=file?await fingerprint(file):null;
   const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
   const workflow_id=crypto.randomUUID();
   const selected=Array.from(document.querySelectorAll('.tcard.on')).map(x=>x.dataset.key);
   // Only one active checkout per browser. Original bytes are deleted on return or next visit after 24 hours.
   await pending('put',{token,workflow_id,file,digest,selected,mode:typeof currentMode!=='undefined'?currentMode:'standard',intent:window.ncvUpgradeIntent||null,created:Date.now()});
   // Deliberately contains no filename, content, browser token or payment identifier.
   window._upgradeModalCheckoutClicked=true;
   track('checkout_started',context);
   notice('Opening secure checkout…');
   const result=await api('/api/create-checkout',{plan,token,workflow_id});
   track('checkout_redirected',context);
   // Keep the original event name for continuity with existing reports.
   track('checkout_click',{plan:plan==='single'?'single_file':'pro_annual',source:location.pathname});
   location.assign(result.url);
  }catch(e){track('checkout_failed',{...context,reason:safeFailure(e),status:String(e?.status||0)});notice(checkoutMessage(e));}
  finally{busy=false;}
 };
 function resetAccess(){
  if(typeof activeLicence==='undefined')return;
  if(activeLicence===null){initBatchUI();return;}
  activeLicence=null;
  loaded=null;
  if(originalTabs!==null)document.getElementById('mode-tabs').innerHTML=originalTabs;
  if(originalCards!==null)document.getElementById('tgrid').innerHTML=originalCards;
  setMode('standard',document.querySelector('#mode-tabs .tab'));
  const bar=document.getElementById('licence-status');if(bar)bar.style.display='none';initBatchUI();
 }
 window.ncvValidate=async function(){
  const file=typeof currentFile!=='undefined'?currentFile:null;
  let stored=read('ncv_licence_v2',null);const single=read('ncv_single_licences',{});
  const digest=file?await fingerprint(file):null;
  // Existing passes/subscriptions take priority over a document-specific purchase.
  if(!stored || stored.payload?.plan==='single')stored=digest?single[digest]||null:null;
  if(!stored){resetAccess();return false;}
  try{
   const result=await api('/api/validate-licence',stored);
   if(file !== (typeof currentFile!=='undefined'?currentFile:null))return false;
   if(!result.valid){resetAccess();return false;}
   if(result.plan==='single'&&(!file||!single[digest]||single[digest].payload.workflow_id!==result.workflow_id)){resetAccess();return false;}
   if(result.payload){stored={payload:result.payload,signature:result.signature};if(result.plan==='single'){single[digest]=stored;localStorage.setItem('ncv_single_licences',JSON.stringify(single));}else localStorage.setItem('ncv_licence_v2',JSON.stringify(stored));}
   activeLicence={tier:result.tier,plan:result.plan,expires:result.expires};applyLicence(result.tier);showLicenceStatus(activeLicence);loaded=stored;return true;
  }catch(e){resetAccess();notice('Paid access could not be verified. Check your connection and try again; your purchase has not been deleted.');return false;}
 };
 window.ncvFileChanged=async function(){if(originalTabs===null||restoring)return;await window.ncvValidate();};
 window.ncvManageBilling=async function(){try{const stored=loaded||read('ncv_licence_v2',null);if(!stored)throw new Error();const result=await api('/api/customer-portal',stored);if(!result.url.startsWith('https://billing.stripe.com/'))throw new Error();location.assign(result.url);}catch{notice('Please contact support@nullifycv.com with your receipt for billing help.');}};
 window.ncvPending=pending;
 document.addEventListener('DOMContentLoaded',async()=>{
  const tabs=document.getElementById('mode-tabs'),cards=document.getElementById('tgrid');
  if(tabs){originalTabs=tabs.innerHTML;originalCards=cards.innerHTML;}
  try{localStorage.removeItem('ncv_licence');}catch{}
  if(!tabs)return;
  try{
   const item=await pending('get');
   if(item && Date.now()-item.created>MAX_AGE)await pending('delete');
   else if(item?.file){
    restoring=true;loadFile(item.file);restoring=false;await window.ncvValidate();
    if(item.mode && (item.mode==='standard'||activeLicence)){const modes=['standard','bias','client','eeoc'];setMode(item.mode,document.querySelectorAll('#mode-tabs .tab')[modes.indexOf(item.mode)]);}
    document.querySelectorAll('.tcard:not(.tcard-locked)').forEach(c=>{const on=item.selected.includes(c.dataset.key);c.classList.toggle('on',on);c.setAttribute('aria-checked',String(on));c.querySelector('.tbox').textContent=on?'✓':'';});
    if(activeLicence&&item.intent?.type==='mode'&&['bias','client','eeoc'].includes(item.intent.value)){
     const tab=document.querySelector(`#mode-tabs [data-mode="${item.intent.value}"]`);if(tab)setMode(item.intent.value,tab);
    }
    if(activeLicence&&item.intent?.type==='target'&&['school','pronouns','urls','metadata'].includes(item.intent.value)){
     const card=document.querySelector(`#tgrid [data-key="${item.intent.value}"]:not(.tcard-locked)`);if(card){card.classList.add('on');card.setAttribute('aria-checked','true');card.querySelector('.tbox').textContent='✓';}
    }
    await pending('delete');notice('Your CV and settings have been restored in this browser.');
   }else {await window.ncvValidate();if(item)await pending('delete');}
  }catch{notice('Could not restore the previous CV. Select it again to continue.');}
  if(new URLSearchParams(location.search).get('offer')==='single')notice('Choose your CV, then select an advanced redaction option to unlock it for €2.99.');
 });
})();
