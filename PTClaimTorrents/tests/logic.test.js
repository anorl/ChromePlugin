const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = { URL };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync("logic.js", "utf8"), context);

const logic = context.PTClaimLogic;

assert.equal(
  logic.torrentIdFromUrl("viewclaims.php?in_modal=yes&do_ajax=1&add_torrent_id=872683"),
  "872683"
);
assert.equal(logic.torrentIdFromUrl("viewclaims.php?remove_torrent_id=1"), null);
assert.deepEqual(
  JSON.parse(JSON.stringify(logic.normalizeConfig({ minActionDelayMs: 10, maxActionDelayMs: 20 }))),
  { minActionDelayMs: 250, maxActionDelayMs: 250, minTorrentDelayMs: 3000, maxTorrentDelayMs: 5500 }
);
assert.equal(logic.randomBetween(10, 20, 0), 10);
assert.equal(logic.randomBetween(10, 20, 0.9999), 20);
assert.equal(logic.looksLikeFailure("认领失败", "猫粮不足"), true);
assert.equal(logic.looksLikeFailure("认领成功", "操作完成"), false);

console.log("logic tests passed");
