import { Component } from '@angular/core'
import { CommonModule, CurrencyPipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatExpansionModule } from '@angular/material/expansion'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import type { Observable } from 'rxjs'
import { ClaimsService } from '../core/claims.service'
import type { ClaimCase, LossItem } from '../core/models'
import { selectSelectedClaim, updateClaim, type AppState } from '../core/claims.store'
import { calculateReserve, latestQuote } from '../core/claim-basis'
import { StatusChipComponent } from '../shared/status-chip.component'

@Component({
  selector: 'app-assessment-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CurrencyPipe,
    MatButtonModule,
    MatCardModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    StatusChipComponent,
  ],
  template: `
    <section class="page" *ngIf="claim$ | async as claim">
      <div class="page-head">
        <div>
          <p class="eyebrow">ASSESSMENT / 查勘定损</p>
          <h1>{{ claim.id }} · {{ claim.insured }}</h1>
          <p class="muted">{{ claim.lossAddress }} · 事故日 {{ claim.accidentDate }} · 查勘员 {{ claim.adjuster }}</p>
        </div>
        <div class="actions">
          <button mat-stroked-button><mat-icon>upload_file</mat-icon> 上传查勘材料</button>
          <button mat-flat-button color="primary" (click)="saveAll(claim)">保存本次查勘</button>
        </div>
      </div>

      <div class="summary-grid">
        <mat-card appearance="outlined"><span>损失科目</span><strong>{{ claim.lossItems.length }}</strong><small>{{ disputedCount(claim) }} 项存在争议</small></mat-card>
        <mat-card appearance="outlined"><span>修复报价合计</span><strong>{{ quoteTotal(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong><small>取依据内各科目的最新报价</small></mat-card>
        <mat-card appearance="outlined"><span>残值合计</span><strong>{{ salvageTotal(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong><small>待扣减</small></mat-card>
        <mat-card appearance="outlined" class="basis-card">
          <span>入账准备金 · 依据 V{{ claim.basis.version }}</span>
          <strong>{{ claim.basis.reserve | currency:'CNY':'symbol':'1.0-0' }}</strong>
          <small>与各会签步骤引用同一版本 · {{ claim.basis.updatedAt }}</small>
        </mat-card>
      </div>

      <div class="assessment-grid">
        <section class="panel">
          <div class="panel-head">
            <h3>损失科目与报价版本</h3>
            <span class="basis-tag"><mat-icon>link</mat-icon>报价版本 / 准备金 / 会签依据 V{{ claim.basis.version }}</span>
          </div>
          <mat-accordion multi>
            <mat-expansion-panel *ngFor="let item of claim.lossItems; let itemIndex = index" [expanded]="itemIndex === activeIndex" (opened)="activeIndex = itemIndex">
              <mat-expansion-panel-header>
                <mat-panel-title>
                  <strong>{{ item.category }}</strong>
                  <span>{{ item.description }}</span>
                </mat-panel-title>
                <mat-panel-description>
                  <app-status-chip [label]="item.disputed ? '争议项' : '已确认'" [tone]="item.disputed ? 'warn' : 'good'" />
                  <span class="quote">{{ latestQuoteAmount(item) | currency:'CNY':'symbol':'1.0-0' }}</span>
                </mat-panel-description>
              </mat-expansion-panel-header>
              <div class="loss-body">
                <div class="facts">
                  <label>损失事实</label>
                  <textarea [(ngModel)]="item.damage" rows="3"></textarea>
                  <div class="inline-fields">
                    <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>残值</mat-label><input matInput type="number" [(ngModel)]="item.salvage" /></mat-form-field>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>责任比例</mat-label><input matInput type="number" step="0.05" [(ngModel)]="item.liability" /></mat-form-field>
                  </div>
                </div>
                <div class="quote-history">
                  <h4>报价版本 <small>当前并入 V{{ quoteBasisVersion(claim, item.id) }}</small></h4>
                  <table mat-table [dataSource]="item.repairQuotes">
                    <ng-container matColumnDef="version"><th mat-header-cell *matHeaderCellDef>版本</th><td mat-cell *matCellDef="let quote">V{{ quote.version }}</td></ng-container>
                    <ng-container matColumnDef="amount"><th mat-header-cell *matHeaderCellDef>金额</th><td mat-cell *matCellDef="let quote">{{ quote.amount | currency:'CNY':'symbol':'1.0-0' }}</td></ng-container>
                    <ng-container matColumnDef="reason"><th mat-header-cell *matHeaderCellDef>调整理由</th><td mat-cell *matCellDef="let quote">{{ quote.reason }}<small>{{ quote.operator }} · {{ quote.createdAt }}</small></td></ng-container>
                    <tr mat-header-row *matHeaderRowDef="quoteColumns"></tr>
                    <tr mat-row *matRowDef="let row; columns: quoteColumns"></tr>
                  </table>
                </div>
                <div class="attachment-row">
                  <strong>关联材料</strong>
                  <span *ngFor="let file of item.attachments"><mat-icon>attach_file</mat-icon>{{ file.name }} · V{{ file.version }}</span>
                </div>
                <button mat-stroked-button color="primary" (click)="startQuote(item)"><mat-icon>edit_road</mat-icon> 调整最新报价</button>
                <div class="quote-form" *ngIf="quotingItemId === item.id">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>新报价</mat-label><input matInput type="number" [(ngModel)]="quoteAmount" /></mat-form-field>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="reason-field"><mat-label>调整理由（必填）</mat-label><input matInput [(ngModel)]="quoteReason" /></mat-form-field>
                  <button mat-flat-button color="primary" [disabled]="!quoteReason.trim() || !quoteAmount || savingQuote" (click)="submitQuote(claim, item.id)">
                    {{ savingQuote ? '并入中…' : '并入并生成新版本' }}
                  </button>
                  <small>提交后形成依据 V{{ claim.basis.version + 1 }}，重算准备金并使跨阈值旧会签立即失效。</small>
                </div>
              </div>
            </mat-expansion-panel>
          </mat-accordion>
        </section>

        <aside>
          <section class="panel basis-panel">
            <div class="panel-head"><h3>同一份审批依据</h3><mat-icon>verified</mat-icon></div>
            <dl>
              <div><dt>依据版本</dt><dd>V{{ claim.basis.version }}</dd></div>
              <div><dt>入账准备金</dt><dd>{{ claim.basis.reserve | currency:'CNY':'symbol':'1.0-0' }}</dd></div>
              <div><dt>页面试算</dt><dd>{{ calculateReserve(claim) | currency:'CNY':'symbol':'1.0-0' }}</dd></div>
              <div><dt>更新时间</dt><dd>{{ claim.basis.updatedAt }}</dd></div>
            </dl>
            <p>现场报价并入后才会生成新依据；未并入的残值、责任比例编辑仅作为查勘草稿。</p>
          </section>
          <section class="panel">
            <div class="panel-head"><h3>专家记录</h3><span class="muted">不可覆盖</span></div>
            <div class="expert-list">
              <div *ngFor="let item of claim.lossItems">
                <strong>{{ item.category }}</strong>
                <p *ngFor="let note of item.expertNotes">{{ note }}</p>
                <small *ngIf="item.expertNotes.length === 0">暂无专家补充说明</small>
              </div>
            </div>
          </section>
          <section class="panel draft-panel">
            <div class="panel-head"><h3>查勘草稿</h3><mat-icon>cloud_done</mat-icon></div>
            <textarea rows="7" [(ngModel)]="draft" (blur)="saveDraft(claim)"></textarea>
            <small>离开页面后仍可恢复到本地草稿。</small>
          </section>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    .summary-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; margin-bottom: 14px; }
    .summary-grid mat-card { padding: 15px; border-color: #dce3e6; }
    .summary-grid span, .summary-grid small { display: block; color: #6e7a83; font-size: 12px; }
    .summary-grid strong { display: block; margin: 6px 0; color: #153747; font-size: 24px; }
    .basis-card { border-color: #2f8191; background: #f2f9f9; }
    .assessment-grid { display: grid; grid-template-columns: minmax(0,1fr) 330px; gap: 14px; align-items: start; }
    .basis-tag { display: inline-flex; align-items: center; gap: 4px; color: #286f7a; font-weight: 700; }
    .basis-tag mat-icon { font-size: 16px; width: 16px; height: 16px; }
    mat-panel-title { display: flex; flex-direction: column; gap: 4px; }
    mat-panel-title span { color: #7a858c; font-size: 11px; }
    mat-panel-description { justify-content: flex-end; gap: 12px; }
    .quote { color: #1d6670; font-weight: 800; }
    .loss-body { display: grid; gap: 16px; padding-top: 10px; }
    .facts > label { display: block; margin-bottom: 6px; color: #53636d; font-size: 12px; font-weight: 700; }
    textarea { width: 100%; padding: 10px; border: 1px solid #cbd5da; border-radius: 8px; resize: vertical; font: inherit; }
    .inline-fields, .quote-form { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .inline-fields mat-form-field { width: 150px; }
    .quote-history h4 { margin: 0 0 8px; font-size: 13px; }
    .quote-history h4 small { margin-left: 8px; color: #78858e; }
    table { width: 100%; }
    td small { display: block; margin-top: 4px; color: #7a858c; }
    .attachment-row { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
    .attachment-row span { display: inline-flex; align-items: center; gap: 3px; padding: 5px 7px; color: #4f626d; background: #f0f4f5; border-radius: 5px; font-size: 11px; }
    .attachment-row mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .quote-form { padding: 12px; background: #f4f7f8; border-left: 3px solid #277b89; }
    .quote-form small { flex-basis: 100%; color: #738088; }
    .reason-field { flex: 1; min-width: 220px; }
    aside { display: grid; gap: 14px; }
    .basis-panel .panel-head mat-icon { color: #3a8b78; }
    .basis-panel dl { display: grid; gap: 8px; margin: 0; padding: 14px 16px; }
    .basis-panel dl div { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; }
    .basis-panel dt { color: #738089; }
    .basis-panel dd { margin: 0; color: #173d4b; font-weight: 800; text-align: right; }
    .basis-panel p { margin: 0 16px 16px; color: #6d7980; font-size: 11px; line-height: 1.5; }
    .expert-list { padding: 8px 16px 16px; }
    .expert-list div { padding: 10px 0; border-bottom: 1px solid #edf0f2; }
    .expert-list p { margin: 6px 0 0; color: #65737c; font-size: 11px; line-height: 1.5; }
    .expert-list small { color: #8b969d; font-size: 11px; }
    .draft-panel { padding-bottom: 14px; }
    .draft-panel textarea { width: calc(100% - 28px); margin: 14px; }
    .draft-panel small { display: block; margin: -6px 14px 0; color: #7d8991; }
    @media (max-width: 1050px) { .assessment-grid { grid-template-columns: 1fr; } .summary-grid { grid-template-columns: repeat(2,1fr); } }
    @media (max-width: 620px) { .summary-grid { grid-template-columns: 1fr 1fr; } }
  `],
})
export class AssessmentPageComponent {
  claim$: Observable<ClaimCase>
  quoteColumns = ['version', 'amount', 'reason']
  activeIndex = 0
  quotingItemId = ''
  quoteAmount = 0
  quoteReason = ''
  savingQuote = false
  draft = localStorage.getItem('claims-assessment-draft') ?? '待补充房屋檩条第三方复测依据，并核对存货库龄核减。'

