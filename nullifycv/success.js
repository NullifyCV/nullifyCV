(async function(){
 const sessionId=window.ncvCheckoutSession || new URLSearchParams(location.search).get('session_id');
 const heading=document.querySelector('.success-title')||document.querySelector('h1');
 const status=document.getElementById('plan-expiry'),button=document.getElementById('go-btn');
 button.href='/';button.textContent='Return to the tool';
 try{
  if(!sessionId)throw new Error('No checkout reference was supplied.');
  const pending=await window.ncvPending('get');
  const r=await fetch('/api/issue-licence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:sessionId,token:pending?.token})});
  const result=await r.json();if(!r.ok)throw new Error(result.error==='use_original_checkout_browser'?'Return using the browser where you started checkout.':'Payment could not yet be verified. Please retry or contact support with your receipt.');
  const {payload,signature}=result;
  if(payload.plan==='single'){
   if(!pending?.digest||pending.workflow_id!==payload.workflow_id)throw new Error('Your original CV reference is missing. Contact support with your receipt.');
   const records=JSON.parse(localStorage.getItem('ncv_single_licences')||'{}');records[pending.digest]={payload,signature};localStorage.setItem('ncv_single_licences',JSON.stringify(records));
  }else{
   localStorage.setItem('ncv_licence_v2',JSON.stringify({payload,signature}));
  }
  history.replaceState({},'',location.pathname);
  document.getElementById('plan-name').textContent=payload.plan==='single'?'Single CV':payload.plan==='annual'?'Annual batch access':'Existing paid plan';
  document.getElementById('plan-desc').textContent=payload.plan==='single'?'All redaction options for your selected source CV. Review, correct selections and download again.':'Paid access verified. Manage your subscription from the tool.';
  status.textContent=payload.expires?'Access through '+new Date(payload.expires).toLocaleDateString():'Access saved for this CV in this browser.';
  if(heading)heading.textContent='Your access is ready.';
  document.getElementById('activation-message').textContent='Your purchase has been verified and access saved to this browser.';
  button.href='/?activated=1';button.textContent='Continue with your CV →';
 }catch(e){
  if(heading)heading.textContent='Access needs attention';
  document.getElementById('activation-message').textContent='Access has not been saved. Please keep your Stripe receipt.';
  status.textContent=e.name==='QuotaExceededError'?'Payment verified, but browser storage is full. Free space and reopen your Stripe return link, or contact support.':e.message;
  const a=document.createElement('a');a.href='mailto:support@nullifycv.com?subject=Payment%20access%20help';a.textContent='Contact support';status.appendChild(document.createElement('br'));status.appendChild(a);
 }
})();
