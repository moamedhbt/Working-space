const {AsyncLocalStorage}=require('async_hooks');
const {queryOne,runSql,transaction}=require('../db/database');
const context=new AsyncLocalStorage();
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Algiers',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function inUser(user,fn){return context.run(user,fn)}
function readUsage(provider,json){
  const u=provider==='gemini'?json?.usageMetadata:json?.usage;
  if(!u)return null;
  const input=provider==='gemini'?u.promptTokenCount:u.input_tokens??u.prompt_tokens;
  const output=provider==='gemini'?u.candidatesTokenCount:u.output_tokens??u.completion_tokens;
  const total=provider==='gemini'?u.totalTokenCount:u.total_tokens;
  if(Number.isFinite(total)&&total>=0)return {input:Number(input)||0,output:Number(output)||0,total:Number(total)};
  if(Number.isFinite(input)&&Number.isFinite(output)&&input>=0&&output>=0)return {input,output,total:input+output};
  return null;
}
async function trackedFetch(url,options,provider){
  const user=context.getStore();if(!user?.id)return fetch(url,options);
  const d=day();
  const enabled=transaction(()=>{
    runSql('INSERT OR IGNORE INTO ai_daily_usage (userId,day) VALUES (?,?)',[user.id,d]);
    const row=queryOne('SELECT * FROM ai_daily_usage WHERE userId=? AND day=?',[user.id,d]);
    const limit=queryOne('SELECT dailyLimit FROM ai_user_limits WHERE userId=?',[user.id])?.dailyLimit || 0;
    if(limit>0){
      if(row.unknownCalls>0)throw Object.assign(new Error('Consommation IA inconnue aujourd’hui : limite suspendue par sécurité. Contactez la Direction.'),{status:429});
      if(row.totalTokens>=limit)throw Object.assign(new Error('Votre limite quotidienne de tokens IA est atteinte. Réessayez demain ou contactez la Direction.'),{status:429});
      if(row.inflightAt>0 && Date.now()-row.inflightAt<10*60*1000)throw Object.assign(new Error('Une demande IA est déjà en cours pour votre compte.'),{status:429});
      runSql('UPDATE ai_daily_usage SET inflightAt=? WHERE userId=? AND day=?',[Date.now(),user.id,d]);
    }
    return limit>0;
  });
  let accounted=false;
  try {
    const res=await fetch(url,options);
    const json=await res.clone().json().catch(()=>null);
    const usage=readUsage(provider,json);
    // Successful and uncertain server responses may have been billed even without usage metadata.
    if(usage)runSql('UPDATE ai_daily_usage SET inputTokens=inputTokens+?,outputTokens=outputTokens+?,totalTokens=totalTokens+?,calls=calls+1 WHERE userId=? AND day=?',[usage.input,usage.output,usage.total,user.id,d]);
    else if(res.ok || res.status>=500)runSql('UPDATE ai_daily_usage SET unknownCalls=unknownCalls+1,calls=calls+1 WHERE userId=? AND day=?',[user.id,d]);
    accounted=true;
    return res;
  } finally {
    if(!accounted)runSql('UPDATE ai_daily_usage SET unknownCalls=unknownCalls+1,calls=calls+1 WHERE userId=? AND day=?',[user.id,d]);
    if(enabled)runSql('UPDATE ai_daily_usage SET inflightAt=0 WHERE userId=? AND day=?',[user.id,d]);
  }
}
module.exports={inUser,trackedFetch,day};
