'use strict'
class EventBuffer{
 constructor(limit=500){this.limit=Math.max(10,Math.min(5000,Number(limit)||500));this.events=[];this.sequence=0}
 add(event={}){const value={id:++this.sequence,timestamp:Date.now(),level:'info',type:'system',message:'',...event};delete value.secret;delete value.token;delete value.accessToken;this.events.push(value);if(this.events.length>this.limit)this.events.splice(0,this.events.length-this.limit);return value}
 query(filters={}){const limit=Math.max(1,Math.min(200,Number(filters.limit)||100));const page=Math.max(1,Number(filters.page)||1),sinceMs=Math.max(0,Number(filters.sinceMs)||0),cutoff=sinceMs?Date.now()-sinceMs:0;const filtered=this.events.filter(e=>(!filters.botId||e.botId===filters.botId)&&(!filters.goalId||e.goalId===filters.goalId)&&(!filters.taskId||e.taskId===filters.taskId)&&(!filters.level||e.level===filters.level)&&(!filters.errorCode||e.errorCode===filters.errorCode)&&(!cutoff||e.timestamp>=cutoff));return{items:filtered.slice().reverse().slice((page-1)*limit,page*limit),page,limit,total:filtered.length}}
}
module.exports={EventBuffer}
