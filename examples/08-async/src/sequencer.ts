// #region sequencer
// S3 puts a hexadecimal `sequencer` on create and delete events. For one key,
// the greater value happened later. The strings vary in length, so S3's
// documentation says to left-pad the shorter one with zeros before comparing.
const WIDTH = 32;
const HEX = /^[0-9A-Fa-f]+$/;

/**
 * One fixed-width, upper-case form. Two normalized values compare as plain
 * strings, which is the only comparison a DynamoDB condition can do.
 */
export function normalizeSequencer(sequencer: string): string {
  if (!HEX.test(sequencer) || sequencer.length > WIDTH) {
    throw new Error(`"${sequencer}" is not a sequencer this worker can order`);
  }
  return sequencer.toUpperCase().padStart(WIDTH, "0");
}

export function isLater(sequencer: string, than: string): boolean {
  return normalizeSequencer(sequencer) > normalizeSequencer(than);
}
// #endregion sequencer
