import {Component,type ReactNode} from 'react';
export class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<main id="content"><h1>The preview could not display this workspace.</h1><p>This development page does not write financial records. Return to the main app to review your records or download a backup.</p><a className="button" href="./">Open the main app</a></main>:this.props.children;}
}
