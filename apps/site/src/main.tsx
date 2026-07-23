import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import PlaygroundPage from './PlaygroundPage'
import './site.css'
import './analytics'

// Two pages, one bundle: path decides which renders. /playground survives
// refresh via the SPA fallback rewrite in vercel.json (vite dev falls back
// to index.html on its own).
const Root = window.location.pathname.replace(/\/+$/, '') === '/playground' ? PlaygroundPage : App

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
