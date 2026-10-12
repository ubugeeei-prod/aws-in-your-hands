// #region table
/** One row of the Fargate task size table: a CPU value and the memory values it allows, in MiB. */
export type SizeRow = { cpuUnits: number; memoryMiB: readonly number[] };

const GIB = 1024;
const range = (fromGb: number, toGb: number, stepGb: number): number[] =>
  Array.from(
    { length: (toGb - fromGb) / stepGb + 1 },
    (_, index) => (fromGb + index * stepGb) * GIB,
  );

/**
 * Linux task sizes, as the ECS developer guide listed them on 2026-10-13.
 * 1024 CPU units are one vCPU. The table's "GB" are multiples of 1024 MiB.
 */
export const FARGATE_SIZES: readonly SizeRow[] = [
  { cpuUnits: 256, memoryMiB: [512, 1 * GIB, 2 * GIB] },
  { cpuUnits: 512, memoryMiB: range(1, 4, 1) },
  { cpuUnits: 1024, memoryMiB: range(2, 8, 1) },
  { cpuUnits: 2048, memoryMiB: range(4, 16, 1) },
  { cpuUnits: 4096, memoryMiB: range(8, 30, 1) },
  { cpuUnits: 8192, memoryMiB: range(16, 60, 4) },
  { cpuUnits: 16384, memoryMiB: range(32, 120, 8) },
  { cpuUnits: 32768, memoryMiB: [60 * GIB, 120 * GIB, 244 * GIB] },
];
// #endregion table

export type TaskSize = { cpuUnits: number; memoryMiB: number };

export const allSizes = (): TaskSize[] =>
  FARGATE_SIZES.flatMap((row) =>
    row.memoryMiB.map((memoryMiB) => ({ cpuUnits: row.cpuUnits, memoryMiB })),
  );

/** Whether RegisterTaskDefinition would accept this pair for Fargate on Linux. */
export const isValidSize = (size: TaskSize): boolean =>
  FARGATE_SIZES.some(
    (row) => row.cpuUnits === size.cpuUnits && row.memoryMiB.includes(size.memoryMiB),
  );

/** Ephemeral storage: 20 GiB come with every task; a task definition may ask for 21 to 200. */
export const EPHEMERAL = { includedGiB: 20, minConfiguredGiB: 21, maxGiB: 200 } as const;
