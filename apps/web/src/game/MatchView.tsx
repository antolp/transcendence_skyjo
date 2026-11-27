import type { SkyjoCommand, SkyjoSnapshot } from "@ft/contracts";

export function MatchView({ snapshot, onCommand, disabled }: {
  snapshot: SkyjoSnapshot; onCommand(command: SkyjoCommand): void; disabled: boolean;
}) {
  const { public: state, you } = snapshot;
  const { phase, seats } = state;
  const me = seats.find(seat => seat.playerId === you?.playerId);
  const myTurn = phase.kind === "turn" && phase.playerId === you?.playerId;
  const hidden = me?.board.filter(card => card.kind === "hidden").length ?? 0;
  const name = (id: string) => seats.find(seat => seat.playerId === id)?.username ?? id;
  const draw = you?.drawnCard;
  const winners = seats.filter(seat => seat.totalScore === Math.min(...seats.map(s => s.totalScore)));
  return (
    <section>
      <h2>Round {state.roundNumber}</h2>
      {!me && <p>You are spectating. Join the next match to play.</p>}
      {phase.kind === "setup" && <p>{me && hidden > 10 ? `Reveal ${hidden - 10} of your cards.` : "Waiting for initial reveals."}</p>}
      {phase.kind === "turn" && <p><strong>{name(phase.playerId)}'s turn.</strong>{" "}
        {myTurn ? phase.step === "draw" ? "Choose a pile." : phase.step === "resolve-draw" ? "Choose a card to replace, or discard a deck draw." : "Reveal one hidden card." : "Waiting…"}</p>}
      {state.finisherId && phase.kind === "turn" && <p>Final turns: {name(state.finisherId)} finished first.</p>}
      {phase.kind === "round-end" && <p>Round complete. <button disabled={disabled || !me} onClick={() => onCommand({ type: "next-round" })}>Next round</button></p>}
      {phase.kind === "match-end" && <h3>Winner{winners.length > 1 ? "s" : ""}: {winners.map(s => `${s.username} (${s.totalScore})`).join(", ")}</h3>}
      <div className="piles">
        <button disabled={disabled || !myTurn || phase.kind !== "turn" || phase.step !== "draw"} onClick={() => onCommand({ type: "draw", source: "deck" })}>Draw deck ({state.drawPileCount || "recycle"})</button>{" "}
        <button disabled={disabled || !myTurn || phase.kind !== "turn" || phase.step !== "draw" || state.discardTop === null} onClick={() => onCommand({ type: "draw", source: "discard" })}>Take discard ({state.discardTop ?? "empty"})</button>
      </div>
      {draw && <p>Held card: <strong>{draw.value}</strong> ({draw.source}) {draw.source === "deck" && <button disabled={disabled} onClick={() => onCommand({ type: "discard" })}>Discard and reveal</button>}</p>}
      {seats.map(seat => <div key={seat.playerId} className="board-section">
        <h3>{seat.username}{seat === me ? " (you)" : ""} · Total {seat.totalScore}</h3>
        <div className="board">{seat.board.map((card, slotIndex) => {
          const canReveal = seat === me && card.kind === "hidden" && ((phase.kind === "setup" && hidden > 10) || (myTurn && phase.kind === "turn" && phase.step === "reveal"));
          const canSwap = seat === me && card.kind !== "removed" && myTurn && phase.kind === "turn" && phase.step === "resolve-draw";
          return <button key={slotIndex} className={`card ${card.kind}`} aria-label={`Slot ${slotIndex + 1}: ${card.kind === "revealed" ? card.value : card.kind}`} disabled={disabled || !(canReveal || canSwap)} onClick={() => onCommand({ type: canSwap ? "swap" : "reveal", slotIndex })}>{card.kind === "hidden" ? "?" : card.kind === "removed" ? "—" : card.value}</button>;
        })}</div>
      </div>)}
      {!!state.history?.length && <><h3>Score history</h3><table><thead><tr><th>Round</th>{seats.map(s => <th key={s.playerId}>{s.username}</th>)}</tr></thead><tbody>{state.history.map(r => <tr key={r.roundNumber}><th>{r.roundNumber}</th>{seats.map(s => { const score = r.scores.find(x => x.playerId === s.playerId)!; return <td key={s.playerId}>{score.awarded}{score.raw !== score.awarded ? ` (${score.raw} × 2)` : ""}</td>; })}</tr>)}</tbody></table></>}
    </section>
  );
}
