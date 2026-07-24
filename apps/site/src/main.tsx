import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import HeroLoopPage from './HeroLoopPage'
import PlaygroundPage from './PlaygroundPage'
import './site.css'
import './analytics'

// Two pages, one bundle: path decides which renders. /playground survives
// refresh via the SPA fallback rewrite in vercel.json (vite dev falls back
// to index.html on its own). /hero-loop is a dev-only capture target for
// the README animation.
const path = window.location.pathname.replace(/\/+$/, '')
const Root = path === '/playground' ? PlaygroundPage : path === '/hero-loop' ? HeroLoopPage : App

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
