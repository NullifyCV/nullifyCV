'use strict';
const p=require('../lib/payments');
module.exports=async(req,res)=>{try{
 p.guard(req,res);
 const {session_id,token}=req.body||{};const {session,payload}=await p.entitlement(session_id);
 // Ignore any caller-supplied plan. New checkouts require proof from the originating browser.
 if(session.metadata?.ncv_token_hash && (typeof token!=='string'||p.hash(token)!==session.metadata.ncv_token_hash))throw p.error('use_original_checkout_browser',403);
 return res.status(200).json(p.sign(payload));
 }catch(e){return p.fail(res,e);}};
