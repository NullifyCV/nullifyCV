'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const payments=require('../lib/payments');
const createCheckout=require('../api/create-checkout');
const issueLicence=require('../api/issue-licence');
const validateLicence=require('../api/validate-licence');

const savedEnv={...process.env};
const savedFetch=global.fetch;

function configure(){
 process.env.LICENCE_SIGNING_SECRET='test-secret-that-is-more-than-thirty-two-characters-long';
 process.env.STRIPE_SECRET_KEY='sk_test_not_a_real_key';
 process.env.STRIPE_SINGLE_PRICE_ID='price_single';
 process.env.STRIPE_ANNUAL_PRICE_ID='price_annual';
 process.env.PUBLIC_SITE_URL='https://www.nullifycv.com';
 delete process.env.STRIPE_LEGACY_PRICE_MAP;
}
function response(body,status=200){return {ok:status>=200&&status<300,status,json:async()=>body};}
function mockRes(){return {headers:{},code:null,body:null,setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};}
function request(body){return {method:'POST',headers:{origin:'https://www.nullifycv.com'},body};}
function singleSession(overrides={}){
 return {id:'cs_test_single123',status:'complete',mode:'payment',payment_status:'paid',created:1700000000,customer:'cus_single',metadata:{ncv_token_hash:payments.hash('a'.repeat(64)),ncv_workflow:'123e4567-e89b-42d3-a456-426614174000'},line_items:{has_more:false,data:[{quantity:1,price:{id:'price_single',currency:'eur',unit_amount:299,recurring:null}}]},payment_intent:{latest_charge:{refunded:false,amount_refunded:0,disputed:false}},...overrides};
}
function annualSession(){return {id:'cs_test_annual123',status:'complete',mode:'subscription',payment_status:'paid',created:1700000000,customer:'cus_annual',subscription:'sub_123',metadata:{ncv_token_hash:payments.hash('b'.repeat(64)),ncv_workflow:'123e4567-e89b-42d3-a456-426614174001'},line_items:{has_more:false,data:[{quantity:1,price:{id:'price_annual',currency:'eur',unit_amount:4900,recurring:{interval:'year',interval_count:1}}}]}};}
function annualSubscription(){return {status:'active',current_period_end:Math.floor(Date.now()/1000)+86400,latest_invoice:{paid:true},items:{data:[{price:{id:'price_annual'}}]}};}

test.beforeEach(configure);
test.afterEach(()=>{global.fetch=savedFetch;for(const key of Object.keys(process.env))if(!(key in savedEnv))delete process.env[key];Object.assign(process.env,savedEnv);});

test('single checkout uses the configured €2.99 inclusive-tax price and browser binding',async()=>{
 const calls=[];
 global.fetch=async(url,options={})=>{calls.push({url,options});if(url.includes('/prices/'))return response({id:'price_single',active:true,currency:'eur',unit_amount:299,tax_behavior:'inclusive',recurring:null});return response({url:'https://checkout.stripe.com/c/pay/cs_test_checkout'});};
 const res=mockRes();await createCheckout(request({plan:'single',token:'a'.repeat(64),workflow_id:'123e4567-e89b-42d3-a456-426614174000'}),res);
 assert.equal(res.code,200);assert.equal(res.body.url,'https://checkout.stripe.com/c/pay/cs_test_checkout');assert.equal(calls.length,2);
 const body=calls[1].options.body;
 assert.equal(body.get('mode'),'payment');assert.equal(body.get('line_items[0][price]'),'price_single');assert.equal(body.get('customer_creation'),'always');assert.equal(body.get('automatic_tax[enabled]'),'true');assert.equal(body.get('metadata[ncv_token_hash]'),payments.hash('a'.repeat(64)));assert.equal(body.get('metadata[ncv_workflow]'),'123e4567-e89b-42d3-a456-426614174000');
});

