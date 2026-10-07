export interface Account {id:string;name:string;kind:'asset'|'liability';currency:string;opening:number|null;baselineDate:string;baselineSeq:number;verified?:boolean;limit?:number}
export interface NoteItem {id?:string;text?:string;t?:string;body?:string;done?:boolean}
export interface Note {id:string;title?:string;body?:string;items?:NoteItem[];archived?:boolean;goal?:string}
export interface Goal {id:string;name:string;target:number;priority:number;archived?:boolean;protected?:boolean;desired?:string;recurringCost?:number;kind?:string;[key:string]:unknown}
export interface Reconciliation {id:string;account:string;date:string;balance:number;difference:number|null;status:'matched'|'unresolved'|'reviewed';note?:string;expected?:number|null;review?:{note:string;transactions:string[];at:string}}
export interface Transaction {id:string;seq:number;kind:string;date:string;amount:number;account:string;toAccount?:string;category?:string;note?:string;source?:string;historical?:boolean;reverses?:string;corrects?:string;splits?:{category:string;amount:number}[]}
export interface Category {id:string;name:string;type:string;archived?:boolean}
export interface Budget {id:string;key:string;salary:number;alloc:Record<string,number>;locks:Record<string,boolean>;[key:string]:unknown}
export interface Obligation {id:string;name:string;kind:'bill'|'income';amount:number;date:string;account:string;debtAccount?:string;budgetCategory?:string;paid?:boolean;skipped?:boolean;skipReason?:string;stopReason?:string;paidDate?:string;transaction?:string;templateId?:string;archived?:boolean;goal?:string;cancelAfter?:string;recurrence?:{unit:'monthly'|'weekly';interval:number;until?:string}}
export interface OutsideRecord {id:string;name:string;kind:string;amount:number;date:string;account?:string;due?:string;note?:string;returned?:number;transaction?:string;reversedBy?:string;source?:string;returns?:{id:string;amount:number;date:string;transaction:string;reversedBy?:string}[]}
export interface Workspace {
  schema:2;id:string;version:number;seq:number;currency:string;timezone:string;cycleStart:number;name:string;
  accounts:Account[];transactions:Transaction[];budgets:Budget[];categories:Category[];notes:Note[];goals:Goal[];reconciliations:Reconciliation[];obligations:Obligation[];outside:OutsideRecord[];
  cycleHistory:{id:string;start:number;effective:string;status:string}[];reservations:Record<string,number>;settings:{reserve:number;monthlyProtection:number;forecastPeriods:number};
  [key:string]:unknown;
}
export interface StoredWorkspace {state:Workspace|null;revision:number}
export interface EditDraft {id:string;at?:string;source?:string;type?:string;input?:unknown;reason?:string;[key:string]:unknown}
export type CommitEdit=(type:string,input:unknown,build:(state:Workspace)=>Workspace)=>Promise<boolean>;
export interface Scenario {mode:'budget'|'history'|'conservative';extraExpense:number;incomeChange:number;protection:number}
export interface GoalForecast {id:string;name:string;target:number;funded:number;remaining:number;ready:string|null;deadline:string;late:boolean}
export interface FundingRow {key:string;date:string;capacity:number;protected:number;pool:number;allocated?:number;shortage?:number}
export interface JointForecast {results:GoalForecast[];rows:FundingRow[];warnings:string[];assumptions:string[]}
