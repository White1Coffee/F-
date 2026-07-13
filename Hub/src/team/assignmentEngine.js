'use strict'
function distance(a,b){if(!a||!b)return 0;return Math.hypot(Number(a.x)-Number(b.x),Number(a.y)-Number(b.y),Number(a.z)-Number(b.z))}
function hasCapabilities(bot, task){return (task.requiredCapabilities||[]).every(capability=>(bot.capabilities||[]).includes(capability))}
function dependenciesMet(task,tasks){return (task.dependencies||[]).every(id=>tasks.find(candidate=>candidate.id===id)?.status==='completed')}
function scoreBotForTask(bot,task){
 if(!bot?.online||bot.worldId!==task.worldId||!hasCapabilities(bot,task)||bot.safetyState==='unsafe'||bot.currentTaskId||(task.excludedInstanceIds||[]).includes(bot.instanceId))return -Infinity
 const stats=bot.skillStats?.[task.skill]||{};let score=100+Number(stats.successRate||0)*50
 if(task.target?.requiredTool&&bot.inventorySummary?.[task.target.requiredTool])score+=25
 if(task.target?.item&&bot.inventorySummary?.[task.target.item])score+=20
 if(task.target?.inputItem&&bot.inventorySummary?.[task.target.inputItem])score+=40
 score-=distance(bot.position,task.destination)*.2;score-=Math.max(0,12-Number(bot.health||20))*3;score-=Math.max(0,10-Number(bot.food||20))*2
 return score
}
class AssignmentEngine{
 choose(task,bots,tasks){if(!dependenciesMet(task,tasks))return null;return bots.map(bot=>({bot,score:scoreBotForTask(bot,task)})).filter(x=>Number.isFinite(x.score)).sort((a,b)=>b.score-a.score||Number(a.bot.idleSince||0)-Number(b.bot.idleSince||0)||a.bot.botId.localeCompare(b.bot.botId))[0]||null}
}
module.exports={AssignmentEngine,scoreBotForTask,dependenciesMet,hasCapabilities,distance}