test('licence plan comes from the purchased Stripe price, never a caller plan',async()=>{
 global.fetch=async()=>response(singleSession());
 const res=mockRes();await issueLicence(request({session_id:'cs_test_single123',token:'a'.repeat(64),plan:'annual'}),res);
 assert.equal(res.code,200);assert.equal(res.body.payload.plan,'single');assert.equal(res.body.payload.tier,'seeker');assert.ok(payments.authentic(res.body.payload,res.body.signature));
});

test('a checkout can only be claimed from its originating browser token',async()=>{
 global.fetch=async()=>response(singleSession());
 const res=mockRes();await issueLicence(request({session_id:'cs_test_single123',token:'c'.repeat(64)}),res);
 assert.equal(res.code,403);assert.equal(res.body.error,'use_original_checkout_browser');
});

test('annual access is rechecked against an active, paid Stripe subscription',async()=>{
 global.fetch=async url=>url.includes('/subscriptions/')?response(annualSubscription()):response(annualSession());
 const original={v:2,tier:'pro',plan:'annual',issued_at:1700000000000,expires:Date.now()+1000,session_id:'cs_test_annual123',workflow_id:'123e4567-e89b-42d3-a456-426614174001'};
 const signed=payments.sign(original),res=mockRes();await validateLicence(request(signed),res);
 assert.equal(res.code,200);assert.equal(res.body.valid,true);assert.equal(res.body.plan,'annual');assert.equal(res.body.tier,'pro');assert.ok(res.body.expires>Date.now());assert.ok(payments.authentic(res.body.payload,res.body.signature));
});

test('forged local browser access is rejected before Stripe is called',async()=>{
 let called=false;global.fetch=async()=>{called=true;throw new Error('should not run');};
 const payload={v:2,tier:'pro',plan:'annual',issued_at:1,expires:Date.now()+86400000,session_id:'cs_test_annual123',workflow_id:'123e4567-e89b-42d3-a456-426614174001'};
 const res=mockRes();await validateLicence(request({payload,signature:'0'.repeat(64)}),res);
 assert.equal(res.code,401);assert.equal(res.body.error,'invalid_licence');assert.equal(called,false);
});

test('refunded one-time payments no longer validate',async()=>{
 global.fetch=async()=>response(singleSession({payment_intent:{latest_charge:{refunded:true,amount_refunded:299,disputed:false}}}));
 await assert.rejects(()=>payments.entitlement('cs_test_single123'),e=>e.message==='payment_reversed'&&e.status===402);
});

test('checkout refuses a mispriced Stripe price',async()=>{
 global.fetch=async()=>response({id:'price_single',active:true,currency:'eur',unit_amount:499,tax_behavior:'inclusive',recurring:null});
 const res=mockRes();await createCheckout(request({plan:'single',token:'a'.repeat(64),workflow_id:'123e4567-e89b-42d3-a456-426614174000'}),res);
 assert.equal(res.code,503);assert.equal(res.body.error,'price_configuration_mismatch');
});

test('old unbound Checkout Session IDs cannot issue new access',async()=>{
 global.fetch=async()=>response(singleSession({metadata:{},line_items:{has_more:false,data:[{quantity:1,price:{id:'price_old_week',currency:'eur',unit_amount:499,recurring:null}}]}}));
 const res=mockRes();await issueLicence(request({session_id:'cs_test_single123',token:'a'.repeat(64),plan:'annual'}),res);
 assert.equal(res.code,400);assert.equal(res.body.error,'unrecognized_purchase');
});

test('existing v1 signed purchases retain their original access',async()=>{
 const payload={v:1,tier:'pro',plan:'pro',issued_at:Date.now()-86400000,expires:Date.now()+86400000,session_id:'cs_live_existing123'};
 const signed=payments.sign(payload),res=mockRes();await validateLicence(request(signed),res);
 assert.equal(res.code,200);assert.deepEqual(res.body,{valid:true,tier:'pro',plan:'pro',expires:payload.expires});
});
