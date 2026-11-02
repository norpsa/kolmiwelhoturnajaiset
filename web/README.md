# Wizard web UI

Shows finished games with replays, how the bots are doing, and tournaments. Games appear when
they end, so that nobody can see hands while a game is running.

Creating and starting tournaments needs the organiser key, which is the server's `ADMIN_KEY`.
With no `ADMIN_KEY` set, nobody can create one.

## Running

To serve the UI from the game server:

```
npm install
npm run build
```

Then start the server, and open `http://localhost:3000`. The server finds `web/dist` by itself.

To work on the UI, start the game server and run `npm run dev`. Vite passes `/api` requests on
to port 3000.

`npm test` runs the tests.

## Where things are

- `src/replay/frames.ts` turns a game log into one snapshot per step. All replay logic is here.
- `src/pages/` has the pages.
- `src/types.ts` is a copy of what the server sends. Update it when those types change.
