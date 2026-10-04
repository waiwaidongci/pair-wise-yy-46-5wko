import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http'
import { delay, of, throwError } from 'rxjs'
import { seedClaims } from './seed'
import type { ClaimCase } from './models'

let claims: ClaimCase[] = structuredClone(seedClaims)

// 操作号幂等表：op -> 已落账的响应。写入失败后按原操作号重试，直接返回已落账结果，不重复记账。
const opLog = new Map<string, { status: number; body: unknown }>()

const auditSeq = { n: 0 }
const nextAuditId = () => `A-${Date.now().toString(36)}-${(auditSeq.n++).toString(36)}`

// 报价版本依据：各科目最新报价版本的拼接，作为会签依据的一部分
const quoteDigest = (claim: ClaimCase) =>
  claim.lossItems.map((item) => `${item.id}:v${item.repairQuotes.at(-1)?.version ?? 0}`).join('|')

// 准备金由最新报价重算：Σ(最新报价 - 残值) × 责任比例 - 免赔
const recomputeReserve = (claim: ClaimCase) => {
  const gross = claim.lossItems.reduce((sum, item) => {
    const latest = item.repairQuotes.at(-1)?.amount ?? 0
    return sum + Math.max(0, latest - item.salvage) * item.liability
  }, 0)
  return Math.max(0, Math.round(gross - claim.deductible))
}

const currentUser = '当前用户'

type Invalidated = { role: string; threshold: number; reason: string }

// 报价版本并入后，把会签依据与当前准备金不一致的已通过级次失效退回待处理，并写清失效原因
const reconcileApprovals = (claim: ClaimCase, prevReserve: number, prevDigest: string): Invalidated[] => {
  const newReserve = claim.reserve
  const newDigest = quoteDigest(claim)
  const invalidated: Invalidated[] = []
  for (const step of claim.approvals) {
    if (step.status !== '已通过') continue
    const basisChanged = step.basisReserve !== undefined && step.basisReserve !== newReserve
    const levelExceeded = newReserve < step.threshold
    if (!basisChanged && !levelExceeded) continue
    const reason = levelExceeded
      ? `准备金由 ${prevReserve.toLocaleString()} 元降至 ${newReserve.toLocaleString()} 元，已低于 ${step.threshold.toLocaleString()} 元触发阈值，该会签级次不再触发，依据失效退回待处理。`
      : `会签基于旧准备金 ${(step.basisReserve ?? prevReserve).toLocaleString()} 元（报价版本 ${step.basisQuoteVersion ?? prevDigest}），报价修订并入后准备金为 ${newReserve.toLocaleString()} 元（报价版本 ${newDigest}），审批依据已失效，退回待处理重新会签。`
    invalidated.push({ role: step.role, threshold: step.threshold, reason })
    // 失效退回：清空已通过痕迹，回到待处理
    step.status = '待处理'
    step.operator = undefined
    step.comment = undefined
    step.completedAt = undefined
    step.basisReserve = undefined
    step.basisQuoteVersion = undefined
    claim.audit.push({
      id: nextAuditId(),
      at: '刚刚',
      operator: '系统',
      action: '会签失效',
      detail: `${step.role}（阈值 ${step.threshold.toLocaleString()} 元）：${reason}`,
    })
  }
  if (invalidated.length) claim.status = '待复核'
  return invalidated
}

