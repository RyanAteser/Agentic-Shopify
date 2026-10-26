import * as crypto from "node:crypto";

/** Refresh tokens encrypted at rest with a dedicated deploy-time AES-256-GCM secret. */
function key(){
  const input=process.env.GSC_ENCRYPTION_KEY;
  if(!input)throw new Error("GSC_ENCRYPTION_KEY not configured");
  const bytes=Buffer.from(input,"base64");
  if(bytes.length!==32)throw new Error("GSC_ENCRYPTION_KEY must decode to 32 bytes");
  return bytes;
}
export function encryptToken(token:string) {
  if(!token||token.length>8192)throw new Error("Invalid refresh token");
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv("aes-256-gcm",key(),iv);
  const data=Buffer.concat([cipher.update(token,"utf8"),cipher.final()]);
  return ["v1",iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),data.toString("base64url")].join(".");
}
export function decryptToken(blob:string) {
  const [version,iv,tag,data,...extra]=blob.split(".");
  if(version!=="v1"||!iv||!tag||!data||extra.length)throw new Error("Unsupported token ciphertext");
  const decipher=crypto.createDecipheriv("aes-256-gcm",key(),Buffer.from(iv,"base64url"));
  decipher.setAuthTag(Buffer.from(tag,"base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data,"base64url")),decipher.final()]).toString("utf8");
}
export function randomOAuthState(){
  const raw=crypto.randomBytes(32).toString("base64url");
  return {raw,hash:hashState(raw)};
}
export function hashState(raw:string){return crypto.createHash("sha256").update(raw).digest("hex");}
