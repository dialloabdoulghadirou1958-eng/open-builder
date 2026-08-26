// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../ui/tooltip";
import { useSettingsStore } from "../../../store/settings";
import { aiDefaults } from "../../../store/settings/ai";
import { systemDefaults } from "../../../store/settings/system";
import { ModelTab } from "./ModelTab";

describe("ModelTab local-agent capability", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      system: { ...systemDefaults, language: "en" },
    });
  });

  it("shows capability errors and retries explicitly", async () => {
    const user = userEvent.setup();
    const refresh = vi.fn(async () => "error" as const);
    useSettingsStore.setState({
      localAgentCapability: "error",
      refreshLocalAgentCapability: refresh,
    });

    render(
      <TooltipProvider>
        <ModelTab
          formData={{ ...aiDefaults, runtime: "localCli" }}
          setFormData={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("CLI unavailable");
    await user.click(screen.getByRole("button", { name: "Rescan" }));
    expect(refresh).toHaveBeenCalledWith(true);
  });

  it("distinguishes loading and unsupported platforms", () => {
    const refresh = vi.fn(() => new Promise<"supported">(() => undefined));
    useSettingsStore.setState({
      localAgentCapability: "loading",
      refreshLocalAgentCapability: refresh,
    });
    const { rerender } = render(
      <TooltipProvider>
        <ModelTab
          formData={{ ...aiDefaults, runtime: "localCli" }}
          setFormData={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Detecting local CLI");

    act(() => {
      useSettingsStore.setState({ localAgentCapability: "unsupported" });
    });
    rerender(
      <TooltipProvider>
        <ModelTab
          formData={{ ...aiDefaults, runtime: "localCli" }}
          setFormData={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Local CLI is desktop-only",
    );
  });
});
