import { describe, it, expect, afterEach, vi } from "vitest";
import { isEmailFlowEnabled } from "@/lib/features";

describe("isEmailFlowEnabled (EMAIL_FLOWS_ENABLED)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off when the variable is unset (the default)", () => {
    expect(isEmailFlowEnabled({})).toBe(false);
  });

  it.each(["true", "TRUE", " true ", "1"])("is on for %j", (value) => {
    expect(isEmailFlowEnabled({ EMAIL_FLOWS_ENABLED: value })).toBe(true);
  });

  it.each(["false", "0", "", "yes", "on", "enabled"])("is off for %j", (value) => {
    expect(isEmailFlowEnabled({ EMAIL_FLOWS_ENABLED: value })).toBe(false);
  });

  it("reads process.env at call time by default", () => {
    vi.stubEnv("EMAIL_FLOWS_ENABLED", "true");
    expect(isEmailFlowEnabled()).toBe(true);
    vi.stubEnv("EMAIL_FLOWS_ENABLED", "false");
    expect(isEmailFlowEnabled()).toBe(false);
  });
});
