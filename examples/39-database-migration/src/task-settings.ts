// The replication settings this chapter sets. Every key left out keeps the
// default the AWS DMS documentation lists.

/** Kilobytes. A note body is at most 10,000 characters, and a character is at most 4 bytes in UTF-8. */
export const lobMaxSizeKb = 64;

// #region settings
export const replicationSettings = {
  TargetMetadata: {
    SupportLobs: true,
    FullLobMode: false,
    // `text` is a LOB to DMS. Limited mode loads it in bulk and truncates what is longer.
    LimitedSizeLobMode: true,
    LobMaxSize: lobMaxSizeKb,
  },
  FullLoadSettings: {
    // The target schema is ours, indexes and constraints included. DMS must not drop it.
    TargetTablePrepMode: "DO_NOTHING",
  },
  Logging: { EnableLogging: true },
  ValidationSettings: { EnableValidation: true },
  ErrorBehavior: {
    // A mapping that selects nothing is a mistake, not an empty migration.
    FailOnNoTablesCaptured: true,
  },
} as const;
// #endregion settings
