import { isDeepStrictEqual } from 'node:util';
import { normalizeCimacMaintenanceRequest, verifyCimacMaintenanceResult } from './cimac-maintenance.mjs';
export const VERSION = '0.8.0';
export const PROTOCOL = '1.0';
// Native v1 databases require this exact wire stamp even on a newer connector.
const NATIVE_WIRE_VERSION = '0.7.0';
const DIRECT_WORKFLOWS = new Set(['daily_payment','collection','daily_workflow','booking_operation','native_collection','cimac_maintenance']);
const nativeUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const nativeKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key=>keys.includes(key));
const nativeText = (value, limit) => typeof value === 'string' && !!value.trim() && value.length <= limit;
const nativeDate = value => typeof value === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
function nativeMinor(value,allowZero=false) {
  if(typeof value!=='string' || !/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/.test(value)) throw new Error('invalid_native_collection_amount');
  const [whole,fraction='']=value.split('.'), minor=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if((!allowZero && minor===0n) || minor>99999999999999n)throw new Error('invalid_native_collection_amount');
  return minor;
}
const nativeCanonical = (value,allowZero=false) => {const minor=nativeMinor(value,allowZero);return `${minor/100n}.${String(minor%100n).padStart(2,'0')}`;};
function validateNativeRequest(request) {
  stableRequest(request);
  if(!nativeKeys(request,['requestId','originalInstruction','inputSource','contractId','currency','amount','paymentDate','paymentMethod','allocations','externalReceiptNo','actualCollector','collectorBasis','notes','coverage'])
    || !nativeUuid(request.contractId) || !['USD','CNY'].includes(request.currency)
    || !['natural_language','excel_screenshot'].includes(request.inputSource??'natural_language')
    || !nativeDate(request.paymentDate) || !['cash','check','bank_transfer','other'].includes(request.paymentMethod)
    || !Array.isArray(request.allocations) || request.allocations.length<1 || request.allocations.length>100)throw new Error('invalid_native_collection_request');
  const total=nativeMinor(request.amount), seen=new Set();let sum=0n;
  for(const allocation of request.allocations){
    if(!nativeKeys(allocation,['receivableId','amount']) || !nativeUuid(allocation.receivableId) || seen.has(allocation.receivableId.toLowerCase()))throw new Error('invalid_native_collection_allocations');
    seen.add(allocation.receivableId.toLowerCase());sum+=nativeMinor(allocation.amount);
  }
  if(sum!==total)throw new Error('native_collection_allocation_mismatch');
  for(const [field,limit] of [['externalReceiptNo',200],['actualCollector',100],['collectorBasis',1000],['notes',2000]]){
    if(request[field]!==undefined && !nativeText(request[field],limit))throw new Error('invalid_native_collection_request');
  }
  if((request.actualCollector!==undefined)!==(request.collectorBasis!==undefined))throw new Error('native_collection_collector_basis_required');
  if(request.coverage!==undefined){
    const coverage=request.coverage;
    if(!nativeKeys(coverage,['expectedPaidThroughDate','expectedContractUpdatedAt','throughDate','receivableIds'])
      || !nativeDate(coverage.expectedPaidThroughDate) || !nativeDate(coverage.throughDate) || coverage.throughDate<=coverage.expectedPaidThroughDate
      || !nativeText(coverage.expectedContractUpdatedAt,80) || !/^\d{4}-\d{2}-\d{2}T/.test(coverage.expectedContractUpdatedAt) || !Number.isFinite(Date.parse(coverage.expectedContractUpdatedAt))
      || !Array.isArray(coverage.receivableIds) || coverage.receivableIds.length<1 || coverage.receivableIds.length>100
      || coverage.receivableIds.some(id=>!nativeUuid(id))
      || new Set(coverage.receivableIds.map(id=>id.toLowerCase())).size!==coverage.receivableIds.length)throw new Error('invalid_native_collection_coverage');
  }
}
export function normalizeNativeCollectionRequest(request) {
  validateNativeRequest(request);
  const normalized={...request,requestId:request.requestId.toLowerCase(),contractId:request.contractId.toLowerCase(),
    originalInstruction:request.originalInstruction.trim(),inputSource:request.inputSource??'natural_language',amount:nativeCanonical(request.amount),
    allocations:request.allocations.map(item=>({...item,receivableId:item.receivableId.toLowerCase(),amount:nativeCanonical(item.amount)}))};
  for(const field of ['externalReceiptNo','actualCollector','collectorBasis','notes'])if(normalized[field]!==undefined)normalized[field]=normalized[field].trim();
  if(request.coverage)normalized.coverage={...request.coverage,receivableIds:request.coverage.receivableIds.map(id=>id.toLowerCase())};
  return normalized;
}
function verifyNativeResult(result,request,actorId) {
  try{
    if(result?.status!=='completed' || result.verified!==true || result.requestId!==request.requestId
      || result.currency!==request.currency || result.contractId!==request.contractId
      || result.amount!==nativeCanonical(request.amount) || result.executionMode!=='explicit_instruction'
      || !result.verification || typeof result.verification!=='object' || Array.isArray(result.verification)
      || !Array.isArray(result.paymentIds) || result.paymentIds.length<1 || result.paymentIds.length>request.allocations.length
      || result.paymentIds.some(id=>!nativeUuid(id)) || new Set(result.paymentIds.map(id=>id.toLowerCase())).size!==result.paymentIds.length
      || !Array.isArray(result.allocations) || result.allocations.length!==request.allocations.length)throw new Error();
    const expected=new Map(request.allocations.map(item=>[item.receivableId.toLowerCase(),nativeCanonical(item.amount)])),seen=new Set(),payments=new Set();
    for(const allocation of result.allocations){
      if(!nativeUuid(allocation.receivableId) || !nativeUuid(allocation.paymentId) || seen.has(allocation.receivableId.toLowerCase())
        || allocation.amount!==expected.get(allocation.receivableId.toLowerCase())
        || !result.paymentIds.some(id=>id.toLowerCase()===allocation.paymentId.toLowerCase()))throw new Error();
      seen.add(allocation.receivableId.toLowerCase());payments.add(allocation.paymentId.toLowerCase());
    }
    if(payments.size!==result.paymentIds.length)throw new Error();
    const proof=result.verification;
    if(proof.version!==1 || proof.actorId!==actorId || !nativeKeys(proof.checks,['payments','ledger','allocations','receivables','audit','xofUnchanged'])
      || !['payments','ledger','allocations','receivables','audit','xofUnchanged'].every(key=>proof.checks[key]===true))throw new Error();
    const evidenceMap=(rows,key)=>{
      if(!Array.isArray(rows) || rows.length<1 || rows.length>100)throw new Error();
      const map=new Map();
      for(const row of rows){if(!row || !nativeUuid(row[key]) || map.has(row[key]))throw new Error();map.set(row[key],row);}
      return map;
    };
    const nativePayments=evidenceMap(proof.payments,'id'),ledger=evidenceMap(proof.ledger,'paymentId'),balances=evidenceMap(proof.receivables,'id');
    if(nativePayments.size!==result.paymentIds.length || ledger.size!==result.paymentIds.length || balances.size!==request.allocations.length)throw new Error();
    let paid=0n;
    for(const paymentId of result.paymentIds){
      const payment=nativePayments.get(paymentId),entry=ledger.get(paymentId);
      if(!payment || !entry || payment.currency!==request.currency || payment.nativeSettlement!==true || payment.exchangeRateToXof!==null
        || payment.recordedBy!==actorId || payment.amount!==nativeCanonical(payment.amount)
        || entry.currency!==request.currency || entry.amount!==payment.amount || entry.amountXof!=='0.00')throw new Error();
      paid+=nativeMinor(payment.amount);
    }
    if(paid!==nativeMinor(request.amount))throw new Error();
    const proofAllocations=evidenceMap(proof.allocations,'receivableId'),referencedPayments=new Set();
    if(proofAllocations.size!==request.allocations.length)throw new Error();
    for(const expectedAllocation of request.allocations){
      const actual=proofAllocations.get(expectedAllocation.receivableId),balance=balances.get(expectedAllocation.receivableId);
      if(!actual || actual.amount!==expectedAllocation.amount || !result.paymentIds.includes(actual.paymentId)
        || !balance || balance.currency!==request.currency || balance.amountXof!=='0.00' || balance.paidAmountXof!=='0.00'
        || balance.amount!==nativeCanonical(balance.amount) || balance.paidBefore!==nativeCanonical(balance.paidBefore,true)
        || balance.paidAfter!==nativeCanonical(balance.paidAfter,true)
        || nativeMinor(balance.paidAfter,true)-nativeMinor(balance.paidBefore,true)!==nativeMinor(expectedAllocation.amount)
        || nativeMinor(balance.paidAfter,true)>nativeMinor(balance.amount))throw new Error();
      referencedPayments.add(actual.paymentId);
      if(result.allocations.find(item=>item.receivableId===expectedAllocation.receivableId)?.paymentId!==actual.paymentId)throw new Error();
    }
    if(referencedPayments.size!==result.paymentIds.length || !proof.audit || !nativeUuid(proof.audit.id)
      || proof.audit.actorId!==actorId || proof.audit.requestId!==request.requestId || proof.audit.channel!=='external_codex'
      || proof.audit.authorization!=='explicit_instruction')throw new Error();
    if(![result.paidThroughBefore,result.paidThroughAfter].every(value=>value===null || nativeDate(value)))throw new Error();
    if(request.coverage ? result.paidThroughBefore!==request.coverage.expectedPaidThroughDate || result.paidThroughAfter!==request.coverage.throughDate : result.paidThroughBefore!==result.paidThroughAfter)throw new Error();
  }catch{throw new Error('execution_verification_failed_keep_original_request_id');}
}
const stableRequest = request => {
  if (!request || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.requestId ?? '')) throw new Error('stable_request_uuid_required');
  if (typeof request.originalInstruction !== 'string' || !request.originalInstruction.trim() || request.originalInstruction.length > 4000) throw new Error('explicit_instruction_required');
};
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
  const direct = manifest.directExecution;
  if (direct !== undefined && (!direct || typeof direct.available !== 'boolean' || direct.version !== 1
    || direct.authorization !== 'explicit_instruction' || !Array.isArray(direct.workflows)
    || direct.workflows.some(workflow => !DIRECT_WORKFLOWS.has(workflow))
    || new Set(direct.workflows).size !== direct.workflows.length
    || (direct.available && direct.workflows.length === 0))) throw new Error('unsafe_direct_execution_capabilities');
  const confirmationRequired = direct?.available !== true;
  if (!s || s.serviceRoleAllowed !== false || s.arbitrarySqlAllowed !== false || s.systemChangesAllowed !== false
    || s.screenshotWritesRequireConfirmation !== confirmationRequired
    || (direct?.available === true ? s.batchWritesRequireConfirmation !== false
      : s.batchWritesRequireConfirmation !== undefined && s.batchWritesRequireConfirmation !== true)) throw new Error('unsafe_server_capabilities');
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
  async directBusiness(manifest, workflow, family, request, replacesConfirmationId) {
    stableRequest(request);
    if (manifest.directExecution?.available !== true || !manifest.directExecution.workflows.includes(workflow)) throw new Error('direct_execution_not_available');
    const previous = await this.api(`${family}/status?requestId=${encodeURIComponent(request.requestId)}`);
    if (!previous || !['not_found','pending','completed'].includes(previous.status)
      || (previous.requestId !== undefined && previous.requestId !== request.requestId)
      || (previous.status !== 'not_found' && previous.requestId !== request.requestId)) throw new Error('request_state_requires_reconciliation');
    if (previous.status === 'completed') return {status:'completed_previously',requestId:request.requestId,verified:false,
      notice:'原请求此前已经完成，未执行当前指令，也未核对当前请求内容或当前全部账务。请查原记录，禁止换号重录。'};
    const preview = await this.api(`${family}/prepare`, request);
    if (typeof preview?.previewProof !== 'string' || !preview.previewProof) throw new Error('invalid_execution_preview');
    let result;
    try {
      result = await this.api(`${family}/execute`, {request, previewProof:preview.previewProof,
        ...(replacesConfirmationId ? {replacesConfirmationId} : {})});
    } catch (error) {
      // A broken response after the POST may hide a committed transaction.
      // Never describe it as an ordinary failed/unused request.
      if (error?.message === 'invalid_server_response') throw new Error('outcome_unknown_keep_original_request_id');
      throw error;
    }
    if (result?.requestId !== request.requestId || !['completed','completed_previously'].includes(result.status)) throw new Error('execution_result_invalid_keep_original_request_id');
    if (result.status === 'completed_previously') return {...result,verified:false,
      notice:'原请求此前已经完成，未重新执行。此历史状态不等于已复核当前全部账务，禁止换号重录。'};
    if (result.verified !== true
      || (request.totalXof !== undefined && result.totalXof !== request.totalXof)
      || (request.amountXof !== undefined && result.amountXof !== request.amountXof)) throw new Error('execution_verification_failed_keep_original_request_id');
    return {...result,notice:'已按本人明确指令执行并核验，无需打开网页再次确认。请保留原请求号；异常或重试只能沿用原号。'};
  }
  async dailyWorkflow(operation, body) {
    if (!['search','plan','prepare','execute','status'].includes(operation)) throw new Error('connector_action_not_supported');
    const manifest = await this.capabilities();
    if (manifest.dailyWorkflow?.version !== 1 || manifest.dailyWorkflow?.readOnlyPlanning !== true) throw new Error('daily_workflow_upgrade_required');
    if (['prepare','execute','status'].includes(operation) && manifest.dailyWorkflow.executionAvailable !== true) throw new Error('daily_workflow_upgrade_required');
    if (operation === 'status') return this.api(`bookings/status?requestId=${encodeURIComponent(body.requestId)}`);
    if (operation === 'execute') {
      const {replacesConfirmationId,...request}=body;
      return this.directBusiness(manifest,'daily_workflow','bookings',request,replacesConfirmationId);
    }
    if (operation !== 'prepare') return this.api(`bookings/${operation}`,body);
    const {replacesConfirmationId,...request}=body;
    const preview=await this.api('bookings/prepare',request);
    const draft=await this.api('bookings/drafts',{request,previewProof:preview.previewProof,...(replacesConfirmationId?{replacesConfirmationId}:{})});
    if (!/^\/operator\/daily-workflows\/[0-9a-f-]{36}$/.test(draft.confirmationPath??'')) throw new Error('invalid_confirmation_link');
    return {status:draft.status,requestId:request.requestId,preview:preview.preview,confirmationUrl:this.config.appUrl+draft.confirmationPath,notice:'仅创建确认单，未执行业务。请本人核对完整影响并在网页确认；未知结果按原号查询，禁止拆成单独写操作。'};
  }
  async bookingOperation(operation, body) {
    if(!['options','preview','prepare','execute','status'].includes(operation))throw new Error('connector_action_not_supported');
    const manifest=await this.capabilities();
    if(manifest.bookingOperations?.available!==true||manifest.bookingOperations.version!==1)throw new Error('booking_operations_upgrade_required');
    if(operation==='status')return this.api(`booking-operations/status?requestId=${encodeURIComponent(body.requestId)}`);
    if(operation==='execute') {
      const {replacesConfirmationId,...request}=body;
      return this.directBusiness(manifest,'booking_operation','booking-operations',request,replacesConfirmationId);
    }
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
    if (!['prepare','execute'].includes(operation)) throw new Error('connector_action_not_supported');
    const { replacesConfirmationId, ...request } = body;
    const payload = { ...request, protocolVersion: PROTOCOL, connectorVersion: VERSION };
    if(operation==='execute') return this.directBusiness(manifest,'collection','collections',payload,replacesConfirmationId);
    const preview = await this.api('collections/prepare', payload);
    const draft = await this.api('collections/drafts', { request: payload, previewProof: preview.previewProof,
      ...(replacesConfirmationId ? { replacesConfirmationId } : {}) });
    if (!/^\/operator\/collections\/[0-9a-f-]{36}$/.test(draft.confirmationPath ?? '')) throw new Error('invalid_confirmation_link');
    return { status: draft.status, requestId: request.requestId, preview: preview.preview,
      confirmationUrl: this.config.appUrl + draft.confirmationPath,
      notice: '请本人逐行核对分账后在网页确认。此工具没有执行收款；结果未知时保留原请求号。' };
  }
  async nativeCollection(operation,body) {
    if(!['query','execute','status'].includes(operation))throw new Error('connector_action_not_supported');
    if(operation==='execute')body=normalizeNativeCollectionRequest(body);
    else if(operation==='status'){
      if(!nativeKeys(body,['requestId']) || !nativeUuid(body.requestId))throw new Error('invalid_native_collection_request');
      body={requestId:body.requestId.toLowerCase()};
    }else if(!nativeKeys(body,['contractId','buildingCode','unitNo'])
      || (body.contractId!==undefined ? !nativeUuid(body.contractId) || body.buildingCode!==undefined || body.unitNo!==undefined
        : !nativeText(body.buildingCode,40) || !nativeText(body.unitNo,40)))throw new Error('native_contract_id_or_building_and_unit_required');
    if(operation==='query')body=body.contractId?{contractId:body.contractId.toLowerCase()}:{buildingCode:body.buildingCode.trim(),unitNo:body.unitNo.trim()};
    const manifest=await this.capabilities();
    if(operation!=='status' && (manifest.directExecution?.available!==true || !manifest.directExecution.workflows.includes('native_collection')))throw new Error('native_collection_not_available');
    if(operation==='query')return this.api('native-collections/query',body);
    const previous=await this.api(`native-collections/status?requestId=${encodeURIComponent(body.requestId)}`);
    if(!previous || previous.requestId!==body.requestId || !['not_found','completed_previously'].includes(previous.status)
      || (previous.status==='completed_previously' && previous.verified!==false))throw new Error('request_state_requires_reconciliation');
    if(operation==='status' || previous.status==='completed_previously')return {...previous,
      ...(previous.status==='completed_previously'?{verified:false,notice:'原请求此前已完成，未执行当前指令，也未重新核验当前全部账务。保留原请求号，禁止换号重录。'}:{})};
    const request={...body,inputSource:body.inputSource??'natural_language',protocolVersion:PROTOCOL,connectorVersion:NATIVE_WIRE_VERSION};
    const preview=await this.api('native-collections/prepare',request);
    if(preview?.status!=='ready_for_direct_execution' || typeof preview.previewProof!=='string' || !preview.previewProof)throw new Error('invalid_execution_preview');
    let result;
    try{result=await this.api('native-collections/execute',{request,previewProof:preview.previewProof});}
    catch(error){if(error?.message==='invalid_server_response')throw new Error('outcome_unknown_keep_original_request_id');throw error;}
    if(result?.status==='completed_previously'){
      if(result.requestId!==body.requestId || result.verified!==false)throw new Error('execution_result_invalid_keep_original_request_id');
      return {...result,verified:false,notice:'原请求此前已完成，未重新执行或核验当前全部账务，禁止换号重录。'};
    }
    verifyNativeResult(result,request,manifest.identity.userId);
    return {...result,notice:'已按本人明确指令执行并核验原币长租收款；未折算或并入 XOF。请保留原请求号。'};
  }
  async cimacMaintenance(operation,body) {
    if(!['query','execute','status'].includes(operation))throw new Error('connector_action_not_supported');
    if(operation==='status'){
      if(!nativeKeys(body,['requestId']) || !nativeUuid(body.requestId))throw new Error('invalid_cimac_maintenance_request');
      body={requestId:body.requestId.toLowerCase()};
    }else{
      if(operation==='execute')stableRequest(body);
      body=normalizeCimacMaintenanceRequest(body);
    }
    const manifest=await this.capabilities();
    if(manifest.identity.role!=='admin' || (operation!=='status' && (manifest.directExecution?.available!==true
      || !manifest.directExecution.workflows.includes('cimac_maintenance') || manifest.cimacMaintenanceWorkflow?.available!==true
      || manifest.cimacMaintenanceWorkflow.version!==1)))throw new Error('cimac_maintenance_not_available');
    if(operation==='query')return this.api('cimac-maintenance/query',body);
    const previous=await this.api(`cimac-maintenance/status?requestId=${encodeURIComponent(body.requestId)}`);
    if(!previous || previous.requestId!==body.requestId || !['not_found','completed_previously'].includes(previous.status)
      || (previous.status==='completed_previously' && (previous.verified!==false || previous.actorId!==manifest.identity.userId)))throw new Error('request_state_requires_reconciliation');
    if(operation==='status')return {...previous,verified:false};
    if(previous.status==='completed_previously'){
      if(!isDeepStrictEqual(previous.request,body))throw new Error('request_state_requires_reconciliation');
      return {...previous,verified:false,notice:'原请求此前完成，未重新执行或核验当前账务；保留原号，禁止换号重录。'};
    }
    const preview=await this.api('cimac-maintenance/prepare',body);
    if(preview?.status==='completed_previously'){
      if(preview.requestId!==body.requestId || preview.actorId!==manifest.identity.userId || preview.verified!==false)throw new Error('execution_result_invalid_keep_original_request_id');
      return {...preview,verified:false};
    }
    if(preview?.status!=='ready_for_direct_execution' || preview.requestId!==body.requestId
      || preview.preview?.requestId!==body.requestId || preview.preview?.operationCount!==body.operations.length
      || typeof preview.preview?.snapshot?.fingerprint!=='string' || !preview.preview.snapshot.fingerprint
      || typeof preview.preview?.snapshot?.requestHash!=='string' || !preview.preview.snapshot.requestHash
      || typeof preview.previewProof!=='string' || !preview.previewProof)throw new Error('invalid_execution_preview');
    let result;
    try{result=await this.api('cimac-maintenance/execute',{request:body,previewProof:preview.previewProof});}
    catch(error){if(error?.message==='invalid_server_response')throw new Error('outcome_unknown_keep_original_request_id');throw error;}
    if(result?.status==='completed_previously'){
      if(result.requestId!==body.requestId || result.actorId!==manifest.identity.userId || result.verified!==false)throw new Error('execution_result_invalid_keep_original_request_id');
      return {...result,verified:false};
    }
    if(result?.executionMode!=='explicit_instruction' || !verifyCimacMaintenanceResult(result,body,manifest.identity.userId))throw new Error('execution_verification_failed_keep_original_request_id');
    return {...result,notice:'已按明确指令执行并核验建材城受控维护；退款仅为登记已发生资金业务。保留原请求号。'};
  }
  async execute(request) {
    if(request?.actionName==='cimac_maintenance'){
      const {actionName,operation,scope,exceptionalBusinessCase,...body}=request;
      if(scope!=='business_data' || exceptionalBusinessCase!==false)throw new Error('unsupported_scope');
      return this.cimacMaintenance(operation,body);
    }
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
  async executePayment(request) {
    stableRequest(request);
    if (request.scope !== 'business_data' || request.exceptionalBusinessCase !== false
      || request.actionName !== 'record_daily_payment' || !['natural_language','excel_screenshot'].includes(request.inputSource)) throw new Error('unsupported_scope');
    const manifest=await this.capabilities();
    const action=manifest.actions.find(item=>item.name==='record_daily_payment');
    if (!action?.authorized || action.availability !== 'implemented' || action.write !== true) throw new Error('action_not_available');
    const {replacesConfirmationId,...input}=request;
    return this.directBusiness(manifest,'daily_payment','confirmations',{
      ...input,protocolVersion:PROTOCOL,connectorVersion:VERSION,
    },replacesConfirmationId);
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
