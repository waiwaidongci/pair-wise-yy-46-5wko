export type ClaimStatus = '查勘中' | '待复核' | '退回补件' | '审批中' | '待支付' | '已结案'

export type Attachment = {
  id: string
  name: string
  category: '现场照片' | '修复报告' | '专家意见' | '保单摘录'
  version: number
  uploadedBy: string
  uploadedAt: string
}

export type LossItem = {
  id: string
  category: string
  description: string
  damage: string
  repairQuotes: Array<{ version: number; amount: number; reason: string; operator: string; createdAt: string }>
  salvage: number
  liability: number
  disputed: boolean
  attachments: Attachment[]
  expertNotes: string[]
}

export type ApprovalStep = {
  role: string
  threshold: number
  status: '待处理' | '已通过' | '已退回'
  operator?: string
  comment?: string
  completedAt?: string
  // 会签依据：通过时所依据的准备金与报价版本组合；报价版本一变，依据即失效
  basisReserve?: number
  basisQuoteVersion?: string
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
  // 案件修订号：报价并入或会签落账后自增，作为乐观并发与依据一致性的版本号
  version?: number
  paid: number
  deductible: number
  lossItems: LossItem[]
  approvals: ApprovalStep[]
  audit: Array<{ id: string; at: string; operator: string; action: string; detail: string }>
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
