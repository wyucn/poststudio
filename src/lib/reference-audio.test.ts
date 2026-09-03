import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { HttpError } from "./http-error";
import {
  bridgeReferenceAudio,
  type ReferenceAudioDependencies,
} from "./reference-audio";

function dependencies(
  overrides: Partial<ReferenceAudioDependencies> = {}
): ReferenceAudioDependencies {
  return {
    getObjectSize: async () => 1024,
    createObjectReadStream: () => Readable.from(Buffer.from("source")),
    transcodeReferenceAudioToMp3: async () => Buffer.from("mp3"),
    bridgeUpload: async () => ({ url: "https://bridge/transcoded.mp3", key: "transcoded" }),
    bridgeUploadObject: async () => ({ url: "https://bridge/source.mp3", key: "source" }),
    ...overrides,
  };
}

test("small MP3 reference audio is bridged without transcoding", async () => {
  let transcodeCalled = false;
  const result = await bridgeReferenceAudio(
    "source-key",
    "audio/mpeg; charset=binary",
    dependencies({
      transcodeReferenceAudioToMp3: async () => {
        transcodeCalled = true;
        return Buffer.from("unexpected");
      },
      bridgeUploadObject: async (objectKey, mime) => {
        assert.equal(objectKey, "source-key");
        assert.equal(mime, "audio/mpeg");
        return { url: "https://bridge/source.mp3", key: "source" };
      },
    })
  );

  assert.equal(transcodeCalled, false);
  assert.equal(result.key, "source");
});

test("unknown audio MIME is transcoded before bridge upload", async () => {
  let uploaded: Buffer | undefined;
  const result = await bridgeReferenceAudio(
    "legacy-key",
    null,
    dependencies({
      bridgeUpload: async (buffer, mime, ext) => {
        uploaded = buffer;
        assert.equal(mime, "audio/mpeg");
        assert.equal(ext, "mp3");
        return { url: "https://bridge/transcoded.mp3", key: "transcoded" };
      },
    })
  );

  assert.equal(uploaded?.toString("utf8"), "mp3");
  assert.equal(result.key, "transcoded");
});

test("transcode failures become safe actionable task errors", async () => {
  await assert.rejects(
    bridgeReferenceAudio(
      "wav-key",
      "audio/wav",
      dependencies({
        transcodeReferenceAudioToMp3: async () => {
          throw new Error("ffmpeg secret diagnostics");
        },
      })
    ),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 422);
      assert.equal(error.code, "REFERENCE_AUDIO_TRANSCODE_FAILED");
      assert.doesNotMatch(error.message, /ffmpeg secret diagnostics/);
      return true;
    }
  );
});

test("bridge failures are not mislabeled as transcode failures", async () => {
  const bridgeError = new HttpError(
    503,
    "中转服务暂时不可用，请稍后重试。",
    "MEDIA_BRIDGE_UNAVAILABLE"
  );
  await assert.rejects(
    bridgeReferenceAudio(
      "wav-key",
      "audio/wav",
      dependencies({
        bridgeUpload: async () => {
          throw bridgeError;
        },
      })
    ),
    (error) => error === bridgeError
  );
});

test("source audio over 100 MiB is rejected before reading", async () => {
  let streamOpened = false;
  await assert.rejects(
    bridgeReferenceAudio(
      "large-key",
      "audio/wav",
      dependencies({
        getObjectSize: async () => 101 * 1024 * 1024,
        createObjectReadStream: () => {
          streamOpened = true;
          return Readable.from(Buffer.alloc(0));
        },
      })
    ),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 413);
      assert.equal(error.code, "REFERENCE_AUDIO_SOURCE_TOO_LARGE");
      return true;
    }
  );
  assert.equal(streamOpened, false);
});
