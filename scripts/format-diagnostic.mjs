import { readFileSync } from "node:fs";
import prettier from "prettier";
const paths = ["tests/queries/invoice-exposure.test.ts"];
for (const path of paths) {
  const original = readFileSync(path,"utf8");
  const config = (await prettier.resolveConfig(path)) ?? {};
  const formatted = await prettier.format(original,{...config,filepath:path});
  const base64 = Buffer.from(formatted,"utf8").toString("base64");
  for (let i=0; i<base64.length; i+=2000) console.log("FORMATCHUNK|"+path+"|"+(i/2000)+"|"+base64.slice(i,i+2000));
}
