import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,openSync,closeSync,fsyncSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {protect} from './session-store.mjs';

// Caller holds the existing site-wide operation lock. Nothing sensitive is plaintext.
export function pendingStore(directory,site,crypt=protect) {
  const kinds=new Set(['note','payment','collection','daily','booking_operation','native_collection','cimac_maintenance']);
  const root=join(directory,'pending-v1');mkdirSync(root,{recursive:true});
  function path(actor){if(typeof actor!=='string'||!actor)throw new Error('login_required');return join(root,createHash('sha256').update(site+'|'+actor).digest('hex')+'.dpapi');}
  function load(actor){
    const file=path(actor);if(!existsSync(file))return {formatVersion:1,site,actor,items:[]};
    let data;try{const bytes=readFileSync(file);if(bytes.length>8*1024*1024)throw new Error();data=JSON.parse(crypt(bytes,'unprotect').toString('utf8'));}catch{throw new Error('pending_storage_unreadable_do_not_reset');}
    if(![1,2,3].includes(data.formatVersion))throw new Error('pending_format_upgrade_required');
    if(data.site!==site||data.actor!==actor||!Array.isArray(data.items)||data.items.length>500)throw new Error('pending_storage_identity_mismatch');
    if(data.items.some(item=>!item || !kinds.has(item.kind) || (item.kind==='native_collection' && data.formatVersion<2) || (item.kind==='cimac_maintenance' && data.formatVersion!==3)))throw new Error('pending_kind_upgrade_required');
    return data;
  }
  function save(actor,data){
    const text=JSON.stringify(data);if(Buffer.byteLength(text)>4*1024*1024)throw new Error('pending_storage_full');
    const file=path(actor),temp=file+'.'+randomUUID()+'.tmp';
    const encrypted=crypt(text,'protect');let fd;
    try{fd=openSync(temp,'wx');writeFileSync(fd,encrypted);fsyncSync(fd);}finally{if(fd!==undefined)closeSync(fd);}
    // An interrupted rename leaves the previous committed ciphertext intact.
    renameSync(temp,file);
  }
  return {
    list(actor){return load(actor).items.map(({requestId,kind,state,createdAt,updatedAt})=>({requestId,kind,state,createdAt,updatedAt}));},
    get(actor,id){const item=load(actor).items.find(x=>x.requestId===id);if(!item)throw new Error('pending_not_found');return structuredClone(item);},
    put(actor,item){
      if(!/^[0-9a-f-]{36}$/i.test(item.requestId)||!kinds.has(item.kind))throw new Error('invalid_pending_request');
      const data=load(actor),index=data.items.findIndex(x=>x.requestId===item.requestId);
      if(index<0&&data.items.length>=500)throw new Error('pending_storage_full');
      const now=new Date().toISOString(),value={...item,createdAt:index<0?now:data.items[index].createdAt,updatedAt:now};
      if(index<0)data.items.push(value);else data.items[index]=value;
      if(item.kind==='native_collection')data.formatVersion=Math.max(data.formatVersion,2);
      if(item.kind==='cimac_maintenance')data.formatVersion=3;
      save(actor,data);return structuredClone(value);
    },
  };
}
