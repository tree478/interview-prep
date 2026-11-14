import { describe, expect, it } from "vitest";
import { gapsResponseSchema } from "../types";
import { selectGaps, type GapResourceRow } from "./select";

function resource(
  overrides: Partial<GapResourceRow> & Pick<GapResourceRow, "id" | "name" | "skills">,
): GapResourceRow {
  return {
    type: "course",
    url: `https://www.cics.umass.edu/${overrides.id}`,
    description: "A CICS resource",
    meta: {},
    active: true,
    ...overrides,
  };
}

describe("selectGaps", () => {
  it("lists a required skill before a preferred-only skill", () => {
    const gaps = selectGaps({
      missingSkills: ["Python", "Java"],
      preferredMissing: ["SQL"],
      resources: [
        resource({ id: "sql", name: "Databases", skills: ["SQL"] }),
        resource({ id: "java", name: "Java", skills: ["Java"] }),
        resource({ id: "python", name: "Python", skills: ["Python"] }),
      ],
    });

    expect(gaps.map((gap) => gap.skill)).toEqual(["Python", "Java", "SQL"]);
    expect(gaps.map((gap) => gap.resources.map((item) => item.id))).toEqual([
      ["python"],
      ["java"],
      ["sql"],
    ]);
  });

  it("lists a skill once, in the required position, and skips blanks", () => {
    const gaps = selectGaps({
      missingSkills: ["Python", "", "Python", "   "],
      preferredMissing: ["SQL", "Python", ""],
      resources: [],
    });

    expect(gaps.map((gap) => gap.skill)).toEqual(["Python", "SQL"]);
  });

  it("sorts courses ahead of labs, then by name, and keeps three", () => {
    const gaps = selectGaps({
      missingSkills: ["Machine Learning"],
      preferredMissing: [],
      resources: [
        resource({
          id: "lab-z",
          type: "lab",
          name: "Zebra Lab",
          skills: ["Machine Learning"],
        }),
        resource({
          id: "lab-a",
          type: "lab",
          name: "Alpha Lab",
          skills: ["Machine Learning"],
        }),
        resource({
          id: "lab-m",
          type: "lab",
          name: "Mid Lab",
          skills: ["Machine Learning"],
        }),
        resource({
          id: "course-s",
          type: "course",
          name: "Systems",
          skills: ["Machine Learning"],
        }),
        resource({
          id: "course-a",
          type: "course",
          name: "Algorithms",
          skills: ["Machine Learning"],
        }),
      ],
    });

    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.resources.map((item) => [item.type, item.name])).toEqual([
      ["course", "Algorithms"],
      ["course", "Systems"],
      ["lab", "Alpha Lab"],
    ]);
  });

  it("reserves one slot for a faculty lab when three or more courses match", () => {
    const faculty = [{ name: "Jane Doe", profile_url: "https://example.edu/jane" }];
    const gaps = selectGaps({
      missingSkills: ["Machine learning"],
      preferredMissing: [],
      resources: [
        resource({ id: "gamma", name: "Gamma", skills: ["Machine learning"] }),
        resource({ id: "alpha", name: "Alpha", skills: ["Machine learning"] }),
        resource({ id: "delta", name: "Delta", skills: ["Machine learning"] }),
        resource({ id: "beta", name: "Beta", skills: ["Machine learning"] }),
        resource({
          id: "other-lab",
          type: "lab",
          name: "AAA Lab",
          skills: ["Machine learning"],
        }),
        resource({
          id: "zebra",
          type: "lab",
          name: "Zebra Lab",
          skills: ["Machine learning"],
          meta: { faculty },
        }),
        resource({
          id: "binds",
          type: "lab",
          name: "BINDS Lab",
          skills: ["Machine learning"],
          meta: { faculty },
        }),
      ],
    });

    expect(gaps[0]?.resources.map((item) => [item.type, item.id])).toEqual([
      ["course", "alpha"],
      ["course", "beta"],
      ["lab", "binds"],
    ]);
    expect(gaps[0]?.resources[2]).toMatchObject({ faculty });
  });

  it("does not drop a course for a lab that lists no faculty", () => {
    const gaps = selectGaps({
      missingSkills: ["Statistics"],
      preferredMissing: [],
      resources: [
        resource({ id: "c", name: "C", skills: ["Statistics"] }),
        resource({ id: "a", name: "A", skills: ["Statistics"] }),
        resource({ id: "b", name: "B", skills: ["Statistics"] }),
        resource({
          id: "lab",
          type: "lab",
          name: "Stats Lab",
          skills: ["Statistics"],
          meta: { faculty: [] },
        }),
      ],
    });

    expect(gaps[0]?.resources.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("excludes inactive resources", () => {
    const gaps = selectGaps({
      missingSkills: ["Statistics"],
      preferredMissing: [],
      resources: [
        resource({
          id: "inactive",
          name: "Statistics",
          skills: ["Statistics"],
          active: false,
        }),
      ],
    });

    expect(gaps).toEqual([{ skill: "Statistics", resources: [] }]);
  });

  it("matches a skill only as an exact string", () => {
    const gaps = selectGaps({
      missingSkills: ["C", "Go"],
      preferredMissing: [],
      resources: [
        resource({ id: "cpp", name: "Programming with C++", skills: ["C++"] }),
        resource({ id: "golang", name: "Programming with Golang", skills: ["Golang"] }),
        resource({ id: "c", name: "Programming in C", skills: ["C"] }),
      ],
    });

    expect(gaps.map((gap) => [gap.skill, gap.resources.map((item) => item.id)])).toEqual([
      ["C", ["c"]],
      ["Go", []],
    ]);
  });

  it("returns an empty resource list when nothing matches", () => {
    const gaps = selectGaps({
      missingSkills: ["Haskell"],
      preferredMissing: [],
      resources: [resource({ id: "py", name: "Python", skills: ["Python"] })],
    });

    expect(gaps).toEqual([{ skill: "Haskell", resources: [] }]);
  });

  it("maps course and lab metadata and turns a null description into an empty string", () => {
    const gaps = selectGaps({
      missingSkills: ["Machine Learning"],
      preferredMissing: ["SQL"],
      resources: [
        resource({
          id: "cs589",
          type: "course",
          name: "Machine Learning",
          url: "https://www.cics.umass.edu/courses/cs589",
          description: null,
          skills: ["Machine Learning"],
          meta: {
            code: "CS 589",
            instructors: ["Jane Doe"],
            prereqs: "CS 240",
            level: "graduate",
            semester: "Fall",
            faculty: [{ name: "Should Omit", profile_url: "https://example.edu/omit" }],
          },
        }),
        resource({
          id: "binds",
          type: "lab",
          name: "BINDS Lab",
          url: "https://www.cics.umass.edu/labs/binds",
          description: null,
          skills: ["Machine Learning"],
          meta: {
            research_area: "ML",
            code: "NOT-A-COURSE",
            instructors: ["Nope"],
            faculty: [
              { name: "Valid One", profile_url: "https://example.edu/one" },
              { name: "Missing URL" },
              null,
              { name: 3, profile_url: "https://example.edu/bad" },
              { name: "Valid Two", profile_url: "https://example.edu/two" },
            ],
          },
        }),
        resource({
          id: "db",
          type: "course",
          name: "Databases",
          url: "https://www.cics.umass.edu/courses/db",
          description: null,
          skills: ["SQL"],
          meta: {
            code: 320,
            instructors: ["Ann", 2],
          },
        }),
      ],
    });

    expect(gaps).toEqual([
      {
        skill: "Machine Learning",
        resources: [
          {
            id: "cs589",
            type: "course",
            name: "Machine Learning",
            url: "https://www.cics.umass.edu/courses/cs589",
            description: "",
            code: "CS 589",
            instructors: ["Jane Doe"],
          },
          {
            id: "binds",
            type: "lab",
            name: "BINDS Lab",
            url: "https://www.cics.umass.edu/labs/binds",
            description: "",
            faculty: [
              { name: "Valid One", profile_url: "https://example.edu/one" },
              { name: "Valid Two", profile_url: "https://example.edu/two" },
            ],
          },
        ],
      },
      {
        skill: "SQL",
        resources: [
          {
            id: "db",
            type: "course",
            name: "Databases",
            url: "https://www.cics.umass.edu/courses/db",
            description: "",
          },
        ],
      },
    ]);
    expect(gapsResponseSchema.safeParse({ gaps }).success).toBe(true);
  });

  it("reuses a resource for every skill it lists", () => {
    const gaps = selectGaps({
      missingSkills: ["Python"],
      preferredMissing: ["SQL"],
      resources: [
        resource({
          id: "both",
          name: "Data Systems",
          skills: ["Python", "SQL"],
        }),
      ],
    });

    expect(gaps.map((gap) => gap.resources.map((item) => item.id))).toEqual([
      ["both"],
      ["both"],
    ]);
  });
});
