import { useEffect, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import {
  EVENTS, usernameSchema,
  type ClientToServerEvents, type ServerToClientEvents, type LobbySnapshot,
} from "@ft/contracts";
import { fetchLobbyState, kickPlayer, LobbyApiError, register } from "./lobby/api";

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

export function App() {
  const [identity, setIdentity] = useState<GuestIdentity | null>(loadIdentity);
  const [username, setUsername] = useState("");
  const [snapshot, setSnapshot] = useState<LobbySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [kicking, setKicking] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>("disconnected");
  // The current socket effect owns refresh; button handlers call it through this ref.
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
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
      storeIdentity(null);
      setIdentity(null);
      setSnapshot(null);
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
        setConnection("joined");
        refresh(); // Catch up after being offline, even if events were missed.
      });
    });
    socket.on("disconnect", () => { if (!disposed) setConnection("disconnected"); });
    socket.on("connect_error", () => { if (!disposed) setConnection("disconnected"); });
    // WebSocket messages carry only a revision notice; HTTP fetches the roster.
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


  return (
    <main className="page">
      <h1>Skyjo (prototype)</h1>
      <p> no cards for now </p>

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
            <p className="hint">Player lists update automatically while connected, this button is useless</p>
            {snapshot ? (
              <>
                <p>{snapshot.players.length} registered player(s) · Revision {snapshot.revision}</p>
                <ol className="players">
                  {snapshot.players.map((player) => (
                    <li key={player.id}>
                      <span>{player.username}{player.isAdmin ? " (admin)" : ""}
                        {player.id === identity.playerId ? " (you)" : ""}</span>
                      {snapshot.you.isAdmin && player.id !== identity.playerId && (
                        <button type="button" disabled={kicking !== null}
                          onClick={() => { void onKick(player.id); }}>
                          {kicking === player.id ? "Kicking…" : "Kick"}
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              </>
            ) : <p role="status">Loading lobby… (what's happening here ?)</p>}
          </>
        )}
        {error && <p role="alert" className="error">{error}</p>}
      </section>
    </main>
  );
}
