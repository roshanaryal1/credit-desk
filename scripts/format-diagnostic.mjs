import { readFileSync } from "node:fs";
import prettier from "prettier";
for (const path of ["app/clients/[id]/borrowing-base/page.tsx","lib/credit/scenario-comparison.ts","tests/credit/scenario-comparison.test.ts"]) {
  const original = readFileSync(path, "utf8");
  const options = (await prettier.resolveConfig(path)) ?? {};
  const formatted = await prettier.format(original, {...options,filepath:path});
  const b64 = Buffer.from(formatted,"utf8").toString("base64");
  for(let i=0;i<b64.length;i+=2000){console.log("FORMATCHUNK|"+path+"|"+(i/2000)+"|"+b64.slice(i,i+2000));}
}
