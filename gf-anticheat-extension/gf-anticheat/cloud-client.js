/* Supabase's HTTPS Auth/PostgREST/Edge APIs; no database credentials in this client. */
(function(root) {
  const config = root.FormSentryCloudConfig;
  function configured() { return !!config?.publishableKey && /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(config.url); }
  async function request(path, {method='GET',body,token,headers={},count=false}={}) {
    if(!configured()) throw new Error('Supabase is not configured. Ask the maintainer to build FormSentry with its public project settings.');
    const response=await fetch(config.url+path,{method,headers:{apikey:config.publishableKey,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
    const text=await response.text(); let value; try{value=text?JSON.parse(text):null;}catch{throw new Error('The backend returned an unexpected response.');}
    if(!response.ok) { const error=new Error(value?.error_description||value?.msg||value?.message||value?.error||`Backend request failed (${response.status}).`); error.status=response.status; throw error; }
    return count ? {data:value,count:Number((response.headers.get('Content-Range')||'*/0').split('/')[1])} : value;
  }
  const student=(body,token)=>request('/functions/v1/student-api',{method:'POST',body,token});
  function localExam(exam) {
    const r=exam.rules;
    return {id:exam.id,name:exam.title,url:exam.form_url,enabled:exam.status==='active',mode:'DETECTION',warningMode:r.mode==='WARN',cloudRules:r,
      rules:{tabSwitch:r.departures?'MONITOR':'OFF',newTab:'ALLOW',ai:'ALLOW',copyPaste:r.clipboard?'MONITOR':'ALLOW',fullscreen:r.fullscreen?'REQUIRED':'OPTIONAL',devtools:'ALLOW',contextMenu:'ALLOW',shortcuts:'ALLOW'}};
  }
  const api={request,student,configured,localExam,config}; root.FormSentryCloud=api;
  if(typeof module!=='undefined') module.exports=api;
})(globalThis);
