import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Standalone Node distribution has no application TS dependency.
import { OperatorClient, validateConfig, checkManifest, VERSION } from '../operator-connector/core.mjs';
const config={formatVersion:1,localTest:true,appUrl:'http://127.0.0.1:3100',supabaseUrl:'http://127.0.0.1:54321',publishableKey:'sb_publishable_test'};
const manifest={protocolVersion:'1.0',minimumConnectorVersion:'0.1.0',identity:{userId:'owner'},safeguards:{serviceRoleAllowed:false,arbitrarySqlAllowed:false,systemChangesAllowed:false,screenshotWritesRequireConfirmation:true},actions:[{name:'record_daily_payment',authorized:true,availability:'implemented',write:true}]};
const request={requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actionName:'record_daily_payment',scope:'business_data',exceptionalBusinessCase:false,inputSource:'excel_screenshot',originalInstruction:'test',input:{}};
const session=()=>({accessToken:'access-secret',refreshToken:'refresh-secret',userId:'owner',expiresAt:Date.now()+3600000,appUrl:config.appUrl,supabaseUrl:config.supabaseUrl});
function memoryStore() {let value: ReturnType<typeof session>|null=session();return {load:async()=>value,save:async(v: ReturnType<typeof session>)=>{value=v;},remove:async()=>{value=null;}};}
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
describe('standalone employee connector',()=>{
  it.each(['http://evil.invalid','https://user:pass@example.com','https://example.com/path','https://example.com/?q=x'])('rejects unsafe app endpoint %s',appUrl=>{expect(()=>validateConfig({...config,localTest:false,appUrl})).toThrow();});
  it('rejects service keys and loopback configuration drift',()=>{
    const jwt=`x.${Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')}.x`;
    expect(()=>validateConfig({...config,publishableKey:jwt})).toThrow('public_key_required');
    expect(()=>validateConfig({...config,supabaseUrl:'http://127.0.0.1:5555'})).toThrow();
  });
  it.each([{protocolVersion:'2.0'},{minimumConnectorVersion:'0.2.0'},{minimumConnectorVersion:'bad'},{safeguards:{}}])('fails closed on incompatible capability manifest %j',change=>{expect(()=>checkManifest({...manifest,...change})).toThrow();});
  it('creates a same-origin confirmation link without calling approval or changing request ID',async()=>{
    const transport=vi.fn().mockResolvedValueOnce(reply(manifest)).mockResolvedValueOnce(reply({previewProof:'proof',preview:{amount:10}})).mockResolvedValueOnce(reply({status:'awaiting_account_confirmation',confirmationPath:'/operator/confirmations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}));
    const output=await new OperatorClient(config,memoryStore(),transport).execute(request);
    expect(output.confirmationUrl).toMatch(/^http:\/\/127.0.0.1:3100\/operator\/confirmations\//);
    expect(output.requestId).toBe(request.requestId);
    expect(transport).toHaveBeenCalledTimes(3);
    const body=JSON.parse(transport.mock.calls[2][1].body);
    expect(body.request.requestId).toBe(request.requestId);
    expect(body.request.connectorVersion).toBe(VERSION);
    for(const call of transport.mock.calls) expect(call[1].redirect).toBe('error');
  });
  it('never retries a write when the outcome is unknown',async()=>{
    const transport=vi.fn().mockResolvedValueOnce(reply(manifest)).mockResolvedValueOnce(reply({previewProof:'proof'})).mockRejectedValueOnce(new Error('token SECRET'));
    await expect(new OperatorClient(config,memoryStore(),transport).execute(request)).rejects.toThrow('outcome_unknown_keep_original_request_id');
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it('refreshes expired credentials and persists rotated tokens',async()=>{
    const store=memoryStore();await store.save({...session(),expiresAt:0});
    const transport=vi.fn().mockResolvedValueOnce(reply({access_token:'new-access',refresh_token:'new-refresh',user:{id:'owner'},expires_in:3600})).mockResolvedValueOnce(reply(manifest));
    await new OperatorClient(config,store,transport).capabilities();
    expect((await store.load())?.refreshToken).toBe('new-refresh');
    expect(transport.mock.calls[1][1].headers.Authorization).toBe('Bearer new-access');
  });
  it('rejects changed identity or unavailable actions before preparing money',async()=>{
    for(const data of [{...manifest,identity:{userId:'other'}},{...manifest,actions:[]}]){
      const transport=vi.fn().mockResolvedValue(reply(data));
      await expect(new OperatorClient(config,memoryStore(),transport).execute(request)).rejects.toThrow();
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });
  it('clears local credentials even if remote logout fails',async()=>{
    const store=memoryStore(); const transport=vi.fn().mockRejectedValue(new Error('offline'));
    await expect(new OperatorClient(config,store,transport).logout()).rejects.toThrow();
    expect(await store.load()).toBeNull();
  });
});
