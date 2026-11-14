const UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};

const TEENS: Record<string, number> = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const NUMBER_WORDS = new Set<string>([
  ...Object.keys(UNITS),
  ...Object.keys(TEENS),
  ...Object.keys(TENS),
  "hundred",
  "thousand",
  "and",
]);

const VAGUE = new Set(["dozens", "hundreds", "thousands"]);

const ORDINALS = new Set([
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
  "twentieth",
  "thirtieth",
  "fortieth",
  "fiftieth",
  "sixtieth",
  "seventieth",
  "eightieth",
  "ninetieth",
  "hundredth",
  "thousandth",
]);

const ORDINAL_UNITS = new Set([
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
]);

type Hit = { end: number; claims: string[] };
type Piece = { text: string; end: number };
type Parsed = { value: number; next: number };

function stripThousandsCommas(text: string): string {
  return text.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
}

function boundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const prev = text[index - 1];
  return prev === undefined || !/[a-z0-9]/.test(prev);
}

function readPercent(text: string, end: number): number | null {
  const match = /^\s*(%|percent\b)/.exec(text.slice(end));
  if (!match) return null;
  return end + match[0].length;
}

function formatAmount(raw: string, suffix?: string): string {
  const scale =
    suffix === "k"
      ? BigInt(1000)
      : suffix === "m"
        ? BigInt(1000000)
        : suffix === "b"
          ? BigInt(1000000000)
          : BigInt(1);
  const dot = raw.indexOf(".");
  const whole = dot === -1 ? raw : raw.slice(0, dot);
  const frac = dot === -1 ? "" : raw.slice(dot + 1);
  const digits = `${whole}${frac}`.replace(/^0+/, "") || "0";
  const numerator = BigInt(digits) * scale;
  const denom = BigInt(10) ** BigInt(frac.length);
  const intPart = numerator / denom;
  const rem = numerator % denom;
  if (rem === BigInt(0)) return intPart.toString();
  const fracText = rem.toString().padStart(frac.length, "0").replace(/0+$/, "");
  return `${intPart.toString()}.${fracText}`;
}

function claim(amount: string, percent: boolean): string {
  return percent ? `${amount}%` : amount;
}

function matchDigitOrdinal(text: string, index: number): Hit | null {
  if (!boundary(text, index)) return null;
  const match = /^\d+(?:st|nd|rd|th)\b/.exec(text.slice(index));
  if (!match) return null;
  return { end: index + match[0].length, claims: [] };
}

function matchRange(text: string, index: number): Hit | null {
  if (!boundary(text, index)) return null;
  const match =
    /^(\d+(?:\.\d+)?)([kmb])?\s*[-\u2013\u2014]\s*(\d+(?:\.\d+)?)([kmb])?/.exec(
      text.slice(index),
    );
  const leftRaw = match?.[1];
  const rightRaw = match?.[3];
  if (!match || !leftRaw || !rightRaw) return null;
  let end = index + match[0].length;
  const next = text[end];
  if (match[4]) {
    if (next !== undefined && /[a-z0-9_]/.test(next)) return null;
  } else if (next !== undefined && /[a-z_]/.test(next)) {
    return null;
  }
  const percentEnd = readPercent(text, end);
  if (percentEnd !== null) end = percentEnd;
  const left = formatAmount(leftRaw, match[2]);
  const right = formatAmount(rightRaw, match[4]);
  return {
    end,
    claims: [claim(left, percentEnd !== null), claim(right, percentEnd !== null)],
  };
}

function matchNumeric(text: string, index: number): Hit | null {
  if (!boundary(text, index)) return null;
  const match = /^(\d+(?:\.\d+)?)([kmb])?/.exec(text.slice(index));
  const raw = match?.[1];
  if (!match || !raw) return null;
  let end = index + match[0].length;
  const next = text[end];
  if (match[2]) {
    if (next !== undefined && /[a-z0-9_]/.test(next)) return null;
  } else if (next !== undefined && /[a-z_]/.test(next)) {
    return null;
  }
  const percentEnd = readPercent(text, end);
  if (percentEnd !== null) end = percentEnd;
  return {
    end,
    claims: [claim(formatAmount(raw, match[2]), percentEnd !== null)],
  };
}

function readWord(text: string, index: number): Piece | null {
  const match = /^[a-z]+/.exec(text.slice(index));
  if (!match) return null;
  return { text: match[0], end: index + match[0].length };
}

function wordAfter(text: string, end: number): { hyphen: boolean; word: Piece } | null {
  const hyphen = /^[-\u2013\u2014]([a-z]+)/.exec(text.slice(end));
  if (hyphen?.[1]) {
    return {
      hyphen: true,
      word: { text: hyphen[1], end: end + hyphen[0].length },
    };
  }
  const spaced = /^\s+([a-z]+)/.exec(text.slice(end));
  if (spaced?.[1]) {
    return {
      hyphen: false,
      word: { text: spaced[1], end: end + spaced[0].length },
    };
  }
  return null;
}

