// ============================================================
// answer-match.js — shared answer checker for History Bowl and
// Geography Bowl review sites.   window.answerMatches(given, answer)
//
// Rules
//  • Case, accents, punctuation and symbols are ignored.
//  • Filler words (the, a, an, of, in, …) are dropped from both sides.
//  • Word order doesn't matter.
//  • "X or Y" (also "/", ";", ",") in the ANSWER = either is accepted.
//  • "X and Y" (also "&") in the ANSWER = both must be given.
//  • Typing "or" in your submission (hedging) is always wrong.
//  • Every word you type must belong to the answer — no bonus words,
//    except one leading first name / title ("Thomas Jefferson" for
//    "Jefferson").
//  • Dropping words is OK only if you keep the distinctive last word:
//    "Washington" for "George Washington", "Actium" for "Battle of
//    Actium". Not OK when that last word is generic ("Falls", "War",
//    "Africa", a number …): "Africa" ≠ "South Africa".
//  • Small spelling slips are forgiven: 1 typo in words of 6+ letters,
//    and same-sounding spellings (Lewis / Louis) with the same first
//    letter. Numbers must match exactly (1812 ≠ 1813, VII ≠ VIII).
//  • Parenthetical notes: "(accept X)" adds X as an answer,
//    "(do not accept X)" / "(prompt on X)" are ignored, any other
//    "(…)" words are optional.
// ============================================================
(function () {
  const FILLER = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'for', 'by', 'to', 'from', 'with', 'and',
    'el', 'la', 'los', 'las', 'le', 'les', 'de', 'du', 'des', 'un', 'une', 'der', 'die', 'das']);

  // Words that are too generic to stand in for the whole answer on their own.
  const GENERIC = new Set(['battle', 'war', 'treaty', 'act', 'party', 'company', 'revolution', 'dynasty', 'empire',
    'kingdom', 'republic', 'state', 'united', 'north', 'south', 'east', 'west', 'northern', 'southern', 'eastern',
    'western', 'central', 'new', 'old', 'great', 'little', 'upper', 'lower', 'river', 'lake', 'sea', 'ocean', 'gulf',
    'bay', 'strait', 'mountain', 'mount', 'mt', 'range', 'island', 'isle', 'fall', 'city', 'town', 'county',
    'province', 'desert', 'peninsula', 'canal', 'harbor', 'harbour', 'park', 'valley', 'plain', 'plateau', 'basin',
    'delta', 'cape', 'point', 'purchase', 'rebellion', 'crisis', 'affair', 'massacre', 'movement', 'doctrine',
    'compromise', 'amendment', 'church', 'council', 'league', 'union', 'federation', 'confederation', 'america',
    'africa', 'asia', 'europe', 'king', 'queen', 'emperor', 'empress', 'president', 'saint', 'day', 'age', 'period',
    'era', 'crusade', 'canyon', 'sound', 'channel', 'coast', 'land', 'republic', 'democratic', 'people', 'federal',
    'national', 'royal', 'holy', 'grand', 'high', 'first', 'second', 'third', 'war', 'wall', 'tower', 'bridge',
    'palace', 'temple', 'castle', 'building', 'square', 'street', 'road', 'trail', 'railroad', 'railway']);

  const NUM = {
    one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6,
    seven: 7, seventh: 7, eight: 8, eighth: 8, nine: 9, ninth: 9, ten: 10, tenth: 10, eleven: 11, eleventh: 11,
    twelve: 12, twelfth: 12, thirteen: 13, thirteenth: 13, fourteen: 14, fourteenth: 14, fifteen: 15, fifteenth: 15,
    sixteen: 16, sixteenth: 16, seventeen: 17, seventeenth: 17, eighteen: 18, eighteenth: 18, nineteen: 19,
    nineteenth: 19, twenty: 20, twentieth: 20,
  };
  const ROMAN = /^(?=[ivxlc]+$)(c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;
  const romanToInt = (s) => {
    const v = { i: 1, v: 5, x: 10, l: 50, c: 100 };
    let n = 0;
    for (let i = 0; i < s.length; i++) n += v[s[i]] < (v[s[i + 1]] || 0) ? -v[s[i]] : v[s[i]];
    return n;
  };

  function normWord(w) {
    if (w === 'st' || w === 'saint') return 'saint';
    if (w === 'mt') return 'mount';
    if (NUM[w]) return String(NUM[w]);
    let m = w.match(/^(\d+)(st|nd|rd|th)$/);
    if (m) return m[1];
    if (ROMAN.test(w)) return String(romanToInt(w));
    if (/^\d+$/.test(w)) return String(Number(w));
    // light singularising (applied identically to both sides)
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
  }

  function tokens(text) {
    const words = String(text || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe')
      .replace(/[’'`´]/g, '')          // O'Neill → oneill
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim().split(/\s+/).filter(Boolean);
    const kept = words.filter((w) => !FILLER.has(w)).map(normWord);
    // An answer made only of filler words ("The Who"?) keeps them.
    return kept.length ? kept : words.map(normWord);
  }

  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }

  function soundex(w) {
    const code = { b: 1, f: 1, p: 1, v: 1, c: 2, g: 2, j: 2, k: 2, q: 2, s: 2, x: 2, z: 2, d: 3, t: 3, l: 4, m: 5, n: 5, r: 6 };
    let out = w[0], last = code[w[0]] || 0;
    for (let i = 1; i < w.length && out.length < 4; i++) {
      const c = code[w[i]] || 0;
      if (c && c !== last) out += c;
      if (w[i] !== 'h' && w[i] !== 'w') last = c;
    }
    return (out + '000').slice(0, 4);
  }

  function wordsMatch(g, a) {
    if (g === a) return true;
    if (/\d/.test(g) || /\d/.test(a)) return false;          // numbers must be exact
    if (g[0] !== a[0]) return false;                          // Prussia ≠ Russia
    const d = lev(g, a);
    if (Math.min(g.length, a.length) >= 6 && d <= 1) return true;                  // one typo
    if (Math.min(g.length, a.length) >= 4 && Math.abs(g.length - a.length) <= 1 &&
        d <= 2 && soundex(g) === soundex(a)) return true;                          // Lewis / Louis
    return false;
  }

  // "The Battle of Actium or The Battle of Octavian (accept Actium)"
  //   → [{ parts: [{ req: ['battle','actium'] }] }, …], optional: [...]
  function parseAnswer(answer) {
    const strings = Array.isArray(answer) ? answer : [answer];
    const alternatives = [];
    const optional = [];
    strings.forEach((raw) => {
      let s = String(raw || '');
      const extra = [];
      s = s.replace(/[\(\[]([^\)\]]*)[\)\]]/g, (_, inner) => {
        const t = inner.trim();
        if (/^(do not|don't|dont|not|prompt|reject|no)\b/i.test(t)) return ' ';
        const acc = t.match(/^(?:also\s+)?(?:accept|or)\s*:?\s*(.*)$/i);
        if (acc) extra.push(acc[1]);
        else optional.push(...tokens(t));
        return ' ';
      });
      s = s.replace(/\b(do not|don't) accept\b.*$/i, '').replace(/\bprompt on\b.*$/i, '');
      s = s.replace(/\baccept\b\s*:?\s*/gi, ' or ');
      [s, ...extra].forEach((chunk) => {
        chunk.split(/\s+or\s+|\/|;|,/i).forEach((alt) => {
          const parts = alt.split(/\s+and\s+|&/i)
            .map((p) => ({ req: [...new Set(tokens(p))] }))
            .filter((p) => p.req.length);
          if (parts.length) alternatives.push({ parts });
        });
      });
    });
    return { alternatives, optional };
  }

  function answerMatches(given, answer) {
    const rawGiven = String(given || '');
    if (/\bor\b/i.test(rawGiven)) return false;               // hedging: "Actium or Saratoga"
    const G = [...new Set(tokens(rawGiven))];
    if (!G.length) return false;
    const { alternatives, optional } = parseAnswer(answer);
    if (!alternatives.length) return false;

    const union = [...optional];
    alternatives.forEach((a) => a.parts.forEach((p) => union.push(...p.req)));
    const has = (kw) => G.some((g) => wordsMatch(g, kw));
    const unknownIdx = G.map((g, i) => (union.some((u) => wordsMatch(g, u)) ? -1 : i)).filter((i) => i >= 0);

    for (const alt of alternatives) {
      const fullParts = alt.parts.map((p) => p.req.every(has));
      const full = fullParts.every(Boolean);

      if (full && unknownIdx.length === 0) return true;
      // one leading first name / title: "Thomas Jefferson" for "Jefferson"
      if (full && unknownIdx.length === 1 && unknownIdx[0] === 0 && G.length >= 2) {
        const extra = G[0];
        if (!/\d/.test(extra) && !GENERIC.has(extra) && extra.length >= 3) return true;
      }
      // dropped words: keep the distinctive last word of each part
      if (unknownIdx.length === 0) {
        const ok = alt.parts.every((p, i) => {
          if (fullParts[i]) return true;
          const last = p.req[p.req.length - 1];
          return p.req.length >= 2 && !/\d/.test(last) && !GENERIC.has(last) && has(last);
        });
        if (ok) return true;
      }
    }
    return false;
  }

  window.answerMatches = answerMatches;
  window.__answerMatchInternals = { tokens, parseAnswer, wordsMatch };
})();
