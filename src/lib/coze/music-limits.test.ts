import assert from "node:assert/strict";
import test from "node:test";
import {
  isMusicTextLimitErrorMessage,
  musicTextLength,
  musicTextValidationMessage,
} from "./music-limits";

test("matches the live Coze music text boundaries", () => {
  assert.equal(musicTextValidationMessage("song", "a".repeat(499)), null);
  assert.match(
    musicTextValidationMessage("song", "a".repeat(500)) ?? "",
    /最多 499 字/
  );
  assert.equal(musicTextValidationMessage("bgm", "a".repeat(499)), null);
  assert.match(
    musicTextValidationMessage("bgm", "a".repeat(500)) ?? "",
    /最多 499 字/
  );
  assert.equal(musicTextValidationMessage("lyrics_song", "a".repeat(700)), null);
  assert.match(
    musicTextValidationMessage("lyrics_song", "a".repeat(701)) ?? "",
    /最多 700 字/
  );
});

test("counts Unicode code points for the user-facing counter", () => {
  assert.equal(musicTextLength("😀"), 1);
  assert.equal(musicTextLength("海豚😀"), 3);
});

test("recognizes provider length errors without mistaking rate limits", () => {
  assert.equal(
    isMusicTextLimitErrorMessage("Lyrics must be between 5 and 700 characters"),
    true
  );
  assert.equal(
    isMusicTextLimitErrorMessage("Prompt must be less than 500 characters"),
    true
  );
  assert.equal(isMusicTextLimitErrorMessage("HTTP 429 rate limit exceeded"), false);
});
