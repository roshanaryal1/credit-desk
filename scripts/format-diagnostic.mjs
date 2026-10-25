import { readFileSync } from "node:fs";
import prettier from "prettier";
for (const path of ["app/credit-memos/[id]/page.tsx","app/demo/client/page.tsx","app/queue/cases/page.tsx","lib/credit/evidence-checklist.ts","lib/credit/memo-export.ts","tests/credit/evidence-checklist.test.ts"]) {
const original=readFileSync(path,"utf8");
const config=(await prettier.resolveConfig(path))??{};
const formatted=await prettier.format(original,{...config,filepath:path});
const b64=Buffer.from(formatted,"utf8").toString("base64");
for(let i=0;i<b64.length;i+=2000)console.log("FORMATCHUNK|"+path+"|"+(i/2000)+"|"+b64.slice(i,i+2000));
}
