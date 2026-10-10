import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { UPLOAD_LIMITS } from "@/lib/constants";
import { Errors } from "@/lib/errors";

/**
 * File storage abstraction for chat attachments, ticket attachments and
 * client documents. Files are never served statically: every download goes
 * through an authorized API route that checks organization access first.
 *
 * Swap LocalStorageProvider for S3/GCS/Azure by implementing StorageProvider.
 */
export interface StorageProvider {
  save(data: Buffer, originalName: string): Promise<string>;
  read(fileKey: string): Promise<Buffer>;
  remove(fileKey: string): Promise<void>;
}

const FILE_KEY_PATTERN = /^\d{4}\/\d{2}\/[a-f0-9]{32}\.[a-z0-9]{1,5}$/;

class LocalStorageProvider implements StorageProvider {
  constructor(private root = path.join(/*turbopackIgnore: true*/ process.cwd(), process.env.UPLOAD_DIR || "storage/uploads")) {}

  private resolve(fileKey: string) {
    if (!FILE_KEY_PATTERN.test(fileKey)) throw Errors.notFound();
    const full = path.resolve(this.root, fileKey);
    if (!full.startsWith(path.resolve(this.root))) throw Errors.notFound();
    return full;
  }

  async save(data: Buffer, originalName: string) {
    const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".bin";
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomBytes(16).toString("hex")}${ext}`;
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return key;
  }

  async read(fileKey: string) {
    try {
      return await fs.readFile(this.resolve(fileKey));
    } catch {
      throw Errors.notFound();
    }
  }

  async remove(fileKey: string) {
    await fs.rm(this.resolve(fileKey), { force: true });
  }
}

const g = globalThis as unknown as { __etStorage?: StorageProvider };
export function getStorage(): StorageProvider {
  g.__etStorage ??= new LocalStorageProvider();
  return g.__etStorage;
}

/** Magic-byte sniffing for common binary types, so a renamed executable can't pass as a PDF/image. */
function sniffMime(buf: Buffer): string | undefined {
  if (buf.subarray(0, 4).toString("hex") === "89504e47") return "image/png";
  if (buf.subarray(0, 3).toString("hex") === "ffd8ff") return "image/jpeg";
  if (buf.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (buf.subarray(0, 2).toString("ascii") === "MZ") return "application/x-msdownload";
  if (buf.subarray(0, 4).toString("hex") === "7f454c46") return "application/x-executable";
  if (buf.subarray(0, 4).toString("hex") === "504b0304") return "application/zip";
  if (buf.subarray(0, 4).toString("hex") === "d0cf11e0") return "application/x-ole";
  return undefined;
}

const ZIP_BASED = new Set([".docx", ".xlsx", ".pptx"]);
const OLE_BASED = new Set([".doc", ".xls"]);
const TEXT_BASED = new Set([".txt", ".csv"]);

export type ValidatedUpload = { name: string; mimeType: string; size: number; data: Buffer };

/** Validate size, extension, declared type and actual content of an uploaded file. */
export async function validateUpload(file: File): Promise<ValidatedUpload> {
  if (file.size === 0) throw Errors.badRequest("The file is empty.");
  if (file.size > UPLOAD_LIMITS.maxBytes) throw Errors.badRequest("The file is too large (max 10 MB).");
  const name = path.basename(file.name).replace(/[^\w.\- ()]/g, "_").slice(0, 150) || "file";
  const ext = path.extname(name).toLowerCase();
  if (!(UPLOAD_LIMITS.allowedExtensions as readonly string[]).includes(ext)) throw Errors.badRequest("This file type is not allowed.");
  if (file.type && !(UPLOAD_LIMITS.allowedMimeTypes as readonly string[]).includes(file.type)) throw Errors.badRequest("This file type is not allowed.");

  const data = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffMime(data);
  if (sniffed === "application/x-msdownload" || sniffed === "application/x-executable") throw Errors.badRequest("Executable files are not allowed.");
  if (ZIP_BASED.has(ext) ? sniffed !== "application/zip" : OLE_BASED.has(ext) ? sniffed !== "application/x-ole" : TEXT_BASED.has(ext) ? sniffed !== undefined : sniffed === undefined) {
    throw Errors.badRequest("The file content doesn't match its type.");
  }
  if (!ZIP_BASED.has(ext) && !OLE_BASED.has(ext) && !TEXT_BASED.has(ext) && file.type && sniffed !== file.type && !(sniffed === "image/jpeg" && file.type === "image/jpg")) {
    throw Errors.badRequest("The file content doesn't match its type.");
  }
  const mimeType = file.type || sniffed || "application/octet-stream";
  return { name, mimeType, size: data.length, data };
}
