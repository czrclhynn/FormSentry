/* Durable outbox. Finalized records are copied once and never edited after ingestion. */
(function(root) {
  function stage(db) {
    const s=db.session; if(!s?.cloud) return;
    db.outbox ||= {};
    const batch=db.outbox[s.id] ||= {sessionId:s.id,token:s.cloud.token,events:[],acked:[],final:null,submission:null};
    for(const e of db.events) {
      if(e.sessionId!==s.id || e.id===s.processor?.episode?.id || batch.acked.includes(e.id) || batch.events.some(x=>x.id===e.id)) continue;
      batch.events.push(JSON.parse(JSON.stringify(e)));
    }
    if(!s.active) { batch.final=s.cloud.final||'interrupted'; batch.submission=s.cloud.submission||null; }
  }
  async function flush(db, client) {
    stage(db);
    // Bound one network request per worker task and rotate failures so old attempts
    // cannot stall session controls or starve newer attempts while offline.
    const batches=Object.values(db.outbox||{}).filter(b=>!b.done).sort((a,b)=>(a.lastAttemptAt||0)-(b.lastAttemptAt||0)).slice(0,1);
    for(const batch of batches) {
      if(batch.done) continue;
      batch.lastAttemptAt=Date.now();
      const events=batch.events.slice(0,50), final=batch.events.length<=50?batch.final:null;
      try {
        const result=await client.student({action:'sync',sessionId:batch.sessionId,events,final,submission:final?batch.submission:null},batch.token);
        const accepted=new Set(result.accepted||[]);
        batch.events=batch.events.filter(e=>!accepted.has(e.id)); batch.acked.push(...accepted); batch.lastSyncAt=Date.now(); batch.error=null;
        if(result.terminal) { batch.done=true; batch.token=null; if(batch.events.length) batch.error='Server session ended before all local records were accepted. Export the local report for teacher review.'; }
        if(db.session?.id===batch.sessionId) {
          db.session.cloud.syncError=batch.error; db.session.cloud.lastSyncAt=batch.lastSyncAt;
          if(result.status==='teacher_ended') {
            const episode=db.session.processor?.episode;
            if(episode) { const e=db.events.find(e=>e.id===episode.id);if(e){e.metadata.durationMs=Math.max(0,Date.now()-episode.at);e.metadata.endedWhileAway=true;}db.session.processor.episode=null;db.session.cloud.syncError='Teacher ended monitoring. Any unsent local activity is retained for export.'; }
            db.session.active=false; db.session.status='TEACHER_ENDED'; db.session.endedAt=Date.now();
          }
        }
      } catch(error) {
        batch.error=error.message; if(db.session?.id===batch.sessionId) db.session.cloud.syncError='Upload pending: '+error.message;
        // Keep all unacknowledged data, including after local completion, for the next alarm.
      }
    }
  }
  root.FormSentrySync={stage,flush}; if(typeof module!=='undefined') module.exports=root.FormSentrySync;
})(globalThis);
