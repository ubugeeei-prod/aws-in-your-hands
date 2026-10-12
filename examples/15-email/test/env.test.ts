import { describe, expect, it } from "vite-plus/test";

import { createAdapters } from "../src/compose.ts";
import { parseEnv, parseEventsEnv } from "../src/env.ts";
import { OutboxMailer } from "../src/mailer.ts";

const local = {
  MAIL_MODE: "local",
  FROM_ADDRESS: "notes@example.com",
  APP_ORIGIN: "http://localhost:5173",
};

describe("environment", () => {
  it("applies defaults in local mode", () => {
    expect(parseEnv(local)).toEqual({
      ...local,
      LOG_LEVEL: "info",
      STAGE: "local",
      RETENTION_DAYS: 30,
    });
  });

  it("requires the table and the configuration set in aws mode, by name", () => {
    expect(() => parseEnv({ ...local, MAIL_MODE: "aws" })).toThrow(
      /TABLE_NAME[\s\S]*CONFIGURATION_SET_NAME/,
    );
  });

  it("rejects a From address that is not one bare address", () => {
    expect(() => parseEnv({ ...local, FROM_ADDRESS: "Notes <notes@example.com>" })).toThrow(
      /FROM_ADDRESS/,
    );
  });

  it("rejects an origin without an http or https scheme", () => {
    expect(() => parseEnv({ ...local, APP_ORIGIN: "localhost:5173" })).toThrow(/APP_ORIGIN/);
  });

  it("fails at start-up without a mode, rather than guessing one that sends real mail", () => {
    expect(() =>
      parseEnv({ FROM_ADDRESS: local.FROM_ADDRESS, APP_ORIGIN: local.APP_ORIGIN }),
    ).toThrow(/MAIL_MODE/);
  });

  it("gives the events function only what it needs", () => {
    expect(
      parseEventsEnv({ TABLE_NAME: "mail-table", FROM_ADDRESS: "ignored@example.com" }),
    ).toEqual({
      LOG_LEVEL: "info",
      TABLE_NAME: "mail-table",
    });
    expect(() => parseEventsEnv({})).toThrow(/TABLE_NAME/);
  });

  it("uses the outbox, never SES, in local mode", () => {
    const adapters = createAdapters(parseEnv(local));
    expect(adapters.mailer).toBeInstanceOf(OutboxMailer);
    expect(adapters.outbox).toBe(adapters.mailer);
  });
});
