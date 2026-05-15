/**
 * Tests for StoredConfig max_msgs_per_hour field and DEFAULT_MAX_MSGS_PER_HOUR constant.
 * TDD: written before implementation.
 */

import { describe, it, expect } from "vitest";
import {
  parseStoredConfig,
  DEFAULT_MAX_MSGS_PER_HOUR,
} from "../../types/config";

/** A valid minimal config used as a base for all tests. */
const BASE_CONFIG = {
  display_name: "Jane Doe",
  headline: "Software Engineer",
  cv_markdown: "A".repeat(200),
  anthropic_api_key: "sk-ant-test-key",
  daily_budget_usd: 5,
  access_email: "jane@example.com",
  access_aud: "test-aud",
  access_team_domain: "example",
  setup_timestamp: 1_700_000_000_000,
};

describe("StoredConfig max_msgs_per_hour", () => {
  it("accepts a config that includes max_msgs_per_hour=10", () => {
    const result = parseStoredConfig({ ...BASE_CONFIG, max_msgs_per_hour: 10 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.max_msgs_per_hour).toBe(10);
    }
  });

  it("accepts a config that omits max_msgs_per_hour", () => {
    const result = parseStoredConfig({ ...BASE_CONFIG });
    expect(result.ok).toBe(true);
  });

  it("rejects max_msgs_per_hour=0", () => {
    const result = parseStoredConfig({ ...BASE_CONFIG, max_msgs_per_hour: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/max_msgs_per_hour/);
    }
  });

  it("rejects negative max_msgs_per_hour", () => {
    const result = parseStoredConfig({ ...BASE_CONFIG, max_msgs_per_hour: -5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/max_msgs_per_hour/);
    }
  });

  it("rejects non-integer max_msgs_per_hour (float)", () => {
    const result = parseStoredConfig({ ...BASE_CONFIG, max_msgs_per_hour: 5.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/max_msgs_per_hour/);
    }
  });
});

describe("DEFAULT_MAX_MSGS_PER_HOUR", () => {
  it("exports DEFAULT_MAX_MSGS_PER_HOUR as 30", () => {
    expect(DEFAULT_MAX_MSGS_PER_HOUR).toBe(30);
  });

  it("uses DEFAULT_MAX_MSGS_PER_HOUR when max_msgs_per_hour is absent", () => {
    const result = parseStoredConfig({ ...BASE_CONFIG });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // When absent, effective value should default to 30
      expect(result.value.max_msgs_per_hour ?? DEFAULT_MAX_MSGS_PER_HOUR).toBe(30);
    }
  });
});
