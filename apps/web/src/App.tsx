import { useEffect, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import {
  EVENTS, usernameSchema,
  type ClientToServerEvents, type ServerToClientEvents, type LobbySnapshot, type SkyjoSnapshot, type SkyjoCommand,
} from "@ft/contracts";
import { MatchView } from "./game/MatchView";
import { fetchLobbyState, kickPlayer, LobbyApiError, register, startMatch } from "./lobby/api";

//Browser storage holds the raw token, while PostgreSQL stores only its hash
//Tabs in the same browser profile therefore represent the same guest
type GuestIdentity = { playerId: string; token: string };
type LobbySocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type ConnectionStatus = "disconnected" | "joining" | "joined";
const STORAGE_KEY = "skyjo:guest:demo";

function loadIdentity(): GuestIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "playerId" in parsed &&
        "token" in parsed && typeof parsed.playerId === "string" &&
        typeof parsed.token === "string" && /^[a-f0-9]{64}$/.test(parsed.token)) {
      return { playerId: parsed.playerId, token: parsed.token };
    }
  } catch { /* storage can be disabled or contain malformed data*/ }
  return null;
}

function storeIdentity(identity: GuestIdentity | null): void {
  try {
    if (identity) localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* this tab can still participate even without persistent storage. */ }
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

//main function for React, describes the Skyjo page
export function App() {
  const [identity, setIdentity] = useState<GuestIdentity | null>(loadIdentity);
  const [username, setUsername] = useState("");
  const [snapshot, setSnapshot] = useState<LobbySnapshot | null>(null);
  const [gameSnapshot, setGameSnapshot] = useState<SkyjoSnapshot | null>(null);
  const [starting, setStarting] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [kicking, setKicking] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>("disconnected");
  // The current socket effect owns refresh; button handlers call it through this ref.
  const socketRef = useRef<LobbySocket | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);
  const commandPending = useRef(false);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    setGameSnapshot(null);
    setMatchError(null);
    commandPending.current = false;
    setCommandBusy(false);
    if (!identity) {
      setSnapshot(null);
      setConnection("disconnected");
      refreshRef.current = () => {};
      return;
    }

    let disposed = false;
    let requestNumber = 0;
    const { token, playerId } = identity;

    function forgetIdentity(message: string) {
      if (disposed) return;
      disposed = true;
      storeIdentity(null);
      setIdentity(null);
      setSnapshot(null);
      setGameSnapshot(null);
      setError(message);
    }

    function refresh() {
      // If two requests overlap, ignore the response of the older request.
      // This prevents a slow HTTP response from rolling the lobby back.
      const currentRequest = ++requestNumber;
      setRefreshing(true);
      void fetchLobbyState(token).then((state) => {
        if (disposed || currentRequest !== requestNumber) return;
        if (state.you.id !== playerId) {
          forgetIdentity("Your saved identity does not match the server. Register again.");
          return;
        }
		//tells React to update what browser display on new snapshot
        setSnapshot(state);
        setError(null);
      }).catch((cause: unknown) => {
        if (disposed || currentRequest !== requestNumber) return;
        if (cause instanceof LobbyApiError && cause.code === "UNAUTHORIZED") {
          forgetIdentity("Your guest identity is no longer registered. Please join again.");
        } else {
          setError(`Cannot refresh lobby: ${messageFor(cause)}`);
        }
      }).finally(() => {
        if (!disposed && currentRequest === requestNumber) setRefreshing(false);
      });
    }
    refreshRef.current = refresh;

    // The transport reconnects automatically, Every new connection must join the authenticated lobby again
    const socket: LobbySocket = io({ path: "/socket.io", autoConnect: false });
    socketRef.current = socket;
    function receiveSnapshot(next: SkyjoSnapshot) {
      if (disposed) return;
      setGameSnapshot((previous) =>
        previous?.matchId === next.matchId && previous.revision > next.revision ? previous : next
      );
      setMatchError(null);
    }

    socket.on(EVENTS.GAME_SNAPSHOT, receiveSnapshot);
    socket.on("connect", () => {
      if (disposed) return;
      setConnection("joining");
      socket.emit(EVENTS.LOBBY_JOIN, { token }, (ack) => {
        if (disposed) return;
        if (!ack.ok) {
          setConnection("disconnected");
          if (ack.error.code === "UNAUTHORIZED") {
            forgetIdentity("Your guest identity has expired. Please join again.");
          } else {
            setError(ack.error.message);
          }
          return;
        }
        if (ack.data.playerId !== playerId) {
          forgetIdentity("Your saved identity does not match the server. Register again.");
          return;
        }
        setConnection("joined");
        const { activeMatchId } = ack.data;
        if (activeMatchId) {
          socket.emit(EVENTS.GAME_SUBSCRIBE, { matchId: activeMatchId }, (result) => {
            if (disposed) return;
            if (result.ok) receiveSnapshot(result.data);
            else setMatchError(result.error.message);
          });
        } else {
          setGameSnapshot(null);
          setMatchError(null);
        }
        refresh(); // Catch up after being offline, even if events were missed.
      });
    });
    socket.on("disconnect", () => { if (!disposed) setConnection("disconnected"); });
    socket.on("connect_error", () => { if (!disposed) setConnection("disconnected"); });
    // Lobby revision notices trigger an HTTP roster refresh.
    socket.on(EVENTS.LOBBY_CHANGED, () => { if (!disposed) refresh(); });
    socket.on(EVENTS.LOBBY_KICKED, () => {
      forgetIdentity("The administrator removed you from the lobby.");
    });
    socket.connect();
    refresh(); // Remain usable even if Socket.io Cannot connect right now.

    return () => {
      disposed = true;
      requestNumber++;
      refreshRef.current = () => {};
      socketRef.current = null;
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [identity]);

  async function onRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    // Share the same runtime validation rules as Express, before making a request
    const checked = usernameSchema.safeParse(username);
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? "Invalid username");
      return;
    }
    setBusy(true);
    try {
      const credentials = await register(checked.data);
      const next = { playerId: credentials.playerId, token: credentials.token };
      storeIdentity(next);
      setIdentity(next);
      setUsername("");
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onKick(playerId: string) {
    if (!identity || kicking) return;
    setKicking(playerId);
    setError(null);
    try {
      // Frontend button is just UX, the service performs the real permission check.
      await kickPlayer(identity.token, playerId);
      refreshRef.current();
    } catch (cause) {
      setError(`Kick failed: ${messageFor(cause)}`);
    } finally {
      setKicking(null);
    }
  }

  function onCommand(command: SkyjoCommand) {
    const socket = socketRef.current;
    if (!socket?.connected || connection !== "joined" || !gameSnapshot || commandPending.current) return;
    commandPending.current = true;
    setCommandBusy(true);
    setMatchError(null);
    socket.timeout(5000).emit(EVENTS.GAME_COMMAND, {
      matchId: gameSnapshot.matchId, expectedRevision: gameSnapshot.revision, command,
    }, (err, ack) => {
      if (socketRef.current !== socket) return;
      commandPending.current = false;
      setCommandBusy(false);
      if (err) {
        setMatchError("Command acknowledgement timed out. Resynchronizing…");
        socket.disconnect().connect();
      } else if (!ack.ok) setMatchError(ack.error.message);
    });
  }

  async function onStartMatch() {
    if (!identity || starting) return;
    setStarting(true);
    setMatchError(null);
    try {
      await startMatch(identity.token);
    } catch (cause) {
      setMatchError(`Cannot start match: ${messageFor(cause)}`);
    } finally {
      setStarting(false);
    }
  }

  return (
    <main className="page">
      <h1>Skyjo</h1>

      <section>
        <h2>Lobby</h2>
        {!identity ? (
          <form onSubmit={(event) => { void onRegister(event); }}>
            <label htmlFor="username">Guest username</label>{" "}
            <input id="username" value={username} onChange={(event) => setUsername(event.target.value)}
              minLength={2} maxLength={20} required autoComplete="off" />{" "}
            <button disabled={busy} type="submit">{busy ? "Joining…" : "Join lobby"}</button>
          </form>
        ) : (
          <>
            <p>Signed in as <strong>{snapshot?.you.username ?? "guest"}</strong>
              {snapshot?.you.isAdmin ? " (admin)" : ""}.</p>
            <p className="connection" role="status">Live connection: {connection}</p>
            <button type="button" onClick={() => refreshRef.current()} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh players"}
            </button>
            {snapshot ? (
              <>
                <p>{snapshot.players.length} registered player(s) · Revision {snapshot.revision}</p>
                <ol className="players">
                  {snapshot.players.map((player) => (
                    <li key={player.id}>
                      <span>{player.username}{player.isAdmin ? " (admin)" : ""}
                        {player.id === identity.playerId ? " (you)" : ""}</span>
                      {snapshot.you.isAdmin && player.id !== identity.playerId && (
                        <button type="button" disabled={kicking !== null || (!!gameSnapshot && gameSnapshot.public.phase.kind !== "match-end" && gameSnapshot.public.seats.some(seat => seat.playerId === player.id))}
                          onClick={() => { void onKick(player.id); }}>
                          {kicking === player.id ? "Kicking…" : "Kick"}
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
                {snapshot.you.isAdmin && (!gameSnapshot || gameSnapshot.public.phase.kind === "match-end") && (
                  <button type="button" onClick={onStartMatch}
                    disabled={starting || connection !== "joined" || snapshot.players.length < 2 || snapshot.players.length > 8}>
                    {starting ? "Starting…" : "Start match (2–8 guests)"}
                  </button>
                )}
              </>
            ) : <p role="status">Loading lobby…</p>}
          </>
        )}
        {(error || matchError) && <p role="alert" className="error">{error ?? matchError}</p>}
      </section>
      {identity && gameSnapshot && <MatchView snapshot={gameSnapshot} onCommand={onCommand} disabled={commandBusy || connection !== "joined"} />}
    </main>
  );
}
