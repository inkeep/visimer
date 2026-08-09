---
'@visimer/dom': patch
---

Re-assert each canvas's mermaid config before it renders.

`mermaid.initialize()` writes a module-global config, so on a page with more
than one canvas the last one to mount owned it: every other canvas rendered
with the wrong theme and layout options from its second render onwards.
`render()` now re-asserts its own config instead of trusting whatever was
initialized in the constructor.
