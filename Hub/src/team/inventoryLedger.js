'use strict'
const { randomUUID }=require('crypto')
class InventoryLedger{
 constructor(state,options={}){this.state=state;this.now=options.now||Date.now}
 updateContainer({id,worldId,position,type='chest',contents={}}){if(!id||!worldId)throw new Error('WORLD_MISMATCH');const clean=Object.fromEntries(Object.entries(contents).filter(([name,count])=>name&&Number(count)>=0).map(([name,count])=>[name,Math.floor(Number(count))]));return this.state.inventory.containers[id]={id,worldId,position,type,contents:clean,lastVerifiedAt:this.now()}}
 available(containerId,item){this.expire();const container=this.state.inventory.containers[containerId];const reserved=Object.values(this.state.inventory.reservations).filter(x=>x.containerId===containerId&&x.item===item).reduce((sum,x)=>sum+x.amount,0);return Math.max(0,Number(container?.contents?.[item]||0)-reserved)}
 reserve(request){const container=this.state.inventory.containers[request.containerId];if(!container||container.worldId!==request.worldId)throw new Error('WORLD_MISMATCH');const amount=Math.max(1,Math.floor(Number(request.amount)||0));if(this.available(request.containerId,request.item)<amount)throw new Error('ITEMS_UNAVAILABLE');const value={id:request.id||`inventory-${randomUUID()}`,...request,amount,createdAt:this.now()};this.state.inventory.reservations[value.id]=value;return value}
 release(id){const found=this.state.inventory.reservations[id];delete this.state.inventory.reservations[id];return found||null}
 releaseOwner(botId,instanceId){for(const [id,value] of Object.entries(this.state.inventory.reservations))if(value.botId===botId&&(!instanceId||value.instanceId===instanceId))delete this.state.inventory.reservations[id]}
 expire(){const now=this.now();for(const [id,value] of Object.entries(this.state.inventory.reservations))if(Number(value.expiresAt)<=now)delete this.state.inventory.reservations[id]}
 snapshot(){this.expire();return this.state.inventory}
}
module.exports={InventoryLedger}
