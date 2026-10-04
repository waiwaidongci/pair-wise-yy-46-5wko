import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http'
import { delay, of, throwError } from 'rxjs'
import { applyQuoteRevision, formatAmount, isRequiredApproval } from './claim-basis'
import { seedClaims } from './seed'
import type {
  ApprovalConflict,
  ApprovalDecisionRequest,
  ApprovalStep,
  AuditEntry,
  ClaimCase,
  QuoteRevisionRequest,
} from './models'

let claims = structuredClone(seedClaims)
const processedOperations = new Map<string, { operationId: string; claimId: string; kind: 'quote' | 'approval' }>()
let conflictSequence = 0

function json<T>(body: T, status = 200) {
  return of(new HttpResponse({ status, body })).pipe(delay(120))
}

function failure(status: number, message: string, currentClaim?: ClaimCase) {
  return throwError(() =>
    new HttpErrorResponse({
      status,
      error: {
        message,
        claim: currentClaim ? structuredClone(currentClaim) : undefined,
      },
    }),
  )
}

function findClaim(id: string | undefined) {
  return claims.find((claim) => claim.id === id)
}

function nowText() {
  return new Date().toLocaleString('zh-CN')
}

function nextConflictId() {
  conflictSequence += 1
  return `CFL-${String(conflictSequence).padStart(3, '0')}`
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
    return json({ items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize })
  }

  if (request.method === 'GET' && request.url.startsWith('/api/claims/')) {
    const id = request.url.split('/').pop()
    const item = findClaim(id)
    return item ? json(structuredClone(item)) : failure(404, '案件不存在')
  }

  if (request.method === 'POST' && request.url.endsWith('/quotes')) {
    const claimId = request.url.split('/').at(-2)
    const claim = findClaim(claimId)
    const body = request.body as QuoteRevisionRequest
    if (!claim) return failure(404, '案件不存在')

    const previous = processedOperations.get(body.operationId)
    if (previous && previous.claimId === claim.id && previous.kind === 'quote') {
      return json(structuredClone(claim))
    }

    if (claim.basis.version !== body.basisVersion) {
      return failure(409, `依据版本已变化，请刷新到 V${claim.basis.version} 后再提交。`, claim)
    }
    const item = claim.lossItems.find((loss) => loss.id === body.itemId)
    if (!item) return failure(404, '损失科目不存在', claim)
    if (!Number.isFinite(body.amount) || body.amount <= 0) return failure(400, '报价金额必须大于 0', claim)
    if (!body.reason?.trim()) return failure(400, '调整理由必填', claim)

    applyQuoteRevision(claim, item, body.amount, body.reason.trim(), body.operationId)
    processedOperations.set(body.operationId, { operationId: body.operationId, claimId: claim.id, kind: 'quote' })
    return json(structuredClone(claim), 201)
  }

  if (request.method === 'POST' && request.url.endsWith('/approvals')) {
    const claimId = request.url.split('/').at(-2)
    const claim = findClaim(claimId)
    const body = request.body as ApprovalDecisionRequest
    if (!claim) return failure(404, '案件不存在')

    const previous = processedOperations.get(body.operationId)
    if (previous && previous.claimId === claim.id && previous.kind === 'approval') {
      return json(structuredClone(claim))
    }

    const step = claim.approvals.find((approval) => approval.role === body.role)
    if (!step) return failure(404, '会签步骤不存在', claim)

    if (claim.basis.version !== body.basisVersion) {
      addConflict(claim, step, body.operationId, `后到提交基于 V${body.basisVersion}，当前依据已是 V${claim.basis.version}，仅记录冲突，不重复记账。`)
      return failure(409, `会签依据已更新到 V${claim.basis.version}，请刷新后处理。`, claim)
    }
    if (!isRequiredApproval(step, claim.reserve)) {
      addConflict(claim, step, body.operationId, `当前准备金 ${formatAmount(claim.reserve)} 元未跨过 ${formatAmount(step.threshold)} 元阈值，该级次不得处理。`)
      return failure(409, '当前准备金未触发该会签级次。', claim)
    }
    if (step.status !== '待处理') {
      addConflict(claim, step, body.operationId, `同一步会签已由 ${step.operator ?? '先到处理人'} 于 ${step.completedAt ?? nowText()} 完成「${step.status}」，后到提交仅保留冲突。`)
      return failure(409, '该会签步骤已被先到请求处理。', claim)
    }
    if (hasBlockingEarlierStep(claim, step)) {
      addConflict(claim, step, body.operationId, '前置会签尚未通过，不能越级处理。')
      return failure(409, '请先完成前置会签。', claim)
    }

    const at = nowText()
    const passed = body.result === '已通过'
    step.status = passed ? '已通过' : '已退回'
    step.operator = '当前用户'
    step.comment = body.comment
    step.completedAt = at
    step.basisVersion = claim.basis.version
    step.invalidReason = undefined
    step.invalidAt = undefined

    claim.status = passed ? '审批中' : '退回补件'
    const audit: AuditEntry = {
      id: `A-${String(claim.audit.length + 1).padStart(2, '0')}`,
      at,
      operator: step.operator,
      action: passed ? '会签通过' : '会签退回补件',
      detail: `${step.role}按依据 V${claim.basis.version}（准备金 ${formatAmount(claim.reserve)} 元）${passed ? '通过' : '退回'}；意见：${body.comment}。`,
      operationId: body.operationId,
    }
    claim.audit.push(audit)
    processedOperations.set(body.operationId, { operationId: body.operationId, claimId: claim.id, kind: 'approval' })
    return json(structuredClone(claim))
  }

  return next(request)
}

function hasBlockingEarlierStep(claim: ClaimCase, target: ApprovalStep): boolean {
  return claim.approvals.some((step) => {
    if (step.id === target.id || !isRequiredApproval(step, claim.reserve) || step.threshold === 0) return false
    return step.threshold < target.threshold && step.status !== '已通过'
  })
}

function addConflict(claim: ClaimCase, step: ApprovalStep, operationId: string, detail: string): void {
  const conflict: ApprovalConflict = {
    id: nextConflictId(),
    at: nowText(),
    operator: '当前用户',
    operationId,
    detail,
  }
  step.conflicts.push(conflict)
  claim.audit.push({
    id: `A-${String(claim.audit.length + 1).padStart(2, '0')}`,
    at: conflict.at,
    operator: conflict.operator,
    action: '会签冲突',
    detail: `${step.role}：${detail} 冲突记录 ${conflict.id}。`,
    operationId,
  })
}
