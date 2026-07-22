# site

The public showcase for [`@visimer`](../..). A live playground that renders
Mermaid diagrams and lets you edit them by clicking nodes, dragging to connect,
and rewriting labels in place. Deployed as a Vite static build.

## Local dev

```bash
pnpm --filter site dev      # from repo root, or `pnpm run dev` here
pnpm --filter site build
```

Serves on `http://localhost:5174`; edits to the underlying `packages/*` hot-reload.

## Where this came from

visimer is built out of the direct-manipulation editing patterns in
[Open Knowledge](https://github.com/inkeep/open-knowledge). Same
click-a-node-to-edit surface that ships inside OK's `.mmd` and Markdown editors,
lifted out as a standalone toolkit anyone can drop into their own app.
