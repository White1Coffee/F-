'use strict'
const { randomUUID } = require('crypto')
function overlaps(a,b){return a.min.x<=b.max.x&&a.max.x>=b.min.x&&a.min.y<=b.max.y&&a.max.y>=b.min.y&&a.min.z<=b.max.z&&a.max.z>=b.min.z}
class ReservationStore{
 constructor(state,options={}){this.state=state;this.now=options.now||Date.now}
 conflicts(request,current){if(request.worldId!==current.worldId||request.ownerInstanceId===current.ownerInstanceId)return false;if(request.type==='area'&&current.type==='area')return overlaps(request.bounds,current.bounds);if(request.type==='object'&&current.type==='object')return request.objectId===current.objectId;if(request.type==='task'&&current.type==='task')return request.taskId===current.taskId;return false}
 create(request){this.expire();if(this.state.reservations.some(item=>this.conflicts(request,item)))throw new Error('RESERVATION_CONFLICT');const reservation={id:request.id||`reservation-${randomUUID()}`,createdAt:this.now(),...request};if(!reservation.expiresAt)throw new Error('RESERVATION_EXPIRED');this.state.reservations.push(reservation);return reservation}
 renew(id,botId,instanceId,ttlMs){const item=this.state.reservations.find(x=>x.id===id&&x.ownerBotId===botId&&x.ownerInstanceId===instanceId);if(!item)throw new Error('RESERVATION_EXPIRED');item.expiresAt=this.now()+ttlMs;return item}
 release(id,botId,instanceId){const before=this.state.reservations.length;this.state.reservations=this.state.reservations.filter(x=>x.id!==id||(botId&&x.ownerBotId!==botId)||(instanceId&&x.ownerInstanceId!==instanceId));return before!==this.state.reservations.length}
 releaseOwner(botId,instanceId){const removed=this.state.reservations.filter(x=>x.ownerBotId===botId&&(!instanceId||x.ownerInstanceId===instanceId));this.state.reservations=this.state.reservations.filter(x=>!removed.includes(x));return removed}
 expire(){const now=this.now();const expired=this.state.reservations.filter(x=>Number(x.expiresAt)<=now);this.state.reservations=this.state.reservations.filter(x=>Number(x.expiresAt)>now);return expired}
}
module.exports={ReservationStore,overlaps}
