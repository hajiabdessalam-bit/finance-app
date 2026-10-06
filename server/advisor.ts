/** Local, tested tool preparation. No route, provider client or model request is enabled. */
import {tool,jsonSchema} from 'ai';
import * as C from '../app/core.mjs';
import type {Workspace,JointForecast} from '../frontend/types.ts';
type Simulation={mode:'budget'|'history'|'conservative';extraCost:string;incomeChange:string;protectedSaving:string};
type Priority={goal:string;priority:number};
export interface PriorityDraft {kind:'goal-priority';goal:string;priority:number;before:number;stateDigest:string;version:number;reviewRequired:true}
function record(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k)))throw new Error('Invalid planning tool input.');return value as Record<string,unknown>;}
export function simulationInput(value:unknown):Simulation {
  const v=record(value,['mode','extraCost','incomeChange','protectedSaving']);
  if(!['budget','history','conservative'].includes(String(v.mode))||[v.extraCost,v.incomeChange,v.protectedSaving].some(n=>typeof n!=='string'))throw new Error('Use a supported scenario and decimal money strings.');
  if(C.money(v.extraCost)<0||C.money(v.protectedSaving)<0)throw new Error('Spending and protected saving must not be negative.');C.money(v.incomeChange);
  return v as unknown as Simulation;
}
export function priorityInput(value:unknown):Priority {const v=record(value,['goal','priority']);if(typeof v.goal!=='string'||!/^G[1-9]\d*$/.test(v.goal)||!Number.isInteger(v.priority)||Number(v.priority)<1||Number(v.priority)>1000)throw new Error('Choose a goal alias and priority 1–1000.');return v as unknown as Priority;}
const alias=(s:Workspace,id:string)=>`G${s.goals.findIndex(g=>g.id===id)+1}`;
function goal(s:Workspace,id:string){const g=s.goals.find((_,i)=>`G${i+1}`===id);if(!g||g.archived)throw new Error('The goal is not active.');return g;}
/** Still sensitive financial data: show this exact summary for consent before any future provider call. */
export function advisorSummary(s:Workspace){C.validateState(s);const asOf=C.today(s.timezone),key=C.workspacePeriod(s,asOf),f=C.periodForecast(s,C.addMonths(key,1)),active=s.goals.filter(g=>!g.archived);return {currency:s.currency,asOf,cash:C.summary(s,asOf),nextPeriod:{income:f.income,spending:f.spending,buffer:f.buffer,committed:f.committed||0,capacity:f.capacity,requiresReview:!!f.requiresReview},goals:active.slice(0,50).map(g=>({alias:alias(s,g.id),target:C.goalRemaining(g),priority:g.priority,protected:!!g.protected,desired:g.desired||'',recurringCost:g.recurringCost||0})),goalCount:active.length,goalsOmitted:Math.max(0,active.length-50),units:'Integer currency minor units; future capacity is an assumption.'};}
export function simulate(s:Workspace,input:unknown){C.validateState(s);const v=simulationInput(input),p=C.planGoals(s,{mode:v.mode,extraExpense:C.money(v.extraCost),incomeChange:C.money(v.incomeChange),protection:C.money(v.protectedSaving)}) as JointForecast;return {results:p.results.map(g=>({goal:alias(s,g.id),target:g.target,funded:g.funded,remaining:g.remaining,ready:g.ready,deadline:g.deadline,late:g.late})),rows:p.rows,warnings:p.warnings,assumptions:p.assumptions,recordsChanged:false};}
export async function priorityDraft(s:Workspace,input:unknown):Promise<PriorityDraft>{C.validateState(s);const v=priorityInput(input),g=goal(s,v.goal);return {kind:'goal-priority',goal:v.goal,priority:v.priority,before:g.priority,stateDigest:await C.digest(JSON.stringify(s)),version:s.version,reviewRequired:true};}
/** Invoke only from a concrete UI review. Not included in model-accessible tools. */
export async function applyReviewedPriority(s:Workspace,draft:PriorityDraft,reviewed=false):Promise<Workspace>{
  if(!reviewed)throw new Error('Review the proposed change before applying it.');
  if(!draft||draft.kind!=='goal-priority'||draft.reviewRequired!==true||draft.version!==s.version||draft.stateDigest!==await C.digest(JSON.stringify(s)))throw new Error('Records changed after the proposal. Review a fresh proposal.');
  const v=priorityInput({goal:draft.goal,priority:draft.priority}),g=goal(s,v.goal);if(g.priority!==draft.before)throw new Error('Goal priority changed after the proposal.');
  return C.mutate(s,'reviewed-priority',{id:g.id,priority:v.priority},(n:Workspace)=>{goal(n,v.goal).priority=v.priority;}) as Workspace;
}
const validate=<T>(parse:(value:unknown)=>T)=>(value:unknown)=>{try{return {success:true as const,value:parse(value)};}catch(e){return {success:false as const,error:e instanceof Error?e:new Error('Invalid tool input.')};}};
export function planningTools(s:Workspace){C.validateState(s);const snapshot=C.clone(s) as Workspace;return {
  simulate_plan:tool({description:'Calculate a conditional joint funding scenario. Does not change records. Use decimal amount strings.',inputSchema:jsonSchema<Simulation>({type:'object',additionalProperties:false,properties:{mode:{type:'string',enum:['budget','history','conservative']},extraCost:{type:'string'},incomeChange:{type:'string'},protectedSaving:{type:'string'}},required:['mode','extraCost','incomeChange','protectedSaving']},{validate:validate(simulationInput)}),execute:async input=>simulate(snapshot,input)}),
  propose_goal_priority:tool({description:'Prepare a goal-priority proposal for user review. Does not apply or save the proposal.',inputSchema:jsonSchema<Priority>({type:'object',additionalProperties:false,properties:{goal:{type:'string',pattern:'^G[1-9][0-9]*$'},priority:{type:'integer',minimum:1,maximum:1000}},required:['goal','priority']},{validate:validate(priorityInput)}),execute:async input=>priorityDraft(snapshot,input)})
};}
