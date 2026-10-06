import type {Workspace} from '../types';
import {engine,cashLabel} from '../domain';
export function Overview({state}:{state:Workspace}){
  const summary=engine.summary(state),key=engine.workspacePeriod(state,engine.today(state.timezone)),dates=engine.workspacePeriodDates(state,key),next=engine.periodForecast(state,engine.addMonths(key,1));
  return <><h1>{state.name?`Your next move, ${state.name}.`:'Your money, in view.'}</h1><p>{dates.from} – {dates.to}</p>
    {summary.missing&&<div className="notice">Confirm bank and wallet balances before treating forecasts as available money.</div>}
    <section className="hero"><div className="eyebrow">Unreserved cash today</div><div className={`big ${summary.available!==null&&summary.available<0?'negative':''}`}>{cashLabel(state,summary.available)}</div><p>After goal reservations and your protected reserve. Bill timing still needs a purchase check.</p></section>
    <div className="stats">{[['Liquid cash',summary.cash],['Goal reservations',summary.reserved],['Outstanding debt',summary.debt]].map(([label,amount])=><section className="card" key={String(label)}><small>{label}</small><div className="number">{cashLabel(state,amount as number|null)}</div></section>)}</div>
    <section className="card"><h2>Next period’s capacity</h2><div className={`number ${next.capacity<0?'negative':''}`}>{cashLabel(state,next.capacity)}</div><p>Budget assumption: {cashLabel(state,next.income)} income minus normal spending, buffer and committed costs.</p>{next.requiresReview&&<p className="negative">Review the transition-period budget before relying on this forecast.</p>}</section>
  </>;
}
