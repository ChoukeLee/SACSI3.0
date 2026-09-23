export const VERSION = '0.5.0';
export const PROTOCOL = '1.0';
export function validateConfig(value) {
  if (value?.formatVersion !== 1) throw new Error('invalid_configuration');
  const app = new URL(value.appUrl), auth = new URL(value.supabaseUrl);
  for (const url of [app,auth]) {
    const local = value.localTest === true && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('unsafe_server_url');
  }
  if (value.localTest === true && (app.origin !== 'http://127.0.0.1:3100' || auth.origin !== 'http://127.0.0.1:54321')) throw new Error('invalid_local_configuration');
  const key = value.publishableKey;
  let publicKey = typeof key === 'string' && /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  try { publicKey ||= JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; } catch {}
  if (!publicKey) throw new Error('public_key_required_never_service_role');
  return { ...value, appUrl:app.origin, supabaseUrl:auth.origin };
}
export function checkManifest(manifest) {
  if (manifest?.protocolVersion !== PROTOCOL || !/^\d+\.\d+\.\d+$/.test(manifest.minimumConnectorVersion)) throw new Error('connector_upgrade_required');
  const actual = VERSION.split('.').map(Number), minimum = manifest.minimumConnectorVersion.split('.').map(Number);
  for (let i=0;i<3;i++) { if (actual[i] > minimum[i]) break; if (actual[i] < minimum[i]) throw new Error('connector_upgrade_required'); }
  if (!manifest.identity?.userId || !Array.isArray(manifest.actions)) throw new Error('invalid_capabilities');
  const s = manifest.safeguards;
  if (!s || s.serviceRoleAllowed !== false || s.arbitrarySqlAllowed !== false || s.systemChangesAllowed !== false || s.screenshotWritesRequireConfirmation !== true) throw new Error('unsafe_server_capabilities');
  return manifest;
}
export class OperatorClient {
  constructor(config, store, transport = fetch) { this.config=validateConfig(config); this.store=store; this.fetch=transport; }
  async json(url, init={}) {
    let response;
    try { response=await this.fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(30000)}); }
    catch { throw new Error(init.method === 'POST' ? 'outcome_unknown_keep_original_request_id' : 'server_unreachable'); }
    let data; try { data=await response.json(); } catch { throw new Error('invalid_server_response'); }
    if (!response.ok) {
      const code = typeof data.code === 'string' && /^[a-zA-Z0-9_]{1,80}$/.test(data.code) ? data.code : `http_${response.status}`;
      throw new Error(code);
    }
    return data;
  }
  async auth(path, body, token) {
    return this.json(`${this.config.supabaseUrl}/auth/v1/${path}`,{method:'POST',headers:{'Content-Type':'application/json',apikey:this.config.publishableKey,...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  }
  async saveSession(session) {
    if (!session?.access_token || !session.refresh_token || !session.user?.id || !Number.isFinite(session.expires_in)) throw new Error('invalid_auth_session');
    await this.store.save({ accessToken:session.access_token, refreshToken:session.refresh_token, userId:session.user.id,
      expiresAt:Date.now()+session.expires_in*1000, appUrl:this.config.appUrl, supabaseUrl:this.config.supabaseUrl });
  }
  async login(email,password) {
    await this.saveSession(await this.auth('token?grant_type=password',{email,password}));
    try { return await this.capabilities(); } catch(error) { await this.store.remove(); throw error; }
  }
  async token() {
    let session=await this.store.load();
    if (!session || session.appUrl!==this.config.appUrl || session.supabaseUrl!==this.config.supabaseUrl) throw new Error('login_required');
    if (session.expiresAt < Date.now()+60000) {
      const next=await this.auth('token?grant_type=refresh_token',{refresh_token:session.refreshToken});
      if (next.user?.id!==session.userId) throw new Error('session_identity_changed');
      await this.saveSession(next); session=await this.store.load();
    }
    return session.accessToken;
  }
  async api(path, body) {
    const token=await this.token();
    return this.json(`${this.config.appUrl}/api/operator/v1/${path}`,{
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      ...(body ? {method:'POST',body:JSON.stringify(body)} : {}) });
  }
  async capabilities() {
    const manifest=checkManifest(await this.api('capabilities'));
    if(manifest.identity.userId!==(await this.store.load())?.userId) throw new Error('session_identity_changed');
    return manifest;
  }
  async dailyWorkflow(operation, body) {
    if (!['search','plan','prepare','status'].includes(operation)) throw new Error('connector_action_not_supported');
    const manifest = await this.capabilities();
    if (manifest.dailyWorkflow?.version !== 1 || manifest.dailyWorkflow?.readOnlyPlanning !== true) throw new Error('daily_workflow_upgrade_required');
    if (['prepare','status'].includes(operation) && manifest.dailyWorkflow.executionAvailable !== true) throw new Error('daily_workflow_upgrade_required');
    if (operation === 'status') return this.api(`bookings/status?requestId=${encodeURIComponent(body.requestId)}`);
    if (operation !== 'prepare') return this.api(`bookings/${operation}`,body);
    const {replacesConfirmationId,...request}=body;
    const preview=await this.api('bookings/prepare',request);
    const draft=await this.api('bookings/drafts',{request,previewProof:preview.previewProof,...(replacesConfirmationId?{replacesConfirmationId}:{})});
    if (!/^\/operator\/daily-workflows\/[0-9a-f-]{36}$/.test(draft.confirmationPath??'')) throw new Error('invalid_confirmation_link');
    return {status:draft.status,requestId:request.requestId,preview:preview.preview,confirmationUrl:this.config.appUrl+draft.confirmationPath,notice:'仅创建确认单，未执行业务。请本人核对完整影响并在网页确认；未知结果按原号查询，禁止拆成单独写操作。'};
  }
  async bookingOperation(operation, body) {
    if(!['options','preview','prepare','status'].includes(operation))throw new Error('connector_action_not_supported');
    const manifest=await this.capabilities();
    if(manifest.bookingOperations?.available!==true||manifest.bookingOperations.version!==1)throw new Error('booking_operations_upgrade_required');
    if(operation==='status')return this.api(`booking-operations/status?requestId=${encodeURIComponent(body.requestId)}`);
    if(operation!=='prepare')return this.api(`booking-operations/${operation}`,body);
    const {replacesConfirmationId,...request}=body;
    const preview=await this.api('booking-operations/prepare',request);
    const draft=await this.api('booking-operations/drafts',{request,previewProof:preview.previewProof,...(replacesConfirmationId?{replacesConfirmationId}:{})});
    if(!/^\/operator\/booking-operations\/[0-9a-f-]{36}$/.test(draft.confirmationPath??''))throw new Error('invalid_confirmation_link');
    return {status:draft.status,requestId:request.requestId,preview:preview.preview,confirmationUrl:this.config.appUrl+draft.confirmationPath,notice:'仅准备确认单，未执行业务。请本人核对影响后确认。实际退款不是冲正；超时按原请求号查回，不换号重录。'};
  }
  async collection(operation, body) {
    const manifest = await this.capabilities();
    if (manifest.collectionWorkflow?.available !== true || manifest.collectionWorkflow.version !== 1) throw new Error('collection_upgrade_required');
    if (operation === 'status') return this.api(`collections/status?requestId=${encodeURIComponent(body.requestId)}`);
    if (operation === 'query') return this.api('collections/query', body);
    if (operation !== 'prepare') throw new Error('connector_action_not_supported');
    const { replacesConfirmationId, ...request } = body;
    const payload = { ...request, protocolVersion: PROTOCOL, connectorVersion: VERSION };
    const preview = await this.api('collections/prepare', payload);
    const draft = await this.api('collections/drafts', { request: payload, previewProof: preview.previewProof,
      ...(replacesConfirmationId ? { replacesConfirmationId } : {}) });
    if (!/^\/operator\/collections\/[0-9a-f-]{36}$/.test(draft.confirmationPath ?? '')) throw new Error('invalid_confirmation_link');
    return { status: draft.status, requestId: request.requestId, preview: preview.preview,
      confirmationUrl: this.config.appUrl + draft.confirmationPath,
      notice: '请本人逐行核对分账后在网页确认。此工具没有执行收款；结果未知时保留原请求号。' };
  }
  async execute(request) {
    if (!request || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.requestId ?? '')) throw new Error('stable_request_uuid_required');
    if (request.scope!=='business_data' || request.exceptionalBusinessCase!==false) throw new Error('unsupported_scope');
    const manifest=await this.capabilities();
    const action=manifest.actions.find(a=>a.name===request.actionName);
    if (!action?.authorized || action.availability!=='implemented') throw new Error('action_not_available');
    const payload={...request,protocolVersion:PROTOCOL,connectorVersion:VERSION};
    // Small explicit delivery surface; no generic RPC/SQL and no approval endpoint.
    if (action.name==='query_daily_booking' && action.write===false) return this.api('actions',payload);
    if (action.name!=='record_daily_payment' || request.inputSource!=='excel_screenshot') throw new Error('connector_action_not_supported');
    const preview=await this.api('confirmations/prepare',payload);
    const draft=await this.api('confirmations/drafts',{request:payload,previewProof:preview.previewProof,
      ...(request.replacesConfirmationId ? {replacesConfirmationId:request.replacesConfirmationId} : {})});
    if (!/^\/operator\/confirmations\/[0-9a-f-]{36}$/.test(draft.confirmationPath ?? '')) throw new Error('invalid_confirmation_link');
    return {status:draft.status,requestId:request.requestId,preview:preview.preview,
      confirmationUrl:this.config.appUrl+draft.confirmationPath,notice:'请本人打开链接核对。此结果仅为待确认，不代表收款成功。'};
  }
  async logout() {
    try {
      const token=await this.token();
      // Auth logout returns an empty response, unlike other endpoints.
      const response=await this.fetch(`${this.config.supabaseUrl}/auth/v1/logout?scope=local`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{apikey:this.config.publishableKey,Authorization:`Bearer ${token}`}});
      if (!response.ok) throw new Error('remote_logout_not_confirmed');
    } finally { await this.store.remove(); }
    return {status:'signed_out'};
  }
}
