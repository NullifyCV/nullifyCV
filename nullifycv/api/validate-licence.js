'use strict';
const p=require('../lib/payments');const legacy=require('../lib/validate-legacy');
module.exports=async(req,res)=>{try{
 p.guard(req,res);const {payload,signature}=req.body||{};
 if(payload?.v===1)return legacy(req,res); // Existing signed purchases retain their original expiry.
 if(payload?.v!==2||!p.authentic(payload,signature))throw p.error('invalid_licence',401);
 const current=await p.entitlement(payload.session_id);
 if(current.payload.workflow_id!==payload.workflow_id)throw p.error('invalid_licence',401);
 return res.status(200).json({valid:true,...current.payload,...p.sign(current.payload)});
 }catch(e){return p.fail(res,e);}};
