import { randomInt, randomUUID } from "node:crypto";
import type { SkyjoCommand, SkyjoPublicCard, SkyjoSnapshot } from "@ft/contracts";
import { LobbyError } from "../lobby/errors.js";
import type { ActiveMatch, MatchService, SkyjoPrivateState, StartMatchInput } from "./types.js";

type Seat = SkyjoPrivateState["seats"][number];
const fail = (message: string): never => { throw new LobbyError("ILLEGAL_MOVE", message, 409); };

export function makeDeck(): number[] {
  return Array.from({ length: 15 }, (_, i) => i - 2)
    .flatMap(value => Array<number>(value === -2 ? 5 : value === 0 ? 15 : 10).fill(value));
}
function shuffle(cards: number[]): number[] {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j]!, cards[i]!];
  }
  return cards;
}
const hidden = (seat: Seat) => seat.board.filter(card => card && !card.revealed).length;
const sum = (seat: Seat) => seat.board.reduce((total, card) => total + (card?.value ?? 0), 0);

//Represents a single game of Skyjo
//Owns the game state and handles the match from the initial deal to final scoring
//
//State changes are made by player commands through command() which validates the player and 
//	expected revision before delegating to the appropriate game logic.
//Each successful command increments the match revision.
//
//snapshotFor() exposes a personalized view of the game state so hidden game state infos aren't shared
//Match creation, lifecycle management and snapshot distribution are handled externally
class SkyjoMatch implements ActiveMatch {
  private readonly state: SkyjoPrivateState;
  private readonly shuffleCards: typeof shuffle;

  constructor(input: StartMatchInput, shuffleCards: typeof shuffle) {
    if (input.seats.length < 2 || input.seats.length > 8 || new Set(input.seats.map(s => s.playerId)).size !== input.seats.length) {
      throw new LobbyError("PLAYER_COUNT", "Skyjo requires 2–8 guests.", 409);
    }
    this.state = {
      matchId: randomUUID(), roomId: input.roomId, revision: 0, roundNumber: 0,
      phase: { kind: "setup" }, seats: input.seats.map(seat => ({ ...seat, board: [], totalScore: 0 })),
      drawPile: [], discardPile: [], pendingDraw: null, finisherId: null, history: [],
    };
    this.shuffleCards = shuffleCards;
    this.deal();
  }
  
  get matchId(): string {
    return this.state.matchId;
  }

  get isFinished(): boolean {
    return this.state.phase.kind === "match-end";
  }

  get roomId(): string {
    return this.state.roomId;
  }

