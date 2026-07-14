import { describe, expect, it } from "bun:test";
import { triggerDownloadBlob, triggerDownloadZip } from "../src/downloads.ts";

function fakeDocument() {
  const clicks: string[] = [];
  const appended: unknown[] = [];
  return {
    clicks,
    appended,
    body: { appendChild(node: unknown) { appended.push(node); } },
    createElement(tag: string) {
      expect(tag).toBe("a");
      return { href: "", download: "", style: {}, click() { clicks.push(this.download); }, remove() {} } as HTMLAnchorElement;
    },
  } as unknown as Document & { clicks: string[]; appended: unknown[] };
}

describe("download helpers", () => {
  it("creates a blob URL, assigns the filename, clicks an anchor, and revokes later", async () => {
    const doc = fakeDocument();
    const created: string[] = [];
    const revoked: string[] = [];
    const url = { createObjectURL(blob: Blob) { expect(blob.size).toBeGreaterThan(0); created.push("blob:test"); return "blob:test"; }, revokeObjectURL(value: string) { revoked.push(value); } };
    const result = triggerDownloadBlob("phase3-export.zip", new Blob(["abc"]), doc, url);
    expect(result.filename).toBe("phase3-export.zip");
    expect(result.bytes).toBe(3);
    expect(doc.clicks).toEqual(["phase3-export.zip"]);
    expect(created).toEqual(["blob:test"]);
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(revoked).toEqual(["blob:test"]);
  });

  it("rejects empty downloads and creates non-empty export zips", () => {
    expect(() => triggerDownloadBlob("empty.zip", new Blob([]), fakeDocument(), { createObjectURL() { return "blob:empty"; }, revokeObjectURL() {} })).toThrow(/empty/);
    const doc = fakeDocument();
    const url = { createObjectURL() { return "blob:zip"; }, revokeObjectURL() {} };
    const result = triggerDownloadZip("tuning-run-export.zip", [{ name: "matches.csv", mime: "text/csv", content: "matchId\n1" }], doc, url);
    expect(result.filename).toBe("tuning-run-export.zip");
    expect(result.bytes).toBeGreaterThan(0);
    expect(doc.clicks).toEqual(["tuning-run-export.zip"]);
  });
});