export const mockApiInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/')) return next(request)

  if (request.method === 'GET' && request.url === '/api/claims') {
    const query = request.params.get('query')?.toLowerCase() ?? ''
    const status = request.params.get('status') ?? ''
    const risk = request.params.get('risk') ?? ''
    const page = Number(request.params.get('page') ?? 1)
    const pageSize = Number(request.params.get('pageSize') ?? 10)
    const filtered = claims.filter(
      (item) =>
        (!query || `${item.id}${item.insured}${item.policyNo}`.toLowerCase().includes(query)) &&
        (!status || item.status === status) &&
        (!risk || item.riskLevel === risk),
    )
    const start = (page - 1) * pageSize
    return of(new HttpResponse({ status: 200, body: { items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize } })).pipe(delay(220))
  }

  if (request.method === 'GET' && request.url.startsWith('/api/claims/')) {
    const id = request.url.split('/').pop()
    const item = claims.find((claim) => claim.id === id)
    return item ? of(new HttpResponse({ status: 200, body: item })).pipe(delay(120)) : throwError(() => new HttpErrorResponse({ status: 404 }))
  }

  if (request.method === 'POST' && request.url.endsWith('/quotes')) {
    const id = request.url.split('/').at(-2)
    const body = request.body as { itemId: string; amount: number; reason: string; op?: string }
    const op = body.op
    // 幂等：同一操作号已落账，直接返回已落账结果，重试不重复记账
    if (op && opLog.has(op)) {
      const recorded = opLog.get(op)!
      return of(new HttpResponse({ status: recorded.status, body: recorded.body })).pipe(delay(180))
    }
    const claim = claims.find((c) => c.id === id)
    const item = claim?.lossItems.find((loss) => loss.id === body.itemId)
    if (!claim || !item) return throwError(() => new HttpErrorResponse({ status: 404 }))

    const prevReserve = claim.reserve
    const prevDigest = quoteDigest(claim)
    const prevVersion = item.repairQuotes.at(-1)?.version ?? 0
    item.repairQuotes.push({
      version: prevVersion + 1,
      amount: body.amount,
      reason: body.reason,
      operator: currentUser,
      createdAt: new Date().toLocaleString('zh-CN'),
    })
    // 同一份依据：报价版本一变，准备金立刻重算
    const newReserve = recomputeReserve(claim)
    claim.reserve = newReserve
    claim.version = (claim.version ?? 1) + 1
    const invalidated = reconcileApprovals(claim, prevReserve, prevDigest)
    claim.audit.push({
      id: nextAuditId(),
      at: '刚刚',
      operator: currentUser,
      action: '报价修订并入',
      detail: `损失科目「${item.category}」生成报价 V${prevVersion + 1}（${body.amount.toLocaleString()} 元）；准备金由 ${prevReserve.toLocaleString()} 元重算为 ${newReserve.toLocaleString()} 元，报价版本 ${quoteDigest(claim)}。` +
        (invalidated.length ? `其中 ${invalidated.map((i) => i.role).join('、')} 会签级次跨过阈值或依据变更，已失效退回待处理，失效原因见审计。` : '现有会签依据仍有效。'),
    })

    const recorded = { status: 201, body: claim }
    if (op) opLog.set(op, recorded)
    // 演示：首次写入响应丢失（已落账），客户端按原 op 重试时走幂等返回
    if (request.headers.get('x-demo-fail') === '1' && op) {
      return of(new HttpResponse({ status: 500, body: { error: '写入响应丢失（演示）', op } })).pipe(delay(180))
    }
    return of(new HttpResponse({ status: 201, body: claim })).pipe(delay(180))
  }

  if (request.method === 'POST' && request.url.endsWith('/approvals')) {
    const id = request.url.split('/').at(-2)
    const body = request.body as { role: string; result: string; comment: string; op?: string; operator?: string }
    const op = body.op
    // 幂等：同一操作号已落账，直接返回已落账结果，重试不重复记账
    if (op && opLog.has(op)) {
      const recorded = opLog.get(op)!
      return of(new HttpResponse({ status: recorded.status, body: recorded.body })).pipe(delay(180))
    }
    const claim = claims.find((c) => c.id === id)
    const step = claim?.approvals.find((approval) => approval.role === body.role)
    if (!claim || !step) return throwError(() => new HttpErrorResponse({ status: 404 }))

    // 并发会签：先到者成立，后到者只留冲突，不覆盖先到决定
    if (step.status !== '待处理') {
      claim.version = (claim.version ?? 1) + 1
      claim.audit.push({
        id: nextAuditId(),
        at: '刚刚',
        operator: currentUser,
        action: '会签冲突',
        detail: `「${step.role}」步骤已由 ${step.operator} 于 ${step.completedAt} 处理（${step.status}）；后到提交（操作号 ${op ?? '无'}，结果「${body.result}」）未生效，仅登记冲突，不重复记账。`,
      })
      const recorded = { status: 409, body: { conflict: true, claim } }
      if (op) opLog.set(op, recorded)
      return of(new HttpResponse({ status: 409, body: { conflict: true, claim, message: '该会签步骤已被他人先处理，后到提交仅记录冲突' } })).pipe(delay(180))
    }

    step.status = body.result === '已通过' ? '已通过' : '已退回'
    step.operator = body.operator ?? currentUser
    step.comment = body.comment
    step.completedAt = new Date().toLocaleString('zh-CN')
    // 会签依据：通过时锁定当前准备金与报价版本
    step.basisReserve = claim.reserve
    step.basisQuoteVersion = quoteDigest(claim)
    claim.version = (claim.version ?? 1) + 1
    claim.audit.push({
      id: nextAuditId(),
      at: '刚刚',
      operator: body.operator ?? currentUser,
      action: `会签${step.status}`,
      detail: body.comment,
    })
    claim.status = body.result === '已通过' ? '审批中' : '退回补件'

    const recorded = { status: 200, body: claim }
    if (op) opLog.set(op, recorded)
    // 演示：首次写入响应丢失（已落账），客户端按原 op 重试时走幂等返回
    if (request.headers.get('x-demo-fail') === '1' && op) {
      return of(new HttpResponse({ status: 500, body: { error: '写入响应丢失（演示）', op } })).pipe(delay(180))
    }
    return of(new HttpResponse({ status: 200, body: claim })).pipe(delay(180))
  }

  return next(request)
}
