import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import {ErrorBoundary} from './components/ErrorBoundary';
const root=document.querySelector('#app');
if(!root)throw new Error('The app root is missing.');
createRoot(root).render(<StrictMode><ErrorBoundary><App/></ErrorBoundary></StrictMode>);
