import { crc32, deflateRawSync } from "node:zlib";

export type ZipEntry = { name: string; data: Uint8Array };

// 1980-01-01 00:00, the earliest date the format can hold. The same files give the same bytes,
// so the archive's checksum identifies what was uploaded.
const DOS_TIME = 0;
const DOS_DATE = 0x21;
// Bit 11: names are UTF-8.
const FLAGS = 0x0800;
const DEFLATE = 8;

// #region zip
/** A .zip archive with every file at the path given, compressed with DEFLATE. No directories, no extras. */
export function zip(entries: ZipEntry[]): Buffer {
  const files: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const packed = deflateRawSync(entry.data);
    // The same 26 bytes describe a file where it starts and again in the directory at the end.
    const described = Buffer.alloc(26);
    described.writeUInt16LE(20, 0);
    described.writeUInt16LE(FLAGS, 2);
    described.writeUInt16LE(DEFLATE, 4);
    described.writeUInt16LE(DOS_TIME, 6);
    described.writeUInt16LE(DOS_DATE, 8);
    described.writeUInt32LE(crc32(entry.data), 10);
    described.writeUInt32LE(packed.length, 14);
    described.writeUInt32LE(entry.data.length, 18);
    described.writeUInt16LE(name.length, 22);
    described.writeUInt16LE(0, 24);

    const local = Buffer.concat([Buffer.from("PK\u0003\u0004", "latin1"), described, name, packed]);
    const listed = Buffer.alloc(46);
    listed.write("PK\u0001\u0002", 0, "latin1");
    listed.writeUInt16LE(20, 4);
    described.copy(listed, 6);
    // Bytes 32 to 41: comment length, disk, attributes. All zero.
    listed.writeUInt32LE(offset, 42);
    files.push(local);
    directory.push(Buffer.concat([listed, name]));
    offset += local.length;
  }
  const listing = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.write("PK\u0005\u0006", 0, "latin1");
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(listing.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, listing, end]);
}
// #endregion zip
