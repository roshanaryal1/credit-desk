import {readFileSync} from "node:fs";
import prettier from "prettier";
for(const path of ["lib/watch/rules.ts","tests/watch/policy-aware-rules.test.ts"]) {
const content=readFileSync(path,"utf8");
const config=(await prettier.resolveConfig(path))??{};
const formatted=await prettier.format(content,{...config,filepath:path});
if(content===formatted)continue;
const base64=Buffer.from(formatted,"utf8").toString("base64");
for(let i=0;i<base64.length;i+=2000)console.log("FORMATCHUNK|"+path+"|"+(i/2000)+"|"+base64.slice(i,i+2000));
}
