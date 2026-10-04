import { Component, Input } from '@angular/core'
import { MatChipsModule } from '@angular/material/chips'

@Component({
  selector: 'app-status-chip',
  standalone: true,
  imports: [MatChipsModule],
  template: `<mat-chip [class.warn]="tone === 'warn'" [class.good]="tone === 'good'">{{ label }}</mat-chip>`,
  styles: [`
    mat-chip { min-height: 24px; font-size: 11px; background: #edf1f2; }
    .warn { color: #984313; background: #fff0e4; }
    .good { color: #246d55; background: #e7f5ed; }
  `],
})
export class StatusChipComponent {
  @Input() label = ''
  @Input() tone: 'default' | 'warn' | 'good' = 'default'
}
