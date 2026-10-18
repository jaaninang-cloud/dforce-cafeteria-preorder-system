'use strict';
// Validates and saves a menu photo sent as a data URL (JPG, PNG or WEBP). The file type is checked by its
// real bytes, not by the name or the data-URL header, so nothing else can be uploaded as a "photo".
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const MAX=1.5*1024*1024;                       // 1.5 MB per photo (the app shrinks photos to ~150 KB before sending)
const PNG=Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
const sniff=b=>{
  if(b.length<12)return null;
  if(b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF)return'jpg';
  if(b.subarray(0,8).equals(PNG))return'png';
  if(b.subarray(0,4).toString('latin1')==='RIFF'&&b.subarray(8,12).toString('latin1')==='WEBP')return'webp';
  return null};
const decode=u=>{
  const m=/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(typeof u==='string'?u:'');
  if(!m)return null;
  const buf=Buffer.from(m[1],'base64');
  if(!buf.length||buf.length>MAX)return null;
  const ext=sniff(buf);return ext?{buf,ext}:null};
const save=(dir,u)=>{
  const d=decode(u);if(!d)return null;
  fs.mkdirSync(dir,{recursive:true});
  const name=crypto.randomBytes(8).toString('hex')+'.'+d.ext;
  fs.writeFileSync(path.join(dir,name),d.buf);return name};
const saveBuf=(dir,buf)=>{
  if(!buf||!buf.length||buf.length>MAX)return null;
  const ext=sniff(buf);if(!ext)return null;
  fs.mkdirSync(dir,{recursive:true});
  const name=crypto.randomBytes(8).toString('hex')+'.'+ext;
  fs.writeFileSync(path.join(dir,name),buf);return name};
module.exports={decode,save,saveBuf,MAX};
