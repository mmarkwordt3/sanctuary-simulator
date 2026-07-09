export interface ExportFile {
  name: string;
  mime: string;
  content: string;
}

function escapeCsv(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((row) => headers.map((h) => escapeCsv(row[h])).join(","))].join("\n");
}

export function jsonl(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
}

export function markdownSummary(summary: Record<string, unknown>): string {
  return [
    "# Sanctuary Simulator Analysis Summary",
    "",
    ...Object.entries(summary).map(([key, value]) => `- **${key}**: ${JSON.stringify(value)}`),
    "",
    "> Simulation win rates measure these agents under the selected settings. They are not mathematical proof of game balance or a forced strategy.",
  ].join("\n");
}

// Small no-compression ZIP writer for static browser downloads. It avoids runtime
// dependencies and is practical for the small/medium simulator datasets expected
// from the UI. Large research runs can still download individual files.
export function makeZip(files: ExportFile[]): Blob {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255]);
  const u32 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  const crcTable = Array.from({ length: 256 }, (_, i) => {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (data: Uint8Array) => {
    let c = 0xffffffff;
    for (const byte of data) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
    parts.push(local);
    central.push(concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += local.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralSize), u32(offset), u16(0)]);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}
