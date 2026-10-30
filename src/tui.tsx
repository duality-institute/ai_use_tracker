import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { UsageService } from "./core/service";
import { UsageSidebar } from "./sidebar";

const tui: TuiPlugin = async (api, options) => {
  const service = new UsageService({ demo: options?.["demo"] === true });
  api.lifecycle.onDispose(() => service.dispose());

  api.slots.register({
    order: 150,
    slots: {
      sidebar_content() {
        return <UsageSidebar service={service} theme={api.theme} />;
      },
    },
  });

  void service.initialize();
};

export default {
  id: "@dualityinstitute/opencode-ai-usage",
  tui,
} satisfies TuiPluginModule;
