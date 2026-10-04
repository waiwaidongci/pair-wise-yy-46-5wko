import type { ApprovalStep, AuditEntry, ClaimCase, LossItem, QuoteVersion } from './models'

export const CURRENT_OPERATOR = '当前用户'
export const BASIS_VERSION_SEED = 1

export function latestQuote(item: Pick<LossItem, 'repairQuotes'>): QuoteVersion | undefined {
  return item.repairQuotes.at(-1)
}

export function calculateReserve(claim: Pick<ClaimCase, 'deductible' | 'lossItems'>): number {
  const net = claim.lossItems.reduce(
    (sum, item) => sum + Math.max(0, ((latestQuote(item)?.amount ?? 0) - item.salvage) * item.liability),
    0,
  )
  return Math.max(0, Math.round(net - claim.deductible))
}

export function quoteVersionSnapshot(lossItems: LossItem[]): Record<string, number> {
  return Object.fromEntries(lossItems.map((item) => [item.id, latestQuote(item)?.version ?? 0]))
}

export function isRequiredApproval(step: Pick<ApprovalStep, 'threshold'>, reserve: number): boolean {
  return step.threshold <= reserve
}

export function auditId(claim: ClaimCase): string {
  return `A-${String(claim.audit.length + 1).padStart(2, '0')}`
}

export function appendAudit(claim: ClaimCase, entry: Omit<AuditEntry, 'id'> & { id?: string }): void {
  claim.audit.push({ id: entry.id ?? auditId(claim), ...entry })
}

/**
 * 报价、准备金和会签共用 basis.version。现场修订一旦并入，就不能再沿用旧依据的通过结论。
 */
export function applyQuoteRevision(
  claim: ClaimCase,
  item: LossItem,
  amount: number,
  reason: string,
  operationId: string,
  operator = CURRENT_OPERATOR,
  at = new Date().toLocaleString('zh-CN'),
): ClaimCase {
  const previousVersion = latestQuote(item)?.version ?? 0
  const previousReserve = calculateReserve(claim)
  const quote: QuoteVersion = {
    version: previousVersion + 1,
    amount,
    reason,
    operator,
    createdAt: at,
  }
  item.repairQuotes.push(quote)

  const nextReserve = calculateReserve(claim)
  const nextBasisVersion = claim.basis.version + 1
  const crossedUp = previousReserve < nextReserve
  const crossedDown = previousReserve > nextReserve

  claim.basis = {
    version: nextBasisVersion,
    reserve: nextReserve,
    quoteVersions: quoteVersionSnapshot(claim.lossItems),
    updatedAt: at,
  }
  claim.reserve = nextReserve
  claim.status = '待复核'

  appendAudit(claim, {
    at,
    operator,
    action: '报价并入与依据更新',
    operationId,
    detail: `${item.category}报价由 V${previousVersion} 生成 V${quote.version}，金额调整为 ${formatAmount(amount)} 元；准备金由 ${formatAmount(previousReserve)} 元更新为 ${formatAmount(nextReserve)} 元，依据版本 V${nextBasisVersion}。`,
  })

  for (const step of claim.approvals) {
    if (step.threshold === 0) continue

    const wasRequired = step.threshold <= previousReserve
    const isRequired = step.threshold <= nextReserve
    const crossedThreshold = wasRequired !== isRequired

    if (crossedThreshold && isRequired && crossedUp) {
      appendStepStatusChange(
        claim,
        step,
        nextBasisVersion,
        step.status === '已失效' ? '会签级次恢复' : '会签退回待处理',
        `依据 V${nextBasisVersion - 1} 准备金 ${formatAmount(previousReserve)} 元；新准备金 ${formatAmount(nextReserve)} 元跨过 ${formatAmount(step.threshold)} 元阈值，${step.role}级次恢复待处理。`,
        at,
        operationId,
      )
    } else if (crossedThreshold && !isRequired && crossedDown) {
      appendStepStatusChange(
        claim,
        step,
        nextBasisVersion,
        '会签级次失效',
        `依据 V${nextBasisVersion - 1} 准备金 ${formatAmount(previousReserve)} 元；新准备金 ${formatAmount(nextReserve)} 元低于 ${formatAmount(step.threshold)} 元阈值，${step.role}级次不再适用。`,
        at,
        operationId,
      )
    } else if (isRequired && (step.status === '已通过' || step.status === '已退回') && step.basisVersion !== nextBasisVersion) {
      appendStepStatusChange(
        claim,
        step,
        nextBasisVersion,
        '会签退回待处理',
        `报价版本并入形成依据 V${nextBasisVersion}，原 ${step.status} 记录基于 V${step.basisVersion ?? BASIS_VERSION_SEED}，须按新准备金重新会签。`,
        at,
        operationId,
      )
    } else if (!isRequired && step.status === '待处理') {
      appendStepStatusChange(
        claim,
        step,
        nextBasisVersion,
        '会签级次失效',
        `当前准备金 ${formatAmount(nextReserve)} 元未达到 ${formatAmount(step.threshold)} 元阈值，${step.role}级次不适用。`,
        at,
        operationId,
      )
    } else if (step.status === '待处理' || step.status === '已失效') {
      step.basisVersion = nextBasisVersion
    }
  }

  return claim
}

function appendStepStatusChange(
  claim: ClaimCase,
  step: ApprovalStep,
  basisVersion: number,
  action: string,
  reason: string,
  at: string,
  operationId?: string,
): void {
  const oldStatus = step.status
  const required = isRequiredApproval(step, claim.reserve)
  const oldOperator = step.operator
  const oldCompletedAt = step.completedAt
  const oldComment = step.comment
  const oldBasisVersion = step.basisVersion

  step.status = required ? '待处理' : '已失效'
  step.basisVersion = basisVersion
  step.invalidReason = required ? undefined : reason
  step.invalidAt = required ? undefined : at
  step.operator = undefined
  step.comment = undefined
  step.completedAt = undefined

  appendAudit(claim, {
    at,
    operator: '规则引擎',
    action,
    operationId,
    detail:
      `${step.role}原状态「${oldStatus}」${oldOperator ? `，处理人 ${oldOperator}` : ''}${oldCompletedAt ? `，处理时间 ${oldCompletedAt}` : ''}。` +
      `${required ? '退回原因' : '失效原因'}：${reason}${oldComment ? ` 原意见：${oldComment}` : ''}；原依据 V${oldBasisVersion ?? BASIS_VERSION_SEED}，当前依据 V${basisVersion}。`,
  })
}

export function formatAmount(value: number): string {
  return value.toLocaleString('zh-CN')
}
