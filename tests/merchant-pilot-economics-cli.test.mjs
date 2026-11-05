import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";

test("economics CLI rejects oversized pilot and ledger inputs before JSON parsing",()=>{
  const dir=mkdtempSync(join(tmpdir(),"merchant-cost-limit-"));
  try {
    const oversized=join(dir,"oversized.json");
    const small=join(dir,"small.json");
    writeFileSync(oversized,"x".repeat(1024*1024+1));
    writeFileSync(small,"{}");
    for(const args of [[oversized,small],[small,oversized]]){
      const result=spawnSync(process.execPath,["scripts/merchant-pilot-economics.mjs",...args],{encoding:"utf8"});
      assert.equal(result.status,1);
      assert.match(result.stderr,/input exceeds 1 MiB/);
      assert.doesNotMatch(result.stderr,/Unexpected token|JSON parse/);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});
