// 清理 coze-e2e 冒烟测试产生的临时项目与用户
const Database = require("better-sqlite3");
const fs = require("fs");
const db = new Database("./data/haitun-post-studio.db");
const projs = db.prepare("select id from projects where name like 'coze-smoke-%'").all();
for (const p of projs) {
  const as = db.prepare("select object_key from assets where project_id=?").all(p.id);
  for (const a of as) {
    if (a.object_key) {
      try {
        fs.unlinkSync("./data/media/" + a.object_key);
      } catch {}
    }
  }
  db.prepare("delete from assets where project_id=?").run(p.id);
  db.prepare("delete from tasks where project_id=?").run(p.id);
  db.prepare("delete from project_members where project_id=?").run(p.id);
  db.prepare("delete from projects where id=?").run(p.id);
}
db.prepare("delete from users where email='smoke@test.local'").run();
console.log("cleaned", projs.length, "smoke projects + temp user");
