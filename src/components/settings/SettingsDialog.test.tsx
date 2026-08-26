// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../ui/tooltip";
import { aiDefaults } from "../../store/settings/ai";
import { assetSearchDefaults } from "../../store/settings/asset-search";
import { systemDefaults } from "../../store/settings/system";
import { webSearchDefaults } from "../../store/settings/web-search";
import { SettingsDialog, validateAISettingsDraft } from "./SettingsDialog";

vi.mock("./tabs/SearchServicesTab", () => ({
  SearchServicesTab: () => null,
}));
vi.mock("./tabs/StorageTab", () => ({ StorageTab: () => null }));
vi.mock("./tabs/SystemTab", () => ({ SystemTab: () => null }));

const validationMessages = {
  apiKeyRequired: "key required",
  apiBaseUrlRequired: "URL required",
  apiBaseUrlInvalid: "URL invalid",
  modelRequired: "model required",
  modelInvalid: "model invalid",
};

describe("SettingsDialog", () => {
  it("validates model settings before committing the draft", () => {
    expect(validateAISettingsDraft(aiDefaults, validationMessages)).toEqual({
      apiKey: "key required",
      apiBaseUrl: "URL required",
      model: "model required",
    });
    expect(
      validateAISettingsDraft(
        {
          apiType: "openai-compatible",
          apiKey: "local-key",
          apiBaseUrl: "file:///tmp/model",
          model: "model\nname",
        },
        validationMessages,
      ),
    ).toEqual({ apiBaseUrl: "URL invalid", model: "model invalid" });
  });

  it("keeps edits transactional until a valid Save and passes axe checks", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <TooltipProvider>
        <SettingsDialog
          isOpen
          onClose={onClose}
          settings={aiDefaults}
          onSave={onSave}
          webSearchSettings={webSearchDefaults}
          onSaveWebSearch={vi.fn()}
          assetSearchSettings={assetSearchDefaults}
          onSaveAssetSearch={vi.fn()}
          systemSettings={systemDefaults}
          onSaveSystem={vi.fn()}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText("API Key")).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    await user.type(screen.getByLabelText("API Key"), "test-key");
    await user.type(
      screen.getByLabelText("API Base URL"),
      "https://api.example.com",
    );
    await user.type(screen.getByLabelText("Model Name"), "test-model");

    expect(onSave).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({
      apiType: "openai-compatible",
      apiKey: "test-key",
      apiBaseUrl: "https://api.example.com",
      model: "test-model",
    });
    expect(onClose).toHaveBeenCalledOnce();
    expect(
      (
        await axe(container, {
          rules: { "color-contrast": { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
  });
});
