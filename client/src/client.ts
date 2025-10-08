import { io, Socket } from "socket.io-client";
import readline from "readline";
// eslint-disable-next-line import/no-relative-parent-imports
import { GameState } from '../../server/src/wizard/types';

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";

type AnyState = unknown; // The server returns whatever GameEngine.getState() provides.

class WizardCliClient {
  private socket!: Socket;
  private rl!: readline.Interface;
  private lastState: GameState | null = null;
  private players: string[] = [];
  private showStates = true;

  start() {
    this.socket = io(SERVER_URL, { transports: ["websocket"], autoConnect: true });

    this.socket.on("connect", () => {
      console.log(`\nConnected → ${this.socket.id}`);
      console.log(`Auto-registering as your socket id...`);
      this.socket.emit("register", this.socket.id);
      this.prompt();
    });

    this.socket.on("connect_error", (err) => {
      console.error("Connect error:", err.message);
    });

    this.socket.on("disconnect", (reason) => {
      console.log("Disconnected:", reason);
    });

    this.socket.on("errorMessage", (msg: string) => {
      console.log(`\n[SERVER ERROR] ${msg}`);
      this.prompt();
    });

    this.socket.on("playersUpdated", (players: string[]) => {
      this.players = players;
      console.log("\n[playersUpdated]", players);
      this.prompt();
    });

    this.socket.on("gameStarted", () => {
      console.log("\n[gameStarted]");
      this.prompt();
    });

    this.socket.on("state", (state: AnyState) => {
      this.lastState = state;
      if (this.showStates) {
        console.log("\n[state update]\n" + this.pretty(state));
      }
      this.prompt();
    });

    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    this.rl.on("line", (line) => this.handleCommand(line.trim()))
           .on("close", () => { this.socket.close(); process.exit(0); });

    console.log(`\nWizard CLI → ${SERVER_URL}`);
    console.log("Type 'help' for commands.\n");
  }

  private prompt() { this.rl?.setPrompt("> "); this.rl?.prompt(); }

  private handleCommand(input: string) {
    const [cmd, ...args] = input.split(/\s+/);
    switch ((cmd || "").toLowerCase()) {
      case "help":
      case "h":
        this.printHelp();
        break;
      case "register":
      case "r":
        this.socket.emit("register", this.socket.id);
        console.log("Sent register with your socket id.");
        break;
      case "start":
      case "s":
        this.socket.emit("startGame");
        console.log("Sent startGame.");
        break;
      case "forecast":
      case "f": {
        const bid = Number(args[0]);
        if (!Number.isInteger(bid)) {
          console.log("Usage: forecast <integer>");
          break;
        }
        this.socket.emit("setForecast", { playerId: this.socket.id, bid });
        console.log(`Sent setForecast bid=${bid}.`);
        break;
      }
      case "trump":
      case "t": {
        const color = String(args[0]);
        this.socket.emit("selectTrump", { playerId: this.socket.id, color });
        console.log(`Sent selectTrump trump=${color}.`);
        break;
      }
      case "play":
      case "p": {
        const cardIndex = Number(args[0]);
        if (!Number.isInteger(cardIndex)) {
          console.log("Usage: play <cardIndex>");
          break;
        }
        if(!this.lastState) {
          break;
        }
        this.socket.emit("playCard", { playerId: this.socket.id, card: this.lastState.currentHand[cardIndex] });
        console.log(`Sent playCard index=${cardIndex}.`);
        break;
      }
      case "who":
        console.log("Players:", this.players.length ? this.players.join(", ") : "(none)");
        break;
      case "state":
        if (this.lastState == null) console.log("(no state yet)");
        else console.log(this.pretty(this.lastState));
        break;
      case "watch":
        this.showStates = !this.showStates;
        console.log(`Auto-print state updates: ${this.showStates ? "ON" : "OFF"}`);
        break;
      case "id":
        console.log("Your socket id:", this.socket.id);
        break;
      case "quit":
      case "exit":
      case "q":
        this.rl.close();
        return;
      case "":
        break;
      default:
        console.log(`Unknown command: ${cmd}. Type 'help'.`);
    }
    this.prompt();
  }

  private printHelp() {
    console.log(`\nCommands:
  help (h)             Show this help
  register (r)         Send 'register' with your socket id
  start (s)            Send 'startGame' (need ≥2 registered players)
  forecast (f) <n>     Send 'setForecast' with bid=n
  trump (t) <c>        Send 'setTrump' with color=c 
  play (p) <i>         Send 'playCard' with cardIndex=i
  who                  Show players from last 'playersUpdated'
  state                Print last received state JSON
  watch                Toggle auto-printing of state updates
  id                   Show your socket id
  quit | exit | q      Close the client
`);
  }

  private pretty(obj: unknown) {
    try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
  }
}

new WizardCliClient().start();
