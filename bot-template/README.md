# Wizard bot template

Write your game logic in `strategy.js`. Everything else, such as the connection, your token
and checking that moves are legal, is already handled. Out of the box the bot plays random
legal moves.

## Quick start

You need Node 18 or newer and a running server.

```
npm install
node bot.js --name MyBot --players 3
```

A game needs at least 3 bots. To try the template alone, open two more terminals and start
bots with other names.

| Option            | Meaning                                                                   |
| ----------------- | ------------------------------------------------------------------------- |
| `--name <name>`   | Name of your bot, 1-32 characters. You can also set `BOT_NAME`.           |
| `--players <3-6>` | Play at a table that starts by itself at this many players.               |
| `--games <n>`     | How many games to play in a row. Default 1.                               |
| `--server <url>`  | Server address. You can also set `SERVER_URL`. Default `http://localhost:3000`. |

## Starting a game

The server picks the table for your bot.

- With `--players 4`, the game starts when the table has 4 bots.
- Without `--players`, press Enter in the terminal to start the game once at least 3 bots are
  at the table. Any bot at the table can do this.
- A table with no chosen count also starts by itself: 5 seconds after it reaches 4 bots, or at
  once with 6.

## Your name and token

The first bot to use a name claims it, and the server gives it a token. The token is saved in
`.tokens/`, and the bot uses it automatically from then on.

**Keep this folder, or at least your token.** It is shown only once and can't be recovered,
and without it you can't use your name again or keep your record. Don't commit `.tokens/`.

## Writing a strategy

`strategy.js` has three functions. Each gets a `view` and returns your move. They can be async.

| Function            | When it is called                                   | Return                     |
| ------------------- | --------------------------------------------------- | -------------------------- |
| `chooseTrump(view)` | The trump card is a Wizard and you are the dealer   | One of `view.colors`       |
| `chooseBid(view)`   | It is your turn to bid                              | One of `view.legalBids`    |
| `chooseCard(view)`  | It is your turn to play a card                      | One of `view.legalCards`   |

If a function throws or returns an illegal move, the bot logs it and plays a random legal move.

A simple example that bids the number of Wizards in hand:

```js
export function chooseBid(view) {
  const wizards = view.hand.filter((card) => card.rank === 'Z').length;
  return view.legalBids.includes(wizards) ? wizards : view.legalBids[0];
}
```

### What is in `view`

| Field           | Contents                                                                     |
| --------------- | ---------------------------------------------------------------------------- |
| `me`            | `{ id, name }` of your bot                                                   |
| `hand`          | Your cards                                                                   |
| `legalBids`     | Bids you can make now, empty if you aren't bidding                           |
| `legalCards`    | Cards you can play now, empty if you aren't playing a card                   |
| `colors`        | All four colors                                                              |
| `trumpColor`    | The trump color, or `null` if the round has no trump                         |
| `trick`         | The trick being played, or `null` if you lead it                             |
| `roundNumber`   | The current round, which is also how many tricks it has                      |
| `totalRounds`   | How many rounds the game has                                                 |
| `round`         | All of the current round: `forecasts`, `tricks`, `tricksWon`, `trump`        |
| `previousRound` | The same for the round before, or `null` in the first round                  |
| `players`       | `{ id, name, tricksTaken, tricksForecasted, cardsInHand }` for each bot      |
| `scores`        | Points so far by bot id                                                      |
| `state`         | The whole state as the server sent it                                        |

A card is `{ rank, color }`. `rank` is 1-13, `'Z'` for a Wizard or `'N'` for a Jester. Wizards
and Jesters have no `color`. The colors are `humans`, `dwarves`, `elves` and `giants`.

A trick is `{ id, plays: [{ playerId, card }], trickColor, winner }`. `playerId` and the keys of
`forecasts`, `tricksWon` and `scores` are bot ids, so compare them to `view.me.id`.

## Rules

- A game has 3-6 players and 60 / players rounds. Round 1 has 1 card each, round 2 has 2, and
  so on.
- After dealing, the next card sets the trump color. A Jester means no trump, and so does the
  last round, where no cards are left. A Wizard means the dealer chooses the trump color.
- Everyone bids how many tricks they will take. The last bid of a round can't make the bids add
  up to the number of tricks.
- You must follow the color of the trick if you can. A Wizard or Jester can always be played.
- The first Wizard wins the trick. Otherwise the highest trump wins, then the highest card of
  the trick's color. If everyone plays a Jester, the first one wins.
- If a trick starts with a Wizard, there is no color to follow. If it starts with a Jester, the
  first colored card sets the color.
- A correct bid scores 20 points + 10 per trick. A wrong one loses 10 points per trick it was
  off by.

## Time limits

You have 10 seconds per move. After that you use your extra time, 60 seconds in total for the
game. When that is gone too, the server plays a move for you, and from then on you have 10
seconds per move.

If your bot loses its connection it reconnects and gets its seat back, and the clock keeps
running in the meantime. Connecting the same bot twice closes the older connection.

## Results

When a game ends the bot prints its points and place, and the server records the result.
`GET /leaderboard` on the server shows how all bots are doing, for example
`http://localhost:3000/leaderboard`. Bots are ranked by how large a share of their opponents
they beat, because scores can't be compared between table sizes.
