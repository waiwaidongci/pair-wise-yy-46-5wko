import { Component } from '@angular/core'
import { CommonModule, CurrencyPipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MatStepperModule } from '@angular/material/stepper'
import { Store } from '@ngrx/store'
import type { Observable } from 'rxjs'
import { ClaimsService } from '../core/claims.service'
import type { ApprovalDecisionRequest, ApprovalStep, ClaimCase } from '../core/models'
import { selectSelectedClaim, updateClaim, type AppState } from '../core/claims.store'
import { isRequiredApproval } from '../core/claim-basis'
import { StatusChipComponent } from '../shared/status-chip.component'

@Component({
  selector: 'app-review-page',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, MatStepperModule, StatusChipComponent],
  template: `
    <section class="page" *ngIf="claim$ | async as claim">
      <div class="page-head">
        <div>
          <p class="eyebrow">RESERVE APPROVAL / 准备金审批</p>
          <h1>多级会签与赔付方案比较</h1>
          <p class="muted">会签只能基于当前报价、准备金共用的依据版本提交；后到的重复提交只保留冲突。</p>
        </div>
        <span class="reserve">当前依据 V{{ claim.basis.version }} · 申请准备金 {{ claim.basis.reserve | currency:'CNY':'symbol':'1.0-0' }}</span>
      </div>

      <div class="review-grid">
        <section class="panel">
          <div class="panel-head"><h3>会签流程</h3><app-status-chip [label]="claim.status" [tone]="claim.status === '退回补件' ? 'warn' : 'good'" /></div>
          <mat-stepper orientation="vertical" [linear]="false" class="approval-stepper">
            <mat-step *ngFor="let step of claim.approvals; let index = index" [completed]="step.status === '已通过'">
              <ng-template matStepLabel>
                <strong>{{ step.role }}</strong>
                <span class="threshold">阈值 {{ step.threshold | currency:'CNY':'symbol':'1.0-0' }} · 依据 V{{ step.basisVersion ?? claim.basis.version }}</span>
              </ng-template>
              <div class="step-body" [class.invalid]="step.status === '已失效'" [class.returned]="step.status === '已退回'">
                <div class="status-row">
                  <app-status-chip [label]="step.status" [tone]="stepTone(step.status)" />
                  <small *ngIf="isActive(claim, step)">当前准备金已触发</small>
                  <small *ngIf="!isActive(claim, step)">当前准备金未触发</small>
                </div>
                <p>{{ step.comment || step.invalidReason || (step.status === '待处理' ? '等待当前审核人处理。' : step.status + '。') }}</p>
                <small *ngIf="step.operator">{{ step.operator }} · {{ step.completedAt }}</small>

                <div class="conflict-list" *ngIf="step.conflicts.length > 0">
                  <strong><mat-icon>gavel</mat-icon> 后到冲突（{{ step.conflicts.length }}）</strong>
                  <article *ngFor="let conflict of step.conflicts">
                    <span>{{ conflict.id }} · {{ conflict.at }}</span>
                    <p>{{ conflict.detail }}</p>
                    <small>操作号 {{ conflict.operationId }}</small>
                  </article>
                </div>

                <div class="step-actions" *ngIf="canDecide(claim, step)">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>审批意见</mat-label><input matInput [(ngModel)]="comments[index]" /></mat-form-field>
                  <button mat-flat-button color="primary" [disabled]="!comments[index]?.trim() || approvingRole === step.role" (click)="decide(claim, step, '已通过', index)">
                    {{ approvingRole === step.role ? '提交中…' : '通过' }}
                  </button>
                  <button mat-stroked-button color="warn" [disabled]="!comments[index]?.trim() || approvingRole === step.role" (click)="decide(claim, step, '已退回补件', index)">退回补件</button>
                  <small>提交操作号会随请求保留；网络失败时按同一操作号重试，不重复记账。</small>
                </div>
              </div>
            </mat-step>
          </mat-stepper>
        </section>

        <aside>
          <section class="panel basis-panel">
            <div class="panel-head"><h3>审批依据</h3><mat-icon>link</mat-icon></div>
            <dl>
              <div><dt>依据版本</dt><dd>V{{ claim.basis.version }}</dd></div>
              <div><dt>准备金</dt><dd>{{ claim.basis.reserve | currency:'CNY':'symbol':'1.0-0' }}</dd></div>
              <div *ngFor="let item of claim.lossItems"><dt>{{ item.category }}</dt><dd>V{{ quoteBasisVersion(claim, item.id) }}</dd></div>
            </dl>
          </section>
          <section class="panel">
            <div class="panel-head"><h3>赔付方案对比</h3><span class="muted">自动试算</span></div>
            <div class="plans">
              <mat-card appearance="outlined">
                <span>方案 A · 现状评估</span>
                <strong>{{ planA(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong>
                <p>采用最新报价，全额计入存货库龄风险。</p>
                <button mat-button>设为审批方案</button>
              </mat-card>
              <mat-card appearance="outlined" class="recommended">
                <span>方案 B · 核减待证部分</span>
                <strong>{{ planB(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong>
                <p>暂扣第三方复测与库龄核减争议金额，通过后追加。</p>
                <button mat-flat-button color="primary">推荐方案</button>
              </mat-card>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>争议项定位</h3><span class="muted">{{ disputedCount(claim) }} 项</span></div>
            <div class="disputes">
              <div *ngFor="let item of claim.lossItems" [class.disputed]="item.disputed">
                <mat-icon>{{ item.disputed ? 'report_problem' : 'check_circle' }}</mat-icon>
                <div><strong>{{ item.category }} · {{ item.description }}</strong><p>{{ item.disputed ? '存在证据差异，审批意见不能覆盖原始查勘记录。' : '材料一致，可纳入当前方案。' }}</p></div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    .reserve { padding: 10px 14px; border-left: 3px solid #2f8191; background: #eaf4f5; color: #175866; font-weight: 800; }
    .review-grid { display: grid; grid-template-columns: minmax(0,1fr) 360px; gap: 14px; align-items: start; }
    .approval-stepper { padding: 18px 22px 22px 8px; background: transparent; }
    mat-step strong, mat-step .threshold { display: block; }
    .threshold { margin-top: 3px; color: #78858d; font-size: 10px; }
    .step-body { padding: 4px 0 16px; }
    .step-body.invalid { padding: 10px; border-left: 3px solid #9aa5ac; background: #f5f7f8; }
    .step-body.returned { padding: 10px; border-left: 3px solid #ce743e; background: #fff7ef; }
    .status-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    .status-row small { color: #7e8a92; }
    .step-body p { margin: 0 0 6px; color: #58666f; }
    .step-body small { color: #869198; }
    .step-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .step-actions mat-form-field { flex: 1; min-width: 240px; }
    .step-actions > small { flex-basis: 100%; }
    .conflict-list { margin-top: 10px; padding: 10px; border: 1px dashed #c98a66; border-radius: 8px; background: #fff8f2; }
    .conflict-list > strong { display: flex; align-items: center; gap: 5px; color: #9b542b; font-size: 12px; }
    .conflict-list mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .conflict-list article { margin-top: 8px; padding-top: 8px; border-top: 1px solid #ead7c8; }
    .conflict-list span { font-weight: 800; color: #8b4f2c; font-size: 10px; }
    .conflict-list p { margin: 4px 0; font-size: 11px; }
    aside { display: grid; gap: 14px; }
    .basis-panel dl { display: grid; gap: 8px; margin: 0; padding: 14px 16px; }
    .basis-panel dl div { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; }
    .basis-panel dt { color: #738089; }
    .basis-panel dd { margin: 0; color: #173d4b; font-weight: 800; }
    .basis-panel .panel-head mat-icon { color: #2f8191; }
    .plans { display: grid; gap: 10px; padding: 14px; }
    .plans mat-card { padding: 14px; }
    .plans .recommended { border-color: #39828b; background: #f0f8f8; }
    .plans span, .plans p { display: block; color: #69767e; font-size: 12px; }
    .plans strong { display: block; margin: 7px 0; color: #184855; font-size: 22px; }
    .disputes { padding: 6px 14px 14px; }
    .disputes > div { display: flex; gap: 9px; padding: 10px 0; border-bottom: 1px solid #edf0f2; color: #437360; }
    .disputes > div.disputed { color: #b55a2e; }
    .disputes strong { font-size: 12px; }
    .disputes p { margin: 5px 0 0; color: #6d7981; font-size: 11px; line-height: 1.5; }
    @media (max-width: 1050px) { .review-grid { grid-template-columns: 1fr; } }
  `],
})
export class ReviewPageComponent {
  claim$: Observable<ClaimCase>
  comments: Record<number, string> = {}
  approvingRole = ''