  private deal() {
    this.state.roundNumber++;
    this.state.drawPile = this.shuffleCards(makeDeck());
    for (const seat of this.state.seats) {
      seat.board = Array.from({ length: 12 }, () => ({ value: this.state.drawPile.pop()!, revealed: false }));
    }
    this.state.discardPile = [this.state.drawPile.pop()!];
    this.state.pendingDraw = null;
    this.state.finisherId = null;
    this.state.phase = { kind: "setup" };
  }
  private turn(playerId: string) { this.state.phase = { kind: "turn", playerId, step: "draw" }; }
  private removeColumns(seat: Seat) {
    for (let c = 0; c < 4; c++) {
      const indices = [c, c + 4, c + 8];
      const cards = indices.map(i => seat.board[i]);
      const first = cards[0];
      if (first?.revealed && cards.every(card => card?.revealed && card.value === first.value)) {
        for (const i of indices) { this.state.discardPile.push(first.value); seat.board[i] = null; }
      }
    }
  }
  private score() {
    for (const seat of this.state.seats) {
      for (const card of seat.board) if (card) card.revealed = true;
      this.removeColumns(seat);
    }
    const scores = this.state.seats.map(seat => ({ playerId: seat.playerId, raw: sum(seat), awarded: sum(seat) }));
    const ender = scores.find(s => s.playerId === this.state.finisherId)!;
    if (ender.raw > 0 && scores.some(s => s !== ender && s.raw <= ender.raw)) ender.awarded *= 2;
    for (const seat of this.state.seats) seat.totalScore += scores.find(s => s.playerId === seat.playerId)!.awarded;
    this.state.history.push({ roundNumber: this.state.roundNumber, finisherId: this.state.finisherId!, scores });
    this.state.phase = { kind: this.state.seats.some(s => s.totalScore >= 100) ? "match-end" : "round-end" };
  }
  private finishTurn(seat: Seat) {
    this.removeColumns(seat);
    if (!this.state.finisherId && hidden(seat) === 0) this.state.finisherId = seat.playerId;
    const next = this.state.seats[(this.state.seats.indexOf(seat) + 1) % this.state.seats.length]!;
    if (next.playerId === this.state.finisherId) this.score();
    else this.turn(next.playerId);
  }
  private refill() {
    if (this.state.drawPile.length === 0 && this.state.discardPile.length > 1) {
      const top = this.state.discardPile.pop()!;
      this.state.drawPile = this.shuffleCards(this.state.discardPile);
      this.state.discardPile = [top];
    }
  }
  //apply() validates and applies a gameplay command according to the current phase, active player and turn step
  private apply(seat: Seat, command: SkyjoCommand) {
    const phase = this.state.phase;
    if (phase.kind === "round-end" && command.type === "next-round") { this.deal(); return; }
    if (phase.kind === "setup") {
      if (command.type !== "reveal") return fail("Reveal two of your own cards to start.");
      const card = seat.board[command.slotIndex];
      if (!card || card.revealed || hidden(seat) <= 10) return fail("Choose an unrevealed setup card.");
      card.revealed = true;
      if (this.state.seats.every(s => hidden(s) === 10)) {
        const starter = this.state.roundNumber === 1
          ? this.state.seats.reduce((best, s) => {
              const visible = (x: Seat) => x.board.reduce((n, c) => n + (c?.revealed ? c.value : 0), 0);
              return visible(s) > visible(best) ? s : best;
            }).playerId
          : this.state.history.at(-1)!.finisherId;
        this.turn(starter);
      }
      return;
    }
    if (phase.kind !== "turn" || phase.playerId !== seat.playerId) return fail("It is not your turn.");
    if (phase.step === "draw" && command.type === "draw") {
      if (command.source === "deck") this.refill();
      const pile = command.source === "deck" ? this.state.drawPile : this.state.discardPile;
      const value = pile.pop();
      if (value === undefined) return fail("That pile is empty.");
      this.state.pendingDraw = { playerId: seat.playerId, source: command.source, value };
      this.state.phase = { ...phase, step: "resolve-draw" };
      return;
    }
    if (phase.step === "resolve-draw" && this.state.pendingDraw) {
      if (command.type === "swap") {
        const card = seat.board[command.slotIndex];
        if (!card) return fail("Choose a card that has not been removed.");
        seat.board[command.slotIndex] = { value: this.state.pendingDraw.value, revealed: true };
        this.state.discardPile.push(card.value);
        this.state.pendingDraw = null;
        this.finishTurn(seat);
        return;
      }
      if (command.type === "discard" && this.state.pendingDraw.source === "deck" && hidden(seat) > 0) {
        this.state.discardPile.push(this.state.pendingDraw.value);
        this.state.pendingDraw = null;
        this.state.phase = { ...phase, step: "reveal" };
        return;
      }
    }
    if (phase.step === "reveal" && command.type === "reveal") {
      const card = seat.board[command.slotIndex];
      if (!card || card.revealed) return fail("Choose a hidden card.");
      card.revealed = true;
      this.finishTurn(seat);
      return;
    }
    fail("That action is not allowed at this step.");
  }

  //Builds a viewer-specific snapshot of the match
  snapshotFor(playerId: string): SkyjoSnapshot {
    const pending = this.state.pendingDraw;
    return {
      matchId: this.state.matchId, roomId: this.state.roomId, revision: this.state.revision,
      public: {
        roundNumber: this.state.roundNumber, phase: { ...this.state.phase },
        seats: this.state.seats.map(({ board, ...seat }) => ({ ...seat, board: board.map((card): SkyjoPublicCard =>
          !card ? { kind: "removed" } : card.revealed ? { kind: "revealed", value: card.value } : { kind: "hidden" }) })),
        drawPileCount: this.state.drawPile.length, discardTop: this.state.discardPile.at(-1) ?? null,
        finisherId: this.state.finisherId, history: structuredClone(this.state.history),
      },
      you: this.state.seats.some(s => s.playerId === playerId) ? { playerId, drawnCard: pending?.playerId === playerId
        ? { source: pending.source, value: pending.value } : null } : null,
    };
  }

  //Processes a player action against the current match revision, and rejects unauthorized, stale or illegal actions
  //Returns the updated revision on success
  command(playerId: string, expectedRevision: number, command: SkyjoCommand): number {
    const seat = this.state.seats.find(s => s.playerId === playerId);
    if (!seat) throw new LobbyError("FORBIDDEN", "Spectators cannot play.", 403);
    if (expectedRevision !== this.state.revision) throw new LobbyError("STALE_REVISION", "State changed; try again.", 409);
    this.apply(seat, command);
    return ++this.state.revision;
  }
}

export function createMatch(input: StartMatchInput, shuffleCards = shuffle): ActiveMatch {
  return new SkyjoMatch(input, shuffleCards);
}

//factory function returning a MatchService object owning a reference to an occuring match
export function createMatchService(onStart: (match: ActiveMatch) => void): MatchService {
  let activeMatch: ActiveMatch | null = null;
  return {
    get activeMatch() { return activeMatch; },
    async startMatch(input) {
      if (activeMatch && activeMatch.snapshotFor("").public.phase.kind !== "match-end") return { matchId: activeMatch.matchId };
      activeMatch = createMatch(input);
      onStart(activeMatch);
      return { matchId: activeMatch.matchId };
    },
  };
}
