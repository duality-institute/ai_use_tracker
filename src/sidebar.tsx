import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { UsageService } from "./core/service";
import { assertNever, type ProviderView } from "./core/types";

function percent(used: number): string {
  return used > 0 && used < 1 ? "<1%" : `${Math.floor(Math.max(0, used))}%`;
}

function resetLabel(iso: string | null, now: number): string {
  if (iso === null) return "unknown";
  const minutes = Math.ceil((Date.parse(iso) - now) / 60_000);
  if (minutes <= 0) return "due";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function statusNote(provider: ProviderView): string | null {
  switch (provider.status) {
    case "ready": return null;
    case "loading": return "Checking limits…";
    case "signed-out": return `${provider.message ?? "Not signed in."}\nUse /connect.`;
    case "expired": return provider.message;
    case "error": return provider.message ?? "Couldn't check limits. Try Refresh.";
    default: return assertNever(provider.status);
  }
}

export function UsageSidebar(props: {
  readonly service: UsageService;
  readonly theme: { readonly current: Pick<TuiThemeCurrent, "text" | "textMuted" | "primary" | "warning" | "error" | "backgroundPanel" | "backgroundElement" | "border" | "borderActive"> };
}) {
  const [state, setState] = createSignal(props.service.getState());
  const [now, setNow] = createSignal(Date.now());
  const [width, setWidth] = createSignal(0);
  const [refreshHovered, setRefreshHovered] = createSignal(false);
  const [refreshPressed, setRefreshPressed] = createSignal(false);
  const theme = () => props.theme.current;
  const label = (name: string) => name === "Fable weekly" ? "Fable" : name;
  const windows = () => state().providers.flatMap((provider) => provider.snapshot?.windows ?? []);
  const labelWidth = () => Math.min(16, Math.max(6, ...windows().map((window) => Bun.stringWidth(label(window.label)))));
  const resetWidth = () => Math.max(0, ...windows().map((window) => Bun.stringWidth(resetLabel(window.resetsAt, now()))));
  const unsubscribe = props.service.subscribe(setState);
  onCleanup(unsubscribe);
  onMount(() => {
    void props.service.refreshIfStale();
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    onCleanup(() => clearInterval(timer));
  });

  const checked = () => {
    if (state().demo) return "Demo data";
    if (state().refreshing) return "Checking limits…";
    const updatedAt = state().updatedAt;
    if (updatedAt === null) return "Not checked yet";
    const minutes = Math.max(0, Math.floor((now() - Date.parse(updatedAt)) / 60_000));
    return minutes < 1 ? "Checked just now" : `Checked ${minutes}m ago`;
  };

  return (
    <box flexDirection="column" onSizeChange={function () { setWidth(this.width); }}>
      <text fg={theme().border} height={1}>{"─".repeat(width())}</text>
      <box flexDirection="row" justifyContent="space-between" alignItems="center">
        <text fg={theme().text}><b>Usage limit</b></text>
        <box flexDirection="row" alignItems="center" flexShrink={0}>
          <text fg={theme().textMuted}>{checked()}</text>
          <box
            id="ai-usage-refresh"
            paddingLeft={1}
            paddingRight={1}
            flexShrink={0}
            backgroundColor={refreshPressed() ? theme().borderActive : refreshHovered() ? theme().backgroundElement : theme().backgroundPanel}
            onMouseOver={() => setRefreshHovered(true)}
            onMouseOut={() => { setRefreshHovered(false); setRefreshPressed(false); }}
            onMouseDown={(event) => { if (event.button === 0 && !state().refreshing) setRefreshPressed(true); }}
            onMouseUp={(event) => {
              setRefreshPressed(false);
              if (event.button === 0 && !state().refreshing) {
                event.stopPropagation();
                void props.service.refresh();
              }
            }}
          >
            <text fg={!state().refreshing && refreshHovered() ? theme().text : theme().textMuted}><b>↻</b></text>
          </box>
        </box>
      </box>
      <text fg={theme().border} height={1}>{"┈".repeat(width())}</text>
      <box flexDirection="column" gap={1}>
        <For each={state().providers}>
          {(provider) => (
            <box flexDirection="column">
              <text fg={theme().text}>
                <b>{provider.title}</b>
                <Show when={provider.snapshot !== null && provider.status !== "ready"}>
                  <span style={{ fg: theme().warning }}> · stale</span>
                </Show>
              </text>
              <For each={provider.snapshot?.windows ?? []}>
                {(window) => {
                  const [columns, setColumns] = createSignal(0);
                  const filled = () => Math.floor(Math.min(100, Math.max(0, window.usedPercent)) * columns() / 100);
                  const ink = () => window.usedPercent >= 100 ? theme().error : window.usedPercent >= 80 ? theme().warning : theme().primary;
                  return (
                    <box flexDirection="column">
                      <box flexDirection="row" gap={2}>
                        <text fg={theme().textMuted} width={labelWidth()} flexShrink={0}>{label(window.label)}</text>
                        <text fg={ink()} flexShrink={0}>{percent(window.usedPercent)} used</text>
                      </box>
                      <box flexDirection="row" gap={1}>
                        <box flexGrow={1} flexBasis={0} minWidth={0} height={1} onSizeChange={function () { setColumns(this.width); }}>
                          <text fg={theme().textMuted} height={1}>
                            <span style={{ fg: ink() }}>{"━".repeat(filled())}</span>
                            {"─".repeat(columns() - filled())}
                          </text>
                        </box>
                        <box width={resetWidth()} flexShrink={0} flexDirection="row" justifyContent="flex-end">
                          <text fg={theme().textMuted}>{resetLabel(window.resetsAt, now())}</text>
                        </box>
                      </box>
                    </box>
                  );
                }}
              </For>
              <Show when={statusNote(provider)}>
                {(note) => <text fg={provider.status === "error" || provider.status === "expired" ? theme().warning : theme().textMuted}>{note()}</text>}
              </Show>
            </box>
          )}
        </For>
      </box>
      <text fg={theme().border} height={1}>{"─".repeat(width())}</text>
    </box>
  );
}
