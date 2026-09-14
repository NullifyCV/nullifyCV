'use strict';
const p=require('../lib/payments');
module.exports=async(req,res)=>{try{
 p.guard(req,res);const {payload,signature}=req.body||{};
 if(!p.authentic(payload,signature)||typeof payload.session_id!=='string'||!/^cs_(live|test)_[a-zA-Z0-9]+$/.test(payload.session_id))throw p.error('invalid_licence',401);
 const session=await p.stripe('checkout/sessions/'+encodeURIComponent(payload.session_id));
 const customer=typeof session.customer==='string'?session.customer:session.customer?.id;
 if(!customer)throw p.error('contact_support_for_billing');
 const portal=await p.stripe('billing_portal/sessions',{customer,return_url:p.origin()+'/'});
 return res.status(200).json({url:portal.url});
 }catch(e){return p.fail(res,e);}};
