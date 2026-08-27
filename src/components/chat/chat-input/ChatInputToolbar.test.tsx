// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../../../store/settings";
import { TooltipProvider } from "../../ui/tooltip";
import { ChatInputToolbar } from "./ChatInputToolbar";

const baseProps = {
  onPickImage: vi.fn(),
  onPickFile: vi.fn(),
  onManageSkills: undefined,
  onManageMcp: undefined,
  skillsAvailable: false,
  skillsInitializing: false,
  forcedSkillIds: [],
  onForcedSkillIdsChange: vi.fn(),
  planModeEnabled: false,
  setPlanMode: vi.fn(),
  isGenerating: false,
  hasContent: false,
  isHoveringStop: false,
  onHoveringStopChange: vi.fn(),
  onStop: vi.fn(),
};

describe("ChatInputToolbar project upload", () => {
  beforeEach(() => {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    useSettingsStore.setState((state) => ({
      system: { ...state.system, language: "en" },
    }));
  });

  it("exposes upload project from the attachment menu", async () => {
    const user = userEvent.setup();
    const onUploadProject = vi.fn();
    render(
      <TooltipProvider>
        <ChatInputToolbar {...baseProps} onUploadProject={onUploadProject} />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Add attachment" }));
    await user.click(screen.getByRole("menuitem", { name: /upload project/i }));
    expect(onUploadProject).toHaveBeenCalledOnce();
  });

  it("disables project upload while generation is active", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <ChatInputToolbar
          {...baseProps}
          isGenerating
          onUploadProject={vi.fn()}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Add attachment" }));
    expect(
      screen.getByRole("menuitem", { name: /upload project/i }),
    ).toHaveAttribute("data-disabled");
  });
});
