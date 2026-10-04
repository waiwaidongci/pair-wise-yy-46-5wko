export type ClaimStatus = '查勘中' | '待复核' | '退回补件' | '审批中' | '待支付' | '已结案'

export type Attachment = {
  id: string
  name: string
  category: '现场照片' | '修复报告' | '专家意见' | '保单摘录'
  version: number
  uploadedBy: string
  uploadedAt: string
}

export type QuoteVersion = {
  version: number
  amount: number
  reason: string
  operator: string
  createdAt: string
}

export type LossItem = {
  id: string
  category: string
  description: string
  damage: string
  repairQuotes: QuoteVersion[]
  salvage: number
  liability: number
  disputed: boolean
  attachments: Attachment[]
  expertNotes: string[]
}

export type ApprovalStatus = '待处理' | '已通过' | '已退回' | '已失效'

export type ApprovalConflict = {
  id: string
  at: string
  operator: string
  operationId: string
  detail: string
}

export type ApprovalStep = {
  id: string
  role: string
  threshold: number
  status: ApprovalStatus
  basisVersion?: number
  operator?: string
  comment?: string
  completedAt?: string
  invalidReason?: string
  invalidAt?: string
  conflicts: ApprovalConflict[]
}

export type ClaimBasis = {
  version: number
  reserve: number
  quoteVersions: Record<string, number>
  updatedAt: string
}

export type AuditEntry = {
  id: string
  at: string
  operator: string
  action: string
  detail: string
  operationId?: string
}

export type ClaimCase = {
  id: string
  policyNo: string
  insured: string
  lossAddress: string
  accidentDate: string
  reportedAt: string
  adjuster: string
  status: ClaimStatus
  riskLevel: '低' | '中' | '高'
  reserve: number
  paid: number
  deductible: number
  basis: ClaimBasis
  lossItems: LossItem[]
  approvals: ApprovalStep[]
  audit: AuditEntry[]
}

export type ClaimFilters = {
  query: string
  status: string
  risk: string
  page: number
  pageSize: number
}

export type PagedClaims = {
  items: ClaimCase[]
  total: number
  page: number
  pageSize: number
}

export type QuoteRevisionRequest = {
  itemId: string
  amount: number
  reason: string
  basisVersion: number
  operationId: string
}

export type ApprovalDecisionRequest = {
  role: string
  result: '已通过' | '已退回补件'
  comment: string
  basisVersion: number
  operationId: string
}
