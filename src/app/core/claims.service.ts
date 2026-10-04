import { HttpClient, HttpParams } from '@angular/common/http'
import { Injectable } from '@angular/core'
import type { ClaimCase, ClaimFilters, PagedClaims } from './models'

@Injectable({ providedIn: 'root' })
export class ClaimsService {
  constructor(private readonly http: HttpClient) {}

  list(filters: ClaimFilters) {
    const params = new HttpParams()
      .set('query', filters.query)
      .set('status', filters.status)
      .set('risk', filters.risk)
      .set('page', filters.page)
      .set('pageSize', filters.pageSize)
    return this.http.get<PagedClaims>('/api/claims', { params })
  }

  get(id: string) {
    return this.http.get<ClaimCase>(`/api/claims/${id}`)
  }

  addQuote(claimId: string, body: { itemId: string; amount: number; reason: string }) {
    return this.http.post(`/api/claims/${claimId}/quotes`, body)
  }

  approve(claimId: string, body: { role: string; result: string; comment: string }) {
    return this.http.post(`/api/claims/${claimId}/approvals`, body)
  }
}
