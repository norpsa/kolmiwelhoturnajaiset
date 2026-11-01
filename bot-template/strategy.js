// Your game logic goes here. This is the only file you need to edit.
//
// Each function gets a `view` of the game and returns your move. See README.md for
// everything in `view`. The functions can be async, but the clock is running.
//
// By default the bot picks a random legal move. If a function throws or returns an illegal
// move, the bot logs it and plays a random legal move instead.

const pickRandom = (options) => options[Math.floor(Math.random() * options.length)];

// The trump card was a Wizard and you are the dealer. Return a color from view.colors.
export function chooseTrump(view) {
  return pickRandom(view.colors);
}

// Return how many tricks you think you will take, a number from view.legalBids.
export function chooseBid(view) {
  return pickRandom(view.legalBids);
}

// Return the card to play, one of view.legalCards.
export function chooseCard(view) {
  return pickRandom(view.legalCards);
}
