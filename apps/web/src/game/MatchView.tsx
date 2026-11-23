import type { SkyjoSnapshot } from "@ft/contracts";

export function MatchView({ snapshot }: { snapshot: SkyjoSnapshot }) {
  return (
    <section>
      <h2>Match</h2>
      <pre>{JSON.stringify(snapshot, null, 2)}</pre>
    </section>
  );
}
