/* Tokens live in sessionStorage for this tab, never in exported reports or URLs after processing. */
(function(root) {
  const C=FormSentryCloud, key='formsentry-teacher-auth'; let refreshing;
  function read(){try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}}
  function remember(value){if(value?.access_token){value.expires_at=Date.now()+value.expires_in*1000;sessionStorage.setItem(key,JSON.stringify(value));}else sessionStorage.removeItem(key);return value;}
  async function token(){let s=read();if(!s)throw new Error('Please sign in.');if(s.expires_at<Date.now()+60000){refreshing ||= C.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:s.refresh_token}}).then(remember).catch(e=>{remember(null);throw e;}).finally(()=>refreshing=null);s=await refreshing;}return s.access_token;}
  async function user(){const value=await C.request('/auth/v1/user',{token:await token()});if(!value.email_confirmed_at){remember(null);throw new Error('Verify your email before opening the dashboard.');}return value;}
  async function login(email,password){remember(await C.request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}}));return user();}
  async function signup(name,email,password){await C.request('/auth/v1/signup?redirect_to='+encodeURIComponent(C.config.dashboardUrl),{method:'POST',body:{email,password,data:{full_name:name}}});}
  async function recover(email){await C.request('/auth/v1/recover?redirect_to='+encodeURIComponent(C.config.dashboardUrl),{method:'POST',body:{email}});}
  async function logout(){try{await C.request('/auth/v1/logout',{method:'POST',token:await token()});}finally{remember(null);}}
  async function password(value){await C.request('/auth/v1/user',{method:'PUT',token:await token(),body:{password:value}});}
  function callback(){const hash=new URLSearchParams(location.hash.slice(1));if(hash.has('access_token')){remember({access_token:hash.get('access_token'),refresh_token:hash.get('refresh_token'),expires_in:Number(hash.get('expires_in')||3600)});const recovery=hash.get('type')==='recovery';history.replaceState(null,'',location.pathname+location.search);return recovery;}if(hash.has('error_description')){const message=hash.get('error_description');history.replaceState(null,'',location.pathname);throw new Error(message);}return false;}
  const rest=async(path,options={})=>C.request('/rest/v1/'+path,{...options,token:await token()});
  const api={user,login,signup,recover,logout,password,callback,rest,hasSession:()=>!!read()};root.FormSentryTeacher=api;
})(globalThis);