  constructor(
    private readonly store: Store<AppState>,
    private readonly service: ClaimsService,
    private readonly snackBar: MatSnackBar,
  ) {
    this.claim$ = this.store.select(selectSelectedClaim)
  }

  isActive(claim: ClaimCase, step: ApprovalStep) {
    return isRequiredApproval(step, claim.basis.reserve)
  }

  canDecide(claim: ClaimCase, step: ApprovalStep) {
    return step.status === '待处理' && this.isActive(claim, step)
  }

  stepTone(status: ApprovalStep['status']) {
    if (status === '已通过') return 'good'
    if (status === '待处理') return 'default'
    return 'warn'
  }

  quoteBasisVersion(claim: ClaimCase, itemId: string) {
    return claim.basis.quoteVersions[itemId] ?? 0
  }

  planA(claim: ClaimCase) {
    return claim.lossItems.reduce((sum, item) => sum + Math.max(0, ((item.repairQuotes.at(-1)?.amount ?? 0) - item.salvage) * item.liability), 0) - claim.deductible
  }

  planB(claim: ClaimCase) {
    return this.planA(claim) - claim.lossItems.filter((item) => item.disputed).length * 72000
  }

  disputedCount(claim: ClaimCase) {
    return claim.lossItems.filter((item) => item.disputed).length
  }

  decide(claim: ClaimCase, step: ApprovalStep, result: ApprovalDecisionRequest['result'], index: number) {
    const comment = this.comments[index]?.trim()
    if (!comment || this.approvingRole) return
    const operationId = this.createOperationId('APPR')
    this.approvingRole = step.role
    this.service
      .approve(claim.id, { role: step.role, result, comment, basisVersion: claim.basis.version, operationId })
      .subscribe({
        next: (updated) => {
          this.store.dispatch(updateClaim({ claim: updated }))
          this.snackBar.open(result === '已通过' ? '会签通过，已按当前依据流转至下一级' : '案件已退回补件，原始记录未修改', '关闭', { duration: 2400 })
          this.comments[index] = ''
          this.approvingRole = ''
        },
        error: (error) => {
          this.approvingRole = ''
          const serverClaim = error.error?.claim as ClaimCase | undefined
          if (serverClaim) this.store.dispatch(updateClaim({ claim: serverClaim }))
          this.snackBar.open(error.error?.message ?? '会签提交失败，请刷新后重试', '关闭', { duration: 3000 })
        },
      })
  }

  private createOperationId(prefix: string) {
    return `${prefix}-${Date.now()}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
  }
}
