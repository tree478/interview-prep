import { describe, expect, it } from "vitest";
import { extractNumbers } from "./numbers";

describe("extractNumbers", () => {
  it("strips thousands commas", () => {
    expect(extractNumbers("1,000")).toEqual(["1000"]);
    expect(extractNumbers("1,000,000")).toEqual(["1000000"]);
    expect(extractNumbers("12,500")).toEqual(["12500"]);
  });

  it("maps hyphenated and compound written numbers", () => {
    expect(extractNumbers("twenty-five")).toEqual(["25"]);
    expect(extractNumbers("Twenty-five")).toEqual(["25"]);
    expect(extractNumbers("twenty one")).toEqual(["21"]);
    expect(extractNumbers("two hundred thirty-five")).toEqual(["235"]);
    expect(extractNumbers("two hundred and thirty-five")).toEqual(["235"]);
    expect(extractNumbers("two hundred one")).toEqual(["201"]);
  });

  it("expands a k, m, or b suffix stuck to a number", () => {
    expect(extractNumbers("5k")).toEqual(["5000"]);
    expect(extractNumbers("5K")).toEqual(["5000"]);
    expect(extractNumbers("1.5k")).toEqual(["1500"]);
    expect(extractNumbers("1.2M")).toEqual(["1200000"]);
    expect(extractNumbers("2b")).toEqual(["2000000000"]);
    expect(extractNumbers("3B")).toEqual(["3000000000"]);
  });

  it("does not expand a suffix with a space or a k inside a word", () => {
    expect(extractNumbers("5 k")).toEqual(["5"]);
    expect(extractNumbers("1.2 M")).toEqual(["1.2"]);
    expect(extractNumbers("network")).toEqual([]);
    expect(extractNumbers("ask")).toEqual([]);
    expect(extractNumbers("5kids")).toEqual([]);
  });

  it("collapses percent forms and does not emit the bare number", () => {
    expect(extractNumbers("40%")).toEqual(["40%"]);
    expect(extractNumbers("40 percent")).toEqual(["40%"]);
    expect(extractNumbers("forty percent")).toEqual(["40%"]);
    expect(extractNumbers("40% and forty percent")).toEqual(["40%"]);
  });

  it("splits dash ranges and applies a trailing percent to both ends", () => {
    expect(extractNumbers("3-5")).toEqual(["3", "5"]);
    expect(extractNumbers("3\u20135")).toEqual(["3", "5"]);
    expect(extractNumbers("3\u20145")).toEqual(["3", "5"]);
    expect(extractNumbers("3\u20135%")).toEqual(["3%", "5%"]);
    expect(extractNumbers("3-5 percent")).toEqual(["3%", "5%"]);
  });

  it("keeps vague quantities as words", () => {
    expect(extractNumbers("dozens")).toEqual(["dozens"]);
    expect(extractNumbers("hundreds")).toEqual(["hundreds"]);
    expect(extractNumbers("thousands")).toEqual(["thousands"]);
  });

  it("maps a dozen to 12 and not to dozens", () => {
    expect(extractNumbers("a dozen")).toEqual(["12"]);
    expect(extractNumbers("shipped a dozen features")).toEqual(["12"]);
  });

  it("does not convert one, a, or ordinals", () => {
    expect(extractNumbers("one")).toEqual([]);
    expect(extractNumbers("a")).toEqual([]);
    expect(extractNumbers("first")).toEqual([]);
    expect(extractNumbers("1st")).toEqual([]);
    expect(extractNumbers("2nd")).toEqual([]);
    expect(extractNumbers("3rd")).toEqual([]);
    expect(extractNumbers("4th")).toEqual([]);
    expect(extractNumbers("21st")).toEqual([]);
    expect(extractNumbers("twenty-first")).toEqual([]);
    expect(extractNumbers("finished 1st")).toEqual([]);
  });

  it("does not treat one hundred or a hundred as 100", () => {
    expect(extractNumbers("one hundred")).toEqual([]);
    expect(extractNumbers("a hundred")).toEqual([]);
  });

  it("maps two hundred to 200 and the top of the written range", () => {
    expect(extractNumbers("two hundred")).toEqual(["200"]);
    expect(extractNumbers("zero")).toEqual(["0"]);
    expect(
      extractNumbers(
        "nine hundred ninety-nine thousand nine hundred ninety-nine",
      ),
    ).toEqual(["999999"]);
  });

  it("drops a trailing .0 and keeps a real decimal", () => {
    expect(extractNumbers("2.0")).toEqual(["2"]);
    expect(extractNumbers("2.50")).toEqual(["2.5"]);
    expect(extractNumbers("2.5")).toEqual(["2.5"]);
  });

  it("returns unique claims in sorted order", () => {
    expect(extractNumbers("5 and 3 and 5")).toEqual(["3", "5"]);
    expect(extractNumbers("from 5k to 10")).toEqual(["10", "5000"]);
  });

  it("does not read a digit glued inside a word", () => {
    expect(extractNumbers("python3")).toEqual([]);
    expect(extractNumbers("ES6")).toEqual([]);
  });
});
