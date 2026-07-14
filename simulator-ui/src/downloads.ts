import { makeZip, type ExportFile } from "./exporters.ts";

export interface DownloadResult { filename: string; bytes: number; }

export function triggerDownloadBlob(filename: string, blob: Blob, documentRef: Document = document, urlRef: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL): DownloadResult {
  if (!filename.trim()) throw new Error("Download filename is required.");
  if (blob.size <= 0) throw new Error(`Download ${filename} is empty.`);
  const href = urlRef.createObjectURL(blob);
  const anchor = documentRef.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.style.display = "none";
  documentRef.body?.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => urlRef.revokeObjectURL(href), 0);
  return { filename, bytes: blob.size };
}

export function triggerDownloadFile(file: ExportFile): DownloadResult {
  return triggerDownloadBlob(file.name, new Blob([file.content], { type: file.mime }));
}

export function triggerDownloadZip(filename: string, files: ExportFile[], documentRef: Document = document, urlRef: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL): DownloadResult {
  if (!files.length) throw new Error("No export files were generated.");
  return triggerDownloadBlob(filename, makeZip(files), documentRef, urlRef);
}
