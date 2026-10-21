import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';
import './Workbench.css';
import './MissionHome.css';
import './MissionProgress.css';
import './InteractionDesign.css';

class AppBoundary extends Component<{ children: ReactNode }, { message?: string }> {
  state: { message?: string } = {};
  static getDerivedStateFromError(error: Error) { return { message: error.message }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Keep personal data out of console diagnostics. */ }
  render() {
    if (this.state.message) return <div className="loading-page"><h2>界面遇到了一个问题</h2><p>{this.state.message}</p><button className="button button-primary" onClick={() => window.location.reload()}>重新载入</button></div>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><AppBoundary><App /></AppBoundary></StrictMode>);
