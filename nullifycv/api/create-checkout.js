'use strict';
const p=require('../lib/payments');
module.exports=async(req,res)=>{try{
 p.guard(req,res);p.secret();
 const {plan,token,workflow_id}=req.body||{};
 if(!['single','annual'].includes(plan)||! /^[a-f0-9]{64}$/.test(token||'')||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(workflow_id||''))throw p.error('invalid_checkout');
 const priceId=p.plans()[plan];if(!priceId)throw p.error('checkout_not_configured',503);
 const price=await p.stripe('prices/'+encodeURIComponent(priceId));
 if(!price.active||price.currency!=='eur'||price.unit_amount!==(plan==='single'?299:4900)||price.tax_behavior!=='inclusive')throw p.error('price_configuration_mismatch',503);
 if(plan==='single'?!!price.recurring:(!price.recurring||price.recurring.interval!=='year'||price.recurring.interval_count!==1))throw p.error('price_configuration_mismatch',503);
 const body={mode:plan==='single'?'payment':'subscription','line_items[0][price]':priceId,'line_items[0][quantity]':'1',success_url:p.origin()+'/success.html?session_id={CHECKOUT_SESSION_ID}',cancel_url:p.origin()+'/?checkout=cancelled','metadata[ncv_token_hash]':p.hash(token),'metadata[ncv_workflow]':workflow_id,'automatic_tax[enabled]':'true','consent_collection[terms_of_service]':'required'};
 if(plan==='single')body.customer_creation='always';
 const session=await p.stripe('checkout/sessions',body,'ncv-'+p.hash(token+plan));
 if(!session.url?.startsWith('https://checkout.stripe.com/'))throw p.error('invalid_checkout_destination',502);
 return res.status(200).json({url:session.url});
 }catch(e){return p.fail(res,e);}};
