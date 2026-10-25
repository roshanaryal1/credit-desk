import { readFileSync } from "node:fs";
import prettier from "prettier";
for (const path of ["lib/agent/manifest.ts","lib/agent/runner.ts","lib/agent/stored-validation.ts","lib/agent/evidence.ts","lib/db/schema.ts","tests/agent/manifest.test.ts","tests/db/schema.test.ts"]) {
const original=readFileSync(path,"utf8");
const config=(await prettier.resolveConfig(path))??{};
const formatted=await prettier.format(original,{...config,filepath:path});
if (original===formatted) continue;
const b64=Buffer.from(formatted,"utf8").toString("base64");
for(let i=0;i<b64.length;i+=2000)console.log("FORMATCHUNK|"+path+"|"+(i/2000)+"|"+b64.slice(i,i+2000));
}
