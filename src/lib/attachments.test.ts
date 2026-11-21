import { describe, expect, it } from "vitest";
import { attachmentFilePath, attachmentMetaPath, formatSize, isImage, storedName } from "./attachments";
import { attachmentProblem } from "./validate";

describe("attached files", () => {
  it("are stored under a safe name, never a .json one", () => {
    expect(storedName("mw1", "Capture d'écran 2026-11-21.png")).toBe("mw1-Capture_d_ecran_2026-11-21.png");
    expect(storedName("mw1", "../../etc/passwd")).toBe("mw1-etc_passwd");
    expect(storedName("mw1", "données.json")).toBe("mw1-donnees.json.txt");
    expect(storedName("mw1", "...")).toBe("mw1-fichier");
    expect(storedName("mw1", "")).toBe("mw1-fichier");
  });

  it("live next to their card, the description beside the file", () => {
    const a = { id: "mw1", cardId: "c1", file: "mw1-x.png" };
    expect(attachmentFilePath(a, "b1")).toBe("boards/b1/attachments/c1/mw1-x.png");
    expect(attachmentMetaPath(a, "b1")).toBe("boards/b1/attachments/c1/mw1.json");
  });

  it("are shown as images only for the usual image types, sizes in o / ko / Mo", () => {
    expect(isImage({ type: "image/png" })).toBe(true);
    expect(isImage({ type: "image/svg+xml" })).toBe(false);
    expect([formatSize(900), formatSize(2048), formatSize(3 * 1024 * 1024)]).toEqual(["900 o", "2 ko", "3.0 Mo"]);
  });

  it("have their description checked when read", () => {
    const ok = { id: "mw1", cardId: "c1", name: "x.png", type: "image/png", size: 3, file: "mw1-x.png", createdAt: "", author: { host: "PC" } };
    expect(attachmentProblem(ok)).toBeNull();
    expect(attachmentProblem({ ...ok, file: "../../x" })).toEqual({ code: "bad_field", field: "file" });
  });
});