function collectNumberWords(text: string, index: number): Piece[] {
  const first = readWord(text, index);
  if (!first || !NUMBER_WORDS.has(first.text)) return [];
  const words = [first];
  let end = first.end;
  while (words.length < 16) {
    const next = wordAfter(text, end);
    if (!next || !NUMBER_WORDS.has(next.word.text)) break;
    words.push(next.word);
    end = next.word.end;
  }
  return words;
}

function parseBelow100(words: Piece[], start: number): Parsed | null {
  const word = words[start];
  if (!word) return null;
  const teen = TEENS[word.text];
  if (teen !== undefined) return { value: teen, next: start + 1 };
  const ten = TENS[word.text];
  if (ten !== undefined) {
    const ones = words[start + 1];
    const onesValue = ones ? UNITS[ones.text] : undefined;
    if (onesValue !== undefined && onesValue > 0) {
      return { value: ten + onesValue, next: start + 2 };
    }
    return { value: ten, next: start + 1 };
  }
  const unit = UNITS[word.text];
  if (unit !== undefined) return { value: unit, next: start + 1 };
  return null;
}

function parseHundreds(words: Piece[], start: number): Parsed | null {
  const word = words[start];
  if (!word) return null;
  const unit = UNITS[word.text];
  if (unit === undefined || unit === 0) return null;
  if (words[start + 1]?.text !== "hundred") return null;
  let value = unit * 100;
  let next = start + 2;
  if (words[next]?.text === "and") {
    const rest = parseBelow100(words, next + 1);
    if (rest) {
      value += rest.value;
      next = rest.next;
    }
  } else {
    const rest = parseBelow100(words, next);
    if (rest) {
      value += rest.value;
      next = rest.next;
    }
  }
  return { value, next };
}

function parseBelow1000(words: Piece[], start: number): Parsed | null {
  return parseHundreds(words, start) ?? parseBelow100(words, start);
}

function parsePhrase(words: Piece[]): Parsed | null {
  const head = parseBelow1000(words, 0);
  if (!head) return null;
  if (words[head.next]?.text !== "thousand") return head;
  let value = head.value * 1000;
  let next = head.next + 1;
  if (words[next]?.text === "and") {
    const rest = parseBelow1000(words, next + 1);
    if (rest) {
      value += rest.value;
      next = rest.next;
    }
  } else {
    const rest = parseBelow1000(words, next);
    if (rest) {
      value += rest.value;
      next = rest.next;
    }
  }
  return { value, next };
}

function isQuantity(words: Piece[], parsed: Parsed): boolean {
  if (parsed.next === 1 && words[0]?.text === "one") return false;
  if (
    parsed.next === 2 &&
    words[0]?.text === "one" &&
    words[1]?.text === "hundred"
  ) {
    return false;
  }
  return true;
}

function matchWritten(text: string, index: number): Hit | null {
  if (!boundary(text, index)) return null;
  const first = readWord(text, index);
  if (!first) return null;

  if (VAGUE.has(first.text)) return { end: first.end, claims: [first.text] };

  if (first.text === "a") {
    const next = wordAfter(text, first.end);
    if (!next || next.hyphen || next.word.text !== "dozen") return null;
    const percentEnd = readPercent(text, next.word.end);
    return {
      end: percentEnd ?? next.word.end,
      claims: [claim("12", percentEnd !== null)],
    };
  }

  if (ORDINALS.has(first.text)) return { end: first.end, claims: [] };

  const tail = wordAfter(text, first.end);
  if (
    TENS[first.text] !== undefined &&
    tail?.hyphen &&
    ORDINAL_UNITS.has(tail.word.text)
  ) {
    return { end: tail.word.end, claims: [] };
  }

  const words = collectNumberWords(text, index);
  const parsed = words.length > 0 ? parsePhrase(words) : null;
  if (!parsed || !isQuantity(words, parsed)) return null;
  const last = words[parsed.next - 1];
  if (!last) return null;
  const percentEnd = readPercent(text, last.end);
  return {
    end: percentEnd ?? last.end,
    claims: [claim(String(parsed.value), percentEnd !== null)],
  };
}

export function extractNumbers(text: string): string[] {
  const source = stripThousandsCommas(text.toLowerCase());
  const claims: string[] = [];
  let index = 0;
  while (index < source.length) {
    const hit =
      matchDigitOrdinal(source, index) ??
      matchRange(source, index) ??
      matchNumeric(source, index) ??
      matchWritten(source, index);
    if (hit && hit.end > index) {
      claims.push(...hit.claims);
      index = hit.end;
    } else {
      index += 1;
    }
  }
  return [...new Set(claims)].sort();
}
