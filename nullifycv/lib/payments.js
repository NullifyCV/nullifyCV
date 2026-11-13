'use strict';
const crypto = require('crypto');
function error(code, status=400) { return Object.assign(new Error(code), {status}); }
function secret() { const s=process.env.LICENCE_SIGNING_SECRET; if(!s || s.length<32) throw error('payment_configuration_unavailable',503); return s; }
function stripeSecret() {
 const value=String(process.env.STRIPE_SECRET_KEY||'').trim();
 // This only checks that Vercel has a plausible secret key. Stripe remains the
 // authority on whether the key is active and belongs to the right account.
 if(!/^sk_(?:live|test)_[A-Za-z0-9_-]{8,}$/.test(value)) throw error('payment_configuration_unavailable',503);
 return value;
}
function stripeOperation(path){
 if(path.startsWith('prices/'))return 'price_lookup';
 if(path.startsWith('checkout/sessions'))return 'checkout_session';
 if(path.startsWith('subscriptions/'))return 'subscription_lookup';
 if(path.startsWith('billing_portal/sessions'))return 'billing_portal';
 return 'stripe_request';
}
function report(scope, details={}){
 // Never log a Stripe secret, Checkout Session ID, browser token, CV data or email.
 console.error('[nullifycv-payment] '+JSON.stringify({event:'payment_failure',scope,...details}));
}
function reported(code,status){return Object.assign(error(code,status),{reported:true});}
async function stripe(path, body, idempotency) {
 const headers={Authorization:'Bearer '+stripeSecret(),'Stripe-Version':'2024-06-20'};
 if(body) headers['Content-Type']='application/x-www-form-urlencoded';
 if(idempotency) headers['Idempotency-Key']=idempotency;
 let r;
 try{
  r=await fetch('https://api.stripe.com/v1/'+path,{method:body?'POST':'GET',headers,body:body?new URLSearchParams(body):undefined,signal:AbortSignal.timeout(15000)});
 }catch{
  report(stripeOperation(path),{reason:'network_or_timeout'});
  throw reported('payment_service_unavailable',502);
 }
 if(!r.ok){
  let provider={};
  try{const json=await r.json();provider={stripe_type:json?.error?.type||null,stripe_code:json?.error?.code||null};}catch{}
  const reason=r.status===401||r.status===403?'stripe_authentication_failed':r.status===404?'stripe_catalog_not_found':r.status>=500?'stripe_unavailable':'stripe_request_rejected';
  report(stripeOperation(path),{reason,http_status:r.status,...provider});
  if(r.status===401||r.status===403)throw reported('payment_provider_authentication_failed',503);
  if(r.status===404)throw reported('payment_configuration_mismatch',503);
  throw reported(r.status>=500?'payment_service_unavailable':'payment_provider_request_failed',r.status>=500?502:503);
 }
 try{return await r.json();}catch{
  report(stripeOperation(path),{reason:'invalid_stripe_response'});
  throw reported('payment_service_unavailable',502);
 }
}
function hash(s){return crypto.createHash('sha256').update(s).digest('hex');}
function sign(payload){return {payload,signature:crypto.createHmac('sha256',secret()).update(JSON.stringify(payload)).digest('hex')};}
function authentic(payload, signature){
 if(!payload || typeof signature!=='string'||! /^[a-f0-9]{64}$/.test(signature))return false;
 const expected=sign(payload).signature;
 return crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(signature,'hex'));
}
function plans(){return {single:process.env.STRIPE_SINGLE_PRICE_ID,annual:process.env.STRIPE_ANNUAL_PRICE_ID};}
function origin(){const u=new URL(process.env.PUBLIC_SITE_URL || 'https://www.nullifycv.com');if(u.protocol!=='https:'||u.pathname!=='/'||u.search||u.hash)throw error('invalid_site_configuration',503);return u.origin;}
function guard(req,res){res.setHeader('Cache-Control','no-store');if(req.method!=='POST')throw error('method_not_allowed',405);if(req.headers.origin && req.headers.origin!==origin())throw error('invalid_origin',403);}
function fail(res,e){
 const code=e?.status?e.message:'payment_service_unavailable';
 if((e?.status||502)>=500&&!e?.reported)report('api_response',{reason:code,http_status:e?.status||502});
 return res.status(e?.status||502).json({error:code});
}
async function entitlement(sessionId){
 if(typeof sessionId!=='string'||!/^cs_(?:live|test)_[a-zA-Z0-9]+$/.test(sessionId))throw error('invalid_session');
 const session=await stripe('checkout/sessions/'+encodeURIComponent(sessionId)+'?expand[]=line_items&expand[]=payment_intent.latest_charge');
 if(session.status!=='complete')throw error('payment_not_complete',402);
 const items=session.line_items;
 if(!items||items.has_more||items.data.length!==1||items.data[0].quantity!==1)throw error('unrecognized_purchase');
 const price=items.data[0].price;
 const catalog=plans();
 const plan=Object.keys(catalog).find(k=>catalog[k] && catalog[k]===price.id);
 if(!plan)throw error('unrecognized_purchase');
 const recurring=!!price.recurring;
 if(plan==='single' && (recurring||price.currency!=='eur'||price.unit_amount!==299||session.mode!=='payment'))throw error('incorrect_price');
 if(plan==='annual' && (!recurring||price.recurring.interval!=='year'||price.recurring.interval_count!==1||price.currency!=='eur'||price.unit_amount!==4900||session.mode!=='subscription'))throw error('incorrect_price');
 let expires=null, tier=plan==='single'?'seeker':'pro';
 if(recurring){
  const id=typeof session.subscription==='string'?session.subscription:session.subscription?.id;
  if(!id)throw error('subscription_missing');
  const sub=await stripe('subscriptions/'+encodeURIComponent(id)+'?expand[]=latest_invoice');
  if(sub.status!=='active'||!sub.latest_invoice?.paid)throw error('subscription_not_paid',402);
  if(!sub.items?.data?.some(i=>i.price.id===price.id))throw error('subscription_price_changed',402);
  expires=sub.current_period_end*1000;
  if(!Number.isFinite(expires)||expires<=Date.now())throw error('subscription_expired',402);
 }else{
  if(session.payment_status!=='paid')throw error('payment_not_paid',402);
  const charge=session.payment_intent?.latest_charge;
  if(!charge||charge.refunded||charge.amount_refunded>0||charge.disputed)throw error('payment_reversed',402);
 }
 if(!session.metadata?.ncv_token_hash || !session.metadata?.ncv_workflow)throw error('purchase_binding_missing');
 return {session,payload:{v:2,tier,plan,issued_at:session.created*1000,expires,session_id:session.id,workflow_id:session.metadata?.ncv_workflow||null}};
}
module.exports={error,stripe,hash,sign,authentic,plans,origin,guard,fail,entitlement,secret,stripeSecret,report};
