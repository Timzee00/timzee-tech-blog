// Branded PNGs are generated from the approved Blipmood artwork.
// Download into the deploy output and verify SHA-256 to prevent altered assets.
// After build, public pages load first-party /assets/brand/*.png URLs.
import {createHash} from "node:crypto";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import {resolve,dirname} from "node:path";

export const BRAND_ASSETS = Object.freeze([
  {
    filename:"blipmood-wordmark-light.png",
    url:"https://d2ol7oe51mr4n9.cloudfront.net/user_3JR5g6OD2PPsWciJ9XxM8Ue05wO/809f2766-cefa-4133-9be0-a9e34a79ea67.png",
    sha256:"4538dea711cdbcb707477d4923ed5891be4a8d928698aabce21988d7c5c23719"
  },
  {
    filename:"blipmood-wordmark-dark.png",
    url:"https://d2ol7oe51mr4n9.cloudfront.net/user_3JR5g6OD2PPsWciJ9XxM8Ue05wO/1edfccf6-fdc1-409c-b9c5-162b23657600.png",
    sha256:"2a42dee4bb474e8a82b2c39122b5f567b1f463ac5b0d217f9dc5029170accbc5"
  },
  {
    filename:"blipmood-emblem-light.png",
    url:"https://d2ol7oe51mr4n9.cloudfront.net/user_3JR5g6OD2PPsWciJ9XxM8Ue05wO/cb2e26bb-2d48-471d-80fc-67d8ffc1b06b.png",
    sha256:"7476b236707343c1fde88cf2767d2c82fcf70869bbb397ba7b9c2705c99ee4f3"
  },
  {
    filename:"blipmood-emblem-dark.png",
    url:"https://d2ol7oe51mr4n9.cloudfront.net/user_3JR5g6OD2PPsWciJ9XxM8Ue05wO/fc802f03-1c6f-4c85-ab4c-a31f4a6b2981.png",
    sha256:"91dcd2d4ec020d6c2d5dcbe2b4a59988c0c182ea440787f23d12c6688f9d0f52"
  },
  {
    filename:"blipmood-social-card.png",
    url:"https://d2ol7oe51mr4n9.cloudfront.net/user_3JR5g6OD2PPsWciJ9XxM8Ue05wO/8be94ce3-724a-47f8-9a37-522d21401095.png",
    sha256:"882105503e20f2f6e903581699a17ac7507da25946392cdfbef60c516c465fe0"
  }
]);

const PNG_MAGIC=Buffer.from([137,80,78,71,13,10,26,10]);

export async function downloadBrandAssets(output) {
  const folder=resolve(output,"assets/brand");
  await mkdir(folder,{recursive:true});
  await Promise.all(BRAND_ASSETS.map(async asset => {
    const response=await fetch(asset.url,{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error(`Blipmood asset ${asset.filename}: download HTTP ${response.status}`);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length<100||bytes.length>2500000||!bytes.subarray(0,8).equals(PNG_MAGIC))
      throw new Error(`Blipmood asset ${asset.filename} is not a valid-size PNG`);
    if(createHash("sha256").update(bytes).digest("hex")!==asset.sha256)
      throw new Error(`Blipmood asset ${asset.filename}: integrity verification failed`);
    await writeFile(resolve(folder,asset.filename),bytes);
  }));
}
export function useLocalBrandAssetUrls(contents) {
  let result=contents;
  for(const asset of BRAND_ASSETS) {
    result=result.split(asset.url).join("/assets/brand/"+asset.filename);
  }
  return result;
}
