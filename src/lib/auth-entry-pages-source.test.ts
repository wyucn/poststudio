import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("CAS entry pages redirect before local credentials or registration render", async () => {
  const root = process.cwd();
  const [loginPage, localLogin, registerPage, localRegister] = await Promise.all([
    readFile(path.join(root, "src/app/login/page.tsx"), "utf8"),
    readFile(path.join(root, "src/app/login/local-login-page.tsx"), "utf8"),
    readFile(path.join(root, "src/app/register/page.tsx"), "utf8"),
    readFile(path.join(root, "src/app/register/local-register-page.tsx"), "utf8"),
  ]);

  for (const entry of [loginPage, registerPage]) {
    assert.match(entry, /import \{ redirect \} from "next\/navigation"/);
    assert.match(entry, /import \{ isCasMode \} from "@\/lib\/auth\/cas"/);
    assert.match(entry, /if \(isCasMode\(\)\) redirect\("\/"\)/);
    assert.doesNotMatch(entry, /signIn\(|api\("\/api\/register"|htmlFor="email"/);
  }

  assert.match(loginPage, /<LocalLoginPage \/>/);
  assert.match(localLogin, /signIn\("credentials"/);
  assert.match(localLogin, /href="\/register"/);
  assert.match(localLogin, /htmlFor="email"/);
  assert.match(localLogin, /htmlFor="password"/);

  assert.match(registerPage, /<LocalRegisterPage \/>/);
  assert.match(localRegister, /api\("\/api\/register"/);
  assert.match(localRegister, /href="\/login"/);
  assert.match(localRegister, /htmlFor="inviteCode"/);
});
