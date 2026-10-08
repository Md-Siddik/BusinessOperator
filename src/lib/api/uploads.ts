import { UPLOAD_LIMITS } from "@/lib/constants";
import { Errors } from "@/lib/errors";
import { validateUpload, type ValidatedUpload } from "@/lib/storage";

/** Read and validate uploaded files from multipart form data. */
export async function readUploads(form: FormData, field = "files"): Promise<ValidatedUpload[]> {
  const files = form.getAll(field).filter((f): f is File => typeof f !== "string" && f.size > 0);
  if (files.length > UPLOAD_LIMITS.maxFilesPerMessage) throw Errors.badRequest(`Attach at most ${UPLOAD_LIMITS.maxFilesPerMessage} files.`);
  return Promise.all(files.map(validateUpload));
}

export function formToObject(form: FormData, exclude: string[] = ["files"]) {
  return Object.fromEntries([...form.entries()].filter(([k, v]) => !exclude.includes(k) && typeof v === "string"));
}

/** Safe download response: forced attachment disposition and nosniff for anything not an image/PDF. */
export function fileResponse(data: Buffer, name: string, mimeType?: string | null) {
  const type = mimeType || "application/octet-stream";
  const inline = /^image\/(png|jpeg|gif|webp)$/.test(type) || type === "application/pdf";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(data.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
