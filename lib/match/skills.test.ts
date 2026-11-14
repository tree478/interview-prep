import { describe, expect, it } from "vitest";
import { canonicalize } from "./skills";

describe("canonicalize", () => {
  it("maps JS to JavaScript", () => {
    expect(canonicalize(["JS"])).toEqual({
      canonical: ["JavaScript"],
      dropped: [],
    });
  });

  it("maps Postgres to PostgreSQL", () => {
    expect(canonicalize(["Postgres"])).toEqual({
      canonical: ["PostgreSQL"],
      dropped: [],
    });
  });

  it("drops go to market and does not match Go", () => {
    const result = canonicalize(["go to market"]);
    expect(result.dropped).toEqual(["go to market"]);
    expect(result.canonical).not.toContain("Go");
  });

  it("drops R&D and does not match R", () => {
    const result = canonicalize(["R&D"]);
    expect(result.dropped).toEqual(["R&D"]);
    expect(result.canonical).not.toContain("R");
  });

  it("maps Golang to Go", () => {
    expect(canonicalize(["Golang"])).toEqual({
      canonical: ["Go"],
      dropped: [],
    });
  });

  it("drops lowercase go", () => {
    const result = canonicalize(["go"]);
    expect(result.dropped).toEqual(["go"]);
    expect(result.canonical).not.toContain("Go");
  });

  it("maps exact C to C", () => {
    expect(canonicalize(["C"])).toEqual({
      canonical: ["C"],
      dropped: [],
    });
  });

  it("drops lowercase c", () => {
    const result = canonicalize(["c"]);
    expect(result.dropped).toEqual(["c"]);
    expect(result.canonical).not.toContain("C");
  });

  it("maps C++ to C++ and not C", () => {
    const result = canonicalize(["C++"]);
    expect(result).toEqual({
      canonical: ["C++"],
      dropped: [],
    });
    expect(result.canonical).not.toContain("C");
  });

  it("dedupes JS and JavaScript", () => {
    expect(canonicalize(["JS", "JavaScript"])).toEqual({
      canonical: ["JavaScript"],
      dropped: [],
    });
  });

  it("drops an unknown skill", () => {
    expect(canonicalize(["Not A Real Skill"])).toEqual({
      canonical: [],
      dropped: ["Not A Real Skill"],
    });
  });
});
