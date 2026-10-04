import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http'
import { Injectable } from '@angular/core'
import { Observable, throwError } from 'rxjs'
import { catchError } from 'rxjs/operators'
import type { ClaimCase, ClaimFilters, PagedClaims, ApprovalDecisionRequest, QuoteRevisionRequest } from './models'

const RETRY_STATUSES = [0, 500, 502, 503, 504]

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

  addQuote(claimId: string, body: QuoteRevisionRequest): Observable<ClaimCase> {
    return this.retryWithSameOperationId(body.operationId, () =>
      this.http.post<ClaimCase>(`/api/claims/${claimId}/quotes`, body),
    )
  }

  approve(claimId: string, body: ApprovalDecisionRequest): Observable<ClaimCase> {
    return this.retryWithSameOperationId(body.operationId, () =>
      this.http.post<ClaimCase>(`/api/claims/${claimId}/approvals`, body),
    )
  }

  private retryWithSameOperationId(operationId: string, request: () => Observable<ClaimCase>, attempt = 0): Observable<ClaimCase> {
    return request().pipe(
      catchError((error: HttpErrorResponse) => {
        if (attempt >= 1 || !RETRY_STATUSES.includes(error.status)) return throwError(() => error)
        console.warn(`写入失败，按原操作号 ${operationId} 重试（第 ${attempt + 1} 次）`)
        return this.retryWithSameOperationId(operationId, request, attempt + 1)
      }),
    )
  }
}
