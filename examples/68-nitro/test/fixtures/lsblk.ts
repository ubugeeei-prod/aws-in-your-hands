// Written by hand after the output format of `lsblk --json --nodeps --output NAME,SERIAL`
// (util-linux 2.40.2 source). Not captured from an instance: this machine is macOS.

/** One boot: the root volume answered first. */
export const rootFirst = {
  blockdevices: [
    { name: "nvme0n1", serial: "vol0aaaaaaaaaaaaaaaa" },
    { name: "nvme1n1", serial: "vol0bbbbbbbbbbbbbbbb" },
  ],
};

/** Another boot of the same instance: the data volume answered first. */
export const dataFirst = {
  blockdevices: [
    { name: "nvme0n1", serial: "vol0bbbbbbbbbbbbbbbb" },
    { name: "nvme1n1", serial: "vol0aaaaaaaaaaaaaaaa" },
  ],
};

/** A device without a serial, as a loop device or an instance store volume may be. */
export const withStranger = {
  blockdevices: [
    { name: "loop0", serial: null },
    { name: "nvme0n1", serial: "vol0aaaaaaaaaaaaaaaa" },
  ],
};
