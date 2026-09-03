/**
 * 赋予指定 LDAP 用户平台管理员角色。
 * 用法：node scripts/grant-admin.cjs <ldap> [--data-dir ./data]
 * 用户不存在时按 CAS 影子账号预建档（首次 CAS 登录自动关联）。
 */
const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");

const args = process.argv.slice(2);
const ldap = args.find((a) => !a.startsWith("--"));
if (!ldap) {
  console.error("用法: node scripts/grant-admin.cjs <ldap> [--data-dir ./data]");
  process.exit(1);
}
const dirIdx = args.indexOf("--data-dir");
const dataDir = path.resolve(dirIdx >= 0 ? args[dirIdx + 1] : process.env.DATA_DIR || "./data");

const db = new Database(path.join(dataDir, "haitun-post-studio.db"));
const organizationDomain = (process.env.ORG_EMAIL_DOMAIN || "example.com").toLowerCase();
const email = ldap.includes("@") ? ldap.toLowerCase() : `${ldap}@${organizationDomain}`;

const existing = db.prepare("SELECT id, name, role FROM users WHERE email = ?").get(email);
if (existing) {
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id);
  console.log(`已将 ${email}（${existing.name}）的角色由 ${existing.role} 升级为 admin`);
} else {
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, '!cas', 'admin', ?)"
  ).run(crypto.randomUUID(), email, email.split("@")[0], Date.now());
  console.log(`用户 ${email} 不存在，已预建档为 admin（首次 CAS 登录自动关联）`);
}
db.close();
