import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@/db/schema";
import { HttpError } from "@/lib/http-error";
import {
  CAS_PASSWORD_HASH,
  assertRegistrationEnabled,
  authorizeLocalCredentials,
  getOrCreateCasUser,
  parseCasLdapResponse,
  projectAccess,
  resolveMemberTarget,
  resolveSessionUserByMode,
} from "./policy";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "member@example.com",
    name: "Member",
    passwordHash: "hash",
    role: "member",
    department: null,
    lastSeenAt: null,
    createdAt: new Date("2026-07-23T00:00:00Z"),
    ...overrides,
  };
}

function makeRepository(initial: User[] = []) {
  const records = [...initial];
  let nextId = 1;
  return {
    records,
    deps: {
      findUserByEmail: (email: string) =>
        records.find((user) => user.email === email),
      insertUser: (user: User) => {
        records.push(user);
      },
      countUsers: () => records.length,
      createId: () => `generated-${nextId++}`,
      now: () => new Date("2026-07-23T08:00:00Z"),
    },
  };
}

test("local credentials normalize email and return the session user", async () => {
  const user = makeUser();
  let compared: [string, string] | null = null;
  const result = await authorizeLocalCredentials(
    { email: " MEMBER@EXAMPLE.COM ", password: "secret" },
    {
      findUserByEmail: (email) => (email === user.email ? user : undefined),
      comparePassword: async (password, hash) => {
        compared = [password, hash];
        return true;
      },
    }
  );

  assert.deepEqual(compared, ["secret", "hash"]);
  assert.deepEqual(result, {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });
});

test("local credentials reject missing, invalid, and CAS-only accounts", async () => {
  let compareCalls = 0;
  const comparePassword = async () => {
    compareCalls += 1;
    return false;
  };

  assert.equal(
    await authorizeLocalCredentials(undefined, {
      findUserByEmail: () => undefined,
      comparePassword,
    }),
    null
  );
  assert.equal(
    await authorizeLocalCredentials(
      { email: "missing@example.com", password: "secret" },
      { findUserByEmail: () => undefined, comparePassword }
    ),
    null
  );
  assert.equal(
    await authorizeLocalCredentials(
      { email: "cas@example.com", password: "secret" },
      {
        findUserByEmail: () =>
          makeUser({
            email: "cas@example.com",
            passwordHash: CAS_PASSWORD_HASH,
          }),
        comparePassword,
      }
    ),
    null
  );
  assert.equal(
    await authorizeLocalCredentials(
      { email: "member@example.com", password: "wrong" },
      {
        findUserByEmail: () => makeUser(),
        comparePassword,
      }
    ),
    null
  );
  assert.equal(compareCalls, 1);
});

test("session resolution calls only the active authentication mode", async () => {
  const user = {
    id: "cas-user",
    email: "tester@example.com",
    name: "tester",
    role: "member",
  };
  let casCalls = 0;
  let localCalls = 0;

  assert.deepEqual(
    await resolveSessionUserByMode({
      casMode: true,
      casCookie: "cookie-value",
      getCasUser: async (cookie) => {
        casCalls += 1;
        assert.equal(cookie, "cookie-value");
        return user;
      },
      getLocalUser: async () => {
        localCalls += 1;
        return null;
      },
    }),
    user
  );
  assert.equal(casCalls, 1);
  assert.equal(localCalls, 0);

  assert.equal(
    await resolveSessionUserByMode({
      casMode: false,
      getCasUser: async () => {
        casCalls += 1;
        return user;
      },
      getLocalUser: async () => {
        localCalls += 1;
        return null;
      },
    }),
    null
  );
  assert.equal(casCalls, 1);
  assert.equal(localCalls, 1);
});

test("CAS response parsing accepts only valid LDAP identities", () => {
  assert.equal(parseCasLdapResponse("'zhangsan'"), "zhangsan");
  assert.equal(parseCasLdapResponse("wang.wu-2"), "wang.wu-2");
  assert.equal(parseCasLdapResponse("'failed'"), null);
  assert.equal(parseCasLdapResponse("'UPPERCASE'"), null);
  assert.equal(parseCasLdapResponse("'../../admin'"), null);
});

test("CAS provisioning reuses existing users without inserting", () => {
  const existing = makeUser({
    id: "existing",
    email: "tester@example.com",
    name: "Tester",
  });
  const repository = makeRepository([existing]);
  const result = getOrCreateCasUser("tester", repository.deps);

  assert.equal(result.created, false);
  assert.equal(result.user.id, "existing");
  assert.equal(repository.records.length, 1);
});

test("CAS provisioning makes the first user admin and later users members", () => {
  const repository = makeRepository();
  const first = getOrCreateCasUser("first.user", repository.deps);
  const second = getOrCreateCasUser("second-user", repository.deps);

  assert.equal(first.created, true);
  assert.equal(first.user.role, "admin");
  assert.equal(second.user.role, "member");
  assert.equal(repository.records[0]?.passwordHash, CAS_PASSWORD_HASH);
  assert.equal(repository.records[1]?.email, "second-user@example.com");
});

test("CAS mode disables registration while local mode remains enabled", () => {
  assert.doesNotThrow(() => assertRegistrationEnabled(undefined));
  assert.doesNotThrow(() => assertRegistrationEnabled("local"));
  assert.throws(
    () => assertRegistrationEnabled("cas"),
    (error) =>
      error instanceof HttpError &&
      error.status === 403 &&
      error.message === "已启用公司账号登录，无需注册"
  );
});

test("member resolution requires registered email in local mode", () => {
  const existing = makeUser();
  const repository = makeRepository([existing]);
  assert.equal(
    resolveMemberTarget(" MEMBER@EXAMPLE.COM ", false, repository.deps).user.id,
    existing.id
  );
  assert.throws(
    () => resolveMemberTarget("new@example.com", false, repository.deps),
    (error) => error instanceof HttpError && error.status === 404
  );
  assert.throws(
    () => resolveMemberTarget("ldap-only", false, repository.deps),
    (error) => error instanceof HttpError && error.status === 400
  );
});

test("member resolution pre-creates valid company LDAP users in CAS mode", () => {
  const repository = makeRepository();
  const result = resolveMemberTarget(
    " New.Colleague ",
    true,
    repository.deps
  );

  assert.equal(result.created, true);
  assert.equal(result.user.email, "new.colleague@example.com");
  assert.equal(result.user.passwordHash, CAS_PASSWORD_HASH);
  assert.equal(result.user.role, "member");
  assert.throws(
    () => resolveMemberTarget("../invalid", true, repository.deps),
    (error) => error instanceof HttpError && error.status === 400
  );
});

test("project access follows Owner, Editor, and Viewer roles", () => {
  assert.equal(projectAccess("admin", null, "private"), "edit");
  assert.equal(projectAccess("member", "owner", "private"), "edit");
  assert.equal(projectAccess("member", "editor", "private"), "edit");
  assert.equal(projectAccess("member", "viewer", "private"), "view");
  assert.equal(projectAccess("member", null, "private"), "none");
  assert.equal(projectAccess("member", null, "org"), "view");
  assert.equal(projectAccess("member", null, "dept"), "view");
});