  constructor(
    private readonly store: Store<AppState>,
    private readonly service: ClaimsService,
    private readonly snackBar: MatSnackBar,
  ) {
    this.claim$ = this.store.select(selectSelectedClaim)
    this.store.select((state) => state.claims.draft).subscribe((draft) => (this.draft = draft))
  }

  latestQuoteAmount(item: LossItem) {
    return latestQuote(item)?.amount ?? 0
  }

  quoteTotal(claim: ClaimCase) {
    return claim.lossItems.reduce((sum, item) => sum + this.latestQuoteAmount(item), 0)
  }

  salvageTotal(claim: ClaimCase) {
    return claim.lossItems.reduce((sum, item) => sum + item.salvage, 0)
  }

  calculateReserve(claim: ClaimCase) {
    return calculateReserve(claim)
  }

  quoteBasisVersion(claim: ClaimCase, itemId: string) {
    return claim.basis.quoteVersions[itemId] ?? 0
  }

  disputedCount(claim: Pick<ClaimCase, 'lossItems'>) {
    return claim.lossItems.filter((item) => item.disputed).length
  }

  startQuote(item: LossItem) {
    this.quotingItemId = item.id
    this.quoteAmount = this.latestQuoteAmount(item)
    this.quoteReason = ''
  }

  submitQuote(claim: ClaimCase, itemId: string) {
    const reason = this.quoteReason.trim()
    if (!reason || this.savingQuote) return
    const amount = Number(this.quoteAmount)
    const operationId = this.createOperationId('QUOTE')
    this.savingQuote = true
    this.service
      .addQuote(claim.id, { itemId, amount, reason, basisVersion: claim.basis.version, operationId })
      .subscribe({
        next: (updated) => {
          this.store.dispatch(updateClaim({ claim: updated }))
          this.snackBar.open('新报价已并入同一依据，旧跨阈值会签已按规则退回', '关闭', { duration: 2600 })
          this.quotingItemId = ''
          this.quoteReason = ''
          this.savingQuote = false
        },
        error: (error) => {
          this.savingQuote = false
          this.handleWriteError(error, '报价写入失败，请刷新后重试')
        },
      })
  }

  saveAll(claim: ClaimCase) {
    localStorage.setItem('claims-assessment-draft', this.draft)
    this.store.dispatch(updateClaim({ claim: structuredClone(claim) }))
    this.snackBar.open('查勘草稿已保存；正式准备金以已并入的报价依据为准', '关闭', { duration: 2200 })
  }

  saveDraft(claim: ClaimCase) {
    localStorage.setItem('claims-assessment-draft', this.draft)
    this.store.dispatch(updateClaim({ claim: structuredClone(claim) }))
  }

  private handleWriteError(error: { status?: number; error?: { message?: string; claim?: ClaimCase } }, fallback: string) {
    const serverClaim = error.error?.claim
    if (serverClaim) this.store.dispatch(updateClaim({ claim: serverClaim }))
    this.snackBar.open(error.error?.message ?? fallback, '关闭', { duration: 3000 })
  }

  private createOperationId(prefix: string) {
    return `${prefix}-${Date.now()}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
  }
}
