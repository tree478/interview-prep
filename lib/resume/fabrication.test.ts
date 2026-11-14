import { describe, expect, it } from "vitest";
import { checkBullet } from "./fabrication";

const PASS = { ok: true, reasons: [] };

describe("checkBullet", () => {
  it("passes a wording-only rewrite that keeps the same skill", () => {
    expect(
      checkBullet(
        "Built a Python tool for students",
        "Developed a Python tool used by students",
        [],
      ),
    ).toEqual(PASS);
  });

  it("rejects a quantity added to a bullet that had none", () => {
    expect(
      checkBullet(
        "Increased sales across the region",
        "Increased sales by 40% across the region",
        [],
      ),
    ).toEqual({
      ok: false,
      reasons: ["added number: 40%"],
    });
  });

  it("treats 5k and 5000 as the same number", () => {
    expect(checkBullet("Served 5k users", "Served 5000 users", [])).toEqual(PASS);
    expect(checkBullet("Served 5000 users", "Served 5k users", [])).toEqual(PASS);
  });

  it("treats 1,000 and 1000 as the same number", () => {
    expect(checkBullet("Handled 1,000 requests", "Handled 1000 requests", [])).toEqual(
      PASS,
    );
    expect(checkBullet("Handled 1000 requests", "Handled 1,000 requests", [])).toEqual(
      PASS,
    );
  });

  it("treats twenty-five and 25 as the same number", () => {
    expect(
      checkBullet("Mentored twenty-five students", "Mentored 25 students", []),
    ).toEqual(PASS);
    expect(
      checkBullet("Mentored 25 students", "Mentored twenty-five students", []),
    ).toEqual(PASS);
  });

  it("treats a dozen and 12 as the same number", () => {
    expect(checkBullet("Shipped a dozen features", "Shipped 12 features", [])).toEqual(
      PASS,
    );
    expect(checkBullet("Shipped 12 features", "Shipped a dozen features", [])).toEqual(
      PASS,
    );
  });

  it("treats 1.2M and 1200000 as the same number", () => {
    expect(
      checkBullet("Processed 1.2M rows", "Processed 1200000 rows", []),
    ).toEqual(PASS);
    expect(
      checkBullet("Processed 1200000 rows", "Processed 1.2M rows", []),
    ).toEqual(PASS);
  });

  it("treats forty percent and 40% as the same number", () => {
    expect(
      checkBullet("Cut latency by forty percent", "Cut latency by 40%", []),
    ).toEqual(PASS);
    expect(
      checkBullet("Cut latency by 40%", "Cut latency by forty percent", []),
    ).toEqual(PASS);
  });

  it("allows a rewrite of a range that keeps one end", () => {
    expect(checkBullet("Owned 3\u20135 projects", "Owned 3 projects", [])).toEqual(
      PASS,
    );
  });

  it("rejects a rewrite that adds a number outside the original range", () => {
    expect(checkBullet("Owned 3\u20135 projects", "Owned 6 projects", [])).toEqual({
      ok: false,
      reasons: ["added number: 6"],
    });
  });

  it("rejects a vague dozens claim the original lacks", () => {
    expect(checkBullet("Fixed bugs", "Fixed dozens of bugs", [])).toEqual({
      ok: false,
      reasons: ["added number: dozens"],
    });
  });

  it("allows one and first when the original has no digit", () => {
    expect(
      checkBullet("Led the club", "Was the one lead and finished first", []),
    ).toEqual(PASS);
  });

  it("rejects a digit 1 when the original only says one", () => {
    expect(checkBullet("Was the one lead", "Was the 1 lead", [])).toEqual({
      ok: false,
      reasons: ["added number: 1"],
    });
  });

  it("rejects an added skill on a bullet that already names another skill", () => {
    expect(
      checkBullet("Built a Python API", "Built a Python API with Docker", []),
    ).toEqual({
      ok: false,
      reasons: ["added skill: Docker"],
    });
  });

  it("rejects Python added to a bullet that does not contain it", () => {
    expect(
      checkBullet("Built an API for the lab", "Built a Python API for the lab", []),
    ).toEqual({
      ok: false,
      reasons: ["added skill: Python"],
    });
  });

  it("allows JS to be rewritten as JavaScript", () => {
    expect(
      checkBullet("Wrote JS for the portal", "Wrote JavaScript for the portal", []),
    ).toEqual(PASS);
  });

  it("does not treat go to market as Go", () => {
    expect(
      checkBullet("Owned the launch plan", "Owned the go to market plan", []),
    ).toEqual(PASS);
    expect(
      checkBullet("Owned the go to market plan", "Owned the plan in Go", []),
    ).toEqual({
      ok: false,
      reasons: ["added skill: Go"],
    });
  });

  it("does not treat R&D as R", () => {
    expect(checkBullet("Worked on R&D prototypes", "Worked on R&D prototypes", [])).toEqual(
      PASS,
    );
    expect(checkBullet("Worked on R&D prototypes", "Worked on R prototypes", [])).toEqual(
      {
        ok: false,
        reasons: ["added skill: R"],
      },
    );
  });

  it("rejects a known employer added in the rewrite", () => {
    expect(
      checkBullet(
        "Interned on the search team",
        "Interned at google on the search team",
        ["Google"],
      ),
    ).toEqual({
      ok: false,
      reasons: ["added employer: Google"],
    });
  });

  it("allows the same employer to stay", () => {
    expect(
      checkBullet(
        "Interned at Google on search",
        "Interned at google and improved search",
        ["Google"],
      ),
    ).toEqual(PASS);
  });

  it("ignores an unknown company when knownEmployers is empty", () => {
    expect(
      checkBullet("Interned on search", "Interned at Initech on search", []),
    ).toEqual(PASS);
  });

  it("matches employer names on word boundaries", () => {
    expect(
      checkBullet("Cleaned metadata for the team", "Cleaned metadata for the team", [
        "Meta",
      ]),
    ).toEqual(PASS);
    expect(
      checkBullet("Visited Google", "Visited Google", ["Go"]),
    ).toEqual(PASS);
    expect(
      checkBullet("Cleaned metadata for the team", "Cleaned metadata at Meta", [
        "Meta",
      ]),
    ).toEqual({
      ok: false,
      reasons: ["added employer: Meta"],
    });
  });

  it("allows a rewrite that drops a number and a skill", () => {
    expect(
      checkBullet(
        "Used Python at Google to cut wait time by 40%",
        "Cut wait time for students",
        ["Google"],
      ),
    ).toEqual(PASS);
  });

  it("lists each new skill, employer, and number in stable order", () => {
    expect(
      checkBullet(
        "Built tools",
        "Built Python tools with Docker at Google and grew sales 40%",
        ["Google"],
      ),
    ).toEqual({
      ok: false,
      reasons: [
        "added skill: Docker",
        "added skill: Python",
        "added employer: Google",
        "added number: 40%",
      ],
    });
  });
});
