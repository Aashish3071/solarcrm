import { Injectable } from "@nestjs/common";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

/**
 * Object storage behind one interface (Booklet §6.6). Local disk for now; an
 * S3 / GCS / Azure implementation replaces it once open point 14 is decided.
 */
export abstract class StorageService {
  abstract put(key: string, data: Buffer): Promise<void>;
  abstract read(key: string): Readable;
}

@Injectable()
export class LocalDiskStorage extends StorageService {
  private readonly root = path.resolve(process.env.STORAGE_DIR ?? "storage");

  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    // Keys are generated server-side, but never allow escaping the storage root.
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { flag: "wx" });
  }

  read(key: string) {
    return createReadStream(this.resolve(key));
  }
}

/** Detects the real file type from its first bytes rather than trusting the client. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}
