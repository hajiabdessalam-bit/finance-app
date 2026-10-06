import * as engine from '../app/core.mjs';
import type {Workspace,Scenario,JointForecast} from './types';
/** Narrow view types only after the authoritative runtime validator succeeds. */
export function verifiedWorkspace(value:unknown):Workspace {engine.validateState(value);return value as Workspace;}
export function cashLabel(state:Workspace,amount:number|null):string {return amount===null?'Balance check needed':new Intl.NumberFormat('en',{style:'currency',currency:state.currency}).format(amount/100);}
export function forecast(state:Workspace,scenario:Scenario):JointForecast {return engine.planGoals(state,scenario) as JointForecast;}
export {engine};
