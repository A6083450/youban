export interface ZipFixtureEntry {
  name: string | Buffer;
  content?: string | Buffer;
  mode?: number;
  encrypted?: boolean;
  compressionMethod?: 0 | 8;
  compressedContent?: Buffer;
  declaredCompressedSize?: number;
  declaredUncompressedSize?: number;
}

function crc32(content: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUInt32(buffer: Buffer, value: number, offset: number): void {
  buffer.writeUInt32LE(value >>> 0, offset);
}

export function createZipFixture(entries: readonly ZipFixtureEntry[]): Buffer {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = typeof entry.name === "string" ? Buffer.from(entry.name, "utf8") : entry.name;
    const content = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content ?? "", "utf8");
    const compressedPayload = entry.compressedContent ?? content;
    const compressedContent = entry.encrypted
      ? Buffer.concat([Buffer.alloc(12), compressedPayload])
      : compressedPayload;
    const compressionMethod = entry.compressionMethod ?? 0;
    const compressedSize = entry.declaredCompressedSize ?? compressedContent.length;
    const uncompressedSize = entry.declaredUncompressedSize ?? content.length;
    const flags = (entry.encrypted ? 0x1 : 0) | 0x800;
    const crc = crc32(content);
    const local = Buffer.alloc(30 + name.length + compressedContent.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(compressionMethod, 8);
    writeUInt32(local, crc, 14);
    writeUInt32(local, compressedSize, 18);
    writeUInt32(local, uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    compressedContent.copy(local, 30 + name.length);
    localRecords.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 63, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(compressionMethod, 10);
    writeUInt32(central, crc, 16);
    writeUInt32(central, compressedSize, 20);
    writeUInt32(central, uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    writeUInt32(central, (entry.mode ?? 0o100644) << 16, 38);
    writeUInt32(central, offset, 42);
    name.copy(central, 46);
    centralRecords.push(central);
    offset += local.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(entries.length, 8);
  footer.writeUInt16LE(entries.length, 10);
  writeUInt32(footer, centralDirectory.length, 12);
  writeUInt32(footer, offset, 16);
  return Buffer.concat([...localRecords, centralDirectory, footer]);
}
