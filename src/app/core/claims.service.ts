import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http'
import { Injectable } from '@angular/core'
import { Observable, catchError, map, of, throwError } from 'rxjs'
import type { ClaimCase, ClaimFilters, PagedClaims } from './models'

export type WriteOutcome = { claim: ClaimCase; conflict: boolean }
type ConflictBody = { conflict: true; claim: ClaimCase; message?: string }

// 操作号：每次写入生成一个，失败后按原号重试，服务端据此幂等去重，不重复记账
const newOp = () => `OP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

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

  addQuote(claimId: string, body: { itemId: string; amount: number; reason: string }, opts: { demoFail?: boolean } = {}): Observable<WriteOutcome> {
    const op = newOp()
    return this.write(`/api/claims/${claimId}/quotes`, { ...body, op }, opts.demoFail === true)
  }

  approve(claimId: string, body: { role: string; result: string; comment: string }, opts: { demoFail?: boolean } = {}): Observable<WriteOutcome> {
    const op = newOp()
    return this.write(`/api/claims/${claimId}/approvals`, { ...body, op }, opts.demoFail === true)
  }

  // 并发演示：两人同时提交同一步会签（不同操作号），先到者成立，后到者只留冲突
  approveConcurrently(claimId: string, body: { role: string; comment: string }): Observable<WriteOutcome> {
    const opA = newOp()
    const opB = newOp()
    const post = (op: string, operator: string) =>
      this.http
        .post<ClaimCase | ConflictBody>(`/api/claims/${claimId}/approvals`, { ...body, result: '已通过', op, operator })
        .pipe(map((res) => this.toOutcome(res)), catchError((error: HttpErrorResponse) => of(this.toOutcome(error))))

    return new Observable<WriteOutcome>((subscriber) => {
      let remaining = 2
      let conflictOutcome: WriteOutcome | null = null
      let lastOutcome: WriteOutcome | null = null
      const done = (outcome: WriteOutcome) => {
        if (outcome.conflict) conflictOutcome = outcome
        else lastOutcome = outcome
        remaining--
        if (remaining === 0) {
          // 后到的冲突响应含先到决定与冲突审计，优先返回它
          subscriber.next(conflictOutcome ?? lastOutcome!)
          subscriber.complete()
        }
      }
      post(opA, '当前用户').subscribe({ next: done, error: (e) => done(this.toOutcome(e)) })
      post(opB, '同事 · 王审核').subscribe({ next: done, error: (e) => done(this.toOutcome(e)) })
    })
  }

  private write(url: string, body: unknown, demoFail: boolean): Observable<WriteOutcome> {
    const headers: Record<string, string> = demoFail ? { 'x-demo-fail': '1' } : {}
    return this.http.post<ClaimCase | ConflictBody>(url, body, { headers }).pipe(
      map((res) => this.toOutcome(res)),
      catchError((error: HttpErrorResponse) => {
        if (error.status === 409) return of(this.toOutcome(error))
        if (error.status === 500) {
          // 写入失败：按原操作号重试一次，服务端幂等去重，不重复记账
          return this.http.post<ClaimCase | ConflictBody>(url, body, {}).pipe(map((res) => this.toOutcome(res)))
        }
        return throwError(() => error)
      }),
    )
  }

  private toOutcome(res: ClaimCase | ConflictBody | HttpErrorResponse): WriteOutcome {
    if (res instanceof HttpErrorResponse) {
      const body = res.error as ConflictBody | undefined
      if (res.status === 409 && body?.claim) return { claim: body.claim, conflict: true }
      return { claim: body?.claim as ClaimCase, conflict: res.status === 409 }
    }
    if ((res as ConflictBody).conflict) return { claim: (res as ConflictBody).claim, conflict: true }
    return { claim: res as ClaimCase, conflict: false }
  }
}
