import { Component } from '@angular/core'
import { CommonModule, CurrencyPipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTableModule } from '@angular/material/table'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { Store } from '@ngrx/store'
import type { Observable } from 'rxjs'
import { StatusChipComponent } from '../shared/status-chip.component'
import type { ClaimCase } from '../core/models'
import { selectAllClaims, selectFilters, selectFilteredClaims, selectClaim, setFilters, type AppState } from '../core/claims.store'

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CurrencyPipe,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    MatProgressBarModule,
    StatusChipComponent,
  ],
  template: `
    <section class="page">
      <div class="page-head">
        <div>
          <p class="eyebrow">CLAIMS CONTROL / 理赔控制</p>
          <h1>财产险案件总览</h1>
          <p class="muted">按金额、科目与风险阈值追踪查勘、报价修订和准备金会签。</p>
        </div>
        <div class="actions">
          <button mat-stroked-button><mat-icon>download</mat-icon> 导出批次</button>
          <button mat-flat-button color="primary" (click)="openFirst()"><mat-icon>fact_check</mat-icon> 继续查勘</button>
        </div>
      </div>

      <div class="metrics">
        <mat-card appearance="outlined"><span>在办案件</span><strong>{{ (claims$ | async)?.length }}</strong><small>2 个高风险</small></mat-card>
        <mat-card appearance="outlined"><span>申请准备金</span><strong>{{ totalReserve$ | async | currency:'CNY':'symbol':'1.0-0' }}</strong><small>含待复核调整</small></mat-card>
        <mat-card appearance="outlined"><span>待会签步骤</span><strong>{{ pendingApprovals$ | async }}</strong><small>按阈值自动升级</small></mat-card>
        <mat-card appearance="outlined"><span>争议科目</span><strong class="warn">{{ disputedItems$ | async }}</strong><small>需补充证据</small></mat-card>
      </div>

      <div class="dashboard-grid">
        <section class="panel">
          <div class="panel-head">
            <h3>案件队列</h3>
            <span class="muted">模拟分页 REST · {{ (filteredClaims$ | async)?.length }} 条</span>
          </div>
          <div class="filters">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>搜索案件/被保险人</mat-label>
              <input matInput [ngModel]="(filters$ | async)?.query" (ngModelChange)="updateFilter('query', $event)" />
              <mat-icon matSuffix>search</mat-icon>
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>状态</mat-label>
              <mat-select [ngModel]="(filters$ | async)?.status" (ngModelChange)="updateFilter('status', $event)">
                <mat-option value="">全部状态</mat-option>
                <mat-option value="查勘中">查勘中</mat-option>
                <mat-option value="待复核">待复核</mat-option>
                <mat-option value="退回补件">退回补件</mat-option>
                <mat-option value="审批中">审批中</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>风险等级</mat-label>
              <mat-select [ngModel]="(filters$ | async)?.risk" (ngModelChange)="updateFilter('risk', $event)">
                <mat-option value="">全部等级</mat-option>
                <mat-option value="高">高风险</mat-option>
                <mat-option value="中">中风险</mat-option>
                <mat-option value="低">低风险</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
          <div class="table-wrap">
            <table mat-table [dataSource]="(filteredClaims$ | async) ?? []">
              <ng-container matColumnDef="case">
                <th mat-header-cell *matHeaderCellDef>案件 / 保单</th>
                <td mat-cell *matCellDef="let claim">
                  <strong>{{ claim.id }}</strong>
                  <small>{{ claim.policyNo }}</small>
                </td>
              </ng-container>
              <ng-container matColumnDef="insured">
                <th mat-header-cell *matHeaderCellDef>被保险人</th>
                <td mat-cell *matCellDef="let claim">
                  <strong>{{ claim.insured }}</strong>
                  <small>{{ claim.adjuster }}</small>
                </td>
              </ng-container>
              <ng-container matColumnDef="reserve">
                <th mat-header-cell *matHeaderCellDef>准备金</th>
                <td mat-cell *matCellDef="let claim">{{ claim.reserve | currency:'CNY':'symbol':'1.0-0' }}</td>
              </ng-container>
              <ng-container matColumnDef="risk">
                <th mat-header-cell *matHeaderCellDef>风险</th>
                <td mat-cell *matCellDef="let claim"><app-status-chip [label]="claim.riskLevel + '风险'" [tone]="claim.riskLevel === '高' ? 'warn' : claim.riskLevel === '中' ? 'default' : 'good'" /></td>
              </ng-container>
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>状态</th>
                <td mat-cell *matCellDef="let claim"><app-status-chip [label]="claim.status" [tone]="claim.status === '待复核' ? 'warn' : 'good'" /></td>
              </ng-container>
              <ng-container matColumnDef="action">
                <th mat-header-cell *matHeaderCellDef></th>
                <td mat-cell *matCellDef="let claim"><button mat-button color="primary" (click)="open(claim.id)">处理</button></td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columns"></tr>
              <tr mat-row *matRowDef="let row; columns: columns"></tr>
            </table>
          </div>
        </section>

        <aside class="panel risk-panel">
          <div class="panel-head"><h3>风险阈值</h3><span class="muted">准备金规则</span></div>
          <div class="rule-list">
            <div><span>0 - 50 万</span><strong>一级核赔</strong></div>
            <div><span>50 - 100 万</span><strong>高级核赔</strong></div>
            <div><span>100 - 150 万</span><strong>理赔经理</strong></div>
            <div><span>150 万以上</span><strong>区域负责人</strong></div>
          </div>
          <div class="risk-note">
            <mat-icon>warning_amber</mat-icon>
            <div><strong>当前案件触发四级会签</strong><p>涉及房屋建筑与设备报价调整，需补充第三方依据后方可通过。</p></div>
          </div>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    .metrics { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; margin-bottom: 14px; }
    .metrics mat-card { padding: 16px; border-color: #dce3e6; }
    .metrics span, .metrics small { display: block; color: #6e7a83; font-size: 12px; }
    .metrics strong { display: block; margin: 7px 0; color: #153747; font-size: 27px; }
    .warn { color: #b95c2c !important; }
    .dashboard-grid { display: grid; grid-template-columns: minmax(0,1fr) 290px; gap: 14px; }
    .filters { display: grid; grid-template-columns: minmax(220px,1fr) 150px 130px; gap: 10px; padding: 12px 14px 4px; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; min-width: 760px; }
    td strong, td small { display: block; }
    td small { margin-top: 4px; color: #7b8790; }
    .risk-panel { align-self: start; }
    .rule-list { padding: 12px 16px; }
    .rule-list div { display: flex; justify-content: space-between; gap: 8px; padding: 11px 0; border-bottom: 1px solid #edf0f2; font-size: 12px; }
    .rule-list span { color: #6d7982; }
    .risk-note { display: flex; gap: 9px; margin: 4px 14px 14px; padding: 12px; color: #763f20; background: #fff3e8; border-left: 3px solid #ce743e; }
    .risk-note p { margin: 5px 0 0; font-size: 11px; line-height: 1.55; }
    @media (max-width: 1050px) { .dashboard-grid { grid-template-columns: 1fr; } .metrics { grid-template-columns: repeat(2,1fr); } }
    @media (max-width: 680px) { .filters { grid-template-columns: 1fr; } .metrics { grid-template-columns: 1fr 1fr; } }
  `],
})
export class DashboardPageComponent {
  claims$: Observable<ClaimCase[]>
  filteredClaims$: Observable<ClaimCase[]>
  filters$: Observable<import('../core/models').ClaimFilters>
  totalReserve$: Observable<number>
  pendingApprovals$: Observable<number>
  disputedItems$: Observable<number>
  columns = ['case', 'insured', 'reserve', 'risk', 'status', 'action']

  constructor(
    private readonly store: Store<AppState>,
    private readonly router: Router,
  ) {
    this.claims$ = this.store.select(selectAllClaims)
    this.filteredClaims$ = this.store.select(selectFilteredClaims)
    this.filters$ = this.store.select(selectFilters)
    this.totalReserve$ = this.store.select((state) => state.claims.items.reduce((sum, claim) => sum + claim.reserve, 0))
    this.pendingApprovals$ = this.store.select((state) => state.claims.items.reduce((sum, claim) => sum + claim.approvals.filter((step) => step.status === '待处理').length, 0))
    this.disputedItems$ = this.store.select((state) => state.claims.items.reduce((sum, claim) => sum + claim.lossItems.filter((item) => item.disputed).length, 0))
  }

  updateFilter(key: string, value: string) {
    this.store.dispatch(setFilters({ filters: { [key]: value, page: 1 } }))
  }

  open(id: string) {
    this.store.dispatch(selectClaim({ id }))
    this.router.navigate(['/assessment'])
  }

  openFirst() {
    this.router.navigate(['/assessment'])
  }
}
