import { describe, expect, it } from "vitest";
import { isUmassEmail, validateAll, validateLoginField, validateSignupField } from "./validation";

describe("isUmassEmail", () => {
  it.each(["student@umass.edu", "First.Last@UMASS.EDU", "  padded@umass.edu  "])("accepts %s", (email) => {
    expect(isUmassEmail(email)).toBe(true);
  });

  it.each([
    "test@gmail.com", // TASKS A-2 "done when" case
    "student@umass.edu.evil.com",
    "student@cs.umass.edu", // subdomain: the DB trigger (@umass\.edu$) rejects it too, so the UI matches
    "student@notumass.edu",
    "@umass.edu",
    "two words@umass.edu",
    "",
  ])("rejects %j", (email) => {
    expect(isUmassEmail(email)).toBe(false);
  });
});

describe("validateAll", () => {
  it("reports every invalid sign-up field", () => {
    const errors = validateAll({ fullName: " ", email: "test@gmail.com", password: "short" }, validateSignupField);
    expect(errors).toEqual({
      fullName: "Enter your full name.",
      email: "Use your @umass.edu email address.",
      password: "Use at least 8 characters.",
    });
  });

  it("returns no errors for a valid sign-up", () => {
    expect(
      validateAll({ fullName: "Sam Minuteman", email: "sam@umass.edu", password: "longenough" }, validateSignupField),
    ).toEqual({});
  });

  it("only requires something in each log-in field", () => {
    expect(validateAll({ email: "", password: "" }, validateLoginField)).toEqual({
      email: "Enter your email.",
      password: "Enter your password.",
    });
  });
});
