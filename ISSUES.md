# Future issues

## Player chooses the player count for the game

A player can give the number of players they want in the game when registering.
The game starts automatically when the table has that many players, so nobody
has to send `startGame`.

Today a game starts automatically only at 6 players. Tables of 3–5 players wait
until someone sends `startGame`, and wait forever if nobody does.

Things to work out:

- The count must be 3–6, and invalid values are rejected.
- Which table a player is seated at when players want different counts. For
  example, each count could have its own open table.
- What happens to players who give no count.
- Whether `startGame` is still needed.
